import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { DigestService } from './digest.service';
import { DigestRenderService } from './digest-render.service';

/**
 * Sends the Dealcore Daily Brief at 7:00 AM ET, every day.
 *
 * The brief is assembled ONCE per organization and then rendered per recipient,
 * so a three-person team costs one round of queries and one news summarization
 * rather than three. Only the greeting differs per user today; if the brief ever
 * becomes per-user (assignedToUserId filtering), this is where it splits.
 *
 * The foreclosure poll deliberately runs at 6:30 so overnight notices are
 * already ingested by the time this fires. See foreclosure-poll.service.ts.
 */
@Injectable()
export class DigestCronService implements OnModuleInit {
  private readonly logger = new Logger(DigestCronService.name);

  /**
   * Guards against a double fire inside one process. It does NOT survive a
   * restart, and it does NOT coordinate across replicas - if the API is ever
   * scaled past one instance, this needs to become a row in the database.
   * Every other cron in this app carries the same assumption.
   */
  private lastSentDayKey: string | null = null;

  constructor(
    private prisma: PrismaService,
    private digest: DigestService,
    private render: DigestRenderService,
    private mailer: MailerService,
  ) {}

  onModuleInit() {
    this.logger.log('Daily Brief scheduled for 07:00 America/New_York, daily');
  }

  @Cron('0 7 * * *', { timeZone: 'America/New_York' })
  async sendDailyBrief() {
    const now = new Date();
    const dayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);

    if (this.lastSentDayKey === dayKey) {
      this.logger.warn(`Daily Brief already sent for ${dayKey}, skipping duplicate fire`);
      return;
    }
    this.lastSentDayKey = dayKey;

    this.logger.log(`Daily Brief run starting for ${dayKey}`);

    const recipients = await this.prisma.user.findMany({
      // Everyone in an org, gated only by the opt-out flag. Filtering on role
      // here would silently drop a teammate whose role happens to be VIEWER,
      // and a missing recipient is invisible until someone complains.
      where: { digestEnabled: true, organizationId: { not: null } },
      select: { id: true, email: true, firstName: true, organizationId: true },
    });

    if (!recipients.length) {
      this.logger.log('No digest recipients, nothing to send');
      return;
    }

    // Group by org so the expensive assembly happens once per organization.
    const byOrg = new Map<string, typeof recipients>();
    for (const u of recipients) {
      const key = u.organizationId as string;
      if (!byOrg.has(key)) byOrg.set(key, []);
      byOrg.get(key)!.push(u);
    }

    for (const [orgId, users] of byOrg) {
      try {
        const brief = await this.digest.build({ organizationId: orgId, now });

        if (brief.isEmpty) {
          this.logger.log(`Org ${orgId}: brief is empty, skipping send`);
          continue;
        }

        const html = this.render.renderHtml(brief);
        const text = this.render.renderText(brief);

        for (const user of users) {
          if (!user.email) continue;
          try {
            // Re-render only when the greeting actually changes the output.
            const personal = user.firstName
              ? { ...brief, greetingName: user.firstName }
              : brief;
            await this.mailer.sendInternalHtml({
              to: user.email,
              subject: brief.subject,
              html: user.firstName ? this.render.renderHtml(personal) : html,
              text: user.firstName ? this.render.renderText(personal) : text,
              tags: ['daily-digest'],
            });
            this.logger.log(`Daily Brief sent to ${user.email}`);
          } catch (err: any) {
            // One bad address must not stop the rest of the team's send.
            this.logger.error(`Daily Brief to ${user.email} failed: ${err?.message}`);
          }
        }
      } catch (err: any) {
        this.logger.error(`Daily Brief assembly failed for org ${orgId}: ${err?.message}`);
      }
    }

    this.logger.log(`Daily Brief run complete for ${dayKey}`);
  }
}
