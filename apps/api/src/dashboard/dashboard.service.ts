import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadSource, LeadStatus, ScoreBand } from '@fast-homes/shared';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const [
      totalLeads,
      leadsBySource,
      leadsByStatus,
      leadsByBand,
      contracts,
      wonDeals,
    ] = await Promise.all([
      this.prisma.lead.count(),
      this.prisma.lead.groupBy({
        by: ['source'],
        _count: true,
      }),
      this.prisma.lead.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.prisma.lead.groupBy({
        by: ['scoreBand'],
        _count: true,
      }),
      this.prisma.contract.findMany({
        include: { lead: true },
      }),
      this.prisma.contract.findMany({
        where: { outcome: 'WON' },
        include: { lead: true },
      }),
    ]);

    // Calculate conversion rate
    const underContractOrClosed = await this.prisma.lead.count({
      where: {
        status: {
          in: ['UNDER_CONTRACT', 'CLOSING', 'CLOSED_WON'],
        },
      },
    });
    const conversionRate = totalLeads > 0 ? (underContractOrClosed / totalLeads) * 100 : 0;

    // Calculate average time to contract
    let avgTimeToContract = 0;
    if (contracts.length > 0) {
      const times = contracts.map(c => {
        const leadCreated = c.lead.createdAt.getTime();
        const contractDate = c.contractDate.getTime();
        return (contractDate - leadCreated) / (1000 * 60 * 60 * 24); // days
      });
      avgTimeToContract = times.reduce((a, b) => a + b, 0) / times.length;
    }

    // Calculate total revenue (assignment fees)
    const totalRevenue = wonDeals.reduce((sum, deal) => sum + (deal.assignmentFee || 0), 0);

    // Format results
    const sourceMap = leadsBySource.reduce((acc, item) => {
      acc[item.source] = item._count;
      return acc;
    }, {} as Record<LeadSource, number>);

    const statusMap = leadsByStatus.reduce((acc, item) => {
      acc[item.status] = item._count;
      return acc;
    }, {} as Record<LeadStatus, number>);

    const bandMap = leadsByBand.reduce((acc, item) => {
      acc[item.scoreBand] = item._count;
      return acc;
    }, {} as Record<ScoreBand, number>);

    return {
      totalLeads,
      leadsBySource: sourceMap,
      leadsByStatus: statusMap,
      leadsByBand: bandMap,
      avgTimeToContract: Math.round(avgTimeToContract * 10) / 10,
      conversionRate: Math.round(conversionRate * 10) / 10,
      totalRevenue,
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
      dueDate: {
        gte: new Date(),
      },
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
    return this.prisma.lead.findMany({
      where: {
        scoreBand: {
          in: ['HOT', 'STRIKE_ZONE'],
        },
        status: {
          notIn: ['CLOSED_WON', 'CLOSED_LOST'],
        },
      },
      orderBy: { totalScore: 'desc' },
      take: limit,
      include: {
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }
}
