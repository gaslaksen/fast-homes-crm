/**
 * Whether a surplus property address is a street address somebody could
 * drive to, as against the placeholders the tax roll and the ingest write
 * when there is none: "0 UNKNOWN", "NO ADDRESS ON TAX ROLL", "NO SITUS",
 * "<County> County surplus claim". The board shows the mailing city instead
 * of these, because they say nothing.
 *
 * A copy of isRealPropertyAddress in packages/shared/src/utils.ts, which the
 * API reads. Vercel builds the web with `next build` alone, so the shared
 * package has no dist/ there and a runtime import of it fails the deploy
 * (see surplus-calls.ts). Keep the two in step.
 */
export function isRealPropertyAddress(address: string | null | undefined): boolean {
  const a = String(address || '').trim();
  if (!a) return false;
  if (/surplus claim$/i.test(a)) return false;
  if (/^(?:n\/?a|none|unknown|vacant(?: land| lot)?)$/i.test(a)) return false;
  if (/\b(?:no address|no situs|not available|unknown)\b/i.test(a)) return false;
  // A bare zero house number with no street name, or nothing but a number.
  if (/^0+\s*$/.test(a) || /^0+\s+(?:unknown|n\/?a|none)\b/i.test(a)) return false;
  return /[a-z]/i.test(a);
}
