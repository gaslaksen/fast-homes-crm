import { SurplusProbateService } from './surplus-probate.service';

/**
 * Parsing a probate filing.
 *
 * The vision call is not exercised here; what is pinned is what survives the
 * parse, because that is what gets written to the board and skip traced. The
 * cases below are taken from the real Duval filing for 1624 W 35th St
 * (16-2025-CP-002981), which carries every trap worth having a test for.
 */
const svc = () => new SurplusProbateService({ get: () => 'test-key' } as any);

const SPENCER = JSON.stringify({
  decedent: 'ALFRED SPENCER',
  dateOfDeath: '2021-02-24',
  caseNumber: '16-2025-CP-002981-AXXX-MA',
  propertyAddress: '1624 W. 35th St., Jacksonville, FL, 32209',
  parcelId: '16465-1810',
  heirs: [
    {
      name: 'Alfred J. Spencer',
      relationship: 'Son, Petitioner, and Beneficiary',
      share: '50% Remainder Interest',
      street: '7789 Andes Drive',
      city: 'Jacksonville',
      state: 'fl',
      zip: '32244',
      deceased: false,
      dateOfDeath: null,
    },
    {
      name: 'Helen F. Sherman',
      relationship: 'Daughter and Beneficiary',
      share: '50% Remainder Interest',
      street: '5407 Turkey Creek Road',
      city: 'Jacksonville',
      state: 'Fl',
      zip: '32244-1234',
      deceased: false,
      dateOfDeath: null,
    },
    {
      name: 'Estate of Leila Spencer, Deceased',
      relationship: 'Surviving Spouse and Beneficiary',
      share: 'Life Estate Interest',
      street: '1624 W. 35th St.',
      city: 'Jacksonville',
      state: 'FL',
      zip: '32209',
      deceased: true,
      dateOfDeath: '2022-03-25',
    },
  ],
  warnings: [],
});

describe('SurplusProbateService.parse', () => {
  it('pulls the heirs, their own addresses, and their shares', () => {
    const out = svc().parse(SPENCER);

    expect(out.decedent).toBe('ALFRED SPENCER');
    expect(out.caseNumber).toBe('16-2025-CP-002981-AXXX-MA');
    expect(out.heirs.map((h) => h.name)).toEqual([
      'Alfred J. Spencer',
      'Helen F. Sherman',
      'Estate of Leila Spencer, Deceased',
    ]);

    // The point of the whole exercise: the son's OWN address, not the dead
    // owner's house that the tax roll still has him at.
    expect(out.heirs[0].street).toBe('7789 Andes Drive');
    expect(out.heirs[1].street).toBe('5407 Turkey Creek Road');
  });

  it('keeps a deceased heir rather than dropping them', () => {
    // Leila is dead. Recording her is what stops somebody dialling her, and her
    // life estate share needs its own estate opened.
    const leila = svc().parse(SPENCER).heirs.find((h) => /Leila/.test(h.name))!;
    expect(leila.deceased).toBe(true);
    expect(leila.dateOfDeath).toBe('2022-03-25');
    expect(leila.share).toBe('Life Estate Interest');
  });

  it('keeps relationship and share verbatim', () => {
    // These decide who can sign. A life estate holder cannot sell alone, and
    // normalising "Son, Petitioner, and Beneficiary" to "Son" loses that he is
    // the one who filed.
    const out = svc().parse(SPENCER);
    expect(out.heirs[0].relationship).toBe('Son, Petitioner, and Beneficiary');
    expect(out.heirs[2].share).toBe('Life Estate Interest');
  });

  it('normalises only state and zip, which are matched on', () => {
    const out = svc().parse(SPENCER);
    expect(out.heirs[0].state).toBe('FL');
    expect(out.heirs[1].state).toBe('FL');
    // A ZIP+4 is trimmed to five, which is what the skip trace sends.
    expect(out.heirs[1].zip).toBe('32244');
  });

  it('drops an heir with no name', () => {
    // A nameless row cannot be confirmed against the document and cannot be
    // traced, so it is worse than absent.
    const out = svc().parse(
      JSON.stringify({ heirs: [{ name: '  ', street: '1 Main St' }, { name: 'Real Person' }] }),
    );
    expect(out.heirs.map((h) => h.name)).toEqual(['Real Person']);
  });

  it('warns when a filing yields no heirs at all', () => {
    const out = svc().parse(JSON.stringify({ decedent: 'X', heirs: [] }));
    expect(out.warnings.join(' ')).toMatch(/No heirs were found/i);
  });

  it('warns when every heir is dead, since there is nobody to call', () => {
    const out = svc().parse(
      JSON.stringify({ heirs: [{ name: 'A', deceased: true }, { name: 'B', deceased: true }] }),
    );
    expect(out.warnings.join(' ')).toMatch(/nobody here to contact/i);
  });

  it('carries the model\'s own warnings through', () => {
    // The real Spencer filing names parcel 16465-1810, which resolves at the
    // Property Appraiser to 7789 Andes Dr, the SON's house, not the property
    // that sold. The attorney copied the wrong parcel in. A warning has to
    // survive the parse or nobody sees it.
    const out = svc().parse(
      JSON.stringify({
        heirs: [{ name: 'A' }],
        warnings: ['The parcel ID and the property address describe different properties.'],
      }),
    );
    expect(out.warnings[0]).toMatch(/different properties/);
  });

  it('reads a value out of a reply wrapped in prose', () => {
    const out = svc().parse('Here is what I found:\n{"decedent":"X","heirs":[{"name":"Y"}]}\nHope that helps.');
    expect(out.decedent).toBe('X');
  });

  it('refuses a reply with no JSON rather than inventing an empty result', () => {
    // Silently returning zero heirs would read as "this filing has none",
    // which is a different and wrong fact.
    expect(() => svc().parse('I could not read this document.')).toThrow(/could not be read/i);
  });

  it('rejects a bad date instead of storing a broken one', () => {
    const out = svc().parse(JSON.stringify({ dateOfDeath: '02/24/2021', heirs: [{ name: 'A' }] }));
    expect(out.dateOfDeath).toBeNull();
  });
});
