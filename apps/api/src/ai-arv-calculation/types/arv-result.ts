// Shape of the AI ARV calculation contract.
// Mirrored on the web side at apps/web/src/lib/aiArvCalculation/types.ts —
// keep in sync.

export type ValuationMode = 'ARV_RENOVATED' | 'AS_IS';
export type ConfidenceLabel = 'LOW' | 'MEDIUM' | 'HIGH';

export type AdjustmentType =
  | 'sqft'
  | 'beds'
  | 'baths'
  | 'condition'
  | 'age'
  | 'lot'
  | 'amenity'
  | 'distress'
  | 'other';

export interface SubjectPropertyForArv {
  id: string;
  address: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  lotSize?: number | null;
  conditionLevel?: string | null;
}

export interface CompForArv {
  id: string;
  address: string;
  soldPrice: number;
  soldDate: string; // ISO
  distance?: number | null;
  daysOnMarket?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  lotSize?: number | null;
  isRenovated?: boolean | null;
  isDistressed?: boolean | null;
  saleTransType?: string | null;
  features?: Record<string, unknown> | null;
}

export interface AIArvCalculationInput {
  leadId: string;
  subjectProperty: SubjectPropertyForArv;
  selectedComps: CompForArv[];
  mode: ValuationMode;
  curationContext?: {
    curationId: string;
    aiReasoning?: string;
    perCompReasoning?: Record<string, string>;
    perCompAdjustmentNotes?: Record<string, string>;
  };
  reapiAvm?: number | null;
}

export interface CompAdjustmentEntry {
  type: AdjustmentType;
  amount: number; // signed
  reasoning: string;
}

export interface CompAdjustmentResult {
  compId: string;
  address: string;
  originalPrice: number;
  adjustedPrice: number;
  adjustments: CompAdjustmentEntry[];
  weight: number; // 0-1
  aiReasoning: string;
}

export interface ArvStats {
  compsUsed: number;
  avgSqft: number;
  avgDistanceMiles: number;
  avgDom: number;
  avgPricePerSqft: number;
  medianPricePerSqft: number;
  avgMonthsAgo: number;
  compVarianceCoeff: number; // std dev / mean of adjusted prices
}

export interface AIArvCalculationResult {
  arv: number;
  arvLow: number;
  arvHigh: number;
  pricePerSqft: number;
  confidence: number; // 0-100
  confidenceLabel: ConfidenceLabel;
  mode: ValuationMode;

  compAdjustments: CompAdjustmentResult[];

  valuationMethod: string;
  keyFactors: string[];
  risks: string[];
  avmDivergenceNote?: string;

  stats: ArvStats;

  // Provenance
  modelUsed: string;
  promptVersion: string;
  computedAt: string; // ISO
  inputHash: string;
  cached?: boolean;
  selectedCompIds: string[]; // snapshot for stale detection on the client
}

// AI raw response shape — what the model produces. The service computes
// the deterministic stats and confidence in TS, then merges into the
// final AIArvCalculationResult.
export interface RawAiArvResponse {
  arv: number;
  arvLow: number;
  arvHigh: number;
  compAdjustments: CompAdjustmentResult[];
  valuationMethod: string;
  keyFactors: string[];
  risks: string[];
  avmDivergenceNote?: string;
  aiQualityScore: number; // 0-100, AI's self-assessed comp set quality
}

export type ParseOutcome =
  | { ok: true; value: RawAiArvResponse }
  | { ok: false; reason: string };

// Tolerant parser. Same philosophy as parseCurationResult in
// ai-comp-curation: log a single human-readable reason for any rejection
// so prod failures are diagnosable from Railway logs.
export function parseRawAiArv(raw: unknown): ParseOutcome {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'top-level value is not an object' };
  }
  const r = raw as Record<string, unknown>;

  const arv = coerceNumber(r.arv);
  if (arv == null || arv <= 0) {
    return { ok: false, reason: `arv missing or non-positive: ${JSON.stringify(r.arv)}` };
  }
  const arvLow = coerceNumber(r.arvLow);
  const arvHigh = coerceNumber(r.arvHigh);
  if (arvLow == null || arvHigh == null) {
    return { ok: false, reason: 'arvLow or arvHigh missing' };
  }
  if (arvLow > arv || arvHigh < arv) {
    return {
      ok: false,
      reason: `range invariant violated: low=${arvLow} arv=${arv} high=${arvHigh}`,
    };
  }

  const adjResult = parseCompAdjustments(r.compAdjustments);
  if (adjResult.ok === false) {
    return { ok: false, reason: `compAdjustments: ${adjResult.reason}` };
  }

  const valuationMethod =
    typeof r.valuationMethod === 'string' && r.valuationMethod.trim()
      ? r.valuationMethod
      : '';
  if (!valuationMethod) {
    return { ok: false, reason: 'valuationMethod missing or empty' };
  }

  const keyFactors = Array.isArray(r.keyFactors)
    ? r.keyFactors.filter((x): x is string => typeof x === 'string')
    : [];
  const risks = Array.isArray(r.risks)
    ? r.risks.filter((x): x is string => typeof x === 'string')
    : [];
  const avmDivergenceNote =
    typeof r.avmDivergenceNote === 'string' ? r.avmDivergenceNote : undefined;
  const aiQualityScore = coerceNumber(r.aiQualityScore) ?? 50;

  return {
    ok: true,
    value: {
      arv,
      arvLow,
      arvHigh,
      compAdjustments: adjResult.value,
      valuationMethod,
      keyFactors,
      risks,
      avmDivergenceNote,
      aiQualityScore: clamp(aiQualityScore, 0, 100),
    },
  };
}

function parseCompAdjustments(
  v: unknown,
):
  | { ok: true; value: CompAdjustmentResult[] }
  | { ok: false; reason: string } {
  if (!Array.isArray(v)) {
    return { ok: false, reason: `expected array, got ${typeof v}` };
  }
  if (v.length === 0) {
    return { ok: false, reason: 'compAdjustments is empty' };
  }
  const out: CompAdjustmentResult[] = [];
  for (let i = 0; i < v.length; i++) {
    const item = v[i];
    if (!item || typeof item !== 'object') {
      return { ok: false, reason: `item ${i} not an object` };
    }
    const r = item as Record<string, unknown>;
    if (typeof r.compId !== 'string') {
      return { ok: false, reason: `item ${i} missing compId` };
    }
    const originalPrice = coerceNumber(r.originalPrice);
    const adjustedPrice = coerceNumber(r.adjustedPrice);
    if (originalPrice == null || originalPrice <= 0) {
      return {
        ok: false,
        reason: `item ${i} (${r.compId}) originalPrice non-positive`,
      };
    }
    if (adjustedPrice == null || adjustedPrice <= 0) {
      return {
        ok: false,
        reason: `item ${i} (${r.compId}) adjustedPrice non-positive`,
      };
    }
    const weight = coerceNumber(r.weight);
    if (weight == null || weight < 0 || weight > 1) {
      return {
        ok: false,
        reason: `item ${i} (${r.compId}) weight outside [0,1]: ${JSON.stringify(r.weight)}`,
      };
    }
    const aiReasoning =
      typeof r.aiReasoning === 'string' ? r.aiReasoning : '';
    if (!aiReasoning.trim()) {
      return {
        ok: false,
        reason: `item ${i} (${r.compId}) aiReasoning missing`,
      };
    }
    const adjustments = parseAdjustmentEntries(r.adjustments);
    out.push({
      compId: r.compId,
      address: typeof r.address === 'string' ? r.address : '',
      originalPrice,
      adjustedPrice,
      adjustments,
      weight,
      aiReasoning,
    });
  }
  return { ok: true, value: out };
}

function parseAdjustmentEntries(v: unknown): CompAdjustmentEntry[] {
  if (!Array.isArray(v)) return [];
  const out: CompAdjustmentEntry[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const amount = coerceNumber(r.amount);
    if (amount == null) continue;
    const type = normalizeAdjType(r.type);
    const reasoning = typeof r.reasoning === 'string' ? r.reasoning : '';
    out.push({ type, amount, reasoning });
  }
  return out;
}

function normalizeAdjType(v: unknown): AdjustmentType {
  if (typeof v !== 'string') return 'other';
  const k = v.trim().toLowerCase();
  switch (k) {
    case 'sqft':
    case 'beds':
    case 'baths':
    case 'condition':
    case 'age':
    case 'lot':
    case 'amenity':
    case 'distress':
      return k;
    default:
      return 'other';
  }
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
