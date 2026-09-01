import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ForeclosureIngestService } from './foreclosure-ingest.service';

/**
 * Poll of the Mecklenburg Times public-notice feed.
 *
 * OFF by default as of 2026-09-01, at the team's request. The scraper and the
 * Refresh feed button are untouched and still work on demand; only the 6:30am
 * schedule is switched off, so nothing pulls the paper unless somebody asks it
 * to. Set FORECLOSURE_RSS_POLL_ENABLED=true to bring the schedule back.
 *
 * The default is in code rather than left to an unset Railway variable because
 * "off" should survive somebody recreating the environment. An env var that has
 * to be present to keep a job disabled is a job that quietly restarts itself.
 *
 * Note for whoever turns it back on: 6:30 was chosen to sit ahead of the 7:00
 * Daily Brief so overnight notices are ingested before the brief queries them,
 * and the surplus poll at 5:45 sits ahead of both. Moving any one of the three
 * without the others reorders that chain.
 *
 * Ingestion is idempotent (dedupe by noticeId / dedupeUid), so an overlapping
 * run is harmless: duplicate notices are simply skipped.
 */
@Injectable()
export class ForeclosurePollService {
  private readonly logger = new Logger(ForeclosurePollService.name);
  private readonly enabled: boolean;
  private running = false;

  constructor(
    private config: ConfigService,
    private ingest: ForeclosureIngestService,
  ) {
    // Default OFF. Only an explicit "true" starts the schedule.
    this.enabled = (this.config.get<string>('FORECLOSURE_RSS_POLL_ENABLED') ?? 'false') === 'true';
  }

  /** Whether the schedule is live, so the board can say so instead of warning. */
  get scheduleEnabled(): boolean {
    return this.enabled;
  }

  @Cron('30 6 * * *', { timeZone: 'America/New_York' })
  async pollFeed() {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const result = await this.ingest.ingestRssFeed({
        organizationId: this.defaultOrgId(),
        trigger: 'cron',
      });
      this.logger.log(`Foreclosure poll done: ${JSON.stringify(result)}`);
    } catch (e: any) {
      this.logger.error(`Foreclosure poll failed: ${e.message}`);
    } finally {
      this.running = false;
    }
  }

  /** Which org new feed leads belong to (single-tenant default; optional env). */
  private defaultOrgId(): string | undefined {
    return this.config.get<string>('FORECLOSURE_DEFAULT_ORG_ID') || undefined;
  }
}
