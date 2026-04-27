/**
 * Address Parser Utility
 *
 * Handles common PPC lead address formats:
 *   - "1515 Sycamore Street, Hearne, TX, USA"
 *   - "1515 Sycamore Street, Hearne, TX 77859"
 *   - "1515 Sycamore Street, Hearne, TX"
 *   - "1515 Sycamore Street 77859"        (street + zip only)
 *   - "1515 Sycamore Street"              (street only)
 *
 * Priority: explicit payload fields > parsed from full address string > zip lookup
 *
 * Zip lookup: uses zippopotam.us (free, no API key required).
 * When city/state are missing but a 5-digit zip is present, city and state
 * are automatically resolved before the lead is stored.
 */

import { Logger } from '@nestjs/common';

const zipLogger = new Logger('AddressParser');

const US_STATES: Record<string, string> = {
  AL: 'AL', AK: 'AK', AZ: 'AZ', AR: 'AR', CA: 'CA', CO: 'CO', CT: 'CT',
  DE: 'DE', FL: 'FL', GA: 'GA', HI: 'HI', ID: 'ID', IL: 'IL', IN: 'IN',
  IA: 'IA', KS: 'KS', KY: 'KY', LA: 'LA', ME: 'ME', MD: 'MD', MA: 'MA',
  MI: 'MI', MN: 'MN', MS: 'MS', MO: 'MO', MT: 'MT', NE: 'NE', NV: 'NV',
  NH: 'NH', NJ: 'NJ', NM: 'NM', NY: 'NY', NC: 'NC', ND: 'ND', OH: 'OH',
  OK: 'OK', OR: 'OR', PA: 'PA', RI: 'RI', SC: 'SC', SD: 'SD', TN: 'TN',
  TX: 'TX', UT: 'UT', VT: 'VT', VA: 'VA', WA: 'WA', WV: 'WV', WI: 'WI',
  WY: 'WY', DC: 'DC',
};

// Full state names → abbreviation. Used when a payload sends "Ohio" instead of "OH".
const US_STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY',
};

export interface ParsedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface NormalizedAddress {
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
}

// ---------------------------------------------------------------------------
// Zip Code Lookup — zippopotam.us (free, no key)
// ---------------------------------------------------------------------------

/** Simple in-process cache: zip → {city, state} to avoid repeat API calls */
const zipCache = new Map<string, { city: string; state: string }>();

/**
 * Resolves city and state from a US zip code using the free zippopotam.us API.
 * Returns null if the zip is invalid or the request fails.
 *
 * Example: "28104" → { city: "Matthews", state: "NC" }
 */
export async function lookupCityStateFromZip(
  zip: string,
): Promise<{ city: string; state: string } | null> {
  const clean = zip?.replace(/\D/g, '').slice(0, 5);
  if (!clean || clean.length !== 5) return null;

  if (zipCache.has(clean)) return zipCache.get(clean)!;

  try {
    const res = await fetch(`https://api.zippopotam.us/us/${clean}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      zipLogger.warn(`Zip lookup failed for ${clean}: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const place = data?.places?.[0];
    if (!place) return null;

    const result = {
      city: toTitleCase(place['place name'] || ''),
      state: (place['state abbreviation'] || '').toUpperCase(),
    };

    zipCache.set(clean, result);
    zipLogger.log(`Zip ${clean} → ${result.city}, ${result.state}`);
    return result;
  } catch (err: any) {
    zipLogger.warn(`Zip lookup error for ${clean}: ${err.message}`);
    return null;
  }
}

function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// ---------------------------------------------------------------------------
// Address String Parser
// ---------------------------------------------------------------------------

/**
 * Parses a full address string into components.
 * Handles many common formats sent by PPC platforms.
 */
export function parseAddressString(raw: string): Partial<ParsedAddress> {
  if (!raw) return {};

  // Strip trailing ", USA" / ", US" / ", United States"
  let cleaned = raw
    .replace(/,?\s*(USA|US|United States)\s*$/i, '')
    .trim();

  // Pattern 1: "Street, City, ST 12345" or "Street, City, ST, 12345"
  // e.g. "1515 Sycamore St, Hearne, TX 77859" or "1515 Sycamore St, Hearne, TX, 77859"
  const fullMatch = cleaned.match(
    /^(.+?),\s*([^,]+?),\s*([A-Z]{2})[,\s]+(\d{5}(?:-\d{4})?)\s*$/i,
  );
  if (fullMatch) {
    const state = fullMatch[3].toUpperCase();
    if (US_STATES[state]) {
      return {
        street: fullMatch[1].trim(),
        city: fullMatch[2].trim(),
        state,
        zip: fullMatch[4].trim(),
      };
    }
  }

  // Pattern 2: "Street, City, ST" (no zip)
  const noZipMatch = cleaned.match(/^(.+?),\s*([^,]+?),\s*([A-Z]{2})\s*$/i);
  if (noZipMatch) {
    const state = noZipMatch[3].toUpperCase();
    if (US_STATES[state]) {
      return {
        street: noZipMatch[1].trim(),
        city: noZipMatch[2].trim(),
        state,
        zip: '',
      };
    }
  }

  // Pattern 3: "Street, City ST 12345" (no comma before state)
  const noCommaStateMatch = cleaned.match(
    /^(.+?),\s*([A-Za-z\s]+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i,
  );
  if (noCommaStateMatch) {
    const state = noCommaStateMatch[3].toUpperCase();
    if (US_STATES[state]) {
      return {
        street: noCommaStateMatch[1].trim(),
        city: noCommaStateMatch[2].trim(),
        state,
        zip: noCommaStateMatch[4].trim(),
      };
    }
  }

  // Pattern 4: "Street City ST [Zip]" with NO commas. Anchors on a street suffix
  // (St/Ave/Rd/...) followed by city words and a 2-letter state abbreviation OR
  // a full state name. Optional trailing zip. Common in SMS-shaped notifications.
  // Tried before Patterns 5/6 because those would otherwise eagerly match the
  // trailing zip and lose the city/state.
  const STREET_SUFFIX = '(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court|Way|Pl|Place|Pkwy|Cir|Circle|Ter|Terrace|Hwy|Highway|Trl|Trail)';
  const noCommaRe = new RegExp(
    `^(.+?\\b${STREET_SUFFIX}\\.?)\\s+(.+?)\\s+([A-Za-z][A-Za-z\\s]{1,20}?)(?:\\s+(\\d{5}(?:-\\d{4})?))?\\s*$`,
    'i',
  );
  const noCommaMatch = cleaned.match(noCommaRe);
  if (noCommaMatch) {
    const stateRaw = noCommaMatch[3].trim();
    const stateUpper = stateRaw.toUpperCase();
    let state = '';
    if (stateUpper.length === 2 && US_STATES[stateUpper]) {
      state = stateUpper;
    } else {
      state = US_STATE_NAMES[stateRaw.toLowerCase()] || '';
    }
    if (state) {
      return {
        street: noCommaMatch[1].trim(),
        city: noCommaMatch[2].trim(),
        state,
        zip: noCommaMatch[4]?.trim() || '',
      };
    }
  }

  // Pattern 5: "Street 12345" (street + zip only, no city/state)
  const streetZipMatch = cleaned.match(/^(.+?)\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (streetZipMatch && !streetZipMatch[1].match(/,/)) {
    return {
      street: streetZipMatch[1].trim(),
      city: '',
      state: '',
      zip: streetZipMatch[2].trim(),
    };
  }

  // Pattern 6: "Street, Zip" (comma-separated street and zip)
  const streetCommaZipMatch = cleaned.match(/^(.+?),\s*(\d{5}(?:-\d{4})?)\s*$/);
  if (streetCommaZipMatch) {
    return {
      street: streetCommaZipMatch[1].trim(),
      city: '',
      state: '',
      zip: streetCommaZipMatch[2].trim(),
    };
  }

  // Fallback: return the whole thing as street
  return { street: cleaned, city: '', state: '', zip: '' };
}

// ---------------------------------------------------------------------------
// Sync normalizer (used by webhook handlers before async enrichment)
// ---------------------------------------------------------------------------

/**
 * Normalizes address fields from a raw webhook payload (synchronous).
 * Merges explicit payload fields with anything parsed from a full address string.
 * Explicit fields always win over parsed values.
 *
 * NOTE: Does NOT perform zip lookup — call normalizeLeadAddressAsync for the
 * full enrichment pipeline including city/state resolution from zip.
 */
export function normalizeLeadAddress(payload: Record<string, any>): NormalizedAddress {
  // Grab raw field values from payload (try multiple naming conventions)
  const rawStreet: string =
    payload.property_address ||
    payload.propertyAddress ||
    payload.street_address ||
    payload.streetAddress ||
    payload.address ||
    '';

  const rawCity: string =
    payload.city || payload.propertyCity || payload.property_city || '';
  const rawState: string =
    payload.state || payload.propertyState || payload.property_state || '';
  const rawZip: string =
    payload.zip || payload.zipcode || payload.zip_code || payload.propertyZip || payload.property_zip || '';

  // Try to parse the street field in case it's a full address
  const parsed = parseAddressString(rawStreet);

  // Merge: explicit payload values win over parsed values
  const street = parsed.street || rawStreet;
  const city = rawCity || parsed.city || '';
  const state = (rawState || parsed.state || '').toUpperCase();
  const zip = rawZip || parsed.zip || '';

  return {
    propertyAddress: street,
    propertyCity: city,
    propertyState: state,
    propertyZip: zip,
  };
}

// ---------------------------------------------------------------------------
// Async normalizer — full pipeline with zip lookup
// ---------------------------------------------------------------------------

/**
 * Full async address normalization pipeline:
 *   1. Parse any full-address string and merge with explicit payload fields
 *   2. If city or state are still missing but zip is present, look them up
 *
 * Use this everywhere a lead is created or updated.
 */
export async function normalizeLeadAddressAsync(
  payload: Record<string, any>,
): Promise<NormalizedAddress> {
  const addr = normalizeLeadAddress(payload);

  // Nothing to look up if city and state are already populated
  if (addr.propertyCity && addr.propertyState) return addr;

  // Try zip lookup to fill gaps
  if (addr.propertyZip) {
    const looked = await lookupCityStateFromZip(addr.propertyZip);
    if (looked) {
      if (!addr.propertyCity) addr.propertyCity = looked.city;
      if (!addr.propertyState) addr.propertyState = looked.state;
    }
  }

  return addr;
}

/**
 * Fill in missing city/state on an already-parsed address object.
 * Also strips any embedded city/state/country from the street field.
 * Use this inside createLead / updateLead when individual fields arrive
 * instead of a raw payload dict.
 */
export async function enrichAddressFromZip(addr: NormalizedAddress): Promise<NormalizedAddress> {
  // First, try to parse the street field — it may be a full address string
  // (e.g. "215 S Academy St Cary NC 27511"). Use any city/state/zip the parser
  // recovers to fill in missing fields, and replace street with the cleaned
  // version when parsing produced a shorter result.
  if (addr.propertyAddress) {
    const parsed = parseAddressString(addr.propertyAddress);
    if (parsed.street && parsed.street.length < addr.propertyAddress.length) {
      addr.propertyAddress = parsed.street;
    } else {
      addr.propertyAddress = cleanStreetAddress(addr.propertyAddress);
    }
    if (!addr.propertyCity && parsed.city) addr.propertyCity = parsed.city;
    if (!addr.propertyState && parsed.state) addr.propertyState = parsed.state;
    if (!addr.propertyZip && parsed.zip) addr.propertyZip = parsed.zip;
  }

  if (addr.propertyCity && addr.propertyState) return addr;
  if (!addr.propertyZip) return addr;

  const looked = await lookupCityStateFromZip(addr.propertyZip);
  if (looked) {
    if (!addr.propertyCity) addr.propertyCity = looked.city;
    if (!addr.propertyState) addr.propertyState = looked.state;
  }

  return addr;
}

/**
 * Strips city, state, zip, and country noise from a street address field.
 *
 * Examples:
 *   "123 Main St, Austin, TX 78701, USA" → "123 Main St"
 *   "123 Main St, Austin, TX"            → "123 Main St"
 *   "123 Main St 78701"                  → "123 Main St"
 *   "123 Main St"                        → "123 Main St"  (unchanged)
 */
export function cleanStreetAddress(raw: string): string {
  if (!raw) return raw;

  const parsed = parseAddressString(raw);

  // Only replace if parsing found a cleaner street component
  if (parsed.street && parsed.street !== raw && parsed.street.length < raw.length) {
    return parsed.street;
  }

  // Fallback: strip trailing ", City, ST 12345" / ", USA" patterns even if
  // the full parse didn't match (e.g. lower-case state abbreviations)
  return raw
    .replace(/,?\s*(USA|US|United States)\s*$/i, '')
    .replace(/,\s*[A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5}(-\d{4})?\s*$/i, '')  // ", City, ST 12345"
    .replace(/,\s*[A-Z]{2}\s+\d{5}(-\d{4})?\s*$/i, '')                  // ", ST 12345"
    .replace(/,\s*[A-Z]{2}\s*$/i, '')                                     // ", ST"
    .replace(/\s+\d{5}(-\d{4})?\s*$/, '')                                 // trailing zip
    .trim();
}
