import type { StepOutcome } from './campaign-execution.service';

type Counted = 'sent' | 'skipped' | 'retry' | 'completed' | 'removed' | 'failed';

/**
 * What one campaign cron run did, for a single summary line. Rate limited
 * emails in particular used to log a line each, every time a slot freed and
 * the whole backlog woke at once.
 */
export class CampaignRunTally {
  private readonly counts: Record<Counted, number> = {
    sent: 0, skipped: 0, retry: 0, completed: 0, removed: 0, failed: 0,
  };
  /** Deferred sends by reason, with the earliest time any of them retries. */
  private readonly deferred = new Map<string, { n: number; until: Date }>();

  count(what: Counted) {
    this.counts[what]++;
  }

  /** One executeStep result. Null means the enrollment had no step left. */
  add(outcome: StepOutcome | null) {
    if (!outcome) return this.count('completed');
    switch (outcome.kind) {
      case 'SENT':
        return this.count('sent');
      case 'SKIPPED':
        return this.count('skipped');
      case 'RETRY':
        return this.count('retry');
      case 'DEFERRED': {
        // Counts like 90/90 drift within a run; group on the words alone.
        const reason = outcome.reason.replace(/\s*\(.*\)\s*$/, '');
        const d = this.deferred.get(reason);
        if (!d) this.deferred.set(reason, { n: 1, until: outcome.retryAt });
        else {
          d.n++;
          if (outcome.retryAt < d.until) d.until = outcome.retryAt;
        }
      }
    }
  }

  /** The line to log, or null when this replica did nothing. */
  summary(): string | null {
    const parts: string[] = [];
    for (const k of ['sent', 'completed', 'skipped', 'retry', 'removed', 'failed'] as Counted[]) {
      if (this.counts[k]) parts.push(`${this.counts[k]} ${k}`);
    }
    for (const [reason, d] of this.deferred) {
      parts.push(`${d.n} deferred until ${d.until.toISOString()} (${reason})`);
    }
    return parts.length ? parts.join(', ') : null;
  }
}
