'use client';

// Profit cell: amount + bucket pill. Color-coded by sign × bucket. JV deals
// get a hover tooltip showing gross + split.

import { BUCKET_LABELS, type DealBucket } from '@/lib/dealStages';

interface Props {
  amount: number | null;
  bucket: DealBucket | null;
  jv?: {
    gross: number | null;
    splitMode: string | null;
    splitPercent: number | null;
    partnerName: string | null;
  };
  // Show "Add data" link when amount is null and the deal is in a stage
  // that should have data by now.
  emptyHref?: string;
}

export default function ProfitBadge({ amount, bucket, jv, emptyHref }: Props) {
  if (amount == null) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-gray-400 dark:text-gray-500">
        —
        {emptyHref ? (
          <a
            href={emptyHref}
            className="text-xs text-primary-600 hover:underline dark:text-primary-400"
            onClick={(e) => e.stopPropagation()}
          >
            Add data
          </a>
        ) : null}
      </span>
    );
  }

  const isNegative = amount < 0;
  const colorClass = colorForBucket(bucket, isNegative);
  const display = formatProfitAmount(amount);

  const tooltip = buildTooltip(amount, jv);

  return (
    <span className="inline-flex items-center gap-1.5" title={tooltip}>
      <span className={`text-sm font-semibold tabular-nums ${colorClass}`}>{display}</span>
      {bucket ? (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${pillForBucket(
            bucket,
          )}`}
        >
          {BUCKET_LABELS[bucket]}
        </span>
      ) : null}
    </span>
  );
}

function colorForBucket(bucket: DealBucket | null, negative: boolean): string {
  if (negative) return 'text-red-700 dark:text-red-400';
  switch (bucket) {
    case 'realized':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'expected':
      return 'text-amber-700 dark:text-amber-400';
    case 'potential':
      return 'text-sky-700 dark:text-sky-400';
    default:
      return 'text-gray-700 dark:text-gray-300';
  }
}

function pillForBucket(bucket: DealBucket): string {
  switch (bucket) {
    case 'realized':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
    case 'expected':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
    case 'potential':
      return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300';
  }
}

// Negative amounts render in accountant-style parentheses so sign isn't
// only conveyed by color (a11y).
function formatProfitAmount(n: number): string {
  const abs = Math.abs(n);
  const formatted = `$${Math.round(abs).toLocaleString()}`;
  return n < 0 ? `(${formatted})` : formatted;
}

function buildTooltip(
  ourShare: number,
  jv?: Props['jv'],
): string | undefined {
  if (!jv) return `Our share: $${Math.round(ourShare).toLocaleString()}`;
  if (!jv.splitMode || jv.splitMode === 'none') return undefined;
  const grossStr =
    jv.gross != null ? `$${Math.round(jv.gross).toLocaleString()}` : '—';
  const partner = jv.partnerName ? ` (${jv.partnerName})` : '';
  if (jv.splitMode === 'fifty_fifty') {
    return `Gross ${grossStr}, 50/50 split${partner}. Your share: $${Math.round(
      ourShare,
    ).toLocaleString()}.`;
  }
  if (jv.splitMode === 'custom' && jv.splitPercent != null) {
    return `Gross ${grossStr}, your share ${jv.splitPercent}%${partner}: $${Math.round(
      ourShare,
    ).toLocaleString()}.`;
  }
  return undefined;
}
