// Mirror of apps/api/src/ai-comp-curation/types/curation-result.ts +
// curation-events.ts. Keep in sync by hand.

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
  // Headline ≤200 chars used in the comp card. Always present (server
  // synthesizes from the first sentence of `reasoning` if the AI omits it).
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

export interface AiCurationDecision {
  rank: number;
  inclusion: Inclusion;
  reasoning: string;
  flags: string[];
  externalLinks: ExternalLinks;
}

// Curation event mirrors

export type StepName =
  | 'load_subject'
  | 'classify_type'
  | 'filter_type_mismatches'
  | 'filter_constraints'
  | 'derive_density'
  | 'cache_check'
  | 'expansion_tier'
  | 'photo_budget'
  | 'fetch_resize'
  | 'build_prompt'
  | 'anthropic_call'
  | 'parse'
  | 'persist';

export type StepStatus = 'start' | 'done';

export interface StepEvent {
  type: 'step';
  step: StepName;
  status: StepStatus;
  payload?: Record<string, unknown>;
}

export interface CacheHitEvent {
  type: 'cache_hit';
  curationId: string;
  result: CurationResult;
}

export interface DoneEvent {
  type: 'done';
  curationId: string;
  result: CurationResult;
}

export interface ErrorEvent {
  type: 'error';
  code: string;
  message: string;
  step?: StepName;
}

export type CurationEvent =
  | StepEvent
  | CacheHitEvent
  | DoneEvent
  | ErrorEvent;

export interface HardConstraints {
  matchBedsBathsExact?: boolean;
  sameSchoolDistrict?: boolean;
  sameSubdivision?: boolean;
  renovatedOnly?: boolean;
  distressedOnly?: boolean;
  hasGarage?: boolean;
  hasPool?: boolean;
  builtWithinYears?: number;
}

export interface RunCurationInput {
  valuationMode: ValuationMode;
  hardConstraints: HardConstraints;
  maxDistance: number | 'auto';
  force?: boolean;
}
