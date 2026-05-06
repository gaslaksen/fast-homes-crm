// Thin wrapper around the Phase A.5 dedup util that takes Comp-shape
// rows and returns canonical survivors. Lives here (not in
// ai-comp-curation/) because it's used by both the comps service
// (read-layer dedup, ARV math, toggle propagation) AND the AI
// curation orchestrator (pre-AI pool collapse).
//
// Keeping the underlying util at apps/api/src/ai-comp-curation/utils/
// dedup.ts since that's where its tests live; this file is just the
// glue that maps a Prisma Comp row → DedupCandidate input.

import {
  dedupCandidates,
  type DedupCandidate,
  type DedupResult,
} from '../ai-comp-curation/utils/dedup';

// Loose minimum shape — Prisma Comp row satisfies it without any
// transformation. Anywhere that has these fields can be deduped.
export interface DedupableComp {
  id: string;
  address: string;
  apn?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  source?: string | null;
  photoUrl?: string | null;
  features?: any;
  soldDate: Date | string;
}

export function compsToDedupCandidates<T extends DedupableComp>(
  comps: T[],
): DedupCandidate[] {
  return comps.map((c) => ({
    id: c.id,
    address: c.address,
    apn: c.apn ?? null,
    latitude: c.latitude ?? null,
    longitude: c.longitude ?? null,
    bedrooms: c.bedrooms ?? null,
    bathrooms: c.bathrooms ?? null,
    sqft: c.sqft ?? null,
    source: c.source ?? 'manual',
    photoUrl: c.photoUrl ?? null,
    features: (c.features as Record<string, unknown> | null | undefined) ?? null,
    soldDate: c.soldDate,
  }));
}

// Returns the canonical survivor IDs for a comp pool. Order of the
// returned array follows the input array (filter-preserving).
export function dedupCompList<T extends DedupableComp>(comps: T[]): T[] {
  if (comps.length === 0) return comps;
  const result = dedupCandidates(compsToDedupCandidates(comps));
  const keep = new Set(result.survivors.map((s) => s.id));
  return comps.filter((c) => keep.has(c.id));
}

// Returns the full DedupResult — needed by toggleCompSelection so it
// can find a comp's group and propagate selected state across all
// members.
export function dedupCompGroups<T extends DedupableComp>(
  comps: T[],
): DedupResult {
  return dedupCandidates(compsToDedupCandidates(comps));
}
