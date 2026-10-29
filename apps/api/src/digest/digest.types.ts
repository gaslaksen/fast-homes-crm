/**
 * Shape of an assembled Daily Brief. `DigestService` builds this from the live
 * pipeline; `DigestRenderService` turns it into HTML and plain text. Nothing in
 * here touches Prisma, so the render step is pure and testable against a
 * hand-written fixture.
 *
 * The brief is a surplus funds action email. Every section answers "who do I
 * call or chase today" on the surplus board; wholesaling gets one line of
 * counts at the bottom so it is not forgotten, and nothing more.
 *
 * Every section is allowed to be empty. The renderer drops empty sections
 * (divider included) rather than printing a "nothing here" placeholder, and
 * `isEmpty` tells the cron to skip the send entirely on a genuinely quiet day.
 */

/** Urgency band. Drives the accent color on tiles, rails, and cards. */
export type DigestUrgency = 'critical' | 'warn' | 'neutral' | 'good';

export interface BigThing {
  /**
   * Stable identity of whatever this story is about, e.g.
   * "surplus-person:brevard|douglas garcia". Persisted to DigestRun so the
   * brief can say how many mornings in a row it has led with the same one.
   */
  key: string;
  /** One-sentence headline. Doubles as the email preheader. */
  headline: string;
  /** Short form for the subject line, "Call Douglas Garcia ($16.4K, 2 cases)". */
  short: string;
  /** Supporting facts, one per line: each case, the claim status, the numbers. */
  lines: string[];
  /** A warning that must be read before acting, e.g. an unconfirmed match. */
  flag: string | null;
  /** "Led yesterday's brief too and still has not been called." */
  repeatNote: string | null;
  ctaLabel: string;
  ctaUrl: string;
  /** Optional tel: link when the record has a usable phone. */
  phone?: string | null;
}

export interface BoardTile {
  label: string;
  /** Preformatted for display, e.g. "63" or "$71.5K". */
  value: string;
  /** Small line under the number. Carries the movement, not the absolute. */
  subtext: string;
  urgency: DigestUrgency;
}

/** One person to call today. Several cases for one person are one row. */
export interface CallRow {
  /** "Janet Acuna" */
  name: string;
  /** Surplus across all of this person's cases, "$8,738". */
  amount: string;
  /** "Brevard County case 250809, 2480 Keegan Cir SW, Palm Bay. Open, nothing filed. 4 clean numbers." */
  detail: string;
  /** A warning to read before dialing, e.g. an unconfirmed match. */
  flag: string | null;
  phone: string | null;
  url: string;
  urgency: DigestUrgency;
}

/** Something owed to a claimant: a reply, a follow-up, a monthly update. */
export interface PromiseRow {
  title: string;
  /** Quoted reply, the stage, or who owns the task. */
  detail: string | null;
  /** "5 days late", "waiting 3h 10m" */
  when: string;
  url: string;
  urgency: DigestUrgency;
}

/** A signed claim that has stopped moving. */
export interface InFlightRow {
  claimant: string;
  stage: string;
  /** What is stuck, e.g. "Filed 38 days ago, the county has not acknowledged it". */
  note: string;
  fee: string;
  url: string;
  urgency: DigestUrgency;
}

/** One automated county pull, one line. */
export interface FeedRow {
  label: string;
  schedule: string;
  detail: string;
  urgency: DigestUrgency;
  /** Counts off the run the line describes, for the one-line healthy summary. */
  scanned?: number;
  created?: number;
}

export interface DigestBrief {
  organizationId: string | null;
  generatedAt: Date;
  /** "Friday, July 24, 2026" in the org timezone. */
  dateLabel: string;
  timeLabel: string;
  greetingName: string | null;
  /** "Good morning" / "Good afternoon" / "Good evening" in the org timezone. */
  greetingPrefix: string;

  subject: string;
  preheader: string;

  bigThing: BigThing | null;
  scorecard: BoardTile[];
  /** People to call after the big thing, best first. */
  calls: CallRow[];
  /** Everybody on the call list, the big thing and the rows not shown included. */
  callsTotal: number;
  /** Replies, overdue follow-ups, and monthly updates owed, most urgent first. */
  promises: PromiseRow[];
  promisesTotal: number;
  /** Live claimants nothing has been looked up for, so they cannot reach the call list. */
  needsTrace: { total: number; byCounty: string } | null;
  /** Signed claims that have stopped moving. */
  inFlight: InFlightRow[];
  inFlightTotal: number;
  /** "$12.4K" of fees across every claim in flight. */
  inFlightFees: string;
  /** "24 claimants landed from Lee overnight, $312K between them." */
  surplusIngestNote: string | null;
  /** Claimants whose lien window closes within 30 days, so they become callable soon. */
  surplusOpeningSoonNote: string | null;
  /** Feeds that failed or need a look. Healthy ones are summarized in one line. */
  feedProblems: FeedRow[];
  /** "All 12 county feeds healthy: 6,907 scanned, 42 new on their last pulls." */
  feedSummary: string | null;
  /** Counties whose surplus list is due to be asked for again, from the county list tracker. */
  countyListsDue: FeedRow[];
  /** People on workable files with nothing tried in a week: the outreach list's Due today. */
  touchesDue: { people: number; cases: number; line: string } | null;
  /** One line of wholesaling counts, or null when there is nothing to say. */
  wholesale: string | null;

  appUrl: string;
  /** True when every actionable section came back empty. Cron skips the send. */
  isEmpty: boolean;
}
