import { ForeclosureLoanType, LenderMatchType } from './foreclosure-rules.util';

/**
 * Starting set of lender patterns, seeded as shared rows (organizationId null).
 *
 * This is meant to grow. Every filing with an unfamiliar holder is a candidate
 * row, and the table is editable in-app precisely so the team can add one
 * without a deploy. Seeded rows are upserted by matchPattern, so re-running the
 * seed refreshes them without duplicating.
 *
 * Patterns are matched with whitespace and punctuation stripped, so
 * "Finance of America Reverse" also matches "FinanceofAmericaReverseLLC" as it
 * comes off a scanned page. Short acronyms use a regex with word boundaries
 * instead, because a squashed three-letter substring over-matches.
 */
export interface SeedLenderProfile {
  matchPattern: string;
  matchType: string;
  lenderName: string;
  loanType: string;
  servicerType?: string;
  notes?: string;
  priority: number;
}

export const LENDER_PROFILE_SEED: SeedLenderProfile[] = [
  // ---- Reverse mortgage (HECM) --------------------------------------------
  // The reason this table exists. A HECM means the borrower was 62+ at
  // origination, so the default is far more likely to be death, permanent
  // move-out, or unpaid taxes and insurance than missed payments - and the
  // person to contact may be an estate representative, not the record owner.
  {
    matchPattern: 'Finance of America Reverse',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Finance of America Reverse LLC',
    loanType: ForeclosureLoanType.REVERSE_HECM,
    servicerType: 'REVERSE_SERVICER',
    notes: 'Seen as present holder on 26SP002244-590 (Mecklenburg).',
    priority: 100,
  },
  {
    matchPattern: 'American Advisors Group',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'American Advisors Group',
    loanType: ForeclosureLoanType.REVERSE_HECM,
    servicerType: 'REVERSE_ORIGINATOR',
    notes: 'Largest HECM originator. Usually appears only in the original beneficiary line.',
    priority: 100,
  },
  {
    // Word-boundary regex, not a substring: a squashed "aag" would match any
    // name containing those three letters consecutively.
    matchPattern: '\\baag\\b',
    matchType: LenderMatchType.REGEX,
    lenderName: 'American Advisors Group (AAG)',
    loanType: ForeclosureLoanType.REVERSE_HECM,
    servicerType: 'REVERSE_ORIGINATOR',
    notes: 'Acronym form. Word-boundary matched to avoid hitting unrelated names.',
    priority: 90,
  },
  {
    matchPattern: 'Longbridge Financial',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Longbridge Financial LLC',
    loanType: ForeclosureLoanType.REVERSE_HECM,
    servicerType: 'REVERSE_SERVICER',
    priority: 100,
  },
  {
    matchPattern: 'Reverse Mortgage Funding',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Reverse Mortgage Funding LLC',
    loanType: ForeclosureLoanType.REVERSE_HECM,
    servicerType: 'REVERSE_SERVICER',
    priority: 100,
  },
  {
    matchPattern: 'Celink',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Celink',
    loanType: ForeclosureLoanType.REVERSE_HECM,
    servicerType: 'REVERSE_SUBSERVICER',
    notes: 'Subservicer for most HECM portfolios; appears as servicer rather than holder.',
    priority: 100,
  },
  {
    // "Mutual of Omaha Mortgage" also writes forward loans, so this is scoped
    // to the reverse product naming and left at a lower priority than the
    // pure-reverse shops above.
    matchPattern: 'Mutual of Omaha Reverse',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Mutual of Omaha Mortgage (reverse division)',
    loanType: ForeclosureLoanType.REVERSE_HECM,
    servicerType: 'REVERSE_SERVICER',
    notes: 'Mutual of Omaha also writes forward loans - only the reverse naming classifies here.',
    priority: 80,
  },
  {
    matchPattern: 'PHH Mortgage.*reverse',
    matchType: LenderMatchType.REGEX,
    lenderName: 'PHH Mortgage (reverse servicing)',
    loanType: ForeclosureLoanType.REVERSE_HECM,
    servicerType: 'REVERSE_SERVICER',
    notes: 'PHH services both forward and reverse; only the reverse designation classifies here.',
    priority: 80,
  },
  {
    matchPattern: 'Home Equity Conversion Mortgage',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'HECM (product named in the filing)',
    loanType: ForeclosureLoanType.REVERSE_HECM,
    notes: 'The product name stated outright. Rare, but decisive when present.',
    priority: 110,
  },

  // ---- HOA assessment liens ------------------------------------------------
  // A different animal: the debt is small relative to the property, the owner
  // may be entirely current on the mortgage, and the payoff is often modest.
  {
    // Broad on purpose: NC associations file as "<Subdivision> Owners
    // Association, Inc." at least as often as "Homeowners Association", and the
    // narrower patterns below missed every one of them. Stops short of a bare
    // "Association", which would swallow the banks that file as "Bank of
    // America, National Association".
    matchPattern: 'Owners Association',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'HOA (association named as party)',
    loanType: ForeclosureLoanType.HOA_ASSESSMENT,
    priority: 50,
  },
  {
    matchPattern: 'Community Association',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Community association',
    loanType: ForeclosureLoanType.HOA_ASSESSMENT,
    priority: 50,
  },
  {
    matchPattern: 'Homeowners Association',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'HOA (association named as party)',
    loanType: ForeclosureLoanType.HOA_ASSESSMENT,
    priority: 50,
  },
  {
    matchPattern: 'Property Owners Association',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'POA (association named as party)',
    loanType: ForeclosureLoanType.HOA_ASSESSMENT,
    priority: 50,
  },
  {
    matchPattern: 'Condominium Association',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Condominium association',
    loanType: ForeclosureLoanType.HOA_ASSESSMENT,
    priority: 50,
  },
  {
    matchPattern: 'Sellers Ayers',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Sellers, Ayers, Dortch & Lyons',
    loanType: ForeclosureLoanType.HOA_ASSESSMENT,
    servicerType: 'HOA_COUNSEL',
    notes: 'NC HOA collection firm. Add other HOA firms here as they are seen.',
    priority: 60,
  },
  {
    matchPattern: 'Law Firm Carolinas',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Law Firm Carolinas',
    loanType: ForeclosureLoanType.HOA_ASSESSMENT,
    servicerType: 'HOA_COUNSEL',
    notes: 'NC community association counsel.',
    priority: 60,
  },

  // ---- Tax foreclosure -----------------------------------------------------
  {
    matchPattern: 'Tax Collector',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'County tax collector',
    loanType: ForeclosureLoanType.TAX_LIEN,
    priority: 60,
  },
  {
    matchPattern: 'Kania Law',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Kania Law Firm',
    loanType: ForeclosureLoanType.TAX_LIEN,
    servicerType: 'TAX_COUNSEL',
    notes: 'Handles tax foreclosures for many NC counties.',
    priority: 60,
  },

  // ---- Government-insured forward loans -----------------------------------
  // Not reverse, but worth distinguishing: FHA and VA carry their own loss
  // mitigation timelines that change what a seller's options actually are.
  {
    matchPattern: 'Secretary of Housing and Urban Development',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'HUD / Secretary of Housing and Urban Development',
    loanType: ForeclosureLoanType.FHA,
    notes: 'HUD as holder usually means an assigned FHA loan. Check for HECM assignment too.',
    priority: 40,
  },
  {
    matchPattern: 'Department of Veterans Affairs',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'US Department of Veterans Affairs',
    loanType: ForeclosureLoanType.VA,
    priority: 40,
  },

  // ---- Conventional servicers ---------------------------------------------
  // Low priority so a reverse pattern always wins if both appear. These exist
  // to positively classify the ordinary case rather than leave it UNKNOWN.
  {
    matchPattern: 'ServiceMac',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'ServiceMac, LLC',
    loanType: ForeclosureLoanType.CONVENTIONAL,
    servicerType: 'SERVICER',
    notes: 'Seen as present holder on 26SP002242-590 (Mecklenburg).',
    priority: 10,
  },
  {
    matchPattern: 'Bank of America',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Bank of America, N.A.',
    loanType: ForeclosureLoanType.CONVENTIONAL,
    servicerType: 'BANK',
    notes: 'Seen as present holder on 26SP002243-590 (Mecklenburg).',
    priority: 10,
  },
  {
    matchPattern: 'Movement Mortgage',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Movement Mortgage, LLC',
    loanType: ForeclosureLoanType.CONVENTIONAL,
    servicerType: 'ORIGINATOR',
    priority: 10,
  },
  {
    matchPattern: 'Wells Fargo',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Wells Fargo Bank, N.A.',
    loanType: ForeclosureLoanType.CONVENTIONAL,
    servicerType: 'BANK',
    priority: 10,
  },
  {
    matchPattern: 'Freedom Mortgage',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Freedom Mortgage Corporation',
    loanType: ForeclosureLoanType.CONVENTIONAL,
    servicerType: 'SERVICER',
    priority: 10,
  },
  {
    matchPattern: 'Rocket Mortgage',
    matchType: LenderMatchType.SUBSTRING,
    lenderName: 'Rocket Mortgage, LLC',
    loanType: ForeclosureLoanType.CONVENTIONAL,
    servicerType: 'SERVICER',
    priority: 10,
  },
];
