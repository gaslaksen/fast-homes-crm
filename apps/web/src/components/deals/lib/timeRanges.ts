// Time period helpers for the Realized profit selector.
// All ranges are computed in the user's browser timezone — the API takes
// ISO bounds and trusts the caller. "Today's date" comes from `new Date()`
// so DST rolls forward correctly.

export type RealizedPeriodId =
  | 'thisMonth'
  | 'thisQuarter'
  | 'ytd'
  | 'lastYear'
  | 'allTime'
  | 'custom';

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

export const REALIZED_PERIOD_LABELS: Record<RealizedPeriodId, string> = {
  thisMonth: 'This Month',
  thisQuarter: 'This Quarter',
  ytd: 'Year to Date',
  lastYear: 'Last Year',
  allTime: 'All Time',
  custom: 'Custom Range',
};

export function rangeForPeriod(
  period: RealizedPeriodId,
  custom?: DateRange,
  now: Date = new Date(),
): DateRange {
  switch (period) {
    case 'thisMonth':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
    case 'thisQuarter': {
      const q = Math.floor(now.getMonth() / 3);
      return { from: new Date(now.getFullYear(), q * 3, 1), to: now };
    }
    case 'ytd':
      return { from: new Date(now.getFullYear(), 0, 1), to: now };
    case 'lastYear':
      return {
        from: new Date(now.getFullYear() - 1, 0, 1),
        to: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999),
      };
    case 'allTime':
      return { from: null, to: null };
    case 'custom':
      return custom ?? { from: null, to: null };
  }
}

export function rangeToParams(range: DateRange): {
  realizedFrom?: string;
  realizedTo?: string;
} {
  const out: { realizedFrom?: string; realizedTo?: string } = {};
  if (range.from) out.realizedFrom = range.from.toISOString();
  if (range.to) out.realizedTo = range.to.toISOString();
  return out;
}

export function formatRange(range: DateRange): string {
  if (!range.from && !range.to) return 'All Time';
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (range.from && range.to) return `${fmt(range.from)} – ${fmt(range.to)}`;
  if (range.from) return `from ${fmt(range.from)}`;
  return `until ${fmt(range.to!)}`;
}
