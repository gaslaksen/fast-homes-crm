import {
  computeConfidence,
  confidenceLabel,
  compCountFactor,
  varianceFactor,
  distanceFactor,
  stalenessFactor,
  aiQualityFactor,
} from './confidence';
import type { ArvStats } from '../types/arv-result';

const baseStats: ArvStats = {
  compsUsed: 5,
  avgSqft: 1200,
  avgDistanceMiles: 0.8,
  avgDom: 30,
  avgPricePerSqft: 150,
  medianPricePerSqft: 148,
  avgMonthsAgo: 4,
  compVarianceCoeff: 0.08,
};

describe('confidence label thresholds', () => {
  it('labels 0-49 as LOW', () => {
    expect(confidenceLabel(0)).toBe('LOW');
    expect(confidenceLabel(25)).toBe('LOW');
    expect(confidenceLabel(49)).toBe('LOW');
  });
  it('labels 50-74 as MEDIUM', () => {
    expect(confidenceLabel(50)).toBe('MEDIUM');
    expect(confidenceLabel(62)).toBe('MEDIUM');
    expect(confidenceLabel(74)).toBe('MEDIUM');
  });
  it('labels 75-100 as HIGH', () => {
    expect(confidenceLabel(75)).toBe('HIGH');
    expect(confidenceLabel(100)).toBe('HIGH');
  });
});

describe('component factors', () => {
  it('compCountFactor caps at 15 for 5+ comps', () => {
    expect(compCountFactor(5)).toBe(15);
    expect(compCountFactor(20)).toBe(15);
    expect(compCountFactor(4)).toBe(10);
    expect(compCountFactor(3)).toBe(5);
    expect(compCountFactor(2)).toBe(0);
  });

  it('varianceFactor: 0 below 0.10, 20 above 0.30', () => {
    expect(varianceFactor(0.05)).toBe(0);
    expect(varianceFactor(0.1)).toBe(0);
    expect(varianceFactor(0.3)).toBe(20);
    expect(varianceFactor(0.5)).toBe(20);
    expect(varianceFactor(0.2)).toBeCloseTo(10, 1);
  });

  it('distanceFactor: 0 within 1mi, 10 at 3+mi', () => {
    expect(distanceFactor(0.5)).toBe(0);
    expect(distanceFactor(1)).toBe(0);
    expect(distanceFactor(2)).toBe(5);
    expect(distanceFactor(3)).toBe(10);
    expect(distanceFactor(10)).toBe(10);
  });

  it('stalenessFactor: 0 within 6mo, 10 at 18+mo', () => {
    expect(stalenessFactor(3)).toBe(0);
    expect(stalenessFactor(6)).toBe(0);
    expect(stalenessFactor(12)).toBe(5);
    expect(stalenessFactor(18)).toBe(10);
    expect(stalenessFactor(36)).toBe(10);
  });

  it('aiQualityFactor scales 0-100 to 0-20', () => {
    expect(aiQualityFactor(0)).toBe(0);
    expect(aiQualityFactor(50)).toBe(10);
    expect(aiQualityFactor(100)).toBe(20);
    expect(aiQualityFactor(150)).toBe(20); // clamps
    expect(aiQualityFactor(-20)).toBe(0); // clamps
  });
});

describe('computeConfidence end-to-end', () => {
  it('produces a HIGH score on a strong comp set', () => {
    const { score, label } = computeConfidence(baseStats, 80);
    // base 40 + 15 (5 comps) - 0 (var) - 0 (dist) - 0 (stale) + 16 (AI) = 71
    expect(score).toBe(71);
    expect(label).toBe('MEDIUM');
  });

  it('produces a LOW score on a thin, distant, stale set', () => {
    const stats: ArvStats = {
      ...baseStats,
      compsUsed: 2,
      avgDistanceMiles: 4,
      avgMonthsAgo: 24,
      compVarianceCoeff: 0.5,
    };
    const { score, label } = computeConfidence(stats, 20);
    // base 40 + 0 - 20 - 10 - 10 + 4 = 4
    expect(score).toBe(4);
    expect(label).toBe('LOW');
  });

  it('clamps to 100 on absurdly strong inputs', () => {
    const stats: ArvStats = {
      ...baseStats,
      compsUsed: 10,
      compVarianceCoeff: 0.05,
      avgDistanceMiles: 0.3,
      avgMonthsAgo: 2,
    };
    const { score, label } = computeConfidence(stats, 100);
    // base 40 + 15 + 20 = 75, label HIGH
    expect(score).toBeGreaterThanOrEqual(75);
    expect(label).toBe('HIGH');
  });

  it('crosses MEDIUM/HIGH boundary cleanly', () => {
    // Aim for exactly 75
    const stats: ArvStats = {
      ...baseStats,
      compsUsed: 5,             // +15
      avgDistanceMiles: 0.5,    // -0
      avgMonthsAgo: 3,          // -0
      compVarianceCoeff: 0.1,   // -0
    };
    // 40 + 15 + (aiQuality factor)
    const { score: s100 } = computeConfidence(stats, 100); // 75
    expect(s100).toBe(75);
    expect(confidenceLabel(75)).toBe('HIGH');
    expect(confidenceLabel(74)).toBe('MEDIUM');
  });
});
