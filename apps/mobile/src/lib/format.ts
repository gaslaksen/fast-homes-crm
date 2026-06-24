/** Formatting helpers for money / counts shown across the app. */

export function money(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return '$' + Math.round(n).toLocaleString();
}

/** Compact money for tight spaces: $118k, $1.2M. */
export function moneyShort(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (abs >= 1_000) return '$' + Math.round(n / 1000) + 'k';
  return '$' + Math.round(n);
}

/** Clock time, e.g. "3:55 PM". */
export function clockTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ap}`;
}

/** Day heading for conversation date separators: Today / Yesterday / Mon D, YYYY. */
export function dayLabel(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const isSame = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (isSame(d, now)) return 'Today';
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (isSame(d, yest)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function sameDay(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** CAMP timeline (days) → human label. */
export function timelineLabel(days?: number | null): string | null {
  if (days == null) return null;
  if (days <= 7) return 'ASAP';
  if (days <= 30) return 'This month';
  if (days <= 90) return '1-3 months';
  if (days >= 365) return 'No rush';
  return `~${Math.round(days / 30)} months`;
}
