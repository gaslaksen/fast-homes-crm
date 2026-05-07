import type { ArvStats, ConfidenceLabel } from '../types/arv-result';

// Confidence formula per Build Prompt 016. Hybrid: mostly mathematical,
// with a bounded contribution from the AI's self-assessed comp set
// quality. Thresholds are applied here so UI never shows a contradiction
// like "62% confidence (HIGH)".
//
// confidence = clamp(0, 100,
//   base(40)
//   + compCountFactor       // 0-15 (5+ comps = 15, 3 comps = 5, <3 = 0)
//   - varianceFactor        // 0-20 (high variance subtracts)
//   - distanceFactor        // 0-10 (avg distance > 1mi subtracts)
//   - stalenessFactor       // 0-10 (avg months ago > 6 subtracts)
//   + aiQualityFactor       // 0-20 (AI self-assessed quality 0-100, scaled)
// )
//
// Thresholds:
//   0–49  → LOW
//   50–74 → MEDIUM
//   75–100 → HIGH

export function compCountFactor(compsUsed: number): number {
  if (compsUsed >= 5) return 15;
  if (compsUsed === 4) return 10;
  if (compsUsed === 3) return 5;
  return 0;
}

// Variance coefficient is std dev / mean of adjusted prices.
// Anything under 0.10 (10% relative spread) is excellent → 0 penalty.
// 0.30 (30% spread) is the cap → full -20.
export function varianceFactor(varianceCoeff: number): number {
  if (varianceCoeff <= 0.1) return 0;
  if (varianceCoeff >= 0.3) return 20;
  // Linear between 0.10 and 0.30.
  return ((varianceCoeff - 0.1) / 0.2) * 20;
}

// Avg distance: ≤1mi = no penalty. 3+ miles = full -10.
export function distanceFactor(avgDistanceMiles: number): number {
  if (avgDistanceMiles <= 1) return 0;
  if (avgDistanceMiles >= 3) return 10;
  return ((avgDistanceMiles - 1) / 2) * 10;
}

// Avg sale recency: ≤6mo = no penalty. 18+mo = full -10.
export function stalenessFactor(avgMonthsAgo: number): number {
  if (avgMonthsAgo <= 6) return 0;
  if (avgMonthsAgo >= 18) return 10;
  return ((avgMonthsAgo - 6) / 12) * 10;
}

// AI self-assessed quality: 0-100 scaled to 0-20 contribution.
export function aiQualityFactor(aiQualityScore: number): number {
  const clamped = Math.min(100, Math.max(0, aiQualityScore));
  return (clamped / 100) * 20;
}

export function computeConfidence(
  stats: ArvStats,
  aiQualityScore: number,
): { score: number; label: ConfidenceLabel } {
  const raw =
    40 +
    compCountFactor(stats.compsUsed) -
    varianceFactor(stats.compVarianceCoeff) -
    distanceFactor(stats.avgDistanceMiles) -
    stalenessFactor(stats.avgMonthsAgo) +
    aiQualityFactor(aiQualityScore);
  const score = Math.round(Math.min(100, Math.max(0, raw)));
  return { score, label: confidenceLabel(score) };
}

export function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 75) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}
