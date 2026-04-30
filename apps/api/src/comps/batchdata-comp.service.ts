import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BatchDataService } from './batchdata.service';
import { BatchDataAddress, BatchDataProperty } from './batchdata.types';
import { computeSimilarityScore, haversineMiles } from './comp-similarity';

interface FetchResult {
  arv: number;
  arvLow?: number;
  arvHigh?: number;
  confidence: number;
  compsCount: number;
  source: string;
}

/**
 * Fetches comps from BatchData and persists them as `Comp` rows with
 * source='batchdata'. Mirrors the contract of ReapiService.fetchAndSaveComps
 * so the comps controller / UI don't have to branch on provider.
 */
@Injectable()
export class BatchDataCompService {
  private readonly logger = new Logger(BatchDataCompService.name);

  constructor(
    private prisma: PrismaService,
    private batchData: BatchDataService,
  ) {}

  async fetchAndSaveComps(
    leadId: string,
    address: BatchDataAddress,
    opts?: {
      forceRefresh?: boolean;
      maxRadiusMiles?: number;
      maxAgeMonths?: number;
      maxResults?: number;
    },
  ): Promise<FetchResult> {
    if (!this.batchData.isConfigured) {
      return {
        arv: 0,
        confidence: 0,
        compsCount: 0,
        source: 'batchdata (not configured)',
      };
    }

    // ── 24-hour cache ──────────────────────────────────────────────────────
    // BatchData bills per record. Skip the API call if we already have
    // BatchData comps for this lead written within the last 24h.
    if (!opts?.forceRefresh) {
      const newest = await this.prisma.comp.findFirst({
        where: { leadId, source: 'batchdata', analysisId: null },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const cacheAgeMs = newest ? Date.now() - newest.createdAt.getTime() : Infinity;
      const cacheTtlMs = 24 * 60 * 60 * 1000;
      if (newest && cacheAgeMs < cacheTtlMs) {
        const existing = await this.prisma.comp.findMany({
          where: { leadId, source: 'batchdata', analysisId: null },
          select: { soldPrice: true },
        });
        const prices = existing
          .map((c) => c.soldPrice)
          .filter((p) => p > 0)
          .sort((a, b) => a - b);
        const arv = prices.length
          ? Math.round(prices.reduce((s, v) => s + v, 0) / prices.length)
          : 0;
        const hoursOld = (cacheAgeMs / (60 * 60 * 1000)).toFixed(1);
        this.logger.log(
          `BatchData cache hit for lead ${leadId} (${hoursOld}h old, ${existing.length} comps) — skipping API call`,
        );
        return {
          arv,
          arvLow: prices[0],
          arvHigh: prices[prices.length - 1],
          confidence: existing.length > 0 ? Math.max(40, Math.min(90, Math.round(45 + existing.length * 1.5))) : 0,
          compsCount: existing.length,
          source: `batchdata (cached ${hoursOld}h old)`,
        };
      }
    }

    const subject = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        bedrooms: true,
        bathrooms: true,
        sqft: true,
        sqftOverride: true,
        propertyType: true,
        latitude: true,
        longitude: true,
      },
    });
    const subjectSqftForScore = subject?.sqftOverride ?? subject?.sqft ?? null;

    // Sale-recency window. Default 12 months. Caller can widen via the
    // Comps tab Age filter button (6/12/24mo on CompAnalysis).
    const ageMonths = opts?.maxAgeMonths ?? 12;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - ageMonths);
    const saleDateMinDate = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

    // Defaults match BatchData's original tight comp algorithm:
    // 1mi radius, 25 records, beds ±1, sqft ±20%, year built ±10y.
    // The user can widen via the Comps tab Distance filter (1/2/3/5mi)
    // for rural leads — that flows through opts.maxRadiusMiles.
    const response = await this.batchData.searchComps(address, {
      distanceMiles: opts?.maxRadiusMiles ?? 1,
      take: opts?.maxResults ?? 25,
      // Restored dimensional filters (default to true in DEFAULT_COMP_OPTIONS):
      // useBedrooms: ±1, useArea: ±20%, useYearBuilt: ±10y
      propertyTypeCategory: ['Residential'],
      propertyTypeDetail: ['Single Family'],
      saleDateMinDate,
    });

    if (!response) {
      return {
        arv: 0,
        confidence: 0,
        compsCount: 0,
        source: 'batchdata (no response)',
      };
    }

    const properties = response.results?.properties ?? response.properties ?? [];
    if (properties.length === 0) {
      return {
        arv: 0,
        confidence: 0,
        compsCount: 0,
        source: 'batchdata (no comps found)',
      };
    }

    // Drop only this lead's stale BatchData comps — leave REAPI/ATTOM/manual rows
    // alone so the side-by-side view can show both providers at once.
    await this.prisma.comp.deleteMany({
      where: { leadId, source: 'batchdata', analysisId: null },
    });

    let saved = 0;
    let filteredNoPrice = 0;
    let filteredNoDate = 0;
    let filteredStale = 0;

    for (const p of properties) {
      const soldPriceRaw = p.sale?.lastSale?.price;
      const soldDateRaw = p.sale?.lastSale?.saleDate;
      if (!soldPriceRaw || soldPriceRaw <= 0) {
        filteredNoPrice += 1;
        continue;
      }
      if (!soldDateRaw) {
        filteredNoDate += 1;
        continue;
      }
      const soldDate = new Date(soldDateRaw);
      if (isNaN(soldDate.getTime())) {
        filteredNoDate += 1;
        continue;
      }
      // Safety filter: drop comps older than 24 months even if the API
      // ignored the searchCriteria.sale.lastSaleDate.minDate hint.
      if (soldDate < cutoff) {
        filteredStale += 1;
        continue;
      }

      const compAddress = formatAddress(p.address);
      const sqft = p.building?.livingAreaSquareFeet ?? null;
      const bedrooms = p.building?.bedroomCount ?? null;
      const bathrooms = p.building?.bathroomCount ?? null;
      const yearBuilt = p.building?.yearBuilt ?? null;
      const lat = p.address?.latitude ?? null;
      const lon = p.address?.longitude ?? null;

      // Distance: prefer what BatchData returned; fall back to Haversine
      // when subject + comp lat/lng are present.
      let distance = p.distance ?? null;
      if (distance == null && lat != null && lon != null && subject?.latitude && subject?.longitude) {
        distance = parseFloat(
          haversineMiles(
            { latitude: subject.latitude, longitude: subject.longitude },
            { latitude: lat, longitude: lon },
          ).toFixed(2),
        );
      }

      const similarityScore = computeSimilarityScore(
        {
          bedrooms: subject?.bedrooms ?? null,
          bathrooms: subject?.bathrooms ?? null,
          sqft: subjectSqftForScore,
          propertyType: subject?.propertyType ?? null,
        },
        {
          bedrooms,
          bathrooms,
          sqft,
          propertyType: p.general?.propertyTypeDetail ?? null,
        },
      );
      const correlation = similarityScore != null ? similarityScore / 100 : null;

      try {
        await this.prisma.comp.create({
          data: {
            leadId,
            address: compAddress,
            distance: distance ?? 0,
            soldPrice: Math.round(soldPriceRaw),
            soldDate,
            bedrooms,
            bathrooms,
            sqft,
            yearBuilt,
            propertyType: p.general?.propertyTypeDetail ?? null,
            latitude: lat,
            longitude: lon,
            similarityScore,
            correlation,
            selected: true,
            source: 'batchdata',
            features: {
              subdivision: p.legal?.subdivisionName ?? null,
              avm: p.valuation?.estimatedValue ?? null,
              avmLow: p.valuation?.estimatedValueLow ?? null,
              avmHigh: p.valuation?.estimatedValueHigh ?? null,
              saleType: p.sale?.lastSale?.saleType ?? null,
              documentType: p.sale?.lastSale?.documentType ?? null,
            },
          },
        });
        saved += 1;
      } catch (err) {
        this.logger.warn(
          `Failed to save BatchData comp "${compAddress}": ${(err as Error).message}`,
        );
      }
    }

    const filteredTotal = filteredNoPrice + filteredNoDate + filteredStale;
    if (filteredTotal > 0) {
      this.logger.log(
        `BatchData comps filtered ${filteredTotal}/${properties.length}: ` +
        `no-price=${filteredNoPrice}, no-date=${filteredNoDate}, stale>24mo=${filteredStale}`,
      );
    }
    this.logger.log(`BatchData comps saved: ${saved}`);

    if (saved === 0) {
      return {
        arv: 0,
        confidence: 0,
        compsCount: 0,
        source: 'batchdata (no usable comps)',
      };
    }

    // ARV: average of saved comp sold prices. BatchData's response doesn't
    // surface a subject-level AVM the way REAPI does (that comes from the
    // separate Property Lookup endpoint, deferred to Phase 6).
    const savedComps = await this.prisma.comp.findMany({
      where: { leadId, source: 'batchdata', analysisId: null },
      select: { soldPrice: true },
    });
    const prices = savedComps.map((c) => c.soldPrice).sort((a, b) => a - b);
    const arv = Math.round(prices.reduce((s, v) => s + v, 0) / prices.length);
    const arvLow = prices[0];
    const arvHigh = prices[prices.length - 1];

    // Confidence: more comps = higher confidence, capped at 90 to leave
    // headroom vs REAPI's "subject AVM + comps" confidence.
    const confidence = Math.max(40, Math.min(90, Math.round(45 + saved * 1.5)));

    return {
      arv,
      arvLow,
      arvHigh,
      confidence,
      compsCount: saved,
      source: 'batchdata',
    };
  }
}

function formatAddress(addr?: BatchDataProperty['address']): string {
  if (!addr) return 'Unknown';
  const parts = [addr.street, addr.city, addr.state].filter(Boolean);
  const base = parts.join(', ');
  return addr.zip ? `${base} ${addr.zip}` : base || 'Unknown';
}
