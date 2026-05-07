import {
  median,
  mean,
  varianceCoefficient,
  monthsBetween,
  computeStats,
} from './arv-stats';
import type { CompAdjustmentResult } from '../types/arv-result';

describe('median', () => {
  it('returns 0 for empty', () => expect(median([])).toBe(0));
  it('handles odd-length', () => expect(median([3, 1, 2])).toBe(2));
  it('handles even-length', () => expect(median([1, 2, 3, 4])).toBe(2.5));
});

describe('mean', () => {
  it('returns 0 for empty', () => expect(mean([])).toBe(0));
  it('averages', () => expect(mean([2, 4, 6])).toBe(4));
});

describe('varianceCoefficient', () => {
  it('returns 0 for fewer than 2 values', () => {
    expect(varianceCoefficient([])).toBe(0);
    expect(varianceCoefficient([42])).toBe(0);
  });
  it('returns small value for tight cluster', () => {
    expect(varianceCoefficient([100, 102, 98])).toBeLessThan(0.05);
  });
  it('returns large value for wide spread', () => {
    expect(varianceCoefficient([100, 200, 300])).toBeGreaterThan(0.3);
  });
  it('handles zero mean gracefully', () => {
    expect(varianceCoefficient([0, 0])).toBe(0);
  });
});

describe('monthsBetween', () => {
  it('returns positive months for past dates', () => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const m = monthsBetween(sixMonthsAgo.toISOString());
    expect(m).toBeGreaterThan(5.5);
    expect(m).toBeLessThan(6.5);
  });
  it('returns 0 for invalid date', () => {
    expect(monthsBetween('not-a-date')).toBe(0);
  });
});

describe('computeStats', () => {
  const adjustments: CompAdjustmentResult[] = [
    {
      compId: 'a',
      address: 'A',
      originalPrice: 100_000,
      adjustedPrice: 100_000,
      adjustments: [],
      weight: 0.5,
      aiReasoning: 'a',
    },
    {
      compId: 'b',
      address: 'B',
      originalPrice: 110_000,
      adjustedPrice: 110_000,
      adjustments: [],
      weight: 0.5,
      aiReasoning: 'b',
    },
  ];
  const comps = [
    { id: 'a', sqft: 1000, distance: 0.5, daysOnMarket: 30, soldDate: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString() },
    { id: 'b', sqft: 1100, distance: 1.0, daysOnMarket: 60, soldDate: new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString() },
  ];
  it('produces consistent stats from comp + adjustment data', () => {
    const stats = computeStats({ sqft: 1050 }, comps, adjustments);
    expect(stats.compsUsed).toBe(2);
    expect(stats.avgSqft).toBe(1050);
    expect(stats.avgDistanceMiles).toBeCloseTo(0.75, 1);
    expect(stats.avgDom).toBe(45);
    // ppsf per comp: 100k/1000=100, 110k/1100=100. avg/median both 100.
    expect(stats.avgPricePerSqft).toBeCloseTo(100, 0);
    expect(stats.medianPricePerSqft).toBeCloseTo(100, 0);
    expect(stats.compVarianceCoeff).toBeGreaterThanOrEqual(0);
  });
});
