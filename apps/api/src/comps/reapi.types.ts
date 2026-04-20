/**
 * RealEstateAPI (REAPI) response types.
 *
 * REAPI returns highly variable shapes across endpoints, so these are a
 * deliberately loose mapping of the fields we care about. Every field is
 * optional because different endpoints/record sources populate different
 * subsets. The service layer pulls what's present and writes it onto the
 * Lead / Comp / CompAnalysis models.
 */

export interface ReapiProperty {
  // Identity
  id?: string;                     // REAPI internal property id
  apn?: string;                    // Assessor's Parcel Number
  fips?: string;

  // Address
  address?: {
    street?: string;
    address?: string;              // full formatted
    city?: string;
    state?: string;
    zip?: string;
    county?: string;
    latitude?: number;
    longitude?: number;
  };

  // Core property details
  bedrooms?: number;
  bathrooms?: number;
  squareFeet?: number;
  lotSquareFeet?: number;          // REAPI often returns sqft for lot
  yearBuilt?: number;
  propertyType?: string;
  propertyUse?: string;
  stories?: number;

  // Features
  hasPool?: boolean;
  hasGarage?: boolean;
  garageSpaces?: number;
  hasBasement?: boolean;
  basementSqft?: number;
  heatingType?: string;
  coolingType?: string;
  roofType?: string;
  wallType?: string;

  // Valuation
  estimatedValue?: number;
  estimatedValueLow?: number;
  estimatedValueHigh?: number;
  estimatedEquity?: number;
  pricePerSquareFoot?: number;

  // Tax / Assessment
  taxAssessedValue?: number;
  taxAssessedLandValue?: number;
  taxAssessedImprovementValue?: number;
  annualTaxAmount?: number;
  taxYear?: number;
  assessmentYear?: number;

  // Ownership
  ownerOccupied?: boolean;
  absenteeOwner?: boolean;
  corporateOwned?: boolean;
  ownerName?: string;
  ownerNames?: string[];
  mailingAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };

  // Sale history
  lastSaleDate?: string;
  lastSalePrice?: number;
  priorSaleDate?: string;
  priorSalePrice?: number;
  saleHistory?: Array<{
    saleDate?: string;
    salePrice?: number;
    transactionType?: string;
  }>;

  // Mortgage (current lien info)
  mortgage?: {
    lender?: string;
    loanAmount?: number;
    loanType?: string;             // CONV / FHA / VA / USDA / etc.
    interestRate?: number;
    interestRateType?: string;     // FIXED / ARM
    loanTermYears?: number;
    originationDate?: string;
    dueDate?: string;
    lienPosition?: number;         // 1 = first, 2 = second
    openLien?: boolean;
  };
  secondMortgage?: {
    lender?: string;
    loanAmount?: number;
    loanType?: string;
    interestRate?: number;
    originationDate?: string;
  };

  // HOA
  hoaFee?: number;

  // Optional: full raw response passthrough for storage in JSON fields
  _raw?: Record<string, unknown>;
}

export interface ReapiComp {
  id?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;

  // Sale data
  lastSalePrice?: number;
  lastSaleDate?: string;

  // Physical
  bedrooms?: number;
  bathrooms?: number;
  squareFeet?: number;
  lotSquareFeet?: number;
  yearBuilt?: number;
  propertyType?: string;

  // Features
  hasPool?: boolean;
  hasGarage?: boolean;

  // Distance & scoring (from comps endpoint)
  distance?: number;               // miles
  daysOnMarket?: number;
  pricePerSquareFoot?: number;
  similarityScore?: number;        // 0-100 if provided

  // Passthrough
  sourceUrl?: string;
}

export interface ReapiPropertyDetailResponse {
  data?: ReapiProperty | ReapiProperty[];
  property?: ReapiProperty;
  // REAPI may also return top-level fields directly:
  [key: string]: unknown;
}

export interface ReapiCompsResponse {
  comps?: ReapiComp[];
  data?: ReapiComp[];
  [key: string]: unknown;
}

export interface ReapiPropGPTResponse {
  text?: string;
  response?: string;
  result?: string;
  model?: string;
  [key: string]: unknown;
}

export interface PropGPTParsed {
  text: string;
  model?: string;
  arv?: number;
  arvLow?: number;
  arvHigh?: number;
  confidence?: number;
}
