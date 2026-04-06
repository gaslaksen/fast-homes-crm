import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CampaignEnrollmentService {
  private readonly logger = new Logger(CampaignEnrollmentService.name);

  constructor(private prisma: PrismaService) {}

  async enrollLead(leadId: string, campaignId: string) {
    // Get campaign with its first step
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    // Check if already enrolled (upsert with unique constraint)
    const existing = await this.prisma.campaignEnrollment.findUnique({
      where: { campaignId_leadId: { campaignId, leadId } },
    });
    if (existing && existing.status !== 'REMOVED') {
      return existing;
    }

    // Calculate first nextSendAt
    const firstStep = campaign.steps[0];
    let nextSendAt: Date | null = null;
    if (firstStep) {
      nextSendAt = new Date();
      nextSendAt.setDate(nextSendAt.getDate() + (firstStep.delayDays ?? 0));
      nextSendAt.setHours(nextSendAt.getHours() + (firstStep.delayHours ?? 0));

      // Enforce minimum 24h delay so campaign step 1 never fires the same
      // day as initial outreach — even if delayDays/delayHours are both 0.
      const minDelay = new Date();
      minDelay.setHours(minDelay.getHours() + 24);
      if (nextSendAt < minDelay) {
        nextSendAt = minDelay;
      }
    }

    if (existing) {
      // Re-enroll (was REMOVED)
      return this.prisma.campaignEnrollment.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          currentStepOrder: 0,
          nextSendAt,
          completedAt: null,
        },
      });
    }

    return this.prisma.campaignEnrollment.create({
      data: {
        campaignId,
        leadId,
        currentStepOrder: 0,
        status: 'ACTIVE',
        nextSendAt,
      },
    });
  }

  async unenrollLead(enrollmentId: string) {
    return this.prisma.campaignEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'REMOVED' },
    });
  }

  async pauseEnrollment(enrollmentId: string) {
    return this.prisma.campaignEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'PAUSED' },
    });
  }

  async resumeEnrollment(enrollmentId: string) {
    return this.prisma.campaignEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'ACTIVE' },
    });
  }

  /**
   * Remove all active/paused enrollments for a lead (e.g., when lead marked DEAD).
   */
  async removeAllActive(leadId: string) {
    const result = await this.prisma.campaignEnrollment.updateMany({
      where: { leadId, status: { in: ['ACTIVE', 'PAUSED'] } },
      data: { status: 'REMOVED' },
    });
    if (result.count > 0) {
      this.logger.log(`🗑️ Removed ${result.count} campaign enrollment(s) for lead ${leadId}`);
    }
  }

  /**
   * Auto-enroll a lead in all active default campaigns.
   */
  async autoEnrollInDefaults(leadId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { isDefault: true, isActive: true },
    });
    for (const campaign of campaigns) {
      try {
        await this.enrollLead(leadId, campaign.id);
        this.logger.log(`📢 Auto-enrolled lead ${leadId} in campaign "${campaign.name}"`);
      } catch (err) {
        this.logger.warn(`Could not auto-enroll lead ${leadId} in campaign ${campaign.id}: ${err.message}`);
      }
    }
  }

  async handleReply(leadId: string) {
    const activeEnrollments = await this.prisma.campaignEnrollment.findMany({
      where: { leadId, status: 'ACTIVE' },
    });

    if (activeEnrollments.length === 0) return;

    await this.prisma.campaignEnrollment.updateMany({
      where: { leadId, status: 'ACTIVE' },
      data: { status: 'REPLIED' },
    });

    this.logger.log(
      `📨 Marked ${activeEnrollments.length} enrollment(s) as REPLIED for lead ${leadId}`,
    );
  }

  async getEnrollmentsForLead(leadId: string) {
    return this.prisma.campaignEnrollment.findMany({
      where: { leadId },
      include: {
        campaign: { select: { id: true, name: true, steps: { orderBy: { stepOrder: 'asc' } } } },
        messageLogs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });
  }

  async getEnrollmentsForCampaign(campaignId: string, status?: string) {
    return this.prisma.campaignEnrollment.findMany({
      where: {
        campaignId,
        ...(status ? { status: status as any } : {}),
      },
      include: {
        lead: {
          select: {
            id: true,
            sellerFirstName: true,
            sellerLastName: true,
            propertyAddress: true,
            propertyCity: true,
            propertyState: true,
            sellerPhone: true,
            status: true,
          },
        },
        messageLogs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });
  }
}
