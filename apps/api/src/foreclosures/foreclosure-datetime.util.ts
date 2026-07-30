/**
 * Court dates carry a time of day that matters: "September 8, 2026 at 2:00PM".
 * The existing intake path parses YYYY-MM-DD only and drops it, which is fine
 * for a board that sorts by day but not for a hearing countdown.
 *
 * NC filings state wall-clock Eastern time and never name a zone or offset, so
 * the model is asked for the local date and local time separately and the
 * offset is resolved here rather than guessed by the model. Pure and
 * DST-correct: the offset is derived from the date itself, so 2:00 PM in
 * September (EDT, -04:00) and 2:00 PM in January (EST, -05:00) both land on
 * the right instant.
 */

const COURT_TIME_ZONE = 'America/New_York';

/** Offset in minutes that COURT_TIME_ZONE is behind UTC at the given instant. */
function zoneOffsetMinutes(instant: Date): number {
  // Format the instant as it reads in court-local time, re-read those wall
  // clock parts as if they were UTC, and the difference is the offset.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: COURT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Intl renders midnight as hour 24 in some ICU versions; normalize to 0.
  const hour = get('hour') % 24;
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return (instant.getTime() - asUtc) / 60000;
}

/**
 * Combine a court-local date and optional time into a UTC instant.
 *
 * `date` is YYYY-MM-DD, `time` is HH:MM on a 24-hour clock. A missing or
 * unparseable time is treated as midnight court-local, which keeps the day
 * correct for filings that state no hour. Returns null when the date itself is
 * missing or malformed - callers never guess a date.
 */
export function courtLocalToUtc(date?: string | null, time?: string | null): Date | null {
  const d = String(date || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!d) return null;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const t = String(time || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  const hour = t ? Number(t[1]) : 0;
  const minute = t ? Number(t[2]) : 0;
  if (hour > 23 || minute > 59) return null;

  // Treat the wall clock as UTC first, then correct by the offset in force at
  // roughly that instant. Resolving the offset twice settles the DST boundary:
  // the first guess can land on the wrong side of a transition.
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let utc = naive + zoneOffsetMinutes(new Date(naive)) * 60000;
  utc = naive + zoneOffsetMinutes(new Date(utc)) * 60000;

  const result = new Date(utc);
  return Number.isNaN(result.getTime()) ? null : result;
}

/**
 * Render a stored instant back as court-local "YYYY-MM-DDTHH:MM". Used by
 * tests and by anything that needs to show the hearing time as the notice
 * printed it, rather than in the server's zone.
 */
export function utcToCourtLocal(instant?: Date | null): string | null {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: COURT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const hour = String(Number(get('hour')) % 24).padStart(2, '0');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}
