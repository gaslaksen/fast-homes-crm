/**
 * Pure derivation helpers for foreclosure leads. Ported from the offline
 * tracker (index.html): dedupe uid, lead score, priority, equity spread,
 * days-to-sale, and the parcel / Zillow / Realtor link builders.
 *
 * These are intentionally dependency-free so they can run in the importer,
 * the RSS/PDF ingest, and the skip-trace enrich without any I/O.
 */

// Cities whose parcels live in the Mecklenburg GIS (exact PID lookup possible).
export const MECK_CITIES = new Set([
  'CHARLOTTE', 'HUNTERSVILLE', 'CORNELIUS', 'DAVIDSON', 'MATTHEWS', 'MINT HILL', 'PINEVILLE',
]);

// Cities that sit in South Carolina (drives NC vs SC in listing links).
export const SC_CITIES = new Set([
  'ROCK HILL', 'FORT MILL', 'CLOVER', 'CHESTER', 'GREAT FALLS', 'GAFFNEY', 'BLACKSBURG',
]);

// City -> surrounding county, for county-GIS fallback links outside Mecklenburg.
export const CITY_COUNTY: Record<string, string> = {
  GASTONIA: 'Gaston', 'BESSEMER CITY': 'Gaston', 'MOUNT HOLLY': 'Gaston', BELMONT: 'Gaston',
  DALLAS: 'Gaston', CHERRYVILLE: 'Gaston', STANLEY: 'Gaston',
  CONCORD: 'Cabarrus', KANNAPOLIS: 'Cabarrus', MIDLAND: 'Cabarrus', HARRISBURG: 'Cabarrus',
  STATESVILLE: 'Iredell', MOORESVILLE: 'Iredell', TROUTMAN: 'Iredell', 'SHERRILLS FRD': 'Iredell',
  SALISBURY: 'Rowan', SPENCER: 'Rowan', 'CHINA GROVE': 'Rowan', LANDIS: 'Rowan',
  MONROE: 'Union', WAXHAW: 'Union', MARSHVILLE: 'Union', WINGATE: 'Union', STALLINGS: 'Union',
  'INDIAN TRAIL': 'Union', WEDDINGTON: 'Union', 'MINERAL SPRINGS': 'Union',
  SHELBY: 'Cleveland', 'KINGS MOUNTAIN': 'Cleveland', GROVER: 'Cleveland', MOORESBORO: 'Cleveland',
  LAWNDALE: 'Cleveland', LINCOLNTON: 'Lincoln',
  NEWTON: 'Catawba', CONOVER: 'Catawba', HICKORY: 'Catawba', MAIDEN: 'Catawba',
  ALBEMARLE: 'Stanly', 'NEW LONDON': 'Stanly', BADIN: 'Stanly', LOCUST: 'Stanly',
  NORWOOD: 'Stanly', OAKBORO: 'Stanly',
  WADESBORO: 'Anson', POLKTON: 'Anson', TROY: 'Montgomery', MOCKSVILLE: 'Davie',
  LEXINGTON: 'Davidson County', DENTON: 'Davidson County',
  'ROCK HILL': 'York SC', 'FORT MILL': 'York SC', CLOVER: 'York SC',
  CHESTER: 'Chester SC', 'GREAT FALLS': 'Chester SC',
  GAFFNEY: 'Cherokee SC', BLACKSBURG: 'Cherokee SC',
};

// County -> public GIS/tax site (parcel link fallback).
export const COUNTY_GIS: Record<string, string> = {
  Gaston: 'https://gis.gastongov.com/desktop/',
  Cabarrus: 'https://gis.cabarruscounty.us/gomaps/',
  Iredell: 'https://gis.iredellcountync.gov/',
  Rowan: 'https://gis.rowancountync.gov/rowanmaps/',
  Union: 'https://gis.co.union.nc.us/olv/',
  Cleveland: 'https://tax.clevelandcounty.com/',
  Lincoln: 'https://gis.lincolncounty.org/',
  Catawba: 'https://gis.catawbacountync.gov/',
  Stanly: 'https://stanly.mapsonline.net/',
  Anson: 'https://anson.mapsofcarolina.com/',
  Montgomery: 'https://montgomery.connectgis.com/',
  Davie: 'https://davie.connectgis.com/',
  'Davidson County': 'https://gis.co.davidson.nc.us/',
  'York SC': 'https://property.yorkcountygov.com/',
  'Chester SC': 'https://chestercounty.connectgis.com/',
  'Cherokee SC': 'https://cherokeesc.connectgis.com/',
};

/** County for a city: Mecklenburg for the Meck set, else the CITY_COUNTY map. */
export function countyForCity(city?: string): string | null {
  const cU = String(city || '').toUpperCase().trim();
  if (!cU) return null;
  if (MECK_CITIES.has(cU)) return 'Mecklenburg';
  return CITY_COUNTY[cU] || null;
}

/** All cities (uppercase) known to belong to a given county. */
export function citiesInCounty(county: string): string[] {
  const out: string[] = [];
  if (county === 'Mecklenburg') out.push(...Array.from(MECK_CITIES));
  for (const [cityU, cnty] of Object.entries(CITY_COUNTY)) {
    if (cnty === county) out.push(cityU);
  }
  return out;
}

/** Slug for URLs: collapse non-alphanumerics to single hyphens. */
export function slug(s: string): string {
  return String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Parse a numeric-ish string (strips $ , etc). Returns null when empty/NaN. */
export function parseNum(s: any): number | null {
  if (s == null) return null;
  const cleaned = String(s).replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/** Normalize a date-ish value to ISO YYYY-MM-DD, or '' when unparseable. */
export function parseDateISO(s: any): string {
  if (!s) return '';
  if (s instanceof Date) return isNaN(s.getTime()) ? '' : s.toISOString().slice(0, 10);
  const str = String(s).trim();
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
  const d = new Date(str);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Convert an ISO date string to a Date at local midnight, or null. */
export function isoToDate(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

/** Whole days from today to the given ISO date (negative = past). */
export function daysToSale(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

/**
 * Normalize a raw phone into 10 digits, or null when it is not a valid US number.
 */
export function normalizePhoneDigits(s: any): string | null {
  if (!s) return null;
  const digits = String(s).replace(/[^0-9]/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/** Phone line type embedded in a raw cell like "7045551234 (Mobile)". */
export function phoneTypeOf(s: any): string | null {
  if (!s) return null;
  if (/mobile/i.test(String(s))) return 'Mobile';
  if (/land/i.test(String(s))) return 'Landline';
  return null;
}

/**
 * ISO week key for weekly touch tracking, e.g. "2026-W30". Ported from the
 * offline tracker's isoWeek() so rollover behavior matches.
 */
export function isoWeekKey(date = new Date()): string {
  const dt = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((dt.getTime() - ys.getTime()) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

/** Count of checked days in a touchDays object like {mon:true,tue:false}. */
export function touchDayCount(days: any): number {
  if (!days || typeof days !== 'object') return 0;
  return Object.values(days).filter(Boolean).length;
}

/** State for a city: SC when in the SC set, else NC. */
export function stateForCity(city?: string): 'NC' | 'SC' {
  return SC_CITIES.has(String(city || '').toUpperCase()) ? 'SC' : 'NC';
}

/** Dedupe key: caseNumber | address | saleDate, spaces to underscores. */
export function uidOf(o: { caseNumber?: string; address?: string; saleDate?: string }): string {
  const base = `${o.caseNumber || ''}|${o.address || ''}|${o.saleDate || ''}`;
  const cleaned = base.replace(/\s+/g, '_').slice(0, 80);
  return cleaned && cleaned !== '||' ? cleaned : `imp_${slug(o.address || '')}`.slice(0, 80);
}

/** Equity spread = assessed - loan (rounded), or null when either is missing. */
export function equitySpreadOf(assessed: number | null, loan: number | null): number | null {
  if (assessed == null || loan == null) return null;
  return Math.round(assessed - loan);
}

/** Zillow listing search URL for a property. */
export function zillowUrlOf(address?: string, city?: string, zip?: string): string {
  if (!address) return '';
  const st = stateForCity(city);
  const q = [address, city, st, zip].filter(Boolean).join(' ');
  return `https://www.zillow.com/homes/${slug(q)}_rb/`;
}

/** Realtor.com search query string (only for a clean single-line address). */
export function realtorQueryOf(address?: string, city?: string, zip?: string): string {
  if (!address || address.indexOf(',') >= 0) return '';
  const st = stateForCity(city);
  return [address, city, st, zip].filter(Boolean).join(' ');
}

export interface ParcelLink {
  parcelId: string;
  parcelUrl: string;
  parcelType: 'exact' | 'county' | 'search';
  parcelLabel: string;
}

/**
 * How much human work a foreclosure lead carries, for choosing which of a set
 * of duplicates to keep. Call notes outrank everything because they are the
 * thing that cannot be reconstructed; a moved work status is next.
 *
 * Ties are meant to be broken by age. Callers sort a createdAt-ascending list
 * with a stable sort, which leaves the older row first on an equal score.
 */
export function dupeScore(lead: {
  sellerPhone?: string | null;
  foreclosureDetail?: {
    callNotes?: string | null;
    workStatus?: string | null;
    doNotCall?: boolean | null;
    touchCount?: number | null;
    touchDays?: any;
  } | null;
}): number {
  const d = lead.foreclosureDetail;
  if (!d) return 0;
  let s = 0;
  if (String(d.callNotes || '').trim()) s += 8;
  if (d.workStatus && d.workStatus !== 'NOT_CONTACTED') s += 4;
  if (d.doNotCall) s += 2;
  if ((d.touchCount || 0) > 0 || touchDayCount(d.touchDays) > 0) s += 2;
  if (String(lead.sellerPhone || '').trim()) s += 1;
  return s;
}

/** Trailing words dropped from an address key so "DR" and "DRIVE" agree. */
const ADDRESS_SUFFIXES = new Set([
  'RD', 'ROAD', 'DR', 'DRIVE', 'LN', 'LANE', 'CT', 'COURT', 'ST', 'STREET',
  'PL', 'PLACE', 'WAY', 'CIR', 'CIRCLE', 'AVE', 'AVENUE', 'AV', 'BLVD', 'BOULEVARD',
  'TRL', 'TRAIL', 'PKWY', 'PARKWAY', 'TER', 'TERRACE', 'LOOP', 'RUN', 'XING',
  'CROSSING', 'HWY', 'HIGHWAY', 'CV', 'COVE', 'RDG', 'RIDGE', 'PT', 'POINT',
]);

/** Words that start a unit designator; everything from there on is dropped. */
const UNIT_MARKERS = new Set(['UNIT', 'APT', 'STE', 'SUITE', 'LOT', 'BLDG', 'FLOOR', 'FL']);

/**
 * Stable key for "the same property", used to recognize a re-filed notice when
 * it carries no case number. Uppercases, strips punctuation, cuts any unit
 * designator, and drops one trailing street suffix, so these all agree:
 *
 *   "10990 Princeton Village Dr."  "10990 PRINCETON VILLAGE DRIVE"
 *   "10990 Princeton Village Dr Unit 3"
 *
 * The zip rides along when known, because the street part alone collides -
 * "120 Charlotte St" and "120 Charlotte Ave" both reduce to "120 CHARLOTTE".
 * Exactly one suffix is dropped, never a run: "120 Park Place Drive" must not
 * erode to "120 PARK".
 *
 * Returns '' when there is not enough to key on, and callers must treat that
 * as "no match" rather than as a key that matches other empty ones.
 */
export function addressKeyOf(address?: string | null, zip?: string | null): string {
  const clean = String(address || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';

  let tokens = clean.split(' ');
  const unitIdx = tokens.findIndex((t) => UNIT_MARKERS.has(t));
  if (unitIdx > 1) tokens = tokens.slice(0, unitIdx);
  if (tokens.length > 2 && ADDRESS_SUFFIXES.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);
  if (tokens.length < 2) return '';

  const z = String(zip || '').replace(/[^0-9]/g, '').slice(0, 5);
  return z ? `${tokens.join(' ')}|${z}` : tokens.join(' ');
}

/**
 * Owner-occupied when the mailing address matches the property address on
 * house number and first street word. Deliberately loose: the two are written
 * differently often enough ("5125 Birchbark Ln" against "5125 BIRCHBARK LANE")
 * that an exact compare would report absentee owners who are not.
 *
 * Returns null when either side is too short to compare, so an address we
 * cannot judge stays unknown rather than being called absentee.
 */
export function ownerOccupiedFrom(
  mailingAddress?: string | null,
  propertyAddress?: string | null,
): 'Y' | 'N' | null {
  const words = (s?: string | null) =>
    String(s || '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ');
  const m = words(mailingAddress);
  const p = words(propertyAddress);
  if (m.length < 2 || p.length < 2) return null;
  return m[0] === p[0] && m[1] === p[1] ? 'Y' : 'N';
}

/**
 * Build a parcel link without any network I/O. Mecklenburg addresses get a
 * Spatialest search link; everything else gets a Google parcel-records search
 * (county GIS homepages proved useless as card links since they cannot deep
 * link an address). Exact PID resolution (Mecklenburg GIS MasterAddress
 * query) happens later in the skip-trace enrich step.
 *
 * A parcelId supplied by the source (purchased lists carry one) beats any
 * address search and skips that lookup. Only Mecklenburg can deep link a PID,
 * so elsewhere the id is stored and folded into the search terms instead of
 * being pointed at a county that would not recognize it.
 */
export function parcelLinkFor(address?: string, city?: string, parcelId?: string): ParcelLink {
  const cU = String(city || '').toUpperCase().trim();
  const isMeck = MECK_CITIES.has(cU) || !city;
  const pid = String(parcelId || '').trim();

  if (pid) {
    // Unlike the address branch below, a blank city is NOT treated as
    // Mecklenburg: sending another county's parcel id to the Mecklenburg
    // record search returns someone else's property, or nothing.
    if (MECK_CITIES.has(cU)) {
      return {
        parcelId: pid,
        parcelUrl: `https://property.spatialest.com/nc/mecklenburg#/search/?term=${encodeURIComponent(pid)}&page=1`,
        parcelType: 'exact',
        parcelLabel: `PID ${pid}`,
      };
    }
    return {
      parcelId: pid,
      parcelUrl: `https://www.google.com/search?q=${encodeURIComponent(
        `${pid} ${city || ''} parcel property records`,
      )}`,
      parcelType: 'county',
      parcelLabel: `Parcel ${pid}`,
    };
  }

  if (isMeck && address && address.indexOf(',') < 0) {
    return {
      parcelId: '',
      parcelUrl: `https://property.spatialest.com/nc/mecklenburg#/search/?term=${encodeURIComponent(address)}&page=1`,
      parcelType: 'search',
      parcelLabel: 'Search address',
    };
  }
  return {
    parcelId: '',
    parcelUrl: `https://www.google.com/search?q=${encodeURIComponent(`${address || ''} ${city || ''} parcel property records`)}`,
    parcelType: 'search',
    parcelLabel: 'County parcel search',
  };
}

export interface ScoreInput {
  priority?: string;
  equityPct?: number | null;
  ownerOccupied?: string | null; // 'Y' | 'N' | null
  phoneCount?: number;
  hasEmail?: boolean;
  daysToSale?: number | null;
  loanDateIso?: string | null;
  skipStatus?: string | null;
  dead?: boolean;
}

/**
 * 0-100 lead score, ported verbatim from the tracker's scoreOf(): priority
 * base, equity band, absentee bonus, contactability, sale urgency, old-loan
 * bonus, minus skip-miss / dead penalties.
 */
export function scoreOf(o: ScoreInput): number {
  let s = ({ HIGH: 30, MEDIUM: 18, LOW: 6 } as Record<string, number>)[(o.priority || '').toUpperCase()] || 0;
  const eq = o.equityPct;
  if (eq != null) {
    if (eq >= 60) s += 30;
    else if (eq >= 40) s += 22;
    else if (eq >= 20) s += 14;
    else if (eq >= 0) s += 6;
  }
  if (o.ownerOccupied === 'N') s += 8;
  if ((o.phoneCount || 0) > 0) s += 12;
  if (o.hasEmail) s += 5;
  if (o.daysToSale != null && o.daysToSale >= 0 && o.daysToSale <= 30) s += 8;
  if (o.loanDateIso) {
    const y = +String(o.loanDateIso).slice(0, 4);
    if (y && y <= 2010) s += 5;
  }
  const sk = (o.skipStatus || '').toLowerCase();
  if (sk.indexOf('no match') >= 0 || sk.indexOf('no address') >= 0) s -= 20;
  if (o.dead) s -= 10;
  return Math.max(0, Math.min(100, s));
}

/** Normalize a raw priority string to HIGH | MEDIUM | LOW (default LOW). */
export function normalizePriority(p?: string): 'HIGH' | 'MEDIUM' | 'LOW' {
  const up = String(p || '').toUpperCase();
  return up === 'HIGH' || up === 'MEDIUM' ? up : 'LOW';
}

export interface PriorityInput {
  noticeType?: string;
  ownerNames?: string;
  loanDateIso?: string | null;
  city?: string;
  county?: string;
}

/**
 * Triage a notice to HIGH/MEDIUM/LOW using the pipeline rules from the daily
 * task, for RSS/PDF leads that arrive without a pre-set priority.
 *   HIGH: individual owner with a 10+ year old loan (likely high equity),
 *         HOA/claim-of-lien foreclosures, estates/heirs, pre-foreclosure
 *         hearings meeting the same criteria.
 *   LOW:  LLC/builder-owned, sheriff execution sales, out-of-county.
 *   MEDIUM: everything else (individual-owner mortgage / hearing).
 */
export function computePriority(o: PriorityInput): 'HIGH' | 'MEDIUM' | 'LOW' {
  const nt = String(o.noticeType || '').toLowerCase();
  const owners = String(o.ownerNames || '');
  const ownersUp = owners.toUpperCase();
  const isEntity = /\b(LLC|INC|L\.?L\.?C|CORP|COMPANY|TRUST|HOLDINGS|PROPERTIES|CAPITAL|BUILDERS?|HOMES\b)\b/.test(ownersUp);
  const isEstate = /\b(ESTATE|HEIRS?|DECEASED|MINOR HEIRS)\b/.test(ownersUp);
  const outOfCounty = o.county ? o.county.toLowerCase() !== 'mecklenburg' : false;

  if (nt.includes('sheriff')) return 'LOW';
  if (isEntity) return 'LOW';
  if (outOfCounty) return 'LOW';

  if (nt.includes('hoa') || nt.includes('lien')) return 'HIGH';
  if (isEstate) return 'HIGH';

  const loanYear = o.loanDateIso ? +String(o.loanDateIso).slice(0, 4) : 0;
  const oldLoan = loanYear > 0 && new Date().getFullYear() - loanYear >= 10;
  if (owners && !isEntity && oldLoan) return 'HIGH';

  return 'MEDIUM';
}

/**
 * Split an "Owner Names" string into a first/last pair for the Lead record.
 * Uses the first owner when several are semicolon-separated. Returns empty
 * strings when nothing usable is present (Lead requires non-null names).
 */
export function splitOwnerName(owners?: string): { firstName: string; lastName: string } {
  const first = String(owners || '').split(';')[0].trim();
  if (!first) return { firstName: '', lastName: '' };
  const parts = first.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** Whether a lead should be treated as dead based on notes/skip text. */
export function looksDead(text?: string): boolean {
  return /dead|no match|no address|bankrupt|deceased/i.test(String(text || ''));
}
