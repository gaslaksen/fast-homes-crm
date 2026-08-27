import {
  nameSearchLinks,
  nameSearchPlan,
  relativeOutreachScript,
} from './surplus-name-search.util';

describe('nameSearchLinks', () => {
  it('puts the free sources first', () => {
    // They answer most cases without a subscription, so they should be what
    // somebody clicks by default.
    const links = nameSearchLinks('MYRTIS GRIFFIN', 'CT');
    expect(links[0].free).toBe(true);
    expect(links.filter((l) => l.free).length).toBeGreaterThanOrEqual(3);
  });

  it('encodes a name safely into every URL', () => {
    // An apostrophe is legal in a query string and encodeURIComponent leaves it
    // alone, so what matters is that the URL parses and carries no raw spaces,
    // not that every character is percent-encoded.
    const links = nameSearchLinks("MARY O'BRIEN-SMITH", 'FL');
    for (const l of links) {
      expect(() => new URL(l.url)).not.toThrow();
      expect(l.url).not.toContain(' ');
      expect(l.url.toLowerCase()).toMatch(/brien/);
    }
  });

  it('still builds links when no state is known', () => {
    const links = nameSearchLinks('MYRTIS GRIFFIN');
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(() => new URL(l.url)).not.toThrow();
  });

  it('returns nothing for an empty name rather than a broken search', () => {
    expect(nameSearchLinks('')).toEqual([]);
    expect(nameSearchLinks('   ')).toEqual([]);
  });
});

describe('nameSearchPlan', () => {
  const griffin = {
    claimant: 'MYRTIS GRIFFIN',
    ownerState: 'CT',
    propertyAddress: '0 HARDEE ST',
    propertyCity: 'JACKSONVILLE',
    mailVerdict: 'undeliverable',
  };

  it('searches the OWNER state, not the property state', () => {
    // Griffin lost a Florida parcel and lives in Connecticut. Searching Florida
    // finds nothing at all.
    const p = nameSearchPlan(griffin)!;
    expect(p.state).toBe('CT');
  });

  it('verifies against the property, which is the only tie back to the surplus', () => {
    // A name in another state means nothing until a result shows this address
    // in its history.
    const p = nameSearchPlan(griffin)!;
    expect(p.verifyAgainst).toBe('0 HARDEE ST, JACKSONVILLE');
  });

  it('explains why the address route is unavailable', () => {
    expect(nameSearchPlan(griffin)!.reason).toMatch(/returned/i);
  });

  it('gives no reason when the address route is still open', () => {
    expect(nameSearchPlan({ ...griffin, mailVerdict: 'delivered' })!.reason).toBeUndefined();
  });

  it('routes an entity to Sunbiz and nowhere else', () => {
    // A consumer people search on an LLC returns nothing or a stranger. The
    // registered agent is the person who can sign.
    const p = nameSearchPlan({
      claimant: 'HEAVENLY HANDS FUNDING, LLC',
      ownerState: 'FL',
      isEntity: true,
    })!;
    expect(p.links).toHaveLength(1);
    expect(p.links[0].site).toMatch(/sunbiz/i);
    expect(p.reason).toMatch(/registered agent/i);
    // No point verifying an entity against a property address.
    expect(p.verifyAgainst).toBeNull();
  });

  it('returns null for a claimant with no name', () => {
    expect(nameSearchPlan({ claimant: '' })).toBeNull();
  });
});

describe('relativeOutreachScript', () => {
  it('frames the relative as a referral, not the claimant', () => {
    const s = relativeOutreachScript('MYRTIS GRIFFIN', 'Bertha Griffin');
    expect(s).toContain('Bertha Griffin');
    expect(s).toContain('MYRTIS GRIFFIN');
    expect(s).toMatch(/pass the message on|contact details/i);
  });

  it('never tells a third party the amount', () => {
    // That is the claimant's business, and naming a figure to somebody else
    // invites them to go after it.
    const s = relativeOutreachScript('MYRTIS GRIFFIN', 'Bertha Griffin');
    expect(s).toMatch(/Do not name the amount/i);
    expect(s).not.toMatch(/\$/);
  });

  it('reads sensibly when the relative has no name', () => {
    expect(relativeOutreachScript('MYRTIS GRIFFIN')).toMatch(/^This contact is not the claimant/);
  });
});
