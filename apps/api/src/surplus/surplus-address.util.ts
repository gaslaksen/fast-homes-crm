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

/**
 * The identity of an address on one claimant's address list: the street upper
 * case with everything but letters and digits removed, a bar, and the first
 * five digits of the zip. "576 EASTERN PKWY #3G" and "576 Eastern Pkwy 3G"
 * are one row. The migration that created surplus_addresses computes the same
 * key in SQL, so a change here needs a matching data migration.
 */
export function surplusAddressKey(street?: string | null, zip?: string | null): string {
  const s = String(street || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const z = String(zip || '').replace(/[^0-9]/g, '').slice(0, 5);
  return `${s}|${z}`;
}

// ─── IDI retry rounds ───────────────────────────────────────────────────────

/**
 * What the IDI rounds have learned about one address. 'untried' until a batch
 * carries it, 'sent' while that batch is out, then 'hit' (IDI placed the
 * person there) or 'miss' (it could not).
 */
export const SURPLUS_ADDRESS_STATUS = {
  untried: 'untried',
  sent: 'sent',
  hit: 'hit',
  miss: 'miss',
} as const;

/**
 * Sources an address list row can carry beyond the ownerAddressSource values.
 * 'property' is the parcel that sold, written when a batch had nothing better
 * to send. 'idi_relative' is IDI listing the claimant as a relative of a
 * co-owner at an address. 'idi_sent' is an address an earlier batch was sent
 * with, recorded by the migration that started the rounds.
 */
export const SURPLUS_ADDRESS_SOURCE = {
  property: 'property',
  idiRelative: 'idi_relative',
  idiSent: 'idi_sent',
} as const;

/** The clerk's own record of where the surplus letter went. */
const CLERK_LETTER_SOURCES = new Set(['surplus_letter_notifications', 'notice_of_surplus_funds']);

const PO_BOX = /\b(?:P\.?\s*O\.?\s*BOX|POST\s+OFFICE\s+BOX|P\.?\s*O\.?\s*DRAWER)\b/i;
/**
 * A rural route or highway contract box is a home, not a post office box:
 * the 2026-11-02 resend placed a Lee claimant at a West Virginia "RT 1 BOX"
 * address the ingest had dropped.
 */
const RURAL_ROUTE = /^\s*(?:R\.?\s*R\.?|RT\.?|RTE\.?|ROUTE|RURAL\s+ROUTE|H\.?\s*C\.?|HCR)\s*\d+/i;
/** A street that starts with a house number, and not a lot's "0 MAIN ST". */
const HOUSE_NUMBER = /^\s*(?!0+\s)\d+[A-Z]?(?:-\d+)?\s+\S/i;

/**
 * A suite or private mailbox: an office or a mail drop nobody lives at. B001
 * (2026-11-03) sent four unrelated Charlotte owners to one Las Vegas suite
 * and IDI placed none of them.
 */
const MAIL_DROP = /\b(?:SUITE|STE|PMB)\b/i;

export function isPoBox(street?: string | null): boolean {
  return PO_BOX.test(String(street || ''));
}

export function isMailDrop(street?: string | null): boolean {
  return MAIL_DROP.test(String(street || ''));
}

/**
 * "320 N 40TH ST APT 1, PHILADELPHIA, PA, 19104": a whole US address typed
 * into the street box, split into its parts. Null for anything else, a
 * foreign address on one line included.
 */
export function splitOneLineUsAddress(
  line?: string | null,
): { street: string; city: string; state: string; zip: string } | null {
  const m = /^(.+?),\s*([^,]+?),?\s+([A-Za-z]{2})\.?,?\s+(\d{5})(?:-\d{4})?\s*$/.exec(String(line || '').trim()) ||
    /^(.+?),\s*([^,]+?),\s*([A-Za-z]{2})\.?,?\s*(\d{5})(?:-\d{4})?\s*$/.exec(String(line || '').trim());
  if (!m) return null;
  const state = usStateCode(m[3]);
  if (!state) return null;
  return { street: m[1].trim(), city: m[2].trim(), state, zip: m[4] };
}

/** A street someone can live at: a house number, or a rural route box. */
export function hasHouseNumber(street?: string | null): boolean {
  const s = String(street || '');
  return HOUSE_NUMBER.test(s) || RURAL_ROUTE.test(s);
}

export interface RoundAddress {
  id?: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country?: string | null;
  source: string;
  status: string;
  addressKey?: string | null;
  firstSeenAt?: Date | string | null;
}

/** An address IDI can be sent: a US street, city and state. */
export function sendableToIdi(a: Pick<RoundAddress, 'street' | 'city' | 'state' | 'country'>): boolean {
  return !a.country && !!String(a.street || '').trim() && !!String(a.city || '').trim() && !!String(a.state || '').trim();
}

/**
 * The order a person's untried addresses are sent in, one per batch. Lower is
 * sooner: the address on the card when it has a house number (what DealCore
 * already judged best for this person), then the clerk's letter, then any
 * other street address, then PO boxes, suites and streets with no house
 * number. IDI matches the name against who has lived at the address, so a
 * box or a mail drop, which nobody lives at, rarely places anyone and goes
 * last.
 */
export function idiAddressRank(a: RoundAddress, cardKey?: string | null): number {
  if (isPoBox(a.street) || isMailDrop(a.street) || !hasHouseNumber(a.street)) return 3;
  const key = a.addressKey || surplusAddressKey(a.street, a.zip);
  if (cardKey && key === cardKey) return 0;
  return CLERK_LETTER_SOURCES.has(a.source) ? 1 : 2;
}

/** The untried addresses IDI can be sent, best first. */
export function untriedForIdi<T extends RoundAddress>(addresses: T[], cardKey?: string | null): T[] {
  const seen = (a: T) => (a.firstSeenAt ? new Date(a.firstSeenAt).getTime() : 0);
  return addresses
    .filter((a) => a.status === SURPLUS_ADDRESS_STATUS.untried && sendableToIdi(a))
    .sort((a, b) => idiAddressRank(a, cardKey) - idiAddressRank(b, cardKey) || seen(a) - seen(b));
}

/** The address a batch row is sent with; `id` is its row on the address list, when it has one yet. */
export type SentAddress = Pick<RoundAddress, 'id' | 'street' | 'city' | 'state' | 'zip' | 'source'>;

/**
 * Every address a person could be sent to IDI at: their address list, plus
 * the card's address when the list does not hold it yet (typed in by hand
 * after the list was filled). The card address is what DealCore already
 * judged best for this person, so it is tried first.
 */
export function roundAddressesOf(d: any): { list: RoundAddress[]; cardKey: string | null } {
  const list: RoundAddress[] = [...(d?.addresses || [])];
  const cardKey = d?.ownerMailingStreet ? surplusAddressKey(d.ownerMailingStreet, d.ownerMailingZip) : null;
  if (cardKey && !list.some((a) => (a.addressKey || surplusAddressKey(a.street, a.zip)) === cardKey)) {
    list.push({
      street: d.ownerMailingStreet,
      city: d.ownerMailingCity || null,
      state: d.ownerMailingState || null,
      zip: d.ownerMailingZip || null,
      country: d.ownerMailingCountry || null,
      source: d.ownerAddressSource || 'manual',
      status: SURPLUS_ADDRESS_STATUS.untried,
      addressKey: cardKey,
    });
  }
  return { list, cardKey };
}

/** How many addresses a person has left for the IDI rounds. */
export function idiAddressesLeft(d: any, lead?: any): number {
  const { list, cardKey } = roundAddressesOf(d);
  const left = untriedForIdi(list, cardKey).length;
  // The property is the last round when it is a house no batch has sent.
  if (!lead) return left;
  const next = nextIdiAddress({ ...lead, surplusDetail: { ...d, addresses: list } });
  return left + ('address' in next && next.address.source === SURPLUS_ADDRESS_SOURCE.property ? 1 : 0);
}

/**
 * The one address this person goes into the next batch at, or why they
 * cannot go. Their best untried address first (idiAddressRank), and the
 * property as the last round, but only a real house: IDI matches on who has
 * lived at an address, and nobody has lived on a vacant lot.
 */
export function nextIdiAddress(l: any): { address: SentAddress } | { reason: string } {
  const d = l.surplusDetail;
  const { list, cardKey } = roundAddressesOf(d);
  const best = untriedForIdi(list, cardKey)[0];
  if (best) return { address: best };

  const property = {
    street: l.propertyAddress || null,
    city: l.propertyCity || null,
    state: l.propertyState || null,
    zip: l.propertyZip || null,
    source: SURPLUS_ADDRESS_SOURCE.property,
  };
  const propertyKey = surplusAddressKey(property.street, property.zip);
  const propertyTried = list.some((a) => (a.addressKey || surplusAddressKey(a.street, a.zip)) === propertyKey);
  const propertyLived = sendableToIdi(property) && hasHouseNumber(property.street);
  if (propertyLived && !propertyTried) return { address: property };

  if (list.some((a) => sendableToIdi(a)) || propertyTried) {
    return { reason: 'Every address on file has been sent to IDI. Research by name.' };
  }
  const foreign = list.find((a) => a.country);
  if (foreign) return { reason: `Address is outside the US (${foreign.country}).` };
  if (sendableToIdi(property)) {
    return { reason: 'Only the property is known, and it has no house number. Research by name.' };
  }
  return { reason: 'No street, city and state on file.' };
}

/**
 * The state a five digit ZIP belongs to, by its first three digits, or null
 * for a military or unknown prefix. The scanned notices sometimes misread the
 * state and not the ZIP: B003 (2026-11-03) carried "JERSEY CITY, NH 07302".
 */
const ZIP3_STATE: [number, number, string][] = [
  [5, 5, 'NY'], [6, 7, 'PR'], [8, 8, 'VI'], [9, 9, 'PR'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'],
  [39, 49, 'ME'], [50, 54, 'VT'], [55, 55, 'MA'], [56, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'],
  [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'], [200, 200, 'DC'], [201, 201, 'VA'], [202, 205, 'DC'],
  [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'], [290, 299, 'SC'], [300, 319, 'GA'],
  [320, 339, 'FL'], [341, 349, 'FL'], [350, 369, 'AL'], [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'],
  [400, 427, 'KY'], [430, 459, 'OH'], [460, 479, 'IN'], [480, 499, 'MI'], [500, 528, 'IA'], [530, 549, 'WI'],
  [550, 567, 'MN'], [569, 569, 'DC'], [570, 577, 'SD'], [580, 588, 'ND'], [590, 599, 'MT'], [600, 629, 'IL'],
  [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'], [700, 714, 'LA'], [716, 729, 'AR'], [730, 732, 'OK'],
  [733, 733, 'TX'], [734, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'],
  [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'], [885, 885, 'TX'], [889, 898, 'NV'], [900, 961, 'CA'],
  [967, 968, 'HI'], [969, 969, 'GU'], [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK'],
];

export function stateForZip(zip?: string | null): string | null {
  const m = /^(\d{3})\d{2}/.exec(String(zip || '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  const hit = ZIP3_STATE.find(([lo, hi]) => n >= lo && n <= hi);
  return hit ? hit[2] : null;
}
