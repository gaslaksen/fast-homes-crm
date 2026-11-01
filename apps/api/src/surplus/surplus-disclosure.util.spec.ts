import { DisclosureHoldException, disclosureHolds, namesDollarFigure, sourceWordsIn } from './surplus-disclosure.util';

const relative = { audience: 'relative' as const, signed: false };
const claimant = { audience: 'claimant' as const, signed: false };
const signed = { audience: 'claimant' as const, signed: true };

describe('what a text to a relative may say', () => {
  it('holds the amount, however it is written', () => {
    for (const t of [
      'Hi Robert, your family is owed over $40,000 from a sale.',
      'There is about 12,500 dollars waiting.',
      'Roughly $12k is unclaimed.',
      'It is over 40,000 and we can help.',
      'Your dad has {{surplus}} coming.',
    ]) {
      expect(disclosureHolds(t, relative)[0]).toContain('dollar figure');
    }
  });

  it('holds the source words', () => {
    const holds = disclosureHolds('Your father had a tax deed sale in Hernando County and the clerk is holding money.', relative);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toContain('tax deed, county, clerk');
  });

  it('passes the relative script as written', () => {
    const t =
      'Hi Robert, this is Ian with D.I.G. Deeper. We have been unable to reach Dorothy Kessler, and our research indicates you may be a relative. Dorothy may have unclaimed funds available. Would you pass this message along, or share a way to reach her? Reply STOP to opt out.';
    expect(disclosureHolds(t, relative)).toEqual([]);
  });

  it('does not mistake a phone number, a date or a time for an amount', () => {
    for (const t of ['Call me at (352) 555-0141.', 'Call back after 3:30.', 'We mailed it 10/21/2026.', 'Case opened in 2025.']) {
      expect(namesDollarFigure(t)).toBe(false);
    }
  });
});

describe('what a text to the claimant may say', () => {
  it('may name the amount before signing: that is the phone script', () => {
    expect(disclosureHolds('Dorothy, you have about $40,000 in unclaimed funds. Can we talk today?', claimant)).toEqual([]);
  });

  it('holds the source before the fee agreement is signed', () => {
    const holds = disclosureHolds('The surplus from the tax deed sale is with the Hernando County clerk.', claimant);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toContain('before the fee agreement is signed');
  });

  it('allows the source once signed', () => {
    expect(disclosureHolds('Your Hernando County surplus claim was filed with the clerk today.', signed)).toEqual([]);
  });

  it('an empty draft holds nothing', () => {
    expect(disclosureHolds('', relative)).toEqual([]);
  });
});

describe('the hold as the composer sees it', () => {
  it('is a 400 that names the recipient and every reason', () => {
    const e = new DisclosureHoldException('ROBERT KESSLER', ['It names a dollar figure.', 'It says where the money comes from (county).']);
    expect(e.getStatus()).toBe(400);
    expect(e.message).toBe('Held, not sent to ROBERT KESSLER. It names a dollar figure. It says where the money comes from (county).');
    expect(e.holds).toHaveLength(2);
  });

  it('lists the source words it saw', () => {
    expect(sourceWordsIn('foreclosure overage, parcel 123')).toEqual(['overage', 'foreclosure', 'parcel']);
  });
});
