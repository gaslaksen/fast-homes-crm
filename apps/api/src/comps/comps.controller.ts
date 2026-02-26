import { Controller, Post, Get, Patch, Param, Query, Body } from '@nestjs/common';
import { CompsService } from './comps.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('leads/:leadId/comps')
export class CompsController {
  constructor(
    private compsService: CompsService,
    private prisma: PrismaService,
  ) {}

  @Post()
  async fetchComps(
    @Param('leadId') leadId: string,
    @Query('forceRefresh') forceRefresh?: string,
  ) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        propertyZip: true,
      },
    });

    if (!lead) {
      throw new Error('Lead not found');
    }

    const result = await this.compsService.fetchComps(
      leadId,
      {
        street: lead.propertyAddress,
        city: lead.propertyCity,
        state: lead.propertyState,
        zip: lead.propertyZip,
      },
      { forceRefresh: forceRefresh === 'true' },
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
}
