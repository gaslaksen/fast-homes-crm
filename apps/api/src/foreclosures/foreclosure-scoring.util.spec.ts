import { ownerOccupiedFrom, parcelLinkFor } from './foreclosure-scoring.util';

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
