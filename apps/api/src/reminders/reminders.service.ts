import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';

/** Most reminders one run sends. The rest go on the next run, 5 minutes on. */
const REMINDERS_PER_RUN = 100;

/**
 * Emails the person a task is assigned to once it comes due. Surplus stage
 * tasks, notary appointments, dialer callbacks and "Next action" all land
 * here, and for a callback at a set time this is the only nudge anyone gets
 * (the Daily Brief lists overdue surplus follow-ups once a morning).
 *
 * Production runs two API replicas and every @Cron fires on both. Each task is
 * therefore claimed (reminderSent flipped from false to true in one update)
 * before its email goes out, so only the replica that wins the claim sends it.
 * Before this, both replicas emailed the same task a second apart (2026-11-11).
 *
 * A task with no one assigned is never asked for. Nobody gets an email for it
 * either way, and the cadence makes dozens at a time that used to log a
 * warning each. Those show on the board and in the Daily Brief.
 *
 * Quiet unless it sends: with two replicas, a line per run was about 1,150 log
 * lines a day of "No due reminders to process".
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private config: ConfigService,
  ) {}

  @Cron('*/5 * * * *')
  async processReminders(): Promise<number> {
    const now = new Date();
    const dueTasks = await this.prisma.task.findMany({
      where: {
        dueDate: { lte: now },
        completed: false,
        reminderSent: false,
        userId: { not: null },
      },
      include: {
        lead: true,
        user: true,
      },
      orderBy: { dueDate: 'asc' },
      take: REMINDERS_PER_RUN,
    });

    let sent = 0;
    for (const task of dueTasks) {
      const email = task.user?.email;
      if (!email) continue;

      // The claim. Only the replica whose update flips the flag sends.
      const claimed = await this.prisma.task.updateMany({
        where: { id: task.id, reminderSent: false },
        data: { reminderSent: true },
      });
      if (claimed.count === 0) continue;

      const lead = task.lead;
      const leadName = [lead.sellerFirstName, lead.sellerLastName]
        .filter(Boolean)
        .join(' ') || 'Unknown Seller';
      const address = lead.propertyAddress || 'No address';
      const frontendUrl =
        this.config.get('FRONTEND_URL') || 'http://localhost:3000';
      const leadUrl = `${frontendUrl}/leads/${lead.id}`;

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #111827; margin-bottom: 8px;">Follow-Up Reminder</h2>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.6; margin-bottom: 4px;">
            <strong>${task.title}</strong>
          </p>
          ${task.description ? `<p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin-top: 0;">${task.description}</p>` : ''}
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 13px; width: 80px;">Seller</td>
              <td style="padding: 8px 0; color: #111827; font-size: 13px;">${leadName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 13px;">Property</td>
              <td style="padding: 8px 0; color: #111827; font-size: 13px;">${address}</td>
            </tr>
          </table>
          <div style="margin: 24px 0;">
            <a href="${leadUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 8px;">
              View Lead
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">Deal Core follow-up reminder</p>
        </div>
      `;

      try {
        await this.mailer.sendDealPackage(
          email,
          `Reminder: ${task.title}`,
          html,
        );
        sent++;
        this.logger.log(`Sent reminder for task ${task.id}`);
      } catch (err: any) {
        // Give the claim back so the next run tries again.
        await this.prisma.task
          .updateMany({ where: { id: task.id }, data: { reminderSent: false } })
          .catch(() => undefined);
        this.logger.error(
          `Failed to send reminder for task ${task.id}: ${err.message}`,
        );
      }
    }
    return sent;
  }
}
