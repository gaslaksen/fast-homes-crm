'use client';

// The hero of /deals: three big profit cards.
// Cards are clickable to filter the table to that bucket. Selected card
// gets a stronger ring. Realized card hosts the time-period selector.

import { BUCKET_DESCRIPTIONS, BUCKET_LABELS, type DealBucket } from '@/lib/dealStages';
import RealizedPeriodSelector from './RealizedPeriodSelector';
import type { DealsSummaryResponse } from './types';
import {
  formatRange,
  rangeForPeriod,
  type RealizedPeriodId,
} from './lib/timeRanges';

interface Props {
  data: DealsSummaryResponse | null;
  loading: boolean;
  selectedBucket: DealBucket | null;
  onBucketClick: (bucket: DealBucket) => void;
  period: RealizedPeriodId;
  onPeriodChange: (p: RealizedPeriodId) => void;
  customRange: { from: string | null; to: string | null };
  onCustomRangeChange: (r: { from: string | null; to: string | null }) => void;
}

export default function PortfolioSummary({
  data,
  loading,
  selectedBucket,
  onBucketClick,
  period,
  onPeriodChange,
  customRange,
  onCustomRangeChange,
}: Props) {
  // Realized subtitle reflects either a preset name (e.g. "Year to Date")
  // or a formatted custom range — keeps the UI honest about what's summed.
  const realizedSubtitle =
    period === 'custom'
      ? formatRange({
          from: customRange.from ? new Date(customRange.from) : null,
          to: customRange.to ? new Date(customRange.to) : null,
        })
      : period === 'allTime'
      ? 'All-time closed deals'
      : period === 'lastYear'
      ? 'Last year (closed deals)'
      : period === 'thisMonth'
      ? 'This month (closed deals)'
      : period === 'thisQuarter'
      ? 'This quarter (closed deals)'
      : 'Year to date (closed deals)';

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      <Card
        bucket="potential"
        label={BUCKET_LABELS.potential}
        subtitle="Pending offers"
        tooltip={BUCKET_DESCRIPTIONS.potential}
        sum={data?.potential.sum ?? 0}
        count={data?.potential.count ?? 0}
        loading={loading}
        selected={selectedBucket === 'potential'}
        onClick={() => onBucketClick('potential')}
        tone="potential"
      />
      <Card
        bucket="expected"
        label={BUCKET_LABELS.expected}
        subtitle="Under contract through acquired"
        tooltip={BUCKET_DESCRIPTIONS.expected}
        sum={data?.expected.sum ?? 0}
        count={data?.expected.count ?? 0}
        loading={loading}
        selected={selectedBucket === 'expected'}
        onClick={() => onBucketClick('expected')}
        tone="expected"
      />
      <Card
        bucket="realized"
        label={BUCKET_LABELS.realized}
        subtitle={realizedSubtitle}
        tooltip={BUCKET_DESCRIPTIONS.realized}
        sum={data?.realized.sum ?? 0}
        count={data?.realized.count ?? 0}
        loading={loading}
        selected={selectedBucket === 'realized'}
        onClick={() => onBucketClick('realized')}
        tone="realized"
        rightSlot={
          <div onClick={(e) => e.stopPropagation()}>
            <RealizedPeriodSelector
              period={period}
              onChange={onPeriodChange}
              customRange={customRange}
              onCustomRangeChange={onCustomRangeChange}
            />
          </div>
        }
      />
    </div>
  );
}

interface CardProps {
  bucket: DealBucket;
  label: string;
  subtitle: string;
  tooltip: string;
  sum: number;
  count: number;
  loading: boolean;
  selected: boolean;
  onClick: () => void;
  tone: 'potential' | 'expected' | 'realized';
  rightSlot?: React.ReactNode;
}

function Card({
  label,
  subtitle,
  tooltip,
  sum,
  count,
  loading,
  selected,
  onClick,
  tone,
  rightSlot,
}: CardProps) {
  const toneClasses =
    tone === 'realized'
      ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/30'
      : tone === 'expected'
      ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/30'
      : 'border-sky-200 bg-sky-50/40 dark:border-sky-900/40 dark:bg-sky-950/30';

  const ring = selected
    ? tone === 'realized'
      ? 'ring-2 ring-emerald-500 dark:ring-emerald-400'
      : tone === 'expected'
      ? 'ring-2 ring-amber-500 dark:ring-amber-400'
      : 'ring-2 ring-sky-500 dark:ring-sky-400'
    : 'ring-1 ring-transparent';

  const numberColor =
    tone === 'realized'
      ? sum < 0
        ? 'text-red-700 dark:text-red-400'
        : 'text-emerald-700 dark:text-emerald-400'
      : tone === 'expected'
      ? 'text-amber-800 dark:text-amber-300'
      : 'text-sky-800 dark:text-sky-300';

  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      aria-pressed={selected}
      className={`relative flex flex-col gap-1 rounded-lg border ${toneClasses} ${ring} p-4 text-left transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
            {label}
          </div>
          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {subtitle}
          </div>
        </div>
        {rightSlot}
      </div>
      <div className="mt-2">
        {loading ? (
          <div className="h-9 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        ) : (
          <div
            className={`text-3xl font-bold tabular-nums ${numberColor}`}
            title={`$${Math.round(sum).toLocaleString()}`}
          >
            {formatHeadline(sum)}
          </div>
        )}
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          {loading ? 'Loading…' : `Across ${count.toLocaleString()} deal${count === 1 ? '' : 's'}`}
        </div>
      </div>
    </button>
  );
}

// Big-number formatter: $127k / $1.2M for cards. Falls back to full
// $-comma format for under-1k values. Negative shows parentheses (a11y —
// don't lean on color alone for sign).
function formatHeadline(n: number): string {
  if (!isFinite(n)) return '$0';
  const abs = Math.abs(n);
  let body: string;
  if (abs >= 1_000_000) body = `$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  else if (abs >= 1_000) body = `$${Math.round(abs / 1_000)}k`;
  else body = `$${Math.round(abs)}`;
  return n < 0 ? `(${body})` : body;
}
