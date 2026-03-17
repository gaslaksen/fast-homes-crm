import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RentCastService } from './rentcast.service';
import { AttomService, AttomEnrichmentResult } from './attom.service';
import axios from 'axios';

interface ChatARVResponse {
  arv: number;
  confidence: number;
  comps: Array<{
    address: string;
    distance: number;
    soldPrice: number;
    soldDate: string;
    daysOnMarket?: number;
    bedrooms?: number;
    bathrooms?: number;
    sqft?: number;
    sourceUrl?: string;
  }>;
}

@Injectable()
export class CompsService {
  private readonly logger = new Logger(CompsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private rentCastService: RentCastService,
    private attomService: AttomService,
  ) {}

  /**
   * Fetch comps and ARV for a property.
   * Runs ATTOM enrichment in parallel.
   * Priority: 1) ATTOM /sale/detail (deed-verified), 2) RentCast, 3) ChatARV, 4) Placeholder
   * Use preferSource to override: 'rentcast' skips ATTOM comps, 'auto' tries ATTOM first.
   */
  async fetchComps(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
    options?: { forceRefresh?: boolean; preferSource?: 'attom' | 'rentcast' | 'auto' },
  ): Promise<{
    arv: number;
    arvLow?: number;
    arvHigh?: number;
    confidence: number;
    compsCount: number;
    source: string;
    attom?: AttomEnrichmentResult | null;
  }> {
    const preferSource = options?.preferSource || 'auto';

    // Run ATTOM enrichment in parallel (non-blocking — fills in property details)
    const attomPromise = this.attomService.isConfigured
      ? this.attomService.enrichLead(leadId, address, { forceRefresh: options?.forceRefresh })
          .catch(err => { this.logger.warn(`ATTOM enrichment failed (non-fatal): ${err.message}`); return null; })
      : Promise.resolve(null);

    let compsResult: {
      arv: number; arvLow?: number; arvHigh?: number; confidence: number; compsCount: number; source: string;
    };

    // 1) Try ATTOM comp search (deed-verified sales) — unless user wants RentCast
    if (this.attomService.isConfigured && preferSource !== 'rentcast') {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        select: { latitude: true, longitude: true, propertyType: true, sqft: true, bedrooms: true },
      });

      if (lead?.latitude && lead?.longitude) {
        try {
          this.logger.log(`Fetching comps via ATTOM /sale/detail for lead ${leadId}`);
          const result = await this.attomService.fetchCompsFromAttom(
            leadId,
            address,
            { latitude: lead.latitude, longitude: lead.longitude },
            {
              forceRefresh: options?.forceRefresh,
              propertyType: lead.propertyType || undefined,
              sqft: lead.sqft || undefined,
              bedrooms: lead.bedrooms || undefined,
            },
          );

          if (result && result.compsCount >= 1) {
            this.logger.log(`ATTOM comps: ${result.compsCount} deed-verified sales found`);
            const attom = await attomPromise;
            return { ...result, arv: result.arv!, attom };
          }
          this.logger.warn(`ATTOM returned 0 comps — falling back to RentCast`);
        } catch (err) {
          this.logger.warn(`ATTOM comp fetch failed (non-fatal): ${err.message} — falling back to RentCast`);
        }
      } else {
        this.logger.warn(`No lat/lon for lead ${leadId} — skipping ATTOM comps, using RentCast`);
      }
    }

    // 2) Try RentCast with tiered radius expansion
    if (this.rentCastService.isConfigured) {
      try {
        this.logger.log(`Fetching comps via RentCast for lead ${leadId}`);
        compsResult = await this.fetchWithTieredRadius(leadId, address, options);
      } catch (error) {
        this.logger.error(`RentCast fetch failed, trying fallbacks: ${error.message}`);
        compsResult = await this.fetchCompsWithFallback(leadId, address);
      }
    } else {
      compsResult = await this.fetchCompsWithFallback(leadId, address);
    }

    // Await ATTOM enrichment (it's been running in parallel the whole time)
    const attom = await attomPromise;

    return { ...compsResult, attom };
  }

  /**
   * Tiered radius expansion: if fewer than 3 comps are returned,
   * automatically widen the search radius up to 3 miles.
   */
  private async fetchWithTieredRadius(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
    options?: { forceRefresh?: boolean },
  ) {
    const radiusTiers = [0.5, 1.0, 2.0, 3.0]; // miles
    let result: { arv: number; arvLow?: number; arvHigh?: number; confidence: number; compsCount: number; source: string } | null = null;
    let compsCount = 0;

    for (const radius of radiusTiers) {
      try {
        result = await this.rentCastService.fetchAndSaveComps(leadId, address, {
          forceRefresh: options?.forceRefresh || radius > radiusTiers[0], // always force on expansion
          maxRadius: radius,
        });
        compsCount = result.compsCount;
        this.logger.log(`Tiered comp search: radius=${radius}mi returned ${compsCount} comps`);
        if (compsCount >= 3) break; // enough comps found — stop expanding
      } catch (err) {
        this.logger.warn(`Comp search at radius=${radius}mi failed: ${err.message}`);
      }
    }

    if (result) return result;
    return this.createPlaceholderComps(leadId, address);
  }

  private async fetchCompsWithFallback(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
  ) {
    // 2) Try ChatARV
    const chatARVKey = this.config.get<string>('CHATARV_API_KEY');
    if (chatARVKey) {
      try {
        this.logger.log(`Fetching comps via ChatARV for lead ${leadId}`);
        return await this.fetchFromChatARV(leadId, address, chatARVKey);
      } catch (error) {
        this.logger.error(`ChatARV fetch failed: ${error.message}`);
      }
    }

    // 3) Fallback to placeholder
    this.logger.log(`Using placeholder comps for lead ${leadId}`);
    return await this.createPlaceholderComps(leadId, address);
  }

  /**
   * Fetch from ChatARV.ai API
   */
  private async fetchFromChatARV(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
    apiKey: string,
  ): Promise<{ arv: number; confidence: number; compsCount: number; source: string }> {
    const fullAddress = `${address.street}, ${address.city}, ${address.state} ${address.zip}`;

    const response = await axios.post<ChatARVResponse>(
      'https://api.chatarv.ai/v1/comps',
      { address: fullAddress, radius: 1.0, max_comps: 10 },
      {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      },
    );

    const data = response.data;

    await this.prisma.comp.deleteMany({ where: { leadId, source: 'chatarv', analysisId: null } });

    for (const comp of data.comps) {
      await this.prisma.comp.create({
        data: {
          leadId,
          address: comp.address,
          distance: comp.distance,
          soldPrice: comp.soldPrice,
          soldDate: new Date(comp.soldDate),
          daysOnMarket: comp.daysOnMarket,
          bedrooms: comp.bedrooms,
          bathrooms: comp.bathrooms,
          sqft: comp.sqft,
          sourceUrl: comp.sourceUrl,
          source: 'chatarv',
        },
      });
    }

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { arv: data.arv, arvConfidence: data.confidence, lastCompsDate: new Date() },
    });

    return { arv: data.arv, confidence: data.confidence, compsCount: data.comps.length, source: 'chatarv' };
  }

  /**
   * Create placeholder comps for development/demo
   */
  private async createPlaceholderComps(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
  ): Promise<{ arv: number; confidence: number; compsCount: number; source: string }> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { askingPrice: true, bedrooms: true, bathrooms: true, sqft: true },
    });

    const baseValue = lead?.askingPrice || 200000;
    const arv = Math.round(baseValue * 1.15);
    const confidence = 50; // Lower confidence for placeholder data

    const compCount = 3;
    const comps: Array<{
      address: string;
      distance: number;
      soldPrice: number;
      soldDate: Date;
      daysOnMarket: number;
      bedrooms?: number;
      bathrooms?: number;
      sqft?: number;
    }> = [];

    for (let i = 0; i < compCount; i++) {
      const variance = 0.95 + Math.random() * 0.1;
      comps.push({
        address: `${100 + i * 100} Comparable St, ${address.city}, ${address.state}`,
        distance: Math.round((0.2 + Math.random() * 0.8) * 10) / 10,
        soldPrice: Math.round(arv * variance),
        soldDate: new Date(Date.now() - (30 + i * 15) * 24 * 60 * 60 * 1000),
        daysOnMarket: 15 + Math.floor(Math.random() * 30),
        bedrooms: lead?.bedrooms,
        bathrooms: lead?.bathrooms,
        sqft: lead?.sqft,
      });
    }

    await this.prisma.comp.deleteMany({ where: { leadId, source: 'placeholder', analysisId: null } });

    for (const comp of comps) {
      await this.prisma.comp.create({
        data: { leadId, ...comp, source: 'placeholder' },
      });
    }

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { arv, arvConfidence: confidence, lastCompsDate: new Date() },
    });

    return { arv, confidence, compsCount: compCount, source: 'placeholder' };
  }

  /**
   * Get comps for a lead.
   * Auto-backfills similarity scores if any are missing.
   */
  async getComps(leadId: string) {
    const comps = await this.prisma.comp.findMany({
      where: { leadId },
      orderBy: [{ similarityScore: 'desc' }, { distance: 'asc' }],
    });

    // Backfill similarity if any comp is missing a score
    const needsBackfill = comps.some((c) => c.similarityScore == null);
    if (needsBackfill && comps.length > 0) {
      await this.recalculateSimilarityScores(leadId);
      return this.prisma.comp.findMany({
        where: { leadId },
        orderBy: [{ similarityScore: 'desc' }, { distance: 'asc' }],
      });
    }

    return comps;
  }

  /**
   * Recalculate similarity scores for all comps of a lead
   */
  async recalculateSimilarityScores(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { bedrooms: true, bathrooms: true, sqft: true, propertyType: true },
    });
    if (!lead) return;

    const comps = await this.prisma.comp.findMany({
      where: { leadId },
    });

    this.logger.log(`Recalculating similarity for ${comps.length} comps (lead ${leadId})`);

    for (const comp of comps) {
      const score = this.calculateSimilarityScore(lead, comp);
      await this.prisma.comp.update({
        where: { id: comp.id },
        data: { similarityScore: score },
      });
    }
  }

  /**
   * Toggle comp selection and optionally recalculate ARV from selected comps
   */
  async toggleCompSelection(compId: string) {
    const comp = await this.prisma.comp.findUnique({ where: { id: compId } });
    if (!comp) throw new Error('Comp not found');

    const updated = await this.prisma.comp.update({
      where: { id: compId },
      data: { selected: !comp.selected },
    });

    // Recalculate ARV from selected comps
    await this.recalculateArv(comp.leadId);

    return updated;
  }

  /**
   * Bulk update comp selections based on similarity threshold
   */
  async autoSelectComps(leadId: string, minSimilarity: number, maxDistance: number) {
    // Deselect all first
    await this.prisma.comp.updateMany({
      where: { leadId, analysisId: null },
      data: { selected: false },
    });

    // Select comps meeting criteria
    const comps = await this.prisma.comp.findMany({
      where: { leadId, analysisId: null },
    });

    for (const comp of comps) {
      const meetsThreshold = (comp.similarityScore || 0) >= minSimilarity && comp.distance <= maxDistance;
      if (meetsThreshold) {
        await this.prisma.comp.update({
          where: { id: comp.id },
          data: { selected: true },
        });
      }
    }

    await this.recalculateArv(leadId);

    return this.getComps(leadId);
  }

  /**
   * Recalculate ARV from selected comps only
   */
  async recalculateArv(leadId: string) {
    const selectedComps = await this.prisma.comp.findMany({
      where: { leadId, selected: true, analysisId: null },
    });

    if (selectedComps.length === 0) return;

    const totalPrice = selectedComps.reduce((sum, c) => sum + c.soldPrice, 0);
    const arv = Math.round(totalPrice / selectedComps.length);

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { arv },
    });

    return arv;
  }

  /**
   * Calculate similarity score between subject property and a comp (0-100)
   */
  calculateSimilarityScore(
    subject: { bedrooms?: number | null; bathrooms?: number | null; sqft?: number | null; propertyType?: string | null },
    comp: { bedrooms?: number | null; bathrooms?: number | null; sqft?: number | null; propertyType?: string | null },
  ): number {
    let score = 0;
    let maxScore = 0;

    // Bedrooms (25 points)
    maxScore += 25;
    if (subject.bedrooms != null && comp.bedrooms != null) {
      const diff = Math.abs(subject.bedrooms - comp.bedrooms);
      if (diff === 0) score += 25;
      else if (diff === 1) score += 15;
      else if (diff === 2) score += 5;
    }

    // Bathrooms (25 points)
    maxScore += 25;
    if (subject.bathrooms != null && comp.bathrooms != null) {
      const diff = Math.abs(subject.bathrooms - comp.bathrooms);
      if (diff === 0) score += 25;
      else if (diff <= 0.5) score += 20;
      else if (diff <= 1) score += 10;
      else if (diff <= 1.5) score += 5;
    }

    // Square footage (40 points — most important)
    maxScore += 40;
    if (subject.sqft && comp.sqft && subject.sqft > 0) {
      const pctDiff = (Math.abs(subject.sqft - comp.sqft) / subject.sqft) * 100;
      if (pctDiff <= 5) score += 40;
      else if (pctDiff <= 10) score += 35;
      else if (pctDiff <= 15) score += 25;
      else if (pctDiff <= 20) score += 15;
      else if (pctDiff <= 30) score += 5;
    }

    // Property type (10 points)
    maxScore += 10;
    if (subject.propertyType && comp.propertyType) {
      if (subject.propertyType.toLowerCase() === comp.propertyType.toLowerCase()) score += 10;
    }

    return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  }

  /**
   * Calculate zip-code $/sqft baseline from local comps and other leads in same zip.
   */
  async getZipCodeBaseline(leadId: string): Promise<{
    medianPricePerSqft: number;
    sampleSize: number;
    source: string;
  } | null> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { propertyZip: true },
    });
    if (!lead?.propertyZip) return null;

    const priceSqftValues: number[] = [];

    // 1) Comps for this lead with both soldPrice and sqft
    const comps = await this.prisma.comp.findMany({
      where: { leadId },
      select: { soldPrice: true, sqft: true },
    });
    for (const c of comps) {
      if (c.soldPrice > 0 && c.sqft && c.sqft > 0) {
        priceSqftValues.push(c.soldPrice / c.sqft);
      }
    }

    // 2) Other leads in the same zip with arv + sqft
    const zipLeads = await this.prisma.lead.findMany({
      where: {
        propertyZip: lead.propertyZip,
        id: { not: leadId },
        arv: { not: null, gt: 0 },
        sqft: { not: null, gt: 0 },
      },
      select: { arv: true, sqft: true },
    });
    for (const l of zipLeads) {
      if (l.arv && l.sqft && l.sqft > 0) {
        priceSqftValues.push(l.arv / l.sqft);
      }
    }

    if (priceSqftValues.length < 3) {
      this.logger.log(`Zip baseline for ${lead.propertyZip}: only ${priceSqftValues.length} data points (need 3+)`);
      return null;
    }

    // Calculate median
    priceSqftValues.sort((a, b) => a - b);
    const mid = Math.floor(priceSqftValues.length / 2);
    const median = priceSqftValues.length % 2 === 0
      ? (priceSqftValues[mid - 1] + priceSqftValues[mid]) / 2
      : priceSqftValues[mid];

    const source = zipLeads.length > 0 ? 'local_comps+zip_leads' : 'local_comps';
    this.logger.log(
      `Zip baseline for ${lead.propertyZip}: $${Math.round(median)}/sqft from ${priceSqftValues.length} data points (${source})`,
    );

    return {
      medianPricePerSqft: Math.round(median * 100) / 100,
      sampleSize: priceSqftValues.length,
      source,
    };
  }
}
