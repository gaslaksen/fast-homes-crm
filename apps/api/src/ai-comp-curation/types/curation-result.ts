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
  // ≤120 char headline for the comp card. AI-generated when prompt
  // v1.1.0+; backfilled from `reasoning` first sentence when missing.
  briefReasoning: string;
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

// Tolerant validator that returns either a populated CurationResult or
// a specific reason string for the first thing that didn't fit. The
// orchestrator logs the reason so prod failures are diagnosable from
// Railway logs without inspecting the rawResponse JSON.
//
// Tolerance built in:
// - valuationMode normalized: "ARV", "ARV_RENOVATED", "as-is", "AS_IS",
//   "as is", "asis" all accepted
// - inclusion normalized: spaces → underscores, lowercased
// - numeric fields coerced from string when possible
// - searchExpansion accepts partials and falls back to caller-provided defaults
// - rankings and exclusions arrays default to empty when missing/malformed
//   (server-side fills in pre-AI exclusions either way)

export type ParseOutcome =
  | { ok: true; value: CurationResult }
  | { ok: false; reason: string };

export function parseCurationResult(raw: unknown): ParseOutcome {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'top-level value is not an object' };
  }
  const r = raw as Record<string, unknown>;

  const valuationMode = normalizeValuationMode(r.valuationMode);
  if (!valuationMode) {
    return {
      ok: false,
      reason: `valuationMode unrecognized: ${JSON.stringify(r.valuationMode)}`,
    };
  }

  if (typeof r.summary !== 'string' || !r.summary.trim()) {
    return { ok: false, reason: 'summary missing or empty' };
  }

  const recommendedTopCount = coerceNumber(r.recommendedTopCount);
  if (recommendedTopCount == null) {
    return {
      ok: false,
      reason: `recommendedTopCount not a number: ${JSON.stringify(r.recommendedTopCount)}`,
    };
  }

  const rankingsResult = parseRankings(r.rankings);
  if (rankingsResult.ok === false) {
    return { ok: false, reason: `rankings: ${rankingsResult.reason}` };
  }

  // Exclusion arrays are server-filled regardless — accept whatever the AI
  // returned, even if missing or wrong shape.
  const excludedDueToTypeMismatch = bestEffortExclusions(r.excludedDueToTypeMismatch);
  const excludedDueToConstraints = bestEffortExclusions(r.excludedDueToConstraints);

  const searchExpansion = bestEffortSearchExpansion(r.searchExpansion);

  const marketObservations = Array.isArray(r.marketObservations)
    ? r.marketObservations.filter((x): x is string => typeof x === 'string')
    : [];

  return {
    ok: true,
    value: {
      summary: r.summary,
      recommendedTopCount,
      valuationMode,
      rankings: rankingsResult.value,
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
    },
  };
}

function normalizeValuationMode(v: unknown): ValuationMode | null {
  if (typeof v !== 'string') return null;
  const k = v.trim().toUpperCase().replace(/[\s-]/g, '_');
  if (k === 'ARV' || k === 'ARV_RENOVATED' || k === 'RENOVATED') return 'ARV_RENOVATED';
  if (k === 'AS_IS' || k === 'ASIS' || k === 'AS') return 'AS_IS';
  return null;
}

function normalizeInclusion(v: unknown): Inclusion | null {
  if (typeof v !== 'string') return null;
  const k = v.trim().toLowerCase().replace(/[\s-]/g, '_');
  if (k === 'recommend_include' || k === 'include') return 'recommend_include';
  if (k === 'recommend_exclude' || k === 'exclude') return 'recommend_exclude';
  if (k === 'borderline' || k === 'maybe') return 'borderline';
  return null;
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseRankings(
  v: unknown,
): { ok: true; value: CurationRanking[] } | { ok: false; reason: string } {
  if (!Array.isArray(v)) {
    return { ok: false, reason: `expected array, got ${typeof v}` };
  }
  const out: CurationRanking[] = [];
  for (let i = 0; i < v.length; i++) {
    const item = v[i];
    if (!item || typeof item !== 'object') {
      return { ok: false, reason: `item ${i} not an object` };
    }
    const r = item as Record<string, unknown>;
    if (typeof r.candidateId !== 'string') {
      return { ok: false, reason: `item ${i} missing candidateId` };
    }
    const rank = coerceNumber(r.rank);
    if (rank == null) {
      return {
        ok: false,
        reason: `item ${i} (${r.candidateId}) rank not a number: ${JSON.stringify(r.rank)}`,
      };
    }
    const relevanceScore = coerceNumber(r.relevanceScore);
    if (relevanceScore == null) {
      return {
        ok: false,
        reason: `item ${i} (${r.candidateId}) relevanceScore not a number`,
      };
    }
    const inclusion = normalizeInclusion(r.inclusion);
    if (!inclusion) {
      return {
        ok: false,
        reason: `item ${i} (${r.candidateId}) inclusion unrecognized: ${JSON.stringify(r.inclusion)}`,
      };
    }
    const reasoning =
      typeof r.reasoning === 'string' && r.reasoning.trim()
        ? r.reasoning
        : '';
    if (!reasoning) {
      return {
        ok: false,
        reason: `item ${i} (${r.candidateId}) reasoning missing or empty`,
      };
    }
    const flags = Array.isArray(r.flags)
      ? r.flags.filter((f): f is string => typeof f === 'string')
      : [];
    const adjustmentNotes =
      typeof r.adjustmentNotes === 'string' ? r.adjustmentNotes : undefined;
    const linksRaw = r.externalLinks as Partial<ExternalLinks> | undefined;
    const externalLinks: ExternalLinks = {
      zillow: typeof linksRaw?.zillow === 'string' ? linksRaw.zillow : '',
      realtor: typeof linksRaw?.realtor === 'string' ? linksRaw.realtor : '',
      googleMaps:
        typeof linksRaw?.googleMaps === 'string' ? linksRaw.googleMaps : '',
      streetView:
        typeof linksRaw?.streetView === 'string' ? linksRaw.streetView : undefined,
    };
    const briefReasoning = synthesizeBrief(r.briefReasoning, reasoning);
    out.push({
      candidateId: r.candidateId,
      rank,
      relevanceScore,
      inclusion,
      reasoning,
      briefReasoning,
      flags,
      adjustmentNotes,
      externalLinks,
    });
  }
  return { ok: true, value: out };
}

// Use AI-supplied brief when present; otherwise synthesize from the
// first sentence of `reasoning`, capped at 200 chars. Cards are visually
// fine with up to ~200 chars but ChatARV-style aims for ~120.
function synthesizeBrief(raw: unknown, fullReasoning: string): string {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim().slice(0, 200);
  }
  const firstSentence =
    fullReasoning.match(/^[^.!?]+[.!?]/)?.[0] ?? fullReasoning;
  return firstSentence.trim().slice(0, 200);
}

function bestEffortExclusions(v: unknown): CurationExclusion[] {
  if (!Array.isArray(v)) return [];
  const out: CurationExclusion[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.candidateId !== 'string') continue;
    const reason =
      typeof r.reason === 'string'
        ? r.reason
        : typeof r.constraintFailed === 'string'
          ? r.constraintFailed
          : '';
    out.push({ candidateId: r.candidateId, reason });
  }
  return out;
}

function bestEffortSearchExpansion(v: unknown): SearchExpansion {
  if (!v || typeof v !== 'object') {
    return {
      initialRadius: 0,
      finalRadius: 0,
      expansionPath: [],
      expansionReason: '',
    };
  }
  const r = v as Record<string, unknown>;
  const initialRadius = coerceNumber(r.initialRadius) ?? 0;
  const finalRadius = coerceNumber(r.finalRadius) ?? initialRadius;
  const expansionPath = Array.isArray(r.expansionPath)
    ? r.expansionPath
        .map((n) => coerceNumber(n))
        .filter((n): n is number => n != null)
    : [];
  const expansionReason =
    typeof r.expansionReason === 'string' ? r.expansionReason : '';
  return { initialRadius, finalRadius, expansionPath, expansionReason };
}
