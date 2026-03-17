import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import Anthropic from '@anthropic-ai/sdk';

interface AdjustmentConfig {
  pricePerSqft: number;
  perBedroom: number;
  perBathroom: number;
  perAcreLot: number;
  yearBuiltPer5Years: number;
  pool: number;
  garage: number;
  renovated: number;
  annualAppreciationRate: number; // e.g. 0.04 = 4% per year for time adjustment
}

const DEFAULT_ADJUSTMENTS: AdjustmentConfig = {
  pricePerSqft: 50,
  perBedroom: 5000,
  perBathroom: 3000,
  perAcreLot: 10000,
  yearBuiltPer5Years: 1000,
  pool: 15000,
  garage: 10000,
  renovated: 20000,
  annualAppreciationRate: 0.04,
};

const CONDITION_REPAIR_RATES: Record<string, { low: number; high: number; label: string }> = {
  move_in_ready:  { low: 0,   high: 10,  label: 'Move-In Ready' },
  light_cosmetic: { low: 15,  high: 30,  label: 'Light Cosmetic Rehab' },
  moderate_rehab: { low: 30,  high: 60,  label: 'Moderate Rehab' },
  heavy_rehab:    { low: 60,  high: 100, label: 'Heavy Rehab' },
  full_gut:       { low: 100, high: 150, label: 'Full Gut Renovation' },
};

const MOTIVATION_TIERS: Record<string, { maoPercent: number; label: string }> = {
  normal:          { maoPercent: 85, label: 'Normal Sale' },
  minor_distress:  { maoPercent: 75, label: 'Minor Distress' },
  distressed:      { maoPercent: 65, label: 'Distressed' },
  severe_distress: { maoPercent: 58, label: 'Severe Distress' },
  foreclosure:     { maoPercent: 52, label: 'Foreclosure' },
};

// Condition tiers mapped to $ adjustment relative to "Fair" baseline
const CONDITION_ADJUSTMENTS: Record<string, number> = {
  'Good':     15000,
  'Updated':  10000,
  'Fair':         0,
  'Poor':    -15000,
  'Gut':     -35000,
};

@Injectable()
export class CompAnalysisService {
  private readonly logger = new Logger(CompAnalysisService.name);
  private anthropic: Anthropic | null = null;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    }
  }

  /** Returns true if the sale date is within `months` months of today */
  private isRecentSale(soldDate: Date | string, months: number): boolean {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    return new Date(soldDate) >= cutoff;
  }

  async createAnalysis(leadId: string, params: {
    mode?: string;
    maxDistance?: number;
    timeFrameMonths?: number;
    propertyStatus?: string[];
    propertyType?: string;
    importExistingComps?: boolean;
    selectedCompIds?: string[];
  }) {
    const analysis = await this.prisma.compAnalysis.create({
      data: {
        leadId,
        mode: params.mode || 'ARV',
        maxDistance: params.maxDistance || 3,
        timeFrameMonths: params.timeFrameMonths || 12,
        propertyStatus: params.propertyStatus || ['Sold'],
        propertyType: params.propertyType || 'Auto',
      },
    });

    // Import specific selected comps or all existing comps
    if (params.selectedCompIds && params.selectedCompIds.length > 0) {
      await this.importSelectedComps(analysis.id, leadId, params.selectedCompIds);
    } else if (params.importExistingComps !== false) {
      await this.importExistingComps(analysis.id, leadId);
    }

    return analysis;
  }

  /**
   * Link existing lead-level comps (from RentCast/ChatARV fetch) into a CompAnalysis.
   * Copies the comps so they can be toggled/adjusted independently.
   */
  async importExistingComps(analysisId: string, leadId: string): Promise<number> {
    const existingComps = await this.prisma.comp.findMany({
      where: {
        leadId,
        analysisId: null, // Only lead-level comps (not already in an analysis)
        source: { not: 'placeholder' },
      },
      orderBy: { distance: 'asc' },
    });

    if (existingComps.length === 0) return 0;

    for (const comp of existingComps) {
      await this.prisma.comp.create({
        data: {
          leadId,
          analysisId,
          address: comp.address,
          distance: comp.distance,
          soldPrice: comp.soldPrice,
          soldDate: comp.soldDate,
          daysOnMarket: comp.daysOnMarket,
          bedrooms: comp.bedrooms,
          bathrooms: comp.bathrooms,
          sqft: comp.sqft,
          lotSize: comp.lotSize,
          yearBuilt: comp.yearBuilt,
          hasPool: comp.hasPool,
          hasGarage: comp.hasGarage,
          isRenovated: comp.isRenovated,
          propertyType: comp.propertyType,
          hoaFees: comp.hoaFees,
          latitude: comp.latitude,
          longitude: comp.longitude,
          correlation: comp.correlation,
          source: comp.source,
          features: comp.features || undefined,
          notes: comp.notes,
          photoUrl: comp.photoUrl,
          sourceUrl: comp.sourceUrl,
          // Auto-select: within 1 mile AND sold within the last 12 months
          selected: comp.distance <= 1.0 && this.isRecentSale(comp.soldDate, 12),
        },
      });
    }

    const autoSelected = existingComps.filter(
      (c) => c.distance <= 1.0 && this.isRecentSale(c.soldDate, 12),
    ).length;
    this.logger.log(
      `Imported ${existingComps.length} existing comps into analysis ${analysisId} — ${autoSelected} auto-selected (≤1 mi, sold ≤12 months)`,
    );

    // Immediately calculate initial confidence score so it's not stuck at default 0/1
    if (existingComps.length > 0) {
      const selected = existingComps.filter(c => c.distance <= 1.0 && this.isRecentSale(c.soldDate, 12));
      const compsForScore = selected.length > 0 ? selected : existingComps;
      const initialConfidence = this.calculateConfidence(compsForScore, null, undefined, undefined, undefined);

      const avgDist = compsForScore.reduce((s, c) => s + c.distance, 0) / compsForScore.length;
      const now = Date.now();
      const avgMonthsAgo = compsForScore.reduce((s, c) =>
        s + (now - new Date(c.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000), 0) / compsForScore.length;
      const confidenceTier =
        avgDist <= 0.5 && avgMonthsAgo <= 6 ? 'High' :
        avgDist <= 3.0 && avgMonthsAgo <= 12 ? 'Medium' :
        'Low';

      await this.prisma.compAnalysis.update({
        where: { id: analysisId },
        data: { confidenceScore: initialConfidence, confidenceTier },
      });
      this.logger.log(`Initial confidence for analysis ${analysisId}: ${initialConfidence} (${confidenceTier})`);
    }

    return existingComps.length;
  }

  /**
   * Import only specific comps (by ID) into a CompAnalysis.
   */
  async importSelectedComps(analysisId: string, leadId: string, compIds: string[]): Promise<number> {
    const comps = await this.prisma.comp.findMany({
      where: { id: { in: compIds }, leadId, analysisId: null },
    });

    for (const comp of comps) {
      await this.prisma.comp.create({
        data: {
          leadId,
          analysisId,
          address: comp.address,
          distance: comp.distance,
          soldPrice: comp.soldPrice,
          soldDate: comp.soldDate,
          daysOnMarket: comp.daysOnMarket,
          bedrooms: comp.bedrooms,
          bathrooms: comp.bathrooms,
          sqft: comp.sqft,
          lotSize: comp.lotSize,
          yearBuilt: comp.yearBuilt,
          hasPool: comp.hasPool,
          hasGarage: comp.hasGarage,
          isRenovated: comp.isRenovated,
          propertyType: comp.propertyType,
          hoaFees: comp.hoaFees,
          latitude: comp.latitude,
          longitude: comp.longitude,
          correlation: comp.correlation,
          source: comp.source,
          features: comp.features || undefined,
          notes: comp.notes,
          photoUrl: comp.photoUrl,
          sourceUrl: comp.sourceUrl,
          selected: true,
        },
      });
    }

    this.logger.log(`Imported ${comps.length} selected comps into analysis ${analysisId}`);
    return comps.length;
  }

  async getAnalysis(analysisId: string) {
    return this.prisma.compAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        comps: { orderBy: { distance: 'asc' } },
        lead: {
          select: {
            id: true,
            propertyAddress: true,
            propertyCity: true,
            propertyState: true,
            propertyZip: true,
            bedrooms: true,
            bathrooms: true,
            sqft: true,
            yearBuilt: true,
            lotSize: true,
            propertyType: true,
            askingPrice: true,
            arv: true,
            conditionLevel: true,
            // ATTOM enrichment
            attomId: true,
            attomEnrichedAt: true,
            attomAvm: true,
            attomAvmLow: true,
            attomAvmHigh: true,
            attomAvmConfidence: true,
            avmPoorLow: true,
            avmPoorHigh: true,
            avmGoodLow: true,
            avmGoodHigh: true,
            avmExcellentLow: true,
            avmExcellentHigh: true,
            propertyCondition: true,
            propertyQuality: true,
            wallType: true,
            stories: true,
            basementSqft: true,
            effectiveYearBuilt: true,
            subdivision: true,
            annualTaxAmount: true,
            taxAssessedValue: true,
            marketAssessedValue: true,
            lastSaleDate: true,
            lastSalePrice: true,
          },
        },
      },
    });
  }

  async getAnalysesForLead(leadId: string) {
    return this.prisma.compAnalysis.findMany({
      where: { leadId },
      include: { comps: { where: { selected: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addComp(analysisId: string, leadId: string, data: {
    address: string;
    distance: number;
    soldPrice: number;
    soldDate: string;
    daysOnMarket?: number;
    bedrooms?: number;
    bathrooms?: number;
    sqft?: number;
    lotSize?: number;
    yearBuilt?: number;
    hasPool?: boolean;
    hasGarage?: boolean;
    isRenovated?: boolean;
    propertyType?: string;
    hoaFees?: number;
    schoolDistrict?: string;
    photoUrl?: string;
    sourceUrl?: string;
    notes?: string;
  }) {
    const comp = await this.prisma.comp.create({
      data: {
        leadId,
        analysisId,
        address: data.address,
        distance: data.distance,
        soldPrice: data.soldPrice,
        soldDate: new Date(data.soldDate),
        daysOnMarket: data.daysOnMarket,
        bedrooms: data.bedrooms,
        bathrooms: data.bathrooms,
        sqft: data.sqft,
        lotSize: data.lotSize,
        yearBuilt: data.yearBuilt,
        hasPool: data.hasPool ?? false,
        hasGarage: data.hasGarage ?? false,
        isRenovated: data.isRenovated ?? false,
        propertyType: data.propertyType,
        hoaFees: data.hoaFees,
        schoolDistrict: data.schoolDistrict,
        photoUrl: data.photoUrl,
        sourceUrl: data.sourceUrl,
        notes: data.notes,
        selected: true,
      },
    });
    return comp;
  }

  async updateComp(compId: string, data: any) {
    return this.prisma.comp.update({
      where: { id: compId },
      data,
    });
  }

  async deleteComp(compId: string) {
    return this.prisma.comp.delete({ where: { id: compId } });
  }

  async toggleCompSelection(compId: string) {
    const comp = await this.prisma.comp.findUnique({ where: { id: compId } });
    if (!comp) throw new Error('Comp not found');
    return this.prisma.comp.update({
      where: { id: compId },
      data: { selected: !comp.selected },
    });
  }

  async calculateAdjustments(analysisId: string, config?: Partial<AdjustmentConfig>) {
    const analysisRaw = await this.prisma.compAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        comps: { where: { selected: true } },
        lead: {
          select: {
            bedrooms: true, bathrooms: true, sqft: true, yearBuilt: true,
            lotSize: true, conditionLevel: true, propertyType: true,
            propertyAddress: true, propertyCity: true, propertyState: true,
          },
        },
      },
    });
    if (!analysisRaw) throw new Error('Analysis not found');

    const analysis = analysisRaw as typeof analysisRaw & { lead: any; comps: any[] };
    const lead = analysis.lead;
    const adj = { ...DEFAULT_ADJUSTMENTS, ...config };
    const now = Date.now();

    // Determine subject condition from photo analysis or conditionLevel field
    let subjectCondition = 'Fair';
    if ((analysis as any).photoAnalysis) {
      try {
        const pa = JSON.parse((analysis as any).photoAnalysis
          .replace(/^```[\w]*\s*/m, '').replace(/\s*```$/m, '').trim());
        if (pa?.overallCondition) subjectCondition = pa.overallCondition;
      } catch {}
    } else if (lead.conditionLevel) {
      const lvl = lead.conditionLevel.toLowerCase();
      if (lvl.includes('gut') || lvl.includes('tear')) subjectCondition = 'Gut';
      else if (lvl.includes('poor') || lvl.includes('bad')) subjectCondition = 'Poor';
      else if (lvl.includes('good') || lvl.includes('excel') || lvl.includes('great')) subjectCondition = 'Good';
      else if (lvl.includes('updat') || lvl.includes('remodel')) subjectCondition = 'Updated';
    }

    const subjectConditionAdj = CONDITION_ADJUSTMENTS[subjectCondition] ?? 0;
    this.logger.log(`Adjustment engine: subject condition=${subjectCondition} (adj=${subjectConditionAdj})`);

    const updatedComps = [];
    for (const comp of analysis.comps) {
      const notes: string[] = [];
      let adjustment = 0;

      // ── 1. Size adjustment ($/sqft × diff) ──
      if (lead.sqft && comp.sqft) {
        const sqftDiff = lead.sqft - comp.sqft;
        if (sqftDiff !== 0) {
          const sqftAdj = sqftDiff * adj.pricePerSqft;
          adjustment += sqftAdj;
          notes.push(`Size: ${sqftAdj >= 0 ? '+' : ''}$${Math.round(sqftAdj).toLocaleString()} (${sqftDiff > 0 ? 'comp smaller' : 'comp larger'} by ${Math.abs(sqftDiff)} sqft)`);
        }
      }

      // ── 2. Bedroom adjustment ──
      if (lead.bedrooms != null && comp.bedrooms != null) {
        const bedDiff = lead.bedrooms - comp.bedrooms;
        if (bedDiff !== 0) {
          const bedAdj = bedDiff * adj.perBedroom;
          adjustment += bedAdj;
          notes.push(`Beds: ${bedAdj >= 0 ? '+' : ''}$${Math.round(bedAdj).toLocaleString()} (${bedDiff > 0 ? 'comp has fewer' : 'comp has more'} beds)`);
        }
      }

      // ── 3. Bathroom adjustment ──
      if (lead.bathrooms != null && comp.bathrooms != null) {
        const bathDiff = lead.bathrooms - comp.bathrooms;
        if (bathDiff !== 0) {
          const bathAdj = bathDiff * adj.perBathroom;
          adjustment += bathAdj;
          notes.push(`Baths: ${bathAdj >= 0 ? '+' : ''}$${Math.round(bathAdj).toLocaleString()} (${bathDiff > 0 ? 'comp has fewer' : 'comp has more'} baths)`);
        }
      }

      // ── 4. Year built adjustment ──
      if (lead.yearBuilt && comp.yearBuilt) {
        const ageDiff = lead.yearBuilt - comp.yearBuilt; // positive = subject newer
        if (Math.abs(ageDiff) >= 5) {
          const periods = ageDiff / 5;
          const ageAdj = periods * adj.yearBuiltPer5Years;
          adjustment += ageAdj;
          notes.push(`Age: ${ageAdj >= 0 ? '+' : ''}$${Math.round(ageAdj).toLocaleString()} (subject ${ageDiff > 0 ? 'newer' : 'older'} by ${Math.abs(ageDiff)} yrs)`);
        }
      }

      // ── 5. Lot size adjustment ──
      if (lead.lotSize && comp.lotSize) {
        const lotDiff = lead.lotSize - comp.lotSize;
        if (Math.abs(lotDiff) > 0.1) {
          const lotAdj = lotDiff * adj.perAcreLot;
          adjustment += lotAdj;
          notes.push(`Lot: ${lotAdj >= 0 ? '+' : ''}$${Math.round(lotAdj).toLocaleString()} (${Math.abs(lotDiff).toFixed(2)} acre diff)`);
        }
      }

      // ── 6. Pool adjustment ──
      if (comp.hasPool) {
        adjustment -= adj.pool;
        notes.push(`Pool: -$${adj.pool.toLocaleString()} (comp has pool, subject does not)`);
      }

      // ── 7. Garage adjustment ──
      if (comp.hasGarage) {
        adjustment -= adj.garage;
        notes.push(`Garage: -$${adj.garage.toLocaleString()} (comp has garage, subject does not)`);
      }

      // ── 8. Renovation adjustment ──
      if (comp.isRenovated) {
        adjustment -= adj.renovated;
        notes.push(`Renovated comp: -$${adj.renovated.toLocaleString()} (comp was renovated)`);
      }

      // ── 9. Condition adjustment (photo analysis vs comp assumed Fair) ──
      if (subjectCondition !== 'Fair') {
        adjustment += subjectConditionAdj;
        notes.push(`Condition (${subjectCondition}): ${subjectConditionAdj >= 0 ? '+' : ''}$${subjectConditionAdj.toLocaleString()} vs comp baseline`);
      }

      // ── 10. Time adjustment — normalize older comps to today's value ──
      const monthsAgo = (now - new Date(comp.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000);
      if (monthsAgo > 1) {
        const yearsAgo = monthsAgo / 12;
        const timeAdj = Math.round(comp.soldPrice * adj.annualAppreciationRate * yearsAgo);
        adjustment += timeAdj;
        notes.push(`Time: +$${timeAdj.toLocaleString()} (${monthsAgo.toFixed(0)} mo ago @ ${(adj.annualAppreciationRate * 100).toFixed(1)}%/yr appreciation)`);
      }

      const adjustedPrice = Math.round(comp.soldPrice + adjustment);

      const updated = await this.prisma.comp.update({
        where: { id: comp.id },
        data: {
          adjustmentAmount: Math.round(adjustment),
          adjustedPrice: adjustedPrice,
          adjustmentNotes: notes.join('\n'),
        },
      });
      updatedComps.push({ ...updated, adjustmentBreakdown: notes });
    }

    const totalAdj = updatedComps.reduce((sum, c) => sum + (c.adjustmentAmount || 0), 0);
    const avgAdj = updatedComps.length > 0 ? Math.round(totalAdj / updatedComps.length) : 0;

    await this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data: { avgAdjustment: avgAdj, adjustmentConfig: adj as any, adjustmentsEnabled: true },
    });

    this.logger.log(`Adjustments applied to ${updatedComps.length} comps. Avg adjustment: $${avgAdj.toLocaleString()}. Subject condition: ${subjectCondition}`);
    return { comps: updatedComps, avgAdjustment: avgAdj, subjectCondition };
  }


  async calculateArv(analysisId: string, method: string = 'weighted') {
    const analysis = await this.prisma.compAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        comps: { where: { selected: true } },
        lead: { select: { sqft: true, sqftOverride: true, bedrooms: true, bathrooms: true, yearBuilt: true } },
      },
    });
    if (!analysis) throw new Error('Analysis not found');

    const comps = analysis.comps;
    if (comps.length === 0) return null;

    const useAdjusted = analysis.adjustmentsEnabled;
    const prices = comps.map((c) => (useAdjusted && c.adjustedPrice ? c.adjustedPrice : c.soldPrice) as number);
    const lead = analysis.lead as any;
    const now = Date.now();

    let arv: number;

    if (method === 'median') {
      const sorted = [...prices].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      arv = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

    } else if (method === 'weighted' || method === 'average') {
      // Multi-factor weight: recency × proximity × size similarity
      const weights = comps.map((c, i) => {
        // Recency weight: comps sold in last 3 months = 1.0, decay over 24 months
        const monthsAgo = (now - new Date(c.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000);
        const recencyW = Math.max(0.2, 1 - (monthsAgo / 24));

        // Proximity weight: inverse distance, capped at 0.1 miles
        const proximityW = 1 / Math.max(c.distance, 0.1);

        // Size similarity weight: how close sqft is to subject
        let sizeW = 1.0;
        const effectiveSqft = lead?.sqftOverride || lead?.sqft;
        if (effectiveSqft && c.sqft) {
          const pctDiff = Math.abs(c.sqft - effectiveSqft) / effectiveSqft;
          sizeW = Math.max(0.3, 1 - pctDiff * 2); // 10% diff = 0.8 weight, 30% diff = 0.4
        }

        return recencyW * proximityW * sizeW;
      });

      const totalWeight = weights.reduce((s, w) => s + w, 0);
      arv = prices.reduce((sum, p, i) => sum + p * (weights[i] / totalWeight), 0);

    } else {
      arv = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    }

    arv = Math.round(arv);

    // ARV range: use adjusted price spread, excluding outliers (beyond 1.5 IQR)
    const sorted = [...prices].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const filtered = prices.filter(p => p >= q1 - 1.5 * iqr && p <= q3 + 1.5 * iqr);
    const arvLow = Math.round(Math.min(...filtered));
    const arvHigh = Math.round(Math.max(...filtered));

    // ── Comparable Sales Value (price/sqft anchoring) ──
    // Use sqftOverride when set (manual correction), otherwise fall back to ATTOM sqft
    const subjectSqft = (lead?.sqftOverride || lead?.sqft) as number | null;
    const compsWithSqft = comps.filter(c => c.sqft && c.sqft > 0);
    let comparableSalesValue: number | null = null;
    let avgPpsf: number | null = null;
    let medianPpsf: number | null = null;

    if (compsWithSqft.length > 0 && subjectSqft && subjectSqft > 0) {
      const ppsfValues = compsWithSqft.map(c => {
        const price = (useAdjusted && c.adjustedPrice ? c.adjustedPrice : c.soldPrice) as number;
        return price / c.sqft!;
      });
      avgPpsf = Math.round(ppsfValues.reduce((s, v) => s + v, 0) / ppsfValues.length);
      const sortedPpsf = [...ppsfValues].sort((a, b) => a - b);
      const mid = Math.floor(sortedPpsf.length / 2);
      medianPpsf = Math.round(
        sortedPpsf.length % 2 === 0
          ? (sortedPpsf[mid - 1] + sortedPpsf[mid]) / 2
          : sortedPpsf[mid],
      );
      comparableSalesValue = Math.round(((avgPpsf + medianPpsf) / 2) * subjectSqft);
    }

    // pricePerSqft = avg ppsf from comps (not ARV/sqft)
    const pricePerSqft = avgPpsf ?? 0;

    const confidence = this.calculateConfidence(comps, lead, arvLow, arvHigh, arv);

    // Confidence tier per partner framework:
    // High   = comps within 0.5mi AND sold within 6 months
    // Medium = comps within 1–3mi OR sold within 12 months
    // Low    = sparse/distant comps or zip-level fallback
    const avgDist = comps.reduce((s, c) => s + c.distance, 0) / comps.length;
    const now2 = Date.now();
    const avgMonthsAgo = comps.reduce((s, c) =>
      s + (now2 - new Date(c.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000), 0) / comps.length;
    const confidenceTier =
      avgDist <= 0.5 && avgMonthsAgo <= 6 ? 'High' :
      avgDist <= 3.0 && avgMonthsAgo <= 12 ? 'Medium' :
      'Low';

    await this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data: {
        arvEstimate: arv, arvLow, arvHigh, arvMethod: method,
        pricePerSqft,
        medianPricePerSqft: medianPpsf,
        comparableSalesValue,
        confidenceScore: confidence,
        confidenceTier,
      },
    });

    this.logger.log(`ARV calculated: $${arv.toLocaleString()} (${method}) range $${arvLow.toLocaleString()}–$${arvHigh.toLocaleString()} confidence=${confidence}`);

    // Auto-calculate cost approach (uses sqft + yearBuilt + taxAssessed — always available)
    await this.calculateCostApproach(analysisId).catch((err) => {
      this.logger.warn(`Cost approach auto-calc failed: ${err.message}`);
    });

    // Auto-estimate income approach using sqft-based market rent when no override exists
    const currentAnalysis = await this.prisma.compAnalysis.findUnique({
      where: { id: analysisId },
      select: { marketRent: true, lead: { select: { sqft: true, sqftOverride: true, propertyState: true } } },
    });
    if (!currentAnalysis?.marketRent) {
      // Estimate market rent: $1.00–$1.25/sqft/month is a reasonable national baseline
      // Use sqftOverride if set, otherwise ATTOM sqft
      const rentSqft = (currentAnalysis?.lead as any)?.sqftOverride || (currentAnalysis?.lead as any)?.sqft;
      if (rentSqft) {
        const estimatedRent = Math.round(rentSqft * 1.1); // $1.10/sqft/month midpoint
        await this.calculateIncomeApproach(analysisId, estimatedRent, 10, true).catch((err) => {
          this.logger.warn(`Income approach auto-calc failed: ${err.message}`);
        });
        this.logger.log(`Income approach auto-estimated: $${estimatedRent}/mo (${rentSqft} sqft × $1.10/sqft) — flagged as estimate`);
      }
    }

    // Auto-triangulate when ARV is recalculated
    const triangulation = await this.triangulateArv(analysisId).catch((err) => {
      this.logger.warn(`Triangulation after ARV calc failed: ${err.message}`);
      return null;
    });

    // Auto-assess risk flags after triangulation
    try {
      await this.assessRiskFlags(analysisId);
    } catch (e) {
      this.logger.warn(`Risk flag assessment failed (non-fatal): ${(e as Error).message}`);
    }

    return { arv, arvLow, arvHigh, pricePerSqft, medianPricePerSqft: medianPpsf, comparableSalesValue, confidence, method, triangulation };
  }

  private calculateConfidence(comps: any[], lead: any, arvLow?: number, arvHigh?: number, arv?: number): number {
    let score = 0;

    // ── 1. Comp count (max 20 pts) ──
    score += Math.min(comps.length * 4, 20);

    // ── 2. Proximity (max 20 pts) ──
    const avgDist = comps.reduce((s, c) => s + c.distance, 0) / comps.length;
    score += avgDist <= 0.5 ? 20 : avgDist <= 1 ? 16 : avgDist <= 2 ? 12 : avgDist <= 3 ? 8 : 4;

    // ── 3. Recency (max 20 pts) ──
    const now = Date.now();
    const avgMonthsAgo = comps.reduce((s, c) =>
      s + (now - new Date(c.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000), 0) / comps.length;
    score += avgMonthsAgo <= 3 ? 20 : avgMonthsAgo <= 6 ? 16 : avgMonthsAgo <= 9 ? 12 : avgMonthsAgo <= 12 ? 8 : 4;

    // ── 4. Size similarity (max 15 pts) ──
    const effectiveLeadSqft = lead?.sqftOverride || lead?.sqft;
    if (effectiveLeadSqft) {
      const avgSqft = comps.reduce((s, c) => s + (c.sqft || effectiveLeadSqft), 0) / comps.length;
      const pctDiff = Math.abs(avgSqft - effectiveLeadSqft) / effectiveLeadSqft;
      score += pctDiff <= 0.05 ? 15 : pctDiff <= 0.1 ? 12 : pctDiff <= 0.2 ? 8 : pctDiff <= 0.3 ? 4 : 2;
    } else {
      score += 8;
    }

    // ── 5. ARV spread tightness (max 15 pts) ──
    // Primary: use arvLow/arvHigh/arv (derived from adjusted prices — tight when adjustments normalize comps).
    // Guard: if arv is < 30% of the median soldPrice the adjustments have gone haywire (e.g. AI marked
    // all comps invalid and slashed prices). In that case fall back to soldPrice IQR spread instead.
    const soldPricesForGuard = comps.map(c => c.soldPrice).filter((p): p is number => p != null && p > 0);
    const medianSoldPrice = soldPricesForGuard.length > 0
      ? [...soldPricesForGuard].sort((a, b) => a - b)[Math.floor(soldPricesForGuard.length / 2)]
      : 0;
    const arvIsSane = arv != null && arv > 0 && (medianSoldPrice === 0 || arv >= medianSoldPrice * 0.3);

    if (arvIsSane && arvLow != null && arvHigh != null && arv != null && arv > 0) {
      const spreadPct = (arvHigh - arvLow) / arv;
      score += spreadPct <= 0.05 ? 15 : spreadPct <= 0.1 ? 12 : spreadPct <= 0.2 ? 8 : spreadPct <= 0.3 ? 4 : 1;
    } else if (soldPricesForGuard.length >= 2) {
      // Fallback: use IQR-filtered sold prices
      const sp = [...soldPricesForGuard].sort((a, b) => a - b);
      const q1sp = sp[Math.floor(sp.length * 0.25)];
      const q3sp = sp[Math.floor(sp.length * 0.75)];
      const iqrsp = q3sp - q1sp;
      const filteredSp = sp.filter(p => p >= q1sp - 1.5 * iqrsp && p <= q3sp + 1.5 * iqrsp);
      const midSp = filteredSp.reduce((s, p) => s + p, 0) / filteredSp.length;
      const spreadPct = midSp > 0 ? (Math.max(...filteredSp) - Math.min(...filteredSp)) / midSp : 1;
      score += spreadPct <= 0.05 ? 15 : spreadPct <= 0.1 ? 12 : spreadPct <= 0.2 ? 8 : spreadPct <= 0.3 ? 4 : 1;
    } else {
      score += 5;
    }

    // ── 6. Data completeness — how many comps have sqft/beds/baths (max 10 pts) ──
    const withData = comps.filter(c => c.sqft && c.bedrooms && c.bathrooms).length;
    score += Math.round((withData / Math.max(comps.length, 1)) * 10);

    return Math.min(Math.round(score), 100);
  }


  /**
   * AI-powered adjustment validation — Claude reviews all comp adjustments
   * and returns refined estimates with reasoning, plus a confidence interval.
   */
  async aiAdjustComps(analysisId: string) {
    const analysis = await this.prisma.compAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        comps: { where: { selected: true } },
        lead: {
          select: {
            propertyAddress: true, propertyCity: true, propertyState: true,
            bedrooms: true, bathrooms: true, sqft: true, yearBuilt: true,
            lotSize: true, conditionLevel: true, propertyType: true, askingPrice: true,
            // ATTOM enrichment fields
            attomAvm: true, attomAvmConfidence: true,
            avmPoorHigh: true, avmGoodHigh: true, avmExcellentHigh: true,
            avmExcellentLow: true, avmGoodLow: true, avmPoorLow: true,
            propertyCondition: true, propertyQuality: true, wallType: true,
            effectiveYearBuilt: true, basementSqft: true, stories: true,
            annualTaxAmount: true, taxAssessedValue: true, subdivision: true,
          },
        },
      },
    });
    if (!analysis) throw new Error('Analysis not found');
    if (!this.anthropic) throw new Error('Anthropic not configured');

    const lead = analysis.lead as any;
    const comps = analysis.comps as any[];
    if (comps.length === 0) throw new Error('No comps selected');

    // Build subject property summary
    const subjectDesc = [
      `Address: ${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState}`,
      lead.propertyType ? `Type: ${lead.propertyType}` : null,
      lead.sqft ? `Size: ${lead.sqft.toLocaleString()} sqft` : null,
      lead.bedrooms ? `Beds: ${lead.bedrooms}` : null,
      lead.bathrooms ? `Baths: ${lead.bathrooms}` : null,
      lead.yearBuilt ? `Year Built: ${lead.yearBuilt}` : null,
      lead.effectiveYearBuilt ? `Effective Year Built (post-reno): ${lead.effectiveYearBuilt}` : null,
      lead.lotSize ? `Lot: ${lead.lotSize.toFixed(2)} acres` : null,
      lead.stories ? `Stories: ${lead.stories}` : null,
      lead.basementSqft ? `Basement: ${lead.basementSqft.toLocaleString()} sqft` : null,
      lead.wallType ? `Wall Type: ${lead.wallType}` : null,
      lead.conditionLevel ? `Seller-reported Condition: ${lead.conditionLevel}` : null,
      lead.propertyCondition ? `ATTOM Condition: ${lead.propertyCondition}` : null,
      lead.propertyQuality ? `ATTOM Quality: ${lead.propertyQuality}` : null,
      lead.subdivision ? `Subdivision: ${lead.subdivision}` : null,
      lead.askingPrice ? `Asking Price: $${lead.askingPrice.toLocaleString()}` : null,
      lead.annualTaxAmount ? `Annual Taxes: $${Math.round(lead.annualTaxAmount).toLocaleString()}/yr` : null,
    ].filter(Boolean).join('\n');

    // Build ATTOM AVM context block (the investor's second opinion on value)
    const attomContext = lead.attomAvm ? `
ATTOM DATA SOLUTIONS — INDEPENDENT VALUATION:
  AVM Estimate: $${Math.round(lead.attomAvm).toLocaleString()}${lead.attomAvmConfidence ? ` (${lead.attomAvmConfidence}% confidence)` : ''}
  AS-IS / Distressed: ${lead.avmPoorHigh ? '$' + Math.round(lead.avmPoorHigh).toLocaleString() : 'N/A'}${lead.avmPoorLow ? ` (low: $${Math.round(lead.avmPoorLow).toLocaleString()})` : ''}
  Good Condition:     ${lead.avmGoodHigh ? '$' + Math.round(lead.avmGoodHigh).toLocaleString() : 'N/A'}${lead.avmGoodLow ? ` (low: $${Math.round(lead.avmGoodLow).toLocaleString()})` : ''}
  After Repair (ARV): ${lead.avmExcellentHigh ? '$' + Math.round(lead.avmExcellentHigh).toLocaleString() : 'N/A'}${lead.avmExcellentLow ? ` (low: $${Math.round(lead.avmExcellentLow).toLocaleString()})` : ''}
NOTE: Use ATTOM's condition-adjusted ranges as a strong independent signal. If comps-based ARV and ATTOM after-repair value agree within 10%, high confidence. If they diverge >15%, explain why and which to trust more.` : '';

    // Photo condition if available
    let photoCondition = '';
    if ((analysis as any).photoAnalysis) {
      try {
        const pa = JSON.parse((analysis as any).photoAnalysis.replace(/^```[\w]*\s*/m, '').replace(/\s*```$/m, '').trim());
        if (pa?.overallCondition) photoCondition = `\nPhoto Analysis Condition: ${pa.overallCondition}`;
        if (pa?.wholesalerNotes) photoCondition += `\nPhoto Notes: ${pa.wholesalerNotes}`;
      } catch {}
    }

    // Build comp summaries
    const compSummaries = comps.map((c, i) => {
      const monthsAgo = Math.round((Date.now() - new Date(c.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000));
      return [
        `COMP ${i + 1}: ${c.address}`,
        `  Sold: $${c.soldPrice.toLocaleString()} (${monthsAgo} months ago, ${c.distance.toFixed(2)} mi away)`,
        c.sqft ? `  Size: ${c.sqft.toLocaleString()} sqft` : null,
        (c.bedrooms || c.bathrooms) ? `  ${c.bedrooms}bd/${c.bathrooms}ba` : null,
        c.yearBuilt ? `  Built: ${c.yearBuilt}` : null,
        c.isRenovated ? '  Status: Renovated' : null,
        c.hasPool ? '  Has Pool' : null,
        c.hasGarage ? '  Has Garage' : null,
        c.adjustmentAmount != null ? `  Rule-based adjustment: ${c.adjustmentAmount >= 0 ? '+' : ''}$${c.adjustmentAmount.toLocaleString()} → Adjusted: $${(c.adjustedPrice || c.soldPrice).toLocaleString()}` : null,
        c.adjustmentNotes ? `  Breakdown: ${c.adjustmentNotes.replace(/\n/g, ' | ')}` : null,
      ].filter(Boolean).join('\n');
    }).join('\n\n');

    const prompt = `You are a professional real estate appraiser and wholesaling expert. Review these comparable sales and the rule-based adjustments already applied, then provide refined AI adjustments.

SUBJECT PROPERTY:
${subjectDesc}${photoCondition}
${attomContext}

COMPARABLE SALES WITH RULE-BASED ADJUSTMENTS:
${compSummaries}

Your task:
1. Review each comp's adjustment — does it make sense given the data?
2. Provide your own adjusted value for each comp (can confirm or override the rule-based one)
3. Flag any comps that are poor matches and should be weighted down or removed
4. Give an overall ARV conclusion with a confidence interval — reconcile the comps-based value with ATTOM's independent AVM if provided

Respond ONLY with valid JSON:
{
  "comps": [
    {
      "compIndex": 0,
      "soldPrice": number,
      "aiAdjustedPrice": number,
      "adjustmentDelta": number,
      "reasoning": "brief explanation",
      "quality": "excellent" | "good" | "fair" | "poor",
      "weight": 0.0-1.0
    }
  ],
  "arvRecommendation": {
    "point": number,
    "low": number,
    "high": number,
    "confidence": number,
    "method": "brief description of approach used",
    "keyFactors": ["factor1", "factor2"],
    "risks": ["risk1", "risk2"],
    "wholesalerNote": "2-3 sentence deal context"
  }
}`;

    const response = await this.anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (response.content[0] as any)?.text || '';
    let parsed: any = null;
    try {
      const stripped = text.replace(/^```[\w]*\s*/m, '').replace(/\s*```$/m, '').trim();
      const m = stripped.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    } catch (e) {
      this.logger.error('Failed to parse AI adjustment response', e);
      throw new Error('AI adjustment response could not be parsed');
    }

    // Apply AI-adjusted prices back to each comp
    const updatedComps = [];
    for (const aiComp of parsed.comps) {
      const comp = comps[aiComp.compIndex];
      if (!comp) continue;
      const updated = await this.prisma.comp.update({
        where: { id: comp.id },
        data: {
          adjustedPrice: Math.round(aiComp.aiAdjustedPrice),
          adjustmentAmount: Math.round(aiComp.aiAdjustedPrice - comp.soldPrice),
          adjustmentNotes: (comp.adjustmentNotes || '') + '\nAI: ' + aiComp.reasoning,
          similarityScore: Math.round((aiComp.weight || 0.5) * 100),
        },
      });
      updatedComps.push({ ...updated, quality: aiComp.quality, weight: aiComp.weight });
    }

    // Save AI ARV recommendation to analysis
    const rec = parsed.arvRecommendation;
    await this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data: {
        arvEstimate: Math.round(rec.point),
        arvLow: Math.round(rec.low),
        arvHigh: Math.round(rec.high),
        confidenceScore: Math.round(rec.confidence),
        adjustmentsEnabled: true,
        aiAssessment: (analysis as any).aiAssessment
          ? (analysis as any).aiAssessment
          : JSON.stringify({ keyFactors: rec.keyFactors, risks: rec.risks, wholesalerNote: rec.wholesalerNote, method: rec.method }),
      },
    });

    this.logger.log(`AI adjustment complete: ARV=$${rec.point.toLocaleString()} range $${rec.low.toLocaleString()}–$${rec.high.toLocaleString()} confidence=${rec.confidence}`);
    return { comps: updatedComps, arvRecommendation: rec };
  }

    async generateAiSummary(analysisId: string) {
    const analysis = await this.getAnalysis(analysisId);
    if (!analysis) throw new Error('Analysis not found');
    if (!this.anthropic) {
      return 'AI summary unavailable — Anthropic API key not configured.';
    }

    const lead = analysis.lead as any;
    const selectedComps = analysis.comps.filter((c) => c.selected);
    const avgSoldPrice = selectedComps.length > 0
      ? Math.round(selectedComps.reduce((s, c) => s + c.soldPrice, 0) / selectedComps.length)
      : 0;

    // ATTOM second-opinion block for summary prompt
    const attomSummaryBlock = lead.attomAvm ? `
ATTOM Independent Valuation:
- AVM: $${Math.round(lead.attomAvm).toLocaleString()}${lead.attomAvmConfidence ? ` (${lead.attomAvmConfidence}% confidence)` : ''}
- AS-IS value: ${lead.avmPoorHigh ? '$' + Math.round(lead.avmPoorHigh).toLocaleString() : 'N/A'}
- After-repair ARV: ${lead.avmExcellentHigh ? '$' + Math.round(lead.avmExcellentHigh).toLocaleString() : 'N/A'}
- ATTOM condition: ${lead.propertyCondition || 'N/A'} | Quality: ${lead.propertyQuality || 'N/A'}` : '';

    const prompt = `You are an expert real estate wholesaler analyzing comparable sales to determine ARV and offer strategy.

Subject Property:
- Address: ${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}
- ${lead.bedrooms || '?'}bd / ${lead.bathrooms || '?'}ba / ${lead.sqft?.toLocaleString() || '?'} sqft
- Property Type: ${lead.propertyType || 'Unknown'}
- Seller-reported Condition: ${lead.conditionLevel || 'Unknown'}${lead.propertyCondition ? `\n- ATTOM Condition: ${lead.propertyCondition}${lead.propertyQuality ? ' | Quality: ' + lead.propertyQuality : ''}` : ''}
- Asking Price: ${lead.askingPrice ? '$' + lead.askingPrice.toLocaleString() : 'Unknown'}
${lead.annualTaxAmount ? `- Annual Tax: $${Math.round(lead.annualTaxAmount).toLocaleString()}/yr` : ''}
${attomSummaryBlock}

Selected Comparable Sales (${selectedComps.length}):
${selectedComps.map((c, i) =>
  `${i + 1}. ${c.address}
     Sold: $${c.soldPrice.toLocaleString()} on ${new Date(c.soldDate).toLocaleDateString()} (${Math.round((Date.now() - new Date(c.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000))}mo ago)
     Details: ${c.bedrooms || '?'}bd/${c.bathrooms || '?'}ba, ${c.sqft?.toLocaleString() || '?'} sqft, ${c.distance.toFixed(1)} miles away
     ${c.correlation ? `RentCast correlation: ${(c.correlation * 100).toFixed(0)}%` : ''}
     ${c.adjustedPrice && c.adjustedPrice !== c.soldPrice ? `Adjusted to: $${c.adjustedPrice.toLocaleString()} (${(c.adjustmentAmount || 0) >= 0 ? '+' : ''}$${(c.adjustmentAmount || 0).toLocaleString()})` : ''}
     ${c.notes ? `Notes: ${c.notes}` : ''}`
).join('\n')}

Analysis Results:
- ARV Estimate: ${analysis.arvEstimate ? '$' + analysis.arvEstimate.toLocaleString() : 'Not calculated'}
- ARV Range: ${analysis.arvLow ? '$' + analysis.arvLow.toLocaleString() : '?'} - ${analysis.arvHigh ? '$' + analysis.arvHigh.toLocaleString() : '?'}
- Avg Sold Price: $${avgSoldPrice.toLocaleString()}
- Confidence Score: ${analysis.confidenceScore || 0}/100

Write a concise 3-4 sentence wholesaler's summary covering:
1. ARV conclusion and confidence — reconcile comps-based ARV with ATTOM's independent AVM if both are available
2. Which comps are most relevant and why
3. Any red flags (wide price spread, old comps, low match scores, ATTOM/comps divergence >10%)
4. Quick take on deal viability if asking price is known

Be direct and practical — this is for a wholesaler deciding whether to pursue the deal.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      });
      const summary = (response.content[0] as any)?.text || 'Unable to generate summary.';

      await this.prisma.compAnalysis.update({
        where: { id: analysisId },
        data: { aiSummary: summary },
      });

      return summary;
    } catch (error) {
      this.logger.error('AI summary generation failed:', error);
      return 'Unable to generate AI summary at this time.';
    }
  }

  async estimateRepairCosts(analysisId: string, data: {
    finishLevel: string;
    description?: string;
    repairItems?: string[];
    sqft?: number;
  }) {
    // Base rates per sqft by finish level
    const rates: Record<string, number> = {
      'budget': 20,
      'flip': 35,
      'high-end': 55,
    };

    // Per-item cost estimates (flip grade)
    const itemCosts: Record<string, Record<string, number>> = {
      'budget': {
        'Full gut': 30000, 'Roof': 6000, 'Kitchen': 8000, 'Bathrooms': 4000,
        'Windows': 4000, 'Landscaping': 2000, 'Exterior Painting': 3000,
        'Drywall': 4000, 'Interior painting': 3000, 'Flooring': 5000,
        'Driveway': 2500, 'HVAC': 4000,
      },
      'flip': {
        'Full gut': 50000, 'Roof': 10000, 'Kitchen': 15000, 'Bathrooms': 8000,
        'Windows': 7000, 'Landscaping': 4000, 'Exterior Painting': 5000,
        'Drywall': 6000, 'Interior painting': 5000, 'Flooring': 8000,
        'Driveway': 4000, 'HVAC': 7000,
      },
      'high-end': {
        'Full gut': 80000, 'Roof': 15000, 'Kitchen': 30000, 'Bathrooms': 15000,
        'Windows': 12000, 'Landscaping': 8000, 'Exterior Painting': 8000,
        'Drywall': 10000, 'Interior painting': 8000, 'Flooring': 15000,
        'Driveway': 6000, 'HVAC': 12000,
      },
    };

    let totalCost = 0;
    const level = data.finishLevel || 'flip';

    if (data.repairItems && data.repairItems.length > 0) {
      const costs = itemCosts[level] || itemCosts['flip'];
      for (const item of data.repairItems) {
        totalCost += costs[item] || 0;
      }
    } else if (data.sqft) {
      const rate = rates[level] || 35;
      totalCost = data.sqft * rate;
    }

    // If AI is available and description provided, get AI estimate
    let aiEstimate: string | null = null;
    if (this.anthropic && data.description) {
      try {
        const response = await this.anthropic.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `You are an experienced real estate contractor estimating repair costs for a wholesale flip. Finish level: ${level}.

Description: ${data.description}
${data.sqft ? `Property size: ${data.sqft} sqft` : ''}
${data.repairItems?.length ? `Selected items: ${data.repairItems.join(', ')}` : ''}

Respond with ONLY a JSON object: { "estimate": <number>, "breakdown": "<concise line-by-line breakdown>" }`,
          }],
        });
        const content = (response.content[0] as any)?.text || '';
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.estimate) totalCost = parsed.estimate;
          aiEstimate = parsed.breakdown || null;
        }
      } catch (e) {
        this.logger.error('AI repair estimate failed:', e);
      }
    }

    await this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data: {
        repairCosts: totalCost,
        repairFinishLevel: level,
        repairNotes: aiEstimate || data.description || null,
        repairItems: data.repairItems || [],
      },
    });

    return { totalCost, breakdown: aiEstimate };
  }

  async calculateDeal(analysisId: string, params: {
    arv?: number;
    repairCosts?: number;
    assignmentFee?: number;
    maoPercent?: number;
    dealType?: string;
  }) {
    const analysis = await this.prisma.compAnalysis.findUnique({
      where: { id: analysisId },
    });
    if (!analysis) throw new Error('Analysis not found');

    // Use riskAdjustedArv if available, else fall back to arvEstimate
    const arv = params.arv || analysis.riskAdjustedArv || analysis.arvEstimate || 0;
    const riskAdjustedArv = analysis.riskAdjustedArv ?? null;
    const repairCosts = params.repairCosts ?? analysis.repairCosts ?? 0;
    const assignmentFee = params.assignmentFee ?? analysis.assignmentFee;
    // Use seller motivation MAO% as default if params.maoPercent not passed
    const maoPercent = params.maoPercent ?? analysis.sellerMotivationMaoPercent ?? analysis.maoPercent;
    const dealType = params.dealType || analysis.dealType;
    const sellerMotivationTier = analysis.sellerMotivationTier ?? 'normal';

    // MAO = (ARV * maoPercent%) - repairs - assignment fee
    const mao = (arv * maoPercent / 100) - repairCosts - assignmentFee;
    // Initial offer = 95% of MAO
    const initialOffer = Math.round(mao * 0.95);
    // Sale price to buyer = MAO + assignment fee
    const salePrice = Math.round(mao + assignmentFee);
    // Negotiation range
    const negotiationRangeLow = Math.round(mao * 0.90);
    const negotiationRangeHigh = Math.round(mao * 1.02);

    await this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data: {
        assignmentFee,
        maoPercent,
        dealType,
        repairCosts,
        negotiationRangeLow: Math.max(negotiationRangeLow, 0),
        negotiationRangeHigh: Math.max(negotiationRangeHigh, 0),
        sellerMotivationTier,
        sellerMotivationMaoPercent: maoPercent,
      },
    });

    return {
      arv,
      riskAdjustedArv,
      repairCosts,
      assignmentFee,
      maoPercent,
      mao: Math.round(mao),
      initialOffer: Math.max(initialOffer, 0),
      salePrice: Math.max(salePrice, 0),
      negotiationRangeLow: Math.max(negotiationRangeLow, 0),
      negotiationRangeHigh: Math.max(negotiationRangeHigh, 0),
      sellerMotivationTier,
      confidenceTier: analysis.confidenceTier,
      riskFlags: analysis.riskFlags,
    };
  }

  // ─── AI Property Assessment ───────────────────────────────────────────────

  async generateAssessment(analysisId: string): Promise<string> {
    const analysis = await this.getAnalysis(analysisId);
    if (!analysis) throw new Error('Analysis not found');
    if (!this.anthropic) return 'AI assessment unavailable — Anthropic API key not configured.';

    const lead = analysis.lead as any;
    const allComps = analysis.comps;
    const selectedComps = allComps.filter((c) => c.selected);

    if (allComps.length === 0) return 'No comps available — fetch comps first before generating assessment.';

    const prices = selectedComps.map((c) => c.soldPrice);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const spread = maxPrice - minPrice;
    const avgDist = selectedComps.reduce((s, c) => s + c.distance, 0) / (selectedComps.length || 1);
    const avgDaysOld = selectedComps.reduce((s, c) => {
      return s + (Date.now() - new Date(c.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000);
    }, 0) / (selectedComps.length || 1);
    const avgCorrelation = allComps.reduce((s, c) => s + (c.correlation || 0.5), 0) / (allComps.length || 1);

    // ATTOM second-opinion block for assessment
    const attomAssessmentBlock = lead.attomAvm ? `
ATTOM DATA — INDEPENDENT PROPERTY INTELLIGENCE:
  AVM Estimate: $${Math.round(lead.attomAvm).toLocaleString()}${lead.attomAvmConfidence ? ` (${lead.attomAvmConfidence}% confidence score)` : ''}
  AS-IS / Distressed value:   ${lead.avmPoorHigh ? '$' + Math.round(lead.avmPoorHigh).toLocaleString() : 'N/A'}${lead.avmPoorLow ? ` – $${Math.round(lead.avmPoorLow).toLocaleString()} range` : ''}
  Good-condition value:       ${lead.avmGoodHigh ? '$' + Math.round(lead.avmGoodHigh).toLocaleString() : 'N/A'}
  After-repair ARV (excellent): ${lead.avmExcellentHigh ? '$' + Math.round(lead.avmExcellentHigh).toLocaleString() : 'N/A'}${lead.avmExcellentLow ? ` – $${Math.round(lead.avmExcellentLow).toLocaleString()} range` : ''}
  ATTOM Condition Rating: ${lead.propertyCondition || 'N/A'} | Quality: ${lead.propertyQuality || 'N/A'}
  Wall Type: ${lead.wallType || 'N/A'} | Stories: ${lead.stories || 'N/A'} | Basement: ${lead.basementSqft ? lead.basementSqft.toLocaleString() + ' sqft' : 'None'}
  Effective Year Built: ${lead.effectiveYearBuilt || 'N/A'} | Annual Tax: ${lead.annualTaxAmount ? '$' + Math.round(lead.annualTaxAmount).toLocaleString() + '/yr ($' + Math.round(lead.annualTaxAmount / 12).toLocaleString() + '/mo hold cost)' : 'N/A'}
  Assessed Value: ${lead.taxAssessedValue ? '$' + Math.round(lead.taxAssessedValue).toLocaleString() : 'N/A'} | Market Assessed: ${lead.marketAssessedValue ? '$' + Math.round(lead.marketAssessedValue).toLocaleString() : 'N/A'}
  Last Sale: ${lead.lastSalePrice ? '$' + Math.round(lead.lastSalePrice).toLocaleString() : 'N/A'} on ${lead.lastSaleDate ? new Date(lead.lastSaleDate).toLocaleDateString() : 'N/A'}
  Subdivision: ${lead.subdivision || 'N/A'}` : '';

    const prompt = `You are an expert real estate wholesaler analyzing a deal. Write a detailed property assessment for the following lead. Use clear section headers. Be direct, specific, and practical — no fluff.

SUBJECT PROPERTY:
Address: ${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}
Size: ${lead.sqft ? lead.sqft.toLocaleString() + ' sqft' : 'Unknown'}, ${lead.bedrooms || '?'}bd/${lead.bathrooms || '?'}ba
Type: ${lead.propertyType || 'Unknown'} | Seller Condition: ${lead.conditionLevel || 'Unknown'}
Asking Price: ${lead.askingPrice ? '$' + lead.askingPrice.toLocaleString() : 'Not provided'}
Risk-Adjusted ARV (system estimate): ${analysis.riskAdjustedArv ? '$' + analysis.riskAdjustedArv.toLocaleString() : 'Not calculated'}
Triangulated ARV: ${analysis.triangulatedArv ? '$' + analysis.triangulatedArv.toLocaleString() : 'Not calculated'}
Comparable Sales Value: ${analysis.comparableSalesValue ? '$' + Math.round(analysis.comparableSalesValue).toLocaleString() : 'Not calculated'}
Confidence Score: ${analysis.confidenceScore}/100
${attomAssessmentBlock}

COMP POOL STATS:
Total comps: ${allComps.length} | Selected: ${selectedComps.length}
Avg distance: ${avgDist.toFixed(2)} miles
Avg months ago: ${avgDaysOld.toFixed(1)} months
Avg RentCast correlation: ${(avgCorrelation * 100).toFixed(0)}%
Price spread (selected): $${minPrice.toLocaleString()} – $${maxPrice.toLocaleString()} ($${spread.toLocaleString()} spread)

TOP COMPS:
${selectedComps.slice(0, 8).map((c, i) => {
  const monthsAgo = Math.round((Date.now() - new Date(c.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000));
  return `${i + 1}. ${c.address} | $${c.soldPrice.toLocaleString()} | ${c.bedrooms || '?'}bd/${c.bathrooms || '?'}ba | ${c.sqft?.toLocaleString() || '?'}sqft | ${c.distance.toFixed(1)}mi | ${monthsAgo}mo ago | ${c.correlation ? (c.correlation * 100).toFixed(0) + '% match' : ''}`;
}).join('\n')}

Respond ONLY with a valid JSON object in this exact shape — no markdown, no explanation outside the JSON:
{
  "wholesalerNote": "<2-3 sentence bottom-line take: is this a deal, why or why not, what to watch>",
  "method": "<1-2 sentences on ARV confidence and comp quality — avg distance, recency, spread>",
  "keyFactors": ["<factor 1>", "<factor 2>", "<factor 3>", "<factor 4>"],
  "risks": ["<risk 1>", "<risk 2>", "<risk 3>"]
}

Rules:
- wholesalerNote: plain English, use the Risk-Adjusted ARV as the basis for MAO (70% × Risk-Adjusted ARV − $15k assignment fee), compare to asking price if known
- method: reference the confidence score and comp count specifically
- keyFactors: 3-5 bullet points — location, condition, seller motivation, equity position, market velocity
- risks: 2-4 bullet points — red flags, ARV uncertainty, market risks, property-specific concerns
- Be specific with dollar figures wherever possible`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      });
      const raw = (response.content[0] as any)?.text || '';

      // Parse JSON — store the structured object so the UI can render boxes
      let assessment = raw;
      try {
        const stripped = raw.replace(/^```[\w]*\s*/m, '').replace(/\s*```$/m, '').trim();
        const m = stripped.match(/\{[\s\S]*/);
        if (m) {
          let j = m[0];
          let opens = 0, arrOpens = 0, inStr = false, esc = false;
          for (const ch of j) {
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"' && !inStr) { inStr = true; continue; }
            if (ch === '"' && inStr) { inStr = false; continue; }
            if (!inStr) {
              if (ch === '{') opens++;
              else if (ch === '}') opens--;
              else if (ch === '[') arrOpens++;
              else if (ch === ']') arrOpens--;
            }
          }
          if (inStr) j += '"';
          j += ']'.repeat(Math.max(0, arrOpens)) + '}'.repeat(Math.max(0, opens));
          JSON.parse(j); // validate
          assessment = j; // store the repaired JSON
        }
      } catch {
        // Keep raw text as fallback — prose renderer will handle it
        this.logger.warn(`Assessment JSON parse failed for ${analysisId} — storing raw text`);
      }

      await this.prisma.compAnalysis.update({
        where: { id: analysisId },
        data: { aiAssessment: assessment },
      });

      return assessment;
    } catch (error) {
      this.logger.error('Assessment generation failed:', error);
      return 'Unable to generate assessment at this time.';
    }
  }

  // ─── Photo Analysis ───────────────────────────────────────────────────────

  async analyzePhotos(
    analysisId: string,
    photos: Express.Multer.File[],
  ): Promise<{ assessment: string; repairLow: number; repairHigh: number }> {
    const analysis = await this.getAnalysis(analysisId);
    if (!analysis) throw new Error('Analysis not found');
    if (!this.anthropic) throw new Error('Anthropic API key not configured');
    if (!photos || photos.length === 0) throw new Error('No photos provided');

    const lead = analysis.lead;

    // Build image content blocks (max 30, Anthropic supports up to 100 with claude-3-5-sonnet)
    const imageBlocks: Anthropic.ImageBlockParam[] = photos.slice(0, 30).map((photo) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: (photo.mimetype as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp') || 'image/jpeg',
        data: photo.buffer.toString('base64'),
      },
    }));

    const textPrompt = `You are an expert real estate wholesaler evaluating property condition from seller photos.

Property: ${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState}
Size: ${lead.sqft ? lead.sqft.toLocaleString() + ' sqft' : 'Unknown'}, built ${(lead as any).yearBuilt || 'unknown'}
ARV Estimate: ${analysis.arvEstimate ? '$' + analysis.arvEstimate.toLocaleString() : 'Unknown'}

Analyze these ${photos.length} property photo(s) and respond ONLY with valid JSON (no markdown, no explanation outside the JSON).

Return this exact structure:
{
  "rooms": [
    {
      "name": "string (room or area name)",
      "condition": "Good" | "Fair" | "Poor" | "Gut",
      "issues": ["string"],
      "repairs": ["string"],
      "urgency": "low" | "medium" | "high" | "critical"
    }
  ],
  "systems": {
    "roof": { "condition": "Good" | "Fair" | "Poor" | "Unknown", "notes": "string", "estimatedAge": "string" },
    "hvac": { "condition": "Good" | "Fair" | "Poor" | "Unknown", "notes": "string" },
    "electrical": { "condition": "Good" | "Fair" | "Poor" | "Unknown", "notes": "string" },
    "plumbing": { "condition": "Good" | "Fair" | "Poor" | "Unknown", "notes": "string" },
    "foundation": { "condition": "Good" | "Fair" | "Poor" | "Unknown", "notes": "string" }
  },
  "redFlags": ["string — only serious concerns like mold, structural, asbestos risk, code violations"],
  "repairItems": [
    { "item": "string", "estimateLow": number, "estimateHigh": number, "priority": "low" | "medium" | "high" | "critical" }
  ],
  "repairLow": number,
  "repairHigh": number,
  "overallCondition": "Good" | "Fair" | "Poor" | "Gut",
  "wholesalerNotes": "string — 2-3 sentence deal summary for a wholesaler"
}

Use Midwest/rural Ohio pricing. Be specific about what you see — don't generalize. Flag any serious concerns in redFlags.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [...imageBlocks, { type: 'text', text: textPrompt }],
        }],
      });

      const fullText = (response.content[0] as any)?.text || '';

      // Parse structured JSON response
      let parsed: any = null;
      let repairLow = 0;
      let repairHigh = 0;
      let assessment = fullText;

      try {
        // Strip markdown code fences if present (```json ... ```)
        const stripped = fullText.replace(/^```[\w]*\s*/m, '').replace(/\s*```$/m, '').trim();
        // Extract JSON from response (handle any surrounding whitespace)
        const jsonMatch = stripped.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
          repairLow = parsed.repairLow || 0;
          repairHigh = parsed.repairHigh || 0;
          assessment = JSON.stringify(parsed); // Store full structured data
        }
      } catch (parseErr) {
        // Fallback: try old-style REPAIR_LOW/HIGH parsing
        this.logger.warn('Could not parse structured JSON from photo analysis, falling back to text');
        const lowMatch = fullText.match(/REPAIR_LOW:\s*\$?([\d,]+)/i);
        const highMatch = fullText.match(/REPAIR_HIGH:\s*\$?([\d,]+)/i);
        repairLow = lowMatch ? parseInt(lowMatch[1].replace(/,/g, '')) : 0;
        repairHigh = highMatch ? parseInt(highMatch[1].replace(/,/g, '')) : 0;
        assessment = fullText
          .replace(/REPAIR_LOW:\s*\$?[\d,]+/i, '')
          .replace(/REPAIR_HIGH:\s*\$?[\d,]+/i, '')
          .trim();
      }

      await this.prisma.compAnalysis.update({
        where: { id: analysisId },
        data: {
          photoAnalysis: assessment,
          photoRepairLow: repairLow || null,
          photoRepairHigh: repairHigh || null,
          repairCosts: repairLow && repairHigh ? Math.round((repairLow + repairHigh) / 2) : undefined,
        },
      });

      return { assessment, repairLow, repairHigh };
    } catch (error) {
      this.logger.error('Photo analysis failed:', error);
      throw new Error(`Photo analysis failed: ${(error as any).message}`);
    }
  }

  /**
   * Auto-analyze photos already saved on a lead (as base64 data URIs).
   * Used by the MMS webhook to trigger photo repair analysis without a multipart upload.
   */
  async analyzePhotosFromLead(
    analysisId: string,
    leadId: string,
    source = 'seller-mms',
  ): Promise<{ assessment: string; repairLow: number; repairHigh: number }> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error('Lead not found');

    const allPhotos = (lead.photos as any[]) || [];
    const mmsPhotos = allPhotos.filter((p: any) => p.source === source);

    if (mmsPhotos.length === 0) {
      throw new Error(`No ${source} photos found for lead ${leadId}`);
    }

    // Convert base64 data URIs back to Multer-like objects for analyzePhotos()
    const multerFiles: Express.Multer.File[] = mmsPhotos.map((p: any, i: number) => {
      let buffer: Buffer;
      if (typeof p.url === 'string' && p.url.startsWith('data:')) {
        const base64Data = p.url.split(',')[1];
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        throw new Error(`Photo ${p.id} is not a base64 data URI`);
      }

      return {
        fieldname: 'photos',
        originalname: `seller-mms-${i}.jpg`,
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer,
        size: buffer.length,
      } as Express.Multer.File;
    });

    this.logger.log(`Auto-analyzing ${multerFiles.length} ${source} photos for lead ${leadId}`);
    return this.analyzePhotos(analysisId, multerFiles);
  }

  async saveToLead(analysisId: string) {
    const analysis = await this.prisma.compAnalysis.findUnique({
      where: { id: analysisId },
      include: { comps: { where: { selected: true } } },
    });
    if (!analysis) throw new Error('Analysis not found');

    // Use comparableSalesValue (AI estimated: avg $/sqft × sqft) as the primary ARV;
    // fall back to arvEstimate, then triangulated
    const finalArv = analysis.comparableSalesValue ?? analysis.arvEstimate ?? analysis.triangulatedArv;
    await this.prisma.lead.update({
      where: { id: analysis.leadId },
      data: {
        arv: finalArv,
        arvConfidence: analysis.confidenceScore,
        lastCompsDate: new Date(),
      },
    });

    await this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data: { savedToLead: true },
    });

    await this.prisma.activity.create({
      data: {
        leadId: analysis.leadId,
        type: 'COMP_ANALYSIS_SAVED',
        description: `Comp analysis saved — ARV: $${analysis.arvEstimate?.toLocaleString() || '?'}, ${analysis.comps.length} comps, ${analysis.confidenceScore}% confidence`,
        metadata: {
          analysisId,
          arv: analysis.arvEstimate,
          confidence: analysis.confidenceScore,
          compCount: analysis.comps.length,
        },
      },
    });

    return { success: true };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // THREE-MODEL VALUATION
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Cost Approach: Land value + depreciated replacement cost
   */
  async calculateCostApproach(analysisId: string) {
    const analysis = await this.prisma.compAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        lead: {
          select: {
            sqft: true, sqftOverride: true, yearBuilt: true, propertyType: true, lotSize: true,
            taxAssessedValue: true, effectiveYearBuilt: true, propertyCity: true,
            propertyState: true,
          },
        },
      },
    });
    if (!analysis) throw new Error('Analysis not found');

    const lead = analysis.lead as any;
    const sqft = lead.sqftOverride || lead.sqft;
    if (!sqft) {
      this.logger.warn(`Cost approach skipped for analysis ${analysisId}: no sqft data`);
      return null;
    }

    // Land value estimate
    let landValue: number;
    if (lead.taxAssessedValue) {
      landValue = Math.round(lead.taxAssessedValue * 0.20);
    } else {
      landValue = Math.round(sqft * 30);
    }
    landValue = Math.min(landValue, 150000);

    // Construction cost per sqft — default $150 as safe middle ground
    const constructionCostPerSqft = 150;

    // Depreciation: straight-line 1%/year, capped at 60%
    const currentYear = new Date().getFullYear();
    const effectiveYear = lead.effectiveYearBuilt ?? lead.yearBuilt ?? (currentYear - 20);
    const age = currentYear - effectiveYear;
    const depreciationRate = Math.min(Math.max(age, 0) * 0.01, 0.60);

    const buildCost = Math.round(sqft * constructionCostPerSqft);
    const costApproachValue = Math.round(landValue + buildCost * (1 - depreciationRate));

    await this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data: {
        costApproachValue,
        costApproachLandValue: landValue,
        costApproachBuildCost: buildCost,
        costApproachDepreciation: Math.round(depreciationRate * 100) / 100,
      },
    });

    this.logger.log(
      `Cost approach for ${analysisId}: $${costApproachValue.toLocaleString()} ` +
      `(land=$${landValue.toLocaleString()}, build=$${buildCost.toLocaleString()}, ` +
      `depr=${Math.round(depreciationRate * 100)}%, age=${age}yr)`,
    );

    return {
      costApproachValue,
      landValue,
      buildCost,
      depreciationRate: Math.round(depreciationRate * 100) / 100,
      age,
      constructionCostPerSqft,
    };
  }

  /**
   * Income Approach: Market rent × 12 × GRM
   */
  async calculateIncomeApproach(
    analysisId: string,
    marketRentOverride?: number,
    grmOverride?: number,
    isEstimated = false,
  ) {
    const analysis = await this.prisma.compAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        lead: {
          select: {
            propertyCity: true, propertyState: true, propertyAddress: true,
            propertyZip: true,
          },
        },
      },
    });
    if (!analysis) throw new Error('Analysis not found');

    const marketRent = marketRentOverride ?? null;
    if (!marketRent) {
      this.logger.warn(
        `Income approach skipped for analysis ${analysisId}: no market rent available. ` +
        `Provide marketRent override.`,
      );
      return {
        incomeApproachValue: null,
        note: 'No market rent data available. Provide a marketRent override to use income approach.',
      };
    }

    // GRM: default 10, allow override
    const grm = grmOverride ?? 10;

    const incomeApproachValue = Math.round(marketRent * 12 * grm);

    await this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data: {
        incomeApproachValue,
        marketRent,
        grossRentMultiplier: grm,
        marketRentEstimated: isEstimated,
      },
    });

    this.logger.log(
      `Income approach for ${analysisId}: $${incomeApproachValue.toLocaleString()} ` +
      `(rent=$${marketRent.toLocaleString()}/mo × 12 × GRM ${grm}${isEstimated ? ' [estimated]' : ''})`,
    );

    return {
      incomeApproachValue,
      marketRent,
      grossRentMultiplier: grm,
      annualRent: marketRent * 12,
      isEstimated,
    };
  }

  /**
   * Triangulated ARV: Weighted average of all available valuation methods
   * with divergence detection, neighborhood ceiling, and confidence tier.
   */
  async triangulateArv(analysisId: string) {
    const analysis = await this.prisma.compAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        comps: { where: { selected: true }, orderBy: { soldPrice: 'desc' } },
        lead: {
          select: {
            avmExcellentHigh: true, avmExcellentLow: true,
          },
        },
      },
    });
    if (!analysis) throw new Error('Analysis not found');

    const lead = analysis.lead as any;

    // Collect available method values — three core methods only (ATTOM excluded from triangulation)
    const methods: Record<string, number> = {};
    if (analysis.comparableSalesValue) methods.comps = analysis.comparableSalesValue;
    else if (analysis.arvEstimate) methods.comps = analysis.arvEstimate;
    if (analysis.costApproachValue) methods.cost = analysis.costApproachValue;
    if (analysis.incomeApproachValue) methods.income = analysis.incomeApproachValue;

    const methodKeys = Object.keys(methods);
    if (methodKeys.length === 0) {
      this.logger.warn(`Triangulation skipped for ${analysisId}: no method values available`);
      return null;
    }

    // Base weights: comps 50%, cost 25%, income 15% — renormalized to available methods
    const baseWeights: Record<string, number> = {
      comps: 0.50,
      cost: 0.25,
      income: 0.15,
    };

    const totalBaseWeight = methodKeys.reduce((s, k) => s + (baseWeights[k] || 0), 0);
    const weights: Record<string, number> = {};
    for (const k of methodKeys) {
      weights[k] = (baseWeights[k] || 0) / totalBaseWeight;
    }

    // Weighted average
    let triangulatedArv = 0;
    for (const k of methodKeys) {
      triangulatedArv += methods[k] * weights[k];
    }
    triangulatedArv = Math.round(triangulatedArv);

    // Divergence check
    const values = Object.values(methods);
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const methodDivergence = triangulatedArv > 0
      ? Math.round(((maxVal - minVal) / triangulatedArv) * 10000) / 100
      : 0;

    if (methodDivergence > 20) {
      this.logger.warn(
        `HIGH DIVERGENCE (${methodDivergence}%) for ${analysisId}: ` +
        `${JSON.stringify(methods)} → triangulated $${triangulatedArv.toLocaleString()}`,
      );
    } else if (methodDivergence > 10) {
      this.logger.log(
        `Moderate divergence (${methodDivergence}%) for ${analysisId}: ${JSON.stringify(methods)}`,
      );
    }

    // Neighborhood ceiling: top 3 comp sold prices
    let neighborhoodCeiling: number | null = null;
    let neighborhoodCeilingBreached = false;
    const selectedComps = analysis.comps;
    if (selectedComps.length > 0) {
      const topPrices = selectedComps
        .map((c) => c.soldPrice as number)
        .filter(Boolean)
        .sort((a, b) => b - a)
        .slice(0, 3);
      if (topPrices.length > 0) {
        neighborhoodCeiling = Math.round(
          topPrices.reduce((s, p) => s + p, 0) / topPrices.length,
        );
        neighborhoodCeilingBreached = triangulatedArv > neighborhoodCeiling * 1.05;
      }
    }

    // Confidence tier from existing confidenceScore
    const score = analysis.confidenceScore;
    let confidenceTier: string;
    if (selectedComps.length === 0) {
      confidenceTier = 'Low';
    } else if (score >= 70) {
      confidenceTier = 'High';
    } else if (score >= 40) {
      confidenceTier = 'Medium';
    } else {
      confidenceTier = 'Low';
    }

    // Range spread based on confidence
    const spreadPct = confidenceTier === 'High' ? 0.05
      : confidenceTier === 'Medium' ? 0.10
      : 0.15;
    const triangulatedArvLow = Math.round(triangulatedArv * (1 - spreadPct));
    const triangulatedArvHigh = Math.round(triangulatedArv * (1 + spreadPct));

    // Build method breakdown for storage
    const methodsUsed = methodKeys.map((k) => ({
      method: k,
      value: methods[k],
      weight: Math.round(weights[k] * 1000) / 1000,
    }));

    await this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data: {
        triangulatedArv,
        triangulatedArvLow,
        triangulatedArvHigh,
        methodsUsed,
        methodDivergence,
        neighborhoodCeiling,
        neighborhoodCeilingBreached,
        confidenceTier,
      },
    });

    this.logger.log(
      `Triangulated ARV for ${analysisId}: $${triangulatedArv.toLocaleString()} ` +
      `[${triangulatedArvLow.toLocaleString()}–${triangulatedArvHigh.toLocaleString()}] ` +
      `methods=${methodKeys.join('+')} divergence=${methodDivergence}% ` +
      `ceiling=${neighborhoodCeiling ? '$' + neighborhoodCeiling.toLocaleString() : 'N/A'}` +
      `${neighborhoodCeilingBreached ? ' ⚠ BREACHED' : ''} tier=${confidenceTier}`,
    );

    return {
      triangulatedArv,
      triangulatedArvLow,
      triangulatedArvHigh,
      methods: methodsUsed,
      methodDivergence,
      neighborhoodCeiling,
      neighborhoodCeilingBreached,
      confidenceTier,
      confidenceScore: score,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // PHASE 2: RISK FLAGS, CONDITION TIERS, SELLER MOTIVATION
  // ══════════════════════════════════════════════════════════════════════════════

  async assessRiskFlags(analysisId: string, overrides?: {
    functionalObsolescenceAdj?: number;
    buyerPoolReduction?: number;
    landUtilityReduction?: number;
  }) {
    // 3a. Fetch analysis + lead
    const analysis = await this.prisma.compAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        lead: {
          select: {
            bedrooms: true, bathrooms: true, sqft: true, propertyType: true,
            conditionLevel: true, distressSignals: true, sellerMotivation: true,
            lotSize: true, attomId: true, propertyCondition: true,
          },
        },
      },
    });
    if (!analysis) throw new Error('Analysis not found');

    const lead = analysis.lead as any;
    const riskFlags: string[] = [];

    // 3b. Functional Obsolescence — auto-detect
    let functionalObsolescenceAdj = 0;
    const functionalNotes: string[] = [];

    if (overrides?.functionalObsolescenceAdj != null) {
      functionalObsolescenceAdj = overrides.functionalObsolescenceAdj;
      functionalNotes.push(`Manual override: $${functionalObsolescenceAdj.toLocaleString()}`);
    } else {
      const propType = (lead.propertyType || '').toLowerCase();

      if (lead.bedrooms != null && lead.bedrooms <= 2 && (propType.includes('residential') || propType.includes('single'))) {
        functionalObsolescenceAdj += 20000;
        const flag = '2BR home — reduced buyer pool vs 3BR market';
        functionalNotes.push(flag);
        riskFlags.push(flag);
      }

      if (lead.bathrooms != null && lead.bathrooms < 1.5 && (lead.sqft ?? 0) > 1200) {
        functionalObsolescenceAdj += 12000;
        const flag = 'Insufficient bathrooms for property size';
        functionalNotes.push(flag);
        riskFlags.push(flag);
      }

      if (propType.includes('manufactured') || propType.includes('mobile')) {
        functionalObsolescenceAdj += 25000;
        const flag = 'Manufactured home — limited financing options';
        functionalNotes.push(flag);
        riskFlags.push(flag);
      }
    }

    this.logger.log(`Risk flags — functional obsolescence: $${functionalObsolescenceAdj.toLocaleString()} for ${analysisId}`);

    // 3c. Buyer Pool Shrinkage
    let buyerPoolReduction = 0;
    const buyerPoolNotes: string[] = [];

    if (overrides?.buyerPoolReduction != null) {
      buyerPoolReduction = overrides.buyerPoolReduction;
      buyerPoolNotes.push(`Manual override: ${(buyerPoolReduction * 100).toFixed(0)}%`);
    } else {
      const propType = (lead.propertyType || '').toLowerCase();

      if (propType.includes('manufactured') || propType.includes('mobile')) {
        buyerPoolReduction += 0.10;
        const flag = 'Manufactured/mobile home buyer pool';
        buyerPoolNotes.push(flag);
        riskFlags.push(flag);
      }

      if ((lead.lotSize ?? 0) > 10) {
        buyerPoolReduction += 0.05;
        const flag = 'Large rural acreage — limited buyer pool';
        buyerPoolNotes.push(flag);
        riskFlags.push(flag);
      }

      buyerPoolReduction = Math.min(buyerPoolReduction, 0.20);
    }

    // 3d. Land Utility
    let landUtilityReduction = 0;
    const landUtilityNotes: string[] = [];

    if (overrides?.landUtilityReduction != null) {
      landUtilityReduction = overrides.landUtilityReduction;
      landUtilityNotes.push(`Manual override: ${(landUtilityReduction * 100).toFixed(0)}%`);
    } else {
      if (lead.attomId && (lead.lotSize ?? 0) > 5) {
        landUtilityReduction = 0.05;
        const flag = 'Large rural parcel — verify flood zone and access';
        landUtilityNotes.push(flag);
        riskFlags.push(flag);
      }
    }

    // 3e. Risk-Adjusted ARV
    const base = analysis.triangulatedArv ?? analysis.arvEstimate ?? 0;
    const afterFunctional = base - functionalObsolescenceAdj;
    const afterBuyerPool = afterFunctional * (1 - buyerPoolReduction);
    const afterLand = afterBuyerPool * (1 - landUtilityReduction);
    const riskAdjustedArv = Math.round(afterLand);

    this.logger.log(
      `Risk-adjusted ARV for ${analysisId}: $${base.toLocaleString()} → $${riskAdjustedArv.toLocaleString()} ` +
      `(functional=-$${functionalObsolescenceAdj.toLocaleString()}, buyerPool=-${(buyerPoolReduction * 100).toFixed(0)}%, land=-${(landUtilityReduction * 100).toFixed(0)}%)`,
    );

    // 3f. Seller Motivation Tier
    const signals = ((lead.distressSignals as string[]) ?? []).map(s => s.toLowerCase());
    let sellerMotivationTier: string;

    if (signals.includes('foreclosure') || signals.includes('pre_foreclosure') || signals.includes('tax_lien')) {
      sellerMotivationTier = 'foreclosure';
    } else if (signals.includes('vacant') || signals.includes('code_violations') || signals.includes('major_repairs') || signals.includes('bankruptcy')) {
      sellerMotivationTier = 'severe_distress';
    } else if (signals.includes('divorce') || signals.includes('job_loss') || signals.includes('behind_on_payments') || signals.includes('estate_sale')) {
      sellerMotivationTier = 'distressed';
    } else if (signals.length > 0 || /motivated|need to sell|moving/i.test(lead.sellerMotivation || '')) {
      sellerMotivationTier = 'minor_distress';
    } else {
      sellerMotivationTier = 'normal';
    }

    const sellerMotivationMaoPercent = MOTIVATION_TIERS[sellerMotivationTier].maoPercent;
    this.logger.log(`Seller motivation tier for ${analysisId}: ${sellerMotivationTier} (MAO ${sellerMotivationMaoPercent}%)`);

    // 3g. Condition Tier + Repair Costs
    // Only calculate repair costs when we have explicit condition data from the seller
    // or a photo analysis. Generic ATTOM values (fair/good/poor) are not reliable enough
    // to generate repair estimates — leave repairs blank in that case.
    let conditionTier: string | null = null;
    const conditionLevel = (lead.conditionLevel || '').toLowerCase();
    const hasSellerCondition = conditionLevel.length > 0;
    const hasPhotoAnalysis = !!(analysis as any).photoRepairLow;

    if (hasSellerCondition) {
      if (/gut|tear|demolish/.test(conditionLevel)) {
        conditionTier = 'full_gut';
      } else if (/heavy|major|significant|complete/.test(conditionLevel)) {
        conditionTier = 'heavy_rehab';
      } else if (/moderate|medium|some/.test(conditionLevel)) {
        conditionTier = 'moderate_rehab';
      } else if (/light|cosmetic|minor|paint|carpet/.test(conditionLevel)) {
        conditionTier = 'light_cosmetic';
      } else if (/move|ready|excellent|great|updated|remodel/.test(conditionLevel)) {
        conditionTier = 'move_in_ready';
      }
      // Generic ATTOM-style words like "fair", "good", "poor" alone → no estimate
    }

    // Photo analysis overrides seller condition for repair estimates
    let repairCostLow: number | null = null;
    let repairCostHigh: number | null = null;
    let repairCostMid: number | null = null;

    if (hasPhotoAnalysis) {
      repairCostLow = (analysis as any).photoRepairLow;
      repairCostHigh = (analysis as any).photoRepairHigh;
      repairCostMid = Math.round((repairCostLow! + repairCostHigh!) / 2);
      conditionTier = conditionTier || 'moderate_rehab';
      this.logger.log(`Repair costs from photo analysis for ${analysisId}: $${repairCostLow}–$${repairCostHigh}`);
    } else if (conditionTier) {
      const sqft = (lead.sqftOverride || lead.sqft) ?? 1500;
      const rate = CONDITION_REPAIR_RATES[conditionTier];
      repairCostLow = Math.round(sqft * rate.low);
      repairCostHigh = Math.round(sqft * rate.high);
      repairCostMid = Math.round((repairCostLow + repairCostHigh) / 2);
      this.logger.log(
        `Condition tier for ${analysisId}: ${conditionTier} (${rate.label}) — ` +
        `repairs $${repairCostLow.toLocaleString()}–$${repairCostHigh.toLocaleString()} on ${sqft} sqft`,
      );
    } else {
      this.logger.log(`No repair estimate for ${analysisId} — no seller condition data or photo analysis`);
    }

    // 3i. Save to CompAnalysis
    const updated = await this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data: {
        functionalObsolescenceAdj,
        functionalObsolescenceNotes: functionalNotes.join('; ') || null,
        buyerPoolReduction,
        buyerPoolNotes: buyerPoolNotes.join('; ') || null,
        landUtilityReduction,
        landUtilityNotes: landUtilityNotes.join('; ') || null,
        riskAdjustedArv,
        riskFlags,
        sellerMotivationTier,
        sellerMotivationMaoPercent,
        conditionTier: conditionTier || null,
        repairCostLow: repairCostLow ?? null,
        repairCostHigh: repairCostHigh ?? null,
        repairCosts: repairCostMid ?? null,
      },
    });

    return {
      functionalObsolescenceAdj,
      functionalObsolescenceNotes: functionalNotes,
      buyerPoolReduction,
      buyerPoolNotes,
      landUtilityReduction,
      landUtilityNotes,
      riskAdjustedArv,
      riskFlags,
      sellerMotivationTier,
      sellerMotivationMaoPercent,
      sellerMotivationLabel: MOTIVATION_TIERS[sellerMotivationTier].label,
      conditionTier,
      conditionLabel: conditionTier ? CONDITION_REPAIR_RATES[conditionTier]?.label ?? null : null,
      repairCostLow,
      repairCostHigh,
      repairCostMid,
      baseArv: base,
    };
  }

  async updateAnalysis(analysisId: string, data: any) {
    return this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data,
    });
  }
}
