import {
  normalizeMailing,
  foreignCountry,
  usStateCode,
  cityLine,
  surplusAddressKey,
  isPoBox,
  hasHouseNumber,
  untriedForIdi,
  idiAddressesLeft,
  isMailDrop,
  splitOneLineUsAddress,
  stateForZip,
  addressCore,
  sameAddress,
  splitStreetCity,
  nextIdiAddress,
} from './surplus-address.util';

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

describe('surplusAddressKey', () => {
  it('keys one address the same however it is punctuated', () => {
    expect(surplusAddressKey('576 EASTERN PKWY #3G', '11225')).toBe('576EASTERNPKWY3G|11225');
    expect(surplusAddressKey('576 Eastern Pkwy 3G', '11225-4410')).toBe('576EASTERNPKWY3G|11225');
    expect(surplusAddressKey('30 GUILDWOOD DR', null)).toBe('30GUILDWOODDR|');
  });
});

describe('the IDI round order', () => {
  it('tells a post office box from a rural route box, which is a home', () => {
    expect(isPoBox('PO Box 12')).toBe(true);
    expect(isPoBox('P.O. BOX 881')).toBe(true);
    expect(isPoBox('Post Office Box 4')).toBe(true);
    expect(isPoBox('RT 1 BOX 15')).toBe(false);
    expect(isPoBox('12 Box Elder Dr')).toBe(false);
    expect(hasHouseNumber('RR 2 BOX 15')).toBe(true);
    expect(hasHouseNumber('HC 65 Box 10')).toBe(true);
    expect(hasHouseNumber('4808 4th St W')).toBe(true);
    expect(hasHouseNumber('0 Sample Ct')).toBe(false);
    expect(hasHouseNumber('Lot 7 Pine Ridge')).toBe(false);
  });

  it('puts the card first, then the clerk letter, then other streets, then boxes and foreign never', () => {
    const at = (street: string, source: string, extra: any = {}) => ({ street, city: 'X', state: 'FL', zip: '33901', source, status: 'untried', ...extra });
    const list = [
      at('PO Box 9', 'surplus_letter_notifications'),
      at('5 Party St', 'case_parties'),
      at('9 Letter Ave', 'notice_of_surplus_funds'),
      at('1 Card Ct', 'surplus_letter_notifications'),
      at('2 Tried Rd', 'surplus_letter_notifications', { status: 'miss' }),
      at('3 Rue', 'surplus_letter_notifications', { country: 'FRANCE' }),
    ];
    expect(untriedForIdi(list, surplusAddressKey('1 Card Ct', '33901')).map((a) => a.street)).toEqual([
      '1 Card Ct',
      '9 Letter Ave',
      '5 Party St',
      'PO Box 9',
    ]);
  });

  it('counts the property as the last round when it is a house no batch has sent', () => {
    const lead = { propertyAddress: '12 Oak St', propertyCity: 'Inverness', propertyState: 'FL', propertyZip: '34450' };
    expect(idiAddressesLeft({ addresses: [] }, lead)).toBe(1);
    expect(idiAddressesLeft({ addresses: [] }, { ...lead, propertyAddress: '0 Lot Rd' })).toBe(0);
    expect(
      idiAddressesLeft({ addresses: [{ street: '12 Oak St', city: 'Inverness', state: 'FL', zip: '34450', source: 'property', status: 'miss' }] }, lead),
    ).toBe(0);
    // Without the lead, only the list counts.
    expect(idiAddressesLeft({ addresses: [] })).toBe(0);
  });

  it('counts the card address as left when the list does not hold it yet', () => {
    expect(idiAddressesLeft({ ownerMailingStreet: '1 Card Ct', ownerMailingCity: 'X', ownerMailingState: 'FL', addresses: [] })).toBe(1);
    expect(
      idiAddressesLeft({
        ownerMailingStreet: '1 Card Ct',
        ownerMailingCity: 'X',
        ownerMailingState: 'FL',
        ownerMailingZip: '33901',
        addresses: [{ street: '1 CARD CT', city: 'X', state: 'FL', zip: '33901', source: 'manual', status: 'miss' }],
      }),
    ).toBe(0);
  });
});

describe('splitOneLineUsAddress', () => {
  it('splits a whole US address typed into the street box', () => {
    // The shapes B001 found on cards: comma between state and zip, or none.
    expect(splitOneLineUsAddress('320 N 40TH ST APT 1, PHILADELPHIA, PA, 19104')).toEqual({
      street: '320 N 40TH ST APT 1',
      city: 'PHILADELPHIA',
      state: 'PA',
      zip: '19104',
    });
    expect(splitOneLineUsAddress('100 Cypress Ln, Mars, PA 16046-1234')).toEqual({ street: '100 Cypress Ln', city: 'Mars', state: 'PA', zip: '16046' });
  });

  it('leaves a foreign one-line address and a plain street alone', () => {
    expect(splitOneLineUsAddress("999 WILLIBRORD AVE, VERDUN, Quebec H9G 9T9")).toBeNull();
    expect(splitOneLineUsAddress('99 BRETT CRESCENT, HALLETT COVE SA 5158,')).toBeNull();
    expect(splitOneLineUsAddress('48 Village Ct')).toBeNull();
  });
});

describe('mail drops', () => {
  it('sends a suite after every street someone could live at', () => {
    expect(isMailDrop('6900 WESTCLIFF DRIVE SUITE 603')).toBe(true);
    expect(isMailDrop('5775 NW 7th St Ste 200')).toBe(true);
    expect(isMailDrop('12 Sweet Ln')).toBe(false);
    const at = (street: string) => ({ street, city: 'X', state: 'NV', zip: '89145', source: 'notice_of_surplus_funds', status: 'untried' });
    const card = surplusAddressKey('6900 WESTCLIFF DRIVE SUITE 603', '89145');
    expect(untriedForIdi([at('6900 WESTCLIFF DRIVE SUITE 603'), at('7 Home Rd')], card).map((a) => a.street)).toEqual([
      '7 Home Rd',
      '6900 WESTCLIFF DRIVE SUITE 603',
    ]);
  });
});

describe('stateForZip', () => {
  it('names the state a ZIP belongs to', () => {
    expect(stateForZip('07302')).toBe('NJ');
    expect(stateForZip('03301')).toBe('NH');
    expect(stateForZip('33971')).toBe('FL');
    expect(stateForZip('00927')).toBe('PR');
    expect(stateForZip('89145')).toBe('NV');
    expect(stateForZip('20191')).toBe('VA');
  });

  it('says nothing for a military or short ZIP', () => {
    expect(stateForZip('09841')).toBeNull();
    expect(stateForZip('34002')).toBeNull();
    expect(stateForZip('123')).toBeNull();
    expect(stateForZip(null)).toBeNull();
  });
});

describe('sameAddress', () => {
  // Retyped copies of addresses IDI had already missed, from 2026-11-05.
  it('sees a care-of line, a rural route spelling and a cut-off copy as one address', () => {
    expect(addressCore('C/O MARINE BARTLE 123 N ELM AVE')).toBe('123NELMAVE');
    expect(addressCore('CO EXAMPLE ENTERPRISES INC 8101 BISCAYNE BLVD 401')).toBe('8101BISCAYNEBLVD401');
    expect(sameAddress({ street: 'C/O MARINE BARTLE 123 N ELM AVE', state: 'IL' }, { street: '123 N ELM AVE', state: 'IL' })).toBe(true);
    expect(sameAddress({ street: 'RR 1 BOX 61', state: 'WV' }, { street: 'RT 1 BOX 61', state: 'WV' })).toBe(true);
    expect(sameAddress({ street: 'A-7 URB CARIBE C/O EXAMPLE COR', state: 'PR' }, { street: 'A-7 URB CARIBE C/O EXAMPLE CORP.', state: 'PR' })).toBe(true);
    expect(sameAddress({ street: 'C/O PAT SAMPLE, 3209 E KENDALL LANE', state: 'IN' }, { street: '3209 E KENDALL LANE', state: 'IN' })).toBe(true);
  });

  it('keeps different places apart', () => {
    expect(sameAddress({ street: 'C/O LES SAMPLE P.O. BOX 216', state: 'TX' }, { street: '232 BLANCO DRIVE', state: 'TX' })).toBe(false);
    expect(sameAddress({ street: '123 N ELM AVE', state: 'IL' }, { street: '123 N ELM AVE', state: 'OH' })).toBe(false);
    expect(sameAddress({ street: '12 OAK ST', state: 'FL' }, { street: '12 OAK STREET APT 4', state: 'FL' })).toBe(false);
  });

  it('does not count a retyped copy of a tried address as untried', () => {
    const at = (street: string, status: string) => ({ street, city: 'Elmhurst', state: 'IL', zip: '60126', source: 'case_parties', status });
    expect(untriedForIdi([at('123 N ELM AVE', 'miss'), at('C/O MARINE BARTLE 123 N ELM AVE', 'untried')])).toEqual([]);
  });
});

describe('splitStreetCity', () => {
  it('splits the one-line property Citrus stores', () => {
    expect(splitStreetCity('4016 E SANDERS ST, INVERNESS, FL')).toEqual({ street: '4016 E SANDERS ST', city: 'INVERNESS', state: 'FL', zip: null });
    expect(splitStreetCity('12 Oak St, Ocala, FL 34470')).toEqual({ street: '12 Oak St', city: 'Ocala', state: 'FL', zip: '34470' });
    expect(splitStreetCity('12 Oak St')).toBeNull();
  });

  it('lets the export send a Citrus property as the last round', () => {
    const lead = { propertyAddress: '4016 E SANDERS ST, INVERNESS, FL', propertyCity: '', propertyState: 'FL', surplusDetail: { addresses: [] } };
    expect(nextIdiAddress(lead)).toEqual({
      address: { street: '4016 E SANDERS ST', city: 'INVERNESS', state: 'FL', zip: null, source: 'property' },
    });
  });
});
