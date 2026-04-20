/**
 * RealEstateAPI (REAPI) response types — derived from live v2/PropertyDetail,
 * v2/PropertySearch and v3/PropertyComps responses (2026-04-20).
 *
 * PropertyDetail returns a deeply nested object under `data`:
 *   data: {
 *     <flat top-level fields like estimatedValue, propertyType, ownerOccupied, ...>
 *     propertyInfo:  { address, bedrooms, bathrooms, buildingSquareFeet, lotSquareFeet, yearBuilt, ... }
 *     lotInfo:       { apn, subdivision, lotAcres, legalDescription, ... }
 *     ownerInfo:     { owner1FullName, ownerOccupied, mailAddress, ... }
 *     taxInfo:       { assessedValue, marketValue, taxAmount, ... }
 *     lastSale:      { saleAmount, saleDate, transactionType, ... }
 *     currentMortgages: [ { amount, lenderName, loanType, interestRate, term, ... } ]
 *     saleHistory:      [ { saleAmount, saleDate, transactionType, ... } ]
 *   }
 */

export interface ReapiAddressObject {
  address?: string;        // full formatted
  city?: string;
  county?: string;
  state?: string;
  street?: string;
  zip?: string;
  fips?: string;
  latitude?: number;       // only on some endpoints
  longitude?: number;
  label?: string;          // v2/PropertyDetail uses this for the full formatted string
}

export interface ReapiPropertyInfo {
  address?: ReapiAddressObject;
  bedrooms?: number;
  bathrooms?: number;
  partialBathrooms?: number;
  buildingSquareFeet?: number;
  livingSquareFeet?: number;
  lotSquareFeet?: number;
  yearBuilt?: number;
  stories?: number;
  roomsCount?: number;
  fireplace?: boolean;
  pool?: boolean;
  poolArea?: number;
  patio?: boolean;
  patioArea?: number | string;
  deck?: boolean;
  deckArea?: number;
  attic?: boolean;
  basementType?: string;
  basementSquareFeet?: number;
  garageType?: string;
  garageSquareFeet?: number;
  parkingSpaces?: number;
  carport?: boolean;
  heatingType?: string;
  heatingFuelType?: string;
  airConditioningAvailable?: boolean | null;
  airConditioningType?: string | null;
  construction?: string | null;
  roofConstruction?: string | null;
  roofMaterial?: string | null;
  propertyUse?: string;
  propertyUseCode?: number;
  latitude?: number;
  longitude?: number;
  unitsCount?: number;
  pricePerSquareFoot?: number;
  taxExemptionHomeownerFlag?: boolean;
}

export interface ReapiLotInfo {
  apn?: string;
  apnUnformatted?: string;
  subdivision?: string;
  lotAcres?: number | string;
  lotSquareFeet?: number;
  lotDepthFeet?: number;
  lotWidthFeet?: number;
  landUse?: string;
  legalDescription?: string;
  zoning?: string | null;
  propertyClass?: string;
  propertyUse?: string;
}

export interface ReapiOwnerInfo {
  absenteeOwner?: boolean;
  outOfStateAbsenteeOwner?: boolean;
  inStateAbsenteeOwner?: boolean;
  corporateOwned?: boolean;
  companyName?: string | null;
  equity?: number;
  mailAddress?: ReapiAddressObject;
  owner1FirstName?: string;
  owner1LastName?: string;
  owner1FullName?: string;
  owner1Type?: string;
  owner2FirstName?: string | null;
  owner2LastName?: string | null;
  owner2FullName?: string | null;
  ownerOccupied?: boolean;
  ownershipLength?: number;
}

export interface ReapiTaxInfo {
  assessedValue?: number;
  assessedLandValue?: number;
  assessedImprovementValue?: number;
  assessmentYear?: number;
  marketValue?: number;
  marketLandValue?: number;
  marketImprovementValue?: number;
  taxAmount?: string | number;
  taxDelinquentYear?: number | null;
  year?: number;
}

export interface ReapiSaleRecord {
  saleAmount?: number;
  saleDate?: string;
  recordingDate?: string;
  documentType?: string;
  documentTypeCode?: string;
  transactionType?: string;
  purchaseMethod?: string;
  armsLength?: boolean;
  buyerNames?: string;
  sellerNames?: string;
  downPayment?: number;
  ltv?: number | null;
  seqNo?: number;
}

export interface ReapiMortgageRecord {
  amount?: number;
  lenderName?: string;
  lenderType?: string;
  lenderCode?: string;
  loanType?: string;             // "Conventional" | "FHA" | "VA" | "USDA" | ...
  loanTypeCode?: string;         // "COV" | "FHA" | "VA" | "USDA" | ...
  interestRate?: number | null;
  interestRateType?: string | null;  // "Fixed" | "Adjustable" | null
  term?: string | number;        // months
  termType?: string;             // "Month" | "Year"
  documentDate?: string;
  recordingDate?: string;
  maturityDate?: string;
  assumable?: boolean;
  position?: string;             // "First" | "Second" | ...
  mortgageId?: string;
}

export interface ReapiPropertyData {
  id?: number | string;
  propertyType?: string;               // "SFR" | "CND" | "MFR" | ...
  // REAPI sometimes returns numeric fields as strings — always coerce via toNumber().
  estimatedValue?: number | string;
  estimatedEquity?: number | string;
  estimatedMortgageBalance?: number | string;
  estimatedMortgagePayment?: number;
  equity?: number;
  equityPercent?: number;
  highEquity?: boolean;
  openMortgageBalance?: number;
  lastSaleDate?: string;
  lastSalePrice?: string | number;     // often "0" in non-disclosure states
  lastUpdateDate?: string;
  floodZone?: boolean;
  floodZoneType?: string;
  floodZoneDescription?: string;
  vacant?: boolean;
  ownerOccupied?: boolean;
  absenteeOwner?: boolean;
  corporateOwned?: boolean;
  mlsActive?: boolean;
  mlsPending?: boolean;
  mlsSold?: boolean;
  mlsDaysOnMarket?: number | null;
  mlsListingPrice?: number | null;
  loanTypeCodeFirst?: string;
  loanTypeCodeSecond?: string | null;
  loanTypeCodeThird?: string | null;
  maturityDateFirst?: string | null;

  // Nested groups
  propertyInfo?: ReapiPropertyInfo;
  lotInfo?: ReapiLotInfo;
  ownerInfo?: ReapiOwnerInfo;
  taxInfo?: ReapiTaxInfo;
  lastSale?: ReapiSaleRecord;
  saleHistory?: ReapiSaleRecord[];
  currentMortgages?: ReapiMortgageRecord[];
  mortgageHistory?: ReapiMortgageRecord[];

  // Catch-all for fields we don't type
  [key: string]: unknown;
}

export interface ReapiPropertyDetailResponse {
  input?: Record<string, unknown>;
  data?: ReapiPropertyData;
  statusCode?: number;
  statusMessage?: string;
  live?: boolean;
  requestExecutionTimeMS?: string;
}

/**
 * v3/PropertyComps response. Comps are returned at top level under `comps`,
 * along with `subject` (the target property) and REAPI's AVM (`reapiAvm`).
 */
export interface ReapiComp {
  id?: string;
  distance?: number;              // miles
  address?: ReapiAddressObject;
  latitude?: number;
  longitude?: number;
  bedrooms?: number;
  bathrooms?: number;
  yearBuilt?: string | number;
  squareFeet?: string | number;   // REAPI returns these as strings in v3 comps
  lotSquareFeet?: string | number;
  propertyType?: string;
  apn?: string;
  fips?: string;
  landUse?: string;

  // Sale / valuation — lastSaleAmount is "0" in non-disclosure states
  lastSaleAmount?: string | number;
  lastSaleDate?: string;
  estimatedValue?: string | number;
  estimatedEquity?: string | number;
  taxAssessedValue?: number;
  taxAmount?: string | number;

  // Features
  garageAvailable?: boolean;
  airConditioningAvailable?: boolean;
  pool?: boolean;

  // MLS
  mlsListingDate?: string | null;
  mlsLastStatusDate?: string | null;
  mlsSoldPrice?: number | null;
  mlsListingPrice?: number | null;

  age?: number;

  // Catch-all
  [key: string]: unknown;
}

export interface ReapiPropertyCompsResponse {
  live?: boolean;
  input?: Record<string, unknown>;
  subject?: ReapiPropertyData;
  comps?: ReapiComp[];
  // REAPI occasionally returns these as strings ("92133.00") despite them being
  // numeric — always coerce via toNumber() before using in math or persisting.
  reapiAvm?: number | string;
  reapiAvmLow?: number | string;
  reapiAvmHigh?: number | string;
  warning?: string;
  recordCount?: number;
  statusCode?: number;
  statusMessage?: string;
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
