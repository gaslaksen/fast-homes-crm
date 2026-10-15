import { normalizeMailing, foreignCountry, usStateCode, cityLine } from './surplus-address.util';

/** The addresses the first Charlotte pull (2026-10-15) stored wrong, as the reader returned them. */
describe('normalizeMailing', () => {
  it('keeps a US address in the US shape', () => {
    expect(normalizeMailing({ street: '684 S CLOVER AVENUE', city: 'SAN JOSE', state: 'CA', zip: '95128-1234' })).toEqual({
      street: '684 S CLOVER AVENUE',
      city: 'SAN JOSE',
      state: 'CA',
      zip: '95128',
      country: null,
    });
  });

  it('turns a spelled-out state into its code, where slice(0, 2) made NEW YORK "NE"', () => {
    expect(normalizeMailing({ street: '1 A ST', city: 'BROOKLYN', state: 'New York', zip: '11214' }).state).toBe('NY');
    expect(normalizeMailing({ street: '1 A ST', city: 'X', state: 'FLORIDA', zip: '33950', country: 'USA' })).toMatchObject({
      state: 'FL',
      country: null,
    });
  });

  it('treats Puerto Rico as domestic whichever field names it', () => {
    expect(normalizeMailing({ street: '1 CALLE A', city: 'SAN JUAN', state: 'PR', zip: '00918' }).country).toBeNull();
    expect(normalizeMailing({ street: '1 CALLE A', city: 'SAN JUAN', state: null, zip: '00918', country: 'PUERTO RICO' })).toMatchObject({
      state: 'PR',
      country: null,
    });
  });

  it('keeps a Canadian postcode and province as printed (25-0952)', () => {
    expect(
      normalizeMailing({ street: '3431 DORCAS STREET', city: 'MISSISSAUGA', state: 'ONTARIO', zip: 'L4T 1M9', country: 'CANADA' }),
    ).toEqual({ street: '3431 DORCAS STREET', city: 'MISSISSAUGA', state: 'ONTARIO', zip: 'L4T 1M9', country: 'CANADA' });
  });

  it('knows Canada from the province or postcode when no country was given', () => {
    expect(normalizeMailing({ street: '1 A ST', city: 'MISSISSAUGA', state: 'ON', zip: '' }).country).toBe('CANADA');
    // "CA" beside a Canadian postcode is Canada, not California.
    expect(normalizeMailing({ street: '1 A ST', city: 'MARKHAM', state: 'CA', zip: 'L3R 0B6' }).country).toBe('CANADA');
  });

  it('25-0517: the province read into the city over state CA is Canada', () => {
    expect(normalizeMailing({ street: '8 MARLEY COURT MARKHAM', city: 'ONTARIO', state: 'CA', zip: '' }).country).toBe('CANADA');
    // Ontario, California is a real city with a real ZIP.
    expect(normalizeMailing({ street: '1 A ST', city: 'ONTARIO', state: 'CA', zip: '91761' }).country).toBeNull();
  });

  it('never stores a French postcode as a ZIP (25-0870)', () => {
    const a = normalizeMailing({ street: '12 CHEMIN X', city: 'MALAUCENE', state: null, zip: '84440', country: 'France' });
    expect(a).toMatchObject({ country: 'FRANCE', zip: '84440', state: null });
    // And without a country, a state that is no US state is never kept as one.
    expect(normalizeMailing({ street: '12 CHEMIN X', city: 'MALAUCENE', state: 'FR', zip: '84440' }).country).toBe('OUTSIDE US');
  });

  it('keeps Colombia out of the military "AA" code when the country is given (26-0024)', () => {
    expect(normalizeMailing({ street: 'CALLE 10', city: 'MEDELLIN', state: 'ANTIOQUIA', zip: '05001', country: 'COLOMBIA' })).toMatchObject({
      country: 'COLOMBIA',
      state: 'ANTIOQUIA',
    });
  });

  it('cleans empties and the string "null"', () => {
    expect(normalizeMailing({ street: 'null', city: '', state: null, zip: undefined })).toEqual({
      street: null,
      city: null,
      state: null,
      zip: null,
      country: null,
    });
  });
});

describe('the helpers', () => {
  it('foreignCountry reads every spelling of the US as domestic', () => {
    for (const us of ['US', 'U.S.', 'USA', 'U.S.A.', 'United States', 'UNITED STATES OF AMERICA']) {
      expect(foreignCountry(us)).toBeNull();
    }
    expect(foreignCountry('Canada')).toBe('CANADA');
  });

  it('usStateCode', () => {
    expect(usStateCode('fl')).toBe('FL');
    expect(usStateCode('Ontario')).toBeNull();
  });

  it('cityLine puts the country last', () => {
    expect(cityLine({ city: 'MISSISSAUGA', state: 'ONTARIO', zip: 'L4T 1M9', country: 'CANADA' })).toBe(
      'MISSISSAUGA, ONTARIO L4T 1M9, CANADA',
    );
    expect(cityLine({ city: 'PUNTA GORDA', state: 'FL', zip: '33950', country: null })).toBe('PUNTA GORDA, FL 33950');
  });
});
