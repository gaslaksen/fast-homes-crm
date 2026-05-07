import { createHash } from 'crypto';
import type {
  AIArvCalculationInput,
  ValuationMode,
} from '../types/arv-result';

// Stable cache key for an ARV calculation request. Two requests producing
// the same hash MUST have identical inputs (subject identity, comp set,
// mode). The hash is the cache key for `ai_arv_calculations.inputHash`.
//
// We hash:
//   - leadId (subject identity)
//   - selected comp IDs in sorted order
//   - mode
//
// We deliberately do NOT hash the REAPI AVM (it's a sanity-check
// reference, not part of the deterministic input) or the curationContext
// (the curation is captured by the comp set IDs themselves).
export function computeInputHash(input: AIArvCalculationInput): string {
  const compIds = [...input.selectedComps.map((c) => c.id)].sort();
  const payload = JSON.stringify({
    leadId: input.leadId,
    mode: normalizeMode(input.mode),
    compIds,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

function normalizeMode(mode: ValuationMode): ValuationMode {
  return mode === 'AS_IS' ? 'AS_IS' : 'ARV_RENOVATED';
}
