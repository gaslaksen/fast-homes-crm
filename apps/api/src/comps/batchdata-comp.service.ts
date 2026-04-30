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

    const response = await this.batchData.searchComps(address, {
      distanceMiles: opts?.maxRadiusMiles,
      take: opts?.maxResults,
      // Default scoping: SFR residential — same default as our REAPI flow.
      propertyTypeCategory: ['Residential'],
      propertyTypeDetail: ['Single Family'],
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

    if (filteredNoPrice + filteredNoDate > 0) {
      this.logger.log(
        `BatchData comps filtered ${filteredNoPrice + filteredNoDate}/${properties.length}: ` +
        `no-price=${filteredNoPrice}, no-date=${filteredNoDate}`,
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
