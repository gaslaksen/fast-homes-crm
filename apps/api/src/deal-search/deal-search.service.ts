import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttomService } from '../comps/attom.service';
import { createHash } from 'crypto';
import {
  DealSearchFilters,
  DealSearchResult,
  DealSearchResponse,
  AddToPipelineRequest,
} from './deal-search.types';

const CACHE_TTL_HOURS = 48;

@Injectable()
export class DealSearchService {
  private readonly logger = new Logger(DealSearchService.name);

  constructor(
    private prisma: PrismaService,
    private attomService: AttomService,
  ) {}

  // ─── Main search ─────────────────────────────────────────────────────────

  async search(
    filters: DealSearchFilters,
    organizationId: string,
    page = 1,
    pageSize = 50,
  ): Promise<DealSearchResponse> {
    const geoIdV4 = this.buildGeoId(filters);
    if (!geoIdV4) {
      return { results: [], total: 0, page, pageSize, cached: false };
    }

    // Build ATTOM-native params for property snapshot
    const attomParams: Record<string, any> = {};
    if (filters.propertyType?.length === 1) {
      attomParams.propertytype = filters.propertyType[0];
    }
    if (filters.yearBuiltMin) attomParams.minyearbuilt = filters.yearBuiltMin;
    if (filters.yearBuiltMax) attomParams.maxyearbuilt = filters.yearBuiltMax;
    if (filters.sqftMin) attomParams.minUniversalSize = filters.sqftMin;
    if (filters.sqftMax) attomParams.maxUniversalSize = filters.sqftMax;
    if (filters.bedsMin) attomParams.minbeds = filters.bedsMin;
    if (filters.bedsMax) attomParams.maxbeds = filters.bedsMax;
    if (filters.bathsMin) attomParams.minbaths = filters.bathsMin;
    if (filters.bathsMax) attomParams.maxbaths = filters.bathsMax;

    // Check cache
    const cacheKey = this.buildCacheKey('property/snapshot', geoIdV4, attomParams);
    const cached = await this.getCachedResponse(cacheKey);

    let rawProperties: any[];
    let totalFromAttom: number;
    let wasCached = false;

    if (cached) {
      rawProperties = cached.responseData as any[];
      totalFromAttom = cached.resultCount;
      wasCached = true;
      this.logger.log(`Deal search: using cached data for ${geoIdV4} (${totalFromAttom} properties)`);
    } else {
      // Fetch from ATTOM
      const snapshotResult = await this.attomService.getPropertySnapshot(geoIdV4, {
        ...attomParams,
        pagesize: 200, // Fetch a larger batch for server-side filtering
      });

      rawProperties = snapshotResult.property;
      totalFromAttom = snapshotResult.total;

      // Optionally fetch foreclosure events if distress filters are active
      let foreclosureMap = new Map<string, any>();
      if (filters.preForeclosure || filters.foreclosure || filters.taxLien || filters.bankruptcy) {
        const now = new Date();
        const sixMonthsAgo = new Date(now);
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const fcResult = await this.attomService.getForeclosureEvents(geoIdV4, {
          startdate: sixMonthsAgo.toISOString().slice(0, 10),
          enddate: now.toISOString().slice(0, 10),
          pagesize: 200,
        });

        for (const prop of fcResult.property) {
          const attomId = String(prop?.identifier?.attomId || prop?.identifier?.Id || '');
          if (attomId) foreclosureMap.set(attomId, prop);
        }
        this.logger.log(`Deal search: ${foreclosureMap.size} foreclosure events for ${geoIdV4}`);
      }

      // Merge foreclosure data into properties
      if (foreclosureMap.size > 0) {
        for (const prop of rawProperties) {
          const attomId = String(prop?.identifier?.attomId || prop?.identifier?.Id || '');
          const fcData = foreclosureMap.get(attomId);
          if (fcData) {
            prop._foreclosureData = fcData;
          }
        }
      }

      // Cache the merged result
      await this.cacheResponse(cacheKey, 'property/snapshot', geoIdV4, attomParams, rawProperties, totalFromAttom);
    }

    // Normalize ATTOM data to DealSearchResult[]
    let results = rawProperties
      .map((prop) => this.normalizeProperty(prop))
      .filter((r): r is DealSearchResult => r !== null);

    // Apply server-side filters that ATTOM doesn't support natively
    results = this.applyClientFilters(results, filters);

    // Sort by equity percent descending (most equity first)
    results.sort((a, b) => (b.equityPercent ?? 0) - (a.equityPercent ?? 0));

    const total = results.length;

    // Paginate
    const startIdx = (page - 1) * pageSize;
    const paginatedResults = results.slice(startIdx, startIdx + pageSize);

    return {
      results: paginatedResults,
      total,
      page,
      pageSize,
      cached: wasCached,
    };
  }

  // ─── Property detail ─────────────────────────────────────────────────────

  async getPropertyDetail(
    address: { street: string; city: string; state: string; zip: string },
  ): Promise<{ profile: any; avm: any; saleHistory: any[] }> {
    const [profile, avm, history] = await Promise.allSettled([
      this.attomService.getExpandedProfile(address),
      this.attomService.getAVM(address),
      this.attomService.getSaleHistory(address),
    ]);

    return {
      profile: profile.status === 'fulfilled' ? profile.value : null,
      avm: avm.status === 'fulfilled' ? avm.value : null,
      saleHistory: history.status === 'fulfilled' ? history.value : [],
    };
  }

  // ─── Add to pipeline ─────────────────────────────────────────────────────

  async addToPipeline(
    data: AddToPipelineRequest,
    organizationId: string,
    userId: string,
  ) {
    // Parse owner name into first/last
    const nameParts = (data.ownerName || 'Unknown Owner').trim().split(/\s+/);
    const sellerFirstName = nameParts[0] || 'Unknown';
    const sellerLastName = nameParts.slice(1).join(' ') || 'Owner';

    const lead = await this.prisma.lead.create({
      data: {
        organizationId,
        source: 'DEAL_SEARCH',
        status: 'NEW',
        propertyAddress: data.propertyAddress,
        propertyCity: data.propertyCity,
        propertyState: data.propertyState,
        propertyZip: data.propertyZip,
        propertyType: data.propertyType || null,
        bedrooms: data.bedrooms || null,
        bathrooms: data.bathrooms || null,
        sqft: data.sqft || null,
        yearBuilt: data.yearBuilt || null,
        lotSize: data.lotSize || null,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        sellerFirstName,
        sellerLastName,
        sellerPhone: '',
        attomId: data.attomId,
        attomAvm: data.estimatedValue || null,
        attomAvmLow: data.estimatedValueLow || null,
        attomAvmHigh: data.estimatedValueHigh || null,
        avmPoorHigh: data.avmPoorHigh || null,
        avmExcellentHigh: data.avmExcellentHigh || null,
        taxAssessedValue: data.assessedValue || null,
        ownerOccupied: data.isOwnerOccupied ?? null,
        ownerName: data.ownerName || null,
        annualTaxAmount: data.annualTaxAmount || null,
        lastSaleDate: data.lastSaleDate ? new Date(data.lastSaleDate) : null,
        lastSalePrice: data.lastSalePrice || null,
        // Set ARV from excellent condition AVM if available
        arv: data.avmExcellentHigh ? Math.round(data.avmExcellentHigh) : (data.estimatedValue ? Math.round(data.estimatedValue) : null),
        attomEnrichedAt: new Date(),
        assignedToUserId: userId,
      },
    });

    this.logger.log(
      `Deal search: created lead ${lead.id} from ATTOM property ${data.attomId} ` +
      `(${data.propertyAddress}, ${data.propertyCity} ${data.propertyState})`,
    );

    return lead;
  }

  // ─── Saved searches CRUD ─────────────────────────────────────────────────

  async saveSearch(
    userId: string,
    organizationId: string,
    name: string,
    filters: DealSearchFilters,
  ) {
    return this.prisma.savedSearch.create({
      data: { userId, organizationId, name, filters: filters as any },
    });
  }

  async listSavedSearches(userId: string, organizationId: string) {
    return this.prisma.savedSearch.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async deleteSavedSearch(id: string, organizationId: string) {
    return this.prisma.savedSearch.delete({
      where: { id, organizationId },
    });
  }

  async updateSavedSearchLastRun(id: string, resultCount: number) {
    return this.prisma.savedSearch.update({
      where: { id },
      data: { lastRunAt: new Date(), resultCount },
    });
  }

  // ─── Export CSV ──────────────────────────────────────────────────────────

  async exportCsv(
    filters: DealSearchFilters,
    organizationId: string,
  ): Promise<string> {
    const { results } = await this.search(filters, organizationId, 1, 5000);

    const headers = [
      'Address', 'City', 'State', 'Zip', 'County',
      'Property Type', 'Beds', 'Baths', 'Sqft', 'Year Built', 'Lot Size',
      'Estimated Value', 'Assessed Value', 'Last Sale Date', 'Last Sale Price',
      'Equity %', 'Estimated Equity',
      'Owner Name', 'Absentee Owner', 'Owner Occupied',
      'Distress Flags', 'Latitude', 'Longitude',
    ];

    const rows = results.map((r) => [
      `"${r.propertyAddress}"`, `"${r.propertyCity}"`, r.propertyState, r.propertyZip, `"${r.county}"`,
      r.propertyType, r.bedrooms ?? '', r.bathrooms ?? '', r.sqft ?? '', r.yearBuilt ?? '', r.lotSize ?? '',
      r.estimatedValue ?? '', r.assessedValue ?? '', r.lastSaleDate ?? '', r.lastSalePrice ?? '',
      r.equityPercent != null ? `${r.equityPercent.toFixed(1)}%` : '', r.estimatedEquity ?? '',
      `"${r.ownerName ?? ''}"`, r.isAbsenteeOwner ? 'Yes' : 'No', r.isOwnerOccupied ? 'Yes' : 'No',
      `"${r.distressFlags.join(', ')}"`, r.latitude ?? '', r.longitude ?? '',
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  // ─── Skip trace stub ────────────────────────────────────────────────────

  async skipTrace(_attomId: string) {
    return {
      success: false,
      message: 'Skip trace integration coming soon. Connect BatchSkipTracing, REISkip, or similar provider.',
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private buildGeoId(filters: DealSearchFilters): string | null {
    // Priority: zip > county > city > state
    if (filters.zip) {
      // ATTOM geoIdV4 format for zip: ZI + 5-digit zip
      return `ZI${filters.zip.replace(/\s/g, '').padStart(5, '0')}`;
    }
    if (filters.county && filters.state) {
      // Would need a FIPS lookup table; for now require zip
      this.logger.warn('Deal search: county-based search requires FIPS lookup (not yet implemented). Use zip code.');
      return null;
    }
    if (filters.state) {
      // ATTOM geoIdV4 for state: ST + 2-digit FIPS code
      const fips = STATE_FIPS[filters.state.toUpperCase()];
      if (fips) return `ST${fips}`;
    }
    return null;
  }

  private buildCacheKey(endpoint: string, geoIdV4: string, params: Record<string, any>): string {
    const raw = `${endpoint}|${geoIdV4}|${JSON.stringify(params, Object.keys(params).sort())}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  private async getCachedResponse(cacheKey: string) {
    const cached = await this.prisma.dealSearchCache.findUnique({
      where: { cacheKey },
    });
    if (!cached) return null;
    if (cached.expiresAt < new Date()) {
      // Expired — delete and return null
      await this.prisma.dealSearchCache.delete({ where: { cacheKey } }).catch(() => {});
      return null;
    }
    return cached;
  }

  private async cacheResponse(
    cacheKey: string,
    endpoint: string,
    geoIdV4: string,
    params: Record<string, any>,
    data: any[],
    resultCount: number,
  ) {
    const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000);
    try {
      await this.prisma.dealSearchCache.upsert({
        where: { cacheKey },
        create: {
          cacheKey,
          endpoint,
          geoIdV4,
          params: params as any,
          responseData: data as any,
          resultCount,
          expiresAt,
        },
        update: {
          responseData: data as any,
          resultCount,
          fetchedAt: new Date(),
          expiresAt,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to cache deal search response: ${error}`);
    }
  }

  private normalizeProperty(prop: any): DealSearchResult | null {
    const attomId = String(prop?.identifier?.attomId || prop?.identifier?.Id || '');
    if (!attomId) return null;

    const address = prop.address;
    if (!address?.line1) return null;

    const avm = prop.avm?.amount;
    const assessment = prop.assessment;
    const sale = prop.sale;
    const building = prop.building;
    const rooms = building?.rooms;
    const size = building?.size;

    const estimatedValue = avm?.value || null;
    const lastSalePrice = sale?.amount?.saleAmt || sale?.amount?.saleamt || null;
    const assessedValue = assessment?.assessed?.assdTtlValue || null;

    // Equity calculation
    let estimatedEquity: number | null = null;
    let equityPercent: number | null = null;
    if (estimatedValue && lastSalePrice && lastSalePrice > 0) {
      estimatedEquity = estimatedValue - lastSalePrice;
      equityPercent = Math.round((estimatedEquity / estimatedValue) * 100);
    } else if (estimatedValue && assessedValue) {
      // Fallback: use assessed as proxy for what they owe
      estimatedEquity = estimatedValue - assessedValue;
      equityPercent = Math.round((estimatedEquity / estimatedValue) * 100);
    }

    // Distress flags
    const distressFlags: string[] = [];
    const absenteeInd = prop.summary?.absenteeInd || '';
    const isAbsenteeOwner = absenteeInd.toLowerCase().includes('absentee') || absenteeInd === 'O';
    if (isAbsenteeOwner) distressFlags.push('Absentee Owner');

    if (prop._foreclosureData) {
      const fcType = prop._foreclosureData?.type?.toLowerCase() || '';
      if (fcType.includes('pre') || fcType.includes('nod') || fcType.includes('lis')) {
        distressFlags.push('Pre-Foreclosure');
      }
      if (fcType.includes('auction') || fcType.includes('nts') || fcType.includes('notice of sale')) {
        distressFlags.push('Foreclosure');
      }
      if (fcType.includes('bankruptcy')) {
        distressFlags.push('Bankruptcy');
      }
      if (fcType.includes('lien') || fcType.includes('tax')) {
        distressFlags.push('Tax Lien');
      }
    }

    if (equityPercent && equityPercent > 50) distressFlags.push('High Equity');

    // Owner type
    const ownerName = assessment?.owner?.owner1?.fullName || null;
    const isCorporate = ownerName ? /llc|inc|corp|trust|estate|ltd|lp|company|assoc|bank/i.test(ownerName) : false;

    return {
      attomId,
      propertyAddress: address.line1,
      propertyCity: address.locality || '',
      propertyState: address.countrySubd || '',
      propertyZip: address.postal1 || '',
      county: prop.area?.countrysecsubd || '',
      latitude: prop.location?.latitude ? parseFloat(prop.location.latitude) : null,
      longitude: prop.location?.longitude ? parseFloat(prop.location.longitude) : null,
      propertyType: prop.summary?.propertyType || prop.summary?.proptype || 'Unknown',
      bedrooms: rooms?.beds ?? null,
      bathrooms: rooms?.bathstotal ?? null,
      sqft: size?.livingsize || size?.universalsize || null,
      lotSize: prop.lot?.lotsize1 ?? null,
      yearBuilt: prop.summary?.yearbuilt ?? null,
      stories: building?.summary?.levels ?? null,
      hasGarage: !!building?.parking?.garagetype,
      estimatedValue,
      estimatedValueLow: avm?.low || null,
      estimatedValueHigh: avm?.high || null,
      assessedValue,
      lastSaleDate: sale?.saleTransDate || sale?.amount?.salerecdate || null,
      lastSalePrice,
      estimatedEquity,
      equityPercent,
      annualTaxAmount: assessment?.tax?.taxAmt ?? null,
      mortgageBalance: null, // ATTOM doesn't provide this in snapshot
      ownerName,
      ownerMailingAddress: null, // Would need separate owner lookup
      isAbsenteeOwner,
      isOwnerOccupied: !isAbsenteeOwner,
      ownerType: isCorporate ? 'Corporate' : 'Individual',
      distressFlags,
      foreclosureStatus: prop._foreclosureData?.type || null,
      avmPoorHigh: prop.avm?.condition?.avmpoorhigh ?? null,
      avmExcellentHigh: prop.avm?.condition?.avmexcellenthigh ?? null,
    };
  }

  private applyClientFilters(
    results: DealSearchResult[],
    filters: DealSearchFilters,
  ): DealSearchResult[] {
    return results.filter((r) => {
      // Property type (multi-select)
      if (filters.propertyType?.length) {
        const types = filters.propertyType.map((t) => t.toLowerCase());
        if (!types.some((t) => (r.propertyType || '').toLowerCase().includes(t))) {
          return false;
        }
      }

      // Financial range filters
      if (filters.avmMin && (r.estimatedValue ?? 0) < filters.avmMin) return false;
      if (filters.avmMax && (r.estimatedValue ?? Infinity) > filters.avmMax) return false;
      if (filters.assessedValueMin && (r.assessedValue ?? 0) < filters.assessedValueMin) return false;
      if (filters.assessedValueMax && (r.assessedValue ?? Infinity) > filters.assessedValueMax) return false;
      if (filters.lastSalePriceMin && (r.lastSalePrice ?? 0) < filters.lastSalePriceMin) return false;
      if (filters.lastSalePriceMax && (r.lastSalePrice ?? Infinity) > filters.lastSalePriceMax) return false;

      // Equity filter
      if (filters.equityPercentMin != null && (r.equityPercent ?? 0) < filters.equityPercentMin) return false;
      if (filters.equityPercentMax != null && (r.equityPercent ?? 100) > filters.equityPercentMax) return false;

      // Lot size
      if (filters.lotSizeMin && (r.lotSize ?? 0) < filters.lotSizeMin) return false;
      if (filters.lotSizeMax && (r.lotSize ?? Infinity) > filters.lotSizeMax) return false;

      // Stories
      if (filters.stories && r.stories !== filters.stories) return false;
      if (filters.hasGarage && !r.hasGarage) return false;

      // Distress filters (any of these checked = must have the flag)
      if (filters.absenteeOwner && !r.isAbsenteeOwner) return false;
      if (filters.preForeclosure && !r.distressFlags.includes('Pre-Foreclosure')) return false;
      if (filters.foreclosure && !r.distressFlags.includes('Foreclosure')) return false;
      if (filters.taxLien && !r.distressFlags.includes('Tax Lien')) return false;
      if (filters.bankruptcy && !r.distressFlags.includes('Bankruptcy')) return false;
      if (filters.highEquity && !r.distressFlags.includes('High Equity')) return false;
      if (filters.freeClear && (r.equityPercent ?? 0) < 95) return false;

      // Owner filters
      if (filters.corporateOwned && r.ownerType !== 'Corporate') return false;
      if (filters.outOfStateOwner && r.isOwnerOccupied) return false; // Rough proxy

      return true;
    });
  }
}

// ─── US State → FIPS Code Mapping ────────────────────────────────────────────

const STATE_FIPS: Record<string, string> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09',
  DE: '10', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18',
  IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25',
  MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31', NV: '32',
  NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39',
  OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47',
  TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54', WI: '55',
  WY: '56', DC: '11',
};
