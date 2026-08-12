// Deep links to consumer real-estate sites for a property address. Mirrors
// apps/web/src/lib/externalLinks.ts, so keep the two in sync. The URLs are built
// for the user to tap and open in Safari; the app never fetches them.

export interface PropertyAddress {
  propertyAddress?: string | null;
  propertyCity?: string | null;
  propertyState?: string | null;
  propertyZip?: string | null;
}

function joinAddress(p: PropertyAddress): string {
  return [p.propertyAddress, p.propertyCity, p.propertyState, p.propertyZip]
    .filter(Boolean)
    .join(', ')
    .trim();
}

/** False when there is nothing to search on, so the UI can hide the links. */
export function hasAddress(p: PropertyAddress): boolean {
  return joinAddress(p).length > 0;
}

export function zillowUrl(p: PropertyAddress): string {
  return `https://www.zillow.com/homes/${encodeURIComponent(joinAddress(p))}_rb/`;
}

export function googleSearchUrl(p: PropertyAddress): string {
  return `https://www.google.com/search?q=${encodeURIComponent(joinAddress(p))}`;
}

export function googleMapsUrl(p: PropertyAddress): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(joinAddress(p))}`;
}
