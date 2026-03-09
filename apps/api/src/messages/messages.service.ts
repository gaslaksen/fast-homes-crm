import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { DripService } from '../drip/drip.service';
import { SmsProvider, createSmsProvider } from './sms.provider';
import { formatPhoneNumber, isOptOutMessage } from '@fast-homes/shared';

const MAX_AUTO_RESPONSES_PER_DAY = 5;
const AUTO_RESPONSE_DELAY_MS = 120_000;       // 2 minutes — simulate human typing
const DEMO_AUTO_RESPONSE_DELAY_MS = 2_000;    // 2 seconds in demo mode

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  private smsProvider: SmsProvider;
  private twilioNumber: string;

  constructor(
    private prisma: PrismaService,
    private scoringService: ScoringService,
    private config: ConfigService,
    @Inject(forwardRef(() => DripService))
    private dripService: DripService,
  ) {
    this.twilioNumber = this.config.get<string>('SMRTPHONE_PHONE_NUMBER') || this.config.get<string>('TWILIO_PHONE_NUMBER') || '';
    this.smsProvider = createSmsProvider(this.config);
  }

  /**
   * Generate AI message drafts
   */
  async generateDrafts(leadId: string, context?: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!lead) {
      throw new Error('Lead not found');
    }

    const conversationHistory = lead.messages.map(
      (m) => `${m.direction}: ${m.body}`,
    );

    const inboundMessages = lead.messages.filter((m) => m.direction === 'INBOUND');
    const lastInboundMessage = inboundMessages.length > 0
      ? inboundMessages[0].body  // messages ordered desc, so [0] is most recent
      : undefined;

    const drafts = await this.scoringService.generateMessageDrafts(
      {
        sellerName: lead.sellerFirstName,
        propertyAddress: lead.propertyAddress,
        conversationHistory,
        purpose: context,
        knownData: {
          askingPrice: lead.askingPrice,
          timeline: lead.timeline,
          conditionLevel: lead.conditionLevel,
          ownershipStatus: lead.ownershipStatus,
        },
        lastInboundMessage,
      },
      undefined,
      lead,
      lead.messages,
    );

    return drafts;
  }

  /**
   * Send outbound message via Twilio
   */
  async sendMessage(leadId: string, body: string, userId?: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      throw new Error('Lead not found');
    }

    if (lead.doNotContact) {
      throw new Error('Lead is marked as Do Not Contact');
    }

    const to = formatPhoneNumber(lead.sellerPhone);
    const from = this.twilioNumber;

    // Create message record
    const message = await this.prisma.message.create({
      data: {
        leadId,
        direction: 'OUTBOUND',
        status: 'PENDING',
        body,
        from,
        to,
      },
    });

    try {
      const sent = await this.smsProvider.sendSms(to, from, body);

      await this.prisma.message.update({
        where: { id: message.id },
        data: {
          twilioSid: sent.sid,
          status: 'SENT',
          sentAt: new Date(),
        },
      });

      this.logger.log(`Message sent via ${this.smsProvider.constructor.name}: ${sent.sid}`);

      // Log activity
      await this.prisma.activity.create({
        data: {
          leadId,
          userId,
          type: 'MESSAGE_SENT',
          description: userId ? `Message sent to ${to}` : `Auto-response sent to ${to}`,
          metadata: { body: body.substring(0, 100), automated: !userId },
        },
      });

      // Pipeline tracking: update touch count and advance stage
      await this.prisma.lead.update({
        where: { id: leadId },
        data: {
          lastTouchedAt: new Date(),
          touchCount: { increment: 1 },
          ...(lead.status === 'NEW'
            ? { status: 'ATTEMPTING_CONTACT', stageChangedAt: new Date(), daysInStage: 0 }
            : {}),
        },
      });

      // If an agent manually sent a message, cancel any active drip
      if (userId) {
        try {
          await this.dripService.cancelByLeadId(leadId, 'Agent manually sent a message');
        } catch {
          // Drip may not exist — that's fine
        }
      }

      return message;
    } catch (error) {
      // Mark as failed
      await this.prisma.message.update({
        where: { id: message.id },
        data: { status: 'FAILED' },
      });

      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  /**
   * Check if auto-response is allowed for this lead (safety controls).
   */
  private async canAutoRespond(leadId: string): Promise<boolean> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return false;
    if (!lead.autoRespond) return false;
    if (lead.doNotContact) return false;

    // Check daily limit
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (lead.autoResponseDate && new Date(lead.autoResponseDate) >= today) {
      if (lead.autoResponseCount >= MAX_AUTO_RESPONSES_PER_DAY) {
        this.logger.warn(`Lead ${leadId}: daily auto-response limit reached (${MAX_AUTO_RESPONSES_PER_DAY})`);
        return false;
      }
    }

    return true;
  }

  /**
   * Increment the auto-response counter for rate limiting.
   */
  private async incrementAutoResponseCount(leadId: string): Promise<void> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isToday = lead.autoResponseDate && new Date(lead.autoResponseDate) >= today;

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        autoResponseCount: isToday ? lead.autoResponseCount + 1 : 1,
        autoResponseDate: new Date(),
      },
    });
  }

  /**
   * Generate and send an automatic response based on CAMP prompt selection.
   * Returns the sent message body, or null if auto-response was skipped.
   */
  async sendAutoResponse(leadId: string, justExtracted?: Record<string, any>): Promise<string | null> {
    if (!(await this.canAutoRespond(leadId))) {
      return null;
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, take: 20 },
      },
    });
    if (!lead) return null;

    const conversationHistory = lead.messages.map(
      (m) => `${m.direction}: ${m.body}`,
    );

    // Find last inbound message
    const inboundMessages = lead.messages.filter((m) => m.direction === 'INBOUND');
    const lastInboundMessage = inboundMessages.length > 0
      ? inboundMessages[inboundMessages.length - 1].body
      : undefined;

    // Build a description of what was just extracted for acknowledgment
    const justExtractedDescriptions: string[] = [];
    if (justExtracted) {
      if (justExtracted.askingPrice != null) {
        // If seller gave a range, acknowledge both ends naturally
        if (justExtracted._askingPriceHigh) {
          const lo = Number(justExtracted.askingPrice).toLocaleString();
          const hi = Number(justExtracted._askingPriceHigh).toLocaleString();
          justExtractedDescriptions.push(`their asking price range is $${lo}–$${hi}`);
        } else {
          justExtractedDescriptions.push(`their asking price is $${Number(justExtracted.askingPrice).toLocaleString()}`);
        }
      } else if (justExtracted._askingPriceRaw) {
        // AI saw a price-like answer but couldn't pin down a number — still acknowledge it
        justExtractedDescriptions.push(`they mentioned a price of "${justExtracted._askingPriceRaw}" (treat this as their ballpark)`);
      }
      if (justExtracted.timeline != null) {
        // Describe urgency in plain language — do NOT give the AI a specific day number.
        // A short extracted timeline (e.g. 7 days) is an AI estimate from casual language;
        // actual closing timelines are discussed by the team, typically 30-60 days minimum.
        const days = justExtracted.timeline;
        const urgencyLabel = days <= 14 ? 'they want to move urgently / as soon as possible'
          : days <= 30 ? 'they want to move quickly, within about a month'
          : days <= 90 ? 'they have a moderate timeline of a couple months'
          : 'they are flexible on timing';
        justExtractedDescriptions.push(urgencyLabel);
      }
      if (justExtracted.conditionLevel != null) justExtractedDescriptions.push(`the property condition is ${justExtracted.conditionLevel}`);
      if (justExtracted.ownershipStatus != null) justExtractedDescriptions.push(`their ownership status is ${justExtracted.ownershipStatus}`);
      if (justExtracted.distressSignals != null) justExtractedDescriptions.push(`distress signals: ${justExtracted.distressSignals.join(', ')}`);
    }
    const justExtractedSummary = justExtractedDescriptions.length > 0
      ? `The seller just told you ${justExtractedDescriptions.join(' and ')}. Simply confirm you received their answer (e.g. "Got it", "Thanks for sharing that") — do NOT agree to, commit to, or validate their price or timeline. You are gathering information only, not making any offer or promise.`
      : '';

    // Determine NEXT single CAMP field to ask about (Priority → Money → Challenge → Authority)
    const campFieldLabels: { field: string; label: string; question: string; keywords: string[] }[] = [
      { field: 'timeline', label: 'TIMELINE', question: 'how soon they want to sell',
        keywords: ['timeline', 'how soon', 'when are you', 'when do you', 'timeframe', 'time frame', 'sell by', 'hoping to sell', 'looking to sell'] },
      { field: 'askingPrice', label: 'ASKING PRICE', question: 'what price they are hoping to get',
        keywords: ['price', 'asking', 'hoping to get', 'ballpark', 'how much', 'what are you looking'] },
      { field: 'conditionLevel', label: 'PROPERTY CONDITION', question: 'the condition of the property',
        keywords: ['condition', 'shape', 'repairs', 'roof', 'foundation', 'hvac', 'updates', 'renovated', 'fixer'] },
      { field: 'ownershipStatus', label: 'OWNERSHIP', question: 'who owns the property and who can make decisions',
        keywords: ['owner', 'ownership', 'decision', 'others involved', 'sole owner', 'co-own', 'title'] },
    ];

    // Helper: has a CAMP topic been asked in outbound messages AND has the seller
    // replied at least once since then? If so, treat as "addressed" even if
    // extraction couldn't parse a clean value.
    const hasBeenAddressedInConversation = (keywords: string[]): boolean => {
      const msgs = lead.messages;
      // Find the LAST outbound message that asked about this topic
      let lastAskedIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].direction === 'OUTBOUND') {
          const body = msgs[i].body.toLowerCase();
          if (keywords.some(k => body.includes(k))) {
            lastAskedIdx = i;
            break;
          }
        }
      }
      if (lastAskedIdx === -1) return false;
      // Check if seller replied after that ask
      return msgs.slice(lastAskedIdx + 1).some(m => m.direction === 'INBOUND');
    };

    let nextField: typeof campFieldLabels[0] | null = null;
    for (const cf of campFieldLabels) {
      const hasValue = (lead as any)[cf.field] != null;
      const addressed = hasValue || hasBeenAddressedInConversation(cf.keywords);
      if (!addressed) {
        nextField = cf;
        break;
      }
    }

    let purpose: string;
    const campComplete = !nextField;

    if (nextField) {
      purpose = justExtractedSummary
        ? `${justExtractedSummary} Then ask about their ${nextField.label} — ${nextField.question}.`
        : `Continue the conversation naturally. Ask about their ${nextField.label} — ${nextField.question}.`;
    } else {
      // CAMP is complete — close the conversation warmly, no more questions
      const knownSummary = [
        lead.timeline != null ? `timeline of ${lead.timeline === 365 ? 'no specific urgency' : `~${lead.timeline} days`}` : null,
        lead.askingPrice != null ? `asking price around $${Number(lead.askingPrice).toLocaleString()}` : null,
        lead.conditionLevel != null ? `property in ${lead.conditionLevel} condition` : null,
        lead.ownershipStatus != null ? `ownership: ${lead.ownershipStatus.replace('_', ' ')}` : null,
      ].filter(Boolean).join(', ');

      purpose = `CAMP COMPLETE — DO NOT ASK ANY MORE QUESTIONS. This is your closing message.
What you know: ${knownSummary || 'gathered all key details'}.
Your message must:
1. Thank ${lead.sellerFirstName} sincerely for their time and for sharing
2. Tell them someone from the Fast Homes team will review the information and reach out soon to discuss next steps
3. Keep it warm and brief — under 160 characters if possible
4. Do NOT ask anything. Do NOT request more info. End the conversation professionally.
5. Do NOT repeat back their price or timeline in a way that implies agreement or commitment (e.g. do NOT say "We'll do $250k" or "We can close in 7 days") — the team will handle those discussions separately.`;
    }

    const knownData = {
      askingPrice: lead.askingPrice,
      timeline: lead.timeline,
      conditionLevel: lead.conditionLevel,
      ownershipStatus: lead.ownershipStatus,
    };

    try {
      const drafts = await this.scoringService.generateMessageDrafts(
        {
          sellerName: lead.sellerFirstName,
          propertyAddress: lead.propertyAddress,
          conversationHistory,
          purpose,
          knownData,
          justExtracted,
          lastInboundMessage,
        },
        undefined,
        lead,
        lead.messages,
      );

      // Sentiment-based tone selection
      let selectedTone: 'direct' | 'friendly' | 'professional' = 'friendly';
      if (lastInboundMessage) {
        const sentiment = await this.scoringService.detectSentiment(lastInboundMessage);
        if (sentiment === 'positive' || sentiment === 'neutral') selectedTone = 'friendly';
        else if (sentiment === 'hesitant') selectedTone = 'professional';
        else if (sentiment === 'negative') selectedTone = 'professional';
        this.logger.log(`🎭 Sentiment: ${sentiment} → tone: ${selectedTone}`);
      }
      const messageBody = drafts[selectedTone];

      // If all CAMP is complete, create follow-up task and shut off auto-respond
      if (campComplete) {
        try {
          await this.prisma.task.create({
            data: {
              leadId,
              title: 'Review CAMP info and make offer',
              description: 'AI has gathered all CAMP information from the seller. Review the details and follow up with an offer.',
              dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
          this.logger.log(`📋 Follow-up task created for lead ${leadId} — CAMP complete`);
        } catch (err) {
          this.logger.warn(`Could not create follow-up task for lead ${leadId}: ${err.message}`);
        }

        // Turn off auto-respond so no more AI messages fire after the closing
        await this.prisma.lead.update({
          where: { id: leadId },
          data: { autoRespond: false, status: 'CAMP_COMPLETE' },
        }).catch(() => {
          // status might not accept CAMP_COMPLETE — just turn off auto-respond
          this.prisma.lead.update({ where: { id: leadId }, data: { autoRespond: false } });
        });
        this.logger.log(`🔕 Auto-respond disabled for lead ${leadId} — CAMP complete, closing message sent`);
      }

      await this.sendMessage(leadId, messageBody);
      await this.incrementAutoResponseCount(leadId);

      // Refresh CAMP flags
      await this.scoringService.refreshCampFlags(leadId);

      this.logger.log(`Auto-response sent for lead ${leadId} (next CAMP: ${nextField?.label || 'complete'}, tone: ${selectedTone})`);
      return messageBody;
    } catch (error) {
      this.logger.error(`Auto-response failed for lead ${leadId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Send the initial outreach message for a new lead.
   * Called automatically after lead creation with a delay.
   */
  async sendInitialOutreach(leadId: string): Promise<string | null> {
    if (!(await this.canAutoRespond(leadId))) {
      return null;
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, take: 5 },
      },
    });
    if (!lead) return null;

    // Don't send if any real messages exist (ignore SIMULATED sids from old broken attempts)
    const realMessages = lead.messages.filter(
      (m) => !m.twilioSid?.startsWith('SIMULATED') && !m.twilioSid?.startsWith('BLOCKED'),
    );
    if (realMessages.length > 0) {
      this.logger.log(`Lead ${leadId}: real messages already exist (${realMessages.length}), skipping initial outreach`);
      return null;
    }

    try {
      const drafts = await this.scoringService.generateMessageDrafts(
        {
          sellerName: lead.sellerFirstName,
          propertyAddress: lead.propertyAddress,
          conversationHistory: [],
          purpose: 'First outreach to a new seller lead. Introduce yourself as Fast Homes for Cash and include "Reply STOP to opt out" at the end.',
        },
        undefined,
        lead,
        lead.messages,
      );

      const messageBody = drafts.friendly;
      await this.sendMessage(leadId, messageBody);
      await this.incrementAutoResponseCount(leadId);

      this.logger.log(`Initial outreach sent for lead ${leadId}`);
      return messageBody;
    } catch (error) {
      this.logger.error(`Initial outreach failed for lead ${leadId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Handle inbound message from Twilio webhook
   */
  async handleInboundMessage(data: {
    MessageSid: string;
    From: string;
    To: string;
    Body: string;
  }) {
    const from = formatPhoneNumber(data.From);
    const body = data.Body.trim();

    this.logger.log(`📥 Inbound message from ${from}: "${body.substring(0, 80)}"`);

    // Find lead by phone number — try E.164 first, then 10-digit fallback
    const stripped = from.replace(/\D/g, '').replace(/^1/, ''); // → 10 digits
    const lead = await this.prisma.lead.findFirst({
      where: {
        OR: [
          { sellerPhone: from },           // +17046812994
          { sellerPhone: stripped },        // 7046812994
          { sellerPhone: `1${stripped}` },  // 17046812994
        ],
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!lead) {
      console.warn(`No lead found for phone: ${from}`);
      return { success: false, reason: 'Lead not found' };
    }

    // Check for opt-out
    if (isOptOutMessage(body)) {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          doNotContact: true,
          unsubscribedAt: new Date(),
          autoRespond: false,
        },
      });

      this.logger.log(`Lead ${lead.id} opted out`);

      // Send opt-out confirmation
      try {
        await this.smsProvider.sendSms(
          data.From,
          data.To,
          'You have been unsubscribed from Fast Homes for Cash. You will not receive further messages.',
        );
      } catch (err) {
        this.logger.warn(`Could not send opt-out confirmation: ${err.message}`);
      }

      return { success: true, optOut: true };
    }

    // Save message
    const message = await this.prisma.message.create({
      data: {
        leadId: lead.id,
        direction: 'INBOUND',
        status: 'RECEIVED',
        body,
        from,
        to: data.To,
        twilioSid: data.MessageSid,
        sentAt: new Date(),
      },
    });

    // Log activity
    await this.prisma.activity.create({
      data: {
        leadId: lead.id,
        type: 'MESSAGE_RECEIVED',
        description: `Message received from ${from}`,
        metadata: { body: body.substring(0, 100) },
      },
    });

    // Pipeline tracking: update touch count and auto-advance stage
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        lastTouchedAt: new Date(),
        touchCount: { increment: 1 },
        ...(lead.status === 'ATTEMPTING_CONTACT'
          ? { status: 'CONTACT_MADE', stageChangedAt: new Date(), daysInStage: 0 }
          : {}),
      },
    });

    // Cancel any pending drip messages so they don't fire and duplicate our auto-response
    try {
      await this.dripService.handleReply(lead.id);
      this.logger.log(`🛑 Drip paused for lead ${lead.id} — auto-response will handle follow-up`);
    } catch (error) {
      // Drip may not exist — that's fine
    }

    // Extract signals from message using AI
    const allMessages = [
      ...lead.messages.map((m) => m.body),
      body,
    ];

    let updateData: any = {};
    try {
      const extracted = await this.scoringService.extractFromMessages(allMessages);
      const confidence = extracted.confidence ?? 100;

      if (confidence < 50) {
        this.logger.warn(`⚠️  Low confidence extraction (${confidence}) for lead ${lead.id} — skipping field updates`);
      } else {
        // Update lead with extracted info
        // Use 365 as sentinel for "no specific timeline" so the field isn't null forever
        if (extracted.timeline_days != null) updateData.timeline = extracted.timeline_days;
        if (extracted.asking_price) updateData.askingPrice = extracted.asking_price;
        if (extracted.condition_level) updateData.conditionLevel = extracted.condition_level;
        if (extracted.distress_signals) updateData.distressSignals = extracted.distress_signals;
        if (extracted.ownership_status) updateData.ownershipStatus = extracted.ownership_status;
        if (extracted.seller_motivation) updateData.sellerMotivation = extracted.seller_motivation;

        // Pass raw price text through so the AI response can acknowledge it naturally
        // even when the parsed number is uncertain (e.g. "70 to 80" → "around $70k–$80k")
        if (extracted.asking_price_raw) updateData._askingPriceRaw = extracted.asking_price_raw;
        if (extracted.asking_price_high) updateData._askingPriceHigh = extracted.asking_price_high;

        if (Object.keys(updateData).length > 0) {
          await this.prisma.lead.update({
            where: { id: lead.id },
            data: updateData,
          });

          this.logger.log(`💾 Updated lead ${lead.id} with extracted data (confidence: ${confidence}): ${JSON.stringify(updateData)}`);

          // Refresh CAMP flags and rescore
          await this.scoringService.refreshCampFlags(lead.id);
          await this.rescoreLead(lead.id);
        }
      }
    } catch (error) {
      console.error('Failed to extract from messages:', error);
    }

    // Schedule auto-response with a delay (don't reply instantly — simulate human)
    this.scheduleAutoResponse(lead.id, updateData);

    return { success: true, messageId: message.id };
  }

  /**
   * Schedule an auto-response with a human-like delay.
   * Uses setTimeout so the webhook can return immediately.
   */
  private async scheduleAutoResponse(leadId: string, updateData: Record<string, any>) {
    let delay = AUTO_RESPONSE_DELAY_MS;
    try {
      const settings = await this.prisma.dripSettings.findUnique({ where: { id: 'default' } });
      if (settings?.demoMode) {
        delay = DEMO_AUTO_RESPONSE_DELAY_MS;
      }
    } catch {
      // Use default delay
    }

    this.logger.log(`⏱️  Auto-response for lead ${leadId} scheduled in ${delay}ms`);

    setTimeout(async () => {
      try {
        const responseBody = await this.sendAutoResponse(leadId, updateData);
        if (responseBody) {
          this.logger.log(`💬 Auto-response sent for lead ${leadId}: "${responseBody.substring(0, 80)}"`);
        }
      } catch (error) {
        this.logger.error(`Auto-response failed for lead ${leadId}: ${error.message}`);
      }
    }, delay);
  }

  /**
   * Rescore a lead (called after message updates or manual trigger)
   */
  async rescoreLead(leadId: string, userId?: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      throw new Error('Lead not found');
    }

    const oldScore = lead.totalScore;
    const oldBand = lead.scoreBand;

    // Calculate new score
    const scoringResult = await this.scoringService.scoreLead({
      timeline: lead.timeline,
      askingPrice: lead.askingPrice,
      arv: lead.arv,
      conditionLevel: lead.conditionLevel,
      distressSignals: lead.distressSignals as string[] | undefined,
      ownershipStatus: lead.ownershipStatus,
    });

    // Update lead
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        challengeScore: scoringResult.challengeScore,
        authorityScore: scoringResult.authorityScore,
        moneyScore: scoringResult.moneyScore,
        priorityScore: scoringResult.priorityScore,
        totalScore: scoringResult.totalScore,
        scoreBand: scoringResult.scoreBand,
        abcdFit: scoringResult.abcdFit,
        scoringRationale: scoringResult.rationale,
        lastScoredAt: new Date(),
      },
    });

    // Log activity if score changed
    if (oldScore !== scoringResult.totalScore) {
      await this.prisma.activity.create({
        data: {
          leadId,
          userId,
          type: 'SCORE_UPDATED',
          description: `Score updated: ${oldScore} → ${scoringResult.totalScore} (${scoringResult.scoreBand})`,
          metadata: {
            oldScore,
            newScore: scoringResult.totalScore,
            oldBand,
            newBand: scoringResult.scoreBand,
          },
        },
      });
    }

    return scoringResult;
  }

  /**
   * Simulate an inbound reply (demo mode).
   * Creates a fake inbound message, extracts CAMP data with simple
   * keyword matching (no AI needed), updates the lead, and auto-responds.
   */
  async simulateReply(leadId: string, body: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });
    if (!lead) throw new Error('Lead not found');

    // Save the simulated inbound message
    const message = await this.prisma.message.create({
      data: {
        leadId,
        direction: 'INBOUND',
        status: 'RECEIVED',
        body,
        from: lead.sellerPhone,
        to: this.twilioNumber || '+15550000000',
        twilioSid: `SIMULATED_${Date.now()}`,
        sentAt: new Date(),
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'MESSAGE_RECEIVED',
        description: `Simulated reply from seller`,
        metadata: { body: body.substring(0, 100) },
      },
    });

    // Extract CAMP data using Claude AI — same path as real inbound messages
    const updateData: any = {};
    try {
      const allMessages = await this.prisma.message.findMany({
        where: { leadId },
        orderBy: { createdAt: 'asc' },
        select: { body: true },
      });
      const messageTexts = [...allMessages.map(m => m.body), body];
      const extracted = await this.scoringService.extractFromMessages(messageTexts);
      const confidence = extracted.confidence ?? 100;

      if (confidence >= 50) {
        if (extracted.timeline_days != null) updateData.timeline = extracted.timeline_days;
        if (extracted.asking_price) updateData.askingPrice = extracted.asking_price;
        if (extracted.condition_level) updateData.conditionLevel = extracted.condition_level;
        if (extracted.ownership_status) updateData.ownershipStatus = extracted.ownership_status;
        if (extracted.seller_motivation) updateData.sellerMotivation = extracted.seller_motivation;
        if (extracted.distress_signals?.length) updateData.distressSignals = extracted.distress_signals;
        if (extracted.asking_price_high) updateData._askingPriceHigh = extracted.asking_price_high;
        if (extracted.asking_price_raw) updateData._askingPriceRaw = extracted.asking_price_raw;
      }
    } catch (err) {
      this.logger.error(`simulateReply extraction failed: ${err.message}`);
    }

    if (Object.keys(updateData).filter(k => !k.startsWith('_')).length > 0) {
      await this.prisma.lead.update({
        where: { id: leadId },
        data: Object.fromEntries(Object.entries(updateData).filter(([k]) => !k.startsWith('_'))),
      });
      this.logger.log(`💾 simulateReply: updated lead ${leadId}: ${JSON.stringify(updateData)}`);

      await this.scoringService.refreshCampFlags(leadId);
      await this.rescoreLead(leadId);
    }

    // Cancel any pending drip jobs so they don't fire and duplicate the auto-response
    try {
      await this.dripService.handleReply(leadId);
    } catch {
      // Drip may not exist — that's fine
    }

    // Schedule auto-response with a short delay (even in demo, simulate human)
    this.scheduleAutoResponse(leadId, updateData);

    return { success: true, messageId: message.id, extracted: updateData, autoResponse: '(scheduled)' };
  }

  /**
   * Get messages for a lead
   */
  async getMessages(leadId: string) {
    return this.prisma.message.findMany({
      where: { leadId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
