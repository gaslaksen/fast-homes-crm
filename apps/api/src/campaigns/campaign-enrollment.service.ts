import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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

    // Verify the lead can actually receive messages on every channel this
    // campaign uses. Without this, a lead missing a phone or email can be
    // enrolled and then silently skipped at send time, leaving the user
    // thinking the message went out.
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        sellerEmail: true,
        sellerPhone: true,
        doNotContact: true,
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    const channels = new Set<string>(
      (campaign.steps ?? []).map((s: any) => s.channel),
    );
    if (channels.has('EMAIL') && !lead.sellerEmail) {
      throw new BadRequestException(
        'Lead has no email address — cannot enroll in an email campaign',
      );
    }
    if (channels.has('TEXT') && !lead.sellerPhone) {
      throw new BadRequestException(
        'Lead has no phone number — cannot enroll in an SMS campaign',
      );
    }
    if (channels.has('TEXT') && lead.doNotContact) {
      throw new BadRequestException(
        'Lead is marked Do Not Contact — cannot enroll in an SMS campaign',
      );
    }

    // Check if already enrolled (upsert with unique constraint)
    const existing = await this.prisma.campaignEnrollment.findUnique({
      where: { campaignId_leadId: { campaignId, leadId } },
    });
    if (existing && existing.status !== 'REMOVED') {
      return existing;
    }

    // Calculate first nextSendAt. delayDays/delayHours are cumulative offsets
    // from enrollment start (enrolledAt), the same convention used by every
    // subsequent step in CampaignExecutionService.calculateNextSendAt — so a
    // campaign with delays [0d, 1d, 2d, 3d] fires on day 0, 1, 2, 3 from
    // enrollment, not day 0, 1, 3, 6.
    //
    // For a brand new enrollment, enrolledAt === now, so step 1 with
    // delayDays=0 fires on the next cron tick. Same-lead double-send with
    // initial outreach is prevented by the 5-minute outbound throttle in
    // MessagesService.sendMessage.
    const firstStep = campaign.steps[0];
    const enrolledAt = new Date();
    let nextSendAt: Date | null = null;
    if (firstStep) {
      nextSendAt = new Date(enrolledAt.getTime());
      nextSendAt.setDate(nextSendAt.getDate() + (firstStep.delayDays ?? 0));
      nextSendAt.setHours(nextSendAt.getHours() + (firstStep.delayHours ?? 0));
    }

    if (existing) {
      // Re-enroll (was REMOVED). Reset enrolledAt to now so cumulative-from-
      // enrollment delays anchor on the re-enrollment date, not the original
      // (which would make every step fire immediately on the next cron tick).
      return this.prisma.campaignEnrollment.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          currentStepOrder: 0,
          nextSendAt,
          enrolledAt,
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
        enrolledAt,
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
        ...(status
          ? { status: status as any }
          : { status: { not: 'REMOVED' } }),
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
