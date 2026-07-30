/**
 * Output contract for the filing extractor.
 *
 * Every field is a {value, confidence} pair rather than a flat value plus a
 * separate confidence map. Structured outputs forbid free-form object keys
 * (`additionalProperties` must be false), so a dynamic confidence map cannot be
 * expressed in the schema at all - and pairing them guarantees the model can
 * never return a value with no score, or a score for a field it did not fill.
 *
 * Schema constraints the API does not enforce (min/max on numbers, string
 * lengths) are clamped in code after the call. See EXTRACTION_VERSION.
 */

/** Bump when the prompt or field set changes, so re-extraction is detectable. */
export const EXTRACTION_VERSION = 1;

/** Every field the model is asked for, in the order the prompt describes them. */
export const FILING_FIELDS = [
  'case_number',
  'county',
  'filed_at',
  'submitted_at',
  'record_owner_names',
  'substitute_trustee',
  'trustee_attorney',
  'trustee_attorney_bar_no',
  'trustee_firm',
  'trustee_firm_address',
  'trustee_firm_phone',
  'trustee_file_number',
  'holder_name',
  'holder_address',
  'original_beneficiary',
  'dot_date',
  'dot_book',
  'dot_page',
  'original_principal',
  'property_address',
  'tax_parcel_id',
  'hearing_date',
  'hearing_time',
  'hearing_method',
  'sale_date',
  'sale_time',
] as const;

export type FilingField = (typeof FILING_FIELDS)[number];

/** Fields returned as an array of strings rather than a single string. */
const LIST_FIELDS: FilingField[] = ['record_owner_names'];
/** Fields returned as a number. */
const NUMBER_FIELDS: FilingField[] = ['original_principal'];

/**
 * Absent fields are the empty string / empty array rather than null.
 *
 * Not a style choice: the API rejects a schema with more than 16 union-typed
 * parameters ("exponential compilation cost"), and 26 nullable fields is 26
 * unions. Only original_principal keeps a null union, because no sentinel
 * number can mean "absent" without colliding with a real amount.
 * normalizeExtractedFiling collapses "" and [] back to null, so nothing
 * downstream sees the difference.
 */
function valueSchema(field: FilingField) {
  if (LIST_FIELDS.includes(field)) {
    return { type: 'array', items: { type: 'string' } };
  }
  if (NUMBER_FIELDS.includes(field)) {
    return { type: ['number', 'null'] };
  }
  return { type: 'string' };
}

/**
 * JSON Schema handed to output_config.format. Guarantees shape, not content.
 *
 * Values are flat and confidences live in one sibling object, rather than each
 * field being a {value, confidence} pair. The paired shape is the nicer model
 * but the API rejects it: 26 nested two-key objects compile to a grammar the
 * server refuses as "too large". Flat plus a parallel confidence object
 * compiles fine and carries the same information; the two are stitched back
 * into pairs by normalizeExtractedFiling.
 *
 * field_confidence lists every field as required, so the model cannot return a
 * value without also scoring it.
 */
export const FILING_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...FILING_FIELDS, 'field_confidence'],
  properties: {
    ...Object.fromEntries(FILING_FIELDS.map((field) => [field, valueSchema(field)])),
    field_confidence: {
      type: 'object',
      additionalProperties: false,
      required: [...FILING_FIELDS],
      properties: Object.fromEntries(FILING_FIELDS.map((field) => [field, { type: 'number' }])),
    },
  },
} as const;

/**
 * Static system prompt. Kept free of per-document content so it is identical on
 * every call.
 *
 * Note on caching: Haiku 4.5's minimum cacheable prefix is 4096 tokens and this
 * prompt is well under that, so a cache_control breakpoint here would silently
 * do nothing (no error, just cache_creation_input_tokens: 0). It is left off
 * deliberately rather than padded to reach the threshold.
 */
export const FILING_SYSTEM_PROMPT = [
  'You extract structured data from North Carolina foreclosure filings (Special',
  'Proceeding notices filed with the Clerk of Superior Court).',
  '',
  'The text comes from a PDF. Pages 1-2 are usually scans carrying an OCR text',
  'layer, so words there may run together ("NOTICEOFHEARINGON") and characters',
  'may be misread ("N.C.G.8." for "N.C.G.S.", "(11)" for "(ii)"). Read through',
  'those artifacts. Later pages are usually clean.',
  '',
  'RULES, in order of importance:',
  '',
  '1. Leave any field not stated in the document EMPTY: "" for text fields, []',
  '   for list fields, null for original_principal. Never infer, never guess,',
  '   never carry a value over from a similar filing. An empty field with',
  '   confidence 0 is a correct answer and is always better than a guess.',
  '2. Do not normalize, expand, or correct names. Return them as printed,',
  '   including suffixes like "LLC", "N.A.", or "P.A.".',
  '3. Currency is a number with no symbol, separators, or decimals-as-text:',
  '   "$412,500.00" becomes 412500.',
  '4. Dates are "YYYY-MM-DD". Times are "HH:MM" on a 24-hour clock in the local',
  '   court time zone, exactly as printed ("2:00PM" becomes "14:00"). If a date',
  '   is ambiguous or you are unsure of the year, leave it empty with confidence 0.',
  '5. Every paragraph-1 notice recites "default in the failure to make payments',
  '   of principal and interest". That is boilerplate present in essentially',
  '   every NC filing regardless of why the borrower actually defaulted. Do not',
  '   treat it as evidence of anything.',
  '',
  'FIELD NOTES:',
  '',
  '- record_owner_names: the people the property is titled to, as listed under',
  '  "RECORD OWNER(S)" or "Present Record Owners". One array entry per person.',
  '  Not the bank, trustee, attorney, or servicer.',
  '- substitute_trustee: the entity appointed to conduct the sale (e.g. "LLG',
  '  Trustee LLC"). Distinct from trustee_firm, the law firm employing them.',
  '- trustee_attorney / trustee_attorney_bar_no: the signing attorney and their',
  '  NC State Bar number.',
  '- trustee_firm / trustee_firm_address / trustee_firm_phone: the law firm',
  '  block, usually in the signature footer.',
  '- trustee_file_number: the firm\'s internal file or matter reference, if any.',
  '- holder_name / holder_address: the present holder of the debt, usually',
  '  stated as "the present Holder of the debt ... is: X. Its address is: Y".',
  '- original_beneficiary: the beneficiary named on the original Deed of Trust,',
  '  often "Mortgage Electronic Registration Systems, Inc. as nominee for X".',
  '  Frequently differs from the current holder. Return it as printed.',
  '- dot_date / dot_book / dot_page: the Deed of Trust date and its recording',
  '  book and page in the county registry.',
  '- original_principal: the original principal amount secured by the Deed of',
  '  Trust. Not the current payoff, total debt, or per-diem figure.',
  '- tax_parcel_id: the county tax parcel identifier, often labelled "Tax Parcel',
  '  ID" or "Parcel ID". Some firms omit it entirely; leave it empty then.',
  '- hearing_date / hearing_time: when the Clerk will hear the matter.',
  '- hearing_method: how it is conducted, e.g. "WebEx" or "in person".',
  '- sale_date / sale_time: the auction, only when the document actually sets',
  '  one. A Notice of Hearing does not schedule a sale; leave both empty.',
  '',
  'CONFIDENCE: 0.0 to 1.0 per field. Use 0 for any field you leave empty. Use a',
  'high score only',
  'when the value is stated plainly and you read it cleanly. Lower it when the',
  'text was garbled, when you had to choose between candidates, or when the',
  'label was missing and you inferred the field from position.',
].join('\n');
