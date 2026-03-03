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
 */

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

export interface ParsedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

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

  // Pattern 4: "Street 12345" (street + zip only, no city/state)
  const streetZipMatch = cleaned.match(/^(.+?)\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (streetZipMatch && !streetZipMatch[1].match(/,/)) {
    return {
      street: streetZipMatch[1].trim(),
      city: '',
      state: '',
      zip: streetZipMatch[2].trim(),
    };
  }

  // Pattern 5: "Street, Zip" (comma-separated street and zip)
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

/**
 * Normalizes address fields from a raw webhook payload.
 *
 * Merges explicit payload fields with anything parsed from a full address string.
 * Explicit fields always win over parsed values.
 */
export function normalizeLeadAddress(payload: Record<string, any>): {
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
} {
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

  // If the parsed street already extracted city/state/zip from rawStreet,
  // use the clean street-only value
  return {
    propertyAddress: street,
    propertyCity: city,
    propertyState: state,
    propertyZip: zip,
  };
}
