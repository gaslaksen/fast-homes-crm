import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { MessagesService } from '../messages/messages.service';
import { Queue } from 'bullmq';
import {
  DRIP_QUEUE_NAME,
  CAMP_STEPS,
  FALLBACK_MESSAGES,
} from './drip.constants';

@Injectable()
export class DripService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DripService.name);
  private queue: Queue;
  private demoTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private prisma: PrismaService,
    private scoringService: ScoringService,
    @Inject(forwardRef(() => MessagesService))
    private messagesService: MessagesService,
    private config: ConfigService,
  ) {}

  private getRedisConnection() {
    const password = this.config.get<string>('REDIS_PASSWORD', '');
    return {
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      ...(password ? { password } : {}),
      maxRetriesPerRequest: null,
    };
  }

  onModuleInit() {
    const redisHost = this.config.get<string>('REDIS_HOST', '');
    if (!redisHost) {
      this.logger.warn('⚠️  REDIS_HOST not configured — drip queue disabled. Drip sequences will use fallback setTimeout mode.');
      this.queue = null;
      return;
    }
    try {
      this.queue = new Queue(DRIP_QUEUE_NAME, {
        connection: this.getRedisConnection(),
      });
      this.logger.log('Drip queue initialized (BullMQ/Redis)');
    } catch (err) {
      this.logger.warn(`⚠️  Redis unavailable — drip queue disabled: ${err.message}`);
      this.queue = null;
    }
  }

  async onModuleDestroy() {
    // Clear demo timers
    for (const timer of this.demoTimers.values()) {
      clearTimeout(timer);
    }
    await this.queue?.close();
  }

  private async getDripSettings() {
    return this.prisma.dripSettings.upsert({
      where: { id: 'default' },
      create: {},
      update: {},
    });
  }

  /**
   * Schedule a drip job — uses setTimeout in demo mode, BullMQ otherwise.
   */
  private async scheduleJob(
    jobName: string,
    data: { leadId: string; sequenceId: string },
    delay: number,
    jobId: string,
    isDemo: boolean,
  ) {
    if (isDemo) {
      // Cancel any existing demo timer for this jobId
      const existing = this.demoTimers.get(jobId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(async () => {
        this.demoTimers.delete(jobId);
        try {
          if (jobName === 'send-drip') {
            await this.sendNextMessage(data.leadId, data.sequenceId);
          } else if (jobName === 'drip-timeout') {
            await this.handleTimeout(data.leadId, data.sequenceId);
          }
        } catch (err) {
          this.logger.error(`Demo timer error (${jobName}): ${err.message}`);
        }
      }, delay);
      this.demoTimers.set(jobId, timer);
      this.logger.log(`Demo timer set: ${jobName} in ${delay}ms (${jobId})`);
    } else if (this.queue) {
      await this.queue.add(jobName, data, {
        delay,
        jobId,
        removeOnComplete: true,
      });
    } else {
      // Redis unavailable — fall back to setTimeout
      const timer = setTimeout(async () => {
        this.demoTimers.delete(jobId);
        try {
          if (jobName === 'send-drip') {
            await this.sendNextMessage(data.leadId, data.sequenceId);
          } else if (jobName === 'drip-timeout') {
            await this.handleTimeout(data.leadId, data.sequenceId);
          }
        } catch (err) {
          this.logger.error(`Fallback timer error (${jobName}): ${err.message}`);
        }
      }, delay);
      this.demoTimers.set(jobId, timer);
      this.logger.warn(`Redis unavailable — fallback setTimeout for ${jobName} (${delay}ms)`);
    }
  }

  /**
   * Cancel a scheduled job.
   */
  private async cancelJob(jobId: string, isDemo: boolean) {
    if (isDemo || !this.queue) {
      const timer = this.demoTimers.get(jobId);
      if (timer) {
        clearTimeout(timer);
        this.demoTimers.delete(jobId);
      }
    } else {
      try {
        const job = await this.queue.getJob(jobId);
        if (job) await job.remove();
      } catch {
        // Job may have already been processed
      }
    }
  }

  /**
   * Start a drip sequence for a newly created lead.
   * Pre-populates answered flags from any data already on the lead.
   */
  async startSequence(leadId: string, options?: { skipInitialSend?: boolean }) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error(`Lead ${leadId} not found`);
    if (lead.doNotContact) return null;

    // Respect the global AI SMS toggle — this is a hard gate, demo mode does NOT bypass it
    const settings = await this.getDripSettings();
    if (!settings.aiSmsEnabled) {
      this.logger.log(`⏸️  AI SMS disabled (aiSmsEnabled=false) — skipping drip for lead ${leadId}`);
      return null;
    }

    // Don't start a duplicate
    const existing = await this.prisma.dripSequence.findUnique({
      where: { leadId },
    });
    if (existing) {
      this.logger.warn(`Drip sequence already exists for lead ${leadId}`);
      return existing;
    }

    const isDemo = settings.demoMode;
    const DEMO_DELAY = 2000;

    // Pre-populate flags from existing lead data
    const seq = await this.prisma.dripSequence.create({
      data: {
        leadId,
        status: 'ACTIVE',
        initialDelayMs: isDemo ? DEMO_DELAY : settings.initialDelayMs,
        retryDelayMs: isDemo ? DEMO_DELAY : settings.retryDelayMs,
        maxRetries: settings.maxRetries,
        hasTimeline: lead.timeline != null,
        hasCondition: lead.conditionLevel != null,
        hasOwnership: lead.ownershipStatus != null,
        hasAskingPrice: lead.askingPrice != null,
      },
    });

    // Check if all flags are already answered
    if (this.allAnswered(seq)) {
      await this.prisma.dripSequence.update({
        where: { id: seq.id },
        data: { status: 'COMPLETED' },
      });
      this.logger.log(`Lead ${leadId} already has all CAMP data — skipping drip`);
      return seq;
    }

    if (options?.skipInitialSend) {
      // Initial outreach already sent — just schedule the no-reply timeout
      await this.prisma.dripSequence.update({
        where: { id: seq.id },
        data: { lastMessageAt: new Date(), currentStep: 0 },
      });
      const timeoutDelay = isDemo ? DEMO_DELAY : settings.retryDelayMs;
      await this.scheduleJob(
        'drip-timeout',
        { leadId, sequenceId: seq.id },
        timeoutDelay,
        `drip-timeout-${seq.id}`,
        isDemo,
      );
      this.logger.log(
        `Drip sequence started for lead ${leadId} (skipInitialSend, timeout in ${timeoutDelay}ms, demo: ${isDemo})`,
      );
    } else {
      // Normal flow — schedule the first message
      await this.scheduleJob(
        'send-drip',
        { leadId, sequenceId: seq.id },
        seq.initialDelayMs,
        `drip-send-${seq.id}`,
        isDemo,
      );
      this.logger.log(
        `Drip sequence started for lead ${leadId} (delay: ${seq.initialDelayMs}ms, demo: ${isDemo})`,
      );
    }
    return seq;
  }

  /**
   * Send the next unanswered CAMP question.
   * Called by the BullMQ worker or demo timer.
   */
  async sendNextMessage(leadId: string, sequenceId: string) {
    const seq = await this.prisma.dripSequence.findUnique({
      where: { id: sequenceId },
    });
    if (!seq || seq.status !== 'ACTIVE') return;

    const settings = await this.getDripSettings();
    const isDemo = settings.demoMode;

    // Refresh flags from lead data
    await this.refreshAnsweredFlags(sequenceId);

    const refreshed = await this.prisma.dripSequence.findUnique({
      where: { id: sequenceId },
    });
    if (!refreshed || this.allAnswered(refreshed)) {
      await this.prisma.dripSequence.update({
        where: { id: sequenceId },
        data: { status: 'COMPLETED' },
      });
      this.logger.log(`Drip sequence ${sequenceId} completed — all CAMP data gathered`);
      return;
    }

    // Check lead status — only continue for NEW or ATTEMPTING_CONTACT
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 10 },
        organization: true,
      },
    });
    if (!lead) return;

    const dripBusinessName = (lead as any).organization?.name || 'Quick Cash Home Buyers';

    if (!['NEW', 'ATTEMPTING_CONTACT'].includes(lead.status)) {
      await this.cancelSequence(sequenceId, `Lead status changed to ${lead.status}`);
      return;
    }

    if (lead.doNotContact) {
      await this.cancelSequence(sequenceId, 'Lead opted out');
      return;
    }

    // If the seller has replied AND autoRespond is on, don't send from drip —
    // sendAutoResponse handles follow-ups with full conversation context.
    const hasSellerReplied = lead.messages.some((m) => m.direction === 'INBOUND');
    if (hasSellerReplied && lead.autoRespond) {
      this.logger.log(`Drip skipping send for lead ${leadId} — seller replied and autoRespond is on`);
      return;
    }

    // Find the next unanswered step
    const nextStep = CAMP_STEPS.find(
      (step) => !(refreshed as any)[step.key],
    );
    if (!nextStep) {
      await this.prisma.dripSequence.update({
        where: { id: sequenceId },
        data: { status: 'COMPLETED' },
      });
      return;
    }

    // Determine the step index for tracking
    const stepIndex = CAMP_STEPS.indexOf(nextStep);

    // Generate message — use CAMP fallback in demo mode, AI otherwise
    let messageBody: string;
    const hasInbound = lead.messages.some((m) => m.direction === 'INBOUND');
    const hasOutbound = lead.messages.some((m) => m.direction === 'OUTBOUND');

    if (isDemo) {
      // In demo mode, use the appropriate fallback message.
      // If the seller already replied, never send the first-contact fallback —
      // use the fallback for the NEXT unanswered step instead.
      messageBody = FALLBACK_MESSAGES[nextStep.key]
        .replace('{name}', lead.sellerFirstName)
        .replace('{address}', lead.propertyAddress);
    } else {
      try {
        // Only add intro instructions when there are NO messages at all
        const isFirstMessage = !hasOutbound && !hasInbound;

        const drafts = await this.scoringService.generateMessageDrafts(
          {
            sellerName: lead.sellerFirstName,
            propertyAddress: lead.propertyAddress,
            businessName: dripBusinessName,
            conversationHistory: lead.messages.map(
              (m) => `${m.direction}: ${m.body}`,
            ),
            purpose: isFirstMessage
              ? `This is the FIRST message to this seller — introduce yourself as ${dripBusinessName} and include "Reply STOP to opt out" at the end. Ask about the property and what they're looking for.`
              : `Continue the conversation naturally. The seller hasn't replied yet, so this is a follow-up. Keep it light, reference the property, and give them an easy reason to respond. Do NOT introduce yourself — you are already in a conversation.`,
          },
          undefined,
          lead,
          lead.messages,
        );

        messageBody = drafts.message;
      } catch (err) {
        this.logger.warn(`AI generation failed, using fallback: ${err.message}`);
        messageBody = FALLBACK_MESSAGES[nextStep.key]
          .replace('{name}', lead.sellerFirstName)
          .replace('{address}', lead.propertyAddress)
          .replace('{businessName}', dripBusinessName);
      }
    }

    // Send via messages service (no userId = automated)
    await this.messagesService.sendMessage(leadId, messageBody);

    // Update sequence state
    await this.prisma.dripSequence.update({
      where: { id: sequenceId },
      data: {
        currentStep: stepIndex,
        lastMessageAt: new Date(),
        currentRetries: 0,
      },
    });

    // Schedule timeout for no-reply (skip in demo mode — user simulates replies manually)
    if (!isDemo) {
      await this.scheduleJob(
        'drip-timeout',
        { leadId, sequenceId },
        refreshed.retryDelayMs,
        `drip-timeout-${sequenceId}`,
        false,
      );
    }

    this.logger.log(
      `Drip message sent for lead ${leadId} — step: ${nextStep.label}`,
    );
  }

  /**
   * Handle a seller reply — cancel timeout, refresh flags.
   * Only schedules next drip message if the lead does NOT have autoRespond
   * enabled (autoRespond leads are handled by sendAutoResponse instead).
   */
  async handleReply(leadId: string) {
    const seq = await this.prisma.dripSequence.findUnique({
      where: { leadId },
    });
    if (!seq || seq.status !== 'ACTIVE') return;

    const settings = await this.getDripSettings();
    const isDemo = settings.demoMode;

    // Cancel any pending timeout and send jobs
    await this.cancelJob(`drip-timeout-${seq.id}`, isDemo);
    await this.cancelJob(`drip-send-${seq.id}`, isDemo);

    // Update last reply time
    await this.prisma.dripSequence.update({
      where: { id: seq.id },
      data: { lastReplyAt: new Date() },
    });

    // Refresh flags (extraction already happened in handleInboundMessage)
    await this.refreshAnsweredFlags(seq.id);

    const refreshed = await this.prisma.dripSequence.findUnique({
      where: { id: seq.id },
    });
    if (!refreshed) return;

    if (this.allAnswered(refreshed)) {
      await this.prisma.dripSequence.update({
        where: { id: seq.id },
        data: { status: 'COMPLETED' },
      });
      this.logger.log(`Drip sequence completed for lead ${leadId}`);
      return;
    }

    // Only schedule the next drip message if autoRespond is OFF.
    // When autoRespond is ON, sendAutoResponse() handles follow-ups with
    // full conversation context — the drip would just send duplicates.
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (lead?.autoRespond) {
      this.logger.log(`Drip yielding to auto-response for lead ${leadId}`);
      return;
    }

    // Schedule next question with a short delay
    const nextDelay = isDemo ? 2000 : settings.nextQuestionDelayMs;
    await this.scheduleJob(
      'send-drip',
      { leadId, sequenceId: seq.id },
      nextDelay,
      `drip-send-${seq.id}`,
      isDemo,
    );
  }

  /**
   * Handle no-reply timeout — retry or cancel.
   * Called by the BullMQ worker or demo timer.
   */
  async handleTimeout(leadId: string, sequenceId: string) {
    const seq = await this.prisma.dripSequence.findUnique({
      where: { id: sequenceId },
    });
    if (!seq || seq.status !== 'ACTIVE') return;

    if (seq.currentRetries >= seq.maxRetries) {
      await this.cancelSequence(sequenceId, 'Max retries reached with no reply');
      return;
    }

    // Increment retries and resend
    await this.prisma.dripSequence.update({
      where: { id: sequenceId },
      data: { currentRetries: seq.currentRetries + 1 },
    });

    await this.sendNextMessage(leadId, sequenceId);
  }

  /**
   * Cancel a drip sequence.
   */
  async cancelSequence(sequenceId: string, reason: string) {
    const settings = await this.getDripSettings();
    const isDemo = settings.demoMode;

    await this.prisma.dripSequence.update({
      where: { id: sequenceId },
      data: { status: 'CANCELLED', pausedReason: reason },
    });

    await this.cancelJob(`drip-send-${sequenceId}`, isDemo);
    await this.cancelJob(`drip-timeout-${sequenceId}`, isDemo);

    this.logger.log(`Drip sequence ${sequenceId} cancelled: ${reason}`);
  }

  /**
   * Cancel drip for a lead (used when agent manually intervenes).
   */
  async cancelByLeadId(leadId: string, reason: string) {
    const seq = await this.prisma.dripSequence.findUnique({
      where: { leadId },
    });
    if (seq && seq.status === 'ACTIVE') {
      await this.cancelSequence(seq.id, reason);
    }
  }

  /**
   * Re-read lead fields and update the boolean flags on the drip sequence.
   */
  async refreshAnsweredFlags(sequenceId: string) {
    const seq = await this.prisma.dripSequence.findUnique({
      where: { id: sequenceId },
      include: { lead: true },
    });
    if (!seq) return;

    const lead = seq.lead;
    await this.prisma.dripSequence.update({
      where: { id: sequenceId },
      data: {
        hasTimeline: lead.timeline != null,
        hasCondition: lead.conditionLevel != null,
        hasOwnership: lead.ownershipStatus != null,
        hasAskingPrice: lead.askingPrice != null,
      },
    });
  }

  private allAnswered(seq: {
    hasTimeline: boolean;
    hasCondition: boolean;
    hasOwnership: boolean;
    hasAskingPrice: boolean;
  }): boolean {
    return (
      seq.hasTimeline && seq.hasCondition && seq.hasOwnership && seq.hasAskingPrice
    );
  }
}
