/**
 * Type definitions for the BatchData Property Search & Property Lookup APIs.
 *
 * Source: developer.batchdata.com docs + verified curl examples.
 * These shapes are inferred from `customProjection` allowed-values lists and
 * sample requests; if a live response surfaces fields not modelled here, treat
 * the property record as `Record<string, unknown>` and normalize defensively.
 */

// ─── Address ────────────────────────────────────────────────────────────────

export interface BatchDataAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

// ─── Property Search request ────────────────────────────────────────────────

/**
 * Allowed `datasets` values per BatchData docs. Note: 'basic' and 'core' are
 * mutually exclusive. Defaults to whatever the token is provisioned for if
 * omitted.
 */
export type BatchDataDataset =
  | 'basic'
  | 'batchrank'
  | 'contact'
  | 'core'
  | 'deed'
  | 'demographic'
  | 'foreclosure'
  | 'image'
  | 'listing'
  | 'mortgage-liens'
  | 'owner'
  | 'permit'
  | 'quicklist'
  | 'valuation';

export interface BatchDataPropertySearchOptions {
  // Pagination
  skip?: number;            // default 0
  take?: number;            // default 25, min 1, max 500

  // Comp algorithm switches (only meaningful when searchCriteria.compAddress is set)
  useDistance?: boolean;    // default true
  distanceMiles?: number;   // default 1
  useBedrooms?: boolean;    // default true
  minBedrooms?: number;     // default -1 (delta from subject)
  maxBedrooms?: number;     // default 1
  useBathrooms?: boolean;   // default false
  minBathrooms?: number;
  maxBathrooms?: number;
  useStories?: boolean;     // default false
  minStories?: number;
  maxStories?: number;
  useArea?: boolean;        // default true
  minAreaPercent?: number;  // default -20
  maxAreaPercent?: number;  // default 20
  useYearBuilt?: boolean;   // default true
  minYearBuilt?: number;    // default -10 (delta years)
  maxYearBuilt?: number;    // default 10
  useLotSize?: boolean;     // default false
  minLotSizePercent?: number;
  maxLotSizePercent?: number;
  useSubdivision?: boolean;
  aggComparablesMetrics?: boolean;
  skipTrace?: boolean;      // default false

  // Output shape
  datasets?: BatchDataDataset[];
  projection?: 'custom';
  customProjection?: string[];   // dot-notation field paths
  dateFormat?: 'iso-date' | 'iso-date-time';
}

export interface BatchDataPropertySearchCriteria {
  /** Free-text USPS partial address used to narrow geographic scope. */
  query?: string;

  /** Subject property when searching for comparables. */
  compAddress?: BatchDataAddress;

  /** Property type filters (Residential / Single Family / etc). */
  general?: {
    propertyTypeCategory?: { inList?: string[]; equals?: string };
    propertyTypeDetail?: { inList?: string[]; equals?: string };
  };

  /** Sale-price filter. */
  sale?: {
    lastSalePrice?: { min?: number; max?: number };
    lastSaleDate?: { minDate?: string; maxDate?: string };
  };

  /** Lot size in acres. */
  lot?: {
    lotSizeAcres?: { min?: number; max?: number };
  };

  /** "intel" filter — last sold date, etc. */
  intel?: {
    lastSoldDate?: { minDate?: string; maxDate?: string };
  };

  /** Predefined named queries (preforeclosure, cash-buyer, etc). */
  quickList?: string;
  quickLists?: string[];
  orQuickLists?: string[];
}

export interface BatchDataPropertySearchRequest {
  searchCriteria: BatchDataPropertySearchCriteria;
  options?: BatchDataPropertySearchOptions;
}

// ─── Property Lookup request ────────────────────────────────────────────────

export interface BatchDataPropertyLookupRequest {
  requests: Array<{
    address?: BatchDataAddress;
    propertyId?: string;
    hash?: string;
    apn?: string;
    countyFipsCode?: string;
    requestId?: string;
  }>;
  options?: Pick<
    BatchDataPropertySearchOptions,
    'datasets' | 'projection' | 'customProjection' | 'dateFormat' | 'skipTrace'
  >;
}

// ─── Response — Property record shape ───────────────────────────────────────

/**
 * The subset of fields most relevant to comp normalization. BatchData responses
 * may contain many more fields depending on the `datasets` requested; treat
 * unknown fields as `Record<string, unknown>` on the rawData side and only
 * lift the ones we render.
 */
export interface BatchDataProperty {
  meta?: {
    requestId?: string;
  };
  address?: {
    hash?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    county?: string;
    latitude?: number;
    longitude?: number;
  };
  building?: {
    yearBuilt?: number;
    bedroomCount?: number;
    bathroomCount?: number;
    livingAreaSquareFeet?: number;
    storiesCount?: number;
  };
  lot?: {
    lotSizeAcres?: number;
    lotSizeSquareFeet?: number;
  };
  sale?: {
    lastSale?: {
      price?: number;
      saleDate?: string;
      saleType?: string;
      documentType?: string;
    };
  };
  valuation?: {
    estimatedValue?: number;
    estimatedValueLow?: number;
    estimatedValueHigh?: number;
    confidenceScore?: number;
  };
  legal?: {
    subdivisionName?: string;
    apn?: string;
  };
  general?: {
    propertyTypeCategory?: string;
    propertyTypeDetail?: string;
  };
  owner?: {
    fullName?: string;
    mailingAddress?: BatchDataAddress;
  };
  /** Distance from compAddress in miles (present when compAddress was set) */
  distance?: number;
}

// ─── Response envelope ──────────────────────────────────────────────────────

export interface BatchDataSearchResponse {
  status?: {
    code?: number;
    message?: string;
  };
  results?: {
    meta?: {
      resultsFound?: number;
      take?: number;
      skip?: number;
    };
    properties?: BatchDataProperty[];
  };
  // Some endpoints return properties directly without nesting under results.
  // Handle defensively in the service layer.
  properties?: BatchDataProperty[];
}
