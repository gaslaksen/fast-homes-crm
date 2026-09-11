import { surplusDisbursement, surplusFeeSchedule, surplusFeeScheduleLabel } from '@fast-homes/shared';

/**
 * The disbursement arithmetic is what the claimant signs, so it is pinned:
 * the fee is a percent of the check, expenses come out of the company's
 * share unless the agreement passes them to the claimant, and passing them
 * counts toward the Florida cap alongside the fee.
 */
describe('surplusFeeSchedule', () => {
  it('matches the three examples printed in the agreement', () => {
    expect(surplusFeeSchedule(10000).fee).toBe(4000);
    expect(surplusFeeSchedule(75000).fee).toBe(28750);
    expect(surplusFeeSchedule(150000).fee).toBe(52500);
  });

  it("shows the arithmetic tier by tier, the way the agreement's table does", () => {
    const r = surplusFeeSchedule(75000);
    expect(r.label).toBe('40% of $50,000 + 35% of $25,000');
    expect(r.breakdown).toEqual([
      { from: 0, to: 50000, pct: 40, amount: 20000 },
      { from: 50000, to: 75000, pct: 35, amount: 8750 },
    ]);
    expect(r.effectivePct).toBeCloseTo(38.33, 2);
    expect(r.capped).toBe(false);
  });

  it('reduces to the legal cap where one applies, per section 3(f)', () => {
    const r = surplusFeeSchedule(75000, { capPct: 30 });
    expect(r.fee).toBe(22500);
    expect(r.capped).toBe(true);
    expect(r.label).toBe('30% cap');
    expect(r.effectivePct).toBe(30);
  });

  it('handles nothing recovered', () => {
    const r = surplusFeeSchedule(null);
    expect(r.fee).toBe(0);
    expect(r.effectivePct).toBe(0);
    expect(r.label).toBe('no recovery yet');
  });

  it('says the schedule in words', () => {
    expect(surplusFeeScheduleLabel()).toBe('40% of the first $50,000, 35% of the next $50,000, and 30% above $100,000');
  });
});

describe('surplusDisbursement', () => {
  it('follows the agreement schedule when no percent is typed', () => {
    const r = surplusDisbursement({ checkAmount: 75000, feePercent: null, expensesTotal: 0, expensesFromClaimantShare: false, capPct: null });
    expect(r.feeScheduled).toBe(true);
    expect(r.fee).toBe(28750);
    expect(r.feePercent).toBeCloseTo(38.33, 2);
    expect(r.feeLabel).toBe('40% of $50,000 + 35% of $25,000');
    expect(r.claimantShare).toBe(46250);
    expect(r.overCap).toBe(false);
  });

  it('lets a typed percent override the schedule', () => {
    const r = surplusDisbursement({ checkAmount: 75000, feePercent: 25, expensesTotal: 0, expensesFromClaimantShare: false, capPct: null });
    expect(r.feeScheduled).toBe(false);
    expect(r.fee).toBe(18750);
    expect(r.feeLabel).toBe('25%');
  });

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
