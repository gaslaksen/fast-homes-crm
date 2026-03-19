import { Injectable, Inject, forwardRef, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { MessagesService } from '../messages/messages.service';
import { PhotosService } from '../photos/photos.service';
import { RentCastService } from '../comps/rentcast.service';
import { CompsService } from '../comps/comps.service';
import { AttomService } from '../comps/attom.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { LeadStatus, LeadSource, formatPhoneNumber } from '@fast-homes/shared';
import { Prisma } from '@prisma/client';
import { enrichAddressFromZip, cleanStreetAddress, lookupCityStateFromZip } from '../webhooks/address-parser';

const INITIAL_OUTREACH_DELAY_MS = 60_000; // 1 minute
const DEMO_OUTREACH_DELAY_MS = 3_000;     // 3 seconds in demo mode

/** Fields that trigger AI analysis refresh when changed */
const AI_REFRESH_FIELDS = ['arv', 'askingPrice', 'timeline', 'conditionLevel', 'ownershipStatus'];

// Convert lot size: if value > 10 it's almost certainly sqft, convert to acres
function normalizeLotSize(raw: number | undefined): number | undefined {
  if (!raw) return undefined;
  return raw > 100 ? parseFloat((raw / 43560).toFixed(4)) : raw;
}

// Get most recent tax assessed value from RentCast taxAssessments map
function latestTaxAssessment(taxAssessments?: Record<string, any>): number | undefined {
  if (!taxAssessments) return undefined;
  const years = Object.keys(taxAssessments).sort().reverse();
  return years.length ? taxAssessments[years[0]]?.value : undefined;
}


@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private prisma: PrismaService,
    private scoringService: ScoringService,
    @Inject(forwardRef(() => MessagesService))
    private messagesService: MessagesService,
    @Optional() private photosService: PhotosService,
    private rentCastService: RentCastService,
    private compsService: CompsService,
    private attomService: AttomService,
    private pipelineService: PipelineService,
  ) {}

  /**
   * Create a new lead
   */
  async createLead(data: {
    source: LeadSource;
    propertyAddress: string;
    propertyCity: string;
    propertyState: string;
    propertyZip: string;
    sellerFirstName: string;
    sellerLastName: string;
    sellerPhone: string;
    sellerEmail?: string;
    propertyType?: string;
    bedrooms?: number;
    bathrooms?: number;
    sqft?: number;
    yearBuilt?: number;
    lotSize?: number;
    timeline?: number;
    askingPrice?: number;
    conditionLevel?: string;
    distressSignals?: string[];
    ownershipStatus?: string;
    assignedToUserId?: string;
    sourceMetadata?: any;
    organizationId?: string;
  }) {
    // Enrich address — fill in missing city/state from zip lookup if needed
    const enriched = await enrichAddressFromZip({
      propertyAddress: data.propertyAddress || '',
      propertyCity: data.propertyCity || '',
      propertyState: data.propertyState || '',
      propertyZip: data.propertyZip || '',
    });
    data.propertyAddress = enriched.propertyAddress;
    data.propertyCity = enriched.propertyCity;
    data.propertyState = enriched.propertyState;
    data.propertyZip = enriched.propertyZip;

    // Initial scoring
    const scoringResult = await this.scoringService.scoreLead({
      timeline: data.timeline,
      askingPrice: data.askingPrice,
      conditionLevel: data.conditionLevel,
      distressSignals: data.distressSignals,
      ownershipStatus: data.ownershipStatus,
    });

    // Always store phone in E.164 format so inbound webhook lookups match
    if (data.sellerPhone) {
      data.sellerPhone = formatPhoneNumber(data.sellerPhone);
    }

    const lead = await this.prisma.lead.create({
      data: {
        ...data,
        challengeScore: scoringResult.challengeScore,
        authorityScore: scoringResult.authorityScore,
        moneyScore: scoringResult.moneyScore,
        priorityScore: scoringResult.priorityScore,
        totalScore: scoringResult.totalScore,
        scoreBand: scoringResult.scoreBand,
        abcdFit: scoringResult.abcdFit,
        scoringRationale: scoringResult.rationale,
        lastScoredAt: new Date(),
        // Pre-populate CAMP flags
        campPriorityComplete: data.timeline != null,
        campMoneyComplete: data.askingPrice != null,
        campChallengeComplete: data.conditionLevel != null,
        campAuthorityComplete: data.ownershipStatus != null,
        // Pipeline tracking
        lastTouchedAt: new Date(),
        touchCount: 0,
        daysInStage: 0,
      },
    });

    // Log activity
    await this.prisma.activity.create({
      data: {
        leadId: lead.id,
        type: 'LEAD_CREATED',
        description: `Lead created from ${data.source}`,
        metadata: { source: data.source },
      },
    });

    // Schedule automatic initial outreach
    if (lead.autoRespond && !lead.doNotContact) {
      this.scheduleInitialOutreach(lead.id);
    }

    // Non-blocking photo fetch from all sources (Street View + SerpAPI)
    if (this.photosService) {
      console.log(`📍 Lead created: ${lead.id} - ${data.propertyAddress}. Fetching photos...`);
      this.photosService.fetchAllPhotos(lead.id).catch((err) => {
        console.log(`⚠️ Photo fetch failed for ${lead.id}: ${err.message}`);
      });
    } else {
      console.log(`📍 Lead created: ${lead.id} - ${data.propertyAddress}. No PhotosService available.`);
    }

    // Auto-populate property details from RentCast (non-blocking)
    this.autoPopulatePropertyDetails(lead.id, data).catch((err) => {
      this.logger.error(`Property details auto-population failed for ${lead.id}: ${err.message}`);
    });

    return lead;
  }

  /**
   * Schedule the initial outreach message after a short delay.
   * Uses setImmediate in demo mode (next tick) and a short setTimeout otherwise.
   * Kept intentionally short — Railway restarts kill long timers.
   */
  private async scheduleInitialOutreach(leadId: string) {
    let delay = INITIAL_OUTREACH_DELAY_MS;
    try {
      const settings = await this.prisma.dripSettings.findUnique({ where: { id: 'default' } });
      if (settings?.demoMode) {
        delay = DEMO_OUTREACH_DELAY_MS;
      }
    } catch {
      // Use default delay
    }

    this.logger.log(`Scheduling initial outreach for lead ${leadId} in ${delay}ms`);

    const fire = async () => {
      try {
        await this.messagesService.sendInitialOutreach(leadId);
      } catch (error) {
        this.logger.error(`Initial outreach failed for lead ${leadId}: ${error.message}`);
      }
    };

    if (delay <= 5000) {
      // Demo mode or very short delay — fire on next event loop tick
      setImmediate(fire);
    } else {
      setTimeout(fire, delay);
    }
  }

  /**
   * Auto-populate property details from RentCast, then fetch comps.
   */
  private async autoPopulatePropertyDetails(
    leadId: string,
    data: { propertyAddress: string; propertyCity: string; propertyState: string; propertyZip: string },
  ) {
    // Skip if no address
    if (!data.propertyAddress || !data.propertyCity) return;

    const address = `${data.propertyAddress}, ${data.propertyCity}, ${data.propertyState} ${data.propertyZip}`;
    this.logger.log(`Looking up property details for lead ${leadId}: ${address}`);

    const property = await this.rentCastService.getPropertyDetails(address);

    if (property) {
      // Only update fields that aren't already set on the lead
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        select: { bedrooms: true, bathrooms: true, sqft: true, propertyType: true, yearBuilt: true, lotSize: true },
      });

      const updates: Record<string, any> = {};
      if (!lead?.bedrooms && property.bedrooms) updates.bedrooms = property.bedrooms;
      if (!lead?.bathrooms && property.bathrooms) updates.bathrooms = property.bathrooms;
      if (!lead?.sqft && property.squareFootage) updates.sqft = property.squareFootage;
      if (!lead?.propertyType && property.propertyType) updates.propertyType = property.propertyType;
      if (!lead?.yearBuilt && property.yearBuilt) updates.yearBuilt = property.yearBuilt;
      if (property.lotSize) updates.lotSize = normalizeLotSize(property.lotSize);
      if (property.lastSaleDate) updates.lastSaleDate = new Date(property.lastSaleDate);
      if (property.lastSalePrice) updates.lastSalePrice = property.lastSalePrice;
      const taxVal = latestTaxAssessment((property as any).taxAssessments);
      if (taxVal) updates.taxAssessedValue = taxVal;
      if ((property as any).ownerOccupied != null) updates.ownerOccupied = (property as any).ownerOccupied;
      if (property.hoa?.fee) updates.hoaFee = property.hoa.fee;

      if (Object.keys(updates).length > 0) {
        await this.prisma.lead.update({
          where: { id: leadId },
          data: updates,
        });

        this.logger.log(`Property details auto-populated for lead ${leadId}: ${JSON.stringify(updates)}`);

        await this.prisma.activity.create({
          data: {
            leadId,
            type: 'FIELD_UPDATED',
            description: `Property details auto-populated from public records (${Object.keys(updates).join(', ')})`,
            metadata: { source: 'rentcast', fields: Object.keys(updates) },
          },
        });
      }
    } else {
      this.logger.warn(`Property details not found for lead ${leadId}`);
      await this.prisma.activity.create({
        data: {
          leadId,
          type: 'FIELD_UPDATED',
          description: 'Property details not found in public records — manual entry may be needed',
        },
      });
    }

    // ATTOM enrichment: AVM, tax assessment, pool, cooling, APN, owner name, condition-adjusted ARV
    if (this.attomService.isConfigured) {
      this.attomService.enrichLead(leadId, {
        street: data.propertyAddress,
        city: data.propertyCity,
        state: data.propertyState,
        zip: data.propertyZip,
      }).catch((err) => {
        this.logger.error(`ATTOM enrichment failed for lead ${leadId}: ${err.message}`);
      });
    }

    // Fetch comps now that we may have property details
    await this.fetchCompsForLead(leadId);
  }

  /**
   * Fetch comps for a lead using the CompsService fallback chain.
   */
  async fetchCompsForLead(leadId: string): Promise<void> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        propertyZip: true,
        bedrooms: true,
        sqft: true,
      },
    });
    if (!lead) return;

    if (!lead.bedrooms && !lead.sqft) {
      this.logger.warn(`Missing property details for lead ${leadId}, skipping comps fetch`);
      return;
    }

    this.logger.log(`Fetching comps for lead ${leadId}`);

    try {
      const result = await this.compsService.fetchComps(leadId, {
        street: lead.propertyAddress,
        city: lead.propertyCity,
        state: lead.propertyState,
        zip: lead.propertyZip,
      });

      this.logger.log(
        `Comps fetched for lead ${leadId}: ${result.compsCount} comps, ARV: $${result.arv.toLocaleString()} (${result.source})`,
      );
    } catch (error) {
      this.logger.error(`Comps fetch failed for lead ${leadId}: ${error.message}`);
    }
  }

  /**
   * Refresh property details from RentCast for an existing lead.
   */
  async refreshPropertyDetails(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        propertyZip: true,
      },
    });
    if (!lead) throw new Error('Lead not found');

    const address = `${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}`;
    const property = await this.rentCastService.getPropertyDetails(address);

    if (!property) {
      return { success: false, message: 'Property details not found' };
    }

    const updates: Record<string, any> = {};
    if (property.bedrooms) updates.bedrooms = property.bedrooms;
    if (property.bathrooms) updates.bathrooms = property.bathrooms;
    if (property.squareFootage) updates.sqft = property.squareFootage;
    if (property.propertyType) updates.propertyType = property.propertyType;
    if (property.yearBuilt) updates.yearBuilt = property.yearBuilt;
    if (property.lotSize) updates.lotSize = normalizeLotSize(property.lotSize);
    if (property.lastSaleDate) updates.lastSaleDate = new Date(property.lastSaleDate);
    if (property.lastSalePrice) updates.lastSalePrice = property.lastSalePrice;
    const taxVal = latestTaxAssessment((property as any).taxAssessments);
    if (taxVal) updates.taxAssessedValue = taxVal;
    if ((property as any).ownerOccupied != null) updates.ownerOccupied = (property as any).ownerOccupied;
    if (property.hoa?.fee) updates.hoaFee = property.hoa.fee;

    if (Object.keys(updates).length > 0) {
      await this.prisma.lead.update({
        where: { id: leadId },
        data: updates,
      });

      await this.prisma.activity.create({
        data: {
          leadId,
          type: 'FIELD_UPDATED',
          description: `Property details refreshed from public records (${Object.keys(updates).join(', ')})`,
          metadata: { source: 'rentcast', fields: Object.keys(updates) },
        },
      });
    }

    return {
      success: true,
      details: updates,
      message: `Property details updated: ${Object.keys(updates).join(', ')}`,
    };
  }

  /**
   * Get lead by ID
   */
  async getLead(id: string) {
    return this.prisma.lead.findUnique({
      where: { id },
      include: {
        assignedTo: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        comps: {
          orderBy: { distance: 'asc' },
        },
        tasks: {
          orderBy: { createdAt: 'desc' },
        },
        notes: {
          orderBy: { createdAt: 'desc' },
          include: { user: true },
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { user: true },
        },
        contract: true,
        offers: {
          orderBy: { createdAt: 'desc' },
        },
        callLogs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
  }

  /**
   * List leads with filters
   */
  async listLeads(filters: {
    source?: LeadSource;
    status?: LeadStatus;
    scoreBand?: string;
    assignedToUserId?: string;
    zip?: string;
    minScore?: number;
    maxScore?: number;
    search?: string;
    createdAfter?: string;
    createdBefore?: string;
    page?: number;
    limit?: number;
    organizationId?: string;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const skip = (page - 1) * limit;

    const where: Prisma.LeadWhereInput = {};

    if (filters.source) where.source = filters.source;
    if (filters.status) where.status = filters.status;
    if (filters.scoreBand) where.scoreBand = filters.scoreBand as any;
    if (filters.assignedToUserId === 'none') {
      where.assignedToUserId = null;
    } else if (filters.assignedToUserId) {
      where.assignedToUserId = filters.assignedToUserId;
    }
    if (filters.zip) where.propertyZip = filters.zip;
    if (filters.minScore || filters.maxScore) {
      const scoreFilter: Prisma.IntFilter<'Lead'> = {};
      if (filters.minScore) scoreFilter.gte = filters.minScore;
      if (filters.maxScore) scoreFilter.lte = filters.maxScore;
      where.totalScore = scoreFilter;
    }

    if (filters.organizationId) where.organizationId = filters.organizationId;

    if (filters.search) {
      where.OR = [
        { propertyAddress: { contains: filters.search, mode: 'insensitive' } },
        { sellerFirstName: { contains: filters.search, mode: 'insensitive' } },
        { sellerLastName: { contains: filters.search, mode: 'insensitive' } },
        { sellerPhone: { contains: filters.search, mode: 'insensitive' } },
        { sellerEmail: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (filters.createdAfter || filters.createdBefore) {
      const dateFilter: Prisma.DateTimeFilter<'Lead'> = {};
      if (filters.createdAfter) dateFilter.gte = new Date(filters.createdAfter);
      if (filters.createdBefore) dateFilter.lte = new Date(filters.createdBefore);
      where.createdAt = dateFilter;
    }

    const [leads, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: {
          assignedTo: true,
        },
        orderBy: [
          { totalScore: 'desc' },
          { createdAt: 'desc' },
        ],
        skip,
        take: limit,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      leads,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update lead
   */
  async updateLead(id: string, data: {
    status?: LeadStatus;
    propertyType?: string;
    bedrooms?: number;
    bathrooms?: number;
    sqft?: number;
    timeline?: number;
    askingPrice?: number;
    conditionLevel?: string;
    distressSignals?: string[];
    ownershipStatus?: string;
    arv?: number;
    assignedToUserId?: string;
    tags?: string[];
    autoRespond?: boolean;
    [key: string]: any;
  }) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new Error('Lead not found');

    // Track status change
    if (data.status && data.status !== lead.status) {
      await this.prisma.activity.create({
        data: {
          leadId: id,
          type: 'STATUS_CHANGED',
          description: `Status changed from ${lead.status} to ${data.status}`,
          metadata: { oldStatus: lead.status, newStatus: data.status },
        },
      });
    }

    // Track field updates
    const scoringFields = ['timeline', 'askingPrice', 'conditionLevel', 'distressSignals', 'ownershipStatus', 'arv'];
    const needsRescore = scoringFields.some(field => field in data);

    // Update lead
    const updated = await this.prisma.lead.update({
      where: { id },
      data: data as Prisma.LeadUncheckedUpdateInput,
    });

    // Rescore if needed
    if (needsRescore) {
      const scoringResult = await this.scoringService.scoreLead({
        timeline: updated.timeline,
        askingPrice: updated.askingPrice,
        arv: updated.arv,
        conditionLevel: updated.conditionLevel,
        distressSignals: updated.distressSignals as string[] | undefined,
        ownershipStatus: updated.ownershipStatus,
      });

      await this.prisma.lead.update({
        where: { id },
        data: {
          challengeScore: scoringResult.challengeScore,
          authorityScore: scoringResult.authorityScore,
          moneyScore: scoringResult.moneyScore,
          priorityScore: scoringResult.priorityScore,
          totalScore: scoringResult.totalScore,
          scoreBand: scoringResult.scoreBand,
          abcdFit: scoringResult.abcdFit,
          scoringRationale: scoringResult.rationale,
          lastScoredAt: new Date(),
        },
      });

      // Refresh CAMP flags
      await this.scoringService.refreshCampFlags(id);

      if (lead.totalScore !== scoringResult.totalScore) {
        await this.prisma.activity.create({
          data: {
            leadId: id,
            type: 'SCORE_UPDATED',
            description: `Score updated: ${lead.totalScore} → ${scoringResult.totalScore} (${scoringResult.scoreBand})`,
            metadata: {
              oldScore: lead.totalScore,
              newScore: scoringResult.totalScore,
              oldBand: lead.scoreBand,
              newBand: scoringResult.scoreBand,
            },
          },
        });
      }
    }

    // Auto-refresh AI analysis if key deal data changed
    const shouldRefreshAi = AI_REFRESH_FIELDS.some((field) => data[field] !== undefined);
    if (shouldRefreshAi) {
      this.logger.log(`Key data changed for lead ${id}, refreshing AI analysis in background`);
      this.pipelineService.generateLeadAnalysis(id).catch((err) =>
        this.logger.error(`Background AI analysis refresh failed for ${id}: ${err.message}`),
      );
    }

    return this.getLead(id);
  }

  /**
   * Backfill city/state on leads where those fields are blank but a zip is present.
   * Uses the free zippopotam.us API. Safe to run multiple times.
   */
  async backfillMissingCityState(): Promise<{ updated: number; skipped: number; failed: number }> {
    // Find leads missing city/state OR with potentially dirty street fields
    const leads = await this.prisma.lead.findMany({
      select: { id: true, propertyAddress: true, propertyCity: true, propertyState: true, propertyZip: true },
    });

    this.logger.log(`backfillMissingCityState: ${leads.length} leads to process`);

    let updated = 0, skipped = 0, failed = 0;

    for (const lead of leads) {
      try {
        const patch: Record<string, string> = {};

        // 1. Clean the street address field (strip embedded city/state/zip/country)
        if (lead.propertyAddress) {
          const cleanStreet = cleanStreetAddress(lead.propertyAddress);
          if (cleanStreet !== lead.propertyAddress) {
            patch.propertyAddress = cleanStreet;
          }
        }

        // 2. Fill in missing city/state from zip
        if (lead.propertyZip && (!lead.propertyCity || !lead.propertyState)) {
          const looked = await lookupCityStateFromZip(lead.propertyZip);
          if (looked) {
            if (!lead.propertyCity) patch.propertyCity = looked.city;
            if (!lead.propertyState) patch.propertyState = looked.state;
          }
        }

        if (Object.keys(patch).length === 0) { skipped++; continue; }

        await this.prisma.lead.update({ where: { id: lead.id }, data: patch });
        await this.prisma.activity.create({
          data: {
            leadId: lead.id,
            type: 'FIELD_UPDATED',
            description: `Address cleaned: ${Object.entries(patch).map(([k, v]) => `${k}="${v}"`).join(', ')}`,
            metadata: { source: 'address-backfill', ...patch },
          },
        });
        updated++;
      } catch (err) {
        this.logger.error(`backfillMissingCityState: failed for lead ${lead.id}: ${err.message}`);
        failed++;
      }
    }

    this.logger.log(`backfillMissingCityState complete: updated=${updated}, skipped=${skipped}, failed=${failed}`);
    return { updated, skipped, failed };
  }

  /**
   * Normalize all stored phone numbers to E.164 (+1XXXXXXXXXX) format.
   * Safe to run multiple times — skips numbers already in E.164.
   */
  async normalizeAllPhones(): Promise<{ updated: number; skipped: number }> {
    const leads = await this.prisma.lead.findMany({ select: { id: true, sellerPhone: true } });
    let updated = 0;
    let skipped = 0;
    for (const lead of leads) {
      if (!lead.sellerPhone) { skipped++; continue; }
      const normalized = formatPhoneNumber(lead.sellerPhone);
      if (normalized === lead.sellerPhone) { skipped++; continue; }
      await this.prisma.lead.update({ where: { id: lead.id }, data: { sellerPhone: normalized } });
      updated++;
    }
    this.logger.log(`normalizeAllPhones: updated=${updated}, skipped=${skipped}`);
    return { updated, skipped };
  }

  /**
   * Manually trigger initial outreach for a lead (useful for testing / retroactive sends)
   */
  async triggerInitialOutreach(leadId: string): Promise<string | null> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error('Lead not found');
    if (lead.doNotContact) throw new Error('Lead is marked Do Not Contact');
    return this.messagesService.sendInitialOutreach(leadId);
  }

  /**
   * Create task for lead
   */
  async createTask(leadId: string, data: {
    title: string;
    description?: string;
    dueDate?: Date;
    userId?: string;
  }) {
    const task = await this.prisma.task.create({
      data: {
        leadId,
        ...data,
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        userId: data.userId,
        type: 'TASK_CREATED',
        description: `Task created: ${data.title}`,
        metadata: { title: data.title },
      },
    });

    return task;
  }

  /**
   * Complete task
   */
  async completeTask(taskId: string, userId?: string) {
    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        completed: true,
        completedAt: new Date(),
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId: task.leadId,
        userId,
        type: 'TASK_COMPLETED',
        description: `Task completed: ${task.title}`,
        metadata: { title: task.title },
      },
    });

    return task;
  }

  /**
   * Add note to lead
   */
  async addNote(leadId: string, content: string, userId: string) {
    const note = await this.prisma.note.create({
      data: {
        leadId,
        userId,
        content,
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        userId,
        type: 'NOTE_ADDED',
        description: 'Note added',
      },
    });

    return note;
  }

  /**
   * Bulk delete leads by IDs
   */
  async bulkDelete(ids: string[]): Promise<{ deleted: number }> {
    const result = await this.prisma.lead.deleteMany({
      where: { id: { in: ids } },
    });
    return { deleted: result.count };
  }

  /**
   * Bulk update lead status
   */
  async bulkUpdateStatus(ids: string[], status: LeadStatus): Promise<{ updated: number }> {
    const result = await this.prisma.lead.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });
    return { updated: result.count };
  }

  /**
   * Export leads as CSV string
   */
  async exportCsv(filters: {
    source?: LeadSource;
    status?: LeadStatus;
    scoreBand?: string;
    search?: string;
    createdAfter?: string;
    createdBefore?: string;
  }): Promise<string> {
    const where: Prisma.LeadWhereInput = {};
    if (filters.source) where.source = filters.source;
    if (filters.status) where.status = filters.status;
    if (filters.scoreBand) where.scoreBand = filters.scoreBand as any;
    if (filters.search) {
      where.OR = [
        { propertyAddress: { contains: filters.search, mode: 'insensitive' } },
        { sellerFirstName: { contains: filters.search, mode: 'insensitive' } },
        { sellerLastName: { contains: filters.search, mode: 'insensitive' } },
        { sellerPhone: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.createdAfter || filters.createdBefore) {
      const dateFilter: Prisma.DateTimeFilter<'Lead'> = {};
      if (filters.createdAfter) dateFilter.gte = new Date(filters.createdAfter);
      if (filters.createdBefore) dateFilter.lte = new Date(filters.createdBefore);
      where.createdAt = dateFilter;
    }

    const leads = await this.prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' } });

    const headers = ['Name', 'Phone', 'Email', 'Address', 'City', 'State', 'Zip', 'Status', 'Score', 'Band', 'Source', 'Created', 'Timeline', 'Asking Price'];
    const csvEscape = (val: string | null | undefined) => {
      if (val == null) return '';
      const str = String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const rows = leads.map((l) => [
      csvEscape(`${l.sellerFirstName} ${l.sellerLastName}`),
      csvEscape(l.sellerPhone),
      csvEscape(l.sellerEmail),
      csvEscape(l.propertyAddress),
      csvEscape(l.propertyCity),
      csvEscape(l.propertyState),
      csvEscape(l.propertyZip),
      csvEscape(l.status),
      l.totalScore ?? '',
      csvEscape(l.scoreBand),
      csvEscape(l.source),
      l.createdAt ? new Date(l.createdAt).toISOString().split('T')[0] : '',
      l.timeline ?? '',
      l.askingPrice ?? '',
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Get lead counts grouped by status and source
   */
  async getLeadStats() {
    const [byStatus, bySource, byBand, total] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['status'], _count: true }),
      this.prisma.lead.groupBy({ by: ['source'], _count: true }),
      this.prisma.lead.groupBy({ by: ['scoreBand'], _count: true }),
      this.prisma.lead.count(),
    ]);
    return {
      total,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
      bySource: Object.fromEntries(bySource.map((r) => [r.source, r._count])),
      byBand: Object.fromEntries(byBand.map((r) => [r.scoreBand, r._count])),
    };
  }

  /**
   * Assign a lead to a user for a specific workflow stage
   */
  async assignLead(leadId: string, userId: string, stage: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error('Lead not found');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!user) throw new Error('User not found');

    const updated = await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        assignedToUserId: userId,
        assignedStage: stage,
        assignedAt: new Date(),
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        userId,
        type: 'LEAD_ASSIGNED',
        description: `Lead assigned to ${user.firstName} ${user.lastName} for ${stage}`,
        metadata: { userId, stage },
      },
    });

    return this.getLead(leadId);
  }

  /**
   * Remove assignment from a lead
   */
  async unassignLead(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { assignedTo: { select: { firstName: true, lastName: true } } },
    });
    if (!lead) throw new Error('Lead not found');

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        assignedToUserId: null,
        assignedStage: null,
        assignedAt: null,
      },
    });

    const prevName = lead.assignedTo
      ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`
      : 'unknown';

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'LEAD_UNASSIGNED',
        description: `Lead unassigned from ${prevName}`,
      },
    });

    return this.getLead(leadId);
  }

  /**
   * Create or update contract
   */
  async upsertContract(leadId: string, data: any) {
    // Parse date strings to Date objects
    const clean: any = { ...data };
    if (clean.contractDate) clean.contractDate = new Date(clean.contractDate);
    if (clean.expectedCloseDate) clean.expectedCloseDate = new Date(clean.expectedCloseDate);
    if (clean.actualCloseDate) clean.actualCloseDate = new Date(clean.actualCloseDate);

    const contract = await this.prisma.contract.upsert({
      where: { leadId },
      create: { leadId, ...clean },
      update: clean,
    });

    // Advance lead status when contract is signed
    if (clean.contractStatus === 'signed') {
      const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
      if (lead && !['UNDER_CONTRACT', 'CLOSING', 'CLOSED'].includes(lead.status)) {
        await this.updateLead(leadId, { status: 'UNDER_CONTRACT' as LeadStatus });
      }
    }

    return contract;
  }

  // ── Dispo Summary ──────────────────────────────────────────────────────────

  async getDispoSummary(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        contract: true,
        offers: { orderBy: { createdAt: 'desc' } },
        compAnalyses: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!lead) throw new Error('Lead not found');

    // Use the comp analysis that was saved to the lead first, then most recent
    const analysis =
      lead.compAnalyses.find((c) => c.savedToLead) ?? lead.compAnalyses[0] ?? null;

    const arv = lead.arv ?? analysis?.arvEstimate ?? null;
    const repairCost = (lead as any).repairCosts ?? analysis?.repairCosts ?? null;
    const maoFactor = ((lead as any).maoPercent ?? 70) / 100;
    const mao = arv != null && repairCost != null ? arv * maoFactor - repairCost : null;

    const offers = lead.offers ?? [];
    const acceptedOffer = [...offers].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).find((o: any) => o.status === 'accepted') ?? null;
    const offerAmount = lead.contract?.offerAmount ?? acceptedOffer?.offerAmount ?? null;
    // Never fall back to analysis.assignmentFee (always 15000 default) — only use explicitly saved values
    const assignmentFee = lead.contract?.assignmentFee ?? (lead as any).assignmentFee ?? null;
    const exitStrategy = lead.contract?.exitStrategy ?? 'wholesale';

    // Buyer's All-In Price: what the end buyer pays (offer to seller + assignment fee)
    // For novation/sub-to, the "buyer" is the eventual end buyer — all-in = ARV (market price)
    // For wholesale/creative, all-in = offer + assignment fee
    const isWholesale = exitStrategy === 'wholesale' || exitStrategy === 'creative_finance';
    const buyerPrice = isWholesale
      ? (offerAmount != null && assignmentFee != null ? offerAmount + assignmentFee : null)
      : arv; // novation/sub-to: end buyer pays market value (ARV)

    // Buyer's Spread: equity left for the end buyer after purchase
    const buyerSpread = arv != null && buyerPrice != null ? arv - buyerPrice : null;

    // Your Profit depends on exit strategy:
    //   wholesale: your profit = assignment fee (you flip the contract)
    //   novation/sub-to: your profit = ARV - offer to seller - repairs (you sell the property)
    let projectedProfit: number | null = null;
    if (exitStrategy === 'wholesale') {
      projectedProfit = assignmentFee ?? null;
    } else if (exitStrategy === 'novation' || exitStrategy === 'subject_to' || exitStrategy === 'owner_finance') {
      projectedProfit = arv != null && offerAmount != null
        ? arv - offerAmount - (repairCost ?? 0)
        : null;
    } else {
      // fallback: use assignment fee if set, else ARV spread
      projectedProfit = assignmentFee ?? (arv != null && offerAmount != null ? arv - offerAmount - (repairCost ?? 0) : null);
    }

    return {
      arv,
      repairCost,
      mao,
      maoPercent: Math.round(maoFactor * 100),
      askingPrice: lead.askingPrice ?? null,
      offerAmount,
      assignmentFee,
      leadAssignmentFee: (lead as any).assignmentFee ?? null,
      exitStrategy,
      buyerPrice,
      buyerSpread,
      projectedProfit,
      contract: lead.contract ?? null,
      offers: lead.offers,
      latestCompAnalysis: analysis
        ? {
            repairCosts: analysis.repairCosts,
            assignmentFee: analysis.assignmentFee,
            arvEstimate: analysis.arvEstimate,
            dealType: analysis.dealType,
            repairNotes: analysis.repairNotes,
          }
        : null,
    };
  }

  // ── Offers ─────────────────────────────────────────────────────────────────

  async listOffers(leadId: string) {
    return this.prisma.offer.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createOffer(leadId: string, data: any) {
    const offer = await this.prisma.offer.create({
      data: {
        leadId,
        offerAmount: data.offerAmount,
        offerDate: data.offerDate ? new Date(data.offerDate) : new Date(),
        status: data.status ?? 'pending',
        notes: data.notes ?? null,
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'OFFER_MADE',
        description: `Offer made: $${offer.offerAmount.toLocaleString()}`,
        metadata: { offerId: offer.id, amount: offer.offerAmount },
      },
    });

    // Advance lead status to OFFER_MADE if not already further along
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    const advanceStatuses = ['NEW', 'ATTEMPTING_CONTACT', 'QUALIFYING'];
    if (lead && advanceStatuses.includes(lead.status)) {
      await this.updateLead(leadId, { status: 'OFFER_MADE' as any });
    }

    return offer;
  }

  async updateOffer(leadId: string, offerId: string, data: any) {
    const offer = await this.prisma.offer.update({
      where: { id: offerId, leadId },
      data: {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.counterAmount !== undefined && { counterAmount: data.counterAmount }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.offerAmount !== undefined && { offerAmount: data.offerAmount }),
      },
    });

    if (data.status === 'accepted') {
      await this.prisma.activity.create({
        data: {
          leadId,
          type: 'OFFER_ACCEPTED',
          description: `Offer accepted: $${offer.offerAmount.toLocaleString()}`,
          metadata: { offerId: offer.id },
        },
      });
    }

    return offer;
  }

  async deleteOffer(leadId: string, offerId: string) {
    await this.prisma.offer.delete({ where: { id: offerId, leadId } });
    return { deleted: true };
  }
}
