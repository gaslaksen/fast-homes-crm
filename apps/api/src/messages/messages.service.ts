import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { DripService } from '../drip/drip.service';
import { CampaignEnrollmentService } from '../campaigns/campaign-enrollment.service';
import { SmsProvider, createSmsProvider } from './sms.provider';
import { formatPhoneNumber, isOptOutMessage } from '@fast-homes/shared';

const MAX_AUTO_RESPONSES_PER_DAY = 5;
const AUTO_RESPONSE_DELAY_MS = 180_000;       // 3 minutes — wait for seller to finish typing
const DEMO_AUTO_RESPONSE_DELAY_MS = 2_000;    // 2 seconds in demo mode

// Quiet hours: do not auto-respond between 9 PM and 8 AM in the seller's approximate timezone.
// We use ET as a conservative default (most US sellers). If the response arrives inside quiet
// hours we acknowledge the message immediately with a brief "we'll be in touch" note and
// schedule the actual response for 8 AM ET next morning.
const QUIET_HOUR_START = 21; // 9 PM
const QUIET_HOUR_END   =  8; // 8 AM

/**
 * Return true if the current time (ET) is inside quiet hours.
 * We use Intl.DateTimeFormat to get the actual ET hour so daylight saving
 * is handled automatically without any extra library.
 */
function isQuietHours(): boolean {
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
    10,
  );
  return hour >= QUIET_HOUR_START || hour < QUIET_HOUR_END;
}

/**
 * Return the number of milliseconds until 8 AM ET.
 */
function msUntilMorning(): number {
  const now = new Date();
  // Build tomorrow-8am in ET
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = etFormatter.formatToParts(now);
  const p: Record<string, string> = {};
  for (const { type, value } of parts) p[type] = value;
  // Construct "today at 8 AM ET" in UTC via ISO string trick
  const etMidnightStr = `${p.year}-${p.month}-${p.day}T08:00:00`;
  // Use Intl to detect offset
  const etOffsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
  });
  const offsetStr = etOffsetFormatter.formatToParts(now).find(x => x.type === 'timeZoneName')?.value || 'GMT-4';
  const offsetMatch = offsetStr.match(/GMT([+-]\d+)/);
  const offsetHours = offsetMatch ? parseInt(offsetMatch[1], 10) : -4;
  const targetUtc = new Date(`${etMidnightStr}${offsetHours >= 0 ? '+' : ''}${offsetHours}:00`);
  // If 8 AM ET today has already passed, use tomorrow
  if (targetUtc.getTime() <= now.getTime()) {
    targetUtc.setDate(targetUtc.getDate() + 1);
  }
  return targetUtc.getTime() - now.getTime();
}

/**
 * Build a brief "after-hours acknowledgment" message — tells the seller we
 * received their message and will follow up in the morning. Warm and human.
 */
function buildAfterHoursAck(sellerFirstName: string, businessName: string): string {
  const name = sellerFirstName || 'there';
  return `Hey ${name}, got your message! It's a bit late on our end — we'll be in touch first thing in the morning. Have a good night!`;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  private smsProvider: SmsProvider;
  private twilioNumber: string;
  // Debounce map: leadId → pending timer handle. When a new inbound message arrives
  // before the timer fires, we cancel the old one and schedule a fresh one so we
  // always respond to the seller's LAST message, not each individual one.
  private pendingResponseTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private prisma: PrismaService,
    private scoringService: ScoringService,
    private config: ConfigService,
    @Inject(forwardRef(() => DripService))
    private dripService: DripService,
    @Inject(forwardRef(() => CampaignEnrollmentService))
    private campaignEnrollmentService: CampaignEnrollmentService,
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

      // If an agent manually sent a message, pause AI and cancel any active drip
      if (userId) {
        await this.prisma.lead.update({
          where: { id: leadId },
          data: { autoRespond: false },
        });
        try {
          await this.dripService.cancelByLeadId(leadId, 'Agent manually sent a message');
        } catch {
          // Drip may not exist — that's fine
        }
        this.logger.log(`🤚 Agent manual send for lead ${leadId} — AI auto-respond paused`);
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
    // ── Global master switch — always checked first ──────────────────────────
    const settings = await this.prisma.dripSettings.findUnique({ where: { id: 'default' } });
    if (!settings?.aiSmsEnabled) {
      this.logger.log(`⏸️  AI SMS master switch OFF — blocking auto-respond for lead ${leadId}`);
      return false;
    }

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
        organization: true,
      },
    });
    if (!lead) return null;

    const autoBusinessName = (lead as any).organization?.name || 'Fast Homes for Cash';
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

    // ── Determine what CAMP data we still need ────────────────────────────────
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

    const campComplete = !nextField;

    // ── Build rich property context so the AI can respond intelligently ────────
    // Things the AI should know about the property that enrich the conversation
    const propertyContextLines: string[] = [];
    const attomAvm = (lead as any).attomAvm;
    const arv = (lead as any).arv || (lead as any).avmExcellentHigh;
    const beds = (lead as any).bedrooms;
    const baths = (lead as any).bathrooms;
    const sqft = (lead as any).sqft;
    const yearBuilt = (lead as any).yearBuilt;

    if (beds || baths || sqft) {
      propertyContextLines.push(
        `Property specs: ${[beds ? `${beds}bd` : '', baths ? `${baths}ba` : '', sqft ? `${sqft.toLocaleString()} sqft` : ''].filter(Boolean).join('/')}${yearBuilt ? `, built ${yearBuilt}` : ''}`
      );
    }
    if (arv) {
      propertyContextLines.push(`Estimated after-repair value (ARV): ~$${Math.round(arv).toLocaleString()} (team use only — do NOT mention this to the seller)`);
    } else if (attomAvm) {
      propertyContextLines.push(`Public AVM estimate: ~$${Math.round(attomAvm).toLocaleString()} (team use only — do NOT mention this to the seller)`);
    }

    // MLS / listing status awareness
    const sourceMetadata = (lead as any).sourceMetadata as Record<string, any> | null;
    const isActiveListing =
      sourceMetadata?.listingStatus === 'active' ||
      sourceMetadata?.mlsStatus === 'Active' ||
      (lead as any).source === 'mls_listing';

    if (isActiveListing) {
      const listPrice = sourceMetadata?.listPrice || sourceMetadata?.list_price;
      propertyContextLines.push(
        `IMPORTANT CONTEXT: This property is currently listed for sale on the MLS${listPrice ? ` at $${Number(listPrice).toLocaleString()}` : ''}. The seller is ALREADY trying to sell through a real estate agent. DO NOT ask "are you thinking about selling?" or similar — they clearly are. Instead, acknowledge you can offer a cash alternative, or ask about why they're exploring other options alongside the listing.`
      );
    }

    const propertyContext = propertyContextLines.length > 0
      ? `\nProperty context (for your reference):\n${propertyContextLines.map(l => `  - ${l}`).join('\n')}\n`
      : '';

    // ── Build the purpose string — contextual, not formulaic ──────────────────
    let purpose: string;

    if (campComplete) {
      // CAMP is complete — close the conversation warmly, no more questions
      const knownSummary = [
        lead.timeline != null ? `timeline of ${lead.timeline === 365 ? 'no specific urgency' : `~${lead.timeline} days`}` : null,
        lead.askingPrice != null ? `asking price around $${Number(lead.askingPrice).toLocaleString()}` : null,
        lead.conditionLevel != null ? `property in ${lead.conditionLevel} condition` : null,
        lead.ownershipStatus != null ? `ownership: ${lead.ownershipStatus.replace('_', ' ')}` : null,
      ].filter(Boolean).join(', ');

      purpose = `${propertyContext}CAMP COMPLETE — DO NOT ASK ANY MORE QUESTIONS. This is your closing message.
What you know: ${knownSummary || 'gathered all key details'}.
Your message must:
1. Thank ${lead.sellerFirstName} sincerely for their time and for sharing
2. Tell them someone from the team will review the information and reach out soon to discuss next steps
3. Keep it warm and brief — under 160 characters if possible
4. Do NOT ask anything. Do NOT request more info. End the conversation professionally.
5. Do NOT repeat back their price or timeline in a way that implies agreement or commitment.`;
    } else {
      // CAMP not yet complete — ask the next question, but do it conversationally.
      // The key instruction: react naturally to WHAT THE SELLER JUST SAID, then
      // weave in the next CAMP question only if it flows naturally. If the seller
      // seems confused, frustrated, or has asked a direct question, address THAT
      // first before pivoting to data gathering.
      const nextQuestion = nextField
        ? `The next piece of information we need is: ${nextField.label} — ${nextField.question}.`
        : '';

      purpose = `${propertyContext}${justExtractedSummary ? justExtractedSummary + ' ' : ''}
Read the seller's last message carefully. React to it naturally — address anything they asked or said before asking your own question.
${isActiveListing ? 'Remember: this property IS already listed for sale. Do not ask if they want to sell — ask about their experience with the listing or why they are exploring a cash offer.' : ''}
${nextQuestion}
IMPORTANT: If the seller seems confused, annoyed, or asked you something specific, answer THEM first — then gently ask the next question. Don't just bulldoze through CAMP if the conversation isn't flowing naturally.
Keep it human, warm, and under 160 characters. Ask only ONE question.`.trim();
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
          businessName: autoBusinessName,
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
   *
   * We now build a rich context block from everything we know about the
   * property at this point (AVM, beds/baths, ARV, listing status) so the
   * opening message references the specific property intelligently rather
   * than using a generic opener. We also make it clear we're following up
   * on their form submission — not cold-contacting them.
   */
  async sendInitialOutreach(leadId: string): Promise<string | null> {
    if (!(await this.canAutoRespond(leadId))) {
      return null;
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, take: 5 },
        organization: true,
      },
    });
    if (!lead) return null;

    const businessName = (lead as any).organization?.name || 'Fast Homes for Cash';

    // Don't send if any real messages exist (ignore SIMULATED sids from old broken attempts)
    const realMessages = lead.messages.filter(
      (m) => !m.twilioSid?.startsWith('SIMULATED') && !m.twilioSid?.startsWith('BLOCKED'),
    );
    if (realMessages.length > 0) {
      this.logger.log(`Lead ${leadId}: real messages already exist (${realMessages.length}), skipping initial outreach`);
      return null;
    }

    // ── Build property context for a smarter opening message ──────────────────
    const propertyContextParts: string[] = [];

    // Beds/baths/sqft from any enrichment source
    const beds = (lead as any).bedrooms;
    const baths = (lead as any).bathrooms;
    const sqft = (lead as any).sqft;
    const yearBuilt = (lead as any).yearBuilt;
    const propertyType = (lead as any).propertyType;
    if (beds || baths) {
      const bdStr = beds ? `${beds}bd` : '';
      const baStr = baths ? `${baths}ba` : '';
      propertyContextParts.push([bdStr, baStr].filter(Boolean).join('/'));
    }
    if (sqft) propertyContextParts.push(`${sqft.toLocaleString()} sqft`);
    if (yearBuilt) propertyContextParts.push(`built ${yearBuilt}`);
    if (propertyType && propertyType !== 'Auto') propertyContextParts.push(propertyType);

    // AVM / ARV awareness
    const attomAvm = (lead as any).attomAvm;
    const arv = (lead as any).arv || (lead as any).avmExcellentHigh;

    // Check for active MLS listing — Zillow-scraped ZPID stored in sourceMetadata
    // We don't have a dedicated MLS field yet, so we detect listing awareness from
    // sourceMetadata or the sourceUrl field on the lead's photos.
    // For now we flag it if the source indicates an active listing
    const sourceMetadata = (lead as any).sourceMetadata as Record<string, any> | null;
    const isActiveListing =
      sourceMetadata?.listingStatus === 'active' ||
      sourceMetadata?.mlsStatus === 'Active' ||
      (lead as any).source === 'mls_listing';

    // Build the purpose string with all available context
    const propertyDescription = propertyContextParts.length > 0
      ? `The property is a ${propertyContextParts.join(', ')}.`
      : '';
    const arvHint = arv
      ? ` We've pulled some data and the estimated value is around $${Math.round(arv / 1000) * 1000 >= 1000 ? `${Math.round(arv / 1000)}k` : arv.toLocaleString()}.`
      : attomAvm
      ? ` Public records show an estimated value around $${Math.round(attomAvm / 1000) * 1000 >= 1000 ? `${Math.round(attomAvm / 1000)}k` : attomAvm.toLocaleString()}.`
      : '';
    const listingHint = isActiveListing
      ? ` We also see the property is currently listed on the market — we work alongside traditional listings and can offer a no-commission cash offer alternative.`
      : '';

    const purpose = [
      `First outreach to a seller who submitted a lead form about their property at ${lead.propertyAddress}.`,
      `They reached out to us first — acknowledge that you're following up on their inquiry (do NOT say you "found" or "saw" their property as if cold-contacting them).`,
      propertyDescription,
      `Briefly introduce yourself as ${businessName}, reference their inquiry, and ask ONE open-ended question to start the conversation (e.g. what prompted them to reach out, or what they're hoping to accomplish).`,
      arvHint,
      listingHint,
      `Keep it warm, personal, and under 160 characters.`,
      `End with "Reply STOP to opt out."`,
    ].filter(Boolean).join(' ');
    // ──────────────────────────────────────────────────────────────────────────

    try {
      const drafts = await this.scoringService.generateMessageDrafts(
        {
          sellerName: lead.sellerFirstName,
          propertyAddress: lead.propertyAddress,
          businessName,
          conversationHistory: [],
          purpose,
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
        organization: true,
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
          `You have been unsubscribed from ${(lead as any).organization?.name || 'Fast Homes for Cash'}. You will not receive further messages.`,
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
          ? { status: 'QUALIFYING', stageChangedAt: new Date(), daysInStage: 0 }
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

    // Pause any active campaign enrollments for this lead
    try {
      await this.campaignEnrollmentService.handleReply(lead.id);
    } catch (error) {
      // Campaign enrollment may not exist — that's fine
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

        // Filter out virtual _underscore fields before writing to Prisma (they're not schema columns)
        const prismaUpdateData = Object.fromEntries(
          Object.entries(updateData).filter(([k]) => !k.startsWith('_')),
        );

        if (Object.keys(prismaUpdateData).length > 0) {
          await this.prisma.lead.update({
            where: { id: lead.id },
            data: prismaUpdateData,
          });

          this.logger.log(`💾 Updated lead ${lead.id} with extracted data (confidence: ${confidence}): ${JSON.stringify(prismaUpdateData)}`);

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

    return { success: true, messageId: message.id, leadId: lead.id };
  }

  /**
   * Schedule an auto-response with a human-like delay.
   * Debounced: if another inbound message arrives before the timer fires,
   * the old timer is cancelled and a new one starts. This prevents sending
   * duplicate/stale replies when a seller sends multiple texts in quick succession.
   *
   * Quiet-hours aware: if it is currently between 9 PM and 8 AM ET we send a
   * brief acknowledgment immediately ("got your message, we'll follow up in the
   * morning") and defer the full AI response until 8 AM ET.
   */
  private async scheduleAutoResponse(leadId: string, updateData: Record<string, any>) {
    let delay = AUTO_RESPONSE_DELAY_MS;
    let isDemoMode = false;
    try {
      const settings = await this.prisma.dripSettings.findUnique({ where: { id: 'default' } });
      if (settings?.demoMode) {
        delay = DEMO_AUTO_RESPONSE_DELAY_MS;
        isDemoMode = true;
      }
    } catch {
      // Use default delay
    }

    // Cancel any existing pending timer for this lead
    const existing = this.pendingResponseTimers.get(leadId);
    if (existing) {
      clearTimeout(existing);
      this.logger.log(`⏱️  Cancelled previous pending auto-response for lead ${leadId} (new message arrived)`);
    }

    // ── Quiet-hours check ──────────────────────────────────────────────────────
    // In demo mode we skip quiet-hours so demos don't get blocked.
    if (!isDemoMode && isQuietHours()) {
      const msUntil = msUntilMorning();
      this.logger.log(`🌙 Quiet hours — scheduling auto-response for lead ${leadId} at 8 AM ET (~${Math.round(msUntil / 60000)} min)`);

      // Send an immediate acknowledgment so the seller knows we received their message
      try {
        const lead = await this.prisma.lead.findUnique({
          where: { id: leadId },
          include: { organization: true },
        });
        if (lead) {
          const businessName = (lead as any).organization?.name || 'Fast Homes for Cash';
          const ack = buildAfterHoursAck(lead.sellerFirstName, businessName);
          await this.sendMessage(leadId, ack);
          this.logger.log(`🌙 After-hours ack sent for lead ${leadId}`);
        }
      } catch (err) {
        this.logger.warn(`Could not send after-hours ack for lead ${leadId}: ${err.message}`);
      }

      const timer = setTimeout(async () => {
        this.pendingResponseTimers.delete(leadId);
        try {
          const responseBody = await this.sendAutoResponse(leadId, updateData);
          if (responseBody) {
            this.logger.log(`💬 Morning auto-response sent for lead ${leadId}: "${responseBody.substring(0, 80)}"`);
          }
        } catch (error) {
          this.logger.error(`Morning auto-response failed for lead ${leadId}: ${error.message}`);
        }
      }, msUntil);

      this.pendingResponseTimers.set(leadId, timer);
      return;
    }
    // ──────────────────────────────────────────────────────────────────────────

    this.logger.log(`⏱️  Auto-response for lead ${leadId} scheduled in ${delay}ms`);

    const timer = setTimeout(async () => {
      this.pendingResponseTimers.delete(leadId);
      try {
        const responseBody = await this.sendAutoResponse(leadId, updateData);
        if (responseBody) {
          this.logger.log(`💬 Auto-response sent for lead ${leadId}: "${responseBody.substring(0, 80)}"`);
        }
      } catch (error) {
        this.logger.error(`Auto-response failed for lead ${leadId}: ${error.message}`);
      }
    }, delay);

    this.pendingResponseTimers.set(leadId, timer);
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
