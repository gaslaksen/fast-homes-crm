import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SurplusIngestService } from './surplus-ingest.service';
import { SurplusPollCadence } from './surplus-source.types';
import { CronLockService } from '../common/cron-lock.service';

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
 * Ingestion is idempotent on dedupeUid, so an overlapping run is harmless to
 * the data. It was not harmless to the county: production runs more than one
 * replica and both fired every morning, so two runs hit Duval within twenty
 * milliseconds of each other and one of them timed out against the county's own
 * slow page, every day, leaving a failed run on the record that looked like a
 * broken feed. The advisory lock is cross-replica and held per cadence, so the
 * weekly run never blocks the daily one. The in-process guard is per adapter
 * and is the cheap check against a slow run stacking on the next one.
 */
@Injectable()
export class SurplusPollService {
  private readonly logger = new Logger(SurplusPollService.name);
  private readonly enabled: boolean;
  private running = new Set<string>();

  constructor(
    private config: ConfigService,
    private ingest: SurplusIngestService,
    private lock: CronLockService,
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
    const adapters = this.ingest
      .adapters()
      .filter((a) => a.cadence === cadence && !this.running.has(a.key));
    if (!adapters.length) return;

    try {
      await this.lock.run(`surplus-poll-${cadence}`, async () => {
        for (const adapter of adapters) {
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
      });
    } catch (e: any) {
      this.logger.error(`Surplus ${cadence} poll failed: ${e.message}`);
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
