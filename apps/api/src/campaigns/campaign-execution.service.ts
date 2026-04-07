import {
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { LeadsService } from '../leads/leads.service';
import { GmailService } from '../gmail/gmail.service';

interface LeadForTemplate {
  sellerFirstName?: string | null;
  sellerLastName?: string | null;
  propertyAddress?: string | null;
  propertyCity?: string | null;
  propertyState?: string | null;
  askingPrice?: number | null;
  arv?: number | null;
  sellerEmail?: string | null;
}

// Default campaign templates removed — campaigns are now created and managed
// entirely through the UI. The old hardcoded "Gentle Follow-Up", "Urgency Builder",
// and "Empathetic Long Game" templates were auto-enrolling leads and sending
// messages that conflicted with the AI CAMP system.

@Injectable()
export class CampaignExecutionService implements OnModuleInit {
  private readonly logger = new Logger(CampaignExecutionService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    @Inject(forwardRef(() => MessagesService))
    private messagesService: MessagesService,
    @Inject(forwardRef(() => LeadsService))
    private leadsService: LeadsService,
    @Inject(forwardRef(() => GmailService))
    private gmailService: GmailService,
  ) {}

  async onModuleInit() {
    await this.deactivateOldSeedCampaigns();
  }

  /**
   * One-time cleanup: deactivate the old hardcoded seed campaigns that were
   * auto-enrolling leads and conflicting with the AI CAMP system.
   * Campaigns are now managed entirely through the UI.
   */
  private async deactivateOldSeedCampaigns() {
    const result = await this.prisma.campaign.updateMany({
      where: { isDefault: true, isActive: true },
      data: { isActive: false },
    });
    if (result.count > 0) {
      this.logger.log(`🗑️ Deactivated ${result.count} old seed campaign(s) — campaigns are now managed via UI only`);

      // Also remove any active/paused enrollments from these campaigns
      const deactivated = await this.prisma.campaign.findMany({
        where: { isDefault: true, isActive: false },
        select: { id: true },
      });
      const campaignIds = deactivated.map((c) => c.id);
      if (campaignIds.length > 0) {
        const removed = await this.prisma.campaignEnrollment.updateMany({
          where: {
            campaignId: { in: campaignIds },
            status: { in: ['ACTIVE', 'PAUSED'] },
          },
          data: { status: 'REMOVED' },
        });
        if (removed.count > 0) {
          this.logger.log(`🗑️ Removed ${removed.count} active enrollment(s) from deactivated seed campaigns`);
        }
      }
    }
  }

  // Run every 5 minutes
  @Cron('*/5 * * * *')
  async processScheduledMessages() {
    const now = new Date();
    const enrollments = await this.prisma.campaignEnrollment.findMany({
      where: {
        status: 'ACTIVE',
        nextSendAt: { lte: now },
      },
      include: {
        campaign: {
          include: {
            steps: { orderBy: { stepOrder: 'asc' } },
          },
        },
        lead: true,
      },
      take: 50, // cap per run
    });

    if (enrollments.length > 0) {
      this.logger.log(`⏰ Processing ${enrollments.length} scheduled campaign message(s)`);
    }

    for (const enrollment of enrollments) {
      // Optimistic lock: atomically claim this enrollment to prevent
      // duplicate sends when Railway runs multiple instances during deploy
      const claimed = await this.prisma.campaignEnrollment.updateMany({
        where: {
          id: enrollment.id,
          nextSendAt: enrollment.nextSendAt, // only if unchanged since our query
        },
        data: { nextSendAt: null }, // clear to prevent re-processing
      });
      if (claimed.count === 0) {
        this.logger.log(`Enrollment ${enrollment.id} already claimed by another instance — skipping`);
        continue;
      }

      try {
        await this.executeStep(enrollment);
      } catch (err) {
        // Restore nextSendAt on failure so it retries on next cron run
        await this.prisma.campaignEnrollment.update({
          where: { id: enrollment.id },
          data: { nextSendAt: enrollment.nextSendAt },
        }).catch(() => {}); // swallow restore failure
        this.logger.error(`Failed to execute step for enrollment ${enrollment.id}: ${err.message}`);
      }
    }
  }

  // Stale lead auto-enrollment removed — was auto-enrolling leads in hardcoded
  // seed campaigns. Campaign enrollment is now manual (via UI) or triggered on
  // first inbound reply (via handleInboundMessage).

  async executeStep(enrollment: any) {
    const { campaign, lead } = enrollment;
    const steps: any[] = campaign.steps;

    // Find the current step (by stepOrder = currentStepOrder + 1, since we use 1-indexed stepOrder)
    const currentStep = steps.find((s: any) => s.stepOrder === enrollment.currentStepOrder + 1);

    if (!currentStep || !currentStep.isActive) {
      // No more steps — mark complete
      await this.prisma.campaignEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'COMPLETED', completedAt: new Date(), nextSendAt: null },
      });
      return;
    }

    // Load org once so merge fields resolve to the real company name
    // instead of the hardcoded "Fast Homes" default.
    const org = lead.organizationId
      ? await this.prisma.organization.findUnique({
          where: { id: lead.organizationId },
          select: { name: true },
        })
      : null;

    const renderedBody = this.renderTemplate(currentStep.body, lead, org);
    const renderedSubject = currentStep.subject
      ? this.renderTemplate(currentStep.subject, lead, org)
      : undefined;

    // Create log entry
    const log = await this.prisma.campaignMessageLog.create({
      data: {
        enrollmentId: enrollment.id,
        stepId: currentStep.id,
        channel: currentStep.channel,
        messageBody: renderedBody,
        status: 'SENT',
      },
    });

    let sendSuccess = false;
    let externalId: string | undefined;

    // Send with retry
    const delays = [0, 1000, 5000, 15000];
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
      try {
        if (currentStep.channel === 'TEXT') {
          await this.messagesService.sendMessage(lead.id, renderedBody);
          sendSuccess = true;
          break;
        } else if (currentStep.channel === 'EMAIL') {
          if (!lead.sellerEmail) {
            this.logger.warn(`Lead ${lead.id} has no email — skipping email step`);
            sendSuccess = true;
            break;
          }
          // Use org Gmail for all campaign emails
          const orgId = lead.organizationId;
          if (!orgId) {
            this.logger.warn(`Lead ${lead.id} has no organizationId — skipping email step`);
            sendSuccess = true;
            break;
          }
          const orgGmailStatus = await this.gmailService.getOrgGmailStatus(orgId);
          if (!orgGmailStatus.connected) {
            this.logger.warn(`Org ${orgId} has no Gmail connected — skipping email step`);
            sendSuccess = true;
            break;
          }
          // Daily rate limit guard (Gmail Workspace ~2000/day)
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);
          const todaySendCount = await this.prisma.email.count({
            where: {
              fromAddress: orgGmailStatus.email!,
              direction: 'outbound',
              sentAt: { gte: startOfToday },
            },
          });
          if (todaySendCount >= 1800) {
            this.logger.warn(`Org Gmail daily limit reached (${todaySendCount} sent today) — deferring email step`);
            break; // Will retry on next cron run
          }
          const unsubUrl = this.gmailService.buildUnsubscribeUrl(lead.id);
          const email = await this.gmailService.sendOrgEmail(orgId, {
            to: lead.sellerEmail,
            subject: renderedSubject || 'Following up on your property',
            bodyText: renderedBody,
            leadId: lead.id,
            listUnsubscribeUrl: unsubUrl,
          });
          externalId = email.gmailMsgId || email.id;
          sendSuccess = true;
          break;
        }
      } catch (err) {
        this.logger.warn(`Send attempt ${attempt + 1} failed for enrollment ${enrollment.id}: ${err.message}`);
      }
    }

    if (!sendSuccess) {
      await this.prisma.campaignMessageLog.update({
        where: { id: log.id },
        data: { status: 'FAILED' },
      });
    } else if (externalId) {
      await this.prisma.campaignMessageLog.update({
        where: { id: log.id },
        data: { externalId },
      });
    }

    // Note: Email touches are already recorded by gmailService.sendOrgEmail() via recordTouch('EMAIL_SENT').
    // SMS touches are already recorded by messagesService.sendMessage() via recordTouch('MESSAGE_SENT').
    // No additional recordTouch needed here — adding one would create duplicate activity entries.

    // Advance to next step
    const nextStep = steps.find((s: any) => s.stepOrder === currentStep.stepOrder + 1);
    if (nextStep) {
      const nextSendAt = this.calculateNextSendAt(nextStep);
      await this.prisma.campaignEnrollment.update({
        where: { id: enrollment.id },
        data: {
          currentStepOrder: currentStep.stepOrder,
          nextSendAt,
          lastContactAt: new Date(),
        },
      });
    } else {
      // Last step done
      await this.prisma.campaignEnrollment.update({
        where: { id: enrollment.id },
        data: {
          currentStepOrder: currentStep.stepOrder,
          status: 'COMPLETED',
          completedAt: new Date(),
          nextSendAt: null,
          lastContactAt: new Date(),
        },
      });
    }
  }

  renderTemplate(
    body: string,
    lead: LeadForTemplate,
    org?: { name: string } | null,
  ): string {
    const offerAmount = lead.askingPrice
      ? `$${Math.round(lead.askingPrice).toLocaleString()}`
      : '';
    const arvEstimate = lead.arv
      ? `$${Math.round(lead.arv).toLocaleString()}`
      : '';
    const companyName =
      org?.name?.trim() ||
      this.config.get<string>('EMAIL_FROM_NAME') ||
      'Quick Cash Home Buyers';

    return body
      .replace(/\{\{firstName\}\}/g, lead.sellerFirstName || '')
      .replace(/\{\{lastName\}\}/g, lead.sellerLastName || '')
      .replace(/\{\{propertyAddress\}\}/g, lead.propertyAddress || '')
      .replace(/\{\{city\}\}/g, lead.propertyCity || '')
      .replace(/\{\{state\}\}/g, lead.propertyState || '')
      .replace(/\{\{offerAmount\}\}/g, offerAmount)
      .replace(/\{\{arvEstimate\}\}/g, arvEstimate)
      .replace(/\{\{companyName\}\}/g, companyName)
      .replace(/\{\{senderName\}\}/g, companyName)
      .replace(/\{\{[^}]+\}\}/g, ''); // clear any remaining merge fields
  }

  calculateNextSendAt(step: any, timezone = 'America/Chicago'): Date {
    const next = new Date();
    next.setDate(next.getDate() + (step.delayDays ?? 0));
    next.setHours(next.getHours() + (step.delayHours ?? 0));

    if (step.sendWindowStart && step.sendWindowEnd) {
      const [startH, startM] = step.sendWindowStart.split(':').map(Number);
      const [endH, endM] = step.sendWindowEnd.split(':').map(Number);

      // Compare in the user's local timezone, not UTC
      const localTimeStr = next.toLocaleString('en-US', { timeZone: timezone });
      const localNow = new Date(localTimeStr);
      const localMinutes = localNow.getHours() * 60 + localNow.getMinutes();
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      if (localMinutes < startMinutes || localMinutes > endMinutes) {
        // Calculate UTC offset: difference between UTC hours and local hours
        const offsetMs = next.getTime() - localNow.getTime();

        if (localMinutes > endMinutes) {
          next.setDate(next.getDate() + 1);
        }
        // Set local time then shift back to UTC
        const localTarget = new Date(next);
        localTarget.setHours(startH, startM, 0, 0);
        return new Date(localTarget.getTime() + offsetMs);
      }
    }

    return next;
  }
}
