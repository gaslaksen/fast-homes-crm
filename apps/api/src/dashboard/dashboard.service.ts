import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadSource, LeadStatus, ScoreBand } from '@fast-homes/shared';

const INACTIVE = ['CLOSED_WON', 'CLOSED_LOST', 'DEAD'];

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats(organizationId?: string) {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Base filter applied to every lead query — scopes to org when present
    const org = organizationId ? { organizationId } : {};
    const active = { ...org, status: { notIn: INACTIVE } };

    const [
      totalLeads,
      leadsBySource,
      leadsByStatus,
      leadsByBand,
      contracts,
      wonDeals,
      activeLeadsWithArv,
      newLeadsThisWeek,
      staleLeads,
      needsFollowUp,
      underContract,
    ] = await Promise.all([
      this.prisma.lead.count({ where: active }),
      this.prisma.lead.groupBy({ by: ['source'], _count: true, where: org }),
      this.prisma.lead.groupBy({ by: ['status'], _count: true, where: org }),
      this.prisma.lead.groupBy({
        by: ['scoreBand'],
        _count: true,
        where: active,
      }),
      this.prisma.contract.findMany({ where: org.organizationId ? { lead: { organizationId } } : {}, include: { lead: true } }),
      this.prisma.contract.findMany({ where: { outcome: 'WON', ...(org.organizationId ? { lead: { organizationId } } : {}) }, include: { lead: true } }),
      // Pipeline ARV value (active leads with ARV set)
      this.prisma.lead.findMany({
        where: { ...active, arv: { not: null, gt: 0 } },
        select: { arv: true, askingPrice: true },
      }),
      // New leads this week (active only)
      this.prisma.lead.count({ where: { ...active, createdAt: { gte: sevenDaysAgo } } }),
      // Stale: active, not touched in 3+ days
      this.prisma.lead.count({
        where: { ...active, lastTouchedAt: { lte: threeDaysAgo } },
      }),
      // Needs follow-up: HOT/STRIKE_ZONE/WORKABLE not touched in 24h
      this.prisma.lead.count({
        where: {
          ...active,
          scoreBand: { in: ['HOT', 'STRIKE_ZONE', 'WORKABLE'] },
          lastTouchedAt: { lte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
      }),
      // Under contract
      this.prisma.lead.count({
        where: { ...org, status: { in: ['UNDER_CONTRACT', 'CLOSING'] } },
      }),
    ]);

    const totalRevenue = wonDeals.reduce((sum, deal) => sum + (deal.assignmentFee || 0), 0);
    const closedDeals = wonDeals.length;

    // Pipeline potential value (MAO estimate from ARV)
    const pipelineArvTotal = activeLeadsWithArv.reduce((sum, l) => sum + (l.arv || 0), 0);
    const potentialAssignmentFees = activeLeadsWithArv.filter(l => l.arv && l.askingPrice && l.arv * 0.7 > l.askingPrice).length;

    // Conversion rate (all time, org-scoped)
    const allLeads = await this.prisma.lead.count({ where: org });
    const closedWon = await this.prisma.lead.count({ where: { ...org, status: 'CLOSED_WON' } });
    const conversionRate = allLeads > 0 ? (closedWon / allLeads) * 100 : 0;

    const sourceMap = leadsBySource.reduce((acc, item) => { acc[item.source] = item._count; return acc; }, {} as Record<string, number>);
    const statusMap = leadsByStatus.reduce((acc, item) => { acc[item.status] = item._count; return acc; }, {} as Record<string, number>);
    const bandMap = leadsByBand.reduce((acc, item) => { acc[item.scoreBand] = item._count; return acc; }, {} as Record<string, number>);

    return {
      totalLeads,
      newLeadsThisWeek,
      staleLeads,
      needsFollowUp,
      underContract,
      closedDeals,
      totalRevenue,
      conversionRate: Math.round(conversionRate * 10) / 10,
      pipelineArvTotal,
      potentialAssignmentFees,
      leadsByBand: bandMap,
      leadsBySource: sourceMap,
      leadsByStatus: statusMap,
    };
  }

  async getRecentActivity(limit = 50, organizationId?: string) {
    const where = organizationId ? { lead: { organizationId } } : {};
    return this.prisma.activity.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      where,
      include: {
        lead: {
          select: {
            id: true,
            propertyAddress: true,
            sellerFirstName: true,
            sellerLastName: true,
          },
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  async getUpcomingTasks(userId?: string, organizationId?: string) {
    const where: any = { completed: false };
    if (userId) where.userId = userId;
    if (organizationId) where.lead = { organizationId };

    return this.prisma.task.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      take: 20,
      include: {
        lead: {
          select: {
            id: true,
            propertyAddress: true,
            sellerFirstName: true,
            sellerLastName: true,
            scoreBand: true,
          },
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  async getHotLeads(limit = 10, organizationId?: string) {
    const org = organizationId ? { organizationId } : {};
    return this.prisma.lead.findMany({
      where: {
        ...org,
        scoreBand: { in: ['HOT', 'STRIKE_ZONE'] },
        status: { notIn: INACTIVE },
      },
      orderBy: [{ totalScore: 'desc' }, { lastTouchedAt: 'asc' }],
      take: limit,
      select: {
        id: true,
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        sellerFirstName: true,
        sellerLastName: true,
        sellerPhone: true,
        totalScore: true,
        scoreBand: true,
        status: true,
        arv: true,
        askingPrice: true,
        lastTouchedAt: true,
        daysInStage: true,
        primaryPhoto: true,
        source: true,
      },
    });
  }

  async getNewLeads(limit = 10, organizationId?: string) {
    const org = organizationId ? { organizationId } : {};
    return this.prisma.lead.findMany({
      where: { ...org, status: { notIn: INACTIVE } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        sellerFirstName: true,
        sellerLastName: true,
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        status: true,
        scoreBand: true,
        totalScore: true,
        createdAt: true,
        primaryPhoto: true,
      },
    });
  }

  async getStaleLeads(limit = 5, organizationId?: string) {
    const org = organizationId ? { organizationId } : {};
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    return this.prisma.lead.findMany({
      where: {
        ...org,
        lastTouchedAt: { lte: threeDaysAgo },
        status: { notIn: INACTIVE },
        scoreBand: { in: ['HOT', 'STRIKE_ZONE', 'WORKABLE'] },
      },
      orderBy: [{ totalScore: 'desc' }, { lastTouchedAt: 'asc' }],
      take: limit,
      select: {
        id: true,
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        sellerFirstName: true,
        sellerLastName: true,
        totalScore: true,
        scoreBand: true,
        status: true,
        arv: true,
        askingPrice: true,
        lastTouchedAt: true,
        primaryPhoto: true,
      },
    });
  }
}
