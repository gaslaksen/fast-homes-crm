import { surplusDisbursement } from '@fast-homes/shared';

/**
 * The disbursement arithmetic is what the claimant signs, so it is pinned:
 * the fee is a percent of the check, expenses come out of the company's
 * share unless the agreement passes them to the claimant, and passing them
 * counts toward the Florida cap alongside the fee.
 */
describe('surplusDisbursement', () => {
  it('splits the check at the fee percent with the company bearing expenses', () => {
    const r = surplusDisbursement({
      checkAmount: 27929.98,
      feePercent: 12,
      expensesTotal: 410,
      expensesFromClaimantShare: false,
      capPct: 12,
    });
    expect(r.fee).toBeCloseTo(3351.6, 2);
    expect(r.claimantShare).toBeCloseTo(24578.38, 2);
    expect(r.companyShare).toBeCloseTo(3351.6, 2);
    expect(r.companyNet).toBeCloseTo(2941.6, 2);
    expect(r.considerationPct).toBe(12);
    expect(r.overCap).toBe(false);
  });

  it('counts expenses passed to the claimant as consideration, which can breach the cap', () => {
    const r = surplusDisbursement({
      checkAmount: 20000,
      feePercent: 12,
      expensesTotal: 500,
      expensesFromClaimantShare: true,
      capPct: 12,
    });
    expect(r.claimantShare).toBeCloseTo(17100, 2);
    expect(r.companyShare).toBeCloseTo(2900, 2);
    expect(r.companyNet).toBeCloseTo(2400, 2);
    expect(r.considerationPct).toBe(14.5);
    expect(r.overCap).toBe(true);
  });

  it('handles a missing check and a missing cap without blowing up', () => {
    const r = surplusDisbursement({ checkAmount: null, feePercent: null, expensesTotal: 0, expensesFromClaimantShare: false, capPct: null });
    expect(r.gross).toBe(0);
    expect(r.claimantShare).toBe(0);
    expect(r.considerationPct).toBe(0);
    expect(r.overCap).toBe(false);
  });
});
