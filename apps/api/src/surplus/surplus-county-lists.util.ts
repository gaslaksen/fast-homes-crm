/**
 * The county list tracker: the rules keep a log per county of where its
 * surplus list comes from, how often the county puts out a new one, when it
 * was last asked for and when to ask again. Counties with an automated feed
 * mostly look after themselves; the rest are only as fresh as the last time
 * somebody asked, which is why the next request date lands in the Daily
 * Brief as UPDATE DUE.
 *
 * Every date here is a calendar day stored at noon UTC (see
 * `calendarDayToDate`), and "today" is the Eastern calendar day the team
 * works in.
 */

export const LIST_SOURCES = ['online', 'email', 'records_request', 'paid'] as const;

export const LIST_SOURCE_LABEL: Record<string, string> = {
  online: 'online',
  email: 'by email',
  records_request: 'by open records request',
  paid: 'paid',
};

const EVERY_LABEL: Record<number, string> = {
  7: 'weekly',
  14: 'every two weeks',
  30: 'monthly',
  90: 'quarterly',
  182: 'twice a year',
  365: 'yearly',
};

/** "monthly", "every 45 days", or null when the county's cadence is not known. */
export function everyLabel(days?: number | null): string | null {
  if (!days) return null;
  return EVERY_LABEL[days] || `every ${days} days`;
}

const DAY = 86_400_000;

/** Today as the Eastern calendar day, stored the way the tracker stores dates. */
export function todayNoonUtc(now = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** A stored calendar day plus whole days, still at noon UTC. */
export function addDays(day: Date, days: number): Date {
  return new Date(day.getTime() + days * DAY);
}

/**
 * Whether the county's list is due to be asked for, and how many days off
 * that is: negative once it is late, 0 on the day. Null days when no next
 * request date is set, which is never due.
 */
export function listDue(next: Date | null | undefined, now = new Date()): { due: boolean; days: number | null } {
  if (!next) return { due: false, days: null };
  const days = Math.round((new Date(next).getTime() - todayNoonUtc(now).getTime()) / DAY);
  return { due: days <= 0, days };
}
