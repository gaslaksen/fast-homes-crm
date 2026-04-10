import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios, { AxiosError } from 'axios';
import {
  RentCastRentEstimate,
  RentCastSaleListing,
  RentCastMarketStatistics,
  ScoredComp,
  AVMSanityCheck,
  MarketStrength,
  RentalAnalysis,
  MarketTrends,
  DealcoreAnalysisPayload,
} from './rentcast.types';

const RENTCAST_BASE_URL = 'https://api.rentcast.io/v1';
const CACHE_TTL_HOURS = 24;

// ─── RentCast Response Types ─────────────────────────────────────────────────

interface RentCastProperty {
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
  lastSaleDate?: string;
  lastSalePrice?: number;
  hoa?: { fee?: number };
  features?: {
    architectureType?: string;
    cooling?: boolean;
    coolingType?: string;
    heating?: boolean;
    heatingType?: string;
    garage?: boolean;
    garageSpaces?: number;
    garageType?: string;
    pool?: boolean;
    poolType?: string;
    fireplace?: boolean;
  };
  taxAssessments?: Record<string, { value?: number; land?: number; improvements?: number }>;
  ownerOccupied?: boolean;
  ownerName?: string;
  ownerNames?: string[];
  legalDescription?: string;
  county?: string;
  apn?: string;
  subdivision?: string;
  zoning?: string;
  status?: string;
}

interface RentCastComparable extends RentCastProperty {
  price?: number;           // Listing price or AVM estimate — NOT necessarily the sale price
  listingType?: string;
  listedDate?: string;      // When listed — NOT a sale date
  removedDate?: string;     // When removed from MLS — NOT a sale date (could be cancelled/expired)
  lastSeenDate?: string;
  daysOnMarket?: number;
  distance?: number;
  daysOld?: number;
  correlation?: number;
  // Inherited from RentCastProperty (the real sale data from public records):
  // lastSaleDate?: string   — ACTUAL recorded sale date — use this for soldDate
  // lastSalePrice?: number  — ACTUAL recorded sale price — use this for soldPrice
}

interface RentCastAVMResponse {
  price?: number;
  priceRangeLow?: number;
  priceRangeHigh?: number;
  subjectProperty?: RentCastProperty;
  comparables?: RentCastComparable[];
}

interface RentCastError {
  message?: string;
  statusCode?: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class RentCastService {
  private readonly logger = new Logger(RentCastService.name);
  private readonly apiKey: string | undefined;

  // 7-day in-memory cache for market statistics by zip code
  private marketStatsCache = new Map<string, { data: RentCastMarketStatistics; fetchedAt: number }>();
  private readonly MARKET_STATS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('RENTCAST_API_KEY');
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  // ─── Core API Methods ──────────────────────────────────────────────────────

  /**
   * Fetch property details from RentCast.
   * Tries the address as-is first, then retries with common variations
   * (County Road ↔ CR, Co Rd, etc.) if no results are found.
   */
  async getPropertyDetails(address: string): Promise<RentCastProperty | null> {
    if (!this.apiKey) {
      this.logger.warn('RentCast API key not configured — skipping property details lookup');
      return null;
    }

    this.logger.log(`Fetching RentCast property details for: ${address}`);
    this.logger.debug(`Using API key: ${this.apiKey.substring(0, 10)}...`);

    // Try the original address first, then variations
    const addresses = [address, ...this.getAddressVariations(address)];

    for (const addr of addresses) {
      try {
        const response = await axios.get<RentCastProperty[]>(`${RENTCAST_BASE_URL}/properties`, {
          params: { address: addr },
          headers: { 'X-Api-Key': this.apiKey },
          timeout: 15000,
        });

        this.logger.log(`RentCast response for "${addr}": status=${response.status}, results=${response.data?.length ?? 0}`);

        if (response.data && response.data.length > 0) {
          const p = response.data[0];
          this.logger.log(
            `RentCast property found: ${p.bedrooms ?? '?'}bd/${p.bathrooms ?? '?'}ba, ` +
            `${p.squareFootage ?? '?'} sqft, built ${p.yearBuilt ?? '?'}, type=${p.propertyType ?? '?'}`,
          );
          if (addr !== address) {
            this.logger.log(`Found via address variation: "${addr}"`);
          }
          return p;
        }
      } catch (error) {
        this.handleApiError(error, 'getPropertyDetails');
        // Don't retry variations on auth/rate-limit errors
        if (error instanceof AxiosError && (error.response?.status === 401 || error.response?.status === 429)) {
          return null;
        }
      }
    }

    this.logger.warn(`RentCast returned 0 results for all variations of: ${address}`);
    return null;
  }

  /**
   * Generate common address format variations for county roads, etc.
   */
  private getAddressVariations(address: string): string[] {
    const variations: string[] = [];

    // County Road variations
    if (/County Road/i.test(address)) {
      variations.push(address.replace(/County Road/gi, 'CR'));
      variations.push(address.replace(/County Road/gi, 'Co Rd'));
    } else if (/\bCR\b/i.test(address)) {
      variations.push(address.replace(/\bCR\b/gi, 'County Road'));
      variations.push(address.replace(/\bCR\b/gi, 'Co Rd'));
    } else if (/Co Rd/i.test(address)) {
      variations.push(address.replace(/Co Rd/gi, 'County Road'));
      variations.push(address.replace(/Co Rd/gi, 'CR'));
    }

    // State Route / State Road variations
    if (/State Road/i.test(address)) {
      variations.push(address.replace(/State Road/gi, 'SR'));
      variations.push(address.replace(/State Road/gi, 'State Rte'));
    } else if (/\bSR\b/.test(address)) {
      variations.push(address.replace(/\bSR\b/g, 'State Road'));
    }

    // Strip unit/apt numbers that might confuse lookup
    if (/\s+#\w+/.test(address)) {
      variations.push(address.replace(/\s+#\w+/, ''));
    }
    if (/\s+(?:Apt|Unit|Ste)\s+\w+/i.test(address)) {
      variations.push(address.replace(/\s+(?:Apt|Unit|Ste)\s+\w+/i, ''));
    }

    // Deduplicate and remove the original
    return [...new Set(variations)].filter((v) => v !== address);
  }

  /**
   * Fetch ARV estimate + comparable sales from RentCast AVM endpoint
   * This is the primary endpoint — returns value estimate AND comps in one call.
   */
  async getValueWithComps(
    address: string,
    options?: {
      propertyType?: string;
      bedrooms?: number;
      bathrooms?: number;
      squareFootage?: number;
      maxRadius?: number;
      compCount?: number;
    },
  ): Promise<RentCastAVMResponse | null> {
    if (!this.apiKey) return null;

    this.logger.log(`Fetching RentCast AVM + comps for: ${address}`);

    const params: Record<string, any> = {
      address,
      compCount: options?.compCount || 15,
    };
    if (options?.propertyType) params.propertyType = options.propertyType;
    if (options?.bedrooms) params.bedrooms = options.bedrooms;
    if (options?.bathrooms) params.bathrooms = options.bathrooms;
    if (options?.squareFootage) params.squareFootage = options.squareFootage;
    if (options?.maxRadius) params.maxRadius = options.maxRadius;

    try {
      const response = await axios.get<RentCastAVMResponse>(`${RENTCAST_BASE_URL}/avm/value`, {
        params,
        headers: { 'X-Api-Key': this.apiKey },
        timeout: 20000,
      });

      const data = response.data;
      this.logger.log(
        `RentCast AVM estimate: $${data.price?.toLocaleString() || '?'}, ` +
        `${data.comparables?.length || 0} comparables returned`,
      );
      return data;
    } catch (error) {
      this.handleApiError(error, 'getValueWithComps');
      return null;
    }
  }

  /**
   * Check RentCast /listings/sale for an active MLS listing at this address.
   *
   * RentCast's listing endpoint returns structured data (status, price, mlsName,
   * mlsNumber, listedDate) and returns 404 when the property is not listed — no
   * text-parsing or heuristics required.
   *
   * Returns null when the API key is not configured or an unexpected error occurs.
   */
  async checkListingStatus(
    address: string,
    city: string,
    state: string,
    zip?: string,
  ): Promise<{
    isListed: boolean;
    listingStatus: 'active' | 'pending' | 'not_listed';
    listPrice?: number;
    daysOnMarket?: number;
    mlsName?: string;
    mlsNumber?: string;
    listedDate?: string;
  } | null> {
    if (!this.apiKey) return null;

    // Build the full address string RentCast expects
    const fullAddress = zip
      ? `${address}, ${city}, ${state} ${zip}`
      : `${address}, ${city}, ${state}`;

    this.logger.log(`RentCast listing check for: ${fullAddress}`);

    try {
      const response = await axios.get<any[]>(`${RENTCAST_BASE_URL}/listings/sale`, {
        params: { address: fullAddress, status: 'Active', limit: 1 },
        headers: { 'X-Api-Key': this.apiKey },
        timeout: 12000,
      });

      const listings = response.data || [];
      if (listings.length === 0) {
        this.logger.log(`RentCast listing check: no active listing for ${fullAddress}`);
        return { isListed: false, listingStatus: 'not_listed' };
      }

      const listing = listings[0];
      const status = (listing.status || '').toLowerCase();
      const isPending = status === 'pending';

      this.logger.log(
        `RentCast listing check: ACTIVE listing found for ${fullAddress} — ` +
        `$${listing.price?.toLocaleString() ?? '?'}, MLS: ${listing.mlsName ?? '?'} #${listing.mlsNumber ?? '?'}, ` +
        `${listing.daysOnMarket ?? '?'} DOM`,
      );

      return {
        isListed: true,
        listingStatus: isPending ? 'pending' : 'active',
        listPrice: listing.price,
        daysOnMarket: listing.daysOnMarket,
        mlsName: listing.mlsName,
        mlsNumber: listing.mlsNumber,
        listedDate: listing.listedDate,
      };
    } catch (error) {
      if (error instanceof AxiosError) {
        const status = error.response?.status;
        if (status === 404) {
          // 404 = definitively not listed
          this.logger.log(`RentCast listing check: 404 — not listed (${fullAddress})`);
          return { isListed: false, listingStatus: 'not_listed' };
        }
        if (status === 429) {
          this.logger.warn(`RentCast listing check: rate limited — skipping`);
          return null;
        }
        if (status === 401) {
          this.logger.error(`RentCast listing check: invalid API key`);
          return null;
        }
        this.logger.warn(`RentCast listing check failed (${status}): ${error.message}`);
      } else {
        this.logger.warn(`RentCast listing check error: ${error}`);
      }
      return null;
    }
  }

  /**
   * Search for recently sold properties (uses /properties endpoint with saleDateRange)
   */
  async searchSoldProperties(
    address: {
      city: string;
      state: string;
      zipCode?: string;
    },
    options?: {
      bedrooms?: number;
      bathrooms?: number;
      propertyType?: string;
      saleDateRange?: number; // days
      limit?: number;
    },
  ): Promise<RentCastProperty[]> {
    if (!this.apiKey) return [];

    const params: Record<string, any> = {
      city: address.city,
      state: address.state,
      saleDateRange: options?.saleDateRange || 365,
      limit: options?.limit || 20,
    };
    if (address.zipCode) params.zipCode = address.zipCode;
    if (options?.bedrooms) params.bedrooms = options.bedrooms;
    if (options?.bathrooms) params.bathrooms = options.bathrooms;
    if (options?.propertyType) params.propertyType = options.propertyType;

    try {
      const response = await axios.get<RentCastProperty[]>(`${RENTCAST_BASE_URL}/properties`, {
        params,
        headers: { 'X-Api-Key': this.apiKey },
        timeout: 15000,
      });
      return response.data || [];
    } catch (error) {
      this.handleApiError(error, 'searchSoldProperties');
      return [];
    }
  }

  // ─── Integrated Fetch: AVM + Comps → Save to DB ───────────────────────────

  /**
   * Full pipeline: fetch AVM + comps from RentCast, save to DB, update lead.
   * Uses 24h caching to reduce API calls.
   */
  async fetchAndSaveComps(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
    options?: {
      forceRefresh?: boolean;
      maxRadius?: number;
      compCount?: number;
    },
  ): Promise<{
    arv: number;
    arvLow: number;
    arvHigh: number;
    confidence: number;
    compsCount: number;
    source: string;
  }> {
    // ── Check cache: if comps < 24h old, return cached ──
    if (!options?.forceRefresh) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        select: { arv: true, arvConfidence: true, lastCompsDate: true },
      });
      if (lead?.lastCompsDate) {
        const hoursSince = (Date.now() - lead.lastCompsDate.getTime()) / (1000 * 60 * 60);
        if (hoursSince < CACHE_TTL_HOURS && lead.arv) {
          const existingComps = await this.prisma.comp.count({
            where: { leadId, source: 'rentcast' },
          });
          if (existingComps > 0) {
            this.logger.log(`Using cached RentCast comps for lead ${leadId} (${hoursSince.toFixed(1)}h old)`);
            return {
              arv: lead.arv,
              arvLow: lead.arv * 0.95,
              arvHigh: lead.arv * 1.05,
              confidence: lead.arvConfidence || 75,
              compsCount: existingComps,
              source: 'rentcast (cached)',
            };
          }
        }
      }
    }

    // ── Get lead details for search params ──
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        bedrooms: true,
        bathrooms: true,
        sqft: true,
        propertyType: true,
        askingPrice: true,
      },
    });

    const fullAddress = `${address.street}, ${address.city}, ${address.state} ${address.zip}`;

    // ── Call RentCast AVM endpoint (with radius fallback for rural areas) ──
    const radiusProgression = options?.maxRadius ? [options.maxRadius] : [1, 5, 15, 25];
    let avmResult: RentCastAVMResponse | null = null;
    let usedRadius = radiusProgression[0];

    for (const radius of radiusProgression) {
      this.logger.log(`Trying RentCast AVM with radius=${radius}mi for: ${fullAddress}`);
      avmResult = await this.getValueWithComps(fullAddress, {
        propertyType: this.mapPropertyType(lead?.propertyType),
        bedrooms: lead?.bedrooms || undefined,
        bathrooms: lead?.bathrooms || undefined,
        squareFootage: lead?.sqft || undefined,
        maxRadius: radius,
        compCount: options?.compCount || 15,
      });
      if (avmResult?.price) {
        usedRadius = radius;
        if (radius > 1) this.logger.log(`RentCast found comps at radius=${radius}mi (rural/sparse area)`);
        break;
      }
    }

    if (!avmResult || !avmResult.price) {
      throw new Error('RentCast API returned no valuation data');
    }

    const arv = avmResult.price;
    const arvLow = avmResult.priceRangeLow || arv * 0.95;
    const arvHigh = avmResult.priceRangeHigh || arv * 1.05;
    const comps = avmResult.comparables || [];

    // ── Get subject property lat/long for distance calculation + map ──
    const subjectLat = avmResult.subjectProperty?.latitude;
    const subjectLon = avmResult.subjectProperty?.longitude;

    // Save subject property coordinates to Lead for map display
    if (subjectLat && subjectLon) {
      await this.prisma.lead.update({
        where: { id: leadId },
        data: { latitude: subjectLat, longitude: subjectLon },
      });
    }

    // ── Filter comps: must be sold, have sale date/price, within 12 months, deduplicated ──
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

    const seenAddresses = new Set<string>();
    const validComps = comps.filter((c) => {
      // Status check: RentCast uses "Sold" or "Inactive" for closed sales, "Active"/"Pending" for live listings.
      // "Inactive" = listing removed from market (most commonly because it sold — verify via lastSaleDate below).
      // Accept: "Sold", "Inactive" (with lastSaleDate), or missing status.
      // Reject: "Active", "Pending" — these are not closed sales.
      const status = (c.status || '').toLowerCase();
      if (status === 'active' || status === 'pending') {
        this.logger.debug(`Skipping comp ${c.formattedAddress} — status="${c.status}" (not a closed sale)`);
        return false;
      }

      // Must have a usable sale date.
      // RentCast AVM comparables often lack lastSaleDate on the comparable object itself.
      // For Inactive comps, removedDate (when listing was pulled from MLS) is an acceptable proxy.
      // For Sold comps, prefer lastSaleDate, fall back to removedDate.
      const effectiveDate = c.lastSaleDate || (status === 'inactive' || status === 'sold' ? c.removedDate : null);
      if (!effectiveDate) {
        this.logger.debug(`Skipping comp ${c.formattedAddress} — no usable sale date`);
        return false;
      }
      // Attach effective date so we can use it below
      (c as any)._effectiveDate = effectiveDate;

      // Must have a sale price
      const price = c.lastSalePrice || c.price;
      if (!price || price <= 0) {
        this.logger.debug(`Skipping comp ${c.formattedAddress} — no valid price`);
        return false;
      }

      // Must be within last 12 months
      const saleDate = new Date((c as any)._effectiveDate);
      if (saleDate < twelveMonthsAgo) {
        this.logger.debug(`Skipping comp ${c.formattedAddress} — date ${(c as any)._effectiveDate} (>12 months ago)`);
        return false;
      }

      // Deduplicate by address
      const addrKey = (c.formattedAddress || c.addressLine1 || '').toLowerCase().trim();
      if (addrKey && seenAddresses.has(addrKey)) {
        this.logger.debug(`Skipping duplicate comp: ${c.formattedAddress}`);
        return false;
      }
      if (addrKey) seenAddresses.add(addrKey);

      return true;
    });

    const skippedCount = comps.length - validComps.length;
    this.logger.log(
      `RentCast comp filtering: ${comps.length} raw → ${validComps.length} valid (${skippedCount} skipped — non-sold, no date, too old, or duplicate)`,
    );

    this.logger.log(
      `RentCast ARV: $${arv.toLocaleString()} (range: $${arvLow.toLocaleString()} - $${arvHigh.toLocaleString()})`,
    );

    // ── Clear old RentCast comps for this lead (keep manual/analysis comps) ──
    await this.prisma.comp.deleteMany({
      where: { leadId, source: 'rentcast', analysisId: null },
    });

    // ── Save new comps ──
    let savedCount = 0;
    for (const comp of validComps) {
      // Use actual recorded sale price — lastSalePrice is from public records
      // Fall back to comp.price (listing/AVM price) when lastSalePrice is absent
      const soldPrice = comp.lastSalePrice || comp.price || 0;

      // Use the effective date resolved during filtering (lastSaleDate preferred, removedDate fallback for Inactive)
      const soldDate = (comp as any)._effectiveDate || comp.lastSaleDate;
      if (!soldDate || soldPrice <= 0) continue; // double-safety check

      // Calculate distance
      let distance = comp.distance || 0;
      if (!distance && subjectLat && subjectLon && comp.latitude && comp.longitude) {
        distance = this.haversineDistance(subjectLat, subjectLon, comp.latitude, comp.longitude);
      }

      const compAddress = comp.formattedAddress || comp.addressLine1 || 'Unknown';

      // Build feature notes
      const featureNotes: string[] = [];
      if (comp.status && comp.status.toLowerCase() !== 'sold') {
        featureNotes.push(`Status: ${comp.status}`); // shouldn't reach here after filter, but safety
      }
      if (comp.features?.pool) featureNotes.push('Has pool');
      if (comp.features?.garage) featureNotes.push(`Garage (${comp.features.garageSpaces || '?'} spaces)`);
      if (comp.features?.fireplace) featureNotes.push('Fireplace');
      if (comp.correlation) featureNotes.push(`${(comp.correlation * 100).toFixed(0)}% correlation`);

      // Size comparison with subject
      if (lead?.sqft && comp.squareFootage) {
        const pctDiff = Math.round(((comp.squareFootage - lead.sqft) / lead.sqft) * 100);
        if (Math.abs(pctDiff) > 5) {
          featureNotes.push(`${Math.abs(pctDiff)}% ${pctDiff > 0 ? 'larger' : 'smaller'} than subject`);
        }
      }

      // Calculate similarity score
      const similarity = this.calculateSimilarityScore(
        { bedrooms: lead?.bedrooms, bathrooms: lead?.bathrooms, sqft: lead?.sqft, propertyType: lead?.propertyType },
        { bedrooms: comp.bedrooms, bathrooms: comp.bathrooms, sqft: comp.squareFootage, propertyType: comp.propertyType },
      );

      await this.prisma.comp.create({
        data: {
          leadId,
          address: compAddress,
          distance: Math.round(distance * 100) / 100,
          soldPrice,
          soldDate: new Date(soldDate),
          daysOnMarket: comp.daysOnMarket || null,
          bedrooms: comp.bedrooms || null,
          bathrooms: comp.bathrooms || null,
          sqft: comp.squareFootage || null,
          lotSize: comp.lotSize || null,
          yearBuilt: comp.yearBuilt || null,
          hasPool: comp.features?.pool || false,
          hasGarage: comp.features?.garage || false,
          propertyType: comp.propertyType || null,
          hoaFees: comp.hoa?.fee || null,
          latitude: comp.latitude || null,
          longitude: comp.longitude || null,
          correlation: comp.correlation || null,
          source: 'rentcast',
          features: comp.features || null,
          notes: featureNotes.length > 0 ? featureNotes.join('. ') : null,
          similarityScore: similarity,
          selected: similarity >= 90,
        },
      });
      savedCount++;
    }

    this.logger.log(`Saved ${savedCount} RentCast comps to database for lead ${leadId}`);

    // ── Calculate confidence score ──
    const confidence = this.calculateConfidence(validComps, lead);

    // ── Do NOT overwrite lead.arv from RentCast comps ──
    // ARV is set by ATTOM's condition-adjusted AVM (avmExcellentHigh) or by a
    // manual comps analysis. RentCast comps are stored for reference only.
    // We still record lastCompsDate so the UI knows comps have been fetched.

    return {
      arv,
      arvLow,
      arvHigh,
      confidence,
      compsCount: savedCount,
      source: 'rentcast',
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Haversine formula: distance between two lat/long points in miles
   */
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3959; // Earth radius in miles
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Calculate confidence score (0-100) based on comp quality
   */
  private calculateConfidence(comps: RentCastComparable[], lead: any): number {
    if (comps.length === 0) return 0;

    let score = 0;

    // Number of comps (max 25)
    score += Math.min(comps.length * 5, 25);

    // Average correlation (max 25)
    const avgCorrelation = comps.reduce((s, c) => s + (c.correlation || 0.5), 0) / comps.length;
    score += Math.round(avgCorrelation * 25);

    // Average distance (max 25)
    const avgDist = comps.reduce((s, c) => s + (c.distance || 2), 0) / comps.length;
    if (avgDist <= 0.5) score += 25;
    else if (avgDist <= 1) score += 20;
    else if (avgDist <= 2) score += 15;
    else if (avgDist <= 3) score += 10;
    else score += 5;

    // Sale recency (max 25)
    const avgDaysOld = comps.reduce((s, c) => s + (c.daysOld || 180), 0) / comps.length;
    if (avgDaysOld <= 90) score += 25;
    else if (avgDaysOld <= 180) score += 20;
    else if (avgDaysOld <= 270) score += 15;
    else if (avgDaysOld <= 365) score += 10;
    else score += 5;

    return Math.min(score, 100);
  }

  /**
   * Map our propertyType strings to RentCast's expected values
   */
  private mapPropertyType(type?: string | null): string | undefined {
    if (!type) return undefined;
    const map: Record<string, string> = {
      'single_family': 'Single Family',
      'single family': 'Single Family',
      'townhouse': 'Townhouse',
      'condo': 'Condo',
      'multi_family': 'Multi-Family',
      'manufactured': 'Manufactured',
    };
    return map[type.toLowerCase()] || type;
  }

  /**
   * Calculate similarity score between subject and comp (0-100)
   */
  private calculateSimilarityScore(
    subject: { bedrooms?: number | null; bathrooms?: number | null; sqft?: number | null; propertyType?: string | null },
    comp: { bedrooms?: number | null; bathrooms?: number | null; sqft?: number | null; propertyType?: string | null },
  ): number {
    let score = 0;
    let maxScore = 0;

    maxScore += 25;
    if (subject.bedrooms != null && comp.bedrooms != null) {
      const diff = Math.abs(subject.bedrooms - comp.bedrooms);
      if (diff === 0) score += 25;
      else if (diff === 1) score += 15;
      else if (diff === 2) score += 5;
    }

    maxScore += 25;
    if (subject.bathrooms != null && comp.bathrooms != null) {
      const diff = Math.abs(subject.bathrooms - comp.bathrooms);
      if (diff === 0) score += 25;
      else if (diff <= 0.5) score += 20;
      else if (diff <= 1) score += 10;
      else if (diff <= 1.5) score += 5;
    }

    maxScore += 40;
    if (subject.sqft && comp.sqft && subject.sqft > 0) {
      const pctDiff = (Math.abs(subject.sqft - comp.sqft) / subject.sqft) * 100;
      if (pctDiff <= 5) score += 40;
      else if (pctDiff <= 10) score += 35;
      else if (pctDiff <= 15) score += 25;
      else if (pctDiff <= 20) score += 15;
      else if (pctDiff <= 30) score += 5;
    }

    maxScore += 10;
    if (subject.propertyType && comp.propertyType) {
      if (subject.propertyType.toLowerCase() === comp.propertyType.toLowerCase()) score += 10;
    }

    return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  }

  /**
   * Handle API errors with friendly logging
   */
  private handleApiError(error: unknown, method: string): void {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const msg = (error.response?.data as RentCastError)?.message || error.message;

      if (status === 429) {
        this.logger.warn(`RentCast rate limit exceeded in ${method}. Try again later.`);
      } else if (status === 401) {
        this.logger.error(`RentCast API key invalid in ${method}. Check RENTCAST_API_KEY.`);
      } else if (status === 400) {
        this.logger.warn(`RentCast bad request in ${method}: ${msg}`);
      } else if (status === 404) {
        this.logger.warn(`RentCast no data found in ${method}: ${msg}`);
      } else {
        this.logger.error(`RentCast API error in ${method} (${status}): ${msg}`);
      }
    } else {
      this.logger.error(`RentCast ${method} failed:`, error);
    }
  }

  // ─── NEW: Full Property Analysis Pipeline ─────────────────────────────────

  /**
   * Score a comp against the subject property using 5-dimension weighted scoring.
   * Sqft (30%), Bedrooms (20%), Bathrooms (15%), Proximity (20%), Recency (15%)
   */
  private scoreComp(
    comp: RentCastProperty,
    subject: { squareFootage?: number | null; bedrooms?: number | null; bathrooms?: number | null; latitude?: number | null; longitude?: number | null },
    compDistance: number,
    maxRadius: number,
    daysSinceSale: number,
    saleDateRange: number,
  ): { sqftScore: number; bedroomScore: number; bathroomScore: number; proximityScore: number; recencyScore: number; totalScore: number } {
    // Sqft similarity (30 points)
    let sqftScore = 0;
    if (subject.squareFootage && comp.squareFootage && subject.squareFootage > 0) {
      sqftScore = Math.max(0, (1 - Math.abs(comp.squareFootage - subject.squareFootage) / subject.squareFootage) * 30);
    }

    // Bedroom match (20 points)
    let bedroomScore = 0;
    if (subject.bedrooms != null && comp.bedrooms != null) {
      const diff = Math.abs(subject.bedrooms - comp.bedrooms);
      if (diff === 0) bedroomScore = 20;
      else if (diff === 1) bedroomScore = 12;
    }

    // Bathroom match (15 points)
    let bathroomScore = 0;
    if (subject.bathrooms != null && comp.bathrooms != null) {
      const diff = Math.abs(subject.bathrooms - comp.bathrooms);
      if (diff === 0) bathroomScore = 15;
      else if (diff <= 1) bathroomScore = 8;
    }

    // Proximity (20 points)
    const proximityScore = maxRadius > 0
      ? Math.max(0, (1 - compDistance / maxRadius) * 20)
      : 0;

    // Recency (15 points)
    const recencyScore = saleDateRange > 0
      ? Math.max(0, (1 - daysSinceSale / saleDateRange) * 15)
      : 0;

    const totalScore = Math.round((sqftScore + bedroomScore + bathroomScore + proximityScore + recencyScore) * 100) / 100;

    return {
      sqftScore: Math.round(sqftScore * 100) / 100,
      bedroomScore,
      bathroomScore,
      proximityScore: Math.round(proximityScore * 100) / 100,
      recencyScore: Math.round(recencyScore * 100) / 100,
      totalScore,
    };
  }

  /**
   * Get sold comps using /properties endpoint with saleDateRange.
   * Returns deed-confirmed sales from public records (NOT listing-based AVM comps).
   * Implements 3-tier fallback widening if insufficient comps are found.
   */
  async getSoldComps(
    address: string,
    subject: {
      propertyType?: string | null;
      bedrooms?: number | null;
      bathrooms?: number | null;
      squareFootage?: number | null;
      latitude?: number | null;
      longitude?: number | null;
    },
    options?: { radius?: number; saleDateRange?: number; limit?: number },
  ): Promise<{
    comps: ScoredComp[];
    calculatedARV: number;
    arvPerSqft: number | null;
    arvConfidence: number;
    compCount: number;
    methodology: 'sold-comp-analysis' | 'avm-fallback';
    searchRadius: number;
    searchDateRange: number;
  }> {
    if (!this.apiKey) {
      return { comps: [], calculatedARV: 0, arvPerSqft: null, arvConfidence: 0, compCount: 0, methodology: 'avm-fallback', searchRadius: 0, searchDateRange: 0 };
    }

    const minComps = 5;
    const propType = this.mapPropertyType(subject.propertyType);

    // 3-tier widening: narrow → medium → wide
    const tiers = [
      {
        radius: options?.radius || 3,
        saleDateRange: options?.saleDateRange || 180,
        bedrooms: subject.bedrooms != null ? `${Math.max(1, subject.bedrooms - 1)}:${subject.bedrooms + 1}` : undefined,
        bathrooms: subject.bathrooms != null ? `${Math.max(1, subject.bathrooms - 1)}:${subject.bathrooms + 1}` : undefined,
        squareFootage: subject.squareFootage
          ? `${Math.round(subject.squareFootage * 0.8)}:${Math.round(subject.squareFootage * 1.2)}`
          : undefined,
      },
      {
        radius: 5,
        saleDateRange: 270,
        bedrooms: subject.bedrooms != null ? `${Math.max(1, subject.bedrooms - 1)}:${subject.bedrooms + 1}` : undefined,
        bathrooms: undefined, // relax bath filter
        squareFootage: subject.squareFootage
          ? `${Math.round(subject.squareFootage * 0.7)}:${Math.round(subject.squareFootage * 1.3)}`
          : undefined,
      },
      {
        radius: 5,
        saleDateRange: 365,
        bedrooms: undefined, // drop all attribute filters
        bathrooms: undefined,
        squareFootage: undefined,
      },
    ];

    let rawComps: RentCastProperty[] = [];
    let usedRadius = tiers[0].radius;
    let usedDateRange = tiers[0].saleDateRange;

    for (const tier of tiers) {
      const params: Record<string, any> = {
        address,
        radius: tier.radius,
        saleDateRange: tier.saleDateRange,
        limit: options?.limit || 25,
      };
      if (propType) params.propertyType = propType;
      if (tier.bedrooms) params.bedrooms = tier.bedrooms;
      if (tier.bathrooms) params.bathrooms = tier.bathrooms;
      if (tier.squareFootage) params.squareFootage = tier.squareFootage;

      this.logger.log(`getSoldComps tier: radius=${tier.radius}mi, dateRange=${tier.saleDateRange}d, beds=${tier.bedrooms || 'any'}, baths=${tier.bathrooms || 'any'}, sqft=${tier.squareFootage || 'any'}`);

      try {
        const response = await axios.get<RentCastProperty[]>(`${RENTCAST_BASE_URL}/properties`, {
          params,
          headers: { 'X-Api-Key': this.apiKey },
          timeout: 20000,
        });

        const results = response.data || [];
        usedRadius = tier.radius;
        usedDateRange = tier.saleDateRange;

        // Filter to only properties with actual sale data (exclude active/pending listings)
        const soldResults = results.filter(p => {
          const status = (p.status || '').toLowerCase();
          if (status === 'active' || status === 'pending') return false;
          return p.lastSaleDate && p.lastSalePrice && p.lastSalePrice > 0;
        });

        this.logger.log(`getSoldComps: ${results.length} returned, ${soldResults.length} with confirmed sale data`);

        if (soldResults.length >= minComps) {
          rawComps = soldResults;
          break;
        }

        // Keep what we have and try next tier if not enough
        if (soldResults.length > rawComps.length) {
          rawComps = soldResults;
        }
      } catch (error) {
        this.handleApiError(error, 'getSoldComps');
        if (error instanceof AxiosError && (error.response?.status === 401 || error.response?.status === 429)) {
          break; // Don't retry on auth/rate limit
        }
      }
    }

    if (rawComps.length === 0) {
      this.logger.warn('getSoldComps: no sold comps found after all tiers');
      return { comps: [], calculatedARV: 0, arvPerSqft: null, arvConfidence: 0, compCount: 0, methodology: 'avm-fallback', searchRadius: usedRadius, searchDateRange: usedDateRange };
    }

    // Filter out the subject property and non-residential properties
    const subjectAddr = address.toLowerCase().trim();
    const nonResidentialTypes = new Set([
      'commercial', 'industrial', 'office', 'retail', 'mixed use', 'mixed-use',
      'warehouse', 'hotel', 'motel', 'parking', 'agricultural', 'farm', 'ranch',
    ]);
    // Zoning codes that indicate commercial/non-residential use
    const commercialZoningPrefixes = ['c-', 'c1', 'c2', 'c3', 'cb', 'cd', 'ci', 'co', 'cr', 'cs',
      'b-', 'b1', 'b2', 'b3', 'bd', 'bg', 'i-', 'i1', 'i2', 'i3', 'id', 'ig', 'il', 'ih', 'ip',
      'm-', 'm1', 'm2', 'm3', 'mu'];

    const filteredComps = rawComps.filter(c => {
      const compAddr = (c.formattedAddress || c.addressLine1 || '').toLowerCase().trim();

      // Skip subject property
      if (compAddr === subjectAddr) return false;

      // Skip non-residential property types
      const propType = (c.propertyType || '').toLowerCase();
      if (propType && nonResidentialTypes.has(propType)) {
        this.logger.debug(`Skipping non-residential comp: ${compAddr} (type: ${c.propertyType})`);
        return false;
      }

      // Skip properties with 0 bedrooms and 0 bathrooms (likely commercial)
      if (c.bedrooms === 0 && c.bathrooms === 0) {
        this.logger.debug(`Skipping likely commercial comp (0 bed/0 bath): ${compAddr}`);
        return false;
      }

      // Skip properties with commercial zoning
      const zoning = (c.zoning || '').toLowerCase().trim();
      if (zoning && commercialZoningPrefixes.some(prefix => zoning.startsWith(prefix))) {
        this.logger.debug(`Skipping commercial-zoned comp: ${compAddr} (zoning: ${c.zoning})`);
        return false;
      }

      return true;
    });

    if (filteredComps.length < rawComps.length) {
      this.logger.log(`getSoldComps: filtered ${rawComps.length} → ${filteredComps.length} (removed subject/non-residential)`);
    }

    // Score each comp
    const now = new Date();
    const scored: ScoredComp[] = filteredComps.map(c => {
      // Calculate distance
      let dist = 0;
      if (subject.latitude && subject.longitude && c.latitude && c.longitude) {
        dist = this.haversineDistance(subject.latitude, subject.longitude, c.latitude, c.longitude);
      }

      const saleDate = new Date(c.lastSaleDate!);
      const daysSinceSale = Math.max(0, Math.floor((now.getTime() - saleDate.getTime()) / (1000 * 60 * 60 * 24)));

      const scores = this.scoreComp(c, subject, dist, usedRadius, daysSinceSale, usedDateRange);

      return {
        address: c.formattedAddress || c.addressLine1 || 'Unknown',
        latitude: c.latitude || null,
        longitude: c.longitude || null,
        lastSaleDate: c.lastSaleDate!,
        lastSalePrice: c.lastSalePrice!,
        bedrooms: c.bedrooms ?? null,
        bathrooms: c.bathrooms ?? null,
        squareFootage: c.squareFootage ?? null,
        lotSize: c.lotSize ?? null,
        yearBuilt: c.yearBuilt ?? null,
        propertyType: c.propertyType ?? null,
        distanceMiles: Math.round(dist * 100) / 100,
        daysSinceSale,
        hasPool: c.features?.pool || false,
        hasGarage: c.features?.garage || false,
        ...scores,
      };
    });

    // Sort by score descending, take top 8
    scored.sort((a, b) => b.totalScore - a.totalScore);
    const topComps = scored.slice(0, 8);

    // Calculate weighted average ARV
    const totalWeight = topComps.reduce((sum, c) => sum + c.totalScore, 0);
    const calculatedARV = totalWeight > 0
      ? Math.round(topComps.reduce((sum, c) => sum + c.lastSalePrice * c.totalScore, 0) / totalWeight)
      : Math.round(topComps.reduce((sum, c) => sum + c.lastSalePrice, 0) / topComps.length);

    // ARV per sqft
    const compsWithSqft = topComps.filter(c => c.squareFootage && c.squareFootage > 0);
    const arvPerSqft = compsWithSqft.length > 0
      ? Math.round(compsWithSqft.reduce((sum, c) => sum + c.lastSalePrice / c.squareFootage!, 0) / compsWithSqft.length)
      : null;

    // Confidence: based on comp count, score spread, and distance
    const avgScore = topComps.reduce((s, c) => s + c.totalScore, 0) / topComps.length;
    const avgDist = topComps.reduce((s, c) => s + c.distanceMiles, 0) / topComps.length;
    let confidence = Math.min(100, Math.round(
      Math.min(topComps.length * 8, 30) +           // comp count (max 30)
      Math.min(avgScore, 40) +                       // avg quality (max 40)
      (avgDist <= 1 ? 20 : avgDist <= 3 ? 15 : 10) + // proximity (max 20)
      (topComps.length >= 5 ? 10 : 5),               // data sufficiency (max 10)
    ));

    this.logger.log(
      `getSoldComps ARV: $${calculatedARV.toLocaleString()} from ${topComps.length} comps ` +
      `(${arvPerSqft ? `$${arvPerSqft}/sqft` : 'n/a $/sqft'}), confidence=${confidence}`,
    );

    return {
      comps: topComps,
      calculatedARV,
      arvPerSqft,
      arvConfidence: confidence,
      compCount: topComps.length,
      methodology: 'sold-comp-analysis',
      searchRadius: usedRadius,
      searchDateRange: usedDateRange,
    };
  }

  /**
   * Get rent estimate from RentCast /avm/rent/long-term endpoint.
   */
  async getRentEstimate(
    address: string,
    options?: { compCount?: number; maxRadius?: number; daysOld?: number },
  ): Promise<RentalAnalysis | null> {
    if (!this.apiKey) return null;

    this.logger.log(`Fetching rent estimate for: ${address}`);

    try {
      const response = await axios.get<RentCastRentEstimate>(`${RENTCAST_BASE_URL}/avm/rent/long-term`, {
        params: {
          address,
          compCount: options?.compCount || 15,
          maxRadius: options?.maxRadius || 5,
          daysOld: options?.daysOld || 270,
          lookupSubjectAttributes: true,
        },
        headers: { 'X-Api-Key': this.apiKey },
        timeout: 15000,
      });

      const data = response.data;
      if (!data?.rent) {
        this.logger.warn('RentCast rent estimate returned no data');
        return null;
      }

      this.logger.log(`Rent estimate: $${data.rent}/mo (range: $${data.rentRangeLow}-$${data.rentRangeHigh})`);

      return {
        rentEstimate: data.rent,
        rentRangeLow: data.rentRangeLow,
        rentRangeHigh: data.rentRangeHigh,
        rentalComps: (data.comparables || []).map(c => ({
          address: c.formattedAddress || c.addressLine1 || 'Unknown',
          rent: c.price || 0,
          bedrooms: c.bedrooms ?? null,
          bathrooms: c.bathrooms ?? null,
          squareFootage: c.squareFootage ?? null,
          distance: c.distance ?? null,
          correlation: c.correlation ?? null,
          status: c.status ?? null,
        })),
      };
    } catch (error) {
      this.handleApiError(error, 'getRentEstimate');
      return null;
    }
  }

  /**
   * Get active sale listings for a zip code from /listings/sale.
   * Aggregates results into a MarketStrength analysis.
   */
  async getActiveSaleListings(
    zipCode: string,
    propertyType?: string,
    limit?: number,
  ): Promise<MarketStrength | null> {
    if (!this.apiKey) return null;

    this.logger.log(`Fetching active sale listings for zip: ${zipCode}`);

    try {
      const params: Record<string, any> = {
        zipCode,
        status: 'Active',
        limit: limit || 500,
      };
      if (propertyType) params.propertyType = this.mapPropertyType(propertyType);

      const response = await axios.get<RentCastSaleListing[]>(`${RENTCAST_BASE_URL}/listings/sale`, {
        params,
        headers: { 'X-Api-Key': this.apiKey },
        timeout: 20000,
      });

      const listings = response.data || [];
      if (listings.length === 0) {
        this.logger.log(`No active listings found in zip ${zipCode}`);
        return {
          activeInventory: 0,
          medianAskingPrice: 0,
          avgDaysOnMarket: 0,
          foreclosureShare: 0,
          marketHeat: 'hot',
          activeListings: [],
        };
      }

      // Calculate median asking price
      const prices = listings.map(l => l.price || 0).filter(p => p > 0).sort((a, b) => a - b);
      const medianAskingPrice = prices.length > 0
        ? prices[Math.floor(prices.length / 2)]
        : 0;

      // Average days on market
      const doms = listings.map(l => l.daysOnMarket || 0).filter(d => d > 0);
      const avgDaysOnMarket = doms.length > 0
        ? Math.round(doms.reduce((s, d) => s + d, 0) / doms.length)
        : 0;

      // Foreclosure share
      const foreclosureCount = listings.filter(l =>
        l.listingType?.toLowerCase().includes('foreclosure') ||
        l.listingType?.toLowerCase().includes('reo') ||
        l.listingType?.toLowerCase().includes('short sale'),
      ).length;
      const foreclosureShare = listings.length > 0
        ? Math.round((foreclosureCount / listings.length) * 100) / 100
        : 0;

      // Market heat
      let marketHeat: 'hot' | 'balanced' | 'soft';
      if (listings.length < 10) marketHeat = 'hot';
      else if (listings.length <= 25) marketHeat = 'balanced';
      else marketHeat = 'soft';

      this.logger.log(
        `Active listings: ${listings.length} in zip ${zipCode}, median $${medianAskingPrice.toLocaleString()}, ` +
        `avg DOM=${avgDaysOnMarket}, heat=${marketHeat}`,
      );

      return {
        activeInventory: listings.length,
        medianAskingPrice,
        avgDaysOnMarket,
        foreclosureShare,
        marketHeat,
        activeListings: listings.slice(0, 20).map(l => ({
          address: l.formattedAddress || l.addressLine1 || 'Unknown',
          price: l.price || 0,
          daysOnMarket: l.daysOnMarket || 0,
          listingType: l.listingType || 'Standard',
          listingAgent: l.listingAgent?.name
            ? { name: l.listingAgent.name, phone: l.listingAgent.phone || '' }
            : null,
        })),
      };
    } catch (error) {
      this.handleApiError(error, 'getActiveSaleListings');
      return null;
    }
  }

  /**
   * Get market statistics for a zip code from /statistics.
   * Cached in-memory with 7-day TTL.
   */
  async getMarketStatistics(zipCode: string): Promise<RentCastMarketStatistics | null> {
    if (!this.apiKey) return null;

    // Check cache
    const cached = this.marketStatsCache.get(zipCode);
    if (cached && (Date.now() - cached.fetchedAt) < this.MARKET_STATS_TTL_MS) {
      this.logger.log(`Using cached market stats for zip ${zipCode} (${Math.round((Date.now() - cached.fetchedAt) / (1000 * 60 * 60))}h old)`);
      return cached.data;
    }

    this.logger.log(`Fetching market statistics for zip: ${zipCode}`);

    try {
      const response = await axios.get<RentCastMarketStatistics>(`${RENTCAST_BASE_URL}/statistics`, {
        params: { zipCode, dataType: 'All' },
        headers: { 'X-Api-Key': this.apiKey },
        timeout: 15000,
      });

      const data = response.data;
      if (!data) {
        this.logger.warn(`No market statistics returned for zip ${zipCode}`);
        return null;
      }

      // Cache result
      this.marketStatsCache.set(zipCode, { data, fetchedAt: Date.now() });
      this.logger.log(`Market stats cached for zip ${zipCode}: median price $${data.saleData?.medianPrice?.toLocaleString() || '?'}`);

      return data;
    } catch (error) {
      this.handleApiError(error, 'getMarketStatistics');
      return null;
    }
  }

  /**
   * Build MarketTrends from raw market statistics, filtered to the subject's
   * property type and bedroom count.
   */
  private buildMarketTrends(
    stats: RentCastMarketStatistics,
    zipCode: string,
    propertyType?: string | null,
    bedrooms?: number | null,
  ): MarketTrends {
    const sale = stats.saleData;
    const rental = stats.rentalData;

    // Find property-type-specific data
    const propTypeData = sale?.dataByPropertyType?.find(
      d => d.propertyType?.toLowerCase() === (propertyType || '').toLowerCase(),
    );
    const bedroomData = sale?.dataByBedrooms?.find(
      d => d.bedrooms === bedrooms,
    );
    const rentalBedroomData = rental?.dataByBedrooms?.find(
      d => d.bedrooms === bedrooms,
    );

    // Build price history from history records
    const priceHistory: Array<{ date: string; medianPrice: number }> = [];
    const rentHistory: Array<{ date: string; medianRent: number }> = [];

    if (sale?.history) {
      for (const [key, value] of Object.entries(sale.history)) {
        if (value.medianPrice) {
          priceHistory.push({ date: value.date || key, medianPrice: value.medianPrice });
        }
      }
    }
    if (rental?.history) {
      for (const [key, value] of Object.entries(rental.history)) {
        if (value.medianRent) {
          rentHistory.push({ date: value.date || key, medianRent: value.medianRent });
        }
      }
    }

    // Sort by date
    priceHistory.sort((a, b) => a.date.localeCompare(b.date));
    rentHistory.sort((a, b) => a.date.localeCompare(b.date));

    return {
      zipCode,
      saleData: {
        medianPrice: sale?.medianPrice ?? null,
        medianPricePerSqft: sale?.medianPricePerSquareFoot ?? null,
        avgDaysOnMarket: sale?.averageDaysOnMarket ?? null,
        totalListings: sale?.totalListings ?? null,
        propertyTypeMedianPrice: propTypeData?.medianPrice ?? null,
        propertyTypeMedianPPSF: propTypeData?.medianPricePerSquareFoot ?? null,
        bedroomMedianPrice: bedroomData?.medianPrice ?? null,
        bedroomMedianPPSF: bedroomData?.medianPricePerSquareFoot ?? null,
      },
      rentalData: {
        medianRent: rental?.medianRent ?? null,
        avgDaysOnMarket: rental?.averageDaysOnMarket ?? null,
        totalListings: rental?.totalListings ?? null,
        bedroomMedianRent: rentalBedroomData?.medianRent ?? null,
      },
      priceHistory,
      rentHistory,
    };
  }

  /**
   * ORCHESTRATOR: Full property analysis pipeline.
   * Calls all RentCast endpoints and assembles the complete DealcoreAnalysisPayload.
   *
   * Flow:
   * 1. Get subject property record (falls back to lead DB data if RentCast has no record)
   * 2. In parallel: sold comps, AVM sanity check, rent estimate, active listings, market stats
   * 3. Score comps, calculate ARV, build payload
   */
  async analyzeProperty(
    address: string,
    zipCode?: string,
    leadId?: string,
  ): Promise<DealcoreAnalysisPayload> {
    this.logger.log(`=== analyzeProperty pipeline starting for: ${address} ===`);

    // Step 1: Get subject property profile — gracefully handle missing data
    const subjectProperty = await this.getPropertyDetails(address);

    // If RentCast has no property record, try to pull subject data from the lead in DB
    let leadFallbackData: Record<string, any> | null = null;
    if (!subjectProperty && leadId) {
      this.logger.warn(`RentCast has no property record for "${address}" — using lead DB data as fallback`);
      leadFallbackData = await this.prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          propertyType: true, bedrooms: true, bathrooms: true, sqft: true,
          yearBuilt: true, lotSize: true, latitude: true, longitude: true,
          lastSaleDate: true, lastSalePrice: true, propertyZip: true,
        },
      });
    }

    const zip = zipCode || subjectProperty?.zipCode || leadFallbackData?.propertyZip;
    if (!zip) {
      throw new Error(`No zip code available for property analysis: ${address}`);
    }

    const subjectData = {
      propertyType: subjectProperty?.propertyType || leadFallbackData?.propertyType || null,
      bedrooms: subjectProperty?.bedrooms ?? leadFallbackData?.bedrooms ?? null,
      bathrooms: subjectProperty?.bathrooms ?? leadFallbackData?.bathrooms ?? null,
      squareFootage: subjectProperty?.squareFootage ?? leadFallbackData?.sqft ?? null,
      latitude: subjectProperty?.latitude ?? leadFallbackData?.latitude ?? null,
      longitude: subjectProperty?.longitude ?? leadFallbackData?.longitude ?? null,
    };

    this.logger.log(
      `Subject: ${subjectData.bedrooms ?? '?'}bd/${subjectData.bathrooms ?? '?'}ba, ` +
      `${subjectData.squareFootage ?? '?'}sqft, ${subjectData.propertyType ?? '?'}, zip=${zip}` +
      `${!subjectProperty ? ' (from lead DB fallback)' : ''}`,
    );

    // Step 2: Fire all remaining calls in parallel
    const [soldCompsResult, avmResult, rentResult, listingsResult, statsResult] = await Promise.allSettled([
      this.getSoldComps(address, subjectData),
      this.getValueWithComps(address, {
        propertyType: this.mapPropertyType(subjectData.propertyType),
        bedrooms: subjectData.bedrooms || undefined,
        bathrooms: subjectData.bathrooms || undefined,
        squareFootage: subjectData.squareFootage || undefined,
      }),
      this.getRentEstimate(address),
      this.getActiveSaleListings(zip, subjectData.propertyType || undefined),
      this.getMarketStatistics(zip),
    ]);

    // Extract results (null on failure)
    const soldComps = soldCompsResult.status === 'fulfilled' ? soldCompsResult.value : null;
    const avmData = avmResult.status === 'fulfilled' ? avmResult.value : null;
    const rental = rentResult.status === 'fulfilled' ? rentResult.value : null;
    const marketStrength = listingsResult.status === 'fulfilled' ? listingsResult.value : null;
    const marketStats = statsResult.status === 'fulfilled' ? statsResult.value : null;

    // Log any failures
    if (soldCompsResult.status === 'rejected') this.logger.warn(`getSoldComps failed: ${soldCompsResult.reason}`);
    if (avmResult.status === 'rejected') this.logger.warn(`getValueWithComps failed: ${avmResult.reason}`);
    if (rentResult.status === 'rejected') this.logger.warn(`getRentEstimate failed: ${rentResult.reason}`);
    if (listingsResult.status === 'rejected') this.logger.warn(`getActiveSaleListings failed: ${listingsResult.reason}`);
    if (statsResult.status === 'rejected') this.logger.warn(`getMarketStatistics failed: ${statsResult.reason}`);

    // Step 3: Determine ARV
    let arv: number;
    let methodology: 'sold-comp-analysis' | 'avm-fallback';
    let compAnalysisData: DealcoreAnalysisPayload['compAnalysis'];

    if (soldComps && soldComps.compCount > 0 && soldComps.calculatedARV > 0) {
      arv = soldComps.calculatedARV;
      methodology = soldComps.methodology;
      compAnalysisData = {
        soldComps: soldComps.comps,
        calculatedARV: soldComps.calculatedARV,
        arvPerSqft: soldComps.arvPerSqft,
        arvConfidence: soldComps.arvConfidence,
        compCount: soldComps.compCount,
        methodology,
      };
    } else if (avmData?.price) {
      // Fallback to AVM
      arv = avmData.price;
      methodology = 'avm-fallback';
      compAnalysisData = {
        soldComps: [],
        calculatedARV: avmData.price,
        arvPerSqft: subjectData.squareFootage ? Math.round(avmData.price / subjectData.squareFootage) : null,
        arvConfidence: 50,
        compCount: 0,
        methodology: 'avm-fallback',
      };
      this.logger.warn(`Using AVM fallback for ARV: $${arv.toLocaleString()}`);
    } else {
      throw new Error('RentCast: could not determine ARV — no sold comps and no AVM data');
    }

    // Step 4: AVM sanity check
    let avmCheck: AVMSanityCheck | null = null;
    if (avmData?.price && methodology === 'sold-comp-analysis') {
      const divergence = Math.abs(arv - avmData.price) / avmData.price;
      const divergencePercent = Math.round(divergence * 100);
      let recommendation: string;
      let needsReview: boolean;

      if (divergence <= 0.10) {
        recommendation = 'High confidence — ARV and AVM aligned';
        needsReview = false;
      } else if (divergence <= 0.15) {
        recommendation = 'Moderate — review comp selection';
        needsReview = false;
      } else {
        recommendation = 'Flag for manual review — significant divergence between comp ARV and AVM';
        needsReview = true;
      }

      avmCheck = {
        avmEstimate: avmData.price,
        avmRangeLow: avmData.priceRangeLow || Math.round(avmData.price * 0.85),
        avmRangeHigh: avmData.priceRangeHigh || Math.round(avmData.price * 1.15),
        divergencePercent,
        needsReview,
        recommendation,
      };

      this.logger.log(`AVM sanity check: divergence=${divergencePercent}% — ${recommendation}`);
    }

    // Step 5: Build market trends from statistics
    let marketTrends: MarketTrends | null = null;
    if (marketStats) {
      marketTrends = this.buildMarketTrends(marketStats, zip, subjectData.propertyType, subjectData.bedrooms);
    }

    // Step 6: Assemble subject (from RentCast property record or lead DB fallback)
    const sp = subjectProperty; // may be null
    const fb = leadFallbackData; // may be null
    const subjectPayload: DealcoreAnalysisPayload['subject'] = {
      address: sp?.formattedAddress || address,
      propertyType: sp?.propertyType ?? fb?.propertyType ?? null,
      bedrooms: sp?.bedrooms ?? fb?.bedrooms ?? null,
      bathrooms: sp?.bathrooms ?? fb?.bathrooms ?? null,
      squareFootage: sp?.squareFootage ?? fb?.sqft ?? null,
      lotSize: sp?.lotSize ?? fb?.lotSize ?? null,
      yearBuilt: sp?.yearBuilt ?? fb?.yearBuilt ?? null,
      features: sp?.features ?? null,
      taxAssessments: sp?.taxAssessments ?? null,
      propertyTaxes: (sp as any)?.propertyTaxes ?? null,
      lastSaleDate: sp?.lastSaleDate ?? fb?.lastSaleDate?.toISOString?.() ?? null,
      lastSalePrice: sp?.lastSalePrice ?? fb?.lastSalePrice ?? null,
      saleHistory: (sp as any)?.history ?? null,
      owner: (sp as any)?.owner
        ? {
            names: (sp as any).owner.names || [sp?.ownerName].filter(Boolean),
            type: (sp as any).owner.type ?? null,
            mailingAddress: (sp as any).owner.mailingAddress ?? null,
          }
        : sp?.ownerName
          ? { names: [sp.ownerName], type: null, mailingAddress: null }
          : null,
      ownerOccupied: sp?.ownerOccupied ?? null,
      hoa: sp?.hoa ?? null,
      latitude: sp?.latitude ?? fb?.latitude ?? null,
      longitude: sp?.longitude ?? fb?.longitude ?? null,
    };

    // Step 7: Assemble final payload
    const payload: DealcoreAnalysisPayload = {
      provider: 'rentcast',
      subject: subjectPayload,
      compAnalysis: compAnalysisData,
      avmCheck,
      rental,
      marketStrength,
      marketTrends,
      deal: {
        arv,
        maoAt70: Math.round(arv * 0.70),
        methodology,
      },
    };

    this.logger.log(
      `=== analyzeProperty complete: ARV=$${arv.toLocaleString()}, MAO@70%=$${payload.deal.maoAt70.toLocaleString()}, ` +
      `${compAnalysisData.compCount} comps, method=${methodology} ===`,
    );

    return payload;
  }
}
