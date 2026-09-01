import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SurplusIngestService } from './surplus-ingest.service';
import { CronLockService } from '../common/cron-lock.service';

/**
 * Daily poll of the county surplus dockets.
 *
 * Runs at 5:45am America/New_York, ahead of both the foreclosure poll at 6:30
 * and the Daily Brief at 7:00, so a surplus case that changed overnight is
 * already classified by the time the brief queries it. The two 5-minute crons
 * (campaign execution and reminders) are unaffected either way.
 *
 * Ingestion is idempotent on dedupeUid, so an overlapping run is harmless to
 * the data. It was not harmless to the county: production runs more than one
 * replica and both fired every morning, so two runs hit Duval within twenty
 * milliseconds of each other and one of them timed out against the county's own
 * slow page, every day, leaving a failed run on the record that looked like a
 * broken feed. The advisory lock is cross-replica; the in-process `running`
 * flag stays as the cheap guard against a slow run stacking on the next one.
 */
@Injectable()
export class SurplusPollService {
  private readonly logger = new Logger(SurplusPollService.name);
  private readonly enabled: boolean;
  private running = false;

  constructor(
    private config: ConfigService,
    private ingest: SurplusIngestService,
    private lock: CronLockService,
  ) {
    // Default on; set SURPLUS_POLL_ENABLED=false to disable in an env.
    this.enabled = (this.config.get<string>('SURPLUS_POLL_ENABLED') ?? 'true') !== 'false';
  }

  @Cron('45 5 * * *', { timeZone: 'America/New_York' })
  async pollCounties() {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      await this.lock.run('surplus-poll', async () => {
        for (const adapter of this.ingest.adapters()) {
          const result = await this.ingest.ingestCounty(adapter.key, {
            organizationId: this.defaultOrgId(),
            trigger: 'cron',
          });
          this.logger.log(`Surplus poll ${adapter.key} done: ${JSON.stringify(result)}`);
        }
      });
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
