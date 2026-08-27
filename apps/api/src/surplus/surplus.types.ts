/** Shapes the Surplus Funds controller, service, and importer pass between them. */

import { SurplusLien } from './surplus.util';

export interface SurplusPhoneInput {
  number: string;
  type?: string | null;
  /** DncRegistry value, or null when the number came back clean. */
  dnc?: string | null;
}

/** One normalized row, whether it came off a county list or the Add lead form. */
export interface SurplusLeadInput {
  /** The property that sold. There is nothing to buy here, but it identifies the case. */
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  parcelId?: string;
  caseNumber?: string;

  /** The person owed the money. */
  claimant?: string;
  claimantType?: string;
  deceased?: boolean;
  heirsRequired?: boolean;
  competingLien?: boolean;

  surplusType?: string;
  fundLocation?: string;

  saleDate?: string | null;
  salePrice?: number | null;
  noticeDate?: string | null;
  noticeConfirmed?: boolean;
  certOfDisbursements?: string | null;

  grossSurplus?: number | null;
  liens?: SurplusLien[];

  arrangement?: string;
  totalConsideration?: number | null;
  licensedRepId?: string | null;

  stage?: string;
  notes?: string;

  phones?: SurplusPhoneInput[];
  emails?: string[];
  dncScrubbedAt?: string | null;
  /** True when a skip trace returned somebody other than the claimant. */
  contactMismatch?: boolean;
  mismatchedName?: string | null;

  // ── From a county ingest ──────────────────────────────────────────────────
  /** SurplusClaimStatus, read off the case document list. */
  claimStatus?: string | null;
  /** What the clerk's mailed notice said, as against the balance posted today. */
  surplusAtNotice?: number | null;
  /** 'delivered' | 'undeliverable' | 'mixed' | 'unknown'. */
  mailVerdict?: string | null;
  /** The classified document list, kept so the classifier can be re-run. */
  claimLedger?: unknown;
  /** Read off the Notice of Surplus Funds. The skip-trace target. */
  noticeRecipient?: string | null;
  ownerMailingStreet?: string | null;
  ownerMailingCity?: string | null;
  ownerMailingState?: string | null;
  ownerMailingZip?: string | null;
  ownerAddressSource?: string | null;

  sourceSystem?: string | null;
  sourceCaseId?: string | null;
  sourceUrl?: string | null;

  importBatch?: string;
}

export interface SurplusListFilters {
  organizationId?: string | null;
  search?: string;
  /** Comma-separated SurplusTier values. */
  tier?: string;
  stage?: string;
  claimantType?: string;
  /** 'active' (default), 'all', or one county name. */
  county?: string;
  /** '15-25' | '25-50' | '50+' */
  band?: string;
  /** '0-7' | '8-30' | '31-120' | '120+' */
  noticeAge?: string;
  /** 'open' | 'closed' */
  lienWindow?: string;
  /** Comma-separated SurplusClaimStatus values. */
  claimStatus?: string;
  /**
   * Retired cases (paid out, or the owner already signed) are out of the board
   * by default. Pass false to see them.
   */
  hideRetired?: boolean;
  /** Only leads whose contract send is blocked. */
  blockedOnly?: boolean;
  hideDead?: boolean;
  hideDnc?: boolean;
  /** 'notice' | 'surplus' | 'net' | 'tier' */
  sort?: string;
  page?: number;
  pageSize?: number;
}
