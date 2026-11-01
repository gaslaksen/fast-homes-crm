import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SurplusClaimStatus, SurplusDeadReason, SurplusStage } from '@fast-homes/shared';
import { SurplusService } from './surplus.service';
import { SURPLUS_FLOOR } from './surplus-compliance';
import { isSignedStage } from './surplus-progress.util';

/** One case on the prune list, enough to decide without opening it. */
export interface PruneRow {
  id: string;
  claimant: string;
  county: string | null;
  caseNumber: string | null;
  address: string | null;
  grossSurplus: number;
  stage: string | null;
  queueLabel: string;
  ownerName: string | null;
  lastTouchedAt: Date | null;
  daysToCutoff: number | null;
  /** Full effort: when the effort began and how many days ago. */
  effortDays: number | null;
  claimStatus: string | null;
}

export type PruneBucketKey = 'fullEffort' | 'pastCutoff' | 'belowFloor' | 'docketClosed';

export interface PruneBucket {
  key: PruneBucketKey;
  label: string;
  /** Why these cases are here, in a sentence. */
  why: string;
  /** What the course says to do with them. */
  action: { kind: 'pause'; until: Date } | { kind: 'close'; deadReason: SurplusDeadReason; note: string };
  rows: PruneRow[];
}

export interface PruneList {
  floor: number;
  cutoffDay: number;
  buckets: PruneBucket[];
  total: number;
}

const PAGE = 200;
const MAX_PAGES = 50;

/**
 * The weekly prune: the four kinds of case the course says to stop working,
 * read off the board's own rows so the list can never disagree with it.
 *
 * - Full effort: sixty days of every channel tried and nobody reached. The
 *   rule says pause for six months, not mark dead.
 * - Past the cutoff: the day-340 internal cutoff has gone by, so there is no
 *   longer time to sign, notarise and file before the clerk's deadline.
 * - Below the floor: the surplus was revised below the floor after it
 *   landed, so the case is hidden from the board but still open.
 * - Closed by the docket: assigned or paid out on the county's docket while
 *   the stage still says New or Contacted (the pull now retires these, so
 *   this bucket holds what landed before it did).
 *
 * Each bucket carries one action. Nothing here writes: the board's bulk
 * stage and the hold endpoint do, so the gates and the timeline stay the
 * same whichever screen did it.
 */
@Injectable()
export class SurplusPruneService {
  private readonly logger = new Logger(SurplusPruneService.name);

  constructor(private surplus: SurplusService) {}

  async list(organizationId?: string | null, now = new Date()): Promise<PruneList> {
    const rows = await this.allRows(organizationId);
    const until = new Date(now.getTime());
    until.setMonth(until.getMonth() + 6);
    until.setUTCHours(12, 0, 0, 0);

    const fullEffort: PruneRow[] = [];
    const pastCutoff: PruneRow[] = [];
    const belowFloor: PruneRow[] = [];
    const docketClosed: PruneRow[] = [];

    for (const r of rows) {
      if (r.stage === SurplusStage.DEAD || isSignedStage(r.stage) || r.heldAt) continue;
      const row = this.rowOf(r);
      const status = String(r.claimStatus || '');
      if (status === SurplusClaimStatus.ASSIGNED || status === SurplusClaimStatus.DISTRIBUTED) {
        docketClosed.push(row);
      } else if ((r.grossSurplus || 0) < SURPLUS_FLOOR) {
        belowFloor.push(row);
      } else if (r.daysToCutoff != null && r.daysToCutoff <= 0) {
        pastCutoff.push(row);
      } else if (r.pauseOffer) {
        fullEffort.push(row);
      }
    }
    const bySize = (a: PruneRow, b: PruneRow) => (b.grossSurplus || 0) - (a.grossSurplus || 0);

    const buckets: PruneBucket[] = [
      {
        key: 'fullEffort',
        label: 'Sixty days of full effort',
        why: 'Every channel tried for sixty days and nobody reached. The course says pause for six months and come back, not mark dead.',
        action: { kind: 'pause', until },
        rows: fullEffort.sort(bySize),
      },
      {
        key: 'pastCutoff',
        label: 'Past the cutoff',
        why: 'The day-340 cutoff has gone by, so there is no longer time to sign, notarise and file before the clerk\'s deadline.',
        action: { kind: 'close', deadReason: SurplusDeadReason.PAST_CUTOFF, note: 'Past the day-340 cutoff on the weekly prune.' },
        rows: pastCutoff.sort(bySize),
      },
      {
        key: 'belowFloor',
        label: 'Below the floor',
        why: `The surplus was revised below $${SURPLUS_FLOOR.toLocaleString('en-US')} after the case landed. Hidden from the board, still open.`,
        action: { kind: 'close', deadReason: SurplusDeadReason.BELOW_FLOOR, note: 'Below the floor on the weekly prune.' },
        rows: belowFloor.sort(bySize),
      },
      {
        key: 'docketClosed',
        label: 'Closed by the docket',
        why: 'The county says the money is assigned or paid out, and the stage still says the case is open.',
        action: { kind: 'close', deadReason: SurplusDeadReason.PAID_OUT, note: 'Assigned or paid out on the docket, closed on the weekly prune.' },
        rows: docketClosed.sort(bySize),
      },
    ];
    return {
      floor: SURPLUS_FLOOR,
      cutoffDay: 340,
      buckets,
      total: buckets.reduce((n, b) => n + b.rows.length, 0),
    };
  }

  /** The one line the Daily Brief carries, or null when nothing is waiting. */
  async briefLine(organizationId?: string | null): Promise<{ total: number; line: string } | null> {
    try {
      const list = await this.list(organizationId);
      if (!list.total) return null;
      const parts = list.buckets
        .filter((b) => b.rows.length)
        .map((b) => `${b.rows.length} ${b.label.toLowerCase()}`);
      return {
        total: list.total,
        line: `${list.total} case${list.total === 1 ? '' : 's'} waiting on the weekly prune: ${parts.join(', ')}.`,
      };
    } catch (err: any) {
      this.logger.warn(`Prune line skipped: ${err?.message || err}`);
      return null;
    }
  }

  /** Pause several cases at once with one reason and one revisit date. */
  async bulkHold(
    ids: string[],
    hold: { reason?: string | null; until?: string | null },
    organizationId?: string | null,
    userId?: string | null,
  ): Promise<{ updated: number; failed: { id: string; message: string }[] }> {
    if (!Array.isArray(ids) || !ids.length) throw new BadRequestException('Pick at least one case.');
    if (!String(hold.reason || '').trim()) throw new BadRequestException('Say why the files are paused.');
    let updated = 0;
    const failed: { id: string; message: string }[] = [];
    for (const id of ids) {
      try {
        await this.surplus.setHold(id, { on: true, reason: hold.reason, until: hold.until || null }, organizationId, userId);
        updated += 1;
      } catch (err: any) {
        failed.push({ id, message: err?.message || 'could not be paused' });
      }
    }
    return { updated, failed };
  }

  private async allRows(organizationId?: string | null): Promise<any[]> {
    const rows: any[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res: any = await this.surplus.list({
        organizationId: organizationId || undefined,
        group: 'lead',
        pageSize: PAGE,
        page,
        hideDead: true,
        includeBelowFloor: true,
      } as any);
      rows.push(...(res.data || []));
      if (page * res.pageSize >= res.total) break;
    }
    return rows;
  }

  private rowOf(r: any): PruneRow {
    return {
      id: r.id,
      claimant: r.claimant,
      county: r.county || null,
      caseNumber: r.caseNumber || null,
      address: r.address || null,
      grossSurplus: r.grossSurplus || 0,
      stage: r.stage || null,
      queueLabel: r.queueLabel,
      ownerName: r.ownerName || null,
      lastTouchedAt: r.lastTouchedAt || null,
      daysToCutoff: r.daysToCutoff ?? null,
      effortDays: r.pauseOffer?.days ?? null,
      claimStatus: r.claimStatus || null,
    };
  }
}
