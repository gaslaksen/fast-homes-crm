import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SurplusIngestService } from './surplus-ingest.service';
import { SurplusSkiptraceService, SurplusTraceResult } from './surplus-skiptrace.service';
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
 *
 * Each county's pull is followed by the skip trace waterfall on the leads it
 * just created, and only those: BatchData on the address first, then the
 * Endato name search on whoever that could not place. Leads an earlier run
 * already tried are never re-bought here; a deliberate re-trace is the manual
 * call with `includeTraced`. The trace's outcome is appended to the run row so
 * the health strip and the Daily Brief can show it. SURPLUS_AUTO_TRACE=false
 * turns the trace off and leaves the pull alone.
 */
@Injectable()
export class SurplusPollService {
  private readonly logger = new Logger(SurplusPollService.name);
  private readonly enabled: boolean;
  private readonly autoTrace: boolean;
  private running = new Set<string>();

  constructor(
    private config: ConfigService,
    private ingest: SurplusIngestService,
    private lock: CronLockService,
    private skiptrace: SurplusSkiptraceService,
  ) {
    // Default on; set SURPLUS_POLL_ENABLED=false to disable in an env.
    this.enabled = (this.config.get<string>('SURPLUS_POLL_ENABLED') ?? 'true') !== 'false';
    this.autoTrace = (this.config.get<string>('SURPLUS_AUTO_TRACE') ?? 'true') !== 'false';
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
            const organizationId = this.defaultOrgId();
            const { createdLeadIds, ...result } = await this.ingest.ingestCounty(adapter.key, {
              organizationId,
              trigger: 'cron',
            });
            this.logger.log(`Surplus poll ${adapter.key} done: ${JSON.stringify(result)}`);
            await this.traceNew(adapter.key, result.runId, createdLeadIds, organizationId);
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

  /**
   * The waterfall on what one pull just created. Never throws: the pull has
   * already succeeded and its row says so, and a vendor outage on the trace is
   * the trace's problem, written on the run for the morning brief to show.
   */
  private async traceNew(
    source: string,
    runId: string,
    leadIds: string[],
    organizationId: string | undefined,
  ): Promise<SurplusTraceResult | null> {
    if (!this.autoTrace || !leadIds.length) return null;
    try {
      const trace = await this.skiptrace.traceLeads({
        organizationId: organizationId || null,
        leadIds,
        nameSearch: true,
        addressSearch: true,
      });
      const note = describeTrace(leadIds.length, trace);
      this.logger.log(`Surplus trace ${source}: ${note}`);
      await this.ingest.noteRun(runId, note);
      return trace;
    } catch (e: any) {
      this.logger.error(`Surplus trace ${source} failed: ${e.message}`);
      await this.ingest
        .noteRun(runId, `Trace failed on the ${leadIds.length} new: ${e.message}`)
        .catch(() => undefined);
      return null;
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

/**
 * One sentence on what the trace did, in the form the Daily Brief parses
 * (`describeCounts` reads the "X of Y new" pair). Keep the shape if you
 * reword it.
 */
export function describeTrace(newLeads: number, t: SurplusTraceResult): string {
  if (t.message && !t.submitted && !t.nameSearch.searched) {
    return `Trace skipped on the ${newLeads} new: ${t.message}`;
  }
  const bits = [
    `${t.submitted} address lookup${t.submitted === 1 ? '' : 's'}`,
    `${t.nameSearch.searched} name search${t.nameSearch.searched === 1 ? '' : 'es'}`,
    t.errors ? `${t.errors} error${t.errors === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return `Traced ${t.contacted} of ${newLeads} new to a number (${bits.join(', ')})`;
}
