import { canonicalize, isTypeMatch } from './property-type';

describe('property-type canonicalize', () => {
  it.each([
    ['Single Family Residential', 'SFR'],
    ['SFR', 'SFR'],
    ['Detached single family', 'SFR'],
    ['House', 'SFR'],
    ['Single-Family', 'SFR'],
  ])('classifies %p as SFR', (raw, expected) => {
    expect(canonicalize(raw).type).toBe(expected);
  });

  it.each([
    ['Manufactured Home', 'MANUFACTURED'],
    ['Mobile Home', 'MANUFACTURED'],
    ['MH', 'MANUFACTURED'],
    ['Single-wide manufactured', 'MANUFACTURED'],
    ['Modular Home', 'MANUFACTURED'],
  ])('classifies %p as MANUFACTURED', (raw, expected) => {
    expect(canonicalize(raw).type).toBe(expected);
  });

  it('classifies condo and coop variants', () => {
    expect(canonicalize('Condominium').type).toBe('CONDO');
    expect(canonicalize('Co-op apartment').type).toBe('CONDO');
  });

  it('classifies townhouse and rowhouse', () => {
    expect(canonicalize('Townhome').type).toBe('TOWNHOUSE');
    expect(canonicalize('Rowhouse').type).toBe('TOWNHOUSE');
  });

  it('classifies small multi-family', () => {
    expect(canonicalize('Duplex').type).toBe('MULTI_2_4');
    expect(canonicalize('3-Family').type).toBe('MULTI_2_4');
    expect(canonicalize('2 unit').type).toBe('MULTI_2_4');
    expect(canonicalize('Triplex').type).toBe('MULTI_2_4');
  });

  it('classifies vacant land', () => {
    expect(canonicalize('Vacant Land').type).toBe('LAND');
    expect(canonicalize('Lot only').type).toBe('LAND');
    expect(canonicalize('Agricultural').type).toBe('LAND');
  });

  it('returns UNKNOWN for empty/garbage input', () => {
    expect(canonicalize('').type).toBe('UNKNOWN');
    expect(canonicalize(null).type).toBe('UNKNOWN');
    expect(canonicalize(undefined).type).toBe('UNKNOWN');
    expect(canonicalize('???').type).toBe('UNKNOWN');
  });

  it('manufactured order beats SFR even when "residential" appears', () => {
    expect(canonicalize('Manufactured residential home').type).toBe(
      'MANUFACTURED',
    );
  });

  it('detects single-wide / double-wide / pre-1976 subtypes', () => {
    const sw = canonicalize('Single-wide mobile home', 1970);
    expect(sw.type).toBe('MANUFACTURED');
    expect(sw.subtypes).toEqual(expect.arrayContaining(['single_wide', 'pre_1976']));

    const dw = canonicalize('Double wide manufactured home', 1990);
    expect(dw.type).toBe('MANUFACTURED');
    expect(dw.subtypes).toEqual(expect.arrayContaining(['double_wide', 'post_1976']));
  });

  it('uses description as a tiebreaker when raw type is generic', () => {
    const r = canonicalize('Property', null, 'Charming single-family home in a quiet neighborhood');
    expect(r.type).toBe('SFR');
  });
});

describe('isTypeMatch', () => {
  it('matches same canonical class', () => {
    const a = canonicalize('Single Family');
    const b = canonicalize('SFR');
    expect(isTypeMatch(a, b)).toBe(true);
  });

  it('rejects SFR vs MANUFACTURED even when sqft/era are similar', () => {
    const sfr = canonicalize('Single Family Residential');
    const mh = canonicalize('Manufactured Home');
    expect(isTypeMatch(sfr, mh)).toBe(false);
  });

  it('UNKNOWN never matches anything', () => {
    const u = canonicalize('');
    const sfr = canonicalize('SFR');
    expect(isTypeMatch(u, sfr)).toBe(false);
    expect(isTypeMatch(sfr, u)).toBe(false);
  });

  it('subtype mismatch within Manufactured does NOT fail isTypeMatch (flag-only)', () => {
    const sw = canonicalize('Single-wide mobile home', 1970);
    const dw = canonicalize('Double-wide manufactured home', 1990);
    expect(isTypeMatch(sw, dw)).toBe(true);
  });
});
