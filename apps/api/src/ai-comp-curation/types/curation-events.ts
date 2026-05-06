// SSE event types emitted by the curation orchestrator.
// Each event maps to a frame in the progress drawer on the client.

import type { CurationResult } from './curation-result';

export type StepName =
  | 'load_subject'
  | 'dedup'
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
  // Optional payload — counts, radii, narrative bits the UI can render.
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
  code: string; // e.g. 'TYPE_REQUIRED', 'AI_PARSE_FAILED', 'NO_API_KEY'
  message: string;
  step?: StepName;
}

export type CurationEvent = StepEvent | CacheHitEvent | DoneEvent | ErrorEvent;
