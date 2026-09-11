/**
 * Expense kinds for the disbursement report. Mirrors SURPLUS_EXPENSE_KINDS
 * in packages/shared/src/types.ts, duplicated for the same reason as
 * surplus-calls.ts (Vercel builds the web app without the shared dist). The
 * API validates what this sends.
 */
export const SURPLUS_EXPENSE_KINDS: [string, string][] = [
  ['title_search', 'Title search'],
  ['notary', 'Mobile notary'],
  ['filing', 'Filing fee'],
  ['postage', 'Postage and courier'],
  ['skip_trace', 'Skip trace'],
  ['attorney', 'Attorney'],
  ['other', 'Other'],
];

/**
 * The agreement's fee schedule, section 3(d). Mirrors SURPLUS_FEE_TIERS in
 * packages/shared/src/types.ts. The API does the arithmetic; this is for
 * labels and the estimate a person sees before a check exists.
 */
export const SURPLUS_FEE_TIERS: { upTo: number | null; pct: number }[] = [
  { upTo: 50_000, pct: 40 },
  { upTo: 100_000, pct: 35 },
  { upTo: null, pct: 30 },
];

export const SURPLUS_FEE_SCHEDULE_LABEL = '40% of the first $50,000, 35% of the next $50,000, and 30% above $100,000';

export function expenseLabel(kind: string): string {
  return SURPLUS_EXPENSE_KINDS.find(([k]) => k === kind)?.[1] || kind;
}

export function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '$0.00';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
