import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ForeclosureIngestService } from './foreclosure-ingest.service';

/**
 * Daily 7am (America/New_York) poll of the Mecklenburg Times public-notice
 * feed. The paper typically publishes notices weekly, but a daily pull catches
 * off-cycle updates promptly. Replaces the old external Claude scheduled task.
 * Ingestion is fully idempotent (dedupe by noticeId / dedupeUid), so an
 * overlapping run on a second Railway replica during a deploy is harmless - the
 * duplicate notices are simply skipped. A short in-process guard avoids a run
 * stacking on top of a slow one.
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
    // Default on; set FORECLOSURE_RSS_POLL_ENABLED=false to disable in an env.
    this.enabled = (this.config.get<string>('FORECLOSURE_RSS_POLL_ENABLED') ?? 'true') !== 'false';
  }

  // 6:30, deliberately ahead of the 7:00 Daily Brief so overnight notices are
  // ingested before the brief queries them. See digest-cron.service.ts.
  @Cron('30 6 * * *', { timeZone: 'America/New_York' })
  async pollFeed() {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const result = await this.ingest.ingestRssFeed({ organizationId: this.defaultOrgId() });
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
