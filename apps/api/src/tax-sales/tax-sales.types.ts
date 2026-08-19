/** Shapes the Tax Sales controller, service, and importer pass between them. */

export interface TaxSalePhoneInput {
  number: string;
  type?: string | null;
  /** DncRegistry value, or null when the number came back clean. */
  dnc?: string | null;
}

/** One normalized row, whether it came off a CSV or the Add lead form. */
export interface TaxSaleLeadInput {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  parcelId?: string;

  fileNumber?: string;
  method?: string;
  statute?: string;
  deedType?: string;
  filedBy?: string;

  owner?: string;
  propertyType?: string;
  acreage?: number | null;
  ownedSince?: string;
  occupancy?: string;

  saleDate?: string | null;
  upsetDeadline?: string | null;

  assessedValue?: number | null;
  taxesOwed?: number | null;
  redemptionAmount?: number | null;
  openingBid?: number | null;
  currentBid?: number | null;
  depositPct?: number | null;
  delinquentYears?: number[] | string | null;
  cityTaxes?: boolean;
  hasMortgage?: boolean;
  hasIrsLien?: boolean;

  stage?: string;
  workStatus?: string;
  tags?: string[];
  notes?: string;

  phones?: TaxSalePhoneInput[];
  emails?: string[];
  dncScrubbedAt?: string | null;

  importBatch?: string;
}

export interface TaxSaleListFilters {
  organizationId?: string | null;
  search?: string;
  /** Comma-separated ForeclosurePriority values. */
  priority?: string;
  workStatus?: string;
  stage?: string;
  method?: string;
  county?: string;
  city?: string;
  propertyType?: string;
  occupancy?: string;
  /** Minimum equity percent. */
  equityMin?: number;
  /** Minimum years delinquent. */
  yearsMin?: number;
  /** Sale inside this many days. */
  saleWithinDays?: number;
  /** 'u10' | '10-25' | '25+' */
  payoffBand?: string;
  /** 'callable' | 'dnc' | 'stale' | 'none' */
  phoneStatus?: string;
  hideRedeemed?: boolean;
  hideDnc?: boolean;
  /** 'recent' | 'sale' | 'score' | 'payoff' | 'equity' | 'years' */
  sort?: string;
  page?: number;
  pageSize?: number;
}
