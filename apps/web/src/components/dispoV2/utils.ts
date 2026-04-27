import { ProfitBucket } from './types';

export const fmtCurrency = (n: number | null | undefined): string =>
  n != null ? `$${Math.round(n).toLocaleString()}` : '—';

// Signed currency — keeps the sign for negative profit so a Sold-at-Loss
// reads as `-$15,000` instead of `$-15,000`.
export const fmtSignedCurrency = (n: number | null | undefined): string => {
  if (n == null) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
};

export const fmtDate = (s: string | null | undefined): string => {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString();
  } catch {
    return s;
  }
};

export const profitBucketBadge = (bucket: ProfitBucket | null | undefined, value: number | null): string => {
  if (bucket === 'realized') {
    if (value != null && value < 0) {
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800';
    }
    return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800';
  }
  if (bucket === 'expected') {
    return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800';
  }
  // potential / null
  return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700';
};

export const profitBucketLabel = (bucket: ProfitBucket | null | undefined): string => {
  switch (bucket) {
    case 'realized': return 'Realized';
    case 'expected': return 'Expected';
    case 'potential': return 'Potential';
    default: return '—';
  }
};

// Convert "" → null and otherwise parseFloat. Used by every currency input
// in v2 — fixes the silent-NaN bug from the legacy DispoTab where blank
// fields would write NaN to the backend.
export const numOrNull = (s: string): number | null => {
  if (s === '' || s == null) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};
