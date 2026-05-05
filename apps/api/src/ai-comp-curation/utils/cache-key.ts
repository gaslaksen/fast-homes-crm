import { createHash } from 'crypto';
import type { ValuationMode } from '../types/curation-result';

// Composite cache key. Any change to inputs that would meaningfully alter
// the curation output bumps this hash naturally.

export interface CacheKeyInput {
  leadId: string;
  candidateIds: string[];
  valuationMode: ValuationMode;
  hardConstraints: Record<string, unknown>;
  maxDistance: number | 'auto';
  promptVersion: string;
  subjectFingerprint: SubjectFingerprintInput;
}

export interface SubjectFingerprintInput {
  propertyType: string | null | undefined;
  bedrooms: number | null | undefined;
  bathrooms: number | null | undefined;
  squareFeet: number | null | undefined;
  yearBuilt: number | null | undefined;
  condition: string | null | undefined;
  address: string | null | undefined;
  zip: string | null | undefined;
}

export function subjectFingerprint(input: SubjectFingerprintInput): string {
  // Stable JSON: sort keys for determinism. Property order on a fresh object
  // literal is preserved in ES2015+, but explicit ordering insulates against
  // accidental rearrangement.
  const ordered = {
    address: input.address ?? null,
    bathrooms: input.bathrooms ?? null,
    bedrooms: input.bedrooms ?? null,
    condition: input.condition ?? null,
    propertyType: input.propertyType ?? null,
    squareFeet: input.squareFeet ?? null,
    yearBuilt: input.yearBuilt ?? null,
    zip: input.zip ?? null,
  };
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

export function computeCacheKey(input: CacheKeyInput): string {
  const ordered = {
    candidateIds: [...input.candidateIds].sort(),
    hardConstraints: sortKeys(input.hardConstraints),
    leadId: input.leadId,
    maxDistance: input.maxDistance,
    promptVersion: input.promptVersion,
    subjectFingerprint: subjectFingerprint(input.subjectFingerprint),
    valuationMode: input.valuationMode,
  };
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k];
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v)
        ? sortKeys(v as Record<string, unknown>)
        : v;
  }
  return out;
}
