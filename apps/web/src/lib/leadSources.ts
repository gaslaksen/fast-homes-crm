/** Display label for every Lead.source value, for filters and row badges. */
export const SOURCE_LABELS: Record<string, string> = {
  PROPERTY_LEADS: 'PPL',
  GOOGLE_ADS: 'PPC',
  LEADHOUSE: 'LeadHouse',
  MANUAL: 'Manual',
  DEAL_SEARCH: 'Deal Search',
  FORECLOSURE: 'Foreclosure',
  PROBATE: 'Probate',
  OTHER: 'Other',
};

/**
 * Sources a user may assign by hand, which is not all of them. FORECLOSURE and
 * PROBATE are excluded: those leads are created by their own ingestion
 * alongside a ForeclosureDetail / ProbateDetail row that carries the facts the
 * source implies. A lead relabelled by hand would claim to be one of them in
 * every list while holding none of that detail.
 */
const INGESTED_SOURCES = new Set(['FORECLOSURE', 'PROBATE']);

/**
 * Where a lead opens. A surplus claimant is worked on the case panel, which
 * /surplus-funds?lead= opens with the hiding filters off. The wholesale lead
 * page offers Send Initial Text, Resume AI and Zillow, none of which belong on
 * a claimant, and the first two can start automated outreach by accident.
 */
export function leadHref(lead: { id: string; source?: string | null }): string {
  return lead.source === 'SURPLUS'
    ? `/surplus-funds?lead=${encodeURIComponent(lead.id)}`
    : `/leads/${encodeURIComponent(lead.id)}`;
}

export const ASSIGNABLE_SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(SOURCE_LABELS).filter(([v]) => !INGESTED_SOURCES.has(v)),
);
