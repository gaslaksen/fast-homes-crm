import { mergeFilingFields, CaseFacts } from './foreclosure-case-merge.util';

/** A lead created from the Notice of Hearing for 26SP002244-590. */
const afterHearingNotice = (): CaseFacts => ({
  caseNumber: '26SP002244-590',
  noticeType: 'pre_foreclosure_hearing',
  noticeUrl: null,
  trustee: 'LLG Trustee LLC',
  county: 'Mecklenburg',
  // saleDate is the hearing date mirrored forward, which is what the ingest
  // path does for a hearing notice so it sorts alongside true sale dates.
  saleDate: new Date('2026-09-08'),
  hearingDate: new Date('2026-09-08'),
  loanDate: new Date('2022-10-22'),
  loanAmount: 412500,
  assessedValue: null,
});

describe('mergeFilingFields', () => {
  it('lands the auction date when the Notice of Sale arrives', () => {
    const patch = mergeFilingFields(afterHearingNotice(), {
      noticeType: 'mortgage_foreclosure',
      saleDate: new Date('2026-11-03'),
    });
    // The whole point of the merge: without it the auction date is dropped.
    expect(patch.saleDate).toEqual(new Date('2026-11-03'));
  });

  it('writes nothing when the same filing is ingested again', () => {
    expect(mergeFilingFields(afterHearingNotice(), afterHearingNotice())).toEqual({});
  });

  it('fills a fact the first filing did not carry', () => {
    const patch = mergeFilingFields(afterHearingNotice(), { assessedValue: 389000 });
    expect(patch).toEqual({ assessedValue: 389000 });
  });

  it('never overwrites a fact already on the case', () => {
    const patch = mergeFilingFields(afterHearingNotice(), {
      trustee: 'Some Other Trustee LLC',
      loanAmount: 999999,
      caseNumber: '26SP009999-590',
      county: 'Wake',
    });
    expect(patch).toEqual({});
  });

  it('does not walk the timeline backwards when an older filing arrives late', () => {
    const withSale = { ...afterHearingNotice(), saleDate: new Date('2026-11-03') };
    const patch = mergeFilingFields(withSale, { saleDate: new Date('2026-09-08') });
    expect(patch.saleDate).toBeUndefined();
  });

  it('advances a hearing continued to a later date', () => {
    const patch = mergeFilingFields(afterHearingNotice(), {
      hearingDate: new Date('2026-10-06'),
    });
    expect(patch.hearingDate).toEqual(new Date('2026-10-06'));
  });

  it('treats an equal date as no change', () => {
    const patch = mergeFilingFields(afterHearingNotice(), {
      saleDate: new Date('2026-09-08'),
    });
    expect(patch).toEqual({});
  });

  it('sets a date the case did not have at all', () => {
    const noDates = { ...afterHearingNotice(), saleDate: null, hearingDate: null };
    const patch = mergeFilingFields(noDates, { saleDate: new Date('2026-11-03') });
    expect(patch.saleDate).toEqual(new Date('2026-11-03'));
  });

  it('ignores nulls, undefined, and blank strings on the incoming filing', () => {
    const patch = mergeFilingFields(
      { ...afterHearingNotice(), trustee: null, county: null, assessedValue: null },
      { trustee: '   ', county: null, assessedValue: undefined, saleDate: null },
    );
    expect(patch).toEqual({});
  });

  it('ignores an unparseable date rather than writing it', () => {
    const patch = mergeFilingFields(afterHearingNotice(), {
      saleDate: new Date('not a date'),
    });
    expect(patch).toEqual({});
  });

  it('carries no workflow, contact, or skip-trace keys', () => {
    const patch = mergeFilingFields(afterHearingNotice(), {
      saleDate: new Date('2026-11-03'),
      assessedValue: 389000,
    });
    // A court filing must never touch what the user or skip trace owns.
    for (const owned of ['workStatus', 'doNotCall', 'callNotes', 'touchDays', 'phone1', 'priority']) {
      expect(patch).not.toHaveProperty(owned);
    }
  });
});
