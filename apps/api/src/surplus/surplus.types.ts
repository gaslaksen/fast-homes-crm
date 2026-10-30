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
  /** Null for a US address. */
  ownerMailingCountry?: string | null;
  ownerAddressSource?: string | null;

  sourceSystem?: string | null;
  sourceCaseId?: string | null;
  sourceUrl?: string | null;

  importBatch?: string;
}

export interface SurplusListFilters {
  organizationId?: string | null;
  search?: string;
  /**
   * Comma-separated SurplusTier values. The dollar band, kept as a filter and
   * a sort; `queue` is what the board labels and groups by now.
   */
  tier?: string;
  /** Comma-separated SurplusQueue values: what to do with the claimant next. */
  queue?: string;
  stage?: string;
  claimantType?: string;
  /** 'all' (default) or one county name we hold leads for. */
  county?: string;
  /** '15-25' | '25-50' | '50+' */
  band?: string;
  /**
   * How old the claim is, off the notice or the sale where no notice has been
   * read: 'under-120' (still inside the claim window), '120-365' (workable),
   * '365+' (attorney only). '0-7' backs the board's "New, 7 days" chip.
   */
  noticeAge?: string;
  /**
   * Hide claims whose notice (or sale, where no notice has been read) is
   * younger than SURPLUS_EARLY_DAYS. The board sends this on by default.
   */
  hideEarly?: boolean;
  /** 'open' | 'closed' */
  lienWindow?: string;
  /** 'property' (default) groups claimants by subject property; 'lead' does not. */
  group?: string;
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
  /** 'not_tapped' | 'tapped' | 'recap_scheduled': whether the claimant has ever responded. */
  contact?: string;
  /** Only claimants with at least one of call, text, email, letter not yet attempted. */
  missingChannel?: boolean;
  /** Only claimants due their next letter under their cadence. */
  letterDue?: boolean;
  /** Only signed claimants who have not heard from us in thirty days. */
  updateOverdue?: boolean;
  /**
   * Property-level cuts the board used to make in the browser on whatever
   * page it had loaded. Server-side so paging stays right: an estate, a
   * competing lien, a short window, a sale under a year old. On the grouped
   * board each one keeps the whole property when any claimant on it qualifies.
   */
  estate?: boolean;
  competingLien?: boolean;
  shortWindow?: boolean;
  underYear?: boolean;
  /**
   * Only claimants sent out in this saved skip-trace batch. Opening a batch
   * is a deliberate look at everyone in it, so the default cuts (lienholders,
   * the floor, retired cases) do not hide any of them.
   */
  batchId?: string;
  /** Only cases this user owns (the board's Mine filter). */
  ownerId?: string;
  /** 'notice' | 'surplus' | 'net' | 'tier' */
  sort?: string;
  /**
   * A board column header, which beats `sort`. Applied to the properties before
   * paging, so a header sort orders the whole list and not one page of it.
   */
  sortColumn?: string;
  /** 'asc' | 'desc'. Anything else is 'desc', the way a header opens. */
  sortDir?: string;
  page?: number;
  pageSize?: number;
}
