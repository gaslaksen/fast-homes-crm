import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SurplusIngestService } from './surplus-ingest.service';

/**
 * Daily poll of the county surplus dockets.
 *
 * Runs at 5:45am America/New_York, ahead of both the foreclosure poll at 6:30
 * and the Daily Brief at 7:00, so a surplus case that changed overnight is
 * already classified by the time the brief queries it. The two 5-minute crons
 * (campaign execution and reminders) are unaffected either way.
 *
 * Ingestion is idempotent on dedupeUid, so an overlapping run on a second
 * Railway replica during a deploy is harmless. The in-process guard just avoids
 * a slow run stacking on the next one.
 */
@Injectable()
export class SurplusPollService {
  private readonly logger = new Logger(SurplusPollService.name);
  private readonly enabled: boolean;
  private running = false;

  constructor(
    private config: ConfigService,
    private ingest: SurplusIngestService,
  ) {
    // Default on; set SURPLUS_POLL_ENABLED=false to disable in an env.
    this.enabled = (this.config.get<string>('SURPLUS_POLL_ENABLED') ?? 'true') !== 'false';
  }

  @Cron('45 5 * * *', { timeZone: 'America/New_York' })
  async pollCounties() {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      for (const adapter of this.ingest.adapters()) {
        const result = await this.ingest.ingestCounty(adapter.key, {
          organizationId: this.defaultOrgId(),
          trigger: 'cron',
        });
        this.logger.log(`Surplus poll ${adapter.key} done: ${JSON.stringify(result)}`);
      }
    } catch (e: any) {
      this.logger.error(`Surplus poll failed: ${e.message}`);
    } finally {
      this.running = false;
    }
  }

  /** Which org new surplus leads belong to (single-tenant default; optional env). */
  private defaultOrgId(): string | undefined {
    return (
      this.config.get<string>('SURPLUS_DEFAULT_ORG_ID') ||
      this.config.get<string>('FORECLOSURE_DEFAULT_ORG_ID') ||
      undefined
    );
  }
}
