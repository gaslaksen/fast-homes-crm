import type { CompAdjustmentResult, ArvStats } from '../types/arv-result';

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, n) => s + n, 0) / values.length;
}

// Coefficient of variation: std dev / mean. Bounded to a non-negative
// number; returns 0 when the mean is 0 (can't compute relative variance
// against a zero baseline — caller treats this as "no signal").
export function varianceCoefficient(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  if (m === 0) return 0;
  const variance =
    values.reduce((s, n) => s + (n - m) ** 2, 0) / values.length;
  return Math.sqrt(variance) / m;
}

export function monthsBetween(iso: string, now = new Date()): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  const ms = now.getTime() - d.getTime();
  return ms / (1000 * 60 * 60 * 24 * 30.4375); // avg days/month
}

export interface SubjectForStats {
  sqft?: number | null;
}

export interface CompForStats {
  id: string;
  sqft?: number | null;
  distance?: number | null;
  daysOnMarket?: number | null;
  soldDate: string;
}

// Computes the deterministic stats block. The TS layer owns this — we
// don't trust the AI for the math, only for the qualitative judgment.
export function computeStats(
  subject: SubjectForStats,
  comps: CompForStats[],
  adjustments: CompAdjustmentResult[],
): ArvStats {
  const adjustedPrices = adjustments.map((a) => a.adjustedPrice);
  const sqfts = comps
    .map((c) => c.sqft)
    .filter((n): n is number => typeof n === 'number' && n > 0);
  const distances = comps
    .map((c) => c.distance)
    .filter((n): n is number => typeof n === 'number' && n >= 0);
  const doms = comps
    .map((c) => c.daysOnMarket)
    .filter((n): n is number => typeof n === 'number' && n >= 0);

  // $/sqft is computed from each comp's adjusted price ÷ comp's own sqft.
  // Subject sqft drives the final ARV $/sqft separately.
  const ppsfPerComp: number[] = [];
  for (const adj of adjustments) {
    const comp = comps.find((c) => c.id === adj.compId);
    if (comp?.sqft && comp.sqft > 0) {
      ppsfPerComp.push(adj.adjustedPrice / comp.sqft);
    }
  }

  const monthsAgoArr = comps.map((c) => monthsBetween(c.soldDate));

  return {
    compsUsed: comps.length,
    avgSqft: Math.round(mean(sqfts)),
    avgDistanceMiles: Number(mean(distances).toFixed(2)),
    avgDom: Math.round(mean(doms)),
    avgPricePerSqft: Number(mean(ppsfPerComp).toFixed(2)),
    medianPricePerSqft: Number(median(ppsfPerComp).toFixed(2)),
    avgMonthsAgo: Number(mean(monthsAgoArr).toFixed(1)),
    compVarianceCoeff: Number(varianceCoefficient(adjustedPrices).toFixed(3)),
  };
}
