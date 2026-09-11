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

/**
 * How sure the table is about the cap. 'none' means the statute text was
 * read and no cap reaches funds in this location, which is a finding, not
 * a gap: it does not block. 'unverified' with no cap still blocks.
 */
export type CapConfidence = 'confirmed' | 'ambiguous' | 'unverified' | 'none';

export interface ComplianceRule {
  state: string;
  surplusType: string;
  fundLocation: string;
  /** Percent cap on TOTAL consideration. null with 'none' means no cap reaches these funds; null otherwise blocks. */
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
const STATUTE_TEXT = 'Statute text read 2026-09-11, counsel confirmation pending';

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
    feeCap: null,
    capConfidence: 'none',
    capBasis:
      'No statutory cap reaches tax deed surplus while the clerk holds it. FS 197.582 has no fee, cap or assignment language. FS 45.033(3)(d) caps a transferee or assignee at 12% but sits in Chapter 45 and is built on the lis pendens presumption, so it is mortgage foreclosure surplus. FS 717.135(2)(j) caps a claimant representative at 30% but subsection (6) scopes it to accounts held by the Department of Financial Services. Under FS 197.582(9) the clerk hands unclaimed surplus to chapter 717 after the claim period, and Lee remits each May one to two years after the sale, so the 30% cap reaches a claim only once it has escheated. The agreement\'s schedule (40/35/30) applies, with its own section 3(f) reduction to any legal maximum.',
    licenseRequired: false,
    licenseTypes: [],
    registrationBody: null,
    filingDeadlineRule:
      'Lienholder claims within 120 days of the notice of surplus (FS 197.582(3)). The owner may claim while the clerk holds the funds. No assignment is filed.',
    claimWindowDays: 120,
    requiredDisclosures: ['financial', 'noAttorneyNeeded', 'allConsideration'],
    statuteRefs: ['FS 197.582', 'FS 45.033', 'FS 717.135'],
    lastVerified: '2026-09-11',
    verifiedBy: STATUTE_TEXT,
  },
  {
    state: 'FL',
    surplusType: SurplusType.MORTGAGE_FORECLOSURE,
    fundLocation: SurplusFundLocation.STATE_ESCHEATED,
    feeCap: 30,
    capConfidence: 'confirmed',
    capBasis:
      'FS 717.135(2)(j): total fees and costs, or the total discount on a purchase agreement, may not exceed 30 percent of the claimed amount. Applies to accounts held by the Department of Financial Services (subsection (6)).',
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
    lastVerified: '2026-09-11',
    verifiedBy: STATUTE_TEXT,
  },
  {
    state: 'FL',
    surplusType: SurplusType.TAX_DEED,
    fundLocation: SurplusFundLocation.STATE_ESCHEATED,
    feeCap: 30,
    capConfidence: 'confirmed',
    capBasis:
      'FS 717.135(2)(j): 30 percent of the claimed amount, once the clerk has remitted the surplus under FS 197.582(9). Same Chapter 717 licensing wall: a registered claimant representative is required, so the team does not work these.',
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
    lastVerified: '2026-09-11',
    verifiedBy: STATUTE_TEXT,
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
  active: ['Duval', 'Lee', 'Polk', 'Brevard', 'Santa Rosa', 'Marion'],
  candidate: ['Volusia', 'Osceola', 'St. Johns'],
};

export const ALL_FL_COUNTIES = FL_COUNTIES.active.concat(FL_COUNTIES.candidate);

/**
 * What the code knows about each county's filing rules before anybody has
 * rung the clerk: links, the published claim form, the mailing address and
 * contact, and whatever the clerk's own form states outright. Seeded onto
 * the county table on first read and used to fill blanks after that, never
 * to overwrite what a person typed in.
 *
 * Every value here was read off the clerk's published documents on the
 * date in the note. Anything the documents do not state (signature on
 * delivery, the clerk's assignment preference, a named contact) is left
 * out so the county row still asks for it.
 */
export interface CountySeed {
  courtRecords?: string;
  surplusList?: string;
  claimForm?: string;
  /** Comma list from ACCEPTED_METHODS: usps, fedex, ups, in_person, efile. */
  acceptedMethods?: string;
  attorneyRequired?: boolean;
  clerkContactPhone?: string;
  clerkContactEmail?: string;
  clerkAddress?: string;
  notes?: string;
}

export const FL_COUNTY_SEED: Record<string, CountySeed> = {
  Duval: {
    courtRecords: 'https://core.duvalclerk.com/CoreCms.aspx?mode=PublicAccess',
    surplusList: 'https://www.duvalclerk.com/departments/county-services/tax-deed-files',
    claimForm: 'https://www.duvalclerk.com/getmedia/9a03a97e-6970-4343-a91b-82f9cde23a5b/Claim-to-Receive-Surplus-Funds.pdf',
    // The information sheet: "return your completed ORIGINAL claim form to
    // the Tax Deeds office either in person or by mail."
    acceptedMethods: 'usps,in_person',
    // Stated on the form: "You are not required to have a Lawyer or any
    // other representation."
    attorneyRequired: false,
    clerkContactPhone: '(904) 255-1916',
    clerkContactEmail: 'Ask.TaxDeeds@DuvalClerk.com',
    clerkAddress: 'Duval County Clerk of Courts, Tax Deeds Department, 501 West Adams Street, Room 1054, Jacksonville, FL 32202',
    notes: [
      'From the clerk\'s Statement of Claim to Surplus Funds (form updated 08/04/2026), read 2026-09-09.',
      'Claim window: a notarized, complete and properly signed statement of claim within 120 days of the mailing of the notice of surplus funds (FS 197.582(3)). The property owner and federal lienholders are the exception to the 120-day bar.',
      'Send the ORIGINAL notarized form, a copy of the notice of surplus funds, a copy of a state-issued photo ID, and the documents showing entitlement (probate records, recorded deed, lien or mortgage). Incomplete claims are returned.',
      'The clerk pays all valid liens before distributing to a titleholder. The form asks whether the property was homestead.',
      'The form says outright that a claimant is not required to assign their interest to anybody, and warns them to read any collection agreement carefully.',
      'Office hours 8:00am to 5:00pm, Monday to Friday, Duval County Courthouse, Room 1054.',
    ].join('\n'),
  },
  Lee: {
    courtRecords: 'https://www.leeclerk.org/i-want-to/search/court-cases-records',
    surplusList: 'https://www.leeclerk.org/departments/courts/property-sales/tax-deed-sales/tax-deed-reports',
    claimForm: 'https://www.leeclerk.org/home/showpublisheddocument/556/638880719508230000',
    // The tax deed department's mailing address is a PO box, which only
    // USPS delivers to; the office is at the Justice Center.
    acceptedMethods: 'usps,in_person',
    // The clerk's checklist lists what a previous owner submits: a
    // notarized affidavit, a photo ID and contact details. No attorney.
    attorneyRequired: false,
    clerkContactPhone: '239-533-5000',
    clerkContactEmail: 'TaxDeedSurplus@leeclerk.org',
    clerkAddress: 'Lee County Clerk of Court, Tax Deed Sales, P.O. Box 9367, Fort Myers, FL 33902-9367 (in person: Justice Center, 2nd Floor, 2075 Dr. Martin Luther King Jr. Boulevard, Fort Myers, FL 33901)',
    notes: [
      'From the clerk\'s Affidavit of Claim, Checklist for Claiming Tax Deed Surplus Funds and Claim Cover Sheet, read 2026-09-09.',
      'The affidavit must be notarized WITH TWO WITNESSES, reference the tax deed number, state the interest claimed and the percentage, and carry the claimant\'s current mailing address. Online notarization is accepted on the form.',
      'Every party (claimant and any assignor or beneficiary) attaches a legible government photo ID showing address and date of birth, plus contact details. Reference the tax deed number on every document and email.',
      'Heirs: a certified or original death certificate plus certified probate documentation filed in Florida (the final order, or the petition if the case is open) listing every heir and their entitlement. Estates are not paid without a court order.',
      'Third-party or assignee claims: a notarized assignment or power of attorney, with two witnesses, stating the amount of surplus assigned, PLUS the original claimant\'s own affidavit. The assignee\'s affidavit alone is not enough.',
      'Cover sheet: https://www.leeclerk.org/home/showpublisheddocument/16571/638739291588300000. Checklist: https://www.leeclerk.org/home/showpublisheddocument/562/636824724510070000.',
      'Lienholder claims must arrive within 120 days of the notice of surplus, mailed about two weeks after the sale. Unclaimed surplus escheats to the state each May, one to two years after the sale; claims are taken as long as the clerk holds the funds.',
      'Docket, mailing addresses and claims received are on RealTDM: https://lee.realtdm.com/public/cases/list.',
    ].join('\n'),
  },
};

/** Kept for the callers that only want the court records link. */
export const FL_COUNTY_LINKS: Record<string, { courtRecords: string }> = Object.fromEntries(
  Object.entries(FL_COUNTY_SEED)
    .filter(([, v]) => v.courtRecords)
    .map(([k, v]) => [k, { courtRecords: v.courtRecords as string }]),
);

export function courtRecordsUrl(county?: string | null): string | null {
  if (!county) return null;
  const key = Object.keys(FL_COUNTY_LINKS).find((k) => k.toLowerCase() === county.trim().toLowerCase());
  return key ? FL_COUNTY_LINKS[key].courtRecords : null;
}

/**
 * Below this a surplus never reaches the feed at all. It is a floor on
 * ingestion, not a filter on a view.
 *
 * Was 15000 on the theory that the fee on a smaller surplus does not cover the
 * title search and the filing. Lowered to 5000 on 2026-08-27: acquisitions
 * worked a $12,445.68 Duval case (2025-0829TD, Ella Clowers estate) by hand and
 * called it a four to five thousand dollar win, which the old floor would have
 * discarded at ingestion. Across the live Duval surplus docket the change adds
 * 25 cases and about $232k of gross surplus on top of the 48 cases already over
 * 15k.
 */
export const SURPLUS_FLOOR = 5000;
