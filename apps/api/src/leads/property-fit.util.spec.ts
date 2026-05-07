import { dealFitFlags, propertyContextForPrompt } from './property-fit.util';

describe('dealFitFlags', () => {
  it('returns no concerns for a clean SFR with healthy ask-vs-ARV', () => {
    const flags = dealFitFlags({
      propertyType: 'SFR',
      askingPrice: 250_000,
      arv: 400_000,
    });
    expect(flags.isManufactured).toBe(false);
    expect(flags.isLeasedLand).toBe(false);
    expect(flags.askVsArvPct).toBeCloseTo(0.625, 2);
    expect(flags.askIsHighVsArv).toBe(false);
    expect(flags.askIsAtOrAboveArv).toBe(false);
    expect(flags.hasOpenFitConcern).toBe(false);
    expect(flags.concerns).toEqual([]);
  });

  it('detects manufactured via REAPI propertyType code', () => {
    const flags = dealFitFlags({ propertyType: 'MFR', askingPrice: 100_000, arv: 250_000 });
    expect(flags.isManufactured).toBe(true);
    expect(flags.hasOpenFitConcern).toBe(true);
    expect(flags.concerns[0]).toMatch(/manufactured\/mobile home/i);
  });

  it('detects manufactured via reapiFeatures keywords', () => {
    const flags = dealFitFlags({
      propertyType: 'Other',
      reapiFeatures: { landUse: 'Manufactured Home' },
    });
    expect(flags.isManufactured).toBe(true);
  });

  it('detects manufactured via MLS history propertySubType', () => {
    const flags = dealFitFlags({
      reapiMlsHistory: [{ propertySubType: 'Mobile Home' }],
    });
    expect(flags.isManufactured).toBe(true);
  });

  it('detects leased land via reapiFeatures legalDescription', () => {
    const flags = dealFitFlags({
      reapiFeatures: { legalDescription: 'LEASEHOLD INTEREST IN LOT 4' },
    });
    expect(flags.isLeasedLand).toBe(true);
  });

  it('detects leased land via MLS remarks', () => {
    const flags = dealFitFlags({
      reapiMlsRemarks: 'Buyer assumes existing land lease.',
    });
    expect(flags.isLeasedLand).toBe(true);
  });

  it('combines manufactured + leased-land into a single concern line', () => {
    const flags = dealFitFlags({
      propertyType: 'MFR',
      reapiFeatures: { landUse: 'Manufactured home, leased land' },
    });
    expect(flags.isManufactured).toBe(true);
    expect(flags.isLeasedLand).toBe(true);
    expect(flags.concerns[0]).toMatch(/manufactured.*leased land/i);
  });

  it('flags ask-at-or-above ARV (≥0.95)', () => {
    const flags = dealFitFlags({ askingPrice: 380_000, arv: 400_000 });
    expect(flags.askVsArvPct).toBeCloseTo(0.95, 2);
    expect(flags.askIsAtOrAboveArv).toBe(true);
    expect(flags.askIsHighVsArv).toBe(true);
    expect(flags.concerns[0]).toMatch(/at or above.*ARV.*60.70/i);
  });

  it('flags ask-high (≥0.85, <0.95) without claiming "at or above"', () => {
    const flags = dealFitFlags({ askingPrice: 350_000, arv: 400_000 });
    expect(flags.askVsArvPct).toBeCloseTo(0.875, 3);
    expect(flags.askIsHighVsArv).toBe(true);
    expect(flags.askIsAtOrAboveArv).toBe(false);
    expect(flags.concerns[0]).toMatch(/expectations may need to be reset/i);
  });

  it('uses avmExcellentHigh when arv is missing', () => {
    const flags = dealFitFlags({ askingPrice: 200_000, avmExcellentHigh: 250_000 });
    expect(flags.askVsArvPct).toBeCloseTo(0.8, 2);
    expect(flags.askIsHighVsArv).toBe(false);
  });

  it('falls back to reapiEstimatedValue then attomAvm', () => {
    const reapi = dealFitFlags({ askingPrice: 100_000, reapiEstimatedValue: 200_000 });
    expect(reapi.askVsArvPct).toBeCloseTo(0.5, 2);
    const attom = dealFitFlags({ askingPrice: 100_000, attomAvm: 150_000 });
    expect(attom.askVsArvPct).toBeCloseTo(0.667, 2);
  });

  it('returns null askVsArvPct when no AVM is available', () => {
    const flags = dealFitFlags({ askingPrice: 200_000 });
    expect(flags.askVsArvPct).toBeNull();
    expect(flags.askIsHighVsArv).toBe(false);
  });

  it('handles null/undefined lead defensively', () => {
    const flags = dealFitFlags(null);
    expect(flags.hasOpenFitConcern).toBe(false);
    expect(flags.concerns).toEqual([]);
  });
});

describe('propertyContextForPrompt', () => {
  it('returns empty string when nothing useful is known', () => {
    expect(propertyContextForPrompt({})).toBe('');
  });

  it('emits specs and ARV with ask-vs-ARV ratio', () => {
    const out = propertyContextForPrompt({
      bedrooms: 3,
      bathrooms: 2,
      sqft: 1800,
      yearBuilt: 2005,
      arv: 400_000,
      askingPrice: 350_000,
    });
    expect(out).toMatch(/3bd\/2ba\/1,800 sqft, built 2005/);
    expect(out).toMatch(/Estimated ARV: ~\$400,000/);
    expect(out).toMatch(/seller's ask of \$350,000 is 88% of ARV/);
  });

  it('annotates property type with MANUFACTURED HOME tag', () => {
    const out = propertyContextForPrompt({ propertyType: 'MFR' });
    expect(out).toMatch(/Property type: MFR \(MANUFACTURED HOME\)/);
  });

  it('annotates property type with both flags when leased', () => {
    const out = propertyContextForPrompt({
      propertyType: 'MFR',
      reapiFeatures: { legalDescription: 'leasehold' },
    });
    expect(out).toMatch(/MANUFACTURED HOME, LEASED LAND/);
  });

  it('emits the as-is → after-repair range', () => {
    const out = propertyContextForPrompt({ avmPoorHigh: 120_000, avmExcellentHigh: 300_000 });
    expect(out).toMatch(/as-is ~\$120,000 → after-repair ~\$300,000/);
  });

  it('emits last sale with a years-owned label', () => {
    // Subtract 5y + 1d so the 5-year boundary is fully crossed regardless of
    // when in the year the test runs (yearsBetween floors the elapsed ms).
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    fiveYearsAgo.setDate(fiveYearsAgo.getDate() - 1);
    const out = propertyContextForPrompt({
      lastSalePrice: 200_000,
      lastSaleDate: fiveYearsAgo.toISOString(),
    });
    expect(out).toMatch(/Last sale: \$200,000 on \d{4} \(5 years ago\)/);
  });

  it('emits MLS history line and photo count', () => {
    const out = propertyContextForPrompt({
      reapiMlsListDate: new Date('2022-04-01').toISOString(),
      reapiMlsStatus: 'Sold',
      reapiMlsSoldPrice: 410_000,
      reapiMlsPhotos: [{ highRes: 'a' }, { highRes: 'b' }, { highRes: 'c' }],
    });
    expect(out).toMatch(/MLS history: listed 2022, status Sold, sold \$410,000/);
    expect(out).toMatch(/Listing photos available: 3/);
  });

  it('emits photo-derived repair range when latestCompAnalysis is provided', () => {
    const out = propertyContextForPrompt(
      { propertyType: 'SFR' },
      { latestCompAnalysis: { photoRepairLow: 45_000, photoRepairHigh: 80_000 } },
    );
    expect(out).toMatch(/Photo-based repair estimate: \$45,000–\$80,000/);
  });

  it('appends a deal-fit-concerns summary line when concerns exist', () => {
    const out = propertyContextForPrompt({
      propertyType: 'MFR',
      askingPrice: 200_000,
      arv: 200_000,
    });
    expect(out).toMatch(/Deal-fit concerns to surface:/);
    expect(out).toMatch(/manufactured\/mobile home/i);
    expect(out).toMatch(/at or above the estimated ARV/);
  });
});
