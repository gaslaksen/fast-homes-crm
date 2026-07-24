/**
 * Shape of an assembled Daily Brief. `DigestService` builds this from the live
 * pipeline; `DigestRenderService` turns it into HTML and plain text. Nothing in
 * here touches Prisma, so the render step is pure and testable against a
 * hand-written fixture.
 *
 * Every section is allowed to be empty. The renderer drops empty sections
 * (divider included) rather than printing a "nothing here" placeholder, and
 * `isEmpty` tells the cron to skip the send entirely on a genuinely quiet day.
 */

/** Urgency band. Drives the accent color on tiles, action rails, and cards. */
export type DigestUrgency = 'critical' | 'warn' | 'neutral' | 'good';

export interface BigThing {
  /** One-sentence headline. Doubles as the email preheader. */
  headline: string;
  /** Supporting facts: address, tier, how long it has been waiting. */
  detail: string;
  /** The "so what" line. Always rendered after a bold "Why it matters:". */
  whyItMatters: string;
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

export interface DigestAction {
  title: string;
  detail: string;
  ctaLabel: string;
  ctaUrl: string;
  /** Ranking score. Higher sorts first; also picks the rail color. */
  score: number;
  urgency: DigestUrgency;
}

export interface WaitingRow {
  name: string;
  property: string;
  tierLabel: string;
  /** "10h 16m" */
  waitedLabel: string;
  preview: string;
  url: string;
  urgency: DigestUrgency;
}

export interface DealRow {
  property: string;
  /** First matching blocker, or a neutral status line. */
  note: string;
  noteUrgency: DigestUrgency;
  /** "Mon 7/27" */
  closeLabel: string;
  /** "3 days" */
  daysLabel: string;
  daysUrgency: DigestUrgency;
  fee: string;
  url: string;
}

export interface ForeclosureRow {
  property: string;
  daysLabel: string;
  facts: string;
  status: string;
  url: string;
  urgency: DigestUrgency;
}

export interface NewLeadRow {
  property: string;
  meta: string;
  note: string;
  noteUrgency: DigestUrgency;
  url: string;
}

export interface YesterdayStat {
  text: string;
}

export interface DigestBrief {
  organizationId: string | null;
  generatedAt: Date;
  /** "Friday, July 24, 2026" in the org timezone. */
  dateLabel: string;
  timeLabel: string;
  greetingName: string | null;
  /** "Charlotte metro", derived from the most common active-lead city. */
  marketLabel: string | null;

  subject: string;
  preheader: string;

  bigThing: BigThing | null;
  board: BoardTile[];
  actions: DigestAction[];
  waiting: WaitingRow[];
  waitingTotal: number;
  dealsInMotion: DealRow[];
  dealsTotalFee: string;
  foreclosures: ForeclosureRow[];
  foreclosureIngestNote: string | null;
  foreclosureOpenTotal: number;
  newOvernight: NewLeadRow[];
  newOvernightTotal: number;
  yesterday: YesterdayStat[];

  appUrl: string;
  /** True when every actionable section came back empty. Cron skips the send. */
  isEmpty: boolean;
}
