/**
 * Deal math shared between List v2, Kanban, and any future surface that
 * shows MAO or Spread. Single source of truth so numbers don't drift.
 */

export const MAO_PCT = 0.7;
export const MAO_REPAIR_ALLOWANCE = 55_000;

export function computeMao(arv: number | null | undefined): number | null {
  if (arv == null || !isFinite(arv) || arv <= 0) return null;
  return Math.round(arv * MAO_PCT - MAO_REPAIR_ALLOWANCE);
}

export function computeSpread(
  arv: number | null | undefined,
  askingPrice: number | null | undefined,
): number | null {
  const mao = computeMao(arv);
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
