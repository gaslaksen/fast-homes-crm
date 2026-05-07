import type {
  CompAdjustmentResult,
  RawAiArvResponse,
} from '../types/arv-result';

// The 30%-of-original-price guardrail: no single adjustment may exceed
// 30% of the comp's original sale price unless the AI's `aiReasoning`
// for that comp explicitly justifies the large adjustment.
//
// Weight-0 comps are exempt (they have no influence on the final ARV
// regardless of how their adjustments look — they were effectively
// excluded).
const ADJ_LIMIT_PCT = 0.3;

// Heuristic: "large adjustment" justification keywords. The prompt asks
// the AI to address these explicitly when it leans on a >30% adjustment.
const JUSTIFICATION_PATTERNS = [
  /-?\s*\d+\s*%/i,                  // any percentage figure
  /(?:large|big|substantial|significant)\s+(?:adjustment|delta|gap)/i,
  /(?:gut|full)\s+(?:rehab|renovation)/i,
  /condition\s+delta/i,
  /distress\s+(?:adjustment|normalization)/i,
];

export interface ValidationIssue {
  compId: string;
  kind: 'oversized_adjustment' | 'weight_invalid' | 'unjustified_large_adjustment';
  message: string;
}

export interface ValidationOutcome {
  ok: boolean;
  issues: ValidationIssue[];
}

export function validateAdjustments(
  comps: CompAdjustmentResult[],
): ValidationOutcome {
  const issues: ValidationIssue[] = [];
  for (const comp of comps) {
    if (comp.weight === 0) continue;

    const totalAdjAbs = comp.adjustments.reduce(
      (s, a) => s + Math.abs(a.amount),
      0,
    );
    const ratio = comp.originalPrice > 0 ? totalAdjAbs / comp.originalPrice : 0;
    if (ratio > ADJ_LIMIT_PCT) {
      const justified = JUSTIFICATION_PATTERNS.some((p) =>
        p.test(comp.aiReasoning),
      );
      if (!justified) {
        issues.push({
          compId: comp.compId,
          kind: 'unjustified_large_adjustment',
          message: `comp adjusted ${(ratio * 100).toFixed(1)}% of original ($${totalAdjAbs.toFixed(0)} on $${comp.originalPrice.toFixed(0)}) without explicit justification in aiReasoning`,
        });
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

// Weights must sum to 1.0 within ±0.02. Each individual weight must be in [0, 1].
export function validateWeights(
  comps: CompAdjustmentResult[],
): ValidationOutcome {
  const issues: ValidationIssue[] = [];
  const sum = comps.reduce((s, c) => s + c.weight, 0);
  if (Math.abs(sum - 1) > 0.02) {
    issues.push({
      compId: '*',
      kind: 'weight_invalid',
      message: `weights sum to ${sum.toFixed(3)}, expected 1.00 ± 0.02`,
    });
  }
  for (const comp of comps) {
    if (comp.weight < 0 || comp.weight > 1) {
      issues.push({
        compId: comp.compId,
        kind: 'weight_invalid',
        message: `weight ${comp.weight} outside [0, 1]`,
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

export function validateRawResponse(raw: RawAiArvResponse): ValidationOutcome {
  const adj = validateAdjustments(raw.compAdjustments);
  const w = validateWeights(raw.compAdjustments);
  return {
    ok: adj.ok && w.ok,
    issues: [...adj.issues, ...w.issues],
  };
}
