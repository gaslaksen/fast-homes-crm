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
 * Build a parcel link without any network I/O. Mecklenburg addresses get a
 * Spatialest search link; known counties get their GIS site; everything else
 * gets a Google parcel-records search. Exact PID resolution (Mecklenburg GIS
 * MasterAddress query) happens later in the skip-trace enrich step.
 */
export function parcelLinkFor(address?: string, city?: string): ParcelLink {
  const cU = String(city || '').toUpperCase().trim();
  const isMeck = MECK_CITIES.has(cU) || !city;
  if (isMeck && address && address.indexOf(',') < 0) {
    return {
      parcelId: '',
      parcelUrl: `https://property.spatialest.com/nc/mecklenburg#/search/?term=${encodeURIComponent(address)}&page=1`,
      parcelType: 'search',
      parcelLabel: 'Search address',
    };
  }
  const county = CITY_COUNTY[cU];
  if (county && COUNTY_GIS[county]) {
    return { parcelId: '', parcelUrl: COUNTY_GIS[county], parcelType: 'county', parcelLabel: `${county} County GIS` };
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
