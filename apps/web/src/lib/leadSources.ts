/** Display label for every Lead.source value, for filters and row badges. */
export const SOURCE_LABELS: Record<string, string> = {
  PROPERTY_LEADS: 'PPL',
  GOOGLE_ADS: 'PPC',
  LEADHOUSE: 'LeadHouse',
  MANUAL: 'Manual',
  DEAL_SEARCH: 'Deal Search',
  FORECLOSURE: 'Foreclosure',
  OTHER: 'Other',
};

/**
 * Sources a user may assign by hand, which is not all of them. FORECLOSURE is
 * excluded: those leads are created by the foreclosure ingestion alongside a
 * ForeclosureDetail row, and /foreclosures only lists leads that have one. A
 * lead relabelled FORECLOSURE from here would claim to be a foreclosure in
 * every list while never appearing on the foreclosures tab.
 */
export const ASSIGNABLE_SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(SOURCE_LABELS).filter(([v]) => v !== 'FORECLOSURE'),
);
