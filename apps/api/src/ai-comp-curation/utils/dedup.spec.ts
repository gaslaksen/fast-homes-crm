import { dedupCandidates, DedupCandidate } from './dedup';

const baseSoldDate = new Date('2026-04-01').toISOString();

const c = (overrides: Partial<DedupCandidate>): DedupCandidate => ({
  id: 'id',
  address: '123 Main St, Town, ST 12345',
  apn: null,
  latitude: null,
  longitude: null,
  bedrooms: 3,
  bathrooms: 2,
  sqft: 1500,
  source: 'reapi',
  photoUrl: null,
  features: null,
  soldDate: baseSoldDate,
  ...overrides,
});

describe('dedupCandidates', () => {
  it('returns empty result for empty input', () => {
    const out = dedupCandidates([]);
    expect(out.rawCount).toBe(0);
    expect(out.uniqueCount).toBe(0);
    expect(out.removedCount).toBe(0);
  });

  it('returns each unique row as its own group', () => {
    const rows = [
      c({ id: 'a', address: '1 Main St, Town, ST 12345' }),
      c({ id: 'b', address: '2 Main St, Town, ST 12345' }),
      c({ id: 'c', address: '3 Main St, Town, ST 12345' }),
    ];
    const out = dedupCandidates(rows);
    expect(out.uniqueCount).toBe(3);
    expect(out.removedCount).toBe(0);
    expect(out.corroboratedCount).toBe(0);
  });

  it('collapses by APN even when addresses differ in formatting', () => {
    const rows = [
      c({ id: 'a', apn: 'P-1234', address: '1513 SHIRLEY DR' }),
      c({ id: 'b', apn: 'P-1234', address: '1513 Shirley Drive' }),
    ];
    const out = dedupCandidates(rows);
    expect(out.uniqueCount).toBe(1);
    expect(out.removedCount).toBe(1);
    expect(out.groups[0].matchedBy).toBe('apn');
  });

  it('collapses by normalized address', () => {
    const rows = [
      c({ id: 'a', address: '100 Main St, Beckley, WV 25801' }),
      c({ id: 'b', address: '100 main street, beckley, WV 25801' }),
    ];
    const out = dedupCandidates(rows);
    expect(out.uniqueCount).toBe(1);
    expect(out.removedCount).toBe(1);
    expect(out.groups[0].matchedBy).toBe('address');
  });

  it('collapses by geo + spec match', () => {
    const rows = [
      c({
        id: 'a',
        address: '100 Main St',
        latitude: 37.7749,
        longitude: -122.4194,
        bedrooms: 3,
        bathrooms: 2,
        sqft: 1500,
      }),
      c({
        id: 'b',
        // Different formatting — won't match by address
        address: '100 Mainstreet',
        // Within ~50ft (0.0001 deg latitude ≈ 36ft)
        latitude: 37.7749 + 0.0001,
        longitude: -122.4194,
        bedrooms: 3,
        bathrooms: 2,
        sqft: 1525, // within 5%
      }),
    ];
    const out = dedupCandidates(rows);
    expect(out.uniqueCount).toBe(1);
    expect(out.groups.find((g) => g.duplicateIds.length > 0)?.matchedBy).toBe(
      'geo+spec',
    );
  });

  it('does NOT collapse when sqft delta exceeds 5%', () => {
    const rows = [
      c({
        id: 'a',
        address: 'A',
        latitude: 37.7749,
        longitude: -122.4194,
        sqft: 1500,
      }),
      c({
        id: 'b',
        address: 'B',
        latitude: 37.7749,
        longitude: -122.4194,
        sqft: 1700, // +13%, too far
      }),
    ];
    const out = dedupCandidates(rows);
    expect(out.uniqueCount).toBe(2);
  });

  it('marks group as corroborated when 2+ providers contributed', () => {
    const rows = [
      c({ id: 'a', source: 'reapi', address: '100 Main St' }),
      c({ id: 'b', source: 'batchdata', address: '100 Main Street' }),
    ];
    const out = dedupCandidates(rows);
    expect(out.uniqueCount).toBe(1);
    expect(out.corroboratedCount).toBe(1);
    expect(out.groups[0].sources.sort()).toEqual(['batchdata', 'reapi']);
    expect(out.groups[0].corroborated).toBe(true);
  });

  it('canonical pick prefers row with photos', () => {
    const rows = [
      c({ id: 'noPhoto', address: '100 Main St', photoUrl: null, source: 'batchdata' }),
      c({ id: 'photo', address: '100 Main Street', photoUrl: 'https://x/y.jpg', source: 'reapi' }),
    ];
    const out = dedupCandidates(rows);
    expect(out.survivors[0].id).toBe('photo');
  });

  it('canonical pick falls back to most recent soldDate', () => {
    const oldDate = new Date('2026-01-01').toISOString();
    const newDate = new Date('2026-04-01').toISOString();
    const rows = [
      c({ id: 'old', address: '100 Main St', soldDate: oldDate }),
      c({ id: 'new', address: '100 Main Street', soldDate: newDate }),
    ];
    const out = dedupCandidates(rows);
    expect(out.survivors[0].id).toBe('new');
  });

  it('tags canonical with features.dedup metadata', () => {
    const rows = [
      c({ id: 'a', source: 'reapi', address: '100 Main St' }),
      c({ id: 'b', source: 'batchdata', address: '100 Main Street' }),
    ];
    const out = dedupCandidates(rows);
    const dedupMeta = (out.survivors[0].features as any)?.dedup;
    expect(dedupMeta).toBeDefined();
    expect(dedupMeta.count).toBe(2);
    expect(dedupMeta.corroborated).toBe(true);
    expect(dedupMeta.sources.sort()).toEqual(['batchdata', 'reapi']);
    expect(dedupMeta.matchedBy).toBe('address');
  });

  it('tags singletons with count=1 and corroborated=false', () => {
    const rows = [c({ id: 'solo', address: 'unique address only' })];
    const out = dedupCandidates(rows);
    const dedupMeta = (out.survivors[0].features as any)?.dedup;
    expect(dedupMeta.count).toBe(1);
    expect(dedupMeta.corroborated).toBe(false);
  });

  it('preserves existing features when tagging dedup', () => {
    const rows = [
      c({
        id: 'a',
        address: '100 Main St',
        features: { mlsNumber: '12345', custom: 'value' } as any,
      }),
    ];
    const out = dedupCandidates(rows);
    const features = out.survivors[0].features as any;
    expect(features.mlsNumber).toBe('12345');
    expect(features.custom).toBe('value');
    expect(features.dedup).toBeDefined();
  });

  it('APN dedup beats address dedup when both apply', () => {
    const rows = [
      c({ id: 'a', apn: 'P-1', address: '100 Main St' }),
      c({ id: 'b', apn: 'P-1', address: '999 Different Ave' }), // different address but same APN
      c({ id: 'c', address: '100 main street' }), // matches a by address but not APN
    ];
    const out = dedupCandidates(rows);
    // a and b collapse via APN; c stays separate (it has no APN, addr matches a but a is already grouped)
    expect(out.uniqueCount).toBe(2);
    const apnGroup = out.groups.find((g) => g.matchedBy === 'apn');
    expect(apnGroup).toBeDefined();
  });
});
