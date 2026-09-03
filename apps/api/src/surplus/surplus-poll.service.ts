import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SurplusIngestService } from './surplus-ingest.service';
import { SurplusPollCadence } from './surplus-source.types';

/**
 * Scheduled polls of the county surplus dockets.
 *
 * Two cadences, chosen per adapter:
 *
 *   daily   5:45am America/New_York, ahead of the foreclosure poll at 6:30 and
 *           the Daily Brief at 7:00, so a case that changed overnight is
 *           already classified by the time the brief queries it. Duval.
 *   weekly  Monday 4:30am, so it is done before the daily run starts. RealTDM
 *           counties, which asked in robots.txt not to be crawled and whose
 *           dockets do not move by the hour. Lee alone is a few hundred paced
 *           requests, so it wants the hour.
 *
 * Ingestion is idempotent on dedupeUid, so an overlapping run on a second
 * Railway replica during a deploy is harmless. The in-process guard is per
 * adapter: a slow weekly run must not stop the daily one from starting.
 */
@Injectable()
export class SurplusPollService {
  private readonly logger = new Logger(SurplusPollService.name);
  private readonly enabled: boolean;
  private running = new Set<string>();

  constructor(
    private config: ConfigService,
    private ingest: SurplusIngestService,
  ) {
    // Default on; set SURPLUS_POLL_ENABLED=false to disable in an env.
    this.enabled = (this.config.get<string>('SURPLUS_POLL_ENABLED') ?? 'true') !== 'false';
  }

  @Cron('45 5 * * *', { timeZone: 'America/New_York' })
  async pollDaily() {
    await this.run('daily');
  }

  @Cron('30 4 * * 1', { timeZone: 'America/New_York' })
  async pollWeekly() {
    await this.run('weekly');
  }

  private async run(cadence: SurplusPollCadence) {
    if (!this.enabled) return;
    for (const adapter of this.ingest.adapters()) {
      if (adapter.cadence !== cadence || this.running.has(adapter.key)) continue;
      this.running.add(adapter.key);
      try {
        const result = await this.ingest.ingestCounty(adapter.key, {
          organizationId: this.defaultOrgId(),
          trigger: 'cron',
        });
        this.logger.log(`Surplus poll ${adapter.key} done: ${JSON.stringify(result)}`);
      } catch (e: any) {
        this.logger.error(`Surplus poll ${adapter.key} failed: ${e.message}`);
      } finally {
        this.running.delete(adapter.key);
      }
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
