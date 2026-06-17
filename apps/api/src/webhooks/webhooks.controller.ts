import { Controller, Post, Body, Query, Req, Res, HttpCode, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { Request, Response } from 'express';
import { isTwilioRequestValid } from './twilio-signature.util';
import { LeadsService } from '../leads/leads.service';
import { MessagesService } from '../messages/messages.service';
import { DripService } from '../drip/drip.service';
import { CallsService } from '../calls/calls.service';
import { PhotosService } from '../photos/photos.service';
import { CompAnalysisService } from '../comps/comp-analysis.service';
import { CampaignEnrollmentService } from '../campaigns/campaign-enrollment.service';
import { SlackLeadService } from './slack-lead.service';
import { InvestorFuseService } from './investorfuse.service';
import { formatPhoneNumber, LeadSource } from '@fast-homes/shared';
import { normalizeLeadAddressAsync } from './address-parser';
import { normalizeSmsBodyForCompare } from './sms-body-normalize.util';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private leadsService: LeadsService,
    private messagesService: MessagesService,
    private dripService: DripService,
    private callsService: CallsService,
    private photosService: PhotosService,
    private compAnalysisService: CompAnalysisService,
    private campaignEnrollmentService: CampaignEnrollmentService,
    private slackLeadService: SlackLeadService,
    private investorFuseService: InvestorFuseService,
  ) {}

  /**
   * PropertyLeads.com webhook endpoint
   * Ingests leads from PropertyLeads
   */
  @Post('propertyleads')
  async handlePropertyLeads(
    @Body() body: any,
    @Query('dryRun') dryRun?: string,
  ) {
    console.log('📥 PropertyLeads webhook received:', JSON.stringify(body, null, 2));

    // Dry-run mode: log + dump payload, skip lead creation and outreach
    if (dryRun === 'true' || body.dryRun === true) {
      this.logger.log('🧪 PropertyLeads dry-run mode — no lead will be created');
      try {
        fs.writeFileSync('/tmp/propertyleads-sample.json', JSON.stringify(body, null, 2));
        this.logger.log('📄 Saved payload → /tmp/propertyleads-sample.json');
      } catch (e) {
        this.logger.warn('Could not write sample file:', e.message);
      }
      return {
        success: true,
        dryRun: true,
        receivedFields: Object.keys(body),
        payload: body,
      };
    }

    try {
      // PropertyLeads sends Title_Case keys (e.g. Property_Address, First_Name)
      // Normalize to snake_case so the address parser and field lookups work
      const norm: Record<string, any> = {};
      for (const [key, val] of Object.entries(body)) {
        norm[key.toLowerCase()] = val;
      }

      // Feed normalized keys into address parser
      const addrPayload = {
        property_address: norm.property_address,
        city: norm.city,
        state: norm.state,
        zip: norm.zip,
      };
      const addr = await normalizeLeadAddressAsync(addrPayload);
      console.log('📍 Parsed address:', addr);

      // Parse asking price — PropertyLeads may send "Not Applicable"
      const rawAskingPrice = norm.asking_price;
      const askingPrice = rawAskingPrice && !isNaN(parseFloat(rawAskingPrice))
        ? parseFloat(rawAskingPrice)
        : undefined;

      // Build notes from PropertyLeads-specific text fields
      const noteParts: string[] = [];
      if (norm.reason_for_selling && norm.reason_for_selling !== 'Not Applicable')
        noteParts.push(`Reason for selling: ${norm.reason_for_selling}`);
      if (norm.how_long_owned_property && norm.how_long_owned_property !== 'Not Applicable')
        noteParts.push(`Owned: ${norm.how_long_owned_property}`);
      if (norm.anyone_living_in_house && norm.anyone_living_in_house !== 'Not Applicable')
        noteParts.push(`Occupancy: ${norm.anyone_living_in_house}`);
      if (norm.repairs_maintenance_needed && norm.repairs_maintenance_needed !== 'Not Applicable')
        noteParts.push(`Repairs: ${norm.repairs_maintenance_needed}`);
      if (norm.comments && norm.comments !== 'Not Applicable')
        noteParts.push(`Comments: ${norm.comments}`);
      if (norm.feedback && norm.feedback !== 'feedback')
        noteParts.push(`Feedback: ${norm.feedback}`);

      const leadData = {
        source: LeadSource.PROPERTY_LEADS,
        organizationId: process.env.DEFAULT_ORGANIZATION_ID,
        propertyAddress: addr.propertyAddress,
        propertyCity: addr.propertyCity,
        propertyState: addr.propertyState,
        propertyZip: addr.propertyZip,
        sellerFirstName: norm.first_name || body.firstName,
        sellerLastName: norm.last_name || body.lastName,
        sellerPhone: formatPhoneNumber(norm.primary_phone || norm.phone),
        sellerEmail: norm.email,
        askingPrice,
        conditionLevel: norm.repairs_maintenance_needed !== 'Not Applicable'
          ? norm.repairs_maintenance_needed : undefined,
        sellerMotivation: norm.reason_for_selling !== 'Not Applicable'
          ? norm.reason_for_selling : undefined,
        ownershipStatus: norm.how_long_owned_property !== 'Not Applicable'
          ? norm.how_long_owned_property : undefined,
        sourceMetadata: {
          ...body,
          _notes: noteParts.join(' | '),
          _leadId: norm['lead id'],
          _leadCost: norm.lead_cost,
          _county: norm.county,
          _dateCreated: norm['date created'],
        },
      };

      const lead = await this.leadsService.createLead(leadData);

      await this.triggerAiOutreach(lead.id, 'PropertyLeads');

      return {
        success: true,
        leadId: lead.id,
      };
    } catch (error) {
      console.error('❌ PropertyLeads webhook error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Google Ads / Landing Page form webhook
   * Can also be used for Zapier integration
   */
  @Post('google-ads')
  async handleGoogleAds(
    @Body() body: any,
    @Query('dryRun') dryRun?: string,
  ) {
    console.log('📥 Google Ads webhook received:', JSON.stringify(body, null, 2));

    if (dryRun === 'true' || body.dryRun === true) {
      this.logger.log('🧪 Google Ads dry-run mode — no lead will be created');
      try {
        fs.writeFileSync('/tmp/google-ads-sample.json', JSON.stringify(body, null, 2));
        this.logger.log('📄 Saved payload → /tmp/google-ads-sample.json');
      } catch (e) {
        this.logger.warn('Could not write sample file:', e.message);
      }
      return {
        success: true,
        dryRun: true,
        receivedFields: Object.keys(body),
        payload: body,
      };
    }

    // Bolt Deals fires its lead notifications as Twilio SMS forwards. The
    // payload looks like a Twilio message webhook and the actual lead data
    // is embedded in `body.body`. Repack into the flat seller_* shape that
    // InvestorFuseService expects.
    const payload = this.extractBoltDealsLead(body) ?? body;

    const result = await this.investorFuseService.handleOpportunityCreated(
      payload,
      LeadSource.GOOGLE_ADS,
      '/tmp/google-ads-sample.json',
    );

    if (result.success && result.leadId) {
      await this.triggerAiOutreach(result.leadId, 'GoogleAds');
    }

    return result;
  }

  private extractBoltDealsLead(body: any): Record<string, any> | null {
    const smsBody: unknown = body?.body;
    if (typeof smsBody !== 'string' || !smsBody.includes('New Lead in the CRM')) {
      return null;
    }

    const parsed = this.slackLeadService.parseLeadNotification(smsBody);
    if (!parsed?.name || !parsed?.address) return null;

    const nameParts = parsed.name.trim().split(/\s+/);
    // Bolt Deals wraps emails in markdown link syntax: `[a@b.com](mailto:a@b.com)`
    const email = parsed.email?.replace(/^\[([^\]]+)\].*$/, '$1') ?? '';

    const summary = [parsed.address, parsed.city, parsed.state, parsed.zip]
      .filter(Boolean)
      .join(', ');
    this.logger.log(`📩 Bolt Deals SMS detected — ${parsed.name} | ${summary}`);

    return {
      seller_first_name: nameParts[0] ?? '',
      seller_last_name: nameParts.slice(1).join(' '),
      seller_phone: parsed.phone ?? '',
      seller_email: email,
      // Pass street as-is. enrichAddressFromZip will split it if it's a full
      // single-line address; otherwise the explicit city/state/zipcode fields
      // (when Bolt Deals sent them separately) take precedence.
      street_address: parsed.address,
      city: parsed.city ?? '',
      state: parsed.state ?? '',
      zipcode: parsed.zip ?? '',
      lead_source: 'google ads (Bolt Deals)',
      _twilioPayload: body,
    };
  }

  /**
   * Twilio inbound message webhook
   * Receives incoming SMS messages
   */
  @Post('twilio/inbound')
  async handleTwilioInbound(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    console.log('📥 Twilio inbound message:', JSON.stringify(body).substring(0, 500));

    const emptyTwiml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

    if (!this.verifyTwilioSignature(req, body)) {
      res.status(403).send('Invalid Twilio signature');
      return;
    }

    try {
      // Twilio sends form-encoded data
      const from: string = body.From || '';
      const text: string = (body.Body || '').trim();

      if (!from) {
        console.warn('⚠️  Twilio inbound: missing From field');
        res.set('Content-Type', 'text/xml');
        res.send(emptyTwiml);
        return;
      }

      // MMS media (NumMedia / MediaUrl0, MediaUrl1, ...)
      const numMedia = parseInt(body.NumMedia || '0', 10);
      const mediaUrls: string[] = [];
      for (let i = 0; i < numMedia; i++) {
        if (body[`MediaUrl${i}`]) mediaUrls.push(body[`MediaUrl${i}`]);
      }

      // Keep CRM compliance state in sync with Twilio's carrier-level opt-out
      // handling. Mark DNC BEFORE processing so the AI never auto-replies to a STOP.
      const keyword = text.toUpperCase();
      if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(keyword)) {
        await this.markDoNotText(from, 'Twilio STOP reply');
      } else if (['START', 'UNSTOP'].includes(keyword)) {
        await this.unmarkDoNotText(from);
      }

      const result = await this.messagesService.handleInboundMessage({
        MessageSid: body.MessageSid || body.SmsSid,
        From: from,
        To: body.To,
        Body: text || '[📷 Photo]',  // placeholder for MMS-only messages
      });

      console.log('✅ Twilio message processed:', result);

      if (mediaUrls.length > 0 && result?.leadId) {
        this.logger.log(`📸 Twilio MMS detected: ${mediaUrls.length} media URL(s) from ${from}`);
        this.processInboundMediaInBackground(mediaUrls, result.leadId);
      }

      // Respond to Twilio with TwiML (empty response = no auto-reply)
      res.set('Content-Type', 'text/xml');
      res.send(emptyTwiml);
    } catch (error) {
      console.error('❌ Twilio webhook error:', error);
      res.set('Content-Type', 'text/xml');
      res.send(emptyTwiml);
    }
  }

  /**
   * InvestorFuse "opportunity created" webhook
   * Paste this URL into InvestorFuse Settings → Integrations → Webhook
   * Format: https://your-tunnel.loca.lt/webhooks/investorfuse
   *
   * On receipt: parses address and acknowledges the lead in Slack.
   */
  @Post('investorfuse')
  @HttpCode(200)
  async handleInvestorFuse(@Body() body: any) {
    console.log('📥 InvestorFuse webhook received');
    return this.investorFuseService.handleOpportunityCreated(body);
  }

  /**
   * Slack lead notification webhook
   * Called by Zapier when a new lead posts in the #esl-1-llc channel.
   * Parses the address and posts a minimal lead-received ack back to Slack.
   */
  @Post('slack-lead')
  @HttpCode(200)
  async handleSlackLead(@Body() body: any) {
    console.log('📥 Slack lead webhook received:', JSON.stringify(body).substring(0, 200));

    // Zapier sends the Slack message text + the channel's webhook URL to respond to
    const text: string = body.text || body.message || body.content || '';
    const responseUrl: string = body.response_url || body.responseUrl || body.slackWebhookUrl || '';

    if (!text) {
      return { success: false, error: 'No message text received' };
    }

    if (!responseUrl) {
      console.warn('⚠️  No Slack response URL provided — analysis will run but cannot post back');
    }

    // Run analysis in background so we return 200 to Zapier immediately
    setImmediate(() => {
      this.slackLeadService.analyzeAndPost({ text, responseUrl }).catch((err) => {
        console.error('❌ Slack lead analysis failed:', err);
      });
    });

    return { success: true, message: 'Analysis started — results posting to Slack shortly' };
  }

  /**
   * Shared helper: schedule AI call for a newly created lead.
   * AI SMS drip is no longer started here — campaigns handle follow-up
   * sequences via auto-enrollment in scheduleInitialOutreach().
   */
  private async triggerAiOutreach(leadId: string, source: string) {
    // AI outbound call (reads callDelayMs from settings, checks aiCallEnabled at fire time)
    try {
      const settings = await this.dripService['prisma'].dripSettings.findUnique({
        where: { id: 'default' },
      });
      const delayMs = settings?.callDelayMs ?? 120_000;
      await this.callsService.scheduleOutboundCall(leadId, delayMs);
    } catch (err) {
      console.error(`⚠️  [${source}] Failed to schedule outbound call:`, err.message);
    }

    console.log(`✅ [${source}] Lead ${leadId} — AI outreach triggered`);
  }

  /**
   * SmrtPhone unified webhook receiver
   *
   * All SmrtPhone events POST to this single endpoint.
   * Configure in SmrtPhone Admin → Webhooks with your Railway URL:
   *   https://fast-homesapi-production.up.railway.app/webhooks/smrtphone
   *
   * Events handled:
   *   smsIncoming        → run AI qualification flow
   *   smsDeliveryCallback → update message delivery status
   *   addNumberToDNC     → mark lead as DNC
   *   addNumberToDNT     → mark lead as DNT (Do Not Text / STOP reply)
   *   removeNumberFromDNT → re-enable texting if they reply START
   *   aiTools            → store call transcript/summary/keywords on lead record
   *   smrtAgentCallEnded → store AI voice agent outcome + extracted lead details
   *   (all others logged and ignored)
   *
   * Exact payload formats: https://help.smrtphone.io/webhooks-from-smrtphone-smrtphone-help-center
   */
  @Post('smrtphone')
  @HttpCode(200)
  async handleSmrtphone(@Body() body: any) {
    const event: string = body.event || 'unknown';
    // Log full payload for SMS and call events (to capture all fields)
    const fullLogEvents = ['smsIncoming', 'callInitiated', 'callCompleted', 'aiTools', 'smrtAgentCallEnded'];
    const logBody = fullLogEvents.includes(event) ? JSON.stringify(body) : JSON.stringify(body).substring(0, 300);
    console.log(`📥 SmrtPhone webhook [${event}]:`, logBody);

    try {
      switch (event) {
        // ── Inbound SMS → AI qualification ──────────────────────────────
        case 'smsIncoming': {
          // Exact SmrtPhone payload fields:
          // { smsId, from, to, message, date, callerIdName, userName, contactName, event }
          const from: string = body.from || '';
          const to: string = body.to || '';
          const text: string = body.message || '';
          const smsId: string = body.smsId || `smrtphone-${Date.now()}`;

          if (!from) {
            console.warn('⚠️  smsIncoming: missing from field');
            return { success: false, error: 'Missing required fields' };
          }
          // Allow empty text for MMS-only messages (photos with no caption)
          if (!text && !body.mediaUrls && !body.mediaUrl && !body.media_url && !body.attachments && !body.mmsUrl && !body.imageUrl && !body.NumMedia && !body.numMedia) {
            console.warn('⚠️  smsIncoming: no message text and no media — skipping');
            return { success: false, error: 'No content' };
          }

          const result = await this.messagesService.handleInboundMessage({
            MessageSid: smsId,
            From: from,
            To: to,
            Body: text || '[📷 Photo]',  // placeholder for MMS-only messages
          });

          console.log('✅ smsIncoming processed:', result);

          // ── MMS: capture seller photos ────────────────────────────────
          // SmrtPhone MMS field names are not fully documented — collect from all known variants
          const mediaUrls: string[] = [];
          // Array variants
          if (body.mediaUrls && Array.isArray(body.mediaUrls)) {
            mediaUrls.push(...body.mediaUrls.filter(Boolean));
          } else if (body.mediaItems && Array.isArray(body.mediaItems)) {
            mediaUrls.push(...body.mediaItems.filter(Boolean));
          } else if (body.attachments && Array.isArray(body.attachments)) {
            // attachments may be URL strings or objects with url/mediaUrl
            for (const a of body.attachments) {
              if (typeof a === 'string') mediaUrls.push(a);
              else if (a?.url) mediaUrls.push(a.url);
              else if (a?.mediaUrl) mediaUrls.push(a.mediaUrl);
            }
          }
          // Single-value variants
          if (body.mediaUrl) mediaUrls.push(body.mediaUrl);
          if (body.media_url) mediaUrls.push(body.media_url);
          if (body.mmsUrl) mediaUrls.push(body.mmsUrl);
          if (body.mms_url) mediaUrls.push(body.mms_url);
          if (body.imageUrl) mediaUrls.push(body.imageUrl);
          if (body.image_url) mediaUrls.push(body.image_url);
          // Twilio-style numbered media (NumMedia / MediaUrl0, MediaUrl1, ...)
          const numMedia = parseInt(body.NumMedia || body.numMedia || '0', 10);
          for (let i = 0; i < numMedia; i++) {
            const u = body[`MediaUrl${i}`] || body[`mediaUrl${i}`];
            if (u) mediaUrls.push(u);
          }
          // Deduplicate
          const uniqueMediaUrls = [...new Set(mediaUrls.filter(Boolean))];
          if (uniqueMediaUrls.length > 0) {
            this.logger.log(`📸 MMS detected: ${uniqueMediaUrls.length} media URL(s) from ${from}`);
          }

          if (uniqueMediaUrls.length > 0 && result?.leadId) {
            this.processInboundMediaInBackground(uniqueMediaUrls, result.leadId);
          }

          return { success: true };
        }

        // ── Outbound SMS sent from SmrtPhone UI (manual reply) ───────────
        // When an agent texts a seller directly from SmrtPhone, autoRespond
        // must be paused so the AI doesn't talk over them.
        case 'smsOutgoing':
        case 'smsSent': {
          // { smsId, from, to, message, date, userName, contactName, event }
          const toPhone: string = body.to || '';
          const fromPhone: string = body.from || '';
          const msgBody: string = body.message || body.body || '';
          const outSmsId: string = body.smsId || `smrtphone-out-${Date.now()}`;

          if (!toPhone || !msgBody) {
            console.warn(`⚠️  ${event}: missing to/message fields`);
            return { success: true };
          }

          // Find the lead this was sent to
          const stripped = toPhone.replace(/\D/g, '').replace(/^1/, '');
          const outboundLead = await this.leadsService['prisma'].lead.findFirst({
            where: {
              OR: [
                { sellerPhone: toPhone },
                { sellerPhone: stripped },
                { sellerPhone: `1${stripped}` },
              ],
            },
          });

          if (!outboundLead) {
            // Expected when SmrtPhone sends to contacts not in this CRM (e.g. drip campaigns)
            console.log(`ℹ️  ${event}: no lead found for ${toPhone} — skipping`);
            return { success: true };
          }

          // Record the outbound message so the conversation thread stays in sync
          // Use findFirst + create instead of upsert — twilioSid is no longer unique-indexed
          // Check if this message was already sent by our app (AI, drip, or draft).
          // Primary: match by twilioSid. Fallback: match by lead + body + recent timestamp
          // to handle cases where Smrtphone returns a different ID in the webhook.
          const existingMsg = outSmsId
            ? await this.leadsService['prisma'].message.findFirst({ where: { twilioSid: outSmsId } })
            : null;

          // SmrtPhone appends a compliance footer ("This message was sent by …")
          // to outbound messages, so the webhook body is longer than what we stored.
          // Strip the footer before comparing, and also try a startsWith fallback
          // in case the footer format changes.
          const coreBody = msgBody.split(/\n\s*This message was sent by/i)[0].trim();

          // Use createdAt (auto-set by Prisma) instead of sentAt for the time window.
          // PENDING records have sentAt=NULL because it's only set after the SMS API
          // responds, but the webhook can arrive before that update completes.
          //
          // Match in JS, not Prisma WHERE — SmrtPhone/the carrier normalizes
          // em dashes, smart quotes, ellipses, etc. before delivery, so a raw
          // string equality on the DB body silently fails when the AI used
          // any of those characters. Pull recent outbound messages and match
          // on a normalized form (see normalizeSmsBodyForCompare).
          const recentCutoff = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
          const normalizedCore = normalizeSmsBodyForCompare(coreBody);
          const normalizedFull = normalizeSmsBodyForCompare(msgBody);
          const recentOutbound = !existingMsg
            ? await this.leadsService['prisma'].message.findMany({
                where: {
                  leadId: outboundLead.id,
                  direction: 'OUTBOUND',
                  createdAt: { gte: recentCutoff },
                },
                orderBy: { createdAt: 'desc' },
                take: 20,
              })
            : [];
          const existingByContent =
            recentOutbound.find((m) => {
              const stored = normalizeSmsBodyForCompare(m.body || '');
              if (!stored) return false;
              if (stored === normalizedCore || stored === normalizedFull) return true;
              // Fallback: stored body starts with the first 80 normalized chars of
              // the webhook body (handles compliance-footer format drift).
              if (normalizedCore.length >= 80 && stored.startsWith(normalizedCore.slice(0, 80))) {
                return true;
              }
              return false;
            }) ?? null;

          if (!existingMsg && !existingByContent) {
            console.log(`⚠️  ${event}: no app-originated match for lead ${outboundLead.id} — smsId=${outSmsId}, coreBody="${coreBody.substring(0, 60)}…", cutoff=${recentCutoff.toISOString()}`);
          }

          if (existingMsg || existingByContent) {
            // Message already in our DB — this was sent by our app (AI or Draft).
            // Update the twilioSid if we matched by content so future delivery callbacks work.
            if (existingByContent && !existingMsg) {
              await this.leadsService['prisma'].message.update({
                where: { id: existingByContent.id },
                data: { twilioSid: outSmsId },
              });
            }
            console.log(`ℹ️  ${event}: message ${outSmsId} already recorded (app-originated) — skipping AI pause`);
            return { success: true };
          }

          // Try to attribute this SmrtPhone-originated message to a Dealcore
          // user so the timeline shows their initials instead of "AI". The
          // SmrtPhone payload includes userName ("Ian McCaskill") and the
          // sending phone; match either against the lead's org users.
          let smrtphoneSenderId: string | null = null;
          const agentUserName: string = (body.userName || '').trim();
          const fromDigits: string = fromPhone.replace(/\D/g, '').replace(/^1/, '');
          const nameParts = agentUserName.split(/\s+/).filter(Boolean);
          const first = nameParts[0] || '';
          const last = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
          const orClauses: any[] = [];
          if (first && last) {
            orClauses.push({
              AND: [
                { firstName: { equals: first, mode: 'insensitive' } },
                { lastName: { equals: last, mode: 'insensitive' } },
              ],
            });
          }
          if (fromDigits.length >= 7) {
            orClauses.push({ phone: { contains: fromDigits } });
          }
          if (orClauses.length > 0) {
            try {
              const match = await this.leadsService['prisma'].user.findFirst({
                where: {
                  ...(outboundLead.organizationId
                    ? { organizationId: outboundLead.organizationId }
                    : {}),
                  OR: orClauses,
                },
                select: { id: true },
              });
              smrtphoneSenderId = match?.id ?? null;
              if (!smrtphoneSenderId) {
                console.log(
                  `ℹ️  ${event}: could not resolve SmrtPhone sender "${agentUserName}" / ${fromPhone} to a Dealcore user`,
                );
              }
            } catch (err: any) {
              // Never let attribution failure block recording the message.
              console.warn(`⚠️  ${event}: SmrtPhone sender lookup failed: ${err?.message || err}`);
              smrtphoneSenderId = null;
            }
          }

          // Genuinely new outbound message sent from SmrtPhone UI — record it
          await this.leadsService['prisma'].message.create({
            data: {
              leadId: outboundLead.id,
              direction: 'OUTBOUND',
              status: 'SENT',
              body: msgBody,
              from: fromPhone,
              to: toPhone,
              twilioSid: outSmsId,
              sentByUserId: smrtphoneSenderId,
              sentAt: new Date(),
            },
          });
          await this.messagesService.syncThreadSummary(outboundLead.id, msgBody, 'OUTBOUND');

          // Pause AI auto-respond — a human has stepped in
          await this.leadsService['prisma'].lead.update({
            where: { id: outboundLead.id },
            data: { autoRespond: false },
          });

          // Cancel any queued drip messages too
          try {
            await this.dripService.cancelByLeadId(outboundLead.id, 'Agent manually replied via SmrtPhone');
          } catch {
            // Drip may not exist — fine
          }

          console.log(`🤚 Manual reply detected for lead ${outboundLead.id} (${toPhone}) — AI auto-respond paused`);
          return { success: true };
        }

        // ── Delivery status ──────────────────────────────────────────────
        case 'smsDeliveryCallback': {
          // { smsId, status, event, failure_reason? }
          const { smsId, status, failure_reason } = body;
          if (smsId && status) {
            await this.messagesService['prisma'].message.updateMany({
              where: { twilioSid: smsId },
              data: {
                status: status.toUpperCase(),
                deliveredAt: status === 'delivered' ? new Date() : undefined,
              },
            });
            if (failure_reason) {
              console.warn(`⚠️  SMS ${smsId} delivery failed: ${failure_reason}`);
            }
          }
          return { success: true };
        }

        // ── Compliance: DNC (Do Not Call/Contact) ────────────────────────
        case 'addNumberToDNC': {
          // { phone, event }
          const phone = formatPhoneNumber(body.phone || '');
          if (phone) {
            const affected = await this.leadsService['prisma'].lead.findMany({
              where: { sellerPhone: phone },
              select: { id: true },
            });
            await this.leadsService['prisma'].lead.updateMany({
              where: { sellerPhone: phone },
              data: { doNotContact: true, status: 'DNC' },
            });
            for (const lead of affected) {
              try {
                await this.campaignEnrollmentService.removeAllActive(lead.id);
              } catch (err: any) {
                this.logger.error(`Failed to remove campaign enrollments for lead ${lead.id}: ${err.message}`);
              }
              try {
                await this.dripService.cancelByLeadId(lead.id, 'DNC webhook');
              } catch {
                // Drip may not exist - fine
              }
            }
            console.log(`🚫 DNC: ${phone} (cleaned ${affected.length} lead(s))`);
          }
          return { success: true };
        }

        // ── Compliance: DNT (Do Not Text / STOP reply) ───────────────────
        case 'addNumberToDNT': {
          // { phone, timestamp, userId, source, event }
          await this.markDoNotText(body.phone || '', `DNT (STOP) webhook - source: ${body.source}`);
          return { success: true };
        }

        // ── Compliance: re-subscribed (START reply) ──────────────────────
        case 'removeNumberFromDNT': {
          // { phone, timestamp, userId, source, event }
          await this.unmarkDoNotText(body.phone || '');
          return { success: true };
        }

        // ── SmrtPhone Call Events ─────────────────────────────────────────
        case 'callInitiated': {
          // { callId, from, to, date, callerIdName, userName, contactName, device, event }
          const callFrom: string = body.from || '';
          const callTo: string = body.to || '';
          const smrtCallId: string = body.callId || '';

          console.log(`📞 Call initiated [${smrtCallId}]: ${callFrom} → ${callTo}`);

          // Determine which phone belongs to the seller (outbound = to, inbound = from)
          const sellerPhone = callTo || callFrom;
          const foundLead = await this.findLeadByPhone(sellerPhone);

          if (foundLead) {
            await this.leadsService['prisma'].callLog.create({
              data: {
                leadId: foundLead.id,
                smrtphoneCallId: smrtCallId || undefined,
                status: 'in-progress',
                type: 'smrtphone_call',
              },
            });
            await this.leadsService['prisma'].activity.create({
              data: {
                leadId: foundLead.id,
                type: 'CALL_INITIATED',
                description: `Call started via SmrtPhone (${body.userName || 'agent'} → ${body.contactName || sellerPhone})`,
              },
            });
            console.log(`✅ CallLog created for lead ${foundLead.id}`);
          } else {
            console.warn(`⚠️  callInitiated: no lead found for ${sellerPhone}`);
          }
          return { success: true };
        }

        case 'callCompleted': {
          // { callId, from, to, date, callerIdName, userName, contactName, callNotes, callOutcome, device, recordingUrl, event }
          const completedCallId: string = body.callId || '';
          const outcome: string = body.callOutcome || '';
          const notes: string = body.callNotes || '';
          const recording: string = body.recordingUrl || '';

          console.log(`📞 Call completed [${completedCallId}]: outcome=${outcome}`);

          // Try to find existing CallLog from callInitiated
          let callLog = completedCallId
            ? await this.leadsService['prisma'].callLog.findUnique({
                where: { smrtphoneCallId: completedCallId },
              })
            : null;

          if (callLog) {
            // Update existing CallLog
            await this.leadsService['prisma'].callLog.update({
              where: { id: callLog.id },
              data: {
                status: 'completed',
                recordingUrl: recording || undefined,
                summary: [outcome, notes].filter(Boolean).join(' — ') || undefined,
              },
            });
          } else {
            // callInitiated was missed — create a new record
            const completedPhone = body.to || body.from || '';
            const completedLead = await this.findLeadByPhone(completedPhone);
            if (completedLead) {
              callLog = await this.leadsService['prisma'].callLog.create({
                data: {
                  leadId: completedLead.id,
                  smrtphoneCallId: completedCallId || undefined,
                  status: 'completed',
                  type: 'smrtphone_call',
                  recordingUrl: recording || undefined,
                  summary: [outcome, notes].filter(Boolean).join(' — ') || undefined,
                },
              });
            }
          }

          // Log activity
          if (callLog?.leadId) {
            await this.leadsService['prisma'].activity.create({
              data: {
                leadId: callLog.leadId,
                type: 'CALL_COMPLETED',
                description: `Call completed via SmrtPhone — ${outcome || 'no outcome'}${recording ? ' (recording available)' : ''}`,
                metadata: { recordingUrl: recording, callOutcome: outcome },
              },
            });
          }
          console.log(`✅ Call completed processed${callLog ? ` for lead ${callLog.leadId}` : ''}`);
          return { success: true };
        }

        case 'callStatusUpdated': {
          // { callId, callStatus, date, event }
          const statusCallId: string = body.callId || '';
          const newStatus: string = body.callStatus || '';

          console.log(`📞 Call status updated [${statusCallId}]: ${newStatus}`);

          if (statusCallId) {
            await this.leadsService['prisma'].callLog.updateMany({
              where: { smrtphoneCallId: statusCallId },
              data: { status: newStatus.toLowerCase() },
            });
          }
          return { success: true };
        }

        case 'callNotesUpdated': {
          // { callId, callNotes, date, event }
          const notesCallId: string = body.callId || '';
          if (notesCallId && body.callNotes) {
            await this.leadsService['prisma'].callLog.updateMany({
              where: { smrtphoneCallId: notesCallId },
              data: { summary: body.callNotes },
            });
            console.log(`✅ Call notes updated for call ${notesCallId}`);
          }
          return { success: true };
        }

        // ── AI Tools: call transcript/summary/keywords ───────────────────
        case 'aiTools': {
          // { callId, timestamp, ai_keywords, ai_summary, ai_transcript: [{timestamp, speaker, segment}], event }
          const aiCallId: string = body.callId || '';
          console.log(`🧠 AI Tools data for call ${aiCallId}:`, {
            keywords: body.ai_keywords,
            summary: body.ai_summary?.substring(0, 100),
            transcriptSegments: Array.isArray(body.ai_transcript) ? body.ai_transcript.length : 0,
          });

          // ai_transcript is an array of {timestamp, speaker, segment} — flatten to readable string
          let transcriptText: string | undefined;
          if (Array.isArray(body.ai_transcript) && body.ai_transcript.length > 0) {
            transcriptText = body.ai_transcript
              .map((seg: any) => `[${seg.timestamp || ''}] ${seg.speaker || 'Unknown'}: ${seg.segment || ''}`)
              .join('\n')
              .trim();
          } else if (typeof body.ai_transcript === 'string') {
            transcriptText = body.ai_transcript;
          }

          if (aiCallId) {
            // Store transcript and summary on the CallLog
            const updated = await this.leadsService['prisma'].callLog.updateMany({
              where: { smrtphoneCallId: aiCallId },
              data: {
                transcript: transcriptText || undefined,
                summary: body.ai_summary || undefined,
              },
            });
            if (updated.count > 0) {
              console.log(`✅ AI transcript/summary stored for call ${aiCallId}`);
            } else {
              console.warn(`⚠️  aiTools: no CallLog found for callId ${aiCallId}`);
            }

            // Extract CAMP data from transcript and update lead fields
            if (transcriptText) {
              const callLog = await this.leadsService['prisma'].callLog.findUnique({
                where: { smrtphoneCallId: aiCallId },
              });
              if (callLog?.leadId) {
                await this.callsService.processSmrtPhoneTranscript(
                  callLog.leadId,
                  transcriptText,
                  body.ai_summary,
                );
              }
            }
          }
          return { success: true };
        }

        // ── smrtAgent: AI voice agent call ended ─────────────────────────
        case 'smrtAgentCallEnded': {
          // { callId, id, agentName, timestamp, summary, transcript, callDetails, event }
          const agentCallId: string = body.callId || '';
          console.log(`🤖 smrtAgent call ended [${agentCallId}]:`, {
            summary: body.summary?.substring(0, 150),
            callDetails: body.callDetails,
          });

          if (agentCallId) {
            // Try to update existing CallLog
            const agentUpdated = await this.leadsService['prisma'].callLog.updateMany({
              where: { smrtphoneCallId: agentCallId },
              data: {
                status: 'completed',
                transcript: body.transcript || undefined,
                summary: body.summary || undefined,
                type: 'smrtagent_call',
              },
            });

            if (agentUpdated.count === 0) {
              // No existing record — try to create one by looking up lead from callDetails
              const agentPhone = body.from || body.to || '';
              const agentLead = agentPhone ? await this.findLeadByPhone(agentPhone) : null;
              if (agentLead) {
                await this.leadsService['prisma'].callLog.create({
                  data: {
                    leadId: agentLead.id,
                    smrtphoneCallId: agentCallId,
                    status: 'completed',
                    type: 'smrtagent_call',
                    transcript: body.transcript || undefined,
                    summary: body.summary || undefined,
                  },
                });
                console.log(`✅ smrtAgent CallLog created for lead ${agentLead.id}`);
              }
            }

            // Extract CAMP data from smrtAgent transcript and update lead
            if (body.transcript) {
              const agentLog = await this.leadsService['prisma'].callLog.findUnique({
                where: { smrtphoneCallId: agentCallId },
              });
              if (agentLog?.leadId) {
                await this.callsService.processSmrtPhoneTranscript(
                  agentLog.leadId,
                  body.transcript,
                  body.summary,
                );
              }
            }
          }
          return { success: true };
        }

        // ── Everything else: log and acknowledge ─────────────────────────
        default:
          console.log(`ℹ️  Unhandled SmrtPhone event: ${event}`);
          return { success: true, note: `Event '${event}' received but not handled` };
      }
    } catch (error) {
      console.error(`❌ SmrtPhone webhook error [${event}]:`, error);
      // Always 200 — prevents SmrtPhone retry storms
      return { success: false, error: error.message };
    }
  }

  /**
   * Dev-only: simulate an inbound SMS without hitting a real carrier.
   * POST /webhooks/dev/simulate-inbound
   * Body: { "from": "+17046812994", "message": "I want to sell my house" }
   *
   * Uses the exact SmrtPhone smsIncoming payload format.
   * Only active when SMRTPHONE_TEST_MODE=true.
   */
  @Post('dev/simulate-inbound')
  @HttpCode(200)
  async simulateInboundSms(@Body() body: any) {
    const testMode = process.env.SMRTPHONE_TEST_MODE?.toLowerCase() === 'true';
    if (!testMode) {
      return { success: false, error: 'Simulation endpoint only available in TEST_MODE' };
    }

    // Mirror the exact SmrtPhone smsIncoming payload shape
    const simulatedPayload = {
      event: 'smsIncoming',
      smsId: `SIMULATED_${Date.now()}`,
      from: body.from || '+15550000000',
      to: body.to || process.env.SMRTPHONE_PHONE_NUMBER || '+17044713920',
      message: body.message || body.body || body.text || 'Test inbound message',
      date: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      callerIdName: body.callerIdName || '',
      userName: body.userName || 'Test User',
      contactName: body.contactName || '',
    };

    console.log(`🧪 Simulating SmrtPhone smsIncoming:`, simulatedPayload);

    return this.handleSmrtphone(simulatedPayload);
  }

  /**
   * Twilio delivery status webhook
   * Receives status updates for sent messages (set TWILIO_STATUS_CALLBACK_URL
   * so the provider passes this URL as statusCallback on every send)
   */
  @Post('twilio/status')
  async handleTwilioStatus(@Body() body: any, @Req() req: Request) {
    console.log('📥 Twilio status update:', JSON.stringify(body).substring(0, 300));

    if (!this.verifyTwilioSignature(req, body)) {
      return { success: false, error: 'Invalid Twilio signature' };
    }

    try {
      const messageSid = body.MessageSid || body.SmsSid;
      const status: string = (body.MessageStatus || body.SmsStatus || '').toLowerCase();
      if (!messageSid || !status) {
        return { success: false, error: 'Missing MessageSid or MessageStatus' };
      }

      // Twilio statuses: queued, sending, sent, delivered, undelivered, failed
      const mappedStatus = status === 'undelivered' ? 'FAILED' : status.toUpperCase();

      // Update message status in database
      await this.messagesService['prisma'].message.updateMany({
        where: { twilioSid: messageSid },
        data: {
          status: mappedStatus,
          deliveredAt: status === 'delivered' ? new Date() : undefined,
        },
      });

      if (body.ErrorCode) {
        console.warn(`⚠️  Twilio SMS ${messageSid} failed: error ${body.ErrorCode}`);
      }

      return { success: true };
    } catch (error) {
      console.error('❌ Twilio status webhook error:', error);
      return { success: false };
    }
  }

  // ─── Helper: validate Twilio webhook signatures ───
  // Rejects forged requests. Validation runs whenever TWILIO_AUTH_TOKEN is set;
  // set TWILIO_VALIDATE_WEBHOOKS=false to bypass for local testing.
  private verifyTwilioSignature(req: Request, params: Record<string, any>): boolean {
    return isTwilioRequestValid(req, params);
  }

  // ─── Helper: STOP / opt-out - mark all leads with this phone as DNT ───
  private async markDoNotText(rawPhone: string, reason: string) {
    const phone = formatPhoneNumber(rawPhone || '');
    if (!phone) return;

    const affected = await this.leadsService['prisma'].lead.findMany({
      where: { sellerPhone: phone },
      select: { id: true },
    });
    await this.leadsService['prisma'].lead.updateMany({
      where: { sellerPhone: phone },
      data: { doNotContact: true, unsubscribedAt: new Date() },
    });
    for (const lead of affected) {
      try {
        await this.campaignEnrollmentService.removeAllActive(lead.id);
      } catch (err: any) {
        this.logger.error(`Failed to remove campaign enrollments for lead ${lead.id}: ${err.message}`);
      }
      try {
        await this.dripService.cancelByLeadId(lead.id, reason);
      } catch {
        // Drip may not exist - fine
      }
    }
    console.log(`🚫 DNT (STOP): ${phone} - ${reason} (cleaned ${affected.length} lead(s))`);
  }

  // ─── Helper: START / re-subscribe - clear DNT flag ───
  private async unmarkDoNotText(rawPhone: string) {
    const phone = formatPhoneNumber(rawPhone || '');
    if (!phone) return;

    await this.leadsService['prisma'].lead.updateMany({
      where: { sellerPhone: phone },
      data: { doNotContact: false },
    });
    console.log(`✅ DNT removed (START): ${phone}`);
  }

  // ─── Helper: download inbound MMS photos and auto-trigger repair analysis ───
  // Shared by the SmrtPhone and Twilio inbound webhook paths.
  private processInboundMediaInBackground(mediaUrls: string[], leadId: string) {
    // Run in background - don't block the webhook response
    setImmediate(async () => {
      try {
        for (const url of mediaUrls) {
          this.logger.log(`📸 Downloading MMS photo for lead ${leadId}: ${url}`);
          // Twilio media URLs require basic auth when media security is enabled
          const headers: Record<string, string> = {};
          if (
            url.includes('api.twilio.com') &&
            process.env.TWILIO_ACCOUNT_SID &&
            process.env.TWILIO_AUTH_TOKEN
          ) {
            headers.Authorization =
              'Basic ' +
              Buffer.from(
                `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`,
              ).toString('base64');
          }
          const response = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) {
            this.logger.warn(`Failed to download MMS photo: ${response.status} ${response.statusText}`);
            continue;
          }
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          await this.photosService.processAndSave(leadId, buffer, 'seller-mms');
          this.logger.log(`✅ Seller MMS photo saved for lead ${leadId}`);
        }

        // Check if we now have 2+ seller-mms photos → auto-trigger repair analysis
        const lead = await this.leadsService['prisma'].lead.findUnique({
          where: { id: leadId },
        });
        const photos = (lead?.photos as any[]) || [];
        const mmsCount = photos.filter((p: any) => p.source === 'seller-mms').length;

        if (mmsCount >= 2) {
          // Find the most recent CompAnalysis for this lead
          const latestAnalysis = await this.compAnalysisService['prisma'].compAnalysis.findFirst({
            where: { leadId },
            orderBy: { createdAt: 'desc' },
          });

          if (latestAnalysis) {
            this.logger.log(`🔍 Auto-triggering photo repair analysis for lead ${leadId} (${mmsCount} MMS photos, analysis ${latestAnalysis.id})`);
            await this.compAnalysisService.analyzePhotosFromLead(latestAnalysis.id, leadId);
            this.logger.log(`✅ Auto photo repair analysis complete for lead ${leadId}`);
          } else {
            this.logger.log(`ℹ️ Lead ${leadId} has ${mmsCount} MMS photos but no CompAnalysis - skipping auto-analysis`);
          }
        }
      } catch (err: any) {
        this.logger.error(`Failed to process MMS photos for lead ${leadId}: ${err.message}`);
      }
    });
  }

  // ─── Helper: find lead by phone number (normalizes + checks variants) ───

  private async findLeadByPhone(phone: string) {
    if (!phone) return null;
    const stripped = phone.replace(/\D/g, '').replace(/^1/, '');
    if (!stripped) return null;
    return this.leadsService['prisma'].lead.findFirst({
      where: {
        OR: [
          { sellerPhone: phone },
          { sellerPhone: stripped },
          { sellerPhone: `1${stripped}` },
          { sellerPhone: `+1${stripped}` },
        ],
      },
    });
  }
}
