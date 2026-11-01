import { SurplusCallOutcome, SurplusClaimStatus, SurplusDeadReason, SurplusStage } from '@fast-homes/shared';
import { countyRetirement, isSignedStage, outcomeDeadReason } from './surplus-progress.util';

describe('what the pull may do to a stage', () => {
  it('does nothing while the docket is still workable', () => {
    expect(countyRetirement(SurplusStage.NEW, SurplusClaimStatus.OPEN, true)).toEqual({ action: 'none' });
  });

  it('retires an unsigned case the county paid out, with the reason and the date', () => {
    const now = new Date('2026-11-02T09:30:00Z');
    const v = countyRetirement(SurplusStage.CONTACTED, SurplusClaimStatus.DISTRIBUTED, false, now);
    expect(v.action).toBe('retire');
    if (v.action !== 'retire') return;
    expect(v.data.stage).toBe(SurplusStage.DEAD);
    expect(v.data.deadReason).toBe(SurplusDeadReason.PAID_OUT);
    expect(v.data.deadAt).toBe(now);
    expect(v.data.deadNote).toContain('distributed');
  });

  it('calls a docket assigned to somebody else "already assigned"', () => {
    const v = countyRetirement(SurplusStage.NEW, SurplusClaimStatus.ASSIGNED, false);
    expect(v.action === 'retire' && v.data.deadReason).toBe(SurplusDeadReason.ALREADY_ASSIGNED);
  });

  it('never retires a case a client has signed: our own filing reads as assigned', () => {
    for (const stage of [
      SurplusStage.AGREEMENT_SIGNED,
      SurplusStage.PACKAGE_NOTARIZED,
      SurplusStage.CLAIM_FILED,
      SurplusStage.AWAITING_DISBURSEMENT,
      SurplusStage.CHECK_RECEIVED,
      SurplusStage.PAID,
    ]) {
      const v = countyRetirement(stage, SurplusClaimStatus.ASSIGNED, false);
      expect(v.action).toBe('keep');
      expect(v.action === 'keep' && v.why).toContain(stage);
    }
  });

  it('leaves a Dead case alone, whatever the docket says now', () => {
    expect(countyRetirement(SurplusStage.DEAD, SurplusClaimStatus.OPEN, false)).toEqual({ action: 'none' });
  });

  it('knows which stages are signed', () => {
    expect(isSignedStage(SurplusStage.AGREEMENT_SIGNED)).toBe(true);
    expect(isSignedStage(SurplusStage.CONTACTED)).toBe(false);
    expect(isSignedStage(null)).toBe(false);
  });
});

describe('which call outcomes close a case', () => {
  it('not interested and already signed elsewhere do, with their reasons', () => {
    expect(outcomeDeadReason(SurplusCallOutcome.NOT_INTERESTED)).toBe(SurplusDeadReason.NOT_INTERESTED);
    expect(outcomeDeadReason(SurplusCallOutcome.ALREADY_SIGNED)).toBe(SurplusDeadReason.ALREADY_ASSIGNED);
  });

  it('nothing else does', () => {
    for (const o of [
      SurplusCallOutcome.NO_ANSWER,
      SurplusCallOutcome.SPOKE_CLAIMANT,
      SurplusCallOutcome.SPOKE_RELATIVE,
      SurplusCallOutcome.WRONG_NUMBER,
      SurplusCallOutcome.DO_NOT_CALL,
      null,
      undefined,
    ]) {
      expect(outcomeDeadReason(o)).toBeNull();
    }
  });
});
