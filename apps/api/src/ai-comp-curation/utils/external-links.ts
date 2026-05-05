// Mirror of apps/web/src/lib/externalLinks.ts. Keep in sync.
// The API uses these to embed deep-link URLs in the AI prompt and the
// returned curation rows so the UI can render them without recomputing.

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
  return `https://www.zillow.com/homes/${encodeURIComponent(joinAddress(p))}_rb/`;
}

export function realtorUrl(p: PropertyAddress): string {
  return `https://www.google.com/search?q=${encodeURIComponent(
    `site:realtor.com ${joinAddress(p)}`,
  )}`;
}

export function googleMapsUrl(p: PropertyAddress): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(
    joinAddress(p),
  )}`;
}

export function buildExternalLinks(p: PropertyAddress): ExternalLinks {
  return {
    zillow: zillowUrl(p),
    realtor: realtorUrl(p),
    googleMaps: googleMapsUrl(p),
  };
}
