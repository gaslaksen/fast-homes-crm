import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toE164 } from '../phone-numbers/phone-numbers.service';

export interface CreateCampaignDto {
  name: string;
  description?: string;
  triggerDays?: number;
  enrollmentMode?: string;
  isActive?: boolean;
  /**
   * E.164 number TEXT steps send from. Null or omitted keeps the existing
   * per-lead resolution (sticky thread, else the org default).
   */
  fromNumber?: string | null;
  /** The company the campaign sends as. Must be a company in the account. */
  brandId?: string | null;
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

  /**
   * Store a campaign's sending number in one spelling, so the builder's
   * dropdown matches what is saved however the value arrived.
   *
   * Absent means "leave it alone" on an edit; an explicitly empty value means
   * "clear it" and go back to the default. Whether the number is actually one
   * of ours is not settled here: PhoneNumbersService re-checks it against the
   * active SMS list on every send, because a number can be deactivated long
   * after a campaign was written.
   */
  private normalizeFromNumber(value: string | null | undefined): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value.trim() === '') return null;
    const e164 = toE164(value);
    if (!e164) throw new BadRequestException('Enter a valid US phone number to send from');
    return e164;
  }

  /**
   * A company id from the client is only kept when it is one of this
   * account's companies. Null or omitted leaves the campaign unassigned.
   */
  private async checkBrand(brandId: string | null | undefined, organizationId?: string): Promise<string | null> {
    if (!brandId) return null;
    const brand = organizationId
      ? await this.prisma.brand.findFirst({ where: { id: brandId, organizationId }, select: { id: true } })
      : null;
    if (!brand) throw new BadRequestException('Unknown company');
    return brand.id;
  }

  /**
   * The campaign fields the builder edits. The request body is otherwise
   * taken as sent, and the edit page posts the whole campaign back, so
   * anything else in it (the account, timestamps, counts, the id) is
   * dropped here rather than written.
   */
  private editableFields(dto: Partial<CreateCampaignDto>) {
    return {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.triggerDays !== undefined && { triggerDays: dto.triggerDays }),
      ...(dto.enrollmentMode !== undefined && { enrollmentMode: dto.enrollmentMode }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
  }

  /**
   * The campaign, when it belongs to this account. Every write by id goes
   * through here so one account cannot change another's campaign. A request
   * with no account matches nothing.
   */
  private async findOwned(id: string, organizationId?: string) {
    const campaign = organizationId
      ? await this.prisma.campaign.findFirst({ where: { id, organizationId }, select: { id: true } })
      : null;
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async createCampaign(dto: CreateCampaignDto, organizationId?: string) {
    const steps = dto.steps ?? [];
    const fromNumber = this.normalizeFromNumber(dto.fromNumber);
    const brandId = await this.checkBrand(dto.brandId, organizationId);
    const campaignData = { ...this.editableFields(dto), name: dto.name, fromNumber: fromNumber ?? null, brandId };
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

  async updateCampaign(id: string, dto: Partial<CreateCampaignDto>, organizationId?: string) {
    await this.findOwned(id, organizationId);
    const { steps } = dto;
    const fromNumber = this.normalizeFromNumber(dto.fromNumber);
    // Absent leaves the company alone; null clears it.
    const brandId =
      dto.brandId === undefined ? undefined : await this.checkBrand(dto.brandId, organizationId);
    const campaignData = {
      ...this.editableFields(dto),
      ...(fromNumber !== undefined && { fromNumber }),
      ...(brandId !== undefined && { brandId }),
    };
    return this.prisma.$transaction(async (tx) => {
      const campaign = await tx.campaign.update({
        where: { id },
        data: campaignData,
      });

      if (steps !== undefined) {
        // Merge-by-stepOrder: update existing rows in place so their IDs
        // (and CampaignMessageLog history) survive the edit. Only create new
        // rows for orders we haven't seen, and only delete rows whose order
        // is no longer in the incoming set.
        const existing = await tx.campaignStep.findMany({
          where: { campaignId: id },
        });
        const existingByOrder = new Map(existing.map((s) => [s.stepOrder, s]));
        const incomingOrders = new Set(steps.map((s) => s.stepOrder));

        for (const s of steps) {
          const prev = existingByOrder.get(s.stepOrder);
          const data = {
            channel: s.channel,
            delayDays: s.delayDays ?? 0,
            delayHours: s.delayHours ?? 0,
            sendWindowStart: s.sendWindowStart,
            sendWindowEnd: s.sendWindowEnd,
            subject: s.subject,
            body: s.body,
            isActive: s.isActive ?? true,
          };
          if (prev) {
            await tx.campaignStep.update({
              where: { id: prev.id },
              data,
            });
          } else {
            await tx.campaignStep.create({
              data: { campaignId: id, stepOrder: s.stepOrder, ...data },
            });
          }
        }

        // Remove steps that are no longer present. Clean up their message
        // logs first to satisfy the FK constraint.
        const removed = existing.filter((s) => !incomingOrders.has(s.stepOrder));
        if (removed.length > 0) {
          const removedIds = removed.map((s) => s.id);
          await tx.campaignMessageLog.deleteMany({
            where: { stepId: { in: removedIds } },
          });
          await tx.campaignStep.deleteMany({
            where: { id: { in: removedIds } },
          });
        }
      }

      return this.getCampaignDetail(id);
    });
  }

  async deleteCampaign(id: string, organizationId?: string) {
    await this.findOwned(id, organizationId);
    await this.prisma.campaign.delete({ where: { id } });
    return { success: true };
  }

  async duplicateCampaign(id: string, organizationId?: string) {
    await this.findOwned(id, organizationId);
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

  async toggleCampaign(id: string, isActive: boolean, organizationId?: string) {
    await this.findOwned(id, organizationId);
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
        // Exclude REMOVED enrollments — they're soft-deleted history that
        // shouldn't inflate the "Enrolled" stat in the UI.
        _count: {
          select: {
            enrollments: { where: { status: { not: 'REMOVED' } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Attach per-status enrollment counts (REMOVED excluded so the buckets
    // sum to the same total the dashboard's "Enrolled" stat shows).
    return Promise.all(
      campaigns.map(async (c) => {
        const enrollmentStats = await this.prisma.campaignEnrollment.groupBy({
          by: ['status'],
          where: { campaignId: c.id, status: { not: 'REMOVED' } },
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
        // Exclude REMOVED — see comment in getCampaigns above.
        _count: {
          select: {
            enrollments: { where: { status: { not: 'REMOVED' } } },
          },
        },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const enrollmentStats = await this.prisma.campaignEnrollment.groupBy({
      by: ['status'],
      where: { campaignId: id, status: { not: 'REMOVED' } },
      _count: true,
    });
    const stats: Record<string, number> = {};
    for (const s of enrollmentStats) {
      stats[s.status] = s._count;
    }

    // Per-step send counts. Only SENT rows — FAILED retries and SKIPPED
    // rows should not inflate the "N sent" label in the funnel.
    const stepStats = await this.prisma.campaignMessageLog.groupBy({
      by: ['stepId'],
      where: {
        enrollment: { campaignId: id },
        status: 'SENT',
      },
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
