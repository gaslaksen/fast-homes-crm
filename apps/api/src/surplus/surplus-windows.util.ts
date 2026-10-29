/**
 * The time rules from the list gathering rulebook that sit on top of the
 * workable window: when a file is running short, when a file that has had
 * everything thrown at it should be paused rather than worked on, and when a
 * person is due another touch.
 *
 * Every number here is a team choice rather than a law, so each one is a
 * named constant and nothing else hardcodes it.
 */

/**
 * The internal cutoff, in days off the notice. The team works to day 340 so
 * a claim found late still has time to be signed, notarized and filed before
 * day 365, which is the legal end (TRACE_MAX_AGE_DAYS) and stays as such.
 */
export const INTERNAL_CUTOFF_DAY = 340;

/** Under two months to the internal cutoff is a short window. */
export const SHORT_WINDOW_DAYS = 60;

/** Days of full effort with nobody reached before Dealcore offers to pause the file. */
export const PAUSE_AFTER_DAYS = 60;

/** How long a pause lasts by default: about six months, then the file comes back. */
export const PAUSE_FOR_DAYS = 182;

/** A person who can be tried is due another touch once this many days pass with none. */
export const TOUCH_EVERY_DAYS = 7;

/** The legal end of the workable window, in days off the notice. */
const LEGAL_END_DAY = 365;

const DAY = 86_400_000;

/**
 * Whether a case is in its short window: under two months to day 340, and
 * still inside the legal year. A case past day 340 but not yet 365 is short
 * too, with a negative count, because it can still be filed if it moves now.
 * Null when there is no notice or sale date to count from.
 */
export function shortWindow(
  noticeAge: number | null | undefined,
  daysSinceSale: number | null | undefined,
): { short: boolean; daysToCutoff: number | null } {
  const age = noticeAge ?? daysSinceSale;
  if (age === null || age === undefined) return { short: false, daysToCutoff: null };
  const daysToCutoff = INTERNAL_CUTOFF_DAY - age;
  return { short: daysToCutoff < SHORT_WINDOW_DAYS && age <= LEGAL_END_DAY, daysToCutoff };
}

/**
 * Whether to offer to pause the file, and since when it has been worked.
 *
 * Only for a claimant nobody has reached, with nothing signed, not already
 * on hold, where every channel the Unresponsive rule asks for has been
 * tried (`effortMissing` empty) and the first attempt is at least sixty days
 * old. That is the point where the rules say stop spending effort and come
 * back in six months, rather than mark it dead.
 */
export function pauseOffer(
  f: {
    stage?: string | null;
    tappedAt?: Date | string | null;
    heldAt?: Date | string | null;
    effortMissing?: string[] | null;
    firstEffortAt?: Date | string | null;
  },
  now = new Date(),
): { since: Date; days: number; until: Date } | null {
  if (f.heldAt || f.tappedAt) return null;
  if (f.stage && f.stage !== 'New' && f.stage !== 'Contacted') return null;
  if (!f.firstEffortAt || (f.effortMissing && f.effortMissing.length)) return null;
  const since = new Date(f.firstEffortAt);
  const days = Math.floor((now.getTime() - since.getTime()) / DAY);
  if (days < PAUSE_AFTER_DAYS) return null;
  return { since, days, until: pauseUntil(now) };
}

/** The default revisit date for a pause started now, as a calendar day at noon UTC. */
export function pauseUntil(now = new Date()): Date {
  const d = new Date(now.getTime() + PAUSE_FOR_DAYS * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
}

/**
 * Whether a person is due a touch today, and when they were last touched.
 * Due means they can be tried, nobody marked them done, the file is not on
 * hold, and either nothing has been tried or the newest try is a week old.
 */
export function touchDue(
  p: { reachable: boolean; done?: unknown; ticks: Record<string, { at: Date | string } | null | undefined> },
  held: boolean,
  now = new Date(),
): { due: boolean; lastAt: Date | null } {
  const times = Object.values(p.ticks)
    .filter(Boolean)
    .map((t) => new Date((t as { at: Date | string }).at).getTime());
  const lastAt = times.length ? new Date(Math.max(...times)) : null;
  if (!p.reachable || p.done || held) return { due: false, lastAt };
  return { due: !lastAt || now.getTime() - lastAt.getTime() >= TOUCH_EVERY_DAYS * DAY, lastAt };
}
