// Prompt v1 for AI comp curation. The version string is persisted on every
// curation run so a verbatim historical record survives template edits.
// Bump VERSION when behavior-changing edits are made (the cache key
// includes promptVersion, so a bump invalidates all caches).

import type {
  ValuationMode,
  CurationRanking,
} from '../types/curation-result';
import type { ExternalLinks } from '../utils/external-links';

// v1.1.0 (2026-05-06):
//   - new `briefReasoning` field per ranking (≤120 char headline)
//   - candidates now carry `dedupCorroborated` and `dedupSources` so the
//     AI can use cross-provider corroboration as a small quality signal
//   - photo handling unchanged at the prompt level; the backend now
//     wires multi-photo support upstream, so reasoning that references
//     photos is more frequently grounded in real visuals
export const VERSION = 'v1.1.0';

export interface PromptSubject {
  address: string;
  city: string;
  state: string;
  zip: string;
  propertyType: string;
  propertySubtypes: string[];
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  yearBuilt: number | null;
  lotSize: number | null;
  condition: string | null;
  occupancyStatus: string | null;
  schoolDistrict: string | null;
  subdivision: string | null;
  externalLinks: ExternalLinks;
}

export interface PromptCandidate {
  candidateId: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  distance: number;
  propertyType: string;
  propertySubtypes: string[];
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  yearBuilt: number | null;
  lotSize: number | null;
  salePrice: number;
  saleDate: string;
  saleType: string | null;
  daysOnMarket: number | null;
  listingDescription: string | null;
  schoolDistrict: string | null;
  subdivision: string | null;
  hasGarage: boolean | null;
  hasPool: boolean | null;
  source: 'reapi' | 'batchdata' | string;
  externalLinks: ExternalLinks;
  photoLabels: string[]; // labels for any images present in this prompt
  // Cross-provider corroboration metadata from the dedup step. When
  // `dedupCorroborated` is true, two or more providers agreed on this
  // property — a small additional signal of data quality.
  dedupCorroborated: boolean;
  dedupSources: string[];
}

export interface PromptInput {
  subject: PromptSubject;
  candidates: PromptCandidate[];
  valuationMode: ValuationMode;
  marketDensity: 'urban' | 'suburban' | 'rural';
  searchExpansion: {
    initialRadius: number;
    finalRadius: number;
    expansionPath: number[];
  };
  hardConstraints: Record<string, unknown>;
  // photoLabels in order — image content blocks are sent in this order
  photoLabelsInOrder: string[];
}

export function build(input: PromptInput): string {
  const {
    subject,
    candidates,
    valuationMode,
    marketDensity,
    searchExpansion,
    hardConstraints,
    photoLabelsInOrder,
  } = input;

  const modeText =
    valuationMode === 'ARV_RENOVATED'
      ? 'ARV (post-renovation retail value)'
      : 'AS_IS (current condition wholesale value)';

  const expansionText =
    searchExpansion.expansionPath.length > 1
      ? `Search radius was expanded from ${searchExpansion.initialRadius}mi to ${searchExpansion.finalRadius}mi across these tiers: [${searchExpansion.expansionPath.join(', ')}].`
      : `Search held at ${searchExpansion.finalRadius}mi (no expansion needed).`;

  const constraintLines = Object.entries(hardConstraints)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `  - ${k}: ${JSON.stringify(v)}`);

  return [
    `You are an experienced real estate valuation analyst helping a wholesale and retail investor curate comparable sales for a property.`,
    `The investor's primary exit is concierge retail listing, with occasional JV or wholesale assignments.`,
    ``,
    `## Your task`,
    `Rank each candidate comp by true relevance to the subject for the requested valuation mode. Provide specific, per-comp reasoning. Flag concerns. If search radius was expanded, narrate why.`,
    ``,
    `## Valuation mode`,
    `Operating in ${modeText}.`,
    valuationMode === 'ARV_RENOVATED'
      ? `Prioritize renovated/turnkey comps that represent the post-rehab market for this property type and area. Exclude obvious as-is distressed sales. Target the "what would this sell for fixed up" question.`
      : `Include condition-matched comps for the subject. Distressed/cosmetic-fixer comps are valid and often most relevant. Recent flip resales typically excluded. Target the "what's it worth today, as it sits" question.`,
    `Explicitly state which mode you're operating in and how that drove your selection in your summary.`,
    ``,
    `## Market context`,
    `Market density: ${marketDensity}.`,
    expansionText,
    searchExpansion.expansionPath.length > 1
      ? `When you write \`searchExpansion.expansionReason\` and your top-level \`summary\`, narrate this expansion specifically — say why default radius was insufficient and what changed at the wider tier.`
      : ``,
    ``,
    `## Subject property`,
    formatSubject(subject),
    ``,
    `## Hard constraints applied (pre-AI filter)`,
    constraintLines.length > 0
      ? constraintLines.join('\n')
      : `  (none)`,
    `Candidates failing these constraints have already been removed from the list below.`,
    ``,
    `## Candidate comps (${candidates.length})`,
    candidates.map(formatCandidate).join('\n\n'),
    ``,
    photoLabelsInOrder.length > 0
      ? [
          `## Photos`,
          `The image inputs attached to this message correspond to:`,
          ...photoLabelsInOrder.map((l, i) => `  ${i + 1}. ${l}`),
          `Use photos to confirm or refute textual signals — apparent renovation, deferred maintenance, exterior style match, etc.`,
          ``,
        ].join('\n')
      : `(No photos available — text-only evaluation.)\n`,
    ``,
    `## Evaluation guidelines`,
    `- Same-street and same-block comps are weighted highest. Same neighborhood / subdivision next. Across-arterial or across-zip-line comps weighted lower.`,
    `- Era matching matters: 1929 construction vs 1989 construction is a fundamentally different valuation, even if size matches. Flag era mismatches that affect adjustment confidence.`,
    `- Size adjustments above ~25% signal the comp probably shouldn't be included.`,
    `- Distressed sale detection: sale price wildly below market median for similar size/era/type, or "as-is", "cash only", "needs work", "estate sale" in the listing description, or very short DOM with low price.`,
    `- For Manufactured class: flag single-wide vs double-wide and pre/post-1976 HUD-coded differences.`,
    `- Per-comp reasoning must be specific (e.g. "Same street, same era, 16% larger sqft requiring -$8k size adjustment"). Generic statements like "good comp" are not acceptable.`,
    `- If type-matched candidates are insufficient (fewer than 4 viable comps), return a smaller set and recommend manual review rather than padding.`,
    `- Keep output tight. Reasoning ONE sentence per comp. summary 2-3 sentences. marketObservations max 4 bullets.`,
    `- Each candidate carries \`dedupCorroborated\`. When true, two providers (REAPI MLS + BatchData) independently returned this property — a small additional confidence signal you may cite when relevant. Don't lean on it heavily; data agreement is not the same as data quality.`,
    ``,
    `## Output format`,
    `Respond with valid JSON only. No prose, no markdown fences, no explanation outside the JSON. Match this exact shape:`,
    ``,
    `{`,
    `  "summary": "2-4 sentence investor-email style. Punchy, specific. Lead with mode and selection rationale.",`,
    `  "recommendedTopCount": <number — your suggested top N>,`,
    `  "valuationMode": "${valuationMode}",`,
    `  "rankings": [`,
    `    {`,
    `      "candidateId": "<exact id from list above>",`,
    `      "rank": <1 = best>,`,
    `      "relevanceScore": <0-100>,`,
    `      "inclusion": "recommend_include" | "recommend_exclude" | "borderline",`,
    `      "reasoning": "ONE sentence, ≤25 words, specific to this comp. Cite the actual data signal (era, size delta, distance, condition cue).",`,
    `      "briefReasoning": "Headline ≤120 chars for the comp card. Most important point only. Prefer a quantitative phrase (e.g. 'Same era, same beds/baths. Lot 70% smaller.' or 'New construction; deduct ~$20-25K for era discount.').",`,
    `      "flags": ["pick from: distressed_sale_likely, era_mismatch, size_outlier, subtype_concern, no_photos_for_verification, renovation_likely, short_dom_full_ask"],`,
    `      "adjustmentNotes": "optional, ≤15 words"`,
    `    }`,
    `  ],`,
    `  "excludedDueToTypeMismatch": [],`,
    `  "excludedDueToConstraints": [],`,
    `  "searchExpansion": {`,
    `    "initialRadius": ${searchExpansion.initialRadius},`,
    `    "finalRadius": ${searchExpansion.finalRadius},`,
    `    "expansionPath": [${searchExpansion.expansionPath.join(', ')}],`,
    `    "expansionReason": "narrative — required when path length > 1"`,
    `  },`,
    `  "marketObservations": ["bullet 1", "bullet 2", ...]`,
    `}`,
    ``,
    `Note: \`excludedDueToTypeMismatch\` and \`excludedDueToConstraints\` are pre-filled by the server from pre-AI filtering — return them as empty arrays in your response. Do NOT include candidate IDs there.`,
    `Every candidate ID in the list above must appear exactly once in \`rankings\`.`,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

function formatSubject(s: PromptSubject): string {
  const subtypes = s.propertySubtypes.length
    ? ` (subtypes: ${s.propertySubtypes.join(', ')})`
    : '';
  return [
    `  Address: ${s.address}, ${s.city}, ${s.state} ${s.zip}`,
    `  Type: ${s.propertyType}${subtypes}`,
    `  ${formatVitals(s)}`,
    s.condition ? `  Condition: ${s.condition}` : null,
    s.occupancyStatus ? `  Occupancy: ${s.occupancyStatus}` : null,
    s.schoolDistrict ? `  School district: ${s.schoolDistrict}` : null,
    s.subdivision ? `  Subdivision: ${s.subdivision}` : null,
    `  Reference links: Zillow=${s.externalLinks.zillow} | Realtor=${s.externalLinks.realtor} | Maps=${s.externalLinks.googleMaps}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatCandidate(c: PromptCandidate): string {
  const subtypes = c.propertySubtypes.length
    ? ` (subtypes: ${c.propertySubtypes.join(', ')})`
    : '';
  const photos = c.photoLabels.length
    ? `attached as ${c.photoLabels.join(', ')}`
    : 'no photos';
  return [
    `### ${c.candidateId}`,
    `  Address: ${c.address}, ${c.city}, ${c.state} ${c.zip}`,
    `  Distance: ${c.distance.toFixed(2)}mi from subject`,
    `  Type: ${c.propertyType}${subtypes}`,
    `  ${formatVitals(c)}`,
    `  Sale: $${c.salePrice.toLocaleString()} on ${c.saleDate}` +
      (c.saleType ? ` (${c.saleType})` : '') +
      (c.daysOnMarket != null ? `, DOM ${c.daysOnMarket}` : ''),
    c.schoolDistrict ? `  School district: ${c.schoolDistrict}` : null,
    c.subdivision ? `  Subdivision: ${c.subdivision}` : null,
    c.hasGarage != null ? `  Garage: ${c.hasGarage ? 'yes' : 'no'}` : null,
    c.hasPool != null ? `  Pool: ${c.hasPool ? 'yes' : 'no'}` : null,
    c.listingDescription
      ? `  Listing description: "${truncate(c.listingDescription, 400)}"`
      : null,
    `  Source: ${c.source} | Photos: ${photos}`,
    c.dedupCorroborated
      ? `  dedupCorroborated: true (sources: ${c.dedupSources.join(', ')})`
      : null,
    `  Links: Zillow=${c.externalLinks.zillow} | Realtor=${c.externalLinks.realtor} | Maps=${c.externalLinks.googleMaps}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatVitals(p: {
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  yearBuilt: number | null;
  lotSize: number | null;
}): string {
  const parts: string[] = [];
  if (p.bedrooms != null) parts.push(`${p.bedrooms} bed`);
  if (p.bathrooms != null) parts.push(`${p.bathrooms} bath`);
  if (p.squareFeet != null) parts.push(`${p.squareFeet.toLocaleString()} sqft`);
  if (p.yearBuilt != null) parts.push(`built ${p.yearBuilt}`);
  if (p.lotSize != null) parts.push(`${p.lotSize.toFixed(2)} ac lot`);
  return parts.join(', ');
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 3)}...` : s;
}

// Re-exported for use in API responses where we want to attach the
// version to each curation row.
export const PROMPT_V1 = { version: VERSION, build } as const;

// Sanity check the AI's rankings cover every candidate exactly once.
export function validateRankingsCoverage(
  rankings: CurationRanking[],
  candidateIds: string[],
): { ok: true } | { ok: false; missing: string[]; extra: string[] } {
  const seen = new Set(rankings.map((r) => r.candidateId));
  const expected = new Set(candidateIds);
  const missing = candidateIds.filter((id) => !seen.has(id));
  const extra = [...seen].filter((id) => !expected.has(id));
  if (missing.length === 0 && extra.length === 0) return { ok: true };
  return { ok: false, missing, extra };
}
