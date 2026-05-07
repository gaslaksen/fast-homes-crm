import type {
  AIArvCalculationInput,
  CompForArv,
  SubjectPropertyForArv,
  ValuationMode,
} from '../types/arv-result';

export const PROMPT_VERSION = '1.0.0';

// Build Prompt 016 — ARV calculation prompt v1.
//
// Design principles (from the build prompt):
//   • Mode-specific. Phase A curates a comp set for one mode; we respect
//     it and never produce a different mode's value.
//   • REAPI AVM is a sanity-check anchor, NOT a reconciliation target.
//     The model commits to a number; if it diverges from AVM by >20%
//     it MUST explain in `avmDivergenceNote`.
//   • The 1209 N 3rd Street guardrail: no single adjustment may exceed
//     30% of the comp's sale price without explicit justification.
//   • Weights are explicit (sum to 1.0) and shown in the output.
//   • Distressed sales must be addressed (excluded, downweighted, or
//     used with reasoning).

export interface BuildPromptResult {
  systemPrompt: string;
  userPrompt: string;
  promptVersion: string;
}

export function buildPrompt(input: AIArvCalculationInput): BuildPromptResult {
  const systemPrompt = SYSTEM_PROMPT;
  const userPrompt = buildUserPrompt(input);
  return { systemPrompt, userPrompt, promptVersion: PROMPT_VERSION };
}

const SYSTEM_PROMPT = `You are an investor-grade real estate appraiser producing After-Repair Value (ARV) estimates for wholesale real estate deals. Your output is consumed by an automated system; you must produce strict JSON exactly as specified, with no prose before or after the JSON object.

Your job is to take a curated set of comparable sales (already mode-filtered) and produce ONE ARV figure for the subject property, with explicit per-comp adjustments and weights, and a confidence range. You do not select comps — that is already done.

Hard rules:

1. MODE LOCK. The valuation mode (ARV_RENOVATED or AS_IS) is already set. Do not produce a value for the other mode. ARV_RENOVATED is the value after a typical full rehab; AS_IS is the value in current condition for an investor purchase.

2. REAPI AVM is a SANITY-CHECK ANCHOR, NOT A RECONCILIATION TARGET. If the user provides a REAPI AVM, treat it as a third-party reference. You commit to a number based on the comps; you do NOT adjust your number to match AVM. If your final ARV diverges from AVM by more than 20% in either direction, you MUST populate \`avmDivergenceNote\` with a concrete explanation ("My ARV is $X vs AVM $Y because [comp set behavior, condition, market timing, distressed mix, etc.]"). Vague answers like "needs manual review" are not acceptable.

3. THIRTY-PERCENT ADJUSTMENT GUARDRAIL. No single adjustment may exceed 30% of the comp's original sale price unless the comp's \`aiReasoning\` explicitly justifies why such a large adjustment is sound (e.g., "this comp was a recent flip in renovated condition while subject is gut-rehab scope; -32% reflects the renovation delta backed by REAPI photo/condition flags"). If you cannot justify a >30% adjustment, you MUST instead heavily downweight or exclude that comp by setting its weight to 0.

4. WEIGHTS SUM TO ONE. Across all comps in your output, weights must sum to 1.00 ± 0.02. A weight of 0 means the comp was effectively excluded; explain why in its \`aiReasoning\`.

5. DISTRESSED SALES MUST BE ADDRESSED. If a comp is flagged as distressed (or appears distressed by sale type / price discount), you must (a) exclude it (weight 0), (b) downweight it explicitly with reasoning, or (c) include it with a +distress adjustment normalizing toward arms-length value. Whichever you choose, name the choice in the comp's \`aiReasoning\`.

6. SHOW THE MATH. For each comp, list each individual adjustment (sqft, condition, age, etc.) with a signed dollar amount and a one-sentence reasoning. The \`adjustedPrice\` must equal \`originalPrice + sum(adjustments[].amount)\` within $50.

7. RANGE INVARIANT. \`arvLow ≤ arv ≤ arvHigh\`. The range should reflect genuine uncertainty — tight range when comps agree, wide range when they don't.

8. AI QUALITY SCORE. Self-rate the comp set on a 0-100 scale in \`aiQualityScore\`: how well does this set support a confident ARV? Low (0-30) means thin/contradictory; mid (40-60) is workable; high (70-100) is tight, recent, condition-matched. The system uses this as one input to the final confidence score.

OUTPUT FORMAT — return ONLY this JSON object, no markdown fence, no commentary:

{
  "arv": number,
  "arvLow": number,
  "arvHigh": number,
  "compAdjustments": [
    {
      "compId": "string (matches input id)",
      "address": "string (subject of this comp)",
      "originalPrice": number,
      "adjustedPrice": number,
      "adjustments": [
        { "type": "sqft|beds|baths|condition|age|lot|amenity|distress|other", "amount": number (signed), "reasoning": "one sentence" }
      ],
      "weight": number (0..1),
      "aiReasoning": "2-4 sentences on why this comp got this weight, including any large-adjustment or distress justification"
    }
  ],
  "valuationMethod": "1-2 sentences describing the valuation method (e.g., 'Weighted adjusted comp analysis emphasizing two condition-matched recent sales within 0.6 mi; older outlier downweighted')",
  "keyFactors": ["3-6 bullet-style strings naming what drove the ARV up or down"],
  "risks": ["2-5 bullet-style strings naming what could move ARV outside the range"],
  "avmDivergenceNote": "REQUIRED if |ARV - REAPI AVM| / REAPI AVM > 0.20; otherwise omit",
  "aiQualityScore": number (0..100)
}`;

function buildUserPrompt(input: AIArvCalculationInput): string {
  const subject = formatSubject(input.subjectProperty);
  const comps = formatComps(input.selectedComps, input.curationContext);
  const reapi = formatReapi(input.reapiAvm ?? null);
  const modeLine = formatMode(input.mode);

  return `${modeLine}

SUBJECT PROPERTY
${subject}

REFERENCE — REAPI AVM (sanity check only)
${reapi}

SELECTED COMPARABLE SALES (${input.selectedComps.length})
${comps}

Produce the ARV JSON now.`;
}

function formatMode(mode: ValuationMode): string {
  if (mode === 'AS_IS') {
    return `MODE: AS_IS
You are valuing the subject IN CURRENT CONDITION as an investor would purchase it. Do NOT produce a renovated/post-rehab number. Distressed and condition-matched comps are typically the right anchor; renovated comps usually require a downward condition adjustment.`;
  }
  return `MODE: ARV_RENOVATED
You are valuing the subject AS IF FULLY RENOVATED to current market standard. Renovated comps in the same micro-market are typically the right anchor; distressed comps usually require an upward condition adjustment or low weight.`;
}

function formatSubject(s: SubjectPropertyForArv): string {
  const parts = [
    `Address: ${s.address}${s.city ? `, ${s.city}` : ''}${s.state ? `, ${s.state}` : ''}${s.zip ? ` ${s.zip}` : ''}`,
    s.bedrooms != null ? `Beds: ${s.bedrooms}` : null,
    s.bathrooms != null ? `Baths: ${s.bathrooms}` : null,
    s.sqft != null ? `Sqft: ${s.sqft}` : null,
    s.yearBuilt != null ? `Year built: ${s.yearBuilt}` : null,
    s.lotSize != null ? `Lot: ${s.lotSize} sqft` : null,
    s.conditionLevel ? `Condition: ${s.conditionLevel}` : null,
  ].filter(Boolean);
  return parts.join(' | ');
}

function formatComps(
  comps: CompForArv[],
  curation?: AIArvCalculationInput['curationContext'],
): string {
  return comps
    .map((c, i) => {
      const distress = c.isDistressed ? ' ** DISTRESSED **' : '';
      const reno = c.isRenovated ? ' ** RENOVATED **' : '';
      const monthsAgo = monthsAgoFromIso(c.soldDate);
      const ppsf = c.sqft && c.sqft > 0 ? `$${(c.soldPrice / c.sqft).toFixed(0)}/sqft` : 'ppsf n/a';
      const note =
        curation?.perCompReasoning?.[c.id] ||
        curation?.perCompAdjustmentNotes?.[c.id];
      const noteLine = note ? `\n   Curation note: ${note}` : '';
      return `${i + 1}. [id=${c.id}] ${c.address}${distress}${reno}
   Sold $${formatNum(c.soldPrice)} on ${c.soldDate.slice(0, 10)} (${monthsAgo}mo ago) | ${ppsf}
   ${c.bedrooms ?? '?'}bd/${c.bathrooms ?? '?'}ba | ${c.sqft ?? '?'} sqft | built ${c.yearBuilt ?? '?'} | ${c.distance ?? '?'}mi away${
     c.saleTransType ? ` | trans=${c.saleTransType}` : ''
   }${noteLine}`;
    })
    .join('\n');
}

function formatReapi(avm: number | null): string {
  if (avm == null) return 'REAPI AVM unavailable. Proceed with comp-driven analysis.';
  return `REAPI AVM: $${formatNum(avm)}. Sanity-check only — do NOT reconcile your ARV to this number. If your ARV diverges by more than 20%, you MUST explain in avmDivergenceNote.`;
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function monthsAgoFromIso(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  const ms = Date.now() - d.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24 * 30.4375));
}
