import { parseCurationResult } from './curation-result';

const validRanking = {
  candidateId: 'comp-1',
  rank: 1,
  relevanceScore: 85,
  inclusion: 'recommend_include',
  reasoning: 'Same street, era, and similar size.',
  flags: [],
  externalLinks: { zillow: 'z', realtor: 'r', googleMaps: 'g' },
};

const validBase = () => ({
  summary: 'Test summary.',
  recommendedTopCount: 4,
  valuationMode: 'ARV_RENOVATED',
  rankings: [validRanking],
  excludedDueToTypeMismatch: [],
  excludedDueToConstraints: [],
  searchExpansion: {
    initialRadius: 1.5,
    finalRadius: 1.5,
    expansionPath: [1.5],
    expansionReason: 'No expansion needed.',
  },
  marketObservations: ['Pool of similar-era homes.'],
});

describe('parseCurationResult', () => {
  it('accepts a fully-formed response', () => {
    const out = parseCurationResult(validBase());
    expect(out.ok).toBe(true);
  });

  it('returns reason on non-object input', () => {
    const out = parseCurationResult('not json');
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.reason).toMatch(/not an object/);
  });

  it.each([
    ['ARV', 'ARV_RENOVATED'],
    ['arv', 'ARV_RENOVATED'],
    ['ARV_RENOVATED', 'ARV_RENOVATED'],
    ['Renovated', 'ARV_RENOVATED'],
    ['as-is', 'AS_IS'],
    ['AS IS', 'AS_IS'],
    ['ASIS', 'AS_IS'],
    ['AS_IS', 'AS_IS'],
  ])('normalizes valuationMode %p → %p', (input, expected) => {
    const raw: any = { ...validBase(), valuationMode: input };
    const out = parseCurationResult(raw);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.valuationMode).toBe(expected);
  });

  it('rejects unrecognized valuationMode with reason', () => {
    const raw: any = { ...validBase(), valuationMode: 'flip' };
    const out = parseCurationResult(raw);
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.reason).toMatch(/valuationMode/);
  });

  it('coerces numeric fields from string', () => {
    const raw: any = {
      ...validBase(),
      recommendedTopCount: '4',
      rankings: [{ ...validRanking, rank: '1', relevanceScore: '85' }],
    };
    const out = parseCurationResult(raw);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.recommendedTopCount).toBe(4);
      expect(out.value.rankings[0].rank).toBe(1);
      expect(out.value.rankings[0].relevanceScore).toBe(85);
    }
  });

  it('normalizes inclusion variants', () => {
    const raw: any = {
      ...validBase(),
      rankings: [
        { ...validRanking, candidateId: 'a', inclusion: 'include' },
        { ...validRanking, candidateId: 'b', inclusion: 'EXCLUDE' },
        { ...validRanking, candidateId: 'c', inclusion: 'borderline' },
      ],
    };
    const out = parseCurationResult(raw);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.rankings.map((r) => r.inclusion)).toEqual([
        'recommend_include',
        'recommend_exclude',
        'borderline',
      ]);
    }
  });

  it('reports specific item index on ranking failure', () => {
    const raw: any = {
      ...validBase(),
      rankings: [validRanking, { ...validRanking, candidateId: 'b', rank: 'not a number' }],
    };
    const out = parseCurationResult(raw);
    expect(out.ok).toBe(false);
    if (out.ok === false) {
      expect(out.reason).toMatch(/item 1/);
      expect(out.reason).toMatch(/rank/);
    }
  });

  it('accepts missing exclusion arrays (server fills them)', () => {
    const raw: any = validBase();
    delete raw.excludedDueToTypeMismatch;
    delete raw.excludedDueToConstraints;
    const out = parseCurationResult(raw);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.excludedDueToTypeMismatch).toEqual([]);
      expect(out.value.excludedDueToConstraints).toEqual([]);
    }
  });

  it('accepts partial searchExpansion', () => {
    const raw: any = { ...validBase(), searchExpansion: { initialRadius: 1.5 } };
    const out = parseCurationResult(raw);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.searchExpansion.finalRadius).toBe(1.5);
      expect(out.value.searchExpansion.expansionPath).toEqual([]);
    }
  });

  it('reports specific reason when summary is missing', () => {
    const raw: any = validBase();
    delete raw.summary;
    const out = parseCurationResult(raw);
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.reason).toMatch(/summary/);
  });

  it('accepts exclusion entries with constraintFailed instead of reason', () => {
    const raw: any = {
      ...validBase(),
      excludedDueToConstraints: [{ candidateId: 'x', constraintFailed: 'renovatedOnly' }],
    };
    const out = parseCurationResult(raw);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.excludedDueToConstraints[0].reason).toBe('renovatedOnly');
    }
  });
});
