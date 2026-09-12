import { currentAddress, historyKey, parseEndatoPerson, verifiedVia } from './surplus-endato.service';

/**
 * The name-first rung is only safe because of the verification. These pin
 * the shape of a vendor response and the rule that turns a namesake into a
 * refusal, using what came back on the 2026-09-11 test.
 */

/** Shaped like Endato's response for Bernhard Zumsteg, Brevard 250285. */
const ZUMSTEG = {
  name: { firstName: 'Bernhard', lastName: 'Zumsteg' },
  age: 61,
  addresses: [
    { houseNumber: '256', streetName: 'Treu Te', city: 'Palm Bay', state: 'FL', zip: '32907', lastReportedDate: '8/1/2026' },
    { houseNumber: '12', streetName: 'Elm', city: 'Zurich', state: null, zip: null, lastReportedDate: '3/1/2019' },
  ],
  phoneNumbers: [
    { phoneNumber: '(321) 555-0101', phoneType: 'Mobile', isConnected: true },
    { phoneNumber: '3215550101', phoneType: 'Mobile', isConnected: true },
    { phoneNumber: '321-555-0102', phoneType: 'LandLine', isConnected: false },
  ],
  emailAddresses: [{ emailAddress: 'b@example.com' }],
  deathRecords: { isDeceased: false },
  relativesSummary: [{ firstName: 'Anita', lastName: 'Zumsteg', relativeType: 'Spouse' }],
  akas: [{ firstName: 'Bernard', lastName: 'Zumsteg' }],
};

describe('historyKey', () => {
  it('matches the county\'s full street against the vendor\'s abbreviated one', () => {
    // County: "256 TREU TER NW". Vendor: house 256, street "Treu". Same place.
    expect(historyKey('256 TREU TER NW', 'PALM BAY', '32907')).toBe('256 TREU|32907');
    expect(historyKey('256 Treu', 'Palm Bay', '32907')).toBe('256 TREU|32907');
  });

  it('falls back to the city when there is no ZIP, and refuses a street with no number', () => {
    expect(historyKey('30 Post Street Apt 5J', 'Yonkers', null)).toBe('30 POST|YONKERS');
    expect(historyKey('TROPICANA DR', 'INDIAN LAKE ESTATES', '33855')).toBeNull();
    expect(historyKey('0 UNKNOWN', null, null)).toBeNull();
  });
});

describe('parseEndatoPerson', () => {
  it('reads names, dated addresses, deduped phones, emails, relatives and akas whatever the key casing', () => {
    const p = parseEndatoPerson(ZUMSTEG);
    expect(p.first).toBe('Bernhard');
    expect(p.last).toBe('Zumsteg');
    expect(p.addresses[0]).toEqual({ street: '256 Treu Te', city: 'Palm Bay', state: 'FL', zip: '32907', lastSeen: '2026-08-01' });
    // The two spellings of one number collapse; the disconnected one survives, flagged.
    expect(p.phones).toEqual([
      { num: '3215550101', type: 'Mobile', connected: true },
      { num: '3215550102', type: 'LandLine', connected: false },
    ]);
    expect(p.emails).toEqual(['b@example.com']);
    expect(p.deceased).toBe(false);
    expect(p.relatives).toEqual([{ name: 'Anita Zumsteg', type: 'Spouse' }]);
    expect(p.akas).toEqual([{ first: 'Bernard', last: 'Zumsteg' }]);

    // PascalCase keys, as the docs show them, read the same.
    const pascal = parseEndatoPerson({
      Name: { FirstName: 'Juliet', LastName: 'Abe' },
      Addresses: [{ HouseNumber: '30', StreetName: 'Post', City: 'Yonkers', State: 'NY', Zip: '10705', LastReportedDate: '8/1/2026' }],
      PhoneNumbers: [{ PhoneNumber: '9145550199', PhoneType: 'Mobile', IsConnected: true }],
      DeathRecords: { IsDeceased: true },
    });
    expect(pascal.last).toBe('Abe');
    expect(pascal.addresses[0].street).toBe('30 Post');
    expect(pascal.deceased).toBe(true);
  });
});

describe('verifiedVia', () => {
  const person = parseEndatoPerson(ZUMSTEG);

  it('ties a person to the case through the property that sold', () => {
    expect(
      verifiedVia(person, { property: historyKey('256 TREU TER NW', 'PALM BAY', '32907'), mailing: null }),
    ).toBe('property');
  });

  it('or through the address the clerk wrote to', () => {
    const abe = parseEndatoPerson({
      name: { firstName: 'Juliet', lastName: 'Abe' },
      addresses: [{ houseNumber: '30', streetName: 'Post', city: 'Yonkers', state: 'NY', zip: '10705' }],
    });
    expect(
      verifiedVia(abe, { property: historyKey('0 UNKNOWN', null, null), mailing: historyKey('30 POST STREET APT #5J', 'YONKERS', '10705') }),
    ).toBe('mailing');
  });

  it('refuses a namesake with neither address in their history', () => {
    // James Sims, Bradenton: right name, wrong man. Five of these came back.
    const sims = parseEndatoPerson({
      name: { firstName: 'James', lastName: 'Sims' },
      addresses: [{ houseNumber: '529', streetName: '20th', city: 'Bradenton', state: 'FL', zip: '34205' }],
      phoneNumbers: [{ phoneNumber: '9415550100', isConnected: true }],
    });
    expect(
      verifiedVia(sims, { property: historyKey('630 S KENTUCKY AVE', 'COCOA', '32922'), mailing: historyKey('630 S KENTUCKY AVE', 'COCOA', '32922') }),
    ).toBeNull();
  });
});

describe('currentAddress', () => {
  it('is the most recently reported one', () => {
    expect(currentAddress(parseEndatoPerson(ZUMSTEG))?.street).toBe('256 Treu Te');
  });
});
