// ─── Deal Search Filter & Result Types ────────────────────────────────────────

export interface DealSearchFilters {
  // Location
  state?: string;
  county?: string;
  city?: string;
  zip?: string;

  // Property characteristics
  propertyType?: string[];   // SFR, MULTI-FAMILY, CONDO, TOWNHOUSE, LAND
  bedsMin?: number;
  bedsMax?: number;
  bathsMin?: number;
  bathsMax?: number;
  sqftMin?: number;
  sqftMax?: number;
  yearBuiltMin?: number;
  yearBuiltMax?: number;
  lotSizeMin?: number;
  lotSizeMax?: number;
  stories?: number;
  hasGarage?: boolean;

  // Financial
  avmMin?: number;
  avmMax?: number;
  lastSalePriceMin?: number;
  lastSalePriceMax?: number;
  assessedValueMin?: number;
  assessedValueMax?: number;
  equityPercentMin?: number;
  equityPercentMax?: number;
  taxDelinquent?: boolean;

  // Distress & motivation indicators
  absenteeOwner?: boolean;
  preForeclosure?: boolean;
  foreclosure?: boolean;
  taxLien?: boolean;
  vacant?: boolean;
  bankruptcy?: boolean;
  probate?: boolean;
  highEquity?: boolean;        // equity > 50%
  freeClear?: boolean;         // no mortgage / 100% equity
  corporateOwned?: boolean;
  outOfStateOwner?: boolean;

  // Ownership
  ownershipYearsMin?: number;
  ownershipYearsMax?: number;
}

export interface DealSearchResult {
  attomId: string;

  // Address
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  county: string;

  // Geo
  latitude: number | null;
  longitude: number | null;

  // Property characteristics
  propertyType: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  lotSize: number | null;
  yearBuilt: number | null;
  stories: number | null;
  hasGarage: boolean;

  // Financial
  estimatedValue: number | null;   // AVM
  estimatedValueLow: number | null;
  estimatedValueHigh: number | null;
  assessedValue: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  estimatedEquity: number | null;
  equityPercent: number | null;
  annualTaxAmount: number | null;
  mortgageBalance: number | null;

  // Owner
  ownerName: string | null;
  ownerMailingAddress: string | null;
  isAbsenteeOwner: boolean;
  isOwnerOccupied: boolean;
  ownerType: string;             // 'Individual' | 'Corporate'

  // Distress
  distressFlags: string[];        // e.g. ['Pre-Foreclosure', 'Absentee Owner', 'Tax Lien']
  foreclosureStatus: string | null;

  // Condition-adjusted AVM for deal analysis
  avmPoorHigh: number | null;     // As-is value
  avmExcellentHigh: number | null; // ARV (after repair)
}

export interface DealSearchResponse {
  results: DealSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  cached: boolean;
}

export interface AddToPipelineRequest {
  attomId: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  yearBuilt?: number;
  lotSize?: number;
  latitude?: number;
  longitude?: number;
  estimatedValue?: number;
  estimatedValueLow?: number;
  estimatedValueHigh?: number;
  assessedValue?: number;
  lastSaleDate?: string;
  lastSalePrice?: number;
  ownerName?: string;
  isOwnerOccupied?: boolean;
  avmPoorHigh?: number;
  avmExcellentHigh?: number;
  annualTaxAmount?: number;
}
