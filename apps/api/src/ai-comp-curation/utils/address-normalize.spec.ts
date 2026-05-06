import { normalizeAddress, compactAddressKey } from './address-normalize';

describe('normalizeAddress', () => {
  it.each([
    ['123 Main St', '123 main street'],
    ['123 main street', '123 main street'],
    ['123 Main St.', '123 main street'],
    ['  123   Main   St  ', '123 main street'],
    ['123 N Main St', '123 north main street'],
    ['123 n. main st.', '123 north main street'],
    ['456 NW Maple Ave', '456 northwest maple avenue'],
    ['100 Oak Blvd', '100 oak boulevard'],
    ['200 Pine Ct', '200 pine court'],
    ['300 Elm Dr', '300 elm drive'],
    ['400 Birch Ln', '400 birch lane'],
    ['500 Cedar Rd', '500 cedar road'],
    ['600 Aspen Pl', '600 aspen place'],
    ['700 Park Sq', '700 park square'],
    ['800 Linden Ter', '800 linden terrace'],
  ])('normalizes %p → %p', (raw, expected) => {
    expect(normalizeAddress(raw)).toBe(expected);
  });

  it('drops apt/unit/suite tokens', () => {
    expect(normalizeAddress('123 Main St Apt 4B')).toBe('123 main street');
    expect(normalizeAddress('123 Main St, Unit 12')).toBe('123 main street');
    expect(normalizeAddress('123 Main St Suite 200')).toBe('123 main street');
    expect(normalizeAddress('123 Main St #5')).toBe('123 main street');
  });

  it('handles full address with city/state/zip', () => {
    expect(normalizeAddress('1513 Shirley Dr, Beckley, WV 25801')).toBe(
      '1513 shirley drive beckley wv 25801',
    );
  });

  it('returns empty for null / undefined / empty', () => {
    expect(normalizeAddress(null)).toBe('');
    expect(normalizeAddress(undefined)).toBe('');
    expect(normalizeAddress('')).toBe('');
    expect(normalizeAddress('   ')).toBe('');
  });

  it('matches REAPI vs BatchData formatting variants', () => {
    // REAPI typically returns "1513 Shirley Dr, Beckley, WV 25801"
    // BatchData formatAddress returns "1513 shirley dr, beckley, WV 25801"
    const a = normalizeAddress('1513 Shirley Dr, Beckley, WV 25801');
    const b = normalizeAddress('1513 shirley dr, beckley, WV 25801');
    expect(a).toBe(b);
  });
});

describe('compactAddressKey', () => {
  it('produces houseNum|street|zip when possible', () => {
    expect(compactAddressKey('1513 Shirley Dr, Beckley, WV 25801')).toBe(
      '1513|shirley|25801',
    );
  });

  it('skips directionals when picking street word', () => {
    expect(compactAddressKey('100 N Main St, Town, ST 12345')).toBe(
      '100|main|12345',
    );
  });

  it('falls back to full normalized when no zip', () => {
    expect(compactAddressKey('1513 Shirley Dr')).toBe('1513 shirley drive');
  });

  it('falls back to full normalized when house number missing', () => {
    expect(compactAddressKey('Main Street')).toBe('main street');
  });
});
