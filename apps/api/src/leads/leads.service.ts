import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { LeadStatus, LeadSource } from '@fast-homes/shared';
import { Prisma } from '@prisma/client';

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private scoringService: ScoringService,
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
    timeline?: number;
    askingPrice?: number;
    conditionLevel?: string;
    distressSignals?: string[];
    ownershipStatus?: string;
    assignedToUserId?: string;
    sourceMetadata?: any;
  }) {
    // Initial scoring
    const scoringResult = await this.scoringService.scoreLead({
      timeline: data.timeline,
      askingPrice: data.askingPrice,
      conditionLevel: data.conditionLevel,
      distressSignals: data.distressSignals,
      ownershipStatus: data.ownershipStatus,
    });

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

    return lead;
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
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const skip = (page - 1) * limit;

    const where: Prisma.LeadWhereInput = {};

    if (filters.source) where.source = filters.source;
    if (filters.status) where.status = filters.status;
    if (filters.scoreBand) where.scoreBand = filters.scoreBand as any;
    if (filters.assignedToUserId) where.assignedToUserId = filters.assignedToUserId;
    if (filters.zip) where.propertyZip = filters.zip;
    if (filters.minScore || filters.maxScore) {
      const scoreFilter: Prisma.IntFilter<'Lead'> = {};
      if (filters.minScore) scoreFilter.gte = filters.minScore;
      if (filters.maxScore) scoreFilter.lte = filters.maxScore;
      where.totalScore = scoreFilter;
    }

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

    return this.getLead(id);
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
   * Create or update contract
   */
  async upsertContract(leadId: string, data: {
    contractDate: Date;
    buyerName?: string;
    assignmentFee?: number;
    titleCompany?: string;
    expectedCloseDate?: Date;
    actualCloseDate?: Date;
    dispositionNotes?: string;
    outcome?: 'WON' | 'LOST';
  }) {
    const contract = await this.prisma.contract.upsert({
      where: { leadId },
      create: { leadId, ...data },
      update: data,
    });

    // Update lead status if contract is created
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (lead && lead.status !== 'UNDER_CONTRACT' && lead.status !== 'CLOSING') {
      await this.updateLead(leadId, { status: 'UNDER_CONTRACT' as LeadStatus });
    }

    return contract;
  }
}
