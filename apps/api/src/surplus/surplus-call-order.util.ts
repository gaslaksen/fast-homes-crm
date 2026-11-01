import { SurplusQueue, SURPLUS_QUEUE_RANK } from '@fast-homes/shared';

/**
 * What the course sort reads off a case or a property. The session's cases
 * and the board's rows both carry these under the same names.
 */
export interface CourseOrderFacts {
  shortWindow?: boolean | null;
  netToClaimant?: number | null;
  daysToCutoff?: number | null;
}

export interface CallOrderFacts extends CourseOrderFacts {
  queue?: string | null;
  workScore?: number | null;
}

/**
 * The course sort: short-window cases always on top, then the biggest
 * surplus, then the nearest cutoff. The call session has used it since the
 * rifle list; the board's "Call first" now reads the same rule, so the two
 * never show the same queue in two orders.
 */
export function courseOrder(a: CourseOrderFacts, b: CourseOrderFacts): number {
  if (!!a.shortWindow !== !!b.shortWindow) return a.shortWindow ? -1 : 1;
  if ((b.netToClaimant || 0) !== (a.netToClaimant || 0)) return (b.netToClaimant || 0) - (a.netToClaimant || 0);
  const ac = a.daysToCutoff ?? Number.MAX_SAFE_INTEGER;
  const bc = b.daysToCutoff ?? Number.MAX_SAFE_INTEGER;
  return ac - bc;
}

/**
 * The board's "Call first" order. The queue leads, so Call now rows come
 * before research when no chip narrows the board; inside a queue it is the
 * course sort. The work score only breaks what is left, so a task somebody
 * typed, or a pile of touches, never lifts a case over a short window.
 */
export function callOrder(a: CallOrderFacts, b: CallOrderFacts): number {
  const aq = SURPLUS_QUEUE_RANK[(a.queue || '') as SurplusQueue] ?? 0;
  const bq = SURPLUS_QUEUE_RANK[(b.queue || '') as SurplusQueue] ?? 0;
  if (aq !== bq) return bq - aq;
  return courseOrder(a, b) || (b.workScore || 0) - (a.workScore || 0);
}
