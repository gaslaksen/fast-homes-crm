/**
 * Merging a later filing into the case a lead already represents.
 *
 * One foreclosure case produces several filings: a Notice of Hearing, then a
 * Notice of Sale carrying the auction date, then upset bids. They must collapse
 * onto one lead, but collapsing must not throw the new facts away - the auction
 * date arrives on the second filing and is the whole point of tracking the case.
 *
 * Pure and Prisma-free so the rules are testable without a database.
 */

/** The subset of ForeclosureDetail that a filing can speak to. */
export interface CaseFacts {
  caseNumber: string | null;
  noticeType: string | null;
  noticeUrl: string | null;
  trustee: string | null;
  county: string | null;
  saleDate: Date | null;
  hearingDate: Date | null;
  loanDate: Date | null;
  loanAmount: number | null;
  assessedValue: number | null;
}

/** Fields that only ever get filled in, never replaced once known. */
const FILL_FORWARD_ONLY: (keyof CaseFacts)[] = [
  'caseNumber',
  'noticeType',
  'noticeUrl',
  'trustee',
  'county',
  'loanDate',
  'loanAmount',
  'assessedValue',
];

/**
 * Dates that advance rather than overwrite. A foreclosure timeline moves
 * forward: a sale is set after its hearing, and continuances push later. Taking
 * only the later value makes the merge order-independent, so re-uploading an
 * older filing after a newer one cannot walk the timeline backwards.
 *
 * The tradeoff is that a hearing genuinely rescheduled to an EARLIER date needs
 * a manual edit. That is the rarer case, and it fails visibly rather than
 * silently regressing a date that outreach is timed against.
 */
const ADVANCING_DATES: (keyof CaseFacts)[] = ['saleDate', 'hearingDate'];

const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

const time = (d: Date | null | undefined): number | null =>
  d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;

/**
 * Build the patch that folds a newly filed document's facts into the case as
 * already stored. Returns only the keys that actually change, so re-ingesting
 * an unchanged filing produces an empty object and no write.
 *
 * Deliberately says nothing about workflow or contact fields. Work status, do
 * not call, call notes, touch tracking, and everything skip trace wrote are the
 * user's, and a later court filing has no business overwriting them.
 */
export function mergeFilingFields(
  existing: CaseFacts,
  incoming: Partial<CaseFacts>,
): Partial<CaseFacts> {
  const patch: Partial<CaseFacts> = {};

  for (const key of FILL_FORWARD_ONLY) {
    const next = incoming[key];
    if (isEmpty(next)) continue;
    if (!isEmpty(existing[key])) continue;
    (patch as any)[key] = next;
  }

  for (const key of ADVANCING_DATES) {
    const next = time(incoming[key] as Date | null);
    if (next === null) continue;
    const current = time(existing[key] as Date | null);
    if (current !== null && next <= current) continue;
    (patch as any)[key] = incoming[key];
  }

  return patch;
}
