import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private config: ConfigService,
  ) {}

  @Cron('*/5 * * * *')
  async processReminders() {
    const now = new Date();

    const dueTasks = await this.prisma.task.findMany({
      where: {
        dueDate: { lte: now },
        completed: false,
        reminderSent: false,
      },
      include: {
        lead: true,
        user: true,
      },
    });

    if (dueTasks.length === 0) return;

    this.logger.log(`Processing ${dueTasks.length} due reminder(s)`);

    for (const task of dueTasks) {
      const email = task.user?.email;
      if (!email) {
        this.logger.warn(
          `Task ${task.id} has no user email — skipping reminder`,
        );
        await this.prisma.task.update({
          where: { id: task.id },
          data: { reminderSent: true },
        });
        continue;
      }

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
          <p style="color: #9ca3af; font-size: 12px;">Deal Core &mdash; Follow-up reminder</p>
        </div>
      `;

      try {
        await this.mailer.sendDealPackage(
          email,
          `Reminder: ${task.title}`,
          html,
        );
        await this.prisma.task.update({
          where: { id: task.id },
          data: { reminderSent: true },
        });
        this.logger.log(
          `Sent reminder for task ${task.id} to ${email}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to send reminder for task ${task.id}: ${err.message}`,
        );
      }
    }
  }
}
