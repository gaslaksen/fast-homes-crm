// ─── RentCast Full Analysis Pipeline Types ──────────────────────────────────
//
// These interfaces support the analyzeProperty() orchestrator and its sub-methods:
// getSoldComps(), getRentEstimate(), getActiveSaleListings(), getMarketStatistics()

// ─── Rent Estimate Response (/avm/rent/long-term) ───────────────────────────

export interface RentCastRentEstimate {
  rent: number;
  rentRangeLow: number;
  rentRangeHigh: number;
  subjectProperty?: Record<string, any>;
  comparables?: RentCastRentalComp[];
}

export interface RentCastRentalComp {
  id?: string;
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  latitude?: number;
  longitude?: number;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number;
  yearBuilt?: number;
  status?: string;
  price?: number; // Listed rent, not sale price
  listingType?: string;
  listedDate?: string;
  removedDate?: string | null;
  lastSeenDate?: string;
  daysOnMarket?: number;
  distance?: number;
  daysOld?: number;
  correlation?: number;
}

// ─── Active Sale Listing Response (/listings/sale) ──────────────────────────

export interface RentCastSaleListing {
  id?: string;
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  latitude?: number;
  longitude?: number;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number;
  yearBuilt?: number;
  hoa?: { fee?: number };
  status?: string;
  price?: number;
  listingType?: string;
  listedDate?: string;
  removedDate?: string | null;
  createdDate?: string;
  lastSeenDate?: string;
  daysOnMarket?: number;
  mlsName?: string;
  mlsNumber?: string;
  listingAgent?: {
    name?: string;
    phone?: string;
    email?: string;
    website?: string;
  };
  listingOffice?: {
    name?: string;
    phone?: string;
    email?: string;
    website?: string;
  };
  history?: Record<string, {
    event?: string;
    price?: number;
    listingType?: string;
    listedDate?: string;
    removedDate?: string | null;
    daysOnMarket?: number;
  }>;
}

// ─── Market Statistics Response (/statistics) ───────────────────────────────

export interface RentCastMarketStatistics {
  id?: string;
  zipCode?: string;
  saleData?: MarketStatData;
  rentalData?: MarketStatData;
}

export interface MarketStatData {
  lastUpdatedDate?: string;
  averagePrice?: number;
  medianPrice?: number;
  minPrice?: number;
  maxPrice?: number;
  averagePricePerSquareFoot?: number;
  medianPricePerSquareFoot?: number;
  averageSquareFootage?: number;
  medianSquareFootage?: number;
  averageDaysOnMarket?: number;
  medianDaysOnMarket?: number;
  newListings?: number;
  totalListings?: number;
  // Rental-specific
  averageRent?: number;
  medianRent?: number;
  minRent?: number;
  maxRent?: number;
  averageRentPerSquareFoot?: number;
  medianRentPerSquareFoot?: number;
  dataByPropertyType?: Array<{
    propertyType?: string;
    averagePrice?: number;
    medianPrice?: number;
    averagePricePerSquareFoot?: number;
    medianPricePerSquareFoot?: number;
    averageDaysOnMarket?: number;
    medianDaysOnMarket?: number;
    totalListings?: number;
    // Rental fields
    averageRent?: number;
    medianRent?: number;
  }>;
  dataByBedrooms?: Array<{
    bedrooms?: number;
    averagePrice?: number;
    medianPrice?: number;
    averagePricePerSquareFoot?: number;
    medianPricePerSquareFoot?: number;
    averageDaysOnMarket?: number;
    medianDaysOnMarket?: number;
    totalListings?: number;
    // Rental fields
    averageRent?: number;
    medianRent?: number;
  }>;
  history?: Record<string, {
    date?: string;
    averagePrice?: number;
    medianPrice?: number;
    averagePricePerSquareFoot?: number;
    medianPricePerSquareFoot?: number;
    averageDaysOnMarket?: number;
    totalListings?: number;
    // Rental fields
    averageRent?: number;
    medianRent?: number;
  }>;
}

// ─── Scored Comp (output of comp scoring algorithm) ─────────────────────────

export interface ScoredComp {
  address: string;
  latitude: number | null;
  longitude: number | null;
  lastSaleDate: string;
  lastSalePrice: number;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFootage: number | null;
  lotSize: number | null;
  yearBuilt: number | null;
  propertyType: string | null;
  distanceMiles: number;
  daysSinceSale: number;
  hasPool: boolean;
  hasGarage: boolean;
  // 5-dimension scoring breakdown
  sqftScore: number;        // max 30
  bedroomScore: number;     // max 20
  bathroomScore: number;    // max 15
  proximityScore: number;   // max 20
  recencyScore: number;     // max 15
  totalScore: number;       // max 100
}

// ─── AVM Sanity Check ───────────────────────────────────────────────────────

export interface AVMSanityCheck {
  avmEstimate: number;
  avmRangeLow: number;
  avmRangeHigh: number;
  divergencePercent: number;
  needsReview: boolean;
  recommendation: string;
}

// ─── Market Strength (aggregated from active listings) ──────────────────────

export interface MarketStrength {
  activeInventory: number;
  medianAskingPrice: number;
  avgDaysOnMarket: number;
  foreclosureShare: number;
  marketHeat: 'hot' | 'balanced' | 'soft';
  activeListings: Array<{
    address: string;
    price: number;
    daysOnMarket: number;
    listingType: string;
    listingAgent?: { name: string; phone: string } | null;
  }>;
}

// ─── Rental Analysis ────────────────────────────────────────────────────────

export interface RentalAnalysis {
  rentEstimate: number;
  rentRangeLow: number;
  rentRangeHigh: number;
  rentalComps: Array<{
    address: string;
    rent: number;
    bedrooms: number | null;
    bathrooms: number | null;
    squareFootage: number | null;
    distance: number | null;
    correlation: number | null;
    status: string | null;
  }>;
}

// ─── Market Trends (derived from /statistics) ───────────────────────────────

export interface MarketTrends {
  zipCode: string;
  saleData: {
    medianPrice: number | null;
    medianPricePerSqft: number | null;
    avgDaysOnMarket: number | null;
    totalListings: number | null;
    propertyTypeMedianPrice: number | null;
    propertyTypeMedianPPSF: number | null;
    bedroomMedianPrice: number | null;
    bedroomMedianPPSF: number | null;
  };
  rentalData: {
    medianRent: number | null;
    avgDaysOnMarket: number | null;
    totalListings: number | null;
    bedroomMedianRent: number | null;
  };
  priceHistory: Array<{ date: string; medianPrice: number }>;
  rentHistory: Array<{ date: string; medianRent: number }>;
}

// ─── Full Analysis Payload (output of analyzeProperty()) ────────────────────

export interface DealcoreAnalysisPayload {
  provider: 'rentcast';

  subject: {
    address: string;
    propertyType: string | null;
    bedrooms: number | null;
    bathrooms: number | null;
    squareFootage: number | null;
    lotSize: number | null;
    yearBuilt: number | null;
    features: Record<string, any> | null;
    taxAssessments: Record<string, any> | null;
    propertyTaxes: Record<string, any> | null;
    lastSaleDate: string | null;
    lastSalePrice: number | null;
    saleHistory: Record<string, { event: string; date: string; price: number }> | null;
    owner: {
      names: string[];
      type: string | null;
      mailingAddress: any;
    } | null;
    ownerOccupied: boolean | null;
    hoa?: { fee?: number } | null;
    latitude: number | null;
    longitude: number | null;
  };

  compAnalysis: {
    soldComps: ScoredComp[];
    calculatedARV: number;
    arvPerSqft: number | null;
    arvConfidence: number;
    compCount: number;
    methodology: 'sold-comp-analysis' | 'avm-fallback';
  };

  avmCheck: AVMSanityCheck | null;

  rental: RentalAnalysis | null;

  marketStrength: MarketStrength | null;

  marketTrends: MarketTrends | null;

  deal: {
    arv: number;
    maoAt70: number;
    methodology: string;
  };
}
