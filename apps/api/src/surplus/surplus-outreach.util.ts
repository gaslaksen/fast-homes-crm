import { SurplusQueue } from '@fast-homes/shared';
import { TRACE_MAX_AGE_DAYS } from './surplus-skiptrace.util';

/**
 * The outreach list: every person on a set of cases, in the order the team
 * works them, with what has been tried on each.
 *
 * Ian kept this as a separate checklist because the board shows claims, not
 * people, and nothing on it said "the daughter was texted Tuesday". These are
 * the pure parts, so the ordering and grouping can be tested without a DB.
 */

export type OutreachChannel = 'called' | 'texted' | 'emailed' | 'letter';
export const OUTREACH_TOUCH_KINDS = ['called', 'texted', 'emailed', 'note', 'done'] as const;
export type OutreachTouchKind = (typeof OUTREACH_TOUCH_KINDS)[number];

/** Who to try first, best first. The claimant, then the people who inherit, then anyone who may know where they are. */
export function outreachRank(p: {
  isClaimant?: boolean;
  role?: string | null;
  relationship?: string | null;
  deceased?: boolean | null;
  doNotCall?: boolean | null;
}): { rank: number; label: string } {
  // The dead and the do-not-call stay on the list so nobody adds them again,
  // but at the bottom and never as somebody to try.
  if (p.deceased) return { rank: 90, label: 'Deceased' };
  if (p.doNotCall) return { rank: 80, label: 'Do not contact' };
  // The county's contact on the case. Logged against, never tried.
  if (p.role === 'clerk') return { rank: 70, label: 'County clerk' };
  if (p.isClaimant) return { rank: 0, label: 'Claimant' };
  const rel = String(p.relationship || '').toLowerCase();
  if (/spouse|wife|husband/.test(rel)) return { rank: 1, label: 'Spouse' };
  if (/\b(son|daughter|child|children)\b/.test(rel)) return { rank: 2, label: 'Child' };
  if (p.role === 'heir') return { rank: 3, label: 'Heir' };
  if (/brother|sister|sibling/.test(rel)) return { rank: 4, label: 'Sibling' };
  if (/mother|father|parent/.test(rel)) return { rank: 4, label: 'Parent' };
  // The role decides for people outside the family, whatever the free text
  // relationship says ("Neighbor", "Coworker").
  if (p.role === 'neighbor') return { rank: 6, label: 'Neighbor' };
  if (p.role === 'friend' || p.role === 'associate') return { rank: 7, label: p.role === 'friend' ? 'Friend' : 'Associate' };
  return { rank: 5, label: 'Relative' };
}

/**
 * Days left before the case is past a year off the notice, the point where
 * only an attorney can ask for the money. The sale stands in where no notice
 * has been read, the same fallback the board's age bands use.
 */
export function daysLeftToWork(noticeAge: number | null | undefined, daysSinceSale: number | null | undefined): number | null {
  const age = noticeAge ?? daysSinceSale;
  return age === null || age === undefined ? null : TRACE_MAX_AGE_DAYS - age;
}

export type OutreachGroup = 'past' | 'soon' | 'month' | 'later' | 'undated' | 'no_path' | 'hold';

export const OUTREACH_GROUP_LABEL: Record<OutreachGroup, string> = {
  past: 'Past a year',
  soon: 'Within 30 days',
  month: '31 to 90 days',
  later: 'More than 90 days',
  undated: 'No notice date',
  no_path: 'No way to reach anyone yet',
  hold: 'On hold',
};

export const OUTREACH_GROUP_ORDER: OutreachGroup[] = ['soon', 'month', 'later', 'undated', 'past', 'no_path', 'hold'];

/** Which band a case sits in. Hold and no contact path come before the clock, so they sink to the bottom whatever the date. */
export function outreachGroup(c: { queue?: string | null; daysLeft: number | null; reachable: boolean }): OutreachGroup {
  if (c.queue === SurplusQueue.HOLD) return 'hold';
  if (!c.reachable) return 'no_path';
  if (c.daysLeft === null) return 'undated';
  if (c.daysLeft < 0) return 'past';
  if (c.daysLeft <= 30) return 'soon';
  if (c.daysLeft <= 90) return 'month';
  return 'later';
}

/** A person can be tried at all: alive, not do-not-contact, and with a working number, an email or somewhere to write. */
export function personReachable(p: {
  deceased?: boolean | null;
  doNotCall?: boolean | null;
  phones: { dnc?: string | null; bad?: boolean }[];
  emails: string[];
  address: string | null;
  mailReturned?: boolean;
}): boolean {
  if (p.deceased || p.doNotCall) return false;
  if (p.phones.some((x) => !x.dnc && !x.bad)) return true;
  if (p.emails.length) return true;
  return !!p.address && !p.mailReturned;
}

/** Key for "this person on this case" in the tick maps. The claimant has no heirId. */
export function personKey(leadId: string, heirId: string | null | undefined): string {
  return `${leadId}:${heirId || ''}`;
}

export interface OutreachTick {
  at: Date;
  /** 'dealcore' when Dealcore sent it, 'logged' when somebody marked one made elsewhere. */
  via: 'dealcore' | 'logged';
}

/** The newer of two ticks, so the list shows the last time each channel was tried. */
export function newerTick(a: OutreachTick | undefined, b: OutreachTick | undefined): OutreachTick | undefined {
  if (!a) return b;
  if (!b) return a;
  return new Date(b.at).getTime() > new Date(a.at).getTime() ? b : a;
}
