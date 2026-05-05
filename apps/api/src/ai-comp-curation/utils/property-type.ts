// Canonicalize raw property-type strings from REAPI/BatchData/manual entry
// into a small set of classes used for hard pre-AI filtering. Subtypes are
// detected for Manufactured (single-wide vs double-wide, pre/post-1976
// HUD code) so the AI can flag them in reasoning even though they pass
// the class match.
//
// UNKNOWN forces the controller to return TYPE_REQUIRED — the user must
// confirm subject type manually before curation can run.

export type CanonicalType =
  | 'SFR'
  | 'MANUFACTURED'
  | 'TOWNHOUSE'
  | 'CONDO'
  | 'MULTI_2_4'
  | 'LAND'
  | 'UNKNOWN';

export type ManufacturedSubtype =
  | 'single_wide'
  | 'double_wide'
  | 'pre_1976'
  | 'post_1976';

export interface CanonicalResult {
  type: CanonicalType;
  subtypes: string[]; // free-form tags surfaced to the AI prompt
  confidence: number; // 0..1; <0.6 means the caller should treat as UNKNOWN
}

interface MatchRule {
  type: CanonicalType;
  patterns: RegExp[];
  confidence?: number;
}

// Order matters — most-specific first. Each entry's regexes are checked
// against the lowercased raw string. First match wins.
const RULES: MatchRule[] = [
  {
    type: 'MANUFACTURED',
    patterns: [
      /\bmanufactur/,
      /\bmobile\s*home/,
      /\bmh\b/,
      /\bsingle[\s-]?wide/,
      /\bdouble[\s-]?wide/,
      /\btriple[\s-]?wide/,
      /\bmodular/,
      /\bhud\s*coded/,
    ],
  },
  {
    type: 'CONDO',
    patterns: [/\bcondo/, /\bcondominium/, /\bco-?op\b/, /\bcoop\b/],
  },
  {
    type: 'TOWNHOUSE',
    patterns: [/\btown\s*house/, /\btownhome/, /\browhouse/, /\bbrownstone/],
  },
  {
    type: 'MULTI_2_4',
    patterns: [
      /\bduplex/,
      /\btriplex/,
      /\bquad(plex|ruplex)?/,
      /\b2[\s-]?(?:to[\s-]?)?4\s*(?:unit|family)/,
      /\b(2|3|4)[\s-]?family\b/,
      /\b(2|3|4)[\s-]?unit\b/,
      /\bmulti[\s-]?family\b/,
    ],
  },
  {
    type: 'LAND',
    patterns: [
      /\bvacant\s*land/,
      /\bvacant\s*lot/,
      /\bland\s*only/,
      /\bagricultur/,
      /\bunimproved/,
      /^\s*lot\b/,
    ],
  },
  {
    type: 'SFR',
    patterns: [
      /\bsingle[\s-]?family/,
      /\bsfr\b/,
      /\bdetached/,
      /\bresidential/,
      /\bhouse\b/,
      /\bsfh\b/,
    ],
  },
];

export function canonicalize(
  raw: string | null | undefined,
  yearBuilt?: number | null,
  description?: string | null,
): CanonicalResult {
  const text = `${(raw || '').toString()} ${(description || '').toString()}`
    .toLowerCase()
    .trim();

  if (!text) {
    return { type: 'UNKNOWN', subtypes: [], confidence: 0 };
  }

  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      const subtypes: string[] = [];
      if (rule.type === 'MANUFACTURED') {
        if (/\bsingle[\s-]?wide/.test(text)) subtypes.push('single_wide');
        if (/\bdouble[\s-]?wide/.test(text)) subtypes.push('double_wide');
        if (/\btriple[\s-]?wide/.test(text)) subtypes.push('triple_wide');
        if (/\bmodular/.test(text)) subtypes.push('modular');
        if (typeof yearBuilt === 'number') {
          subtypes.push(yearBuilt < 1976 ? 'pre_1976' : 'post_1976');
        }
      }
      return {
        type: rule.type,
        subtypes,
        confidence: rule.confidence ?? 0.9,
      };
    }
  }

  return { type: 'UNKNOWN', subtypes: [], confidence: 0 };
}

// True iff candidate's class matches subject's class. Subtype mismatches
// (single-wide vs double-wide) DON'T fail this check — they're flagged in
// the AI prompt instead, per spec.
export function isTypeMatch(
  subject: CanonicalResult,
  candidate: CanonicalResult,
): boolean {
  if (subject.type === 'UNKNOWN' || candidate.type === 'UNKNOWN') return false;
  return subject.type === candidate.type;
}
