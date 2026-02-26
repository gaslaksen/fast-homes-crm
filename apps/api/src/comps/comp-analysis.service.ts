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
          selected: true,
        },
      });
    }

    this.logger.log(`Imported ${existingComps.length} existing comps into analysis ${analysisId}`);
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
            propertyType: true,
            askingPrice: true,
            arv: true,
            conditionLevel: true,
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
        lead: { select: { bedrooms: true, bathrooms: true, sqft: true } },
      },
    });
    if (!analysisRaw) throw new Error('Analysis not found');

    const analysis = analysisRaw as typeof analysisRaw & { lead: any; comps: any[] };
    const lead = analysis.lead;
    const adj = { ...DEFAULT_ADJUSTMENTS, ...config };

    const updatedComps = [];
    for (const comp of analysis.comps) {
      let adjustment = 0;
      const notes: string[] = [];

      // Size adjustment
      if (lead.sqft && comp.sqft) {
        const sqftDiff = lead.sqft - comp.sqft;
        if (sqftDiff !== 0) {
          const sqftAdj = sqftDiff * adj.pricePerSqft;
          adjustment += sqftAdj;
          notes.push(`Size: ${sqftDiff > 0 ? '+' : ''}$${sqftAdj.toLocaleString()} (${Math.abs(sqftDiff)} sqft ${sqftDiff > 0 ? 'smaller comp' : 'larger comp'})`);
        }
      }

      // Bedroom adjustment
      if (lead.bedrooms && comp.bedrooms) {
        const bedDiff = lead.bedrooms - comp.bedrooms;
        if (bedDiff !== 0) {
          const bedAdj = bedDiff * adj.perBedroom;
          adjustment += bedAdj;
          notes.push(`Beds: ${bedAdj > 0 ? '+' : ''}$${bedAdj.toLocaleString()} (${Math.abs(bedDiff)} bed diff)`);
        }
      }

      // Bathroom adjustment
      if (lead.bathrooms && comp.bathrooms) {
        const bathDiff = lead.bathrooms - comp.bathrooms;
        if (bathDiff !== 0) {
          const bathAdj = bathDiff * adj.perBathroom;
          adjustment += bathAdj;
          notes.push(`Baths: ${bathAdj > 0 ? '+' : ''}$${bathAdj.toLocaleString()} (${Math.abs(bathDiff)} bath diff)`);
        }
      }

      // Lot size adjustment
      if (comp.lotSize) {
        const lotDiff = 0; // Subject lot size not always available
        // Skip if no subject lot data
      }

      // Year built adjustment — skip if no subject year data (Lead model doesn't track year built)

      // Pool adjustment (if comp has pool but subject doesn't, subtract)
      if (comp.hasPool) {
        adjustment -= adj.pool;
        notes.push(`Pool: -$${adj.pool.toLocaleString()} (comp has pool)`);
      }

      // Garage adjustment
      if (comp.hasGarage) {
        // Assume subject doesn't have garage info — skip unless comp has it
      }

      // Renovation adjustment
      if (comp.isRenovated) {
        adjustment -= adj.renovated;
        notes.push(`Renovated: -$${adj.renovated.toLocaleString()} (comp was renovated)`);
      }

      const adjustedPrice = comp.soldPrice + adjustment;

      const updated = await this.prisma.comp.update({
        where: { id: comp.id },
        data: {
          adjustmentAmount: Math.round(adjustment),
          adjustedPrice: Math.round(adjustedPrice),
          adjustmentNotes: notes.join('\n'),
        },
      });
      updatedComps.push(updated);
    }

    // Calculate average adjustment
    const totalAdj = updatedComps.reduce((sum, c) => sum + (c.adjustmentAmount || 0), 0);
    const avgAdj = updatedComps.length > 0 ? Math.round(totalAdj / updatedComps.length) : 0;

    await this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data: {
        avgAdjustment: avgAdj,
        adjustmentConfig: adj as any,
        adjustmentsEnabled: true,
      },
    });

    return { comps: updatedComps, avgAdjustment: avgAdj };
  }

  async calculateArv(analysisId: string, method: string = 'average') {
    const analysis = await this.prisma.compAnalysis.findUnique({
      where: { id: analysisId },
      include: {
        comps: { where: { selected: true } },
        lead: { select: { sqft: true } },
      },
    });
    if (!analysis) throw new Error('Analysis not found');

    const comps = analysis.comps;
    if (comps.length === 0) return null;

    const useAdjusted = analysis.adjustmentsEnabled;
    const prices = comps.map((c) => useAdjusted && c.adjustedPrice ? c.adjustedPrice : c.soldPrice);

    let arv: number;
    if (method === 'median') {
      const sorted = [...prices].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      arv = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    } else if (method === 'weighted') {
      // Weight by inverse distance
      const totalWeight = comps.reduce((sum, c) => sum + (1 / Math.max(c.distance, 0.1)), 0);
      arv = comps.reduce((sum, c, i) => {
        const weight = (1 / Math.max(c.distance, 0.1)) / totalWeight;
        return sum + prices[i] * weight;
      }, 0);
    } else {
      arv = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    }

    arv = Math.round(arv);
    const arvLow = Math.round(Math.min(...prices));
    const arvHigh = Math.round(Math.max(...prices));

    // Price per sqft
    const totalSqft = comps.reduce((sum, c) => sum + (c.sqft || 0), 0);
    const avgSqft = comps.length > 0 ? Math.round(totalSqft / comps.length) : 0;
    const pricePerSqft = avgSqft > 0 ? Math.round(arv / avgSqft) : 0;

    // Confidence score
    const confidence = this.calculateConfidence(comps, analysis.lead as any);

    await this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data: {
        arvEstimate: arv,
        arvLow,
        arvHigh,
        arvMethod: method,
        pricePerSqft,
        confidenceScore: confidence,
      },
    });

    return { arv, arvLow, arvHigh, pricePerSqft, confidence, method };
  }

  private calculateConfidence(comps: any[], lead: any): number {
    let score = 0;

    // Number of comps (max 25 points)
    score += Math.min(comps.length * 5, 25);

    // Average distance (max 25 points)
    const avgDist = comps.reduce((s, c) => s + c.distance, 0) / comps.length;
    if (avgDist <= 0.5) score += 25;
    else if (avgDist <= 1) score += 20;
    else if (avgDist <= 2) score += 15;
    else if (avgDist <= 3) score += 10;
    else score += 5;

    // Sale recency (max 25 points)
    const now = Date.now();
    const avgMonthsAgo = comps.reduce((s, c) => {
      return s + (now - new Date(c.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000);
    }, 0) / comps.length;
    if (avgMonthsAgo <= 3) score += 25;
    else if (avgMonthsAgo <= 6) score += 20;
    else if (avgMonthsAgo <= 9) score += 15;
    else if (avgMonthsAgo <= 12) score += 10;
    else score += 5;

    // Size similarity (max 25 points)
    if (lead?.sqft) {
      const avgSqft = comps.reduce((s, c) => s + (c.sqft || lead.sqft), 0) / comps.length;
      const pctDiff = Math.abs(avgSqft - lead.sqft) / lead.sqft;
      if (pctDiff <= 0.05) score += 25;
      else if (pctDiff <= 0.1) score += 20;
      else if (pctDiff <= 0.2) score += 15;
      else if (pctDiff <= 0.3) score += 10;
      else score += 5;
    } else {
      score += 15; // neutral
    }

    return Math.min(score, 100);
  }

  async generateAiSummary(analysisId: string) {
    const analysis = await this.getAnalysis(analysisId);
    if (!analysis) throw new Error('Analysis not found');
    if (!this.anthropic) {
      return 'AI summary unavailable — Anthropic API key not configured.';
    }

    const lead = analysis.lead;
    const selectedComps = analysis.comps.filter((c) => c.selected);
    const avgSoldPrice = selectedComps.length > 0
      ? Math.round(selectedComps.reduce((s, c) => s + c.soldPrice, 0) / selectedComps.length)
      : 0;

    const prompt = `You are an expert real estate wholesaler analyzing comparable sales to determine ARV and offer strategy.

Subject Property:
- Address: ${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}
- ${lead.bedrooms || '?'}bd / ${lead.bathrooms || '?'}ba / ${lead.sqft?.toLocaleString() || '?'} sqft
- Property Type: ${lead.propertyType || 'Unknown'}
- Condition: ${lead.conditionLevel || 'Unknown'}
- Asking Price: ${lead.askingPrice ? '$' + lead.askingPrice.toLocaleString() : 'Unknown'}

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
1. ARV conclusion and confidence (is the comp pool strong or weak?)
2. Which comps are most relevant and why
3. Any red flags (wide price spread, old comps, low match scores, missing data)
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

    const arv = params.arv || analysis.arvEstimate || 0;
    const repairCosts = params.repairCosts ?? analysis.repairCosts ?? 0;
    const assignmentFee = params.assignmentFee ?? analysis.assignmentFee;
    const maoPercent = params.maoPercent ?? analysis.maoPercent;
    const dealType = params.dealType || analysis.dealType;

    // MAO = (ARV * maoPercent%) - repairs - assignment fee
    const mao = (arv * maoPercent / 100) - repairCosts - assignmentFee;
    // Initial offer = 95% of MAO
    const initialOffer = Math.round(mao * 0.95);
    // Sale price to buyer = MAO + assignment fee
    const salePrice = Math.round(mao + assignmentFee);

    await this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data: {
        assignmentFee,
        maoPercent,
        dealType,
        repairCosts,
      },
    });

    return {
      arv,
      repairCosts,
      assignmentFee,
      maoPercent,
      mao: Math.round(mao),
      initialOffer: Math.max(initialOffer, 0),
      salePrice: Math.max(salePrice, 0),
    };
  }

  // ─── AI Property Assessment ───────────────────────────────────────────────

  async generateAssessment(analysisId: string): Promise<string> {
    const analysis = await this.getAnalysis(analysisId);
    if (!analysis) throw new Error('Analysis not found');
    if (!this.anthropic) return 'AI assessment unavailable — Anthropic API key not configured.';

    const lead = analysis.lead;
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

    const prompt = `You are an expert real estate wholesaler analyzing a deal. Write a detailed property assessment for the following lead. Use clear section headers. Be direct, specific, and practical — no fluff.

SUBJECT PROPERTY:
Address: ${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}
Size: ${lead.sqft ? lead.sqft.toLocaleString() + ' sqft' : 'Unknown'}, ${lead.bedrooms || '?'}bd/${lead.bathrooms || '?'}ba
Type: ${lead.propertyType || 'Unknown'} | Condition: ${lead.conditionLevel || 'Unknown'}
Asking Price: ${lead.askingPrice ? '$' + lead.askingPrice.toLocaleString() : 'Not provided'}
Current ARV Estimate: ${analysis.arvEstimate ? '$' + analysis.arvEstimate.toLocaleString() : 'Not calculated'}
ARV Range: ${analysis.arvLow ? '$' + analysis.arvLow.toLocaleString() : '?'} – ${analysis.arvHigh ? '$' + analysis.arvHigh.toLocaleString() : '?'}
Confidence Score: ${analysis.confidenceScore}/100

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

Write a 400-600 word assessment with these sections:
**ARV Confidence & Comp Pool**
**Market Conditions**
**Red Flags & Concerns**
**Deal Viability**
**Recommended Offer Range**

Be specific with numbers. For deal viability, calculate MAO at 70% rule with $15k assignment fee and compare to asking price if known.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      });
      const assessment = (response.content[0] as any)?.text || 'Unable to generate assessment.';

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

    // Build image content blocks (max 15, Anthropic supports up to 20)
    const imageBlocks: Anthropic.ImageBlockParam[] = photos.slice(0, 15).map((photo) => ({
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

Analyze these ${photos.length} property photo(s). Provide:

1. **Room-by-Room Condition Assessment** — for each visible area: condition rating (Good/Fair/Poor/Gut), specific issues observed, repairs needed
2. **Systems Assessment** — HVAC, plumbing, electrical, roof (note if roof appears new/old)
3. **Repair Estimate Summary** — itemized list with cost ranges
4. **Total Repair Estimate** — provide a LOW and HIGH number in this exact format at the end:
   REPAIR_LOW: $XX,XXX
   REPAIR_HIGH: $XX,XXX

Use rural Texas pricing. Be specific about what you see — don't generalize. Flag any serious concerns (mold, structural, foundation, asbestos risk).`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [...imageBlocks, { type: 'text', text: textPrompt }],
        }],
      });

      const fullText = (response.content[0] as any)?.text || '';

      // Parse repair cost range from response
      const lowMatch = fullText.match(/REPAIR_LOW:\s*\$?([\d,]+)/i);
      const highMatch = fullText.match(/REPAIR_HIGH:\s*\$?([\d,]+)/i);
      const repairLow = lowMatch ? parseInt(lowMatch[1].replace(/,/g, '')) : 0;
      const repairHigh = highMatch ? parseInt(highMatch[1].replace(/,/g, '')) : 0;

      // Clean the display text (remove the machine-readable tags)
      const assessment = fullText
        .replace(/REPAIR_LOW:\s*\$?[\d,]+/i, '')
        .replace(/REPAIR_HIGH:\s*\$?[\d,]+/i, '')
        .trim();

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

  async saveToLead(analysisId: string) {
    const analysis = await this.prisma.compAnalysis.findUnique({
      where: { id: analysisId },
      include: { comps: { where: { selected: true } } },
    });
    if (!analysis) throw new Error('Analysis not found');

    await this.prisma.lead.update({
      where: { id: analysis.leadId },
      data: {
        arv: analysis.arvEstimate,
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

  async updateAnalysis(analysisId: string, data: any) {
    return this.prisma.compAnalysis.update({
      where: { id: analysisId },
      data,
    });
  }
}
