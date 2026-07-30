import {
  extractionToRow,
  applyVerifiedFieldGuard,
  mergeConfidence,
  isFilingColumn,
  FILING_COLUMNS,
} from './foreclosure-filing-merge.util';
import { normalizeExtractedFiling } from './foreclosure-extract.service';
import { utcToCourtLocal } from './foreclosure-datetime.util';
import { FILING_FIELDS } from './foreclosure-filing.schema';

/** A model response shaped like the real one for 26SP002244-590. */
const spearsResponse = () => ({
  case_number: { value: '26SP002244-590', confidence: 0.99 },
  county: { value: 'Mecklenburg', confidence: 0.99 },
  filed_at: { value: '2026-07-27', confidence: 0.95 },
  submitted_at: { value: '2026-07-23', confidence: 0.9 },
  record_owner_names: { value: ['Belinda Spears'], confidence: 0.98 },
  substitute_trustee: { value: 'LLG Trustee LLC', confidence: 0.97 },
  trustee_attorney: { value: 'Ellen Wiggins', confidence: 0.96 },
  trustee_attorney_bar_no: { value: '55909', confidence: 0.95 },
  trustee_firm: { value: 'LOGS Legal Group LLP', confidence: 0.96 },
  trustee_firm_address: { value: '8520 Cliff Cameron Dr., Suite 330, Charlotte, NC 28269', confidence: 0.9 },
  trustee_firm_phone: { value: '(704) 333-8107', confidence: 0.93 },
  trustee_file_number: { value: null, confidence: 0 },
  holder_name: { value: 'Finance of America Reverse LLC', confidence: 0.98 },
  holder_address: { value: '3900 Capital City Blvd, Lansing, MI 48906', confidence: 0.94 },
  original_beneficiary: { value: 'American Advisors Group', confidence: 0.9 },
  dot_date: { value: '2022-10-22', confidence: 0.98 },
  dot_book: { value: '37739', confidence: 0.97 },
  dot_page: { value: '576', confidence: 0.97 },
  original_principal: { value: 412500, confidence: 0.99 },
  property_address: { value: '606 Hoskins Ridge Lane, Charlotte, NC 28216', confidence: 0.97 },
  tax_parcel_id: { value: '03904927', confidence: 0.96 },
  hearing_date: { value: '2026-09-08', confidence: 0.98 },
  hearing_time: { value: '14:00', confidence: 0.97 },
  hearing_method: { value: 'WebEx', confidence: 0.95 },
  sale_date: { value: null, confidence: 0 },
  sale_time: { value: null, confidence: 0 },
});

describe('normalizeExtractedFiling', () => {
  it('returns every declared field even when the model omits some', () => {
    const fields = normalizeExtractedFiling({ case_number: { value: '26SP002244-590', confidence: 1 } });
    for (const field of FILING_FIELDS) {
      expect(fields[field]).toBeDefined();
      expect(fields[field]).toHaveProperty('confidence');
    }
    expect(fields.holder_name.value).toBeNull();
  });

  it('clamps confidence into 0-1, since the schema cannot enforce a range', () => {
    const fields = normalizeExtractedFiling({
      case_number: { value: 'x', confidence: 7 },
      county: { value: 'y', confidence: -3 },
      holder_name: { value: 'z', confidence: 'high' },
    });
    expect(fields.case_number.confidence).toBe(1);
    expect(fields.county.confidence).toBe(0);
    // An unusable score means unscored, not certain.
    expect(fields.holder_name.confidence).toBe(0);
  });

  it('forces confidence to 0 on a null value rather than trusting the model', () => {
    const fields = normalizeExtractedFiling({ tax_parcel_id: { value: null, confidence: 0.9 } });
    expect(fields.tax_parcel_id.confidence).toBe(0);
  });

  it('collapses blanks and empty lists to null so absent has one meaning', () => {
    const fields = normalizeExtractedFiling({
      holder_name: { value: '   ', confidence: 0.8 },
      record_owner_names: { value: ['', '  '], confidence: 0.8 },
      original_principal: { value: Number.NaN, confidence: 0.8 },
    });
    expect(fields.holder_name.value).toBeNull();
    expect(fields.record_owner_names.value).toBeNull();
    expect(fields.original_principal.value).toBeNull();
  });

  it('trims whitespace off values without otherwise rewriting them', () => {
    const fields = normalizeExtractedFiling({
      holder_name: { value: '  Finance of America Reverse LLC  ', confidence: 0.9 },
    });
    expect(fields.holder_name.value).toBe('Finance of America Reverse LLC');
  });
});

describe('extractionToRow', () => {
  it('maps the Mecklenburg sample onto its columns', () => {
    const { values, confidence } = extractionToRow(normalizeExtractedFiling(spearsResponse()));
    expect(values.holderName).toBe('Finance of America Reverse LLC');
    expect(values.originalBeneficiary).toBe('American Advisors Group');
    expect(values.taxParcelId).toBe('03904927');
    expect(values.originalPrincipal).toBe(412500);
    expect(values.recordOwnerNames).toEqual(['Belinda Spears']);
    expect(confidence.holderName).toBeCloseTo(0.98);
  });

  it('folds the hearing date and time into one Eastern instant', () => {
    const { values } = extractionToRow(normalizeExtractedFiling(spearsResponse()));
    expect(utcToCourtLocal(values.hearingAt as Date)).toBe('2026-09-08T14:00');
  });

  it('scores a combined instant by its weaker half', () => {
    const raw = spearsResponse();
    raw.hearing_time = { value: '14:00', confidence: 0.4 };
    const { confidence } = extractionToRow(normalizeExtractedFiling(raw));
    expect(confidence.hearingAt).toBeCloseTo(0.4);
  });

  it('leaves sale null on a hearing notice, which schedules no sale', () => {
    const { values, confidence } = extractionToRow(normalizeExtractedFiling(spearsResponse()));
    expect(values.saleAt).toBeNull();
    expect(confidence.saleAt).toBe(0);
  });

  it('keeps a date whose time is missing, at court-local midnight', () => {
    const raw = spearsResponse();
    raw.hearing_time = { value: null, confidence: 0 };
    const { values, confidence } = extractionToRow(normalizeExtractedFiling(raw));
    expect(utcToCourtLocal(values.hearingAt as Date)).toBe('2026-09-08T00:00');
    // The date is still solid; a missing time must not drag its score to zero.
    expect(confidence.hearingAt).toBeCloseTo(0.98);
  });

  it('produces a confidence entry for every column', () => {
    const { confidence } = extractionToRow(normalizeExtractedFiling(spearsResponse()));
    for (const column of FILING_COLUMNS) {
      expect(confidence[column]).toBeDefined();
    }
  });
});

describe('applyVerifiedFieldGuard', () => {
  it('drops verified columns so a re-extraction cannot overwrite them', () => {
    const row = extractionToRow(normalizeExtractedFiling(spearsResponse()));
    const guarded = applyVerifiedFieldGuard(row, ['taxParcelId', 'holderName']);
    expect(guarded.values).not.toHaveProperty('taxParcelId');
    expect(guarded.values).not.toHaveProperty('holderName');
    expect(guarded.values.originalPrincipal).toBe(412500);
  });

  it('drops the stale confidence for a verified column too', () => {
    const row = extractionToRow(normalizeExtractedFiling(spearsResponse()));
    const guarded = applyVerifiedFieldGuard(row, ['taxParcelId']);
    expect(guarded.confidence).not.toHaveProperty('taxParcelId');
  });

  it('is a no-op when nothing has been verified', () => {
    const row = extractionToRow(normalizeExtractedFiling(spearsResponse()));
    expect(applyVerifiedFieldGuard(row, [])).toBe(row);
    expect(applyVerifiedFieldGuard(row, null)).toBe(row);
  });

  it('ignores a stale name instead of throwing', () => {
    const row = extractionToRow(normalizeExtractedFiling(spearsResponse()));
    const guarded = applyVerifiedFieldGuard(row, ['noSuchColumn']);
    expect(Object.keys(guarded.values).length).toBe(Object.keys(row.values).length);
  });

  it('guards a null-valued verified column, not just a populated one', () => {
    // The user cleared a wrongly-extracted parcel id; re-extraction must not
    // put it back.
    const row = extractionToRow(normalizeExtractedFiling(spearsResponse()));
    const guarded = applyVerifiedFieldGuard(row, ['saleAt']);
    expect(guarded.values).not.toHaveProperty('saleAt');
  });
});

describe('mergeConfidence', () => {
  it('overlays new scores while keeping ones the re-run did not touch', () => {
    const merged = mergeConfidence({ taxParcelId: 0.5, holderName: 0.5 }, { holderName: 0.9 });
    expect(merged).toEqual({ taxParcelId: 0.5, holderName: 0.9 });
  });

  it('handles a first run with no stored map', () => {
    expect(mergeConfidence(null, { holderName: 0.9 })).toEqual({ holderName: 0.9 });
  });
});

describe('isFilingColumn', () => {
  it('accepts real columns and rejects anything else', () => {
    expect(isFilingColumn('holderName')).toBe(true);
    expect(isFilingColumn('hearingAt')).toBe(true);
    // Guards the PATCH endpoint against writing arbitrary keys.
    expect(isFilingColumn('verifiedFields')).toBe(false);
    expect(isFilingColumn('organizationId')).toBe(false);
    expect(isFilingColumn('id')).toBe(false);
    expect(isFilingColumn('')).toBe(false);
  });
});
