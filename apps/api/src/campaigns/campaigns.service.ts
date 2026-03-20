import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateCampaignDto {
  name: string;
  description?: string;
  triggerDays?: number;
  isActive?: boolean;
  steps?: CreateStepDto[];
}

export interface CreateStepDto {
  stepOrder: number;
  channel: 'TEXT' | 'EMAIL';
  delayDays?: number;
  delayHours?: number;
  sendWindowStart?: string;
  sendWindowEnd?: string;
  subject?: string;
  body: string;
  isActive?: boolean;
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(private prisma: PrismaService) {}

  async createCampaign(dto: CreateCampaignDto, organizationId?: string) {
    const { steps = [], ...campaignData } = dto;
    return this.prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.create({
        data: {
          ...campaignData,
          organizationId,
          steps: {
            create: steps.map((s) => ({
              stepOrder: s.stepOrder,
              channel: s.channel,
              delayDays: s.delayDays ?? 0,
              delayHours: s.delayHours ?? 0,
              sendWindowStart: s.sendWindowStart,
              sendWindowEnd: s.sendWindowEnd,
              subject: s.subject,
              body: s.body,
              isActive: s.isActive ?? true,
            })),
          },
        },
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
      });
      return campaign;
    });
  }

  async updateCampaign(id: string, dto: Partial<CreateCampaignDto>) {
    const { steps, ...campaignData } = dto;
    return this.prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.update({
        where: { id },
        data: campaignData,
      });

      if (steps !== undefined) {
        // Replace all steps
        await tx.campaignStep.deleteMany({ where: { campaignId: id } });
        if (steps.length > 0) {
          await tx.campaignStep.createMany({
            data: steps.map((s) => ({
              campaignId: id,
              stepOrder: s.stepOrder,
              channel: s.channel,
              delayDays: s.delayDays ?? 0,
              delayHours: s.delayHours ?? 0,
              sendWindowStart: s.sendWindowStart,
              sendWindowEnd: s.sendWindowEnd,
              subject: s.subject,
              body: s.body,
              isActive: s.isActive ?? true,
            })),
          });
        }
      }

      return this.getCampaignDetail(id);
    });
  }

  async deleteCampaign(id: string) {
    await this.prisma.campaign.delete({ where: { id } });
    return { success: true };
  }

  async duplicateCampaign(id: string) {
    const original = await this.prisma.campaign.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!original) throw new NotFoundException('Campaign not found');

    const { id: _id, createdAt: _ca, updatedAt: _ua, steps, ...rest } = original;
    return this.prisma.$transaction(async (tx) => {
      return tx.campaign.create({
        data: {
          ...rest,
          name: `${rest.name} (Copy)`,
          isDefault: false,
          steps: {
            create: steps.map((s) => {
              const { id: _sid, campaignId: _cid, createdAt: _sca, updatedAt: _sua, ...sRest } = s;
              return sRest;
            }),
          },
        },
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
      });
    });
  }

  async toggleCampaign(id: string, isActive: boolean) {
    return this.prisma.campaign.update({
      where: { id },
      data: { isActive },
    });
  }

  async getCampaigns(organizationId?: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: organizationId ? { organizationId } : undefined,
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        _count: { select: { enrollments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Attach per-status enrollment counts
    return Promise.all(
      campaigns.map(async (c) => {
        const enrollmentStats = await this.prisma.campaignEnrollment.groupBy({
          by: ['status'],
          where: { campaignId: c.id },
          _count: true,
        });
        const stats: Record<string, number> = {};
        for (const s of enrollmentStats) {
          stats[s.status] = s._count;
        }
        return { ...c, enrollmentStats: stats };
      }),
    );
  }

  async getCampaignDetail(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        _count: { select: { enrollments: true } },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const enrollmentStats = await this.prisma.campaignEnrollment.groupBy({
      by: ['status'],
      where: { campaignId: id },
      _count: true,
    });
    const stats: Record<string, number> = {};
    for (const s of enrollmentStats) {
      stats[s.status] = s._count;
    }

    // Per-step send counts
    const stepStats = await this.prisma.campaignMessageLog.groupBy({
      by: ['stepId'],
      where: { enrollment: { campaignId: id } },
      _count: true,
    });
    const stepSentMap: Record<string, number> = {};
    for (const s of stepStats) {
      stepSentMap[s.stepId] = s._count;
    }

    return {
      ...campaign,
      enrollmentStats: stats,
      stepSentMap,
    };
  }
}
