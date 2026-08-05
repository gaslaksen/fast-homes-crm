import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignExecutionService } from './campaign-execution.service';

@Injectable()
export class CampaignEnrollmentService {
  private readonly logger = new Logger(CampaignEnrollmentService.name);

  constructor(
    private prisma: PrismaService,
    private execution: CampaignExecutionService,
  ) {}

  // Enrollment changes show up in the lead's conversation timeline and the
  // Activity pane via these records (best-effort; never blocks the change).
  private async logActivity(leadId: string, type: string, description: string) {
    try {
      await this.prisma.activity.create({ data: { leadId, type, description } });
    } catch (err) {
      this.logger.warn(`Could not log ${type} activity for lead ${leadId}: ${err.message}`);
    }
  }

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
      const reEnrolled = await this.prisma.campaignEnrollment.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          currentStepOrder: 0,
          nextSendAt,
          enrolledAt,
          completedAt: null,
        },
      });
      await this.logActivity(leadId, 'CAMPAIGN_ENROLLED', `Enrolled in drip campaign "${campaign.name}"`);
      return reEnrolled;
    }

    const enrollment = await this.prisma.campaignEnrollment.create({
      data: {
        campaignId,
        leadId,
        currentStepOrder: 0,
        status: 'ACTIVE',
        enrolledAt,
        nextSendAt,
      },
    });
    await this.logActivity(leadId, 'CAMPAIGN_ENROLLED', `Enrolled in drip campaign "${campaign.name}"`);
    return enrollment;
  }

  /**
   * Enroll many leads in one campaign, reporting per-lead outcomes instead of
   * failing the batch on the first bad lead. A list import lands hundreds of
   * leads at once and some of them will be missing an email or marked Do Not
   * Contact; those belong in a skip list the user can read, not in a 400 that
   * loses the other 145 enrollments.
   */
  async enrollLeads(leadIds: string[], campaignId: string) {
    const enrolled: string[] = [];
    const skipped: { leadId: string; reason: string }[] = [];

    for (const leadId of leadIds) {
      try {
        await this.enrollLead(leadId, campaignId);
        enrolled.push(leadId);
      } catch (err: any) {
        skipped.push({ leadId, reason: err?.message || 'Enrollment failed' });
      }
    }

    return { enrolled: enrolled.length, skipped, leadIds: enrolled };
  }

  /**
   * Recompute nextSendAt for everyone already enrolled, from the campaign's
   * CURRENT step delays.
   *
   * Enrollment stamps nextSendAt once, at enrollment time, so editing a
   * campaign's delays afterwards used to leave the existing queue sitting on
   * the old schedule - change step 1 from "day 2" to "immediately" and the
   * leads already in the campaign still waited two days. This brings them in
   * line without the alternative of removing and re-adding everyone, which
   * throws away enrollment history.
   *
   * Safe to run at any time: nextSendAt is derived from (enrolledAt,
   * cumulative delay), so re-deriving it is idempotent. Editing message copy
   * moves nobody; only editing a delay does.
   *
   * Deliberately narrow about what it touches:
   *   - ACTIVE only. Paused, replied, completed and removed enrollments keep
   *     whatever state they are in.
   *   - Never an enrollment with nextSendAt = null. That null is the cron's
   *     in-flight claim (see CampaignExecutionService.processScheduledMessages);
   *     writing a time back over it would hand the same step to the next tick
   *     as well and send the message twice.
   *   - The write is conditional on nextSendAt being unchanged since the read,
   *     so an enrollment the cron claims mid-resync is left to the cron.
   */
  async resyncSchedule(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const enrollments = await this.prisma.campaignEnrollment.findMany({
      where: { campaignId, status: 'ACTIVE', nextSendAt: { not: null } },
      select: { id: true, enrolledAt: true, currentStepOrder: true, nextSendAt: true },
    });

    const now = new Date();
    let rescheduled = 0;
    let dueNow = 0;
    let skipped = 0;

    for (const e of enrollments) {
      const nextStep = campaign.steps.find(
        (s: any) => s.stepOrder === e.currentStepOrder + 1,
      );
      if (!nextStep) { skipped++; continue; }

      const nextSendAt = this.execution.calculateNextSendAt(nextStep, e.enrolledAt);

      // Within a second of where it already sits: nothing to write.
      if (e.nextSendAt && Math.abs(nextSendAt.getTime() - e.nextSendAt.getTime()) < 1000) {
        skipped++;
        continue;
      }

      const claimed = await this.prisma.campaignEnrollment.updateMany({
        where: { id: e.id, nextSendAt: e.nextSendAt },
        data: { nextSendAt },
      });
      if (claimed.count === 0) { skipped++; continue; }

      rescheduled++;
      if (nextSendAt <= now) dueNow++;
    }

    this.logger.log(
      `Resynced campaign ${campaign.name}: ${rescheduled} rescheduled ` +
      `(${dueNow} now due), ${skipped} unchanged`,
    );
    return { rescheduled, dueNow, unchanged: skipped, total: enrollments.length };
  }

  async unenrollLead(enrollmentId: string) {
    const enrollment = await this.prisma.campaignEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'REMOVED' },
      include: { campaign: { select: { name: true } } },
    });
    await this.logActivity(enrollment.leadId, 'CAMPAIGN_UNENROLLED', `Removed from drip campaign "${enrollment.campaign.name}"`);
    return enrollment;
  }

  async pauseEnrollment(enrollmentId: string) {
    const enrollment = await this.prisma.campaignEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'PAUSED' },
      include: { campaign: { select: { name: true } } },
    });
    await this.logActivity(enrollment.leadId, 'CAMPAIGN_PAUSED', `Paused drip campaign "${enrollment.campaign.name}"`);
    return enrollment;
  }

  async resumeEnrollment(enrollmentId: string) {
    const enrollment = await this.prisma.campaignEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'ACTIVE' },
      include: { campaign: { select: { name: true } } },
    });
    await this.logActivity(enrollment.leadId, 'CAMPAIGN_RESUMED', `Resumed drip campaign "${enrollment.campaign.name}"`);
    return enrollment;
  }

  /**
   * Put every paused enrollment on a campaign back to active and give it a
   * fresh send time.
   *
   * A provider outage pauses enrollments in bulk (five failed attempts each),
   * and clicking Resume once per lead is not a recovery plan. Their nextSendAt
   * was cleared on pause, so it is recomputed here the same way resyncSchedule
   * does it; anything already past its cumulative time comes back due, and the
   * hourly throttle meters it out from there.
   */
  async resumeAllPaused(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const paused = await this.prisma.campaignEnrollment.findMany({
      where: { campaignId, status: 'PAUSED' },
      select: { id: true, leadId: true, enrolledAt: true, currentStepOrder: true },
    });

    let resumed = 0;
    for (const e of paused) {
      const nextStep = campaign.steps.find(
        (s: any) => s.stepOrder === e.currentStepOrder + 1,
      );
      // Nothing left to send: complete it rather than reviving it as active.
      if (!nextStep) {
        await this.prisma.campaignEnrollment.update({
          where: { id: e.id },
          data: { status: 'COMPLETED', completedAt: new Date(), nextSendAt: null },
        });
        continue;
      }

      await this.prisma.campaignEnrollment.update({
        where: { id: e.id },
        data: {
          status: 'ACTIVE',
          nextSendAt: this.execution.calculateNextSendAt(nextStep, e.enrolledAt),
        },
      });
      await this.logActivity(
        e.leadId,
        'CAMPAIGN_RESUMED',
        `Resumed drip campaign "${campaign.name}"`,
      );
      resumed++;
    }

    this.logger.log(
      `Resumed ${resumed} paused enrollment(s) on campaign ${campaign.name}`,
    );
    return { resumed, examined: paused.length };
  }

  /**
   * Remove all non-terminal enrollments for a lead (e.g., when lead marked DEAD).
   * Sweeps ACTIVE, PAUSED, and REPLIED so a dead lead never lingers on the campaign roster.
   */
  async removeAllActive(leadId: string) {
    const result = await this.prisma.campaignEnrollment.updateMany({
      where: { leadId, status: { notIn: ['REMOVED', 'COMPLETED', 'OPTED_OUT'] } },
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
      where: { isActive: true, enrollmentMode: 'auto' },
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
