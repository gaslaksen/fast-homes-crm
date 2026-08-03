import {
  signalPreconditions, reconcileSignals, buildSignalsInput, truncateHeadline,
  countWeakCoreFields,
} from './foreclosure-signals.util';
import { MAX_HEADLINE_CHARS, MAX_SIGNALS, SIGNAL_CODES } from './foreclosure-signals.schema';
import { ForeclosureLoanType, ForeclosureUrgency, RulesResult } from './foreclosure-rules.util';

const reverseRules = (over: Partial<RulesResult> = {}): RulesResult => ({
  loanType: ForeclosureLoanType.REVERSE_HECM,
  lenderName: 'Finance of America Reverse LLC',
  servicerType: 'REVERSE_SERVICER',
  matchedField: 'holderName',
  loanTypeSource: 'profile',
  daysToHearing: 42,
  urgency: ForeclosureUrgency.MEDIUM,
  upsetBidDeadline: null,
  upsetBidOpen: false,
  borrowerAgeFloorAtOrigination: 62,
  borrowerAgeFloorToday: 65,
  principalFigureReliable: false,
  equitySpread: null,
  equityPct: null,
  ...over,
});

const conventionalRules = (over: Partial<RulesResult> = {}): RulesResult => ({
  loanType: ForeclosureLoanType.CONVENTIONAL,
  lenderName: 'Bank of America, N.A.',
  servicerType: 'BANK',
  matchedField: 'holderName',
  loanTypeSource: 'profile',
  daysToHearing: 42,
  urgency: ForeclosureUrgency.MEDIUM,
  upsetBidDeadline: null,
  upsetBidOpen: false,
  borrowerAgeFloorAtOrigination: null,
  borrowerAgeFloorToday: null,
  principalFigureReliable: true,
  equitySpread: 188840,
  equityPct: 49,
  ...over,
});

const completeFiling = {
  caseNumber: '26SP002244-590', county: 'Mecklenburg',
  recordOwnerNames: ['Belinda Spears'], propertyAddress: '606 Hoskins Ridge Lane, Charlotte, NC 28216',
  holderName: 'Finance of America Reverse LLC', hearingAt: new Date('2026-09-08T18:00:00Z'),
};
const fullConfidence = {
  caseNumber: 0.99, county: 0.99, recordOwnerNames: 0.98, propertyAddress: 0.97, holderName: 0.98, hearingAt: 0.98,
};

describe('signalPreconditions', () => {
  it('requires the reverse, debt-figure, and estate signals on a HECM', () => {
    const p = signalPreconditions(reverseRules(), completeFiling, fullConfidence);
    expect(p.LOAN_TYPE_REVERSE!.required).toBe(true);
    expect(p.DEBT_FIGURE_UNRELIABLE!.required).toBe(true);
    expect(p.HEIR_ESTATE_PATH!.required).toBe(true);
  });

  it('forbids the reverse and debt-figure signals on a conventional loan', () => {
    // The over-flagging guard: the model cannot label an ordinary default a
    // reverse mortgage, however confident it sounds.
    const p = signalPreconditions(conventionalRules(), completeFiling, fullConfidence);
    expect(p.LOAN_TYPE_REVERSE!.forbidden).toBe(true);
    expect(p.DEBT_FIGURE_UNRELIABLE!.forbidden).toBe(true);
  });

  it('keeps the loan-type signals mutually exclusive', () => {
    const p = signalPreconditions(
      reverseRules({ loanType: ForeclosureLoanType.HOA_ASSESSMENT, principalFigureReliable: true }),
      completeFiling, fullConfidence,
    );
    expect(p.LOAN_TYPE_HOA!.required).toBe(true);
    expect(p.LOAN_TYPE_REVERSE!.forbidden).toBe(true);
    expect(p.LOAN_TYPE_TAX!.forbidden).toBe(true);
    expect(p.LOAN_TYPE_PRIVATE!.forbidden).toBe(true);
  });

  it('does not forbid an estate path on a conventional loan', () => {
    // A trust or estate can appear on any loan type - only the HECM case is
    // guaranteed, the rest is the model's judgment.
    const p = signalPreconditions(conventionalRules(), completeFiling, fullConfidence);
    expect(p.HEIR_ESTATE_PATH!.required).toBe(false);
    expect(p.HEIR_ESTATE_PATH!.forbidden).toBe(false);
  });

  it('forbids urgency on a distant hearing and requires it on a close one', () => {
    expect(signalPreconditions(conventionalRules({ urgency: ForeclosureUrgency.LOW }), completeFiling)
      .TIMELINE_URGENT!.forbidden).toBe(true);
    expect(signalPreconditions(conventionalRules({ urgency: ForeclosureUrgency.CRITICAL, daysToHearing: 5 }), completeFiling)
      .TIMELINE_URGENT!.required).toBe(true);
    // HIGH is allowed but not forced - genuine judgment territory.
    const high = signalPreconditions(conventionalRules({ urgency: ForeclosureUrgency.HIGH, daysToHearing: 20 }), completeFiling);
    expect(high.TIMELINE_URGENT!.required).toBe(false);
    expect(high.TIMELINE_URGENT!.forbidden).toBe(false);
  });

  it('ties the upset-bid signal to the computed window', () => {
    expect(signalPreconditions(conventionalRules({ upsetBidOpen: true }), completeFiling)
      .TIMELINE_UPSET_BID_OPEN!.required).toBe(true);
    expect(signalPreconditions(conventionalRules({ upsetBidOpen: false }), completeFiling)
      .TIMELINE_UPSET_BID_OPEN!.forbidden).toBe(true);
  });

  it('forbids a data-quality flag on a clean extraction', () => {
    expect(signalPreconditions(conventionalRules(), completeFiling, fullConfidence)
      .DATA_QUALITY_DEGRADED!.forbidden).toBe(true);
  });

  it('requires a data-quality flag once three core fields are weak', () => {
    const thin = { ...completeFiling, recordOwnerNames: [], propertyAddress: null, holderName: null };
    expect(signalPreconditions(conventionalRules(), thin, fullConfidence)
      .DATA_QUALITY_DEGRADED!.required).toBe(true);
  });
});

describe('countWeakCoreFields', () => {
  it('counts nulls, blanks, empty arrays, and low confidence alike', () => {
    expect(countWeakCoreFields(completeFiling, fullConfidence)).toBe(0);
    expect(countWeakCoreFields({ ...completeFiling, holderName: '   ' }, fullConfidence)).toBe(1);
    expect(countWeakCoreFields({ ...completeFiling, recordOwnerNames: [] }, fullConfidence)).toBe(1);
    // Present but the model was unsure.
    expect(countWeakCoreFields(completeFiling, { ...fullConfidence, caseNumber: 0.2 })).toBe(1);
  });
});

describe('reconcileSignals: refusing what the facts forbid', () => {
  const conventional = () => signalPreconditions(conventionalRules(), completeFiling, fullConfidence);

  it('drops a reverse-mortgage claim on a conventional filing', () => {
    const { signals, dropped } = reconcileSignals(
      { signals: [{ signal_code: 'LOAN_TYPE_REVERSE', severity: 'critical',
        headline: 'Reverse mortgage', evidence: ['holderName'], recommended_actions: [] }] },
      conventional(),
    );
    expect(signals.find((s) => s.signalCode === 'LOAN_TYPE_REVERSE')).toBeUndefined();
    expect(dropped[0].reason).toBe('contradicts the deterministic facts');
  });

  it('drops an ungrounded signal', () => {
    const { signals, dropped } = reconcileSignals(
      { signals: [{ signal_code: 'OCCUPANCY_RISK', severity: 'notable',
        headline: 'Might be vacant', evidence: [], recommended_actions: ['VERIFY_OCCUPANCY'] }] },
      conventional(),
    );
    expect(signals).toHaveLength(0);
    expect(dropped[0].reason).toBe('no evidence in the allowed vocabulary');
  });

  it('drops evidence that names a field outside the vocabulary, and the signal with it', () => {
    const { signals } = reconcileSignals(
      { signals: [{ signal_code: 'OCCUPANCY_RISK', severity: 'notable', headline: 'Vacant',
        evidence: ['vibes', 'myHunch'], recommended_actions: [] }] },
      conventional(),
    );
    expect(signals).toHaveLength(0);
  });

  it('keeps a signal whose evidence is partly valid, minus the invalid names', () => {
    const { signals } = reconcileSignals(
      { signals: [{ signal_code: 'OCCUPANCY_RISK', severity: 'info', headline: 'Trust-owned',
        evidence: ['recordOwnerNames', 'madeUpField'], recommended_actions: ['VERIFY_OCCUPANCY'] }] },
      conventional(),
    );
    expect(signals[0].evidence).toEqual(['recordOwnerNames']);
  });

  it('drops unknown codes and unknown actions', () => {
    const { signals, dropped } = reconcileSignals(
      { signals: [
        { signal_code: 'SELLER_SEEMS_SAD', severity: 'critical', headline: 'x', evidence: ['holderName'], recommended_actions: [] },
        { signal_code: 'OCCUPANCY_RISK', severity: 'info', headline: 'Possibly vacant',
          evidence: ['propertyAddress'], recommended_actions: ['VERIFY_OCCUPANCY', 'SEND_A_LETTER_NOW'] },
      ] },
      conventional(),
    );
    expect(dropped.some((d) => d.signalCode === 'SELLER_SEEMS_SAD')).toBe(true);
    expect(signals[0].recommendedActions).toEqual(['VERIFY_OCCUPANCY']);
  });

  it('produces no critical signals for an ordinary conventional default', () => {
    // The headline requirement of the whole phase: over-flagging is the main
    // failure mode, so an unremarkable filing must stay unremarkable.
    const { signals } = reconcileSignals(
      { signals: [
        { signal_code: 'TITLE_COMPLEXITY', severity: 'info', headline: 'Two owners on title',
          evidence: ['recordOwnerNames'], recommended_actions: ['STANDARD_OUTREACH'] },
      ] },
      conventional(),
    );
    expect(signals.filter((s) => s.severity === 'critical')).toHaveLength(0);
  });

  it('produces nothing at all when the model returns nothing and no fact forces a signal', () => {
    const { signals } = reconcileSignals({ signals: [] }, conventional());
    expect(signals).toHaveLength(0);
  });

  it('tolerates malformed model output', () => {
    for (const junk of [null, {}, { signals: null }, { signals: 'nope' }]) {
      expect(() => reconcileSignals(junk, conventional())).not.toThrow();
    }
  });
});

describe('reconcileSignals: guaranteeing what the facts require', () => {
  const reverse = () => signalPreconditions(reverseRules(), completeFiling, fullConfidence);

  it('adds the three ship-gate signals even when the model returns none', () => {
    const { signals } = reconcileSignals({ signals: [] }, reverse());
    const codes = signals.map((s) => s.signalCode);
    expect(codes).toContain('LOAN_TYPE_REVERSE');
    expect(codes).toContain('HEIR_ESTATE_PATH');
    expect(codes).toContain('DEBT_FIGURE_UNRELIABLE');
  });

  it('never phrases the fallback estate headline as a death', () => {
    const { signals } = reconcileSignals({ signals: [] }, reverse());
    const estate = signals.find((s) => s.signalCode === 'HEIR_ESTATE_PATH')!;
    expect(estate.headline).toMatch(/check/i);
    expect(estate.headline).not.toMatch(/deceased|died|death|passed away/i);
    expect(estate.recommendedActions).toContain('CHECK_ESTATE_FILE');
  });

  it('raises a required signal the model under-rated to its severity floor', () => {
    const { signals } = reconcileSignals(
      { signals: [{ signal_code: 'LOAN_TYPE_REVERSE', severity: 'info', headline: 'Reverse mortgage',
        evidence: ['loanType'], recommended_actions: [] }] },
      reverse(),
    );
    expect(signals.find((s) => s.signalCode === 'LOAN_TYPE_REVERSE')!.severity).toBe('notable');
  });

  it('keeps the model wording when it does emit a required signal', () => {
    const { signals } = reconcileSignals(
      { signals: [{ signal_code: 'LOAN_TYPE_REVERSE', severity: 'notable',
        headline: 'HECM - borrower was 62+ when the loan was written',
        evidence: ['loanType', 'holderName'], recommended_actions: ['CHECK_ESTATE_FILE'] }] },
      reverse(),
    );
    expect(signals.find((s) => s.signalCode === 'LOAN_TYPE_REVERSE')!.headline)
      .toBe('HECM - borrower was 62+ when the loan was written');
  });

  it('cites the beneficiary when that is where the lender matched', () => {
    const { signals } = reconcileSignals(
      { signals: [] },
      signalPreconditions(reverseRules({ matchedField: 'originalBeneficiary' }), completeFiling, fullConfidence),
    );
    expect(signals.find((s) => s.signalCode === 'LOAN_TYPE_REVERSE')!.evidence)
      .toContain('originalBeneficiary');
  });
});

describe('reconcileSignals: ordering, dedupe, and the cap', () => {
  const conventional = () => signalPreconditions(conventionalRules(), completeFiling, fullConfidence);

  it('sorts most severe first', () => {
    const { signals } = reconcileSignals(
      { signals: [
        { signal_code: 'OCCUPANCY_RISK', severity: 'info', headline: 'a', evidence: ['propertyAddress'], recommended_actions: [] },
        { signal_code: 'TITLE_COMPLEXITY', severity: 'notable', headline: 'b', evidence: ['recordOwnerNames'], recommended_actions: [] },
      ] },
      conventional(),
    );
    expect(signals.map((s) => s.severity)).toEqual(['notable', 'info']);
  });

  it('collapses a duplicate code, keeping the more severe', () => {
    const { signals } = reconcileSignals(
      { signals: [
        { signal_code: 'TITLE_COMPLEXITY', severity: 'notable', headline: 'first', evidence: ['recordOwnerNames'], recommended_actions: [] },
        { signal_code: 'TITLE_COMPLEXITY', severity: 'info', headline: 'second', evidence: ['recordOwnerNames'], recommended_actions: [] },
      ] },
      conventional(),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].headline).toBe('first');
  });

  it('caps at six', () => {
    const many = SIGNAL_CODES.filter((c) => !c.startsWith('LOAN_TYPE') && c !== 'DEBT_FIGURE_UNRELIABLE'
      && c !== 'TIMELINE_UPSET_BID_OPEN' && c !== 'TIMELINE_URGENT' && c !== 'DATA_QUALITY_DEGRADED')
      .map((code) => ({ signal_code: code, severity: 'info', headline: `h ${code}`,
        evidence: ['holderName'], recommended_actions: [] }));
    const { signals } = reconcileSignals({ signals: many }, conventional());
    expect(signals.length).toBeLessThanOrEqual(MAX_SIGNALS);
  });

  it('never drops a required signal to satisfy the cap', () => {
    const optional = ['OCCUPANCY_RISK', 'TITLE_COMPLEXITY', 'CONTACT_TARGET_NOT_OWNER',
      'SKIP_TRACE_LOW_YIELD_EXPECTED', 'HEIR_ESTATE_PATH']
      .map((code) => ({ signal_code: code, severity: 'critical', headline: `h ${code}`,
        evidence: ['holderName'], recommended_actions: [] }));
    const { signals } = reconcileSignals(
      { signals: [...optional, { signal_code: 'OCCUPANCY_RISK', severity: 'info', headline: 'x',
        evidence: ['propertyAddress'], recommended_actions: [] }] },
      signalPreconditions(reverseRules(), completeFiling, fullConfidence),
    );
    expect(signals.length).toBeLessThanOrEqual(MAX_SIGNALS);
    const codes = signals.map((s) => s.signalCode);
    expect(codes).toContain('LOAN_TYPE_REVERSE');
    expect(codes).toContain('DEBT_FIGURE_UNRELIABLE');
  });
});

describe('truncateHeadline', () => {
  it('leaves a short headline alone but strips a trailing period', () => {
    expect(truncateHeadline('Reverse mortgage on this file.')).toBe('Reverse mortgage on this file');
  });

  it('caps at the limit, preferring a word boundary', () => {
    const long = 'This headline is deliberately far too long to fit inside the eighty character cap set by the plan';
    const out = truncateHeadline(long);
    expect(out.length).toBeLessThanOrEqual(MAX_HEADLINE_CHARS);
    expect(out).not.toMatch(/\s$/);
  });

  it('collapses whitespace and handles empty input', () => {
    expect(truncateHeadline('  two   spaces  ')).toBe('two spaces');
    expect(truncateHeadline('')).toBe('');
    expect(truncateHeadline(undefined as any)).toBe('');
  });
});

describe('buildSignalsInput', () => {
  it('stays compact and carries no filing text', () => {
    const input = buildSignalsInput(completeFiling, reverseRules(), fullConfidence);
    const json = JSON.stringify(input);
    // Roughly 600-900 tokens per the plan; bytes are a decent proxy.
    expect(json.length).toBeLessThan(2500);
    expect(json).not.toContain('NOTICE OF HEARING');
    expect(json).not.toContain('rawText');
  });

  it('passes the rules verdict through for the model to synthesize from', () => {
    const input = buildSignalsInput(completeFiling, reverseRules(), fullConfidence) as any;
    expect(input.rules.loanType).toBe('REVERSE_HECM');
    expect(input.rules.principalFigureReliable).toBe(false);
    expect(input.rules.borrowerAgeFloorAtOrigination).toBe(62);
    expect(input.dataQuality.weakCoreFieldCount).toBe(0);
  });

  it('serializes dates as ISO strings, not Date objects', () => {
    const input = buildSignalsInput(completeFiling, reverseRules(), fullConfidence) as any;
    expect(input.filing.hearingAt).toBe('2026-09-08T18:00:00.000Z');
  });
});

describe('loan-type preconditions when the rules could not classify', () => {
  const unknownRules = (): RulesResult => ({
    loanType: ForeclosureLoanType.UNKNOWN,
    lenderName: null,
    servicerType: null,
    matchedField: null,
    loanTypeSource: null,
    daysToHearing: 30,
    urgency: ForeclosureUrgency.HIGH,
    upsetBidDeadline: null,
    upsetBidOpen: false,
    borrowerAgeFloorAtOrigination: null,
    borrowerAgeFloorToday: null,
    principalFigureReliable: true,
    equitySpread: null,
    equityPct: null,
  });

  it('forbids no loan type at all, so the model is not overruled by a blank', () => {
    const pre = signalPreconditions(unknownRules(), {});
    for (const code of ['LOAN_TYPE_REVERSE', 'LOAN_TYPE_HOA', 'LOAN_TYPE_TAX', 'LOAN_TYPE_PRIVATE'] as const) {
      expect(pre[code]!.forbidden).toBe(false);
      expect(pre[code]!.required).toBe(false);
    }
  });

  it('keeps an HOA signal the model raised on an unclassified filing', () => {
    // The regression: this exact signal was dropped as "contradicts the
    // deterministic facts" when there were no deterministic facts.
    const { signals, dropped } = reconcileSignals(
      {
        signals: [{
          signal_code: 'LOAN_TYPE_HOA',
          severity: 'notable',
          headline: 'HOA assessment lien, not a mortgage foreclosure',
          evidence: ['holderName'],
          recommended_actions: [],
        }],
      },
      signalPreconditions(unknownRules(), {}),
    );
    expect(signals.map((s) => s.signalCode)).toContain('LOAN_TYPE_HOA');
    expect(dropped).toHaveLength(0);
  });

  it('still overrules the model when the rules DID classify differently', () => {
    const { signals, dropped } = reconcileSignals(
      {
        signals: [{
          signal_code: 'LOAN_TYPE_HOA',
          severity: 'notable',
          headline: 'HOA assessment lien',
          evidence: ['holderName'],
          recommended_actions: [],
        }],
      },
      signalPreconditions(reverseRules(), {}),
    );
    expect(signals.map((s) => s.signalCode)).not.toContain('LOAN_TYPE_HOA');
    expect(dropped.some((d) => d.reason === 'contradicts the deterministic facts')).toBe(true);
  });

  it('cites loanType alone when the classification came from the caption', () => {
    const rules = { ...unknownRules(), loanType: ForeclosureLoanType.HOA_ASSESSMENT, loanTypeSource: 'filingText' as const };
    expect(signalPreconditions(rules, {}).LOAN_TYPE_HOA!.fallback!.evidence).toEqual(['loanType']);
  });
});
