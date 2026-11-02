/**
 * The A Tier / B Tier ratings file: one row per case, the rating a docket
 * review gave it. Ian's first files came from Grok reading each live docket
 * (2026-11-02) with the columns Rating, County, Case number, Why this rating
 * and Rated by, and the rest of the sheet is context for the reader. Anything
 * that names those columns imports, in any order, on any sheet.
 */

export type ReviewRating = 'A' | 'B';
export const REVIEW_RATINGS: ReviewRating[] = ['A', 'B'];

export interface RatingFileRow {
  /** The spreadsheet row number, as Excel shows it. */
  row: number;
  sheet: string;
  /** Null when the cell held something other than A or B. */
  rating: ReviewRating | null;
  ratingText: string;
  county: string;
  caseNumber: string;
  reason: string | null;
  ratedBy: string | null;
}

const norm = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Header names each column answers to, normalized. */
const HEADERS: Record<'rating' | 'county' | 'caseNumber' | 'reason' | 'ratedBy', string[]> = {
  rating: ['rating', 'tier', 'review rating', 'grade'],
  county: ['county'],
  caseNumber: ['case number', 'case', 'case no', 'case num', 'case id'],
  reason: ['why this rating', 'why', 'reason', 'rating reason', 'notes'],
  ratedBy: ['rated by', 'reviewer', 'reviewed by'],
};

/**
 * "A", "a", "A Tier", "Tier A", "A-rated" are all A. Anything else is not a
 * rating, and the row is reported rather than guessed at.
 */
export function parseRating(v: unknown): ReviewRating | null {
  const t = norm(v).replace(/\b(tier|rated|rating|files?)\b/g, '').trim();
  return t === 'a' ? 'A' : t === 'b' ? 'B' : null;
}

/**
 * The keys a case number matches on. The same case is written several ways
 * across the clerk sites and the sheets people keep: 2025-0259TD,
 * 2025-259TD, 2025 259 TD. Two keys, so either spelling finds it: every
 * letter and digit run together, and each run with its leading zeros
 * dropped. The county is part of both, since case numbers repeat across
 * counties.
 */
export function caseKeys(county: unknown, caseNumber: unknown): string[] {
  const c = norm(county);
  const raw = String(caseNumber ?? '').toUpperCase();
  const flat = raw.replace(/[^A-Z0-9]/g, '');
  if (!c || !flat) return [];
  const runs = raw.match(/[0-9]+|[A-Z]+/g) || [];
  const unpadded = runs.map((r) => (/^[0-9]+$/.test(r) ? String(Number(r)) : r)).join('-');
  return [...new Set([`${c}|${flat}`, `${c}|~${unpadded}`])];
}

/**
 * Read every sheet of a ratings workbook. `sheets` is each sheet as rows of
 * cells (XLSX sheet_to_json with header: 1). A sheet without a Rating, County
 * and Case number header in its first ten rows is skipped, so a notes tab
 * cannot break the import.
 */
export function readRatingSheets(sheets: { name: string; rows: unknown[][] }[]): RatingFileRow[] {
  const out: RatingFileRow[] = [];
  for (const { name, rows } of sheets) {
    let headerAt = -1;
    let cols: Partial<Record<keyof typeof HEADERS, number>> = {};
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const cells = (rows[i] || []).map(norm);
      const found: typeof cols = {};
      for (const [field, names] of Object.entries(HEADERS) as [keyof typeof HEADERS, string[]][]) {
        const at = cells.findIndex((c) => names.includes(c));
        if (at >= 0) found[field] = at;
      }
      if (found.rating != null && found.county != null && found.caseNumber != null) {
        headerAt = i;
        cols = found;
        break;
      }
    }
    if (headerAt < 0) continue;

    const cell = (r: unknown[], k: keyof typeof HEADERS) => {
      const at = cols[k];
      if (at == null) return '';
      const v = r[at];
      return v == null ? '' : String(v).trim();
    };
    for (let i = headerAt + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const ratingText = cell(r, 'rating');
      const county = cell(r, 'county');
      const caseNumber = cell(r, 'caseNumber');
      // A blank line between blocks, or the empty rows Excel leaves at the end.
      if (!ratingText && !county && !caseNumber) continue;
      out.push({
        row: i + 1,
        sheet: name,
        rating: parseRating(ratingText),
        ratingText,
        county,
        caseNumber,
        reason: cell(r, 'reason') || null,
        ratedBy: cell(r, 'ratedBy') || null,
      });
    }
  }
  return out;
}
