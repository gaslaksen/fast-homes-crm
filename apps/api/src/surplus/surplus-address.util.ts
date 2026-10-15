/**
 * An owner's mailing address as a notice or a county record prints it, made
 * safe to store: a US address gets a two-letter state and a five digit ZIP, and
 * a foreign one keeps its province and postcode as printed and says which
 * country it is in.
 *
 * Before this, every address was forced into the US shape. The first Charlotte
 * pull (2026-10-15) saved 29 of 201 cases wrong: "84440" from Malaucene,
 * France as a ZIP under state "FR", a Colombian 05001 under the US military
 * code "AA", Markham, Ontario as city ONTARIO in state "CA", which reads as
 * California. Each of those would have been sent to BatchData as a US address.
 */

export interface MailingAddress {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** Null for a US address (territories included). Upper case otherwise: "CANADA". */
  country: string | null;
}

const US_STATES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO',
  CONNECTICUT: 'CT', DELAWARE: 'DE', 'DISTRICT OF COLUMBIA': 'DC', FLORIDA: 'FL', GEORGIA: 'GA',
  HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY',
  LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN',
  MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND',
  OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT',
  VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
  // Territories USPS delivers to as domestic mail.
  'PUERTO RICO': 'PR', 'U.S. VIRGIN ISLANDS': 'VI', 'US VIRGIN ISLANDS': 'VI', GUAM: 'GU',
  'AMERICAN SAMOA': 'AS', 'NORTHERN MARIANA ISLANDS': 'MP',
};
const US_CODES = new Set([...Object.values(US_STATES), 'AA', 'AE', 'AP']);

/** Every way a notice writes the United States. */
const US_COUNTRY = /^(?:U\.?\s*S\.?\s*A?\.?|UNITED\s+STATES(?:\s+OF\s+AMERICA)?|AMERICA)$/i;

const CA_PROVINCES: Record<string, string> = {
  ONTARIO: 'ON', QUEBEC: 'QC', 'BRITISH COLUMBIA': 'BC', ALBERTA: 'AB', MANITOBA: 'MB',
  SASKATCHEWAN: 'SK', 'NOVA SCOTIA': 'NS', 'NEW BRUNSWICK': 'NB', 'NEWFOUNDLAND AND LABRADOR': 'NL',
  NEWFOUNDLAND: 'NL', 'PRINCE EDWARD ISLAND': 'PE', YUKON: 'YT', 'NORTHWEST TERRITORIES': 'NT', NUNAVUT: 'NU',
};
const CA_CODES = new Set(Object.values(CA_PROVINCES));
const CA_POSTCODE = /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i;

function clean(v: unknown): string | null {
  const s = String(v ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[\s,]+$/, '')
    .trim();
  return s && s.toLowerCase() !== 'null' ? s : null;
}

/** "Florida", "FL", "fl." to "FL"; null when it is not a US state or territory. */
export function usStateCode(v?: string | null): string | null {
  const s = (clean(v) || '').toUpperCase().replace(/\.$/, '');
  if (!s) return null;
  if (US_CODES.has(s)) return s;
  return US_STATES[s] || null;
}

/** The country, or null when it is the United States or one of its territories. */
export function foreignCountry(v?: string | null): string | null {
  const s = (clean(v) || '').toUpperCase();
  if (!s || US_COUNTRY.test(s) || US_STATES[s]) return null;
  return s;
}

/**
 * Normalise one address. `country` comes from the source when it states one;
 * otherwise a Canadian province or postcode is enough to know, and anything
 * else that is not a US state is marked as outside the US rather than guessed
 * into one.
 */
export function normalizeMailing(raw: {
  street?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
  country?: unknown;
}): MailingAddress {
  const street = clean(raw.street);
  const city = clean(raw.city);
  const stateRaw = clean(raw.state);
  const zipRaw = clean(raw.zip);
  const countryRaw = clean(raw.country);

  let country = foreignCountry(countryRaw);
  // A territory named as the country ("PUERTO RICO") is a US address.
  const territory = countryRaw ? US_STATES[countryRaw.toUpperCase()] : undefined;
  const usState = usStateCode(stateRaw) || territory || null;

  if (!country && !territory) {
    const upper = (stateRaw || '').toUpperCase();
    // No province code is also a US one, and "CA" beside a Canadian postcode
    // is Canada, not California.
    // A province read into the city ("ONTARIO" over state "CA", case 25-0517)
    // counts too when no US ZIP says otherwise; Ontario, California has one.
    const provinceAsCity = !!CA_PROVINCES[(city || '').toUpperCase()] && !/^\d{5}/.test(zipRaw || '');
    if (CA_PROVINCES[upper] || CA_CODES.has(upper) || CA_POSTCODE.test(zipRaw || '') || provinceAsCity) {
      country = 'CANADA';
    } else if (stateRaw && !usState) {
      // Not a US state and no country given: never store it as one.
      country = 'OUTSIDE US';
    }
  }

  if (country) {
    return {
      street,
      city,
      state: stateRaw ? stateRaw.toUpperCase() : null,
      zip: zipRaw ? zipRaw.toUpperCase() : null,
      country,
    };
  }
  return {
    street,
    city,
    state: usState,
    // Five digits or nothing. Stripping the letters out of a postcode
    // ("L4T 1M9") would leave "419", a ZIP that is not one.
    zip: /^\d{5}/.exec(zipRaw || '')?.[0] || null,
    country: null,
  };
}

/** The city line of an address, with the country on the end when it is abroad. */
export function cityLine(a: Pick<MailingAddress, 'city' | 'state' | 'zip' | 'country'>): string {
  const head = [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return a.country ? [head, a.country].filter(Boolean).join(', ') : head;
}
