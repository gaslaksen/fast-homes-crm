import {
  validateAdjustments,
  validateWeights,
  validateRawResponse,
} from './validators';
import type {
  CompAdjustmentResult,
  RawAiArvResponse,
} from '../types/arv-result';

function comp(overrides: Partial<CompAdjustmentResult> = {}): CompAdjustmentResult {
  return {
    compId: 'c1',
    address: 'Test',
    originalPrice: 100_000,
    adjustedPrice: 100_000,
    adjustments: [],
    weight: 1,
    aiReasoning: 'Solid match',
    ...overrides,
  };
}

describe('validateAdjustments — 30% guardrail', () => {
  it('passes when adjustments are within 30%', () => {
    const c = comp({
      adjustments: [
        { type: 'sqft', amount: -10_000, reasoning: 'smaller' },
        { type: 'condition', amount: -5_000, reasoning: 'fair' },
      ],
      adjustedPrice: 85_000,
    });
    const out = validateAdjustments([c]);
    expect(out.ok).toBe(true);
    expect(out.issues).toEqual([]);
  });

  it('flags unjustified > 30% adjustments', () => {
    const c = comp({
      adjustments: [{ type: 'condition', amount: -40_000, reasoning: 'reno' }],
      adjustedPrice: 60_000,
      aiReasoning: 'Looks fine.',
    });
    const out = validateAdjustments([c]);
    expect(out.ok).toBe(false);
    expect(out.issues[0].kind).toBe('unjustified_large_adjustment');
    expect(out.issues[0].compId).toBe('c1');
  });

  it('passes > 30% when AI reasoning explicitly justifies it', () => {
    const c = comp({
      adjustments: [{ type: 'condition', amount: -40_000, reasoning: 'gut rehab needed' }],
      adjustedPrice: 60_000,
      aiReasoning:
        'This comp was a recent flip in renovated condition while subject is gut rehab scope; -40% reflects the renovation delta backed by REAPI photo flags.',
    });
    const out = validateAdjustments([c]);
    expect(out.ok).toBe(true);
  });

  it('skips weight-0 comps', () => {
    const c = comp({
      adjustments: [{ type: 'condition', amount: -90_000, reasoning: 'distress' }],
      adjustedPrice: 10_000,
      weight: 0,
      aiReasoning: 'Excluded — distressed.',
    });
    const out = validateAdjustments([c]);
    expect(out.ok).toBe(true);
  });
});

describe('validateWeights — sum-to-1 invariant', () => {
  it('accepts weights summing to 1.00 ± 0.02', () => {
    const c1 = comp({ compId: 'a', weight: 0.5 });
    const c2 = comp({ compId: 'b', weight: 0.5 });
    expect(validateWeights([c1, c2]).ok).toBe(true);
  });

  it('accepts within tolerance (0.99, 1.01)', () => {
    const c1 = comp({ compId: 'a', weight: 0.49 });
    const c2 = comp({ compId: 'b', weight: 0.50 });
    expect(validateWeights([c1, c2]).ok).toBe(true);
  });

  it('rejects sum 0.5', () => {
    const c1 = comp({ compId: 'a', weight: 0.25 });
    const c2 = comp({ compId: 'b', weight: 0.25 });
    const out = validateWeights([c1, c2]);
    expect(out.ok).toBe(false);
    expect(out.issues[0].kind).toBe('weight_invalid');
  });

  it('rejects weights outside [0,1]', () => {
    const c1 = comp({ compId: 'a', weight: 1.5 });
    const c2 = comp({ compId: 'b', weight: -0.5 });
    const out = validateWeights([c1, c2]);
    expect(out.ok).toBe(false);
    // Both weight bounds plus the sum issue.
    expect(out.issues.length).toBeGreaterThanOrEqual(2);
  });
});

describe('validateRawResponse', () => {
  function rawWith(comps: CompAdjustmentResult[]): RawAiArvResponse {
    return {
      arv: 100_000,
      arvLow: 90_000,
      arvHigh: 110_000,
      compAdjustments: comps,
      valuationMethod: 'Test',
      keyFactors: [],
      risks: [],
      aiQualityScore: 70,
    };
  }
  it('combines adjustment + weight checks', () => {
    const c1 = comp({ compId: 'a', weight: 0.4 });
    const c2 = comp({
      compId: 'b',
      weight: 0.6,
      adjustments: [{ type: 'condition', amount: -50_000, reasoning: 'reno' }],
      adjustedPrice: 50_000,
      aiReasoning: 'Looks fine',
    });
    const out = validateRawResponse(rawWith([c1, c2]));
    expect(out.ok).toBe(false);
    expect(out.issues.find((i) => i.kind === 'unjustified_large_adjustment'))
      .toBeTruthy();
  });
});
