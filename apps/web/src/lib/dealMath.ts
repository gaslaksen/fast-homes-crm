/**
 * Deal math shared between List v2, Kanban, and any future surface that
 * shows MAO or Spread. Single source of truth so numbers don't drift.
 *
 * Formula mirrors Lead Detail (apps/web/src/app/leads/[id]/page.tsx:1148-1149):
 *   MAO = ARV × (maoPercent/100 or 0.7) − repairCosts − assignmentFee
 * When a lead hasn't set repair costs or assignment fee, those default to 0
 * (NOT the Campaign/CompAnalysis defaults) — same as Lead Detail.
 */

export const DEFAULT_MAO_PCT = 0.7;

export interface MaoInputs {
  maoPercent?: number | null; // stored as 0-100; treated as percent
  repairCosts?: number | null;
  assignmentFee?: number | null;
}

export function computeMao(
  arv: number | null | undefined,
  inputs: MaoInputs = {},
): number | null {
  if (arv == null || !isFinite(arv) || arv <= 0) return null;
  const pct =
    inputs.maoPercent != null && isFinite(inputs.maoPercent)
      ? inputs.maoPercent / 100
      : DEFAULT_MAO_PCT;
  const repairs =
    inputs.repairCosts != null && isFinite(inputs.repairCosts)
      ? inputs.repairCosts
      : 0;
  const fee =
    inputs.assignmentFee != null && isFinite(inputs.assignmentFee)
      ? inputs.assignmentFee
      : 0;
  return Math.round(arv * pct - repairs - fee);
}

export function computeSpread(
  arv: number | null | undefined,
  askingPrice: number | null | undefined,
  inputs: MaoInputs = {},
): number | null {
  const mao = computeMao(arv, inputs);
  if (mao == null) return null;
  if (askingPrice == null || !isFinite(askingPrice) || askingPrice <= 0) {
    return null;
  }
  return mao - askingPrice;
}

export function formatK(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${n < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${n < 0 ? '-' : ''}$${Math.round(abs / 1_000)}k`;
  return `${n < 0 ? '-' : ''}$${abs}`;
}
