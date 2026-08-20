/**
 * Florida surplus-funds compliance rules, and the gate that decides whether a
 * fee agreement can be sent at all.
 *
 * This is a BLOCKING gate, not a warning banner. The reason is the shape of the
 * exposure: FS 45.033(3)(d) caps "total compensation paid or payable, earned or
 * expected to be earned", so a fee that clears the cap on its face can still
 * breach it once anything else in the deal is counted. A UI that merely warned
 * would ship contracts that are void and, in the escheated case, unlicensed.
 *
 * `feeCap: null` therefore blocks outright rather than defaulting to something
 * permissive. Where the cap is unsettled the conservative figure is applied and
 * the card says, on its face, that the number is our default and not authority.
 *
 * NOTHING HERE IS LEGAL ADVICE. Every entry carries `lastVerified` and a stated
 * basis, and a rule older than RULE_MAX_AGE_DAYS blocks sending until it is
 * re-checked, so a stale table fails closed.
 *
 * Florida only. North Carolina requires an attorney to petition for surplus and
 * to certify title and priority, so NC is a referral at best and is deliberately
 * not modelled here.
 */

import { SurplusType, SurplusFundLocation } from '@fast-homes/shared';

export type CapConfidence = 'confirmed' | 'ambiguous' | 'unverified';

export interface ComplianceRule {
  state: string;
  surplusType: string;
  fundLocation: string;
  /** Percent cap on TOTAL consideration. null means no confirmed cap, which blocks. */
  feeCap: number | null;
  capConfidence: CapConfidence;
  capBasis: string;
  licenseRequired: boolean;
  licenseTypes: string[];
  registrationBody: string | null;
  filingDeadlineRule: string;
  /** Days the claim window runs from the mailed notice. null when the regime has none. */
  claimWindowDays: number | null;
  requiredDisclosures: string[];
  statuteRefs: string[];
  /** ISO date. Past RULE_MAX_AGE_DAYS this rule blocks sending until re-verified. */
  lastVerified: string;
  verifiedBy: string;
}

const RESEARCH_ONLY = 'Research only, not counsel';

export const COMPLIANCE_RULES: ComplianceRule[] = [
  {
    state: 'FL',
    surplusType: SurplusType.MORTGAGE_FORECLOSURE,
    fundLocation: SurplusFundLocation.CLERK,
    feeCap: 12,
    capConfidence: 'confirmed',
    capBasis:
      'FS 45.033(3)(d) caps total compensation paid or payable, earned or expected to be earned, at 12% of the surplus.',
    licenseRequired: false,
    licenseTypes: [],
    registrationBody: null,
    filingDeadlineRule:
      'Assignment must be filed with the court within 60 days after the certificate of disbursements.',
    claimWindowDays: 120,
    requiredDisclosures: ['financial', 'noAttorneyNeeded', 'allConsideration'],
    statuteRefs: ['FS 45.033'],
    lastVerified: '2026-07-28',
    verifiedBy: RESEARCH_ONLY,
  },
  {
    state: 'FL',
    surplusType: SurplusType.TAX_DEED,
    fundLocation: SurplusFundLocation.CLERK,
    feeCap: 12,
    capConfidence: 'ambiguous',
    capBasis:
      'FS 45.033 sits in Chapter 45, is titled for property subject to foreclosure, and subsection (7) narrows it further. Tax deed surplus is Chapter 197 and FS 197.582 carries no cap language. Florida practitioners write about the two together and treat 45.033(3)(d) as capping recovery fees on both, but that is commentary rather than authority. 12% is applied conservatively pending a written opinion.',
    licenseRequired: false,
    licenseTypes: [],
    registrationBody: null,
    filingDeadlineRule:
      'Assignment filing deadline unconfirmed for Chapter 197. Treat the 60 day rule as the working assumption.',
    claimWindowDays: 120,
    requiredDisclosures: ['financial', 'noAttorneyNeeded', 'allConsideration'],
    statuteRefs: ['FS 197.582', 'FS 45.033'],
    lastVerified: '2026-07-28',
    verifiedBy: RESEARCH_ONLY,
  },
  {
    state: 'FL',
    surplusType: SurplusType.MORTGAGE_FORECLOSURE,
    fundLocation: SurplusFundLocation.STATE_ESCHEATED,
    feeCap: null,
    capConfidence: 'unverified',
    capBasis:
      'FS 717.135 cap unconfirmed. Older text showed 20%, a newer source showed 30%, and a 2016 bill proposed removing the maximum.',
    licenseRequired: true,
    licenseTypes: [
      'Florida attorney',
      'Florida CPA',
      'Chapter 493 private investigator, Class C plus Class A',
    ],
    registrationBody: 'Florida DFS per FS 717.1400',
    filingDeadlineRule: 'Governed by Chapter 717 once funds escheat.',
    claimWindowDays: null,
    requiredDisclosures: ['financial', 'noAttorneyNeeded', 'allConsideration'],
    statuteRefs: ['FS 717.124', 'FS 717.135', 'FS 717.1400'],
    lastVerified: '2026-07-28',
    verifiedBy: RESEARCH_ONLY,
  },
  {
    state: 'FL',
    surplusType: SurplusType.TAX_DEED,
    fundLocation: SurplusFundLocation.STATE_ESCHEATED,
    feeCap: null,
    capConfidence: 'unverified',
    capBasis: 'Same Chapter 717 licensing wall, cap unconfirmed.',
    licenseRequired: true,
    licenseTypes: [
      'Florida attorney',
      'Florida CPA',
      'Chapter 493 private investigator, Class C plus Class A',
    ],
    registrationBody: 'Florida DFS per FS 717.1400',
    filingDeadlineRule: 'Governed by Chapter 717 once funds escheat.',
    claimWindowDays: null,
    requiredDisclosures: ['financial', 'noAttorneyNeeded', 'allConsideration'],
    statuteRefs: ['FS 717.124', 'FS 717.135', 'FS 717.1400'],
    lastVerified: '2026-07-28',
    verifiedBy: RESEARCH_ONLY,
  },
];

/** Past this, a rule blocks sending until someone re-checks the statute. */
export const RULE_MAX_AGE_DAYS = 180;

/** Default claim window when the matched rule does not state one. */
export const DEFAULT_CLAIM_WINDOW_DAYS = 120;

/** Days from the certificate of disbursements to the assignment filing deadline. */
export const ASSIGNMENT_FILING_DAYS = 60;

export const DISCLOSURE_LABELS: Record<string, string> = {
  financial:
    'Financial disclosure: assessed value, note that assessed may sit below actual, approximate debt, approximate equity',
  noAttorneyNeeded:
    'Statement that the owner does not need an attorney or representative to recover surplus funds',
  allConsideration: 'Every form of consideration specified, not just the headline fee',
};

export function ruleFor(
  surplusType?: string | null,
  fundLocation?: string | null,
): ComplianceRule | null {
  return (
    COMPLIANCE_RULES.find(
      (r) => r.state === 'FL' && r.surplusType === surplusType && r.fundLocation === fundLocation,
    ) || null
  );
}

/**
 * Florida counties this pipeline runs in. `active` is the default view;
 * `candidate` is the expansion list. Adding one is a line here, not a rebuild.
 */
export const FL_COUNTIES = {
  active: ['Lee', 'Santa Rosa', 'Marion'],
  candidate: ['Volusia', 'Duval', 'Osceola', 'St. Johns', 'Brevard'],
};

export const ALL_FL_COUNTIES = FL_COUNTIES.active.concat(FL_COUNTIES.candidate);

/**
 * Below this a surplus never reaches the feed at all. It is a floor on
 * ingestion, not a filter on a view: the fee on a $12k surplus does not cover
 * the title search and the filing.
 */
export const SURPLUS_FLOOR = 15000;
