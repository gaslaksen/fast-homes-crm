/**
 * What the automated county pulls did, in one line each, for the Daily Brief.
 *
 * Pure so it can be pinned with fixtures. The runs come from SurplusPollRun;
 * the schedule comes from each adapter's cadence. The one rule that matters:
 * silence is never reported as success. A feed that should have run and did
 * not gets a red line, because "nothing new" and "the pull never happened"
 * look identical on the board.
 */

import { DigestUrgency } from './digest.types';

export interface FeedSource {
  key: string;
  county: string;
  cadence: 'daily' | 'weekly';
}

export interface FeedRun {
  source: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  ok: boolean;
  scanned: number;
  created: number;
  updated: number;
  dead: number;
  errors: number;
  message: string | null;
}

export interface FeedRow {
  /** "Lee County" */
  label: string;
  /** "weekly, Monday 4:30am" */
  schedule: string;
  /** What happened, one line. */
  detail: string;
  urgency: DigestUrgency;
}

const TZ = 'America/New_York';
/** A run older than this is yesterday's, not this morning's. */
const TODAY_WINDOW_MS = 20 * 60 * 60 * 1000;
/** A run still open after this long did not hang, it died. */
const STUCK_AFTER_MS = 2 * 60 * 60 * 1000;

function weekdayInTz(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d);
}

function timeInTz(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
    .format(d)
    .toLowerCase()
    .replace(' ', '');
}

function shortDateInTz(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'numeric', day: 'numeric' })
    .format(d)
    .replace(',', '');
}

function n(v: number): string {
  return v.toLocaleString('en-US');
}

/** The counts a finished run reports, as the reader wants them. */
export function describeCounts(run: FeedRun): string {
  const unchanged = Number((/(\d+) unchanged/.exec(run.message || '') || [])[1] || 0);
  const retiredFromList = Number((/(\d+) retired from the list/.exec(run.message || '') || [])[1] || 0);
  const retired = run.dead + retiredFromList;
  const bits = [
    `${n(run.scanned)} scanned`,
    `${n(run.created)} new`,
    run.updated ? `${n(run.updated)} updated` : null,
    retired ? `${n(retired)} retired` : null,
    unchanged ? `${n(unchanged)} unchanged` : null,
    run.errors ? `${n(run.errors)} error${run.errors === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return bits.join(' · ');
}

function duration(run: FeedRun): string | null {
  if (!run.finishedAt) return null;
  const mins = Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 60000);
  return mins < 1 ? 'under a minute' : `${mins} min`;
}

export function scheduleLabel(source: FeedSource): string {
  return source.cadence === 'daily' ? 'daily, 5:45am ET' : 'weekly, Monday 4:30am ET';
}

/**
 * One line for one source.
 *
 * Reads the most recent run for the source. A run inside the last 20 hours is
 * "this morning's"; anything older means this morning's did not happen, which
 * is only a problem on a day the schedule says it should have.
 */
export function describeFeed(source: FeedSource, runs: FeedRun[], now: Date): FeedRow {
  const label = `${source.county} County`;
  const schedule = scheduleLabel(source);
  const mine = runs
    .filter((r) => r.source === source.key)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const latest = mine[0];
  const dueToday = source.cadence === 'daily' || weekdayInTz(now) === 'Mon';

  if (latest && now.getTime() - latest.startedAt.getTime() <= TODAY_WINDOW_MS) {
    const at = timeInTz(latest.startedAt);
    if (!latest.finishedAt) {
      const age = now.getTime() - latest.startedAt.getTime();
      return age < STUCK_AFTER_MS
        ? { label, schedule, urgency: 'warn', detail: `Started ${at} and is still running.` }
        : { label, schedule, urgency: 'critical', detail: `Started ${at} and never finished. Check the Railway log.` };
    }
    if (!latest.ok || latest.errors > 0) {
      return {
        label, schedule, urgency: 'critical',
        detail: `Ran ${at} with problems: ${describeCounts(latest)}.${latest.message ? ` ${latest.message}` : ''}`,
      };
    }
    const dur = duration(latest);
    return {
      label, schedule,
      urgency: latest.created ? 'good' : 'neutral',
      detail: `Ran ${at}${dur ? ` in ${dur}` : ''}: ${describeCounts(latest)}.`,
    };
  }

  if (dueToday) {
    return {
      label, schedule, urgency: 'critical',
      detail: latest
        ? `Did not run this morning. Last ran ${shortDateInTz(latest.startedAt)} at ${timeInTz(latest.startedAt)}.`
        : 'Did not run this morning, and has never run.',
    };
  }

  if (!latest) {
    return { label, schedule, urgency: 'warn', detail: 'Has not run yet.' };
  }

  const stale = now.getTime() - latest.startedAt.getTime() > 8 * 24 * 60 * 60 * 1000;
  return {
    label, schedule,
    urgency: stale ? 'critical' : 'neutral',
    detail: `${stale ? 'Overdue. ' : ''}Last ran ${shortDateInTz(latest.startedAt)}: ${describeCounts(latest)}.`,
  };
}
