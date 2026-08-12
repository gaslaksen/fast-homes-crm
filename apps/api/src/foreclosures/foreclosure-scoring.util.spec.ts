import { ownerOccupiedFrom, parcelLinkFor, addressKeyOf, dupeScore } from './foreclosure-scoring.util';

describe('ownerOccupiedFrom', () => {
  it('calls it owner-occupied when house number and street word match', () => {
    expect(ownerOccupiedFrom('5125 Birchbark Ln', '5125 Birchbark Ln')).toBe('Y');
  });

  it('ignores casing and how the street suffix is spelled', () => {
    expect(ownerOccupiedFrom('5125 BIRCHBARK LANE', '5125 Birchbark Ln')).toBe('Y');
    expect(ownerOccupiedFrom('900 Main St.', '900 Main Street Apt 2')).toBe('Y');
  });

  it('calls it absentee when the house number or street differs', () => {
    expect(ownerOccupiedFrom('42 Birchbark Ln', '5125 Birchbark Ln')).toBe('N');
    expect(ownerOccupiedFrom('5125 Foggy Meadow Rd', '5125 Birchbark Ln')).toBe('N');
  });

  it('stays unknown rather than guessing when either side is missing', () => {
    expect(ownerOccupiedFrom('', '5125 Birchbark Ln')).toBeNull();
    expect(ownerOccupiedFrom('5125 Birchbark Ln', null)).toBeNull();
    // One word on either side is not enough to compare on house number
    // and street, so it stays unknown rather than being called absentee.
    expect(ownerOccupiedFrom('Charlotte', '5125 Birchbark Ln')).toBeNull();
    expect(ownerOccupiedFrom('5125', '5125 Birchbark Ln')).toBeNull();
  });
});

describe('parcelLinkFor', () => {
  it('deep links a Mecklenburg parcel id', () => {
    const link = parcelLinkFor('5125 Birchbark Ln', 'Charlotte', '13507202');

    expect(link.parcelId).toBe('13507202');
    expect(link.parcelType).toBe('exact');
    expect(link.parcelLabel).toBe('PID 13507202');
    expect(link.parcelUrl).toContain('property.spatialest.com/nc/mecklenburg');
    expect(link.parcelUrl).toContain('13507202');
  });

  it('keeps a non-Mecklenburg parcel id but does not point it at Mecklenburg', () => {
    const link = parcelLinkFor('123 Oak St', 'Monroe', '09123456');

    expect(link.parcelId).toBe('09123456');
    expect(link.parcelType).toBe('county');
    expect(link.parcelLabel).toBe('Parcel 09123456');
    expect(link.parcelUrl).not.toContain('spatialest');
    expect(link.parcelUrl).toContain('09123456');
  });

  it('does not assume Mecklenburg for a parcel id with no city', () => {
    expect(parcelLinkFor('123 Oak St', '', '09123456').parcelType).toBe('county');
  });

  it('falls back to the address search when there is no parcel id', () => {
    const meck = parcelLinkFor('5125 Birchbark Ln', 'Charlotte');
    expect(meck.parcelId).toBe('');
    expect(meck.parcelType).toBe('search');
    expect(meck.parcelUrl).toContain('spatialest');

    const other = parcelLinkFor('123 Oak St', 'Monroe');
    expect(other.parcelType).toBe('search');
    expect(other.parcelUrl).toContain('google.com/search');
  });
});

describe('addressKeyOf', () => {
  it('agrees across spelling, case and punctuation of the same address', () => {
    const a = addressKeyOf('10990 Princeton Village Dr.', '28277');
    expect(addressKeyOf('10990 PRINCETON VILLAGE DRIVE', '28277')).toBe(a);
    expect(addressKeyOf('10990 princeton village dr', '28277-1507')).toBe(a);
  });

  it('ignores a unit designator, which varies between filings', () => {
    expect(addressKeyOf('900 Main St Apt 7103', '28202'))
      .toBe(addressKeyOf('900 Main Street', '28202'));
  });

  it('separates two addresses that differ only by zip', () => {
    expect(addressKeyOf('120 Oak St', '28202')).not.toBe(addressKeyOf('120 Oak St', '28277'));
  });

  it('drops only one trailing suffix, never a run', () => {
    // "120 Park Place Drive" must not erode all the way to "120 PARK".
    expect(addressKeyOf('120 Park Place Drive')).toBe('120 PARK PLACE');
  });

  it('returns empty when there is not enough to key on', () => {
    expect(addressKeyOf('')).toBe('');
    expect(addressKeyOf(null)).toBe('');
    expect(addressKeyOf('Charlotte')).toBe('');
  });
});

describe('dupeScore', () => {
  const lead = (detail: any, sellerPhone = '') => ({ sellerPhone, foreclosureDetail: detail });

  it('ranks call notes above every other kind of work', () => {
    const withNotes = dupeScore(lead({ callNotes: 'Spoke to her Tuesday' }));
    const withEverythingElse = dupeScore(
      lead({ workStatus: 'IN_CONVERSATION', doNotCall: true, touchCount: 3 }, '7045551234'),
    );
    expect(withNotes).toBeGreaterThan(0);
    expect(withEverythingElse).toBeGreaterThan(withNotes);
    // ... but notes alone still beat a bare untouched row.
    expect(withNotes).toBeGreaterThan(dupeScore(lead({ workStatus: 'NOT_CONTACTED' })));
  });

  it('scores an untouched row at zero so it loses every tie', () => {
    expect(dupeScore(lead({ workStatus: 'NOT_CONTACTED', doNotCall: false }))).toBe(0);
    expect(dupeScore(lead(null))).toBe(0);
  });

  it('counts this week checkmarks as work', () => {
    expect(dupeScore(lead({ touchDays: { T: true } }))).toBeGreaterThan(0);
  });
});
