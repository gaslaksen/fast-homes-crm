import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios, { AxiosError } from 'axios';

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
}

interface RentCastComparable extends RentCastProperty {
  status?: string;          // "Sold" | "Active" | "Pending" — MUST be "Sold" to use as comp
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

      // Must have an actual recorded sale date
      if (!c.lastSaleDate) {
        this.logger.debug(`Skipping comp ${c.formattedAddress} — no lastSaleDate`);
        return false;
      }

      // Must have a sale price
      const price = c.lastSalePrice || c.price;
      if (!price || price <= 0) {
        this.logger.debug(`Skipping comp ${c.formattedAddress} — no valid price`);
        return false;
      }

      // Must be within last 12 months
      const saleDate = new Date(c.lastSaleDate);
      if (saleDate < twelveMonthsAgo) {
        this.logger.debug(`Skipping comp ${c.formattedAddress} — sold ${c.lastSaleDate} (>12 months ago)`);
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
      // Fall back to comp.price only if we have a confirmed lastSaleDate (status=Sold)
      const soldPrice = comp.lastSalePrice || comp.price || 0;

      // Use only the actual recorded sale date — never removedDate or listedDate
      const soldDate = comp.lastSaleDate;
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

    // ── Update lead with ARV ──
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        arv,
        arvConfidence: confidence,
        lastCompsDate: new Date(),
      },
    });

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
}
