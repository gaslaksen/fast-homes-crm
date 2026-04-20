import { Controller, Post, Get, Patch, Param, Query, Body, Logger } from '@nestjs/common';
import { CompsService } from './comps.service';
import { AttomService } from './attom.service';
import { CompAnalysisService } from './comp-analysis.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('leads/:leadId/comps')
export class CompsController {
  private readonly logger = new Logger(CompsController.name);

  constructor(
    private compsService: CompsService,
    private attomService: AttomService,
    private compAnalysisService: CompAnalysisService,
    private prisma: PrismaService,
  ) {}

  @Post()
  async fetchComps(
    @Param('leadId') leadId: string,
    @Query('forceRefresh') forceRefresh?: string,
    @Query('source') source?: string,
  ) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        propertyZip: true,
        compsProvider: true,
      },
    });

    if (!lead) {
      throw new Error('Lead not found');
    }

    // Provider priority: explicit ?source= → lead.compsProvider → 'reapi' default
    const preferSource =
      (source as 'reapi' | 'attom' | 'rentcast' | 'auto') ||
      (lead.compsProvider as 'reapi' | 'attom' | 'rentcast' | 'auto' | null) ||
      'reapi';

    const result = await this.compsService.fetchComps(
      leadId,
      {
        street: lead.propertyAddress,
        city: lead.propertyCity,
        state: lead.propertyState,
        zip: lead.propertyZip,
      },
      {
        forceRefresh: forceRefresh === 'true',
        preferSource,
      },
    );

    // Log activity
    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'COMPS_FETCHED',
        description: `Comps fetched from ${result.source}: ${result.compsCount} comparables found, ARV: $${result.arv.toLocaleString()}`,
        metadata: {
          source: result.source,
          count: result.compsCount,
          arv: result.arv,
          confidence: result.confidence,
        },
      },
    });

    // Auto-run full valuation pipeline so ARV tab is populated immediately
    // without requiring a manual Recalculate ARV click
    setImmediate(async () => {
      try {
        // Find or create a CompAnalysis for this lead
        const existing = await this.prisma.compAnalysis.findFirst({
          where: { leadId },
          orderBy: { updatedAt: 'desc' },
        });

        let analysisId: string;
        if (existing) {
          // Re-import any new comps that aren't linked yet
          await this.compAnalysisService.importExistingComps(existing.id, leadId);
          analysisId = existing.id;
        } else {
          const analysis = await this.compAnalysisService.createAnalysis(leadId, { importExistingComps: true });
          analysisId = analysis.id;
        }

        // Run the full pipeline: ARV → cost → income → triangulate → risk-adjust
        await this.compAnalysisService.calculateArv(analysisId, 'weighted');
        this.logger.log(`✅ Auto-calculated full ARV pipeline for lead ${leadId} (analysis ${analysisId})`);
      } catch (err) {
        this.logger.warn(`Auto ARV pipeline failed for lead ${leadId} (non-fatal): ${err.message}`);
      }
    });

    return result;
  }

  @Get()
  async getComps(@Param('leadId') leadId: string) {
    return this.compsService.getComps(leadId);
  }

  @Post(':compId/toggle')
  async toggleComp(@Param('compId') compId: string) {
    return this.compsService.toggleCompSelection(compId);
  }

  @Post('auto-select')
  async autoSelectComps(
    @Param('leadId') leadId: string,
    @Body() body: { minSimilarity?: number; maxDistance?: number },
  ) {
    return this.compsService.autoSelectComps(
      leadId,
      body.minSimilarity ?? 90,
      body.maxDistance ?? 3,
    );
  }

  @Post('recalculate-similarity')
  async recalculateSimilarity(@Param('leadId') leadId: string) {
    await this.compsService.recalculateSimilarityScores(leadId);
    return this.compsService.getComps(leadId);
  }

  @Get('zip-baseline')
  async getZipBaseline(@Param('leadId') leadId: string) {
    return this.compsService.getZipCodeBaseline(leadId);
  }

  /** Fetch/refresh ATTOM enrichment for a lead's subject property */
  @Post('attom-enrich')
  async attomEnrich(
    @Param('leadId') leadId: string,
    @Query('forceRefresh') forceRefresh?: string,
  ) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { propertyAddress: true, propertyCity: true, propertyState: true, propertyZip: true },
    });
    if (!lead) throw new Error('Lead not found');

    const result = await this.attomService.enrichLead(
      leadId,
      { street: lead.propertyAddress, city: lead.propertyCity, state: lead.propertyState, zip: lead.propertyZip },
      { forceRefresh: forceRefresh === 'true' },
    );
    return result ?? { error: 'ATTOM data not available for this property' };
  }

  /** Return ATTOM enrichment data already stored on the lead */
  @Get('attom-data')
  async getAttomData(@Param('leadId') leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        attomId: true, attomEnrichedAt: true,
        attomAvm: true, attomAvmLow: true, attomAvmHigh: true, attomAvmConfidence: true,
        avmPoorLow: true, avmPoorHigh: true,
        avmGoodLow: true, avmGoodHigh: true,
        avmExcellentLow: true, avmExcellentHigh: true,
        taxAssessedValue: true, marketAssessedValue: true, annualTaxAmount: true,
        propertyCondition: true, propertyQuality: true, wallType: true,
        stories: true, basementSqft: true, effectiveYearBuilt: true, subdivision: true,
        attomSaleHistory: true,
        // Also include property basics for context
        bedrooms: true, bathrooms: true, sqft: true, yearBuilt: true, lotSize: true,
        latitude: true, longitude: true, lastSaleDate: true, lastSalePrice: true,
      },
    });
    if (!lead) throw new Error('Lead not found');
    return lead;
  }
}
