import { Controller, Post, Get, Patch, Param, Query, Body, Logger } from '@nestjs/common';
import { CompsService } from './comps.service';
import { CompAnalysisService } from './comp-analysis.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('leads/:leadId/comps')
export class CompsController {
  private readonly logger = new Logger(CompsController.name);

  constructor(
    private compsService: CompsService,
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
      (source as 'reapi' | 'batchdata' | 'auto') ||
      (lead.compsProvider as 'reapi' | 'batchdata' | 'auto' | null) ||
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

    // Import fresh comps into the lead's current CompAnalysis so the Comps tab
    // is populated when the user opens it. We intentionally do NOT auto-run
    // calculateArv here — user wants lead.arv to stay at the provider's
    // subject AVM (e.g. REAPI's $300,930) until they manually click "Calculate
    // ARV" from the Comps tab. Auto-calc was overwriting a reliable AVM with
    // a thin comps-based average (see the 1-comp-survives case in rural areas).
    setImmediate(async () => {
      try {
        const existing = await this.prisma.compAnalysis.findFirst({
          where: { leadId },
          orderBy: { updatedAt: 'desc' },
        });

        if (existing) {
          // Re-import any new comps that aren't linked yet
          await this.compAnalysisService.importExistingComps(existing.id, leadId);
          this.logger.log(`Comps imported into existing analysis ${existing.id} for lead ${leadId} (ARV calculation deferred to manual trigger)`);
        } else {
          const analysis = await this.compAnalysisService.createAnalysis(leadId, { importExistingComps: true });
          this.logger.log(`Comps imported into new analysis ${analysis.id} for lead ${leadId} (ARV calculation deferred to manual trigger)`);
        }
      } catch (err) {
        this.logger.warn(`Comp import failed for lead ${leadId} (non-fatal): ${err.message}`);
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
}
