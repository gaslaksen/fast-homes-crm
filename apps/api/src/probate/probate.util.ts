/**
 * Pure helpers for probate ingestion: dedupe key, tier parsing, and the two
 * free-text columns the reconciled probate lists carry the real facts in.
 *
 * Dependency-free on purpose, same as the foreclosure equivalents, so the
 * importer and any later ingest can share them without any I/O.
 */

/** A cell the source list fills with an em dash to mean "nothing here". */
export function blankish(v: any): boolean {
  const s = String(v ?? '').trim();
  return s === '' || s === '-' || s === '–' || s === '—' || s === 'N/A';
}

/** Trimmed cell text, with the list's own "empty" markers folded to ''. */
export function cellText(v: any): string {
  return blankish(v) ? '' : String(v).trim();
}

/**
 * Dedupe key: caseNumber | address. Neither half works alone. One estate
 * routinely holds several properties, so the case number would collapse them
 * into one lead; and the same house can reappear under a second estate, so the
 * address would drop the newer case. Falls back to the address when a row
 * carries no case number at all.
 */
export function probateUidOf(o: { caseNumber?: string; address?: string }): string {
  const caseKey = normalizeCaseNumber(o.caseNumber);
  const addr = String(o.address || '').trim().toUpperCase().replace(/\s+/g, '_');
  const base = `${caseKey}|${addr}`;
  return base === '|' ? '' : base.slice(0, 120);
}

/** Case numbers upper-cased and stripped of spaces so spacing never forks a row. */
export function normalizeCaseNumber(raw?: string | null): string {
  return String(raw || '').toUpperCase().replace(/\s+/g, '').trim();
}

/** 5-digit zip, zero-padded, from a sheet that stores zips as numbers. */
export function normalizeZip(v: any): string {
  const digits = String(v ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length >= 5 ? digits.slice(0, 5) : digits.padStart(5, '0');
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** "Mar 24, 2026" -> "2026-03-24". '' when it does not look like a date. */
export function parseListDate(raw?: string | null): string {
  const m = /([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/.exec(String(raw || ''));
  if (!m) return '';
  const mm = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!mm) return '';
  return `${m[3]}-${mm}-${m[2].padStart(2, '0')}`;
}

/** ISO YYYY-MM-DD to a local-midnight Date, or null. */
export function isoToDate(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

/** Numeric-ish cell ($, commas, % stripped). null when empty or unparseable. */
export function parseNum(v: any): number | null {
  if (v == null) return null;
  const cleaned = String(v).replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/** Last 10 digits of a phone, or null when there are not 10 to take. */
export function normalizePhoneDigits(v: any): string | null {
  if (!v) return null;
  const digits = String(v).replace(/[^0-9]/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/** 'Mobile' / 'Landline' out of a type cell, else null. */
export function phoneTypeOf(v: any): string | null {
  if (!v) return null;
  if (/mobile|cell/i.test(String(v))) return 'Mobile';
  if (/land/i.test(String(v))) return 'Landline';
  return null;
}

/**
 * Tier number out of any of the spellings these lists use: "Tier 1 - Attack
 * First", "Tier 1", "1". null when there is no tier in the text, which is what
 * a tier filter treats as "not in the requested tier".
 */
export function tierNumberOf(raw?: string | null): number | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = /tier\s*(\d+)/i.exec(s) || /^(\d+)$/.exec(s);
  return m ? Number(m[1]) : null;
}

export interface ParsedWhy {
  caseNumber: string;
  /** ISO date the estate was opened. */
  filedDate: string;
  /** City the heir/petitioner lives in, when the note names one. */
  heirCity: string;
}

/**
 * Pull the structured facts back out of the list's `why_this_lead` sentence,
 * e.g. "Probate case 26E000342-890 filed Mar 24, 2026 - heir/petitioner lives
 * in Monroe, not at the property". The case number and filed date are the only
 * place these lists carry the estate itself; the heir city appears only on the
 * absentee rows, so an empty heirCity is normal, not a parse failure.
 */
export function parseWhyThisLead(raw?: string | null): ParsedWhy {
  const s = String(raw || '');
  const caseM = /case\s+([0-9A-Za-z][0-9A-Za-z\-]*)/i.exec(s);
  const filedM = /filed\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i.exec(s);
  const cityM = /lives\s+in\s+([^,]+?)\s*,\s*not at the property/i.exec(s);
  return {
    caseNumber: normalizeCaseNumber(caseM?.[1]),
    filedDate: parseListDate(filedM?.[1]),
    heirCity: (cityM?.[1] || '').trim(),
  };
}

/** "Deceased owner: Albert Joseph Starnes" -> "Albert Joseph Starnes". */
export function parseDeceasedName(raw?: string | null): string {
  const s = cellText(raw);
  if (!s) return '';
  const m = /^\s*deceased(?:\s+owner)?\s*:\s*(.+)$/i.exec(s);
  return (m ? m[1] : s).trim();
}

/**
 * Key that groups probate leads belonging to the same person. One heir who
 * inherits nine houses becomes nine leads, all reachable on one phone, and a
 * drip must treat that as one conversation. Phone first because that is what
 * SMS sends to; email only when there is no phone at all.
 */
export function contactKeyOf(o: { phone?: string | null; email?: string | null }): string {
  const phone = normalizePhoneDigits(o.phone);
  if (phone) return `p:${phone}`;
  const email = String(o.email || '').trim().toLowerCase();
  return email ? `e:${email}` : '';
}
