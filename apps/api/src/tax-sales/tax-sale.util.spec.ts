import {
  taxSaleUidOf,
  upsetFloor,
  parseDelinquentYears,
  methodFromText,
  statuteFor,
  deedFor,
  occupancyFromText,
  daysUntil,
  scrubFresh,
  callable,
  cleanPhones,
  equityOf,
  equityPctOf,
  netAfterCosts,
  workupComplete,
  scoreOf,
  priorityOf,
  rescueRuleApplies,
  parcelUrlFor,
  TaxSaleScoreInput,
} from './tax-sale.util';
import { TaxSaleMethod, TaxSaleStage, TaxSaleOccupancy } from '@fast-homes/shared';

/** Fixed "now" so nothing here depends on the day the suite runs. */
const NOW = new Date('2026-08-19T12:00:00');
const iso = (d: string) => d;

describe('taxSaleUidOf', () => {
  it('keys on the file number and the address together', () => {
    expect(taxSaleUidOf({ fileNumber: '26 CVD 1234', address: '4218 Tuckaseegee Rd' })).toBe(
      '26CVD1234|4218_TUCKASEEGEE_RD',
    );
  });

  it('is stable across spacing and case in either half', () => {
    const a = taxSaleUidOf({ fileNumber: '26 cvd 1234', address: '4218  tuckaseegee rd' });
    const b = taxSaleUidOf({ fileNumber: '26CVD1234', address: '4218 Tuckaseegee Rd' });
    expect(a).toBe(b);
  });

  it('still keys on the address when a filing carries no file number', () => {
    expect(taxSaleUidOf({ address: '731 Herrin Ave' })).toBe('|731_HERRIN_AVE');
  });

  it('is empty when there is nothing to key on', () => {
    expect(taxSaleUidOf({})).toBe('');
  });

  it('separates two parcels on one judicial action', () => {
    const a = taxSaleUidOf({ fileNumber: '26CVD1', address: '1 Main St' });
    const b = taxSaleUidOf({ fileNumber: '26CVD1', address: '3 Main St' });
    expect(a).not.toBe(b);
  });
});

describe('upsetFloor', () => {
  it('takes 5% when 5% is the larger increment', () => {
    // 5% of 100,000 is 5,000, well over the $750 floor.
    expect(upsetFloor(100000)).toBe(105000);
  });

  it('takes the $750 floor on a small standing bid', () => {
    // 5% of 5,000 is only 250, so the flat $750 governs.
    expect(upsetFloor(5000)).toBe(5750);
  });
});

describe('parseDelinquentYears', () => {
  it('expands a range rather than counting it as one year', () => {
    expect(parseDelinquentYears('2020-2022')).toEqual([2020, 2021, 2022]);
  });

  it('mixes single years and ranges, sorted and deduped', () => {
    expect(parseDelinquentYears('2022, 2019-2020, 2019')).toEqual([2019, 2020, 2022]);
  });

  it('returns nothing for text with no years in it', () => {
    expect(parseDelinquentYears('several')).toEqual([]);
  });
});

describe('method, statute and deed', () => {
  it('reads judicial off the statute number', () => {
    expect(methodFromText('NCGS 105-374')).toBe(TaxSaleMethod.JUDICIAL);
  });

  it('reads judicial off the word commissioner', () => {
    expect(methodFromText('Commissioner sale')).toBe(TaxSaleMethod.JUDICIAL);
  });

  it('defaults to in rem, which is how counties file in house', () => {
    expect(methodFromText('')).toBe(TaxSaleMethod.IN_REM);
  });

  it('pairs each track with its statute and its deed', () => {
    expect(statuteFor(TaxSaleMethod.IN_REM)).toBe('105-375');
    expect(deedFor(TaxSaleMethod.IN_REM)).toBe("Sheriff's Deed");
    expect(statuteFor(TaxSaleMethod.JUDICIAL)).toBe('105-374');
    expect(deedFor(TaxSaleMethod.JUDICIAL)).toBe("Commissioner's Deed");
  });
});

describe('occupancyFromText', () => {
  it('reads a plain Y as owner-occupied', () => {
    expect(occupancyFromText('Y')).toBe(TaxSaleOccupancy.OWNER_OCCUPIED);
  });

  it('reads a plain N as absentee', () => {
    expect(occupancyFromText('N')).toBe(TaxSaleOccupancy.ABSENTEE);
  });

  it('falls back to unknown rather than guessing', () => {
    expect(occupancyFromText('')).toBe(TaxSaleOccupancy.UNKNOWN);
  });
});

describe('daysUntil', () => {
  it('counts forward to a future sale', () => {
    expect(daysUntil(iso('2026-08-29'), NOW)).toBe(10);
  });

  it('goes negative once the sale has been held', () => {
    expect(daysUntil(iso('2026-08-09'), NOW)).toBe(-10);
  });

  it('is null with no date, not zero', () => {
    expect(daysUntil(null, NOW)).toBeNull();
  });
});

describe('the calling rules', () => {
  const clean = [{ number: '7045550100', type: 'Mobile', dnc: null }];
  const registered = [{ number: '7045550100', type: 'Mobile', dnc: 'federal' }];

  it('counts only numbers that are not on a registry', () => {
    expect(cleanPhones(registered)).toHaveLength(0);
    expect(cleanPhones(clean)).toHaveLength(1);
  });

  it('treats a scrub inside 31 days as fresh', () => {
    expect(scrubFresh(iso('2026-08-01'), NOW)).toBe(true);
  });

  it('treats a scrub older than 31 days as no scrub at all', () => {
    expect(scrubFresh(iso('2026-07-01'), NOW)).toBe(false);
  });

  it('clears a call only when the number, the scrub and consent all hold', () => {
    expect(callable({ doNotCall: false, phones: clean, dncScrubbedAt: iso('2026-08-01') }, NOW)).toBe(true);
  });

  it('blocks a call on a stale scrub even with a clean number', () => {
    expect(callable({ doNotCall: false, phones: clean, dncScrubbedAt: iso('2026-01-01') }, NOW)).toBe(false);
  });

  it('blocks a call when every number on file is registered', () => {
    expect(callable({ doNotCall: false, phones: registered, dncScrubbedAt: iso('2026-08-01') }, NOW)).toBe(false);
  });

  it('blocks a call on our own do-not-call flag whatever else is true', () => {
    expect(callable({ doNotCall: true, phones: clean, dncScrubbedAt: iso('2026-08-18') }, NOW)).toBe(false);
  });

  it('flags the 75-120 rescue rule only for a principal residence', () => {
    expect(rescueRuleApplies(TaxSaleOccupancy.OWNER_OCCUPIED)).toBe(true);
    expect(rescueRuleApplies(TaxSaleOccupancy.ABSENTEE)).toBe(false);
  });
});

describe('the money', () => {
  const money = { assessedValue: 212000, redemptionAmount: 19640 };

  it('nets the payoff off the assessed value', () => {
    expect(equityOf(money)).toBe(192360);
    expect(equityPctOf(money)).toBe(91);
  });

  it('never goes negative when the payoff exceeds the value', () => {
    expect(equityOf({ assessedValue: 10000, redemptionAmount: 25000 })).toBe(0);
  });

  it('is zero percent rather than a division by zero with no assessed value', () => {
    expect(equityPctOf({ assessedValue: null, redemptionAmount: 5000 })).toBe(0);
  });

  it('takes a 9% allowance for closing and repair off the top', () => {
    expect(netAfterCosts(money)).toBe(192360 - 19080);
  });
});

describe('workupComplete', () => {
  it('needs all four items, not most of them', () => {
    expect(workupComplete({ title: true, owner: true, occupancy: true, drive: false })).toBe(false);
    expect(workupComplete({ title: true, owner: true, occupancy: true, drive: true })).toBe(true);
  });

  it('treats a missing workup as incomplete', () => {
    expect(workupComplete(null)).toBe(false);
  });
});

describe('scoreOf', () => {
  const base: TaxSaleScoreInput = {
    assessedValue: 200000,
    redemptionAmount: 20000,
    stage: TaxSaleStage.SALE_SCHEDULED,
    workStatus: 'NOT_CONTACTED',
    occupancy: TaxSaleOccupancy.ABSENTEE,
    saleDate: iso('2026-09-30'),
    doNotCall: false,
    hasMortgage: false,
    hasIrsLien: false,
    delinquentYears: [2023, 2024],
    tags: [],
    phones: [{ number: '7045550100', type: 'Mobile', dnc: null }],
    emails: ['owner@example.com'],
    dncScrubbedAt: iso('2026-08-15'),
  };

  it('scores a clean, high-equity, near-dated lead high', () => {
    expect(scoreOf(base, NOW)).toBeGreaterThanOrEqual(45);
    expect(priorityOf(scoreOf(base, NOW))).toBe('HIGH');
  });

  it('zeroes a redeemed filing, because the property left the sale', () => {
    expect(scoreOf({ ...base, stage: TaxSaleStage.REDEEMED }, NOW)).toBe(0);
  });

  it('zeroes a do-not-call lead', () => {
    expect(scoreOf({ ...base, doNotCall: true }, NOW)).toBe(0);
  });

  it('zeroes a dead lead', () => {
    expect(scoreOf({ ...base, workStatus: 'DEAD' }, NOW)).toBe(0);
  });

  it('cuts hard for a mortgage on title, because the lender usually redeems', () => {
    expect(scoreOf({ ...base, hasMortgage: true }, NOW)).toBe(scoreOf(base, NOW) - 14);
  });

  it('scores a missing sale date as far out, not as imminent', () => {
    // The prototype fell through a null comparison here and scored a lead with
    // no date as if the sale were inside 14 days.
    const noDate = scoreOf({ ...base, saleDate: null }, NOW);
    const imminent = scoreOf({ ...base, saleDate: iso('2026-08-25') }, NOW);
    expect(noDate).toBeLessThan(imminent);
    expect(noDate).toBe(scoreOf({ ...base, saleDate: iso('2027-06-01') }, NOW));
  });

  it('penalises a lead whose every number is registered', () => {
    const allRegistered = scoreOf(
      { ...base, phones: [{ number: '7045550100', type: 'Mobile', dnc: 'federal' }] },
      NOW,
    );
    // Loses the +12 for a clean number and takes the -10 on top.
    expect(allRegistered).toBe(scoreOf(base, NOW) - 22);
  });

  it('never leaves the 0 to 100 range', () => {
    const wrecked = scoreOf(
      { ...base, assessedValue: 1000, redemptionAmount: 900, hasMortgage: true, hasIrsLien: true, tags: ['Heirs required'], phones: [], emails: [] },
      NOW,
    );
    expect(wrecked).toBeGreaterThanOrEqual(0);
    expect(wrecked).toBeLessThanOrEqual(100);
  });
});

describe('priorityOf', () => {
  it('bands at 45 and 15', () => {
    expect(priorityOf(45)).toBe('HIGH');
    expect(priorityOf(44)).toBe('MEDIUM');
    expect(priorityOf(15)).toBe('MEDIUM');
    expect(priorityOf(14)).toBe('LOW');
  });
});

describe('parcelUrlFor', () => {
  it('knows the counties actually worked', () => {
    expect(parcelUrlFor('Mecklenburg')).toContain('polaris3g');
    expect(parcelUrlFor('Union')).toContain('unioncountync');
  });

  it('returns nothing rather than a wrong viewer for a county with no entry', () => {
    expect(parcelUrlFor('Wake')).toBeNull();
  });
});
