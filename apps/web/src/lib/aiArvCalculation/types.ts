// Shape mirrored from apps/api/src/ai-arv-calculation/types/arv-result.ts —
// keep in sync when the API contract changes.

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

export interface CompAdjustmentEntry {
  type: AdjustmentType;
  amount: number;
  reasoning: string;
}

export interface CompAdjustmentResult {
  compId: string;
  address: string;
  originalPrice: number;
  adjustedPrice: number;
  adjustments: CompAdjustmentEntry[];
  weight: number;
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
  compVarianceCoeff: number;
}

export interface AIArvCalculationResult {
  arv: number;
  arvLow: number;
  arvHigh: number;
  pricePerSqft: number;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  mode: ValuationMode;
  compAdjustments: CompAdjustmentResult[];
  valuationMethod: string;
  keyFactors: string[];
  risks: string[];
  avmDivergenceNote?: string;
  stats: ArvStats;
  modelUsed: string;
  promptVersion: string;
  computedAt: string;
  inputHash: string;
  cached?: boolean;
  selectedCompIds: string[];
}
