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

export function expenseLabel(kind: string): string {
  return SURPLUS_EXPENSE_KINDS.find(([k]) => k === kind)?.[1] || kind;
}

export function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '$0.00';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
