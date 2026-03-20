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
import { Resend } from 'resend';

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

const DEFAULT_CAMPAIGNS = [
  {
    name: 'The Gentle Follow-Up',
    description: 'A friendly 3-step follow-up for leads that have gone cold.',
    triggerDays: 15,
    isDefault: true,
    steps: [
      {
        stepOrder: 1,
        channel: 'TEXT' as const,
        delayDays: 0,
        delayHours: 0,
        sendWindowStart: '09:00',
        sendWindowEnd: '18:00',
        body: 'Hi {{firstName}}, this is Fast Homes following up on your property at {{propertyAddress}}. Are you still considering selling? We\'d love to help. Reply STOP to opt out.',
      },
      {
        stepOrder: 2,
        channel: 'TEXT' as const,
        delayDays: 7,
        delayHours: 0,
        sendWindowStart: '09:00',
        sendWindowEnd: '18:00',
        body: 'Hey {{firstName}}, just checking in again about {{propertyAddress}} in {{city}}. No pressure — just want to make sure you have options if you need to sell quickly. Reply STOP to opt out.',
      },
      {
        stepOrder: 3,
        channel: 'EMAIL' as const,
        delayDays: 14,
        delayHours: 0,
        subject: 'Still thinking about selling {{propertyAddress}}?',
        body: 'Hi {{firstName}},\n\nI wanted to reach out one more time about your property at {{propertyAddress}} in {{city}}.\n\nWe buy homes as-is, for cash, with no repairs or commissions needed. If you\'re ready to explore your options, we\'d love to make you a fair offer.\n\nBest regards,\n{{senderName}}\nFast Homes',
      },
    ],
  },
  {
    name: 'The Urgency Builder',
    description: 'A 4-step sequence that builds urgency with time-sensitive messaging.',
    triggerDays: 30,
    isDefault: true,
    steps: [
      {
        stepOrder: 1,
        channel: 'TEXT' as const,
        delayDays: 0,
        delayHours: 0,
        sendWindowStart: '09:00',
        sendWindowEnd: '18:00',
        body: '{{firstName}}, market conditions in {{city}} are shifting fast. We\'re looking to close deals quickly and your property at {{propertyAddress}} is exactly what we need. Interested? Reply YES or STOP to opt out.',
      },
      {
        stepOrder: 2,
        channel: 'TEXT' as const,
        delayDays: 3,
        delayHours: 0,
        sendWindowStart: '09:00',
        sendWindowEnd: '18:00',
        body: 'Hi {{firstName}}, we have buyers lined up for properties in {{city}} right now. Can we schedule a quick call about {{propertyAddress}}? Reply STOP to opt out.',
      },
      {
        stepOrder: 3,
        channel: 'EMAIL' as const,
        delayDays: 7,
        delayHours: 0,
        subject: 'Cash offer ready for {{propertyAddress}}',
        body: 'Hi {{firstName}},\n\nWe\'ve been watching the market in {{city}} and we\'re ready to move fast.\n\nWe can make a cash offer on your property at {{propertyAddress}} within 24 hours and close in as little as 2 weeks.\n\nNo repairs. No commissions. No waiting.\n\nReply to this email or call us to get started.\n\nBest,\n{{senderName}}\nFast Homes',
      },
      {
        stepOrder: 4,
        channel: 'TEXT' as const,
        delayDays: 14,
        delayHours: 0,
        sendWindowStart: '09:00',
        sendWindowEnd: '18:00',
        body: '{{firstName}}, last chance — we\'re wrapping up our buying list for {{city}}. Is {{propertyAddress}} still available? Reply STOP to opt out.',
      },
    ],
  },
  {
    name: 'The Empathetic Long Game',
    description: 'A 5-step empathetic sequence for leads that need more time.',
    triggerDays: 60,
    isDefault: true,
    steps: [
      {
        stepOrder: 1,
        channel: 'TEXT' as const,
        delayDays: 0,
        delayHours: 0,
        sendWindowStart: '10:00',
        sendWindowEnd: '17:00',
        body: 'Hi {{firstName}}, I know life gets busy. Just wanted you to know we\'re still here if you ever need a fast, hassle-free sale on {{propertyAddress}}. No pressure. Reply STOP to opt out.',
      },
      {
        stepOrder: 2,
        channel: 'EMAIL' as const,
        delayDays: 14,
        delayHours: 0,
        subject: 'We\'re still here for you, {{firstName}}',
        body: 'Hi {{firstName}},\n\nSelling a home is a big decision, and we respect that it takes time.\n\nWhenever you\'re ready — whether that\'s next week or next year — Fast Homes is here to give you a fair cash offer with zero hassle.\n\nWe\'ll cover closing costs, buy as-is, and close on your timeline.\n\nTake care,\n{{senderName}}\nFast Homes',
      },
      {
        stepOrder: 3,
        channel: 'TEXT' as const,
        delayDays: 30,
        delayHours: 0,
        sendWindowStart: '10:00',
        sendWindowEnd: '17:00',
        body: '{{firstName}}, just a friendly check-in. Has anything changed with {{propertyAddress}}? We\'re still actively buying in {{city}}. Reply STOP to opt out.',
      },
      {
        stepOrder: 4,
        channel: 'TEXT' as const,
        delayDays: 60,
        delayHours: 0,
        sendWindowStart: '10:00',
        sendWindowEnd: '17:00',
        body: 'Hey {{firstName}}, just thinking about you. If selling {{propertyAddress}} has crossed your mind lately, give us a call — we can have an offer to you quickly. Reply STOP to opt out.',
      },
      {
        stepOrder: 5,
        channel: 'EMAIL' as const,
        delayDays: 90,
        delayHours: 0,
        subject: 'One last thought on {{propertyAddress}}',
        body: 'Hi {{firstName}},\n\nI\'ve reached out a few times and I want to respect your time — this will be my last message unless you reach out to us.\n\nIf there\'s ever a time when selling {{propertyAddress}} makes sense, we\'d be honored to be your first call.\n\nWishing you all the best,\n{{senderName}}\nFast Homes',
      },
    ],
  },
];

@Injectable()
export class CampaignExecutionService implements OnModuleInit {
  private readonly logger = new Logger(CampaignExecutionService.name);
  private resend: Resend | null = null;
  private resendFrom: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    @Inject(forwardRef(() => MessagesService))
    private messagesService: MessagesService,
  ) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.logger.log('📧 Resend email provider configured');
    } else {
      this.logger.warn('⚠️  RESEND_API_KEY not set — email campaign steps will be skipped');
    }
    this.resendFrom =
      this.config.get<string>('RESEND_FROM_EMAIL') ||
      'Fast Homes <noreply@fasthomes.com>';
  }

  async onModuleInit() {
    await this.seedDefaultCampaigns();
  }

  private async seedDefaultCampaigns() {
    const count = await this.prisma.campaign.count({ where: { isDefault: true } });
    if (count > 0) return;

    this.logger.log('🌱 Seeding default campaigns...');
    for (const template of DEFAULT_CAMPAIGNS) {
      const { steps, ...campaignData } = template;
      await this.prisma.campaign.create({
        data: {
          ...campaignData,
          steps: { create: steps },
        },
      });
    }
    this.logger.log('✅ Default campaigns seeded');
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
      try {
        await this.executeStep(enrollment);
      } catch (err) {
        this.logger.error(`Failed to execute step for enrollment ${enrollment.id}: ${err.message}`);
      }
    }
  }

  // Run daily at 6am
  @Cron('0 6 * * *')
  async enrollStaleLeads() {
    const campaigns = await this.prisma.campaign.findMany({
      where: { isDefault: true, isActive: true },
    });

    for (const campaign of campaigns) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - campaign.triggerDays);

      const staleLeads = await this.prisma.lead.findMany({
        where: {
          updatedAt: { lte: cutoff },
          doNotContact: false,
          status: { notIn: ['CLOSED_WON', 'DEAD', 'OPTED_OUT'] },
        },
      });

      for (const lead of staleLeads) {
        const existing = await this.prisma.campaignEnrollment.findUnique({
          where: { campaignId_leadId: { campaignId: campaign.id, leadId: lead.id } },
        });
        if (!existing) {
          try {
            await this.enrollLeadInCampaign(lead.id, campaign.id);
          } catch (err) {
            this.logger.warn(`Could not enroll lead ${lead.id} in campaign ${campaign.id}: ${err.message}`);
          }
        }
      }
    }
  }

  private async enrollLeadInCampaign(leadId: string, campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!campaign) return;

    const firstStep = campaign.steps[0];
    let nextSendAt: Date | null = null;
    if (firstStep) {
      nextSendAt = new Date();
      nextSendAt.setDate(nextSendAt.getDate() + (firstStep.delayDays ?? 0));
      nextSendAt.setHours(nextSendAt.getHours() + (firstStep.delayHours ?? 0));
    }

    await this.prisma.campaignEnrollment.create({
      data: { campaignId, leadId, currentStepOrder: 0, status: 'ACTIVE', nextSendAt },
    });
  }

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

    const renderedBody = this.renderTemplate(currentStep.body, lead);
    const renderedSubject = currentStep.subject
      ? this.renderTemplate(currentStep.subject, lead)
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
          if (!this.resend) {
            this.logger.warn(`Skipping email step — RESEND_API_KEY not configured`);
            sendSuccess = true; // Skip, don't fail
            break;
          }
          if (!lead.sellerEmail) {
            this.logger.warn(`Lead ${lead.id} has no email — skipping email step`);
            sendSuccess = true;
            break;
          }
          const result = await this.resend.emails.send({
            from: this.resendFrom,
            to: lead.sellerEmail,
            subject: renderedSubject || 'Following up on your property',
            text: renderedBody,
          });
          externalId = (result.data as any)?.id;
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

  renderTemplate(body: string, lead: LeadForTemplate): string {
    const offerAmount = lead.askingPrice
      ? `$${Math.round(lead.askingPrice).toLocaleString()}`
      : '';
    const arvEstimate = lead.arv
      ? `$${Math.round(lead.arv).toLocaleString()}`
      : '';

    return body
      .replace(/\{\{firstName\}\}/g, lead.sellerFirstName || '')
      .replace(/\{\{lastName\}\}/g, lead.sellerLastName || '')
      .replace(/\{\{propertyAddress\}\}/g, lead.propertyAddress || '')
      .replace(/\{\{city\}\}/g, lead.propertyCity || '')
      .replace(/\{\{state\}\}/g, lead.propertyState || '')
      .replace(/\{\{offerAmount\}\}/g, offerAmount)
      .replace(/\{\{arvEstimate\}\}/g, arvEstimate)
      .replace(/\{\{companyName\}\}/g, 'Fast Homes')
      .replace(/\{\{senderName\}\}/g, 'Fast Homes Team')
      .replace(/\{\{[^}]+\}\}/g, ''); // clear any remaining merge fields
  }

  calculateNextSendAt(step: any): Date {
    const next = new Date();
    next.setDate(next.getDate() + (step.delayDays ?? 0));
    next.setHours(next.getHours() + (step.delayHours ?? 0));

    if (step.sendWindowStart && step.sendWindowEnd) {
      const [startH, startM] = step.sendWindowStart.split(':').map(Number);
      const [endH, endM] = step.sendWindowEnd.split(':').map(Number);

      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;
      const nowMinutes = next.getHours() * 60 + next.getMinutes();

      if (nowMinutes < startMinutes || nowMinutes > endMinutes) {
        // Push to next occurrence of sendWindowStart
        if (nowMinutes > endMinutes) {
          next.setDate(next.getDate() + 1);
        }
        next.setHours(startH, startM, 0, 0);
      }
    }

    return next;
  }
}
