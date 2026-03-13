import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadSource, LeadStatus, ScoreBand } from '@fast-homes/shared';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

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
      this.prisma.lead.count({ where: { status: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } } }),
      this.prisma.lead.groupBy({ by: ['source'], _count: true }),
      this.prisma.lead.groupBy({ by: ['status'], _count: true }),
      this.prisma.lead.groupBy({
        by: ['scoreBand'],
        _count: true,
        where: { status: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } },
      }),
      this.prisma.contract.findMany({ include: { lead: true } }),
      this.prisma.contract.findMany({ where: { outcome: 'WON' }, include: { lead: true } }),
      // Pipeline ARV value (active leads with ARV set)
      this.prisma.lead.findMany({
        where: {
          arv: { not: null, gt: 0 },
          status: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
        },
        select: { arv: true, askingPrice: true },
      }),
      // New leads this week
      this.prisma.lead.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      // Stale: active, not touched in 3+ days, not closed
      this.prisma.lead.count({
        where: {
          lastTouchedAt: { lte: threeDaysAgo },
          status: { notIn: ['CLOSED_WON', 'CLOSED_LOST', 'DEAD'] },
        },
      }),
      // Needs follow-up: HOT/STRIKE_ZONE/WORKABLE not touched in 24h
      this.prisma.lead.count({
        where: {
          scoreBand: { in: ['HOT', 'STRIKE_ZONE', 'WORKABLE'] },
          lastTouchedAt: { lte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          status: { notIn: ['CLOSED_WON', 'CLOSED_LOST', 'DEAD'] },
        },
      }),
      // Under contract
      this.prisma.lead.count({
        where: { status: { in: ['UNDER_CONTRACT', 'CLOSING'] } },
      }),
    ]);

    const totalRevenue = wonDeals.reduce((sum, deal) => sum + (deal.assignmentFee || 0), 0);
    const closedDeals = wonDeals.length;

    // Pipeline potential value (MAO estimate from ARV)
    const pipelineArvTotal = activeLeadsWithArv.reduce((sum, l) => sum + (l.arv || 0), 0);
    const potentialAssignmentFees = activeLeadsWithArv.filter(l => l.arv && l.askingPrice && l.arv * 0.7 > l.askingPrice).length;

    // Conversion rate (all time)
    const allLeads = await this.prisma.lead.count();
    const closedWon = await this.prisma.lead.count({ where: { status: 'CLOSED_WON' } });
    const conversionRate = allLeads > 0 ? (closedWon / allLeads) * 100 : 0;

    // Avg time to contract (skip contracts with no date)
    let avgTimeToContract = 0;
    const timedContracts = contracts.filter(c => c.contractDate != null);
    if (timedContracts.length > 0) {
      const times = timedContracts.map(c => (c.contractDate!.getTime() - c.lead.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      avgTimeToContract = times.reduce((a, b) => a + b, 0) / times.length;
    }

    const sourceMap = leadsBySource.reduce((acc, item) => { acc[item.source] = item._count; return acc; }, {} as Record<string, number>);
    const statusMap = leadsByStatus.reduce((acc, item) => { acc[item.status] = item._count; return acc; }, {} as Record<string, number>);
    const bandMap = leadsByBand.reduce((acc, item) => { acc[item.scoreBand] = item._count; return acc; }, {} as Record<string, number>);

    return {
      // Pipeline health
      totalLeads,
      newLeadsThisWeek,
      staleLeads,
      needsFollowUp,
      underContract,
      // Deal metrics
      closedDeals,
      totalRevenue,
      conversionRate: Math.round(conversionRate * 10) / 10,
      avgTimeToContract: Math.round(avgTimeToContract * 10) / 10,
      // Pipeline value
      pipelineArvTotal,
      potentialAssignmentFees,
      // Score breakdown (active only)
      leadsByBand: bandMap,
      leadsBySource: sourceMap,
      leadsByStatus: statusMap,
    };
  }

  async getRecentActivity(limit = 50) {
    return this.prisma.activity.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
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

  async getUpcomingTasks(userId?: string) {
    const where: any = {
      completed: false,
    };

    if (userId) {
      where.userId = userId;
    }

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

  async getHotLeads(limit = 10) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.prisma.lead.findMany({
      where: {
        scoreBand: { in: ['HOT', 'STRIKE_ZONE'] },
        status: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
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

  async getNewLeads(limit = 10) {
    return this.prisma.lead.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
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

  async getStaleLeads(limit = 5) {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    return this.prisma.lead.findMany({
      where: {
        lastTouchedAt: { lte: threeDaysAgo },
        status: { notIn: ['CLOSED_WON', 'CLOSED_LOST', 'DEAD'] },
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
