import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompsService } from '../comps/comps.service';
import { CompAnalysisService } from '../comps/comp-analysis.service';

export interface PropertyLookupInput {
  address: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  propertyType?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  lotSize?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
}

@Injectable()
export class PropertyLookupsService {
  private readonly logger = new Logger(PropertyLookupsService.name);

  constructor(
    private prisma: PrismaService,
    private compsService: CompsService,
    private compAnalysisService: CompAnalysisService,
  ) {}

  async create(input: PropertyLookupInput) {
    if (!input.address?.trim()) {
      throw new Error('address is required');
    }
    return this.prisma.propertyLookup.create({
      data: {
        address: input.address.trim(),
        city: input.city ?? null,
        state: input.state ?? null,
        zip: input.zip ?? null,
        propertyType: input.propertyType ?? null,
        bedrooms: input.bedrooms ?? null,
        bathrooms: input.bathrooms ?? null,
        sqft: input.sqft ?? null,
        yearBuilt: input.yearBuilt ?? null,
        lotSize: input.lotSize ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        notes: input.notes ?? null,
      },
    });
  }

  async list(opts: { archived?: boolean; search?: string }) {
    const where: any = {};
    if (opts.archived === false) where.archivedAt = null;
    if (opts.archived === true) where.archivedAt = { not: null };
    if (opts.search?.trim()) {
      const q = opts.search.trim();
      where.OR = [
        { address: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
        { zip: { contains: q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.propertyLookup.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        compAnalyses: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            arvEstimate: true,
            arvLow: true,
            arvHigh: true,
            confidenceScore: true,
            confidenceTier: true,
            repairCosts: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async getById(id: string) {
    const lookup = await this.prisma.propertyLookup.findUnique({
      where: { id },
      include: {
        compAnalyses: {
          orderBy: { createdAt: 'desc' },
          include: { comps: { where: { selected: true }, select: { id: true } } },
        },
      },
    });
    if (!lookup) throw new NotFoundException(`PropertyLookup ${id} not found`);
    return lookup;
  }

  async update(id: string, data: Partial<PropertyLookupInput>) {
    await this.assertExists(id);
    return this.prisma.propertyLookup.update({
      where: { id },
      data: {
        ...(data.address !== undefined ? { address: data.address.trim() } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.state !== undefined ? { state: data.state } : {}),
        ...(data.zip !== undefined ? { zip: data.zip } : {}),
        ...(data.propertyType !== undefined ? { propertyType: data.propertyType } : {}),
        ...(data.bedrooms !== undefined ? { bedrooms: data.bedrooms } : {}),
        ...(data.bathrooms !== undefined ? { bathrooms: data.bathrooms } : {}),
        ...(data.sqft !== undefined ? { sqft: data.sqft } : {}),
        ...(data.yearBuilt !== undefined ? { yearBuilt: data.yearBuilt } : {}),
        ...(data.lotSize !== undefined ? { lotSize: data.lotSize } : {}),
        ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
        ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
    });
  }

  async archive(id: string) {
    await this.assertExists(id);
    return this.prisma.propertyLookup.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  async unarchive(id: string) {
    await this.assertExists(id);
    return this.prisma.propertyLookup.update({
      where: { id },
      data: { archivedAt: null },
    });
  }

  async remove(id: string) {
    await this.assertExists(id);
    // Cascades to comp_analyses + comps via the FK ON DELETE CASCADE.
    await this.prisma.propertyLookup.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Bootstrap a CompAnalysis on this lookup and run a provider fetch. This is
   * the ad-hoc equivalent of "create a Lead + run comps". Returns the new
   * analysis row plus the fetch summary so the UI can navigate immediately.
   */
  async runAnalysis(
    id: string,
    opts: {
      preferSource?: 'reapi' | 'batchdata';
      forceRefresh?: boolean;
      mode?: string;
      maxDistance?: number;
      timeFrameMonths?: number;
      propertyType?: string;
    } = {},
  ) {
    const lookup = await this.assertExists(id);

    const analysis = await this.compAnalysisService.createAnalysisForParent(
      { kind: 'lookup', lookupId: id },
      {
        mode: opts.mode,
        maxDistance: opts.maxDistance,
        timeFrameMonths: opts.timeFrameMonths,
        propertyType: opts.propertyType,
        importExistingComps: false,
      },
    );

    let fetchResult: Awaited<ReturnType<typeof this.compsService.fetchCompsForLookup>> | null = null;
    try {
      fetchResult = await this.compsService.fetchCompsForLookup(id, {
        preferSource: opts.preferSource,
        forceRefresh: opts.forceRefresh,
      });
      this.logger.log(
        `Ad-hoc analysis ${analysis.id} for lookup ${id} (${lookup.address}): ` +
        `${fetchResult.compsCount} comps from ${fetchResult.source}`,
      );
    } catch (err) {
      this.logger.error(
        `Comp fetch failed for lookup ${id}: ${(err as Error).message}`,
      );
    }

    return { analysis, fetchResult, lookup };
  }

  private async assertExists(id: string) {
    const lookup = await this.prisma.propertyLookup.findUnique({ where: { id } });
    if (!lookup) throw new NotFoundException(`PropertyLookup ${id} not found`);
    return lookup;
  }
}
