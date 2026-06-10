// Build deep-link URLs to consumer real-estate sites for a property address.
// These URLs are constructed for human navigation (the user clicks and the
// site loads in a new tab). We never fetch content from these URLs server-
// or client-side — that's a hard line per spec.
//
// Source of truth for both client (UI) and server (AI prompt). The API
// keeps a thin mirror at apps/api/src/ai-comp-curation/utils/external-links.ts
// — keep both in sync.

export interface PropertyAddress {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export interface ExternalLinks {
  zillow: string;
  realtor: string;
  googleMaps: string;
}

function joinAddress(p: PropertyAddress): string {
  return [p.address, p.city, p.state, p.zip]
    .filter(Boolean)
    .join(', ')
    .trim();
}

export function zillowUrl(p: PropertyAddress): string {
  const q = encodeURIComponent(joinAddress(p));
  return `https://www.zillow.com/homes/${q}_rb/`;
}

export function realtorUrl(p: PropertyAddress): string {
  // Realtor.com address-normalized URLs are unstable; route through Google
  // site search so the link reliably lands on the correct property card.
  const full = joinAddress(p);
  return `https://www.google.com/search?q=${encodeURIComponent(
    `site:realtor.com ${full}`,
  )}`;
}

export function googleMapsUrl(p: PropertyAddress): string {
  const q = encodeURIComponent(joinAddress(p));
  return `https://www.google.com/maps/search/${q}`;
}

// Plain Google results for the address — lets the user pick maps, Zillow,
// Redfin, county records, or whatever else ranks for the property.
export function googleSearchUrl(p: PropertyAddress): string {
  const q = encodeURIComponent(joinAddress(p));
  return `https://www.google.com/search?q=${q}`;
}

export function buildExternalLinks(p: PropertyAddress): ExternalLinks {
  return {
    zillow: zillowUrl(p),
    realtor: realtorUrl(p),
    googleMaps: googleMapsUrl(p),
  };
}
