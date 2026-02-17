import { Controller, Post, Get, Param } from '@nestjs/common';
import { CompsService } from './comps.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('leads/:leadId/comps')
export class CompsController {
  constructor(
    private compsService: CompsService,
    private prisma: PrismaService,
  ) {}

  @Post()
  async fetchComps(@Param('leadId') leadId: string) {
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

    const result = await this.compsService.fetchComps(leadId, {
      street: lead.propertyAddress,
      city: lead.propertyCity,
      state: lead.propertyState,
      zip: lead.propertyZip,
    });

    // Log activity
    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'COMPS_FETCHED',
        description: `Comps fetched: ${result.compsCount} comparables found, ARV: $${result.arv.toLocaleString()}`,
        metadata: {
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
}
