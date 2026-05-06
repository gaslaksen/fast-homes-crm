// Normalize an address string for duplicate-detection. Lowercase,
// collapse whitespace, expand street-suffix abbreviations and
// directionals so "123 N Main St" and "123 north Main Street" both
// canonicalize to the same key.
//
// We intentionally don't strip the city/state/zip portions — the
// dedup util compares whole strings, and stripping risks merging
// unrelated properties on different streets that happen to share a
// house number. Full-string match is conservative.

const SUFFIX_EXPANSIONS: Record<string, string> = {
  st: 'street',
  str: 'street',
  ave: 'avenue',
  av: 'avenue',
  blvd: 'boulevard',
  bvd: 'boulevard',
  ct: 'court',
  dr: 'drive',
  drv: 'drive',
  ln: 'lane',
  rd: 'road',
  pl: 'place',
  sq: 'square',
  ter: 'terrace',
  trl: 'trail',
  tr: 'trail',
  cir: 'circle',
  pkwy: 'parkway',
  pky: 'parkway',
  hwy: 'highway',
  fwy: 'freeway',
  expy: 'expressway',
  way: 'way',
};

const DIRECTIONAL_EXPANSIONS: Record<string, string> = {
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  ne: 'northeast',
  nw: 'northwest',
  se: 'southeast',
  sw: 'southwest',
};

const UNIT_TOKENS = new Set([
  'apt',
  'unit',
  'suite',
  'ste',
  '#',
]);

export function normalizeAddress(raw: string | null | undefined): string {
  if (!raw) return '';
  // Strip punctuation we don't want to compare on, lowercase, collapse spaces.
  const cleaned = raw
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/[#]/g, ' # ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const tokens = cleaned.split(' ');
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    if (UNIT_TOKENS.has(t)) {
      // Drop unit/apt/# suffixes (and the following token if numeric)
      // — same property regardless of which unit a duplicate references.
      const next = tokens[i + 1];
      if (next && /^[\w-]+$/i.test(next)) i++;
      continue;
    }
    if (DIRECTIONAL_EXPANSIONS[t]) {
      out.push(DIRECTIONAL_EXPANSIONS[t]);
      continue;
    }
    if (SUFFIX_EXPANSIONS[t]) {
      out.push(SUFFIX_EXPANSIONS[t]);
      continue;
    }
    out.push(t);
  }
  return out.join(' ');
}

// Convenience: normalize and reduce to "houseNumber|firstStreetWord|zip"
// where possible — a tighter key for grouping. Falls back to the full
// normalized string when the parts can't be confidently extracted.
export function compactAddressKey(raw: string | null | undefined): string {
  const normalized = normalizeAddress(raw);
  if (!normalized) return '';
  const tokens = normalized.split(' ');
  const houseNumber = tokens[0];
  if (!/^\d+/.test(houseNumber || '')) return normalized;
  // Find the trailing 5-digit zip if present
  const zipMatch = normalized.match(/\b(\d{5})(?:-\d{4})?\b\s*$/);
  const zip = zipMatch ? zipMatch[1] : '';
  // Pick the first non-directional street word after the house number
  let streetWord = '';
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (Object.values(DIRECTIONAL_EXPANSIONS).includes(t)) continue;
    streetWord = t;
    break;
  }
  if (!streetWord || !zip) return normalized;
  return `${houseNumber}|${streetWord}|${zip}`;
}
