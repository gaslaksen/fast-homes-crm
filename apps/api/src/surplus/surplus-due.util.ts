import { courtLocalToUtc } from '../foreclosures/foreclosure-datetime.util';

/** The hour, Eastern, that an auto-created task with no set time comes due. */
export const TASK_DUE_HOUR_EASTERN = 9;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 9:00 AM Eastern, `days` calendar days after today in Eastern.
 *
 * Auto-created tasks used to take `setHours(9)` on the server's clock, and
 * Railway runs in UTC, so they came due at 9:00 UTC: 4:00 AM Eastern in
 * winter, 5:00 AM in summer. The reminder email went out then, and the
 * dashboard showed "4:00 AM". After 7 PM Eastern the UTC date is already
 * tomorrow, so such a task also landed a day later than meant.
 *
 * DST-correct: the offset comes from the target date, so 9 AM is 14:00 UTC in
 * January and 13:00 UTC in July.
 */
export function easternMorning(days: number, now: Date = new Date()): Date {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  // Step on the calendar, not by 24 hour blocks, so a DST change in between
  // cannot move the day. Noon UTC keeps the arithmetic clear of midnight.
  const target = new Date(Date.parse(`${today}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
  const hh = String(TASK_DUE_HOUR_EASTERN).padStart(2, '0');
  return courtLocalToUtc(target, `${hh}:00`) as Date;
}
