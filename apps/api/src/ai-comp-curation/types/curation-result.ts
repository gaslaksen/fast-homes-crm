// Shape of the parsed AI response. Mirrored on the web side at
// apps/web/src/lib/aiCompCuration/types.ts — keep in sync.

export type ValuationMode = 'ARV_RENOVATED' | 'AS_IS';

export type Inclusion =
  | 'recommend_include'
  | 'recommend_exclude'
  | 'borderline';

export interface ExternalLinks {
  zillow: string;
  realtor: string;
  googleMaps: string;
  streetView?: string;
}

export interface CurationRanking {
  candidateId: string;
  rank: number;
  relevanceScore: number;
  inclusion: Inclusion;
  reasoning: string;
  flags: string[];
  adjustmentNotes?: string;
  externalLinks: ExternalLinks;
}

export interface CurationExclusion {
  candidateId: string;
  reason: string;
}

export interface SearchExpansion {
  initialRadius: number;
  finalRadius: number;
  expansionPath: number[];
  expansionReason: string;
}

export interface ModelMetadata {
  model: string;
  promptVersion: string;
  tokensUsed: { input: number; output: number };
  latencyMs: number;
  timestamp: string;
  photoCount: number;
}

export interface CurationResult {
  summary: string;
  recommendedTopCount: number;
  valuationMode: ValuationMode;
  rankings: CurationRanking[];
  excludedDueToTypeMismatch: CurationExclusion[];
  excludedDueToConstraints: CurationExclusion[];
  searchExpansion: SearchExpansion;
  marketObservations: string[];
  modelMetadata: ModelMetadata;
}

// Hand-rolled validator. Returns the validated CurationResult or null
// if any required shape is wrong. Mirrors the manual parsing pattern
// used by analyzePhotos in comp-analysis.service.ts — we intentionally
// avoid pulling in zod for one schema.

export function parseCurationResult(raw: unknown): CurationResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const valuationMode = r.valuationMode;
  if (valuationMode !== 'ARV_RENOVATED' && valuationMode !== 'AS_IS') {
    return null;
  }

  if (typeof r.summary !== 'string') return null;
  if (typeof r.recommendedTopCount !== 'number') return null;

  const rankings = parseArray(r.rankings, parseRanking);
  if (!rankings) return null;

  const excludedDueToTypeMismatch = parseArray(
    r.excludedDueToTypeMismatch,
    parseExclusion,
  );
  if (!excludedDueToTypeMismatch) return null;

  const excludedDueToConstraints = parseArray(
    r.excludedDueToConstraints,
    parseExclusion,
  );
  if (!excludedDueToConstraints) return null;

  const searchExpansion = parseSearchExpansion(r.searchExpansion);
  if (!searchExpansion) return null;

  const marketObservations = Array.isArray(r.marketObservations)
    ? r.marketObservations.filter((x): x is string => typeof x === 'string')
    : [];

  // modelMetadata is filled in by the service after the call, not by the
  // model itself — the AI response doesn't need to include it. The service
  // attaches it before returning to callers, so accept missing here.

  return {
    summary: r.summary,
    recommendedTopCount: r.recommendedTopCount,
    valuationMode,
    rankings,
    excludedDueToTypeMismatch,
    excludedDueToConstraints,
    searchExpansion,
    marketObservations,
    modelMetadata: (r.modelMetadata as ModelMetadata) || {
      model: '',
      promptVersion: '',
      tokensUsed: { input: 0, output: 0 },
      latencyMs: 0,
      timestamp: new Date().toISOString(),
      photoCount: 0,
    },
  };
}

function parseArray<T>(
  v: unknown,
  parseItem: (x: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const item of v) {
    const parsed = parseItem(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

function parseRanking(x: unknown): CurationRanking | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (typeof r.candidateId !== 'string') return null;
  if (typeof r.rank !== 'number') return null;
  if (typeof r.relevanceScore !== 'number') return null;
  if (
    r.inclusion !== 'recommend_include' &&
    r.inclusion !== 'recommend_exclude' &&
    r.inclusion !== 'borderline'
  ) {
    return null;
  }
  if (typeof r.reasoning !== 'string') return null;
  const flags = Array.isArray(r.flags)
    ? r.flags.filter((f): f is string => typeof f === 'string')
    : [];
  const adjustmentNotes =
    typeof r.adjustmentNotes === 'string' ? r.adjustmentNotes : undefined;
  // externalLinks may be filled in by the service after parsing if the AI
  // omits them — accept partial here.
  const links = (r.externalLinks as ExternalLinks) || {
    zillow: '',
    realtor: '',
    googleMaps: '',
  };
  return {
    candidateId: r.candidateId,
    rank: r.rank,
    relevanceScore: r.relevanceScore,
    inclusion: r.inclusion,
    reasoning: r.reasoning,
    flags,
    adjustmentNotes,
    externalLinks: links,
  };
}

function parseExclusion(x: unknown): CurationExclusion | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (typeof r.candidateId !== 'string') return null;
  if (typeof r.reason !== 'string') return null;
  return { candidateId: r.candidateId, reason: r.reason };
}

function parseSearchExpansion(x: unknown): SearchExpansion | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (typeof r.initialRadius !== 'number') return null;
  if (typeof r.finalRadius !== 'number') return null;
  if (!Array.isArray(r.expansionPath)) return null;
  const path = r.expansionPath.filter(
    (n): n is number => typeof n === 'number',
  );
  if (typeof r.expansionReason !== 'string') return null;
  return {
    initialRadius: r.initialRadius,
    finalRadius: r.finalRadius,
    expansionPath: path,
    expansionReason: r.expansionReason,
  };
}
