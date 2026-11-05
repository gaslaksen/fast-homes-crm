import { usStateCode } from './surplus-address.util';

/**
 * An address the way a person writes it in a letter: "1313 TORGERSON RD SE,
 * PALM BAY, FL 32909" reads "1313 Torgerson Rd SE, Palm Bay, FL 32909".
 *
 * Display only. County records arrive in capitals or half-spelled, and the
 * letters, texts and scripts print them as they are, which reads as a form
 * letter. The stored address is never rewritten: the county pulls, the IDI
 * matching and the returned-mail check all compare the raw strings, and the
 * next pull would write the capitals back anyway. The envelope itself is
 * not this: Lob prints the window block in USPS form (capitals, ZIP+4).
 *
 * The rules:
 * - every word Title Case, hyphenated parts each, Mc and O' names inside;
 * - directions (N, SE), state codes before a ZIP or at the end, and road
 *   prefixes (US, SR, CR, RR, PO) in capitals;
 * - 4TH reads 4th, and unit or lot numbers keep their capitals (127-B-33);
 * - the street's own type (the last word of the street, before a direction
 *   or unit) takes the USPS short form: Street St, Road Rd, Avenue Ave;
 * - PO Box, Apt, and the unit words in Title Case.
 */

const DIRECTIONS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
const UPPER_WORDS = new Set(['US', 'SR', 'CR', 'RR', 'HC', 'PO', 'II', 'III', 'IV', 'LLC']);
const LOWER_WORDS = new Set(['of', 'the', 'and', 'at', 'on', 'in', 'by', 'de', 'la', 'del']);
const UNIT_WORDS: Record<string, string> = {
  APT: 'Apt',
  APARTMENT: 'Apt',
  STE: 'Ste',
  SUITE: 'Suite',
  UNIT: 'Unit',
  LOT: 'Lot',
  BLDG: 'Bldg',
  BUILDING: 'Bldg',
  RM: 'Rm',
  ROOM: 'Rm',
  SPC: 'Spc',
  SPACE: 'Spc',
  TRLR: 'Trlr',
};

/** USPS street suffixes, full and short, to the short form a letter uses. */
const SUFFIX: Record<string, string> = {
  STREET: 'St', ST: 'St', STR: 'St',
  ROAD: 'Rd', RD: 'Rd',
  AVENUE: 'Ave', AVE: 'Ave', AV: 'Ave', AVN: 'Ave',
  DRIVE: 'Dr', DR: 'Dr', DRV: 'Dr',
  COURT: 'Ct', CT: 'Ct',
  CIRCLE: 'Cir', CIR: 'Cir', CIRC: 'Cir',
  BOULEVARD: 'Blvd', BLVD: 'Blvd', BOUL: 'Blvd',
  LANE: 'Ln', LN: 'Ln',
  PLACE: 'Pl', PL: 'Pl',
  TERRACE: 'Ter', TER: 'Ter', TERR: 'Ter',
  PARKWAY: 'Pkwy', PKWY: 'Pkwy', PKY: 'Pkwy',
  HIGHWAY: 'Hwy', HWY: 'Hwy',
  TRAIL: 'Trl', TRL: 'Trl',
  WAY: 'Way', WY: 'Way',
  LOOP: 'Loop',
  SQUARE: 'Sq', SQ: 'Sq',
  POINT: 'Pt', PT: 'Pt',
  COVE: 'Cv', CV: 'Cv',
  ALLEY: 'Aly', ALY: 'Aly',
  CROSSING: 'Xing', XING: 'Xing',
  CREEK: 'Crk', CRK: 'Crk',
  HARBOR: 'Hbr', HBR: 'Hbr',
  HEIGHTS: 'Hts', HTS: 'Hts',
  LANDING: 'Lndg', LNDG: 'Lndg',
  MANOR: 'Mnr', MNR: 'Mnr',
  PLAZA: 'Plz', PLZ: 'Plz',
  RIDGE: 'Rdg', RDG: 'Rdg',
  TRACE: 'Trce', TRCE: 'Trce',
  CAUSEWAY: 'Cswy', CSWY: 'Cswy',
  EXPRESSWAY: 'Expy', EXPY: 'Expy',
  TURNPIKE: 'Tpke', TPKE: 'Tpke',
  ESTATES: 'Ests', ESTS: 'Ests',
  GLEN: 'Gln', GLN: 'Gln',
  GROVE: 'Grv', GRV: 'Grv',
  RUN: 'Run',
  PATH: 'Path',
  PASS: 'Pass',
  PIKE: 'Pike',
  ROW: 'Row',
  WALK: 'Walk',
  BEND: 'Bnd', BND: 'Bnd',
  VIEW: 'Vw', VW: 'Vw',
  VISTA: 'Vis', VIS: 'Vis',
};

const ZIP = /^\d{5}(?:-\d{4})?$/;

function titleWord(w: string): string {
  return w
    .split('-')
    .map((part) => {
      const lower = part.toLowerCase();
      if (!lower) return part;
      // McDonald, O'Brien.
      if (/^mc[a-z]{2,}$/.test(lower)) return `Mc${lower.charAt(2).toUpperCase()}${lower.slice(3)}`;
      if (/^o'[a-z]{2,}$/.test(lower)) return `O'${lower.charAt(2).toUpperCase()}${lower.slice(3)}`;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('-');
}

/** One word, its trailing punctuation kept. */
function fixWord(raw: string, ctx: { next?: string; first: boolean; streetType: boolean; lastOfAll: boolean }): string {
  const m = /^(.*?)([.,;]*)$/.exec(raw)!;
  const word = m[1];
  const tail = m[2];
  if (!word) return raw;
  const up = word.toUpperCase();
  let out: string;
  if (/\d/.test(word)) {
    // 4TH reads 4th; anything else with a digit (a ZIP, 127-B-33, 12A) keeps its capitals.
    const ord = /^(\d+)(ST|ND|RD|TH)$/i.exec(word);
    out = ord ? `${ord[1]}${ord[2].toLowerCase()}` : up;
  } else if (word === '#' || word === '&') {
    out = word;
  } else if (DIRECTIONS.has(up.replace(/\./g, '')) && word.length <= 3) {
    return up.replace(/\./g, '') + tail.replace(/^\./, '');
  } else if (usStateCode(up) === up && up.length === 2 && ((ctx.next && ZIP.test(ctx.next)) || ctx.lastOfAll)) {
    out = up;
  } else if (UPPER_WORDS.has(up)) {
    out = up;
  } else if (ctx.streetType && SUFFIX[up]) {
    return SUFFIX[up] + tail.replace(/^\./, '');
  } else if (UNIT_WORDS[up]) {
    out = UNIT_WORDS[up];
  } else if (!ctx.first && LOWER_WORDS.has(word.toLowerCase())) {
    out = word.toLowerCase();
  } else {
    out = titleWord(word);
  }
  return out + tail;
}

/** Which word in a street segment is the street's type: the last word before a direction or a unit. */
function streetTypeIndex(words: string[]): number {
  const bare = words.map((w) => w.replace(/[.,;]+$/, '').toUpperCase());
  let end = bare.length;
  const unitAt = bare.findIndex((w, i) => i > 0 && (UNIT_WORDS[w] !== undefined || w === '#' || w.startsWith('#')));
  if (unitAt > 0) end = unitAt;
  while (end > 1 && DIRECTIONS.has(bare[end - 1])) end -= 1;
  const i = end - 1;
  // A type needs a name in front of it, and the house number is not one ("100 Court" is a name).
  if (i < 1 || !SUFFIX[bare[i]]) return -1;
  const nameWords = bare.slice(0, i).filter((w) => !/^\d/.test(w) && !DIRECTIONS.has(w));
  return nameWords.length ? i : -1;
}

export function letterAddress(line?: string | null): string {
  const raw = String(line ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const fixedPo = raw.replace(/\b(?:P\.?\s?O\.?|POST OFFICE)\s+BOX\b/gi, 'PO BOX');
  const segments = fixedPo.split(/\s*,\s*/);
  const allWords = segments.flatMap((s) => s.split(' '));
  const out: string[] = [];
  let seen = 0;
  segments.forEach((seg, si) => {
    const words = seg.split(' ').filter(Boolean);
    const isPoBox = /^PO BOX\b/i.test(seg);
    // The street is the first segment, when it starts with a house number.
    const typeAt = si === 0 && /^\d/.test(seg) && !isPoBox ? streetTypeIndex(words) : -1;
    const fixed = words.map((w, wi) => {
      const at = seen + wi;
      if (isPoBox && wi < 2) return wi === 0 ? 'PO' : 'Box';
      return fixWord(w, {
        next: allWords[at + 1]?.replace(/[.,;]+$/, ''),
        first: wi === 0,
        streetType: wi === typeAt,
        lastOfAll: at === allWords.length - 1 && si > 0,
      });
    });
    seen += words.length;
    out.push(fixed.join(' '));
  });
  return out.filter(Boolean).join(', ');
}
