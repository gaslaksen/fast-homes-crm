// Pre-AI dedup. The candidate pool reaching the AI typically contains
// 30-40% duplicates because REAPI MLS and BatchData both return the
// same property under different records. This step collapses them so
// the AI doesn't burn tokens on repeat reasoning.
//
// Match priority (first hit wins):
//   1. APN match (strongest — unique parcel ID where present)
//   2. Normalized address match (handles "St" vs "Street", N/North, etc.)
//   3. Geo proximity (≤ ~50ft) AND spec match (beds, baths, sqft within 5%)
//
// For each duplicate group we pick a canonical row (most non-null fields,
// then prefer the one with photos, then most recent saleDate) and drop
// the others. The canonical row is tagged with metadata about which
// providers contributed so the AI can use cross-provider corroboration
// as a small data-quality signal.

import { haversineMiles } from '../../comps/comp-similarity';
import { normalizeAddress } from './address-normalize';

// Minimal subset of the Comp shape this util needs. Loose typing because
// the orchestrator hands us Prisma rows + the features blob.
export interface DedupCandidate {
  id: string;
  address: string;
  apn?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  source: string;
  photoUrl?: string | null;
  features?: Record<string, unknown> | null;
  soldDate: Date | string;
  // Allow additional fields without listing them
  [key: string]: unknown;
}

export interface DedupGroup {
  canonicalId: string;
  duplicateIds: string[]; // ids that were collapsed into canonical (excluding canonical)
  matchedBy: 'apn' | 'address' | 'geo+spec';
  sources: string[]; // unique providers contributing
  corroborated: boolean; // true when sources.length > 1
}

export interface DedupResult {
  survivors: DedupCandidate[]; // canonical rows tagged with features.dedup
  groups: DedupGroup[]; // every group, including singletons (count=1)
  rawCount: number;
  uniqueCount: number;
  removedCount: number;
  corroboratedCount: number;
}

const GEO_PROXIMITY_FEET = 50;
const GEO_PROXIMITY_MILES = GEO_PROXIMITY_FEET / 5280;
const SQFT_TOLERANCE = 0.05; // ±5%

export function dedupCandidates(input: DedupCandidate[]): DedupResult {
  const rawCount = input.length;
  if (rawCount === 0) {
    return {
      survivors: [],
      groups: [],
      rawCount,
      uniqueCount: 0,
      removedCount: 0,
      corroboratedCount: 0,
    };
  }

  // Track which candidate has been assigned to a group already.
  const assigned = new Set<string>();
  const groups: Array<{ members: DedupCandidate[]; matchedBy: DedupGroup['matchedBy'] }> = [];

  // Pass 1: APN bucket. Skip empty/null APNs.
  const apnBuckets = new Map<string, DedupCandidate[]>();
  for (const c of input) {
    const apn = (c.apn ?? '').trim();
    if (!apn) continue;
    const bucket = apnBuckets.get(apn) ?? [];
    bucket.push(c);
    apnBuckets.set(apn, bucket);
  }
  for (const bucket of apnBuckets.values()) {
    if (bucket.length < 2) continue;
    for (const m of bucket) assigned.add(m.id);
    groups.push({ members: bucket, matchedBy: 'apn' });
  }

  // Pass 2: normalized-address bucket on remainder.
  const addrBuckets = new Map<string, DedupCandidate[]>();
  for (const c of input) {
    if (assigned.has(c.id)) continue;
    const key = normalizeAddress(c.address);
    if (!key) continue;
    const bucket = addrBuckets.get(key) ?? [];
    bucket.push(c);
    addrBuckets.set(key, bucket);
  }
  for (const bucket of addrBuckets.values()) {
    if (bucket.length < 2) continue;
    for (const m of bucket) assigned.add(m.id);
    groups.push({ members: bucket, matchedBy: 'address' });
  }

  // Pass 3: geo+spec match on remainder.
  const remainder = input.filter((c) => !assigned.has(c.id));
  for (let i = 0; i < remainder.length; i++) {
    const a = remainder[i];
    if (assigned.has(a.id)) continue;
    if (!hasGeo(a) || !hasSpec(a)) continue;
    const cluster: DedupCandidate[] = [a];
    for (let j = i + 1; j < remainder.length; j++) {
      const b = remainder[j];
      if (assigned.has(b.id)) continue;
      if (!hasGeo(b) || !hasSpec(b)) continue;
      if (geoSpecMatch(a, b)) cluster.push(b);
    }
    if (cluster.length >= 2) {
      for (const m of cluster) assigned.add(m.id);
      groups.push({ members: cluster, matchedBy: 'geo+spec' });
    }
  }

  // Singletons (un-grouped candidates) become their own one-member groups.
  for (const c of input) {
    if (assigned.has(c.id)) continue;
    groups.push({ members: [c], matchedBy: 'address' /* arbitrary; size=1 */ });
    assigned.add(c.id);
  }

  // Pick canonicals + tag.
  const survivors: DedupCandidate[] = [];
  const resultGroups: DedupGroup[] = [];
  let removedCount = 0;
  let corroboratedCount = 0;

  for (const g of groups) {
    const canonical = pickCanonical(g.members);
    const duplicateIds = g.members
      .filter((m) => m.id !== canonical.id)
      .map((m) => m.id);
    const sources = Array.from(new Set(g.members.map((m) => m.source)));
    const corroborated = sources.length > 1;
    if (g.members.length > 1) {
      removedCount += g.members.length - 1;
      if (corroborated) corroboratedCount += 1;
    }
    // Tag canonical with dedup metadata under features.dedup.
    const existingFeatures =
      (canonical.features as Record<string, unknown> | null | undefined) ?? {};
    canonical.features = {
      ...existingFeatures,
      dedup: {
        count: g.members.length,
        sources,
        corroborated,
        matchedBy: g.matchedBy,
      },
    };
    survivors.push(canonical);
    resultGroups.push({
      canonicalId: canonical.id,
      duplicateIds,
      matchedBy: g.matchedBy,
      sources,
      corroborated,
    });
  }

  return {
    survivors,
    groups: resultGroups,
    rawCount,
    uniqueCount: survivors.length,
    removedCount,
    corroboratedCount,
  };
}

function hasGeo(c: DedupCandidate): boolean {
  return (
    typeof c.latitude === 'number' &&
    typeof c.longitude === 'number' &&
    Number.isFinite(c.latitude) &&
    Number.isFinite(c.longitude)
  );
}

function hasSpec(c: DedupCandidate): boolean {
  return (
    typeof c.bedrooms === 'number' &&
    typeof c.bathrooms === 'number' &&
    typeof c.sqft === 'number'
  );
}

function geoSpecMatch(a: DedupCandidate, b: DedupCandidate): boolean {
  if (a.bedrooms !== b.bedrooms) return false;
  if (a.bathrooms !== b.bathrooms) return false;
  const aSqft = a.sqft as number;
  const bSqft = b.sqft as number;
  const sqftDelta = Math.abs(aSqft - bSqft) / Math.max(aSqft, bSqft);
  if (sqftDelta > SQFT_TOLERANCE) return false;
  const dist = haversineMiles(
    { latitude: a.latitude as number, longitude: a.longitude as number },
    { latitude: b.latitude as number, longitude: b.longitude as number },
  );
  return dist <= GEO_PROXIMITY_MILES;
}

function pickCanonical(members: DedupCandidate[]): DedupCandidate {
  // Most non-null fields → has photo → newest soldDate.
  return [...members].sort((a, b) => {
    const aFilled = countNonNullFields(a);
    const bFilled = countNonNullFields(b);
    if (aFilled !== bFilled) return bFilled - aFilled;

    const aPhoto = hasPhoto(a) ? 1 : 0;
    const bPhoto = hasPhoto(b) ? 1 : 0;
    if (aPhoto !== bPhoto) return bPhoto - aPhoto;

    const aDate = new Date(a.soldDate as any).getTime();
    const bDate = new Date(b.soldDate as any).getTime();
    return bDate - aDate;
  })[0];
}

function hasPhoto(c: DedupCandidate): boolean {
  if (typeof c.photoUrl === 'string' && c.photoUrl.length > 0) return true;
  const urls = (c.features as Record<string, unknown> | null | undefined)?.photoUrls;
  return Array.isArray(urls) && urls.length > 0;
}

function countNonNullFields(c: DedupCandidate): number {
  let n = 0;
  for (const v of Object.values(c)) {
    if (v !== null && v !== undefined && v !== '') n += 1;
  }
  return n;
}
