import * as crypto from 'crypto';
import { ForeclosureDocumentType, ForeclosureExtractionMethod } from '@fast-homes/shared';

/**
 * Below this many characters per page the PDF has no usable text layer and is
 * image-only. Sampled Mecklenburg eCourts filings run 1800-2400, so the gap is
 * wide; anything under the floor is flagged for manual entry rather than OCR'd.
 */
export const THIN_TEXT_CHARS_PER_PAGE = 400;

/**
 * How much of the document counts as the caption. The filing type is stated in
 * the first block of page 1; the body afterwards quotes every other filing type
 * in boilerplate ("...prevent the proposed sale", "...upset bid period"), so
 * scanning the whole document misclassifies every notice we have seen.
 */
const CAPTION_WINDOW = 1500;

/** sha256 of the uploaded bytes, used as the re-upload idempotency key. */
export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Lowercase and drop every non-alphanumeric character.
 *
 * Required, not cosmetic. Pages 1-2 of an eCourts filing are scans carrying an
 * invisible OCR text layer, and pdf-parse returns those with the spaces gone:
 * "NOTICEOFHEARINGON FORECLOSURE OF DEED OFTRUST". Matching squashed patterns
 * against squashed text makes spaced and mashed pages behave identically.
 */
export function squash(text: string): string {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Filing type from the caption block. Ordered most-specific first so an order
 * allowing a sale is not read as a notice of sale. Returns OTHER when nothing
 * matches; callers never guess.
 */
export function classifyDocumentType(text: string): ForeclosureDocumentType {
  const caption = squash(text).slice(0, CAPTION_WINDOW);
  if (!caption) return ForeclosureDocumentType.OTHER;

  const has = (...patterns: string[]) => patterns.some((p) => caption.includes(p));

  if (has('noticeofupsetbid', 'noticeofresale')) return ForeclosureDocumentType.NOTICE_OF_UPSET_BID;
  if (has('noticeofcancellation', 'cancellationofforeclosure', 'cancellationofsale')) {
    return ForeclosureDocumentType.CANCELLATION;
  }
  if (has('substitutionoftrustee', 'appointmentofsubstitutetrustee')) {
    return ForeclosureDocumentType.SUBSTITUTION_OF_TRUSTEE;
  }
  if (has('orderallowingforeclosure', 'orderallowingsale', 'orderauthorizingsale', 'orderpermittingsale')) {
    return ForeclosureDocumentType.ORDER_ALLOWING_SALE;
  }
  if (has('noticeofhearing')) return ForeclosureDocumentType.NOTICE_OF_HEARING;
  if (has('noticeofforeclosuresale', 'noticeofsubstitutetrusteessale', 'noticeofsale')) {
    return ForeclosureDocumentType.NOTICE_OF_SALE;
  }
  return ForeclosureDocumentType.OTHER;
}

/**
 * Canonical form of an NC special proceeding case number: "26SP002244-590"
 * (year, SP, sequence, county code). Returns null for anything that is not one,
 * which is what stops a blank or junk value being used as a dedupe key.
 */
export function normalizeCaseNumber(value?: string | null): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{2})\s*SP\s*(\d{4,6})(?:\s*-\s*(\d{2,3}))?$/i);
  if (!m) return null;
  return m[3] ? `${m[1]}SP${m[2]}-${m[3]}` : `${m[1]}SP${m[2]}`;
}

/** Whether a value is a usable NC case number, safe to key a case on. */
export function isCaseNumberLike(value?: string | null): boolean {
  return normalizeCaseNumber(value) !== null;
}

/**
 * NC special proceeding case number read out of filing text. eCourts stamps it
 * as the first token of page 1. Read from the caption window only, so a case
 * referenced inside an attached exhibit does not win over the case this filing
 * belongs to.
 */
export function caseNumberFrom(text: string): string | null {
  const head = String(text || '').slice(0, CAPTION_WINDOW * 2);
  const m = head.match(/\b(\d{2})\s*SP\s*(\d{4,6})\s*-\s*(\d{2,3})\b/i);
  if (m) return normalizeCaseNumber(`${m[1]}SP${m[2]}-${m[3]}`);
  const bare = head.match(/\b(\d{2})\s*SP\s*(\d{4,6})\b/i);
  return bare ? normalizeCaseNumber(`${bare[1]}SP${bare[2]}`) : null;
}

/** Mean characters of extracted text per page, or null when page count is unknown. */
export function charsPerPageOf(text: string, pageCount: number | null): number | null {
  if (!pageCount || pageCount <= 0) return null;
  return Math.round((String(text || '').length / pageCount) * 10) / 10;
}

/**
 * Whether the text layer is too thin to extract from. Unknown page count falls
 * back to a total-length check so a parse that reports no pages still gets
 * judged rather than silently passing.
 */
export function isTextLayerThin(text: string, pageCount: number | null): boolean {
  const chars = String(text || '').trim().length;
  if (!chars) return true;
  const perPage = charsPerPageOf(text, pageCount);
  if (perPage == null) return chars < THIN_TEXT_CHARS_PER_PAGE;
  return perPage < THIN_TEXT_CHARS_PER_PAGE;
}

/**
 * Which path produced the text. Only the text layer is implemented; OCR is
 * deliberately deferred because every sampled NC eCourts filing carries a
 * usable layer. NONE records that nothing readable came out, so the share of
 * documents that would need OCR is measured rather than assumed.
 */
export function extractionMethodOf(text: string, pageCount: number | null): ForeclosureExtractionMethod {
  return isTextLayerThin(text, pageCount)
    ? ForeclosureExtractionMethod.NONE
    : ForeclosureExtractionMethod.TEXT_LAYER;
}
