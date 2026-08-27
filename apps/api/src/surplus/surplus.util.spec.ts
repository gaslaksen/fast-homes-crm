import {
  workScore,
  workReason,
  surplusUidOf,
  nameMatchesClaimant,
  surnameOf,
  claimantTypeFromText,
  stageFromText,
  tierOf,
  dripTrack,
  isDeceased,
  noticeAge,
  claimDeadline,
  daysRemaining,
  windowElapsedPct,
  assignmentDeadline,
  assignmentDaysLeft,
  lienWindowOpen,
  sortedLiens,
  totalLiens,
  netToClaimant,
  estFee,
  pctOfGross,
  pctOfNet,
  governingPct,
  canQualify,
  complianceGate,
  SurplusFacts,
} from './surplus.util';
import {
  SurplusClaimantType,
  SurplusClaimStatus,
  SurplusStage,
  SurplusTier,
} from '@fast-homes/shared';

/** Fixed "now" so nothing here depends on the day the suite runs. */
const NOW = new Date('2026-08-19T12:00:00');

/** A clerk-held tax deed surplus with every disclosure ticked: the clear case. */
const clean: SurplusFacts = {
  surplusType: 'tax_deed',
  fundLocation: 'clerk',
  claimantType: SurplusClaimantType.PREVIOUS_OWNER,
  deceased: false,
  heirsRequired: false,
  competingLien: false,
  grossSurplus: 60000,
  liens: [],
  noticeDate: '2026-08-01',
  noticeConfirmed: true,
  certOfDisbursements: null,
  totalConsideration: 0,
  licensedRepId: null,
  disclosures: { financial: true, noAttorneyNeeded: true, allConsideration: true },
  entitlementVerified: true,
  titleSearchComplete: true,
  stage: SurplusStage.NEW,
};

describe('surplusUidOf', () => {
  it('keys on county, case and claimant together', () => {
    expect(surplusUidOf({ county: 'Lee', caseNumber: '26-TD-100', claimant: 'Yvette Kalu' })).toBe(
      'LEE|26-TD-100|YVETTE_KALU',
    );
  });

  it('separates two claimants against the same surplus', () => {
    const owner = surplusUidOf({ county: 'Lee', caseNumber: '26-TD-100', claimant: 'Yvette Kalu' });
    const lienholder = surplusUidOf({ county: 'Lee', caseNumber: '26-TD-100', claimant: 'Acme HOA' });
    expect(owner).not.toBe(lienholder);
  });

  it('is empty when there is nothing to key on', () => {
    expect(surplusUidOf({})).toBe('');
  });

  it('falls back to the parcel when a clerk list ships no case number', () => {
    expect(surplusUidOf({ county: 'Marion', parcelId: '06510-000-00', claimant: 'Tammie Hill' })).toBe(
      'MARION|06510-000-00|TAMMIE_HILL',
    );
  });

  it('keeps two properties held by one owner in a county apart without a case number', () => {
    const a = surplusUidOf({ county: 'Marion', parcelId: '111', claimant: 'Donald Gates' });
    const b = surplusUidOf({ county: 'Marion', parcelId: '222', claimant: 'Donald Gates' });
    expect(a).not.toBe(b);
  });

  it('prefers the case number over the parcel when both are present', () => {
    expect(
      surplusUidOf({ county: 'Lee', caseNumber: '26-TD-1', parcelId: '999', claimant: 'A B' }),
    ).toBe('LEE|26-TD-1|A_B');
  });
});

describe('nameMatchesClaimant', () => {
  it('accepts a trace that returned the same surname', () => {
    expect(nameMatchesClaimant('BARR', 'Barr')).toBe(true);
  });

  it('accepts a different first name at the same surname, which is the household', () => {
    // Gordon Samanie's trace came back as John Samanie: a relative at the same
    // address, and the right household to reach.
    expect(nameMatchesClaimant('SAMANIE', 'Samanie')).toBe(true);
  });

  it('rejects an outright different person', () => {
    // The three real rejections from the Marion County export.
    expect(nameMatchesClaimant('HILL', 'Martin')).toBe(false);
    expect(nameMatchesClaimant('HUNT', 'Tolmo')).toBe(false);
    expect(nameMatchesClaimant('ROSS', 'Filkins')).toBe(false);
  });

  it('accepts a hyphenated surname sharing one half', () => {
    expect(nameMatchesClaimant('Smith-Jones', 'Jones')).toBe(true);
    expect(nameMatchesClaimant('Jones', 'Smith-Jones')).toBe(true);
  });

  it('accepts when the trace returned nothing, since there is nothing to reject', () => {
    expect(nameMatchesClaimant('HILL', '')).toBe(true);
    expect(nameMatchesClaimant('HILL', null)).toBe(true);
  });

  it('refuses to vouch for a trace when the claimant surname is unknown', () => {
    expect(nameMatchesClaimant('', 'Martin')).toBe(false);
  });

  it('ignores initials and punctuation rather than matching on them', () => {
    // A single letter is not evidence of anything.
    expect(nameMatchesClaimant('B', 'Barr')).toBe(false);
    expect(nameMatchesClaimant("O'Brien", 'OBrien')).toBe(true);
  });
});

describe('surnameOf', () => {
  it('takes the last-name column when there is one', () => {
    expect(surnameOf('Tammie', 'Hill')).toBe('Hill');
  });

  it('falls back to the final word of a full name', () => {
    expect(surnameOf('Tammie Lee Hill', '')).toBe('Hill');
  });

  it('returns a single word unchanged', () => {
    expect(surnameOf('Hill', '')).toBe('Hill');
  });
});

describe('claimantTypeFromText', () => {
  it('reads an estate off the claimant name itself', () => {
    expect(claimantTypeFromText('Estate of Odessa Rainwater')).toBe(SurplusClaimantType.HEIR_ESTATE);
  });

  it('reads a lienholder', () => {
    expect(claimantTypeFromText('Sunrise HOA, lienholder')).toBe(SurplusClaimantType.LIENHOLDER);
  });

  it('defaults to the previous owner', () => {
    expect(claimantTypeFromText('Deshawn Ruffin')).toBe(SurplusClaimantType.PREVIOUS_OWNER);
  });
});

describe('stageFromText', () => {
  it('maps the spellings a county list uses onto the pipeline', () => {
    expect(stageFromText('agreement signed')).toBe(SurplusStage.AGREEMENT_SIGNED);
    expect(stageFromText('Claim filed 7/2')).toBe(SurplusStage.CLAIM_FILED);
    expect(stageFromText('PAID')).toBe(SurplusStage.PAID);
    expect(stageFromText('')).toBe(SurplusStage.NEW);
  });
});

describe('tierOf', () => {
  it('puts a living owner at $25k+ with no competing lien in A', () => {
    expect(tierOf(clean)).toBe(SurplusTier.A);
  });

  it('puts $10k to $25k on a living owner in B', () => {
    expect(tierOf({ ...clean, grossSurplus: 18000 })).toBe(SurplusTier.B);
  });

  it('puts a deceased owner at $25k+ in C', () => {
    expect(tierOf({ ...clean, deceased: true })).toBe(SurplusTier.C);
  });

  it('treats heirs-required the same as deceased for banding', () => {
    expect(tierOf({ ...clean, heirsRequired: true })).toBe(SurplusTier.C);
  });

  it('leaves a $25k+ living owner WITH a competing lien unbanded rather than forcing a tier', () => {
    // A deliberate gap in the banding spec, not an oversight in the code.
    expect(tierOf({ ...clean, competingLien: true })).toBe(SurplusTier.UNBANDED);
  });

  it('leaves a deceased owner under $25k unbanded, the other deliberate gap', () => {
    expect(tierOf({ ...clean, grossSurplus: 18000, deceased: true })).toBe(SurplusTier.UNBANDED);
  });

  it('reads either death flag as deceased', () => {
    expect(isDeceased({ ...clean, heirsRequired: true })).toBe(true);
  });
});

describe('the claim clock', () => {
  it('runs the window from the mailed notice, not the sale', () => {
    // Notice 2026-08-01 plus the 120 day window.
    expect(claimDeadline(clean)?.toISOString().slice(0, 10)).toBe('2026-11-29');
  });

  it('is null with no notice date rather than guessing off the sale', () => {
    expect(claimDeadline({ ...clean, noticeDate: null, saleDate: '2026-01-01' } as any)).toBeNull();
    expect(daysRemaining({ ...clean, noticeDate: null }, NOW)).toBeNull();
  });

  it('counts the days left against today', () => {
    expect(daysRemaining(clean, NOW)).toBe(102);
    expect(noticeAge(clean, NOW)).toBe(18);
  });

  it('reports how far through the window the claim is', () => {
    expect(Math.round(windowElapsedPct(clean, NOW))).toBe(15);
  });

  it('keeps the assignment deadline as a separate 60 day clock off the certificate', () => {
    const withCert = { ...clean, certOfDisbursements: '2026-07-01' };
    expect(assignmentDeadline(withCert)?.toISOString().slice(0, 10)).toBe('2026-08-30');
    expect(assignmentDaysLeft(withCert, NOW)).toBe(11);
  });

  it('has no assignment clock until the certificate is issued', () => {
    expect(assignmentDeadline(clean)).toBeNull();
  });

  it('keeps the lienholder window open for 120 days after the notice', () => {
    expect(lienWindowOpen(clean, NOW)).toBe(true);
    expect(lienWindowOpen({ ...clean, noticeDate: '2026-01-01' }, NOW)).toBe(false);
  });
});

describe('the waterfall', () => {
  const withLiens: SurplusFacts = {
    ...clean,
    grossSurplus: 100000,
    liens: [
      { type: 'Second mortgage', holder: 'Coastal CU', amount: 30000, priority: 1 },
      { type: 'Code enforcement', holder: 'City of Cape Coral', amount: 5000, priority: 3, governmental: true },
      { type: 'Judgment', holder: 'Acme Roofing', amount: 8000, priority: 2 },
    ],
  };

  it('pays governmental liens first, whatever their recording order', () => {
    expect(sortedLiens(withLiens).map((l) => l.holder)).toEqual([
      'City of Cape Coral',
      'Coastal CU',
      'Acme Roofing',
    ]);
  });

  it('totals every lien and nets them off the gross', () => {
    expect(totalLiens(withLiens)).toBe(43000);
    expect(netToClaimant(withLiens)).toBe(57000);
  });

  it('never goes negative when the liens exceed the surplus', () => {
    expect(netToClaimant({ ...clean, grossSurplus: 20000, liens: [{ type: 'x', holder: 'y', amount: 50000, priority: 1 }] })).toBe(0);
  });

  it('quotes the fee at the cap for a regime that has one', () => {
    expect(estFee(withLiens)).toBe(6840); // 12% of 57,000
  });

  it('quotes no fee at all where no cap is confirmed', () => {
    expect(estFee({ ...clean, fundLocation: 'state_escheated' })).toBeNull();
  });
});

describe('the cap is measured against the stricter of the two percentages', () => {
  const lead: SurplusFacts = {
    ...clean,
    grossSurplus: 100000,
    liens: [{ type: 'Judgment', holder: 'Acme', amount: 60000, priority: 1 }],
    totalConsideration: 8000,
  };

  it('computes both percentages', () => {
    expect(pctOfGross(lead)).toBeCloseTo(8);
    expect(pctOfNet(lead)).toBeCloseTo(20);
  });

  it('lets the larger one govern, so net cannot be hidden behind gross', () => {
    expect(governingPct(lead)).toBeCloseTo(20);
  });

  it('blocks the send when the governing percentage clears the cap', () => {
    const g = complianceGate(lead, NOW);
    expect(g.clear).toBe(false);
    expect(g.blocks.join(' ')).toContain('20.0% against the 12% cap');
  });
});

describe('complianceGate', () => {
  it('clears a fully disclosed clerk-held mortgage foreclosure surplus', () => {
    const g = complianceGate({ ...clean, surplusType: 'mortgage_foreclosure' }, NOW);
    expect(g.clear).toBe(true);
    expect(g.blocks).toEqual([]);
  });

  it('warns but does not block on the unsettled tax deed cap', () => {
    const g = complianceGate(clean, NOW);
    expect(g.clear).toBe(true);
    expect(g.warns.join(' ')).toContain('conservative default');
  });

  it('blocks outright when no fee cap is confirmed for the regime', () => {
    const g = complianceGate({ ...clean, fundLocation: 'state_escheated', licensedRepId: 'rep_1' }, NOW);
    expect(g.clear).toBe(false);
    expect(g.blocks.join(' ')).toContain('No confirmed fee cap');
  });

  it('blocks escheated funds with no registered representative assigned', () => {
    const g = complianceGate({ ...clean, fundLocation: 'state_escheated' }, NOW);
    expect(g.blocks.join(' ')).toContain("registered claimant's representative is required");
  });

  it('blocks on a missing disclosure and says how many', () => {
    const g = complianceGate({ ...clean, disclosures: { financial: true } }, NOW);
    expect(g.clear).toBe(false);
    expect(g.blocks.join(' ')).toContain('missing 2 required disclosures');
  });

  it('fails closed on a rule nobody has re-verified inside 180 days', () => {
    const stale = new Date('2027-06-01T12:00:00');
    const g = complianceGate({ ...clean, surplusType: 'mortgage_foreclosure' }, stale);
    expect(g.clear).toBe(false);
    expect(g.blocks.join(' ')).toContain('over the 180 day limit');
  });

  it('blocks when no rule matches the surplus type and fund location at all', () => {
    const g = complianceGate({ ...clean, surplusType: 'sheriff_sale' }, NOW);
    expect(g.clear).toBe(false);
    expect(g.rule).toBeNull();
    expect(g.blocks.join(' ')).toContain('No compliance rule on file');
  });

  it('warns, without blocking, on an unconfirmed notice date', () => {
    const g = complianceGate({ ...clean, surplusType: 'mortgage_foreclosure', noticeConfirmed: false }, NOW);
    expect(g.clear).toBe(true);
    expect(g.warns.join(' ')).toContain('claim clock is an estimate');
  });

  it('warns when the assignment filing deadline is inside two weeks', () => {
    const g = complianceGate({ ...clean, certOfDisbursements: '2026-07-01' }, NOW);
    expect(g.warns.join(' ')).toContain('within 11 days');
  });

  it('warns after the assignment deadline has already passed', () => {
    const g = complianceGate({ ...clean, certOfDisbursements: '2026-05-01' }, NOW);
    expect(g.warns.join(' ')).toContain('passed 50 days ago');
  });
});

describe('dripTrack', () => {
  it('routes an estate onto the heir track whatever the clock says', () => {
    expect(dripTrack({ ...clean, deceased: true }, NOW)).toBe('Heir/Estate');
  });

  it('calls a claim with under 30 days left urgent', () => {
    expect(dripTrack({ ...clean, noticeDate: '2026-05-01' }, NOW)).toBe('Urgent');
  });

  it('compresses a claim between 30 and 60 days out', () => {
    expect(dripTrack({ ...clean, noticeDate: '2026-06-01' }, NOW)).toBe('Compressed');
  });

  it('leaves a fresh claim on the standard track', () => {
    expect(dripTrack(clean, NOW)).toBe('Standard');
  });

  it('falls back to standard when there is no clock to read', () => {
    expect(dripTrack({ ...clean, noticeDate: null }, NOW)).toBe('Standard');
  });
});

describe('canQualify', () => {
  it('needs all three, not two of three', () => {
    expect(canQualify(clean)).toBe(true);
    expect(canQualify({ ...clean, titleSearchComplete: false })).toBe(false);
    expect(canQualify({ ...clean, noticeConfirmed: false })).toBe(false);
    expect(canQualify({ ...clean, entitlementVerified: false })).toBe(false);
  });
});

describe('workScore', () => {
  const base = {
    claimStatus: SurplusClaimStatus.OPEN,
    netToClaimant: 20000,
    cleanPhoneCount: 1,
    mailVerdict: 'mixed',
    daysRemaining: 90,
  };

  it('scores a retired case at zero however big it is', () => {
    // Duval 2025-0774TD posts $27,929.98 and was paid out in full. It must not
    // appear anywhere near the top of a call list.
    expect(workScore({ ...base, claimStatus: SurplusClaimStatus.DISTRIBUTED, netToClaimant: 500000 }))
      .toBe(0);
    expect(workScore({ ...base, claimStatus: SurplusClaimStatus.ASSIGNED, netToClaimant: 500000 }))
      .toBe(0);
  });

  it('scores a do-not-call lead at zero', () => {
    expect(workScore({ ...base, doNotCall: true })).toBe(0);
  });

  it('puts a denied claim above an untouched one', () => {
    // The whole point of the ranking. A denied claimant has already raised a
    // hand and failed on paperwork, which is the easiest conversation there is.
    expect(workScore({ ...base, claimStatus: SurplusClaimStatus.DENIED }))
      .toBeGreaterThan(workScore({ ...base, claimStatus: SurplusClaimStatus.OPEN }));
  });

  it('lets contactability beat money', () => {
    // A reachable $16k lead outranks an unreachable $60k one, because the
    // second one is not a lead until somebody finds a number for it.
    const reachable = workScore({ ...base, netToClaimant: 16000, cleanPhoneCount: 2 });
    const unreachable = workScore({
      ...base,
      netToClaimant: 60000,
      cleanPhoneCount: 0,
      mailVerdict: 'undeliverable',
    });
    expect(reachable).toBeGreaterThan(unreachable);
  });

  it('never lets money outrank claim status', () => {
    const richPending = workScore({
      ...base,
      claimStatus: SurplusClaimStatus.PENDING,
      netToClaimant: 1000000,
    });
    const poorOpen = workScore({ ...base, claimStatus: SurplusClaimStatus.OPEN, netToClaimant: 5001 });
    expect(poorOpen).toBeGreaterThan(richPending);
  });

  it('penalises a skip trace that returned a stranger', () => {
    expect(workScore({ ...base, contactMismatch: true, cleanPhoneCount: 0 }))
      .toBeLessThan(workScore({ ...base, cleanPhoneCount: 0 }));
  });

  it('lifts a lead whose lien window is nearly closed', () => {
    expect(workScore({ ...base, daysRemaining: 12 }))
      .toBeGreaterThan(workScore({ ...base, daysRemaining: 200 }));
  });

  it('does not treat a long-closed window as urgent', () => {
    // Most of the live Duval docket is months past the 120 day mark. Giving
    // those the closing-soon bonus put the stalest leads at the top of the
    // call list, which is the opposite of what the ranking is for.
    expect(workScore({ ...base, daysRemaining: -322 }))
      .toBeLessThan(workScore({ ...base, daysRemaining: 12 }));
    expect(workScore({ ...base, daysRemaining: -322 }))
      .toBe(workScore({ ...base, daysRemaining: 200 }));
  });
});

describe('workReason clock wording', () => {
  it('never renders a closed window as negative days left', () => {
    const r = workReason({
      claimStatus: SurplusClaimStatus.OPEN,
      cleanPhoneCount: 1,
      daysRemaining: -322,
    });
    expect(r).not.toContain('-322 days left');
    expect(r).toContain('lien window closed');
  });

  it('counts down a window that is still open', () => {
    expect(
      workReason({ claimStatus: SurplusClaimStatus.OPEN, cleanPhoneCount: 1, daysRemaining: 12 }),
    ).toContain('12 days left');
  });
});

describe('workReason', () => {
  it('names the retirement rather than pretending to rank it', () => {
    expect(workReason({ claimStatus: SurplusClaimStatus.DISTRIBUTED })).toBe('Paid out');
  });

  it('says why a lead is unreachable instead of just scoring it low', () => {
    const r = workReason({
      claimStatus: SurplusClaimStatus.OPEN,
      cleanPhoneCount: 0,
      mailVerdict: 'undeliverable',
    });
    expect(r).toContain('no callable number yet');
    expect(r).toContain('clerk mail all returned');
  });

  it('calls out a mismatched skip trace by name', () => {
    expect(workReason({ claimStatus: SurplusClaimStatus.OPEN, cleanPhoneCount: 0, contactMismatch: true }))
      .toContain('somebody else');
  });
});
