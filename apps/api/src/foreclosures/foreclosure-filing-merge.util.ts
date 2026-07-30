import { courtLocalToUtc } from './foreclosure-datetime.util';
import { FILING_FIELDS, FilingField } from './foreclosure-filing.schema';
import type { ExtractedFiling } from './foreclosure-extract.service';

/**
 * Turning an extraction into a database row, and re-running one without
 * destroying the user's corrections.
 *
 * Pure and Prisma-free: the rule that a verified field is never overwritten is
 * the whole point of the table, so it is testable without a database.
 */

/** Column names on ForeclosureFiling that a user can verify by editing. */
export type FilingColumn =
  | 'caseNumber' | 'county' | 'filedAt' | 'submittedAt'
  | 'recordOwnerNames' | 'substituteTrustee' | 'trusteeAttorney'
  | 'trusteeAttorneyBarNo' | 'trusteeFirm' | 'trusteeFirmAddress'
  | 'trusteeFirmPhone' | 'trusteeFileNumber' | 'holderName' | 'holderAddress'
  | 'originalBeneficiary' | 'dotDate' | 'dotBook' | 'dotPage'
  | 'originalPrincipal' | 'propertyAddress' | 'taxParcelId'
  | 'hearingAt' | 'hearingMethod' | 'saleAt';

/**
 * Which model field maps to which column. Date and time fields collapse in
 * pairs (hearing_date + hearing_time -> hearingAt), which is why this is a map
 * and not a case conversion.
 */
const FIELD_TO_COLUMN: Partial<Record<FilingField, FilingColumn>> = {
  case_number: 'caseNumber',
  county: 'county',
  filed_at: 'filedAt',
  submitted_at: 'submittedAt',
  record_owner_names: 'recordOwnerNames',
  substitute_trustee: 'substituteTrustee',
  trustee_attorney: 'trusteeAttorney',
  trustee_attorney_bar_no: 'trusteeAttorneyBarNo',
  trustee_firm: 'trusteeFirm',
  trustee_firm_address: 'trusteeFirmAddress',
  trustee_firm_phone: 'trusteeFirmPhone',
  trustee_file_number: 'trusteeFileNumber',
  holder_name: 'holderName',
  holder_address: 'holderAddress',
  original_beneficiary: 'originalBeneficiary',
  dot_date: 'dotDate',
  dot_book: 'dotBook',
  dot_page: 'dotPage',
  original_principal: 'originalPrincipal',
  property_address: 'propertyAddress',
  tax_parcel_id: 'taxParcelId',
  hearing_date: 'hearingAt',
  hearing_method: 'hearingMethod',
  sale_date: 'saleAt',
};

/** Columns holding an instant assembled from a separate date and time field. */
const DATE_TIME_PAIRS: { column: FilingColumn; date: FilingField; time: FilingField }[] = [
  { column: 'hearingAt', date: 'hearing_date', time: 'hearing_time' },
  { column: 'saleAt', date: 'sale_date', time: 'sale_time' },
];

/** Plain date columns with no time component in the source document. */
const DATE_ONLY_COLUMNS: Partial<Record<FilingColumn, FilingField>> = {
  filedAt: 'filed_at',
  submittedAt: 'submitted_at',
  dotDate: 'dot_date',
};

export interface FilingRowValues {
  values: Partial<Record<FilingColumn, unknown>>;
  /** Per-column 0-1 score, stored as the fieldConfidence jsonb. */
  confidence: Record<string, number>;
}

/**
 * Flatten an extraction into column values plus a per-column confidence map.
 *
 * Date/time pairs collapse into one instant via courtLocalToUtc, which resolves
 * the Eastern offset from the date. The pair's confidence is the lower of the
 * two parts, since an instant is only as trustworthy as its weaker half.
 */
export function extractionToRow(fields: ExtractedFiling): FilingRowValues {
  const values: Partial<Record<FilingColumn, unknown>> = {};
  const confidence: Record<string, number> = {};

  for (const field of FILING_FIELDS) {
    const column = FIELD_TO_COLUMN[field];
    if (!column) continue; // hearing_time / sale_time are folded in below
    if (DATE_TIME_PAIRS.some((p) => p.column === column)) continue;

    const entry = fields[field];
    if (DATE_ONLY_COLUMNS[column]) {
      values[column] = courtLocalToUtc(entry.value as string, null);
    } else if (column === 'recordOwnerNames') {
      values[column] = (entry.value as string[]) ?? [];
    } else {
      values[column] = entry.value;
    }
    confidence[column] = entry.confidence;
  }

  for (const pair of DATE_TIME_PAIRS) {
    const date = fields[pair.date];
    const time = fields[pair.time];
    values[pair.column] = courtLocalToUtc(date.value as string, time.value as string);
    // No date means no instant, so the score is the date's alone.
    confidence[pair.column] =
      values[pair.column] === null
        ? date.confidence
        : Math.min(date.confidence, time.value === null ? date.confidence : time.confidence);
  }

  return { values, confidence };
}

/**
 * Drop every column the user has verified, so a re-extraction cannot overwrite
 * a hand-corrected value. Confidence for a verified column is dropped too: the
 * model's score no longer describes what is stored there.
 *
 * Unknown names in verifiedFields are ignored rather than throwing - the list
 * is user-supplied and a stale entry should not block an extraction.
 */
export function applyVerifiedFieldGuard(
  row: FilingRowValues,
  verifiedFields: string[] | null | undefined,
): FilingRowValues {
  const verified = new Set(verifiedFields || []);
  if (!verified.size) return row;

  const values: Partial<Record<FilingColumn, unknown>> = {};
  const confidence: Record<string, number> = {};

  for (const [column, value] of Object.entries(row.values)) {
    if (verified.has(column)) continue;
    values[column as FilingColumn] = value;
  }
  for (const [column, score] of Object.entries(row.confidence)) {
    if (verified.has(column)) continue;
    confidence[column] = score;
  }

  return { values, confidence };
}

/**
 * Merge a re-extraction's confidence map over the stored one. Scores for
 * verified columns are preserved from the stored map so the review panel keeps
 * showing something for them rather than a gap.
 */
export function mergeConfidence(
  stored: Record<string, number> | null | undefined,
  incoming: Record<string, number>,
): Record<string, number> {
  return { ...(stored || {}), ...incoming };
}

/** Every column name, for validating a user's verifiedFields payload. */
export const FILING_COLUMNS: FilingColumn[] = Array.from(
  new Set([
    ...Object.values(FIELD_TO_COLUMN),
    ...DATE_TIME_PAIRS.map((p) => p.column),
  ]),
) as FilingColumn[];

/** Whether a name is a real, user-editable filing column. */
export function isFilingColumn(name: string): name is FilingColumn {
  return FILING_COLUMNS.includes(name as FilingColumn);
}
