import {
  matchLenderProfile,
  daysToHearing,
  urgencyBand,
  upsetBidDeadline,
  isUpsetBidOpen,
  borrowerAgeFloorAtOrigination,
  borrowerAgeFloorToday,
  principalFigureReliable,
  shouldAdoptFilingPrincipal,
  equitySpreadWhenReliable,
  equityPctWhenReliable,
  evaluateRules,
  loanTypeFromFilingText,
  debtFigureCaveat,
  ForeclosureLoanType,
  ForeclosureUrgency,
  LenderMatchType,
  LenderProfile,
} from './foreclosure-rules.util';
import { LENDER_PROFILE_SEED } from './lender-profiles.seed';

/** The seeded table, in the shape the matcher consumes. */
const SEED: LenderProfile[] = LENDER_PROFILE_SEED.map((s) => ({
  matchPattern: s.matchPattern,
  matchType: s.matchType,
  lenderName: s.lenderName,
  loanType: s.loanType,
  servicerType: s.servicerType ?? null,
  priority: s.priority,
  active: true,
}));

const NOW = new Date('2026-07-28T12:00:00Z');

describe('matchLenderProfile', () => {
  it('catches the reverse mortgage from the holder name', () => {
    const match = matchLenderProfile({ holderName: 'Finance of America Reverse LLC' }, SEED);
    expect(match!.profile.loanType).toBe(ForeclosureLoanType.REVERSE_HECM);
    expect(match!.matchedField).toBe('holderName');
  });

  it('matches through the space-stripping of a scanned page', () => {
    // This is the whole reason substring matching squashes both sides: page 1
    // of an eCourts filing comes back from pdf-parse with the spaces gone.
    const match = matchLenderProfile({ holderName: 'FinanceofAmericaReverseLLC' }, SEED);
    expect(match!.profile.loanType).toBe(ForeclosureLoanType.REVERSE_HECM);
  });

  it('catches a HECM named only in the original beneficiary', () => {
    // The case the feature exists for: a servicer holds the note, and the
    // reverse originator appears only in the beneficiary line.
    const match = matchLenderProfile(
      {
        holderName: 'Some Servicing Co',
        originalBeneficiary: 'Mortgage Electronic Registration Systems, Inc. as nominee for American Advisors Group',
      },
      SEED,
    );
    expect(match!.profile.loanType).toBe(ForeclosureLoanType.REVERSE_HECM);
    expect(match!.matchedField).toBe('originalBeneficiary');
  });

  it('matches the AAG acronym only on a word boundary', () => {
    expect(matchLenderProfile({ holderName: 'AAG' }, SEED)!.profile.loanType).toBe(
      ForeclosureLoanType.REVERSE_HECM,
    );
    // A squashed three-letter substring would fire on this; the regex must not.
    expect(matchLenderProfile({ holderName: 'Haagen Capital Partners' }, SEED)).toBeNull();
  });

  it('classifies the two conventional control filings, not as reverse', () => {
    expect(matchLenderProfile({ holderName: 'Bank of America, N.A.' }, SEED)!.profile.loanType).toBe(
      ForeclosureLoanType.CONVENTIONAL,
    );
    expect(matchLenderProfile({ holderName: 'ServiceMac, LLC' }, SEED)!.profile.loanType).toBe(
      ForeclosureLoanType.CONVENTIONAL,
    );
  });

  it('lets a reverse pattern beat a conventional one when both appear', () => {
    // A HECM sold to a bank: the reverse originator must still win.
    const match = matchLenderProfile(
      { holderName: 'Bank of America, N.A.', originalBeneficiary: 'American Advisors Group' },
      SEED,
    );
    expect(match!.profile.loanType).toBe(ForeclosureLoanType.REVERSE_HECM);
  });

  it('classifies HOA and tax petitioners', () => {
    expect(matchLenderProfile({ holderName: 'Oak Ridge Homeowners Association, Inc.' }, SEED)!.profile.loanType)
      .toBe(ForeclosureLoanType.HOA_ASSESSMENT);
    expect(matchLenderProfile({ holderName: 'Mecklenburg County Tax Collector' }, SEED)!.profile.loanType)
      .toBe(ForeclosureLoanType.TAX_LIEN);
  });

  it('catches an association named without the word "Homeowners"', () => {
    // Real filing 26SP002284-590, which the narrower patterns all missed.
    expect(
      matchLenderProfile({ holderName: 'Princeton at Southampton Owners Association, Inc.' }, SEED)!
        .profile.loanType,
    ).toBe(ForeclosureLoanType.HOA_ASSESSMENT);
    expect(
      matchLenderProfile({ holderName: 'Ballantyne Community Association' }, SEED)!.profile.loanType,
    ).toBe(ForeclosureLoanType.HOA_ASSESSMENT);
  });

  it('does not read a bank filing as an HOA on the word Association', () => {
    // Banks file as "National Association", which is why the pattern is
    // "Owners Association" and not a bare "Association".
    const match = matchLenderProfile(
      { holderName: 'Bank of America, National Association' }, SEED,
    );
    expect(match?.profile.loanType).not.toBe(ForeclosureLoanType.HOA_ASSESSMENT);
  });

  it('returns null for an unrecognised lender rather than guessing', () => {
    expect(matchLenderProfile({ holderName: 'Some Bank Nobody Has Seen' }, SEED)).toBeNull();
    expect(matchLenderProfile({ holderName: '', originalBeneficiary: null }, SEED)).toBeNull();
  });

  it('ignores deactivated rows', () => {
    const off = SEED.map((p) => ({ ...p, active: false }));
    expect(matchLenderProfile({ holderName: 'Finance of America Reverse LLC' }, off)).toBeNull();
  });

  it('survives an invalid user-authored regex instead of throwing', () => {
    const broken: LenderProfile[] = [
      { matchPattern: '([unclosed', matchType: LenderMatchType.REGEX, lenderName: 'Broken', loanType: 'X', priority: 999, active: true },
      ...SEED,
    ];
    expect(matchLenderProfile({ holderName: 'Finance of America Reverse LLC' }, broken)!.profile.loanType)
      .toBe(ForeclosureLoanType.REVERSE_HECM);
  });

  it('breaks a priority tie on the more specific pattern', () => {
    const profiles: LenderProfile[] = [
      { matchPattern: 'Acme', matchType: 'substring', lenderName: 'Acme', loanType: 'CONVENTIONAL', priority: 50, active: true },
      { matchPattern: 'Acme Reverse Lending', matchType: 'substring', lenderName: 'Acme Reverse', loanType: 'REVERSE_HECM', priority: 50, active: true },
    ];
    expect(matchLenderProfile({ holderName: 'Acme Reverse Lending LLC' }, profiles)!.profile.loanType)
      .toBe('REVERSE_HECM');
  });
});

describe('daysToHearing and urgencyBand', () => {
  it('counts whole calendar days', () => {
    expect(daysToHearing(new Date('2026-08-11T18:00:00Z'), NOW)).toBe(14);
    expect(daysToHearing(new Date('2026-07-28T23:00:00Z'), NOW)).toBe(0);
  });

  it('goes negative for a hearing already past', () => {
    expect(daysToHearing(new Date('2026-07-21T18:00:00Z'), NOW)).toBe(-7);
  });

  it('bands the plan boundaries exactly', () => {
    expect(urgencyBand(0)).toBe(ForeclosureUrgency.CRITICAL);
    expect(urgencyBand(13)).toBe(ForeclosureUrgency.CRITICAL);
    expect(urgencyBand(14)).toBe(ForeclosureUrgency.HIGH);
    expect(urgencyBand(30)).toBe(ForeclosureUrgency.HIGH);
    expect(urgencyBand(31)).toBe(ForeclosureUrgency.MEDIUM);
    expect(urgencyBand(60)).toBe(ForeclosureUrgency.MEDIUM);
    expect(urgencyBand(61)).toBe(ForeclosureUrgency.LOW);
  });

  it('treats an already-past hearing as critical, not low', () => {
    // A passed hearing means the case moved on - the most time-sensitive
    // state, not the least.
    expect(urgencyBand(-5)).toBe(ForeclosureUrgency.CRITICAL);
  });

  it('returns null when there is no hearing date', () => {
    expect(daysToHearing(null)).toBeNull();
    expect(daysToHearing(new Date('nonsense'))).toBeNull();
    expect(urgencyBand(null)).toBeNull();
  });
});

describe('upsetBidDeadline', () => {
  it('is ten days after the sale', () => {
    expect(upsetBidDeadline(new Date('2026-11-03T14:00:00Z'))!.toISOString().slice(0, 10))
      .toBe('2026-11-13');
  });

  it('is open between the sale and the deadline, and not outside it', () => {
    const sale = new Date('2026-07-25T14:00:00Z');
    expect(isUpsetBidOpen(sale, NOW)).toBe(true);
    expect(isUpsetBidOpen(sale, new Date('2026-08-06T00:00:00Z'))).toBe(false);
    expect(isUpsetBidOpen(sale, new Date('2026-07-24T00:00:00Z'))).toBe(false);
  });

  it('is null and closed with no sale date', () => {
    expect(upsetBidDeadline(null)).toBeNull();
    expect(isUpsetBidOpen(null, NOW)).toBe(false);
  });
});

describe('borrowerAgeFloorAtOrigination', () => {
  it('is 62 on a HECM, because that is the product floor', () => {
    expect(borrowerAgeFloorAtOrigination(ForeclosureLoanType.REVERSE_HECM, new Date('2022-10-22')))
      .toBe(62);
  });

  it('is null for every other loan type', () => {
    for (const type of [
      ForeclosureLoanType.CONVENTIONAL, ForeclosureLoanType.FHA, ForeclosureLoanType.VA,
      ForeclosureLoanType.HOA_ASSESSMENT, ForeclosureLoanType.TAX_LIEN,
      ForeclosureLoanType.PRIVATE_HARD_MONEY, ForeclosureLoanType.UNKNOWN,
    ]) {
      expect(borrowerAgeFloorAtOrigination(type, new Date('2022-10-22'))).toBeNull();
    }
  });

  it('is null without an origination date to anchor it', () => {
    expect(borrowerAgeFloorAtOrigination(ForeclosureLoanType.REVERSE_HECM, null)).toBeNull();
  });

  it('ages the floor forward to today', () => {
    // 2022-10-22 origination, now 2026-07-28: 3 full years elapsed.
    expect(borrowerAgeFloorToday(ForeclosureLoanType.REVERSE_HECM, new Date('2022-10-22'), NOW))
      .toBe(65);
    expect(borrowerAgeFloorToday(ForeclosureLoanType.CONVENTIONAL, new Date('2022-10-22'), NOW))
      .toBeNull();
  });
});

describe('principalFigureReliable and the equity suppression', () => {
  it('is false only for a reverse mortgage', () => {
    expect(principalFigureReliable(ForeclosureLoanType.REVERSE_HECM)).toBe(false);
    expect(principalFigureReliable(ForeclosureLoanType.CONVENTIONAL)).toBe(true);
    expect(principalFigureReliable(ForeclosureLoanType.UNKNOWN)).toBe(true);
  });

  it('suppresses equity on a HECM rather than computing it wrong', () => {
    // 26SP002244-590: $412,500 recorded against a $389,000 assessment reads as
    // negative equity. The recorded figure is a multiple of the maximum claim
    // amount, so that conclusion is wrong and must not be shown.
    expect(equitySpreadWhenReliable(ForeclosureLoanType.REVERSE_HECM, 389000, 412500)).toBeNull();
    expect(equityPctWhenReliable(ForeclosureLoanType.REVERSE_HECM, 389000, 412500)).toBeNull();
  });

  it('still computes equity on a conventional loan', () => {
    expect(equitySpreadWhenReliable(ForeclosureLoanType.CONVENTIONAL, 389000, 200160)).toBe(188840);
    expect(equityPctWhenReliable(ForeclosureLoanType.CONVENTIONAL, 389000, 200160)).toBe(49);
  });

  it('returns null when either input is missing, without treating it as zero', () => {
    expect(equitySpreadWhenReliable(ForeclosureLoanType.CONVENTIONAL, null, 200160)).toBeNull();
    expect(equitySpreadWhenReliable(ForeclosureLoanType.CONVENTIONAL, 389000, null)).toBeNull();
    expect(equityPctWhenReliable(ForeclosureLoanType.CONVENTIONAL, 0, 200160)).toBeNull();
  });
});

describe('shouldAdoptFilingPrincipal', () => {
  it('adopts a confidently extracted principal', () => {
    // 26SP002244-590 scored 0.99 on this field.
    expect(shouldAdoptFilingPrincipal(412500, 0.99)).toBe(true);
    expect(shouldAdoptFilingPrincipal(200160, 0.5)).toBe(true);
  });

  it('keeps the stored figure when the extractor was unsure', () => {
    // Replacing one unreliable number with another gains nothing.
    expect(shouldAdoptFilingPrincipal(412500, 0.49)).toBe(false);
    expect(shouldAdoptFilingPrincipal(412500, 0)).toBe(false);
  });

  it('adopts when no score was recorded, since the field set is still better', () => {
    expect(shouldAdoptFilingPrincipal(412500, null)).toBe(true);
    expect(shouldAdoptFilingPrincipal(412500, undefined)).toBe(true);
  });

  it('never adopts a missing or nonsensical principal', () => {
    for (const bad of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(shouldAdoptFilingPrincipal(bad as any, 0.99)).toBe(false);
    }
  });
});

describe('evaluateRules', () => {
  const spears = {
    holderName: 'Finance of America Reverse LLC',
    originalBeneficiary: 'Mortgage Electronic Registration Systems, Inc. as nominee for American Advisors Group',
    hearingAt: new Date('2026-09-08T18:00:00Z'),
    saleAt: null,
    dotDate: new Date('2022-10-22'),
    originalPrincipal: 412500,
  };

  it('reads the reverse-mortgage filing end to end', () => {
    const r = evaluateRules(spears, SEED, { assessedValue: 389000, now: NOW });
    expect(r.loanType).toBe(ForeclosureLoanType.REVERSE_HECM);
    expect(r.principalFigureReliable).toBe(false);
    expect(r.equitySpread).toBeNull();
    expect(r.equityPct).toBeNull();
    expect(r.borrowerAgeFloorAtOrigination).toBe(62);
    expect(r.borrowerAgeFloorToday).toBe(65);
    expect(r.daysToHearing).toBe(42);
    expect(r.urgency).toBe(ForeclosureUrgency.MEDIUM);
  });

  it('reads an ordinary conventional filing without inventing anything', () => {
    const r = evaluateRules(
      {
        holderName: 'Bank of America, N.A.',
        originalBeneficiary: 'Bank of America, NA',
        hearingAt: new Date('2026-09-08T18:00:00Z'),
        saleAt: null,
        dotDate: new Date('2009-04-14'),
        originalPrincipal: 200160,
      },
      SEED,
      { assessedValue: 389000, now: NOW },
    );
    expect(r.loanType).toBe(ForeclosureLoanType.CONVENTIONAL);
    expect(r.principalFigureReliable).toBe(true);
    expect(r.equitySpread).toBe(188840);
    // No age implication on a conventional loan, and no upset bid without a sale.
    expect(r.borrowerAgeFloorAtOrigination).toBeNull();
    expect(r.upsetBidDeadline).toBeNull();
    expect(r.upsetBidOpen).toBe(false);
  });

  it('falls back to UNKNOWN and keeps equity math when the lender is unrecognised', () => {
    const r = evaluateRules(
      { holderName: 'Unheard Of Capital LLC', originalPrincipal: 200000 },
      SEED,
      { assessedValue: 300000, now: NOW },
    );
    expect(r.loanType).toBe(ForeclosureLoanType.UNKNOWN);
    expect(r.lenderName).toBeNull();
    // An unknown lender is not a reason to suppress a figure we can compute.
    expect(r.equitySpread).toBe(100000);
  });

  it('is deterministic for a fixed now', () => {
    expect(evaluateRules(spears, SEED, { assessedValue: 389000, now: NOW }))
      .toEqual(evaluateRules(spears, SEED, { assessedValue: 389000, now: NOW }));
  });
});

describe('the seeded table itself', () => {
  it('has no duplicate patterns, which the unique index would reject', () => {
    const patterns = LENDER_PROFILE_SEED.map((s) => s.matchPattern.toLowerCase());
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it('only uses declared loan types', () => {
    const valid = new Set(Object.values(ForeclosureLoanType) as string[]);
    for (const seed of LENDER_PROFILE_SEED) expect(valid.has(seed.loanType)).toBe(true);
  });

  it('compiles every regex pattern', () => {
    for (const seed of LENDER_PROFILE_SEED) {
      if (seed.matchType === LenderMatchType.REGEX) {
        expect(() => new RegExp(seed.matchPattern, 'i')).not.toThrow();
      }
    }
  });

  it('ranks every reverse pattern above every conventional one', () => {
    // Ordering is what makes a HECM sold to a bank still read as a HECM.
    const reverse = LENDER_PROFILE_SEED.filter((s) => s.loanType === ForeclosureLoanType.REVERSE_HECM);
    const conventional = LENDER_PROFILE_SEED.filter((s) => s.loanType === ForeclosureLoanType.CONVENTIONAL);
    expect(Math.min(...reverse.map((s) => s.priority)))
      .toBeGreaterThan(Math.max(...conventional.map((s) => s.priority)));
  });

  it('covers every reverse servicer the plan named', () => {
    const names = LENDER_PROFILE_SEED
      .filter((s) => s.loanType === ForeclosureLoanType.REVERSE_HECM)
      .map((s) => `${s.matchPattern} ${s.lenderName}`.toLowerCase())
      .join(' | ');
    for (const required of [
      'finance of america', 'american advisors', 'aag', 'longbridge',
      'mutual of omaha', 'celink', 'reverse mortgage funding', 'phh',
    ]) {
      expect(names).toContain(required);
    }
  });
});

describe('loanTypeFromFilingText', () => {
  // Caption of the real filing 26SP002284-590, as pdf-parse returns it.
  const HOA_CAPTION = `STATEOFNORTHCAROLINAINTHEGENERALCOURTOFJUSTICE
COUNTYOFMECKLENBURG BEFORETHECLERK
INTHEMATTEROFTHE PROPOSED FORECLOSUREOFCLAIMOFLIEN FILED AGAINST
DELAHKUDJIKU NOTICEOFHEARING PRIORTOFORECLOSURE BY OFCLAIMOFLIEN
PRINCETON AT SOUTHAMPTONOWNERS ASSOCIATION, INC.`;

  it('reads an HOA claim of lien off the caption', () => {
    expect(loanTypeFromFilingText(HOA_CAPTION)).toBe(ForeclosureLoanType.HOA_ASSESSMENT);
  });

  it('needs both the instrument and the body, not either alone', () => {
    expect(loanTypeFromFilingText('NOTICE OF HEARING. Claim of Lien recorded.')).toBeNull();
    expect(loanTypeFromFilingText('Princeton at Southampton Owners Association')).toBeNull();
  });

  it('does not read a tax foreclosure as an HOA lien', () => {
    // "assessment" appears in tax filings too, so tax is tested first.
    expect(
      loanTypeFromFilingText('IN REM FORECLOSURE of tax lien for delinquent taxes and assessment'),
    ).toBe(ForeclosureLoanType.TAX_LIEN);
  });

  it('answers null rather than UNKNOWN when it cannot tell', () => {
    expect(loanTypeFromFilingText('NOTICE OF SUBSTITUTE TRUSTEE SALE under a deed of trust')).toBeNull();
    expect(loanTypeFromFilingText('')).toBeNull();
    expect(loanTypeFromFilingText(null)).toBeNull();
  });
});

describe('evaluateRules loan type precedence', () => {
  const hoaText = 'FORECLOSURE OF CLAIM OF LIEN by SOUTHAMPTON OWNERS ASSOCIATION INC';

  it('falls back to the caption when no lender profile matches', () => {
    const res = evaluateRules({ holderName: 'Nobody In The Table LLC' }, [], {
      documentText: hoaText,
    });
    expect(res.loanType).toBe(ForeclosureLoanType.HOA_ASSESSMENT);
    expect(res.loanTypeSource).toBe('filingText');
  });

  it('lets a matched lender profile win over the caption', () => {
    const res = evaluateRules({ holderName: 'Finance of America Reverse LLC' }, SEED, {
      documentText: hoaText,
    });
    expect(res.loanType).toBe(ForeclosureLoanType.REVERSE_HECM);
    expect(res.loanTypeSource).toBe('profile');
  });

  it('stays UNKNOWN when neither the profiles nor the caption can tell', () => {
    const res = evaluateRules({ holderName: 'Nobody In The Table LLC' }, SEED, {
      documentText: 'NOTICE OF SUBSTITUTE TRUSTEE SALE',
    });
    expect(res.loanType).toBe(ForeclosureLoanType.UNKNOWN);
    expect(res.loanTypeSource).toBeNull();
  });
});

describe('HOA liens suppress equity the way reverse mortgages do', () => {
  it('marks the HOA lien figure unreliable', () => {
    expect(principalFigureReliable(ForeclosureLoanType.HOA_ASSESSMENT)).toBe(false);
    expect(principalFigureReliable(ForeclosureLoanType.REVERSE_HECM)).toBe(false);
    expect(principalFigureReliable(ForeclosureLoanType.CONVENTIONAL)).toBe(true);
    expect(principalFigureReliable(ForeclosureLoanType.TAX_LIEN)).toBe(true);
  });

  it('blanks both equity fields on an HOA filing', () => {
    // $4,100 of unpaid dues against a $312,500 house would otherwise read as
    // 98% equity on a property whose first mortgage is untouched.
    const res = evaluateRules(
      { holderName: 'Princeton at Southampton Owners Association, Inc.', originalPrincipal: 4100 },
      SEED,
      { assessedValue: 312500 },
    );
    expect(res.loanType).toBe(ForeclosureLoanType.HOA_ASSESSMENT);
    expect(res.principalFigureReliable).toBe(false);
    expect(res.equitySpread).toBeNull();
    expect(res.equityPct).toBeNull();
  });

  it('still computes equity for an ordinary conventional filing', () => {
    const res = evaluateRules(
      { holderName: 'Bank of America, N.A.', originalPrincipal: 200000 },
      SEED,
      { assessedValue: 312500 },
    );
    expect(res.equitySpread).toBe(112500);
    expect(res.equityPct).not.toBeNull();
  });

  it('explains the two suppressions differently, since they are opposite errors', () => {
    expect(debtFigureCaveat(ForeclosureLoanType.REVERSE_HECM)).toMatch(/overstates/i);
    expect(debtFigureCaveat(ForeclosureLoanType.HOA_ASSESSMENT)).toMatch(/senior mortgage/i);
    expect(debtFigureCaveat(ForeclosureLoanType.CONVENTIONAL)).toBeNull();
  });
});
