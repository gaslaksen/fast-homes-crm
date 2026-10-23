import {
  NO_CONTACTS,
  claimantContacts,
  contactStampPatch,
  gainsContact,
  heirContacts,
} from './surplus-contact-stamp.util';
import { latestDate } from './surplus.service';

describe('gainsContact', () => {
  const had = { phones: ['+19045551234', '9045559876'], emails: ['Pat@Example.com'] };

  it('is true for a number we did not have', () => {
    expect(gainsContact(had, { ...had, phones: [...had.phones, '9045550000'] })).toBe(true);
  });

  it('is true for an email we did not have', () => {
    expect(gainsContact(had, { ...had, emails: [...had.emails, 'pat@work.com'] })).toBe(true);
  });

  it('is true when a number is replaced by a different one', () => {
    expect(gainsContact(had, { ...had, phones: ['+19045551234', '9045550000'] })).toBe(true);
  });

  it('is false for the same numbers in another order', () => {
    // Making phone 2 the primary rewrites both slots and is not news.
    expect(gainsContact(had, { ...had, phones: ['9045559876', '+19045551234'] })).toBe(false);
  });

  it('is false for the same numbers spelled differently', () => {
    expect(
      gainsContact(had, { phones: ['(904) 555-1234', '1-904-555-9876'], emails: ['  pat@example.COM '] }),
    ).toBe(false);
  });

  it('is false when a number is only removed', () => {
    expect(gainsContact(had, { ...had, phones: ['+19045551234'] })).toBe(false);
  });

  it('is false when everything is cleared', () => {
    expect(gainsContact(had, NO_CONTACTS)).toBe(false);
  });

  it('ignores blanks, nulls and the empty sellerPhone a surplus lead starts with', () => {
    expect(gainsContact(NO_CONTACTS, { phones: ['', null, undefined], emails: [null, ''] })).toBe(false);
  });

  it('is true for the first number on a contact that had none', () => {
    expect(gainsContact(NO_CONTACTS, { phones: ['9045551234'], emails: [] })).toBe(true);
  });
});

describe('contactStampPatch', () => {
  const now = new Date('2026-10-23T15:00:00Z');

  it('stamps when something was gained', () => {
    expect(contactStampPatch(NO_CONTACTS, { phones: ['9045551234'], emails: [] }, now)).toEqual({
      contactInfoUpdatedAt: now,
    });
  });

  it('returns nothing to spread when nothing was gained, so the old date stands', () => {
    const same = { phones: ['9045551234'], emails: [] };
    expect(contactStampPatch(same, same, now)).toEqual({});
  });
});

describe('claimantContacts', () => {
  it('reads the best number and email off the Lead and the rest off the detail', () => {
    // A trace that moves the old primary into phone 2 and puts the old phone 2
    // first has found nothing new, even though both tables were rewritten.
    const before = claimantContacts(
      { sellerPhone: '+19045551234', sellerEmail: 'pat@example.com' },
      { phone2: '9045559876', phone3: null, phone4: null, email2: null },
    );
    const after = claimantContacts(
      { sellerPhone: '+19045559876', sellerEmail: 'pat@example.com' },
      { phone2: '9045551234', phone3: null, phone4: null, email2: null },
    );
    expect(gainsContact(before, after)).toBe(false);
  });

  it('copes with a lead that has no detail yet', () => {
    expect(claimantContacts(null, undefined)).toEqual({
      phones: [undefined, undefined, undefined, undefined],
      emails: [undefined, undefined],
    });
  });
});

describe('heirContacts', () => {
  it('reads all four phone slots and both emails off the row', () => {
    const c = heirContacts({ phone1: '1', phone2: '2', phone3: '3', phone4: '4', email1: 'a', email2: 'b' });
    expect(c).toEqual({ phones: ['1', '2', '3', '4'], emails: ['a', 'b'] });
  });
});

describe('latestDate', () => {
  it('compares instants, not the weekday a string form starts with', () => {
    // As strings Thursday the 22nd sorts after Friday the 23rd, because "Thu"
    // comes after "Fri", which is how the old sort().pop() picked it.
    const thu = new Date('2026-10-22T16:00:00Z');
    const fri = new Date('2026-10-23T16:00:00Z');
    expect([thu, fri].sort().pop()).toEqual(thu);
    expect(latestDate([fri, thu])).toEqual(fri);
    expect(latestDate([thu, fri])).toEqual(fri);
  });

  it('accepts ISO strings and skips blanks', () => {
    expect(latestDate([null, '2026-10-01T00:00:00Z', undefined, '2026-09-01T00:00:00Z'])).toEqual(
      new Date('2026-10-01T00:00:00Z'),
    );
  });

  it('is null when there is nothing to compare', () => {
    expect(latestDate([null, undefined])).toBeNull();
  });
});
