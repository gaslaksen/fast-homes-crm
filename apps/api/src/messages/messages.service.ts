import { Injectable, Inject, forwardRef, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { DripService } from '../drip/drip.service';
import { CampaignEnrollmentService } from '../campaigns/campaign-enrollment.service';
import { LeadsService } from '../leads/leads.service';
import { SellerPortalService } from '../seller-portal/seller-portal.service';
import { SmsProvider, createSmsProvider } from './sms.provider';
import { GmailService } from '../gmail/gmail.service';
import { formatPhoneNumber, isOptOutMessage } from '@fast-homes/shared';

const MAX_AUTO_RESPONSES_PER_DAY = 10;
const AUTO_RESPONSE_DELAY_MS = 180_000;       // 3 minutes — wait for seller to finish typing
const DEMO_AUTO_RESPONSE_DELAY_MS = 2_000;    // 2 seconds in demo mode

// Quiet hours: do not auto-respond between midnight and 6 AM ET.
// We use ET as a conservative default (most US sellers). If a message arrives inside quiet
// hours we acknowledge it immediately with a brief "we'll be in touch" note and
// schedule the actual AI response for 6 AM ET.
const QUIET_HOUR_START =  0; // midnight
const QUIET_HOUR_END   =  6; // 6 AM

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
  // When start < end the window doesn't cross midnight (e.g. 0–6): use AND.
  // When start > end the window crosses midnight (e.g. 21–6): use OR.
  if (QUIET_HOUR_START < QUIET_HOUR_END) {
    return hour >= QUIET_HOUR_START && hour < QUIET_HOUR_END;
  } else {
    return hour >= QUIET_HOUR_START || hour < QUIET_HOUR_END;
  }
}

/**
 * Return the number of milliseconds until 6 AM ET.
 */
function msUntilMorning(): number {
  const now = new Date();
  // Build today at 6 AM ET
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = etFormatter.formatToParts(now);
  const p: Record<string, string> = {};
  for (const { type, value } of parts) p[type] = value;
  // Construct "today at 6 AM ET" in UTC via ISO string trick
  const etMidnightStr = `${p.year}-${p.month}-${p.day}T06:00:00`;
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
  return `Hey ${name}, got your message! We are not available right now but will follow up first thing in the morning. Talk soon!`;
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
    @Inject(forwardRef(() => LeadsService))
    private leadsService: LeadsService,
    @Optional() private sellerPortalService: SellerPortalService,
    private gmailService: GmailService,
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

    // Throttle: skip if an outbound message was sent to this lead in the last 5 minutes.
    // Prevents race conditions (campaigns + initial outreach + drip) from spamming the seller.
    // Manual agent sends (userId present) bypass the throttle.
    if (!userId) {
      const recentOutbound = await this.prisma.message.findFirst({
        where: {
          leadId,
          direction: 'OUTBOUND',
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (recentOutbound) {
        this.logger.warn(`⚡ Throttled: automated outbound to lead ${leadId} skipped — last sent ${recentOutbound.createdAt.toISOString()}`);
        return null;
      }
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

      // Record touch (activity log + pipeline tracking)
      await this.leadsService.recordTouch(leadId, 'MESSAGE_SENT', {
        userId,
        description: userId ? `Message sent to ${to}` : `Auto-response sent to ${to}`,
        metadata: { body: body.substring(0, 100), automated: !userId },
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
    if (!lead.autoRespond) {
      this.logger.log(`⏸️ Auto-respond disabled for lead ${leadId}`);
      return false;
    }
    if (lead.doNotContact) {
      this.logger.log(`🚫 Lead ${leadId} is Do Not Contact — blocking auto-respond`);
      return false;
    }

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

    const autoBusinessName = (lead as any).organization?.name || 'Quick Cash Home Buyers';
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

    // ── Determine CAMP progress ────────────────────────────────────────────────
    // Instead of rigid ordering, we just tell the AI what's known and unknown
    // and let it decide what to explore next based on conversation flow.
    const campFields = [
      { field: 'timeline', label: 'Timeline/Priority', known: lead.timeline != null },
      { field: 'askingPrice', label: 'Asking Price', known: lead.askingPrice != null },
      { field: 'conditionLevel', label: 'Property Condition', known: lead.conditionLevel != null },
      { field: 'ownershipStatus', label: 'Ownership/Authority', known: lead.ownershipStatus != null },
    ];

    const campComplete = campFields.every(f => f.known);
    const missingFields = campFields.filter(f => !f.known).map(f => f.label);
    const knownFields = campFields.filter(f => f.known).map(f => f.label);

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

    // MLS listing status check disabled — automated check was producing false positives
    // on nearly every lead. isActiveListing logic removed until a reliable source is found.
    const sourceMetadata = (lead as any).sourceMetadata as Record<string, any> | null;
    const isActiveListing = false; // disabled

    const propertyContext = propertyContextLines.length > 0
      ? `\nProperty context (for your reference):\n${propertyContextLines.map(l => `  - ${l}`).join('\n')}\n`
      : '';

    // ── Build the purpose string — conversational, AI decides the approach ─────
    let purpose: string;
    let portalInstruction = '';

    if (campComplete) {
      // ── Closing-message portal fallback ──────────────────────────────────
      // If the portal link was never sent during mid-conversation messages,
      // include it in the closing message so the seller still gets the link.
      if (this.sellerPortalService) {
        const portalSent = await this.sellerPortalService.hasPortalLinkBeenSent(leadId);
        if (!portalSent) {
          const portalUrl = await this.sellerPortalService.getPortalUrl(leadId);
          if (portalUrl) {
            portalInstruction = `
IMPORTANT — INCLUDE THIS LINK in your closing message: ${portalUrl}
After thanking them, mention you've put together a page where they can verify property details and upload photos at their convenience. Frame it naturally — something like:
"Before I let you go — I put together a quick page for your property where you can double-check the details and upload any photos when you get a chance:\n${portalUrl}\n\nNo rush on that, but it helps our team when they review everything."
CRITICAL: Do NOT place a period, comma, or any punctuation immediately after the URL — it breaks the link on phones.`;
          }
        }
      }

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
3. Keep it warm and genuine
4. Do NOT ask anything. Do NOT request more info. End the conversation professionally.
5. Do NOT repeat back their price or timeline in a way that implies agreement or commitment.${portalInstruction}`;
    } else {
      // CAMP not yet complete — let the AI decide what to explore next

      // ── Seller Portal URL injection ──────────────────────────────────────
      // Once 2+ CAMP fields are known, include the portal URL so the AI can
      // ask the seller to verify details and upload photos. Framing adapts
      // based on whether condition is still unknown or already gathered.
      if (
        this.sellerPortalService &&
        knownFields.length >= 2
      ) {
        const portalSent = await this.sellerPortalService.hasPortalLinkBeenSent(leadId);
        if (!portalSent) {
          const portalUrl = await this.sellerPortalService.getPortalUrl(leadId);
          if (portalUrl) {
            const conditionUnknown = lead.conditionLevel == null;
            const framingHint = conditionUnknown
              ? `Frame it naturally — something like "I put together a page for your property where you can check the details we have on file and upload any photos. That really helps us get a feel for the place:\n${portalUrl}\n\nWhat kind of shape is the house in currently?"`
              : `Frame it naturally — something like "I put together a page for your property where you can verify the details and upload any photos when you get a chance:\n${portalUrl}\n\nThat helps our team put together the best offer for you."`;

            portalInstruction = `
IMPORTANT — INCLUDE THIS LINK: You have a property portal page for this seller. Include this URL in your message: ${portalUrl}
${framingHint}
CRITICAL: Do NOT place a period, comma, or any punctuation immediately after the URL — it breaks the link on phones. End the sentence BEFORE the URL (use a colon or dash), then start the next question as a new paragraph after the URL.
Do NOT just paste the link by itself. Weave it into your message naturally.`;
          }
        }
      }

      purpose = `${propertyContext}${justExtractedSummary ? justExtractedSummary + ' ' : ''}
CAMP PROGRESS:
- Already gathered: ${knownFields.length > 0 ? knownFields.join(', ') : 'Nothing yet'}
- Still need: ${missingFields.join(', ')}

Read the seller's last message carefully. Respond naturally to what they said.
${isActiveListing ? 'This property IS already listed for sale. Do not ask if they want to sell. Ask about their experience with the listing or why they are exploring a cash offer.' : ''}
If the conversation naturally opens up a chance to learn about one of the missing topics, take it. But do NOT force it. It's fine to just respond to what the seller said without asking a CAMP question if the moment isn't right.
If the seller seems frustrated, confused, sharing something personal, or asked you a direct question, address THAT first. Building rapport is more important than checking boxes.
You decide the right approach based on the conversation flow.${portalInstruction}`.trim();
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

      const messageBody = drafts.message;

      // If all CAMP is complete, shut off auto-respond
      if (campComplete) {
        await this.prisma.lead.update({
          where: { id: leadId },
          data: { autoRespond: false, status: 'QUALIFIED' },
        }).catch(() => {
          this.prisma.lead.update({ where: { id: leadId }, data: { autoRespond: false } });
        });
        this.logger.log(`🔕 Auto-respond disabled for lead ${leadId} — CAMP complete, closing message sent`);
      }

      await this.sendMessage(leadId, messageBody);
      await this.incrementAutoResponseCount(leadId);

      // Mark portal link as sent if we included it in this message
      if (portalInstruction && this.sellerPortalService) {
        this.sellerPortalService.markPortalLinkSent(leadId).catch((err) => {
          this.logger.warn(`Failed to mark portal link sent for ${leadId}: ${err.message}`);
        });
      }

      // Refresh CAMP flags
      await this.scoringService.refreshCampFlags(leadId);

      this.logger.log(`Auto-response sent for lead ${leadId} (CAMP: ${campComplete ? 'complete' : `missing ${missingFields.join(', ')}`})`);
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

    // Fixed initial message — no AI. Asks for price and timeline upfront.
    const messageBody = `Hi ${lead.sellerFirstName}, this is Dax. We just received your information about you looking to sell your house. How much are you asking for it? What are your timelines to sell?`;

    try {
      await this.sendMessage(leadId, messageBody);
      await this.incrementAutoResponseCount(leadId);

      this.logger.log(`Initial outreach sent for lead ${leadId}`);

      // Send matching email if the lead has an email address and org Gmail is connected
      if (lead.sellerEmail && lead.organizationId) {
        this.sendInitialEmailOutreach(lead).catch((err) => {
          this.logger.error(`Initial email outreach failed for lead ${leadId}: ${err.message}`);
        });
      }

      return messageBody;
    } catch (error) {
      this.logger.error(`Initial outreach failed for lead ${leadId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Send an initial outreach email mirroring the SMS, via org Gmail (deals@).
   * Fire-and-forget — failures here should never block the SMS flow.
   */
  private async sendInitialEmailOutreach(lead: {
    id: string;
    organizationId: string | null;
    sellerFirstName: string;
    sellerEmail: string | null;
    propertyAddress: string;
  }): Promise<void> {
    if (!lead.sellerEmail || !lead.organizationId) return;

    // Check org Gmail is connected before attempting
    const status = await this.gmailService.getOrgGmailStatus(lead.organizationId);
    if (!status.connected) {
      this.logger.warn(`Org Gmail not connected for org ${lead.organizationId}, skipping initial email outreach`);
      return;
    }

    const emailBody = `Hi ${lead.sellerFirstName},\n\nThis is Dax from Quick Cash Home Buyers. We just received your information about selling your property at ${lead.propertyAddress}.\n\nWe'd love to learn more about your situation. How much are you asking for the property? And what's your ideal timeline to sell?\n\nLooking forward to hearing from you!`;

    const unsubscribeUrl = this.gmailService.buildUnsubscribeUrl(lead.id);

    await this.gmailService.sendOrgEmail(lead.organizationId, {
      to: lead.sellerEmail,
      subject: `Quick question about your property at ${lead.propertyAddress}`,
      bodyText: emailBody,
      leadId: lead.id,
      listUnsubscribeUrl: unsubscribeUrl,
    });

    this.logger.log(`Initial email outreach sent for lead ${lead.id} to ${lead.sellerEmail}`);
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
          `You have been unsubscribed from ${(lead as any).organization?.name || 'Quick Cash Home Buyers'}. You will not receive further messages.`,
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

    // Auto-enroll in default campaigns on FIRST inbound reply (not on lead creation).
    // This ensures campaigns are for re-engagement after initial contact, not immediate spam.
    const priorInbound = lead.messages.filter((m) => m.direction === 'INBOUND');
    if (priorInbound.length === 0) {
      // This is the first reply — enroll in default campaigns (will fire after 24h+ delay)
      try {
        await this.campaignEnrollmentService.autoEnrollInDefaults(lead.id);
        this.logger.log(`📢 First reply from lead ${lead.id} — auto-enrolled in default campaigns`);
      } catch (err) {
        this.logger.warn(`Campaign auto-enroll failed for lead ${lead.id}: ${err.message}`);
      }
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
      this.logger.log(`🌙 Quiet hours — scheduling auto-response for lead ${leadId} at 6 AM ET (~${Math.round(msUntil / 60000)} min)`);

      // Send an immediate acknowledgment so the seller knows we received their message
      try {
        const lead = await this.prisma.lead.findUnique({
          where: { id: leadId },
          include: { organization: true },
        });
        if (lead) {
          const businessName = (lead as any).organization?.name || 'Quick Cash Home Buyers';
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
