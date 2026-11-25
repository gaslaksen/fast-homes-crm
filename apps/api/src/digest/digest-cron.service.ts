import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../common/cron-lock.service';
import { MailerService } from '../mailer/mailer.service';
import { DigestService } from './digest.service';
import { DigestRenderService } from './digest-render.service';

/**
 * Sends the Dealcore Daily Brief at 7:00 AM ET, every day, when switched on.
 *
 * OFF by default since 2026-11-25 at the owner's request: the team found no
 * value in it. Only an explicit DAILY_BRIEF_ENABLED="true" brings the schedule
 * back. The preview and send-test endpoints still work on demand. While it is
 * off, missed county pulls show only in the surplus board's status menu, and
 * overdue tasks reach their owner through the 9 AM task reminder email.
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

  /** Whether the 7:00 AM schedule sends anything. */
  readonly enabled: boolean;

  constructor(
    config: ConfigService,
    private prisma: PrismaService,
    private digest: DigestService,
    private render: DigestRenderService,
    private mailer: MailerService,
    private lock: CronLockService,
  ) {
    // Default OFF. Only an explicit "true" starts the schedule.
    this.enabled = (config.get<string>('DAILY_BRIEF_ENABLED') ?? 'false') === 'true';
  }

  onModuleInit() {
    this.logger.log(
      this.enabled
        ? 'Daily Brief scheduled for 07:00 America/New_York, daily'
        : 'Daily Brief is off (DAILY_BRIEF_ENABLED is not "true")',
    );
  }

  @Cron('0 7 * * *', { timeZone: 'America/New_York' })
  async sendDailyBrief() {
    if (!this.enabled) return;
    const now = new Date();
    const dayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);

    if (this.lastSentDayKey === dayKey) {
      this.logger.warn(`Daily Brief already sent for ${dayKey}, skipping duplicate fire`);
      return;
    }
    this.lastSentDayKey = dayKey;

    // The day-key guard above is per PROCESS, and production runs more than one
    // replica: the surplus poll proves it by writing two run rows every morning.
    // Without a cross-replica lock each replica sends the brief, so every
    // recipient gets it twice. Duplicate work is wasteful elsewhere; here it
    // lands in somebody's inbox.
    const sent = await this.lock.run(`daily-brief-${dayKey}`, () => this.deliver(dayKey, now));
    if (sent === null) {
      this.logger.log(`Daily Brief for ${dayKey} is being sent by another replica`);
    }
  }

  /**
   * The actual send, split out so the whole thing can run under one lock.
   * `now` is passed in rather than re-read, so every org's brief in a single
   * run is stamped with the same instant.
   */
  private async deliver(dayKey: string, now: Date) {

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
        // Record what led today, so tomorrow's brief can say how long it has led.
        await this.prisma.digestRun.create({
          data: {
            organizationId: orgId,
            sentAt: now,
            bigThingKey: brief.bigThing?.key ?? null,
            metrics: Object.fromEntries(brief.scorecard.map((t) => [t.label, t.value])),
          },
        });
      } catch (err: any) {
        this.logger.error(`Daily Brief assembly failed for org ${orgId}: ${err?.message}`);
      }
    }

    this.logger.log(`Daily Brief run complete for ${dayKey}`);
  }
}
