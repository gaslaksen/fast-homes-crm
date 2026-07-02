import { Injectable, Inject, forwardRef, Logger, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { DripService } from '../drip/drip.service';
import { CampaignEnrollmentService } from '../campaigns/campaign-enrollment.service';
import { LeadsService } from '../leads/leads.service';
import { SellerPortalService } from '../seller-portal/seller-portal.service';
import { SmsProvider, SmrtphoneSmsProvider, TwilioSmsProvider, createSmsProvider } from './sms.provider';
import { MailerService } from '../mailer/mailer.service';
import { PushService } from '../push/push.service';
import { formatPhoneNumber, isOptOutMessage } from '@fast-homes/shared';
import { dealFitFlags, propertyContextForPrompt } from '../leads/property-fit.util';

const MAX_AUTO_RESPONSES_PER_DAY = 20;
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
    private mailerService: MailerService,
    private pushService: PushService,
  ) {
    this.smsProvider = createSmsProvider(this.config);
    // Outbound "from" number follows the active provider
    this.twilioNumber = this.smsProvider instanceof TwilioSmsProvider
      ? this.config.get<string>('TWILIO_PHONE_NUMBER') || this.config.get<string>('SMRTPHONE_PHONE_NUMBER') || ''
      : this.config.get<string>('SMRTPHONE_PHONE_NUMBER') || this.config.get<string>('TWILIO_PHONE_NUMBER') || '';
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
        sentByUserId: userId ?? null,
      },
    });
    await this.syncThreadSummary(leadId, body, 'OUTBOUND');

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

      // Mark portal link as sent if this outbound message contains the portal URL
      if (this.sellerPortalService) {
        try {
          const portalUrl = await this.sellerPortalService.getPortalUrl(leadId);
          if (portalUrl && body.includes(portalUrl)) {
            await this.sellerPortalService.markPortalLinkSent(leadId);
          }
        } catch (err: any) {
          this.logger.warn(`Failed to check/mark portal link for ${leadId}: ${err.message}`);
        }
      }

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
    // Pulls beds/baths/sqft/year, ARV (with ask-vs-ARV ratio), as-is/excellent
    // range, last sale, equity, MLS history & photos, photo-based repair range,
    // distress signals, and deal-fit concerns from the centralized helper.
    const latestCompAnalysis = await this.prisma.compAnalysis
      .findFirst({
        where: { leadId },
        orderBy: { createdAt: 'desc' },
        select: { photoRepairLow: true, photoRepairHigh: true },
      })
      .catch(() => null);
    const propertyContext = propertyContextForPrompt(lead, { latestCompAnalysis });
    const fitFlags = dealFitFlags(lead);

    // MLS listing status check disabled — automated check was producing false positives
    // on nearly every lead. isActiveListing logic removed until a reliable source is found.
    const isActiveListing = false; // disabled

    // ── Build the purpose string — conversational, AI decides the approach ─────
    let purpose: string;
    let portalInstruction = '';

    // We track whether this turn is an expectations-setting turn so the caller
    // can stamp `lead.expectationsSetAt` only after the message actually sends.
    //
    // Two ways an expectations turn can fire:
    //  1. CAMP complete + ANY fit concern unresolved (the standard path).
    //  2. EARLY money-killer: the asking price is known and the deal
    //     mathematically cannot pencil (ask >= ARV, mortgage > MAO, or a
    //     recent at-market purchase + high ask). In that case there's no
    //     point gathering ownership/condition first — the seller deserves
    //     a transparent expectations conversation NOW. (Meghan Kinee thread,
    //     2026-05-08: bought 2024 for $309k, owes $304k on FHA, asking $300k,
    //     ARV ~$288k — there was no math that worked, but the AI was still
    //     plodding through CAMP.)
    const earlyMoneyKiller =
      !lead.expectationsSetAt &&
      lead.askingPrice != null &&
      fitFlags.dealCannotPencil;
    const needsExpectationsTurn =
      !lead.expectationsSetAt &&
      ((campComplete && fitFlags.hasOpenFitConcern) || earlyMoneyKiller);
    const isClosingTurn = campComplete && !needsExpectationsTurn;

    if (isClosingTurn) {
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
    } else if (needsExpectationsTurn) {
      // The team has flagged a deal-fit concern that needs to be surfaced
      // honestly before we wrap up. This is its own turn — autoRespond stays
      // on, and the next inbound message will trigger the closing turn.
      const concernsList = fitFlags.concerns.map(c => `  - ${c}`).join('\n');
      const moneyKillerNote = earlyMoneyKiller
        ? `\nThis is being surfaced EARLY (without waiting for the rest of CAMP) because the math fundamentally does not work — there's no point asking more questions before being honest with the seller about the fit.`
        : '';
      purpose = `${propertyContext}DEAL-FIT EXPECTATIONS TURN — surface the flagged concern(s) to the seller before we wrap up.${moneyKillerNote}

Concerns to surface honestly (in your own words, in Dax's voice):
${concernsList}

This message must:
1. Briefly acknowledge what the seller just said.
2. Set realistic expectations on the flagged concern(s):
   - If ask-at-or-above-ARV: explain plainly that cash investors typically pay 60-70% of ARV (after-repair value), so paying near retail is not how the cash-offer model works. Don't quote a specific ARV number to them. Suggest listing with a realtor may be a better path.
   - If mortgage-exceeds-MAO: gently note that, given what cash investors typically offer (60-70% of ARV), our offer would not cover their loan payoff, so they'd likely have to bring money to the table at closing. That usually means listing on the open market is a better fit. Do NOT mention you know their specific mortgage balance — just describe the gap honestly.
   - If recent-purchase-no-equity: acknowledge that buying recently at near-current value leaves very thin equity, which makes a cash investor offer hard to pencil. Don't quote their purchase price unless they bring it up.
   - If manufactured/leased-land: be straight that those typically aren't a fit for cash buyers like us.
3. Leave the door open. Ask one open-ended follow-up — what's driving their timeline, whether they want the team to still take a look, or whether listing might be a better path.
4. Do NOT promise an offer. Do NOT say the team will reach out yet — that comes after they reply.
5. Do NOT use closing language like "before I let you go" or "team will review everything".
6. Do NOT recite numbers from the PROPERTY FACTS block back to the seller (ARV, mortgage balance, last sale price). Use them to inform what you say, but speak in plain language.`;
    } else {
      // CAMP not yet complete — let the AI decide what to explore next.

      // ── Seller Portal URL injection ──────────────────────────────────────
      // Once 3+ CAMP fields are known we offer the portal so the seller can
      // verify details and upload photos. Tightened from 2+ to avoid sending
      // a closing-toned message after one CAMP answer (we observed false
      // wrap-ups when this fired with only price+timeline known).
      if (this.sellerPortalService && knownFields.length >= 3) {
        const portalSent = await this.sellerPortalService.hasPortalLinkBeenSent(leadId);
        if (!portalSent) {
          const portalUrl = await this.sellerPortalService.getPortalUrl(leadId);
          if (portalUrl) {
            const conditionUnknown = lead.conditionLevel == null;
            const framingHint = conditionUnknown
              ? `Weave it in casually — something like "If it's easier, here's a page where you can check what we have on file and upload any photos:\n${portalUrl}\n\nWhat kind of shape is the house in currently?"`
              : `Weave it in casually — something like "If it's easier, here's a page where you can verify the details and upload any photos:\n${portalUrl}"`;

            portalInstruction = `
OPTIONAL — you may include this portal URL in your message if it fits naturally: ${portalUrl}
${framingHint}
Do NOT use closing language like "Before I let you go" or "Thanks for everything" — the conversation is still active.
CRITICAL: Do NOT place a period, comma, or any punctuation immediately after the URL — it breaks the link on phones. End the sentence BEFORE the URL (use a colon or dash), then start the next question as a new paragraph after the URL.`;
          }
        }
      }

      purpose = `${propertyContext}${justExtractedSummary ? justExtractedSummary + ' ' : ''}
CAMP PROGRESS:
- Already gathered: ${knownFields.length > 0 ? knownFields.join(', ') : 'Nothing yet'}
- Still need: ${missingFields.join(', ')}

Read the seller's last message carefully. Respond naturally to what they said.
${isActiveListing ? 'This property IS already listed for sale. Do not ask if they want to sell. Ask about their experience with the listing or why they are exploring a cash offer.' : ''}
KEEP THE CONVERSATION GOING. Do NOT wrap up just because they answered one question — there are still missing topics and there's plenty more to learn. After you acknowledge what they said, take ONE of these moves: ask about a missing CAMP topic, dig deeper into something they mentioned, or use a property fact you know (listing photos, last sale year) to ask a sharper question. Vary your approach across messages.
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

      // Only the true closing turn shuts off auto-respond. An expectations turn
      // still leaves the door open for the seller to reply, which then triggers
      // the closing turn on the next pass.
      if (isClosingTurn) {
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

      // Stamp expectations-set timestamp once the message has actually been
      // dispatched, so a future turn knows it's safe to move to the closing.
      if (needsExpectationsTurn) {
        await this.prisma.lead
          .update({ where: { id: leadId }, data: { expectationsSetAt: new Date() } })
          .catch((err) =>
            this.logger.warn(`Failed to stamp expectationsSetAt for ${leadId}: ${err.message}`),
          );
        this.logger.log(`📣 Expectations message sent for lead ${leadId} — concerns: ${fitFlags.concerns.join('; ')}`);
      }

      // sendMessage() already marks the portal link as sent when the body
      // contains the portal URL (see line ~210). Relying on that body-check
      // also handles the case where the prompt said the link was OPTIONAL and
      // the AI chose not to include it.

      // Refresh CAMP flags
      await this.scoringService.refreshCampFlags(leadId);

      const phase = isClosingTurn ? 'closing' : needsExpectationsTurn ? 'expectations' : `missing ${missingFields.join(', ')}`;
      this.logger.log(`Auto-response sent for lead ${leadId} (CAMP: ${phase})`);
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

    // Create / upsert the contact in Smrtphone before sending so the SMS lands
    // against a named contact in their UI. Idempotent on Smrtphone's side
    // (dedupes by phone). Skip if we already have a stored contact_id.
    if (
      !lead.smrtphoneContactId &&
      this.smsProvider instanceof SmrtphoneSmsProvider
    ) {
      try {
        const result = await this.smsProvider.createContact({
          phone: lead.sellerPhone,
          firstName: lead.sellerFirstName,
          lastName: lead.sellerLastName,
        });
        if (result?.contactId) {
          await this.prisma.lead.update({
            where: { id: leadId },
            data: { smrtphoneContactId: result.contactId },
          });
          this.logger.log(
            `Smrtphone contact ${result.existed ? 'matched' : 'created'} for lead ${leadId}: ${result.contactId}`,
          );
        }
      } catch (err: any) {
        this.logger.error(`Smrtphone contact create failed for lead ${leadId}: ${err.message}`);
      }
    }

    // Fixed initial message — no AI. Asks for price and timeline upfront.
    const messageBody = `Hi ${lead.sellerFirstName}, this is Dax. We just received your information about you looking to sell your house. How much are you asking for it? What are your timelines to sell?`;

    try {
      await this.sendMessage(leadId, messageBody);
      await this.incrementAutoResponseCount(leadId);

      this.logger.log(`Initial outreach sent for lead ${leadId}`);

      // Send a matching first email from deals@ (via Mailgun) when we have an address
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
   * Send an initial outreach email mirroring the SMS, from deals@ via Mailgun.
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

    const emailBody = `Hi ${lead.sellerFirstName},\n\nThis is Dax from Quick Cash Home Buyers. We just received your information about selling your property at ${lead.propertyAddress}.\n\nWe'd love to learn more about your situation. How much are you asking for the property? And what's your ideal timeline to sell?\n\nLooking forward to hearing from you!`;

    const unsubscribeUrl = this.mailerService.buildUnsubscribeUrl(lead.id);

    await this.mailerService.sendAsDeals({
      orgId: lead.organizationId,
      to: lead.sellerEmail,
      subject: `Quick question about your property at ${lead.propertyAddress}`,
      bodyText: emailBody,
      leadId: lead.id,
      listUnsubscribeUrl: unsubscribeUrl,
    });

    this.logger.log(`Initial email outreach sent for lead ${lead.id} to ${lead.sellerEmail}`);
  }

  /**
   * Handle an inbound email reply routed by Mailgun. The lead is identified by
   * the reply+{leadId}@ Reply-To address; falls back to matching sellerEmail.
   * Stores an inbound Email, surfaces it in the thread, and pauses automation.
   */
  async handleInboundEmail(data: {
    leadId?: string | null;
    from: string;
    to: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string | null;
    mailgunMessageId?: string | null;
    messageIdHeader?: string | null;
    inReplyTo?: string | null;
  }): Promise<{ success: boolean; reason?: string; leadId?: string; emailId?: string }> {
    const senderEmail = this.extractEmailAddress(data.from);

    // Resolve the lead: prefer the signed reply+{leadId} tag, then sellerEmail.
    let lead = data.leadId
      ? await this.prisma.lead.findUnique({ where: { id: data.leadId } })
      : null;
    if (!lead && senderEmail) {
      lead = await this.prisma.lead.findFirst({
        where: { sellerEmail: { equals: senderEmail, mode: 'insensitive' } },
      });
    }

    if (!lead) {
      this.logger.warn(`Inbound email: no lead for leadId=${data.leadId} sender=${senderEmail}`);
      return { success: false, reason: 'Lead not found' };
    }
    if (!lead.organizationId) {
      return { success: false, reason: 'Lead has no organization' };
    }

    // Idempotency: Mailgun can retry deliveries.
    if (data.mailgunMessageId) {
      const existing = await this.prisma.email.findUnique({
        where: { mailgunMessageId: data.mailgunMessageId },
      });
      if (existing) {
        return { success: true, leadId: lead.id, emailId: existing.id };
      }
    }

    const email = await this.prisma.email.create({
      data: {
        orgId: lead.organizationId,
        leadId: lead.id,
        direction: 'inbound',
        fromAddress: senderEmail || data.from,
        toAddress: data.to,
        subject: data.subject || '(no subject)',
        bodyHtml: data.bodyHtml ?? null,
        bodyText: data.bodyText || '',
        sentAt: new Date(),
        threadId: lead.id,
        mailgunMessageId: data.mailgunMessageId ?? null,
        messageIdHeader: data.messageIdHeader ?? null,
        inReplyTo: data.inReplyTo ?? null,
      },
    });

    const summaryText = (data.bodyText || data.subject || '').trim().substring(0, 500);
    await this.syncThreadSummary(lead.id, summaryText, 'INBOUND');

    // Push notify the assigned user (or the whole org) about the inbound reply
    this.pushService.notifyNewMessage(lead, summaryText).catch((err) =>
      this.logger.error(`Inbound-email push failed for ${lead.id}: ${err.message}`),
    );

    await this.prisma.activity.create({
      data: {
        leadId: lead.id,
        type: 'EMAIL_RECEIVED',
        description: `Email received from ${senderEmail || data.from}`,
        metadata: { subject: data.subject, preview: summaryText.substring(0, 100) },
      },
    });

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

    // A human reply means the seller is engaging — pause automated sequences.
    try {
      await this.dripService.handleReply(lead.id);
    } catch {
      /* drip may not exist */
    }
    try {
      await this.campaignEnrollmentService.handleReply(lead.id);
    } catch {
      /* enrollment may not exist */
    }

    this.logger.log(`📧 Inbound email stored for lead ${lead.id} from ${senderEmail}`);
    return { success: true, leadId: lead.id, emailId: email.id };
  }

  /** Pull the bare address out of a "Name <addr@x>" or plain string. */
  private extractEmailAddress(from: string): string {
    if (!from) return '';
    const m = from.match(/<([^>]+)>/);
    return (m ? m[1] : from).trim().toLowerCase();
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
    await this.syncThreadSummary(lead.id, body, 'INBOUND');

    // Push notify the assigned user (or the whole org) about the inbound reply
    this.pushService.notifyNewMessage(lead, body).catch((err) =>
      this.logger.error(`Inbound-message push failed for ${lead.id}: ${err.message}`),
    );

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

    // Extract signals from message using AI.
    // Pass directional objects so the extractor can distinguish seller answers
    // from agent questions. lead.messages is ordered desc (most recent first),
    // so reverse before appending the just-saved inbound.
    const priorMessages = [...lead.messages]
      .reverse()
      .map((m) => ({ direction: m.direction as 'INBOUND' | 'OUTBOUND', body: m.body }));
    const allMessages = [
      ...priorMessages,
      { direction: 'INBOUND' as const, body },
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
    await this.syncThreadSummary(leadId, body, 'INBOUND');

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
        select: { direction: true, body: true },
      });
      const directionalMessages = [
        ...allMessages.map((m) => ({
          direction: m.direction as 'INBOUND' | 'OUTBOUND',
          body: m.body,
        })),
        { direction: 'INBOUND' as const, body },
      ];
      const extracted = await this.scoringService.extractFromMessages(directionalMessages);
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

  /** All email correspondence for a lead, oldest first, for the merged thread. */
  async getEmails(leadId: string) {
    return this.prisma.email.findMany({
      where: { leadId },
      orderBy: { sentAt: 'asc' },
    });
  }

  /**
   * Send an email reply within a lead conversation, from the logged-in user's
   * own address. Replies route back into the thread via the per-lead Reply-To.
   */
  async sendEmailReply(
    leadId: string,
    userId: string,
    params: { subject?: string; body: string; inReplyToEmailId?: string },
  ) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, organizationId: true, sellerEmail: true, propertyAddress: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    if (!lead.sellerEmail) throw new BadRequestException('Lead has no email address');
    if (!lead.organizationId) throw new BadRequestException('Lead has no organization');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    });
    if (!user?.email) throw new BadRequestException('Sending user has no email address');

    const subject =
      params.subject?.trim() ||
      `Re: your property at ${lead.propertyAddress ?? 'your property'}`;

    let res: { mailgunId: string | null };
    try {
      res = await this.mailerService.sendAsUser({
        orgId: lead.organizationId,
        user,
        to: lead.sellerEmail,
        subject,
        bodyText: params.body,
        leadId: lead.id,
        inReplyToEmailId: params.inReplyToEmailId,
        sentByUserId: userId,
      });
    } catch (err: any) {
      // Surface the real Mailgun reason (e.g. auth/region/domain) to the UI
      // instead of a generic 500 "Internal server error".
      const detail = err?.details || err?.message || 'Unknown error';
      const status = err?.status ? ` (status ${err.status})` : '';
      this.logger.error(`Email reply send failed for lead ${lead.id}: ${detail}${status}`);
      throw new BadRequestException(`Email send failed: ${detail}${status}`);
    }

    await this.syncThreadSummary(lead.id, params.body, 'OUTBOUND');
    await this.leadsService.recordTouch(lead.id, 'EMAIL_SENT', {
      description: `Email sent to ${lead.sellerEmail} from ${user.email}`,
      metadata: { subject, mailgunId: res.mailgunId, sentByUserId: userId },
    });

    return { success: true, mailgunId: res.mailgunId };
  }

  /**
   * Keep the lead's denormalized inbox summary in sync after a message is
   * persisted. Inbound messages mark the thread unread; outbound clears it.
   */
  async syncThreadSummary(leadId: string, body: string, direction: string) {
    try {
      await this.prisma.lead.update({
        where: { id: leadId },
        data: {
          lastMessageAt: new Date(),
          lastMessagePreview: body.slice(0, 160),
          lastMessageDirection: direction,
          threadUnread: direction === 'INBOUND',
        },
      });
    } catch (err: any) {
      this.logger.warn(`Failed to sync thread summary for ${leadId}: ${err.message}`);
    }
  }
}
