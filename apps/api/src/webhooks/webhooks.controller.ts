import { Controller, Post, Body, Query, Req, Res, HttpCode, Logger, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
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
    private config: ConfigService,
  ) {}

  /**
   * Mailgun inbound route webhook. Configured in Mailgun as a route matching
   * the reply subdomain, forwarding the parsed message here. Verifies the
   * Mailgun signature, extracts the lead from the reply+{leadId}@ recipient,
   * and stores the reply in the conversation thread.
   */
  @Post('mailgun/inbound')
  @HttpCode(200)
  // Mailgun posts inbound as multipart/form-data (urlencoded when no
  // attachments). AnyFilesInterceptor parses the text fields into body either way.
  @UseInterceptors(AnyFilesInterceptor())
  async handleMailgunInbound(@Body() body: any) {
    if (!this.verifyMailgunSignature(body)) {
      this.logger.warn('⚠️  Mailgun inbound: signature verification failed');
      return { success: false, reason: 'invalid signature' };
    }

    const recipient: string = body.recipient || body.To || body.to || '';
    const leadId = this.extractLeadIdFromRecipient(recipient);

    const messageIdRaw: string = body['Message-Id'] || body['message-id'] || '';
    const mailgunMessageId = messageIdRaw.replace(/^</, '').replace(/>$/, '') || null;

    const result = await this.messagesService.handleInboundEmail({
      leadId,
      from: body.from || body.sender || '',
      to: recipient,
      subject: body.subject || body.Subject || '',
      // Prefer the stripped reply text (quoted history removed) when present.
      bodyText: body['stripped-text'] || body['body-plain'] || '',
      bodyHtml: body['stripped-html'] || body['body-html'] || null,
      mailgunMessageId,
      messageIdHeader: messageIdRaw || null,
      inReplyTo: body['In-Reply-To'] || body['in-reply-to'] || null,
    });

    return result;
  }

  /**
   * Verify Mailgun's webhook signature: HMAC-SHA256(signing_key, timestamp+token).
   */
  private verifyMailgunSignature(body: any): boolean {
    const signingKey = this.config.get<string>('MAILGUN_SIGNING_KEY');
    if (!signingKey) {
      this.logger.error('MAILGUN_SIGNING_KEY not set — rejecting inbound email');
      return false;
    }
    const timestamp = body.timestamp;
    const token = body.token;
    const signature = body.signature;
    if (!timestamp || !token || !signature) return false;

    const expected = crypto
      .createHmac('sha256', signingKey)
      .update(`${timestamp}${token}`)
      .digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /** Parse reply+{leadId}@domain → leadId. */
  private extractLeadIdFromRecipient(recipient: string): string | null {
    const m = recipient.match(/reply\+([^@]+)@/i);
    return m ? m[1] : null;
  }

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
   * LeadHouse webhook endpoint
   *
   * LeadHouse (LH365) PPC funnels — Facebook lead ads routed through
   * LeadConnector — POST a Perspective-style payload here. The lead data
   * arrives as three parallel maps keyed by opaque, funnel-specific question
   * ids (question_b77we9, custom-3f955bde…):
   *   - profile: { key: { value, title } }
   *   - values:  { key: value }
   *   - titles:  { key: title }
   *
   * Because the question ids change from funnel to funnel, we map every field
   * by its human-readable title text (e.g. "How Quickly Are You Looking to
   * Sell") rather than the key, so the same handler works across all LeadHouse
   * funnels.
   *
   * Configure the LeadHouse / LeadConnector outbound webhook to POST here:
   *   https://api.mydealcore.com/webhooks/leadhouse
   */
  @Post('leadhouse')
  @HttpCode(200)
  async handleLeadHouse(
    @Body() body: any,
    @Query('dryRun') dryRun?: string,
  ) {
    console.log('📥 LeadHouse webhook received:', JSON.stringify(body, null, 2));

    if (dryRun === 'true' || body?.dryRun === true) {
      this.logger.log('🧪 LeadHouse dry-run mode — no lead will be created');
      const preview = this.mapLeadHousePayload(body);
      try {
        fs.writeFileSync('/tmp/leadhouse-sample.json', JSON.stringify(body, null, 2));
        this.logger.log('📄 Saved payload → /tmp/leadhouse-sample.json');
      } catch (e) {
        this.logger.warn('Could not write sample file:', e.message);
      }
      return { success: true, dryRun: true, mapped: preview };
    }

    try {
      const mapped = this.mapLeadHousePayload(body);

      // Enrich/parse the address (fills city/state from zip when missing)
      const addr = await normalizeLeadAddressAsync({
        property_address: mapped.propertyAddress,
        city: mapped.propertyCity,
        state: mapped.propertyState,
        zip: mapped.propertyZip,
      });

      const leadData = {
        source: LeadSource.LEADHOUSE,
        organizationId: process.env.DEFAULT_ORGANIZATION_ID,
        propertyAddress: addr.propertyAddress,
        propertyCity: addr.propertyCity,
        propertyState: addr.propertyState,
        propertyZip: addr.propertyZip,
        sellerFirstName: mapped.sellerFirstName,
        sellerLastName: mapped.sellerLastName,
        sellerPhone: formatPhoneNumber(mapped.sellerPhone),
        sellerEmail: mapped.sellerEmail,
        propertyType: mapped.propertyType,
        timeline: mapped.timeline,
        conditionLevel: mapped.conditionLevel,
        ownershipStatus: mapped.ownershipStatus,
        sellerMotivation: mapped.sellerMotivation,
        sourceMetadata: {
          ...body,
          _leadhouseId: body?.id,
          _funnelId: body?.funnelId,
          _funnelName: body?.funnelName,
          _notes: mapped.notes,
        },
      };

      const lead = await this.leadsService.createLead(leadData);

      await this.triggerAiOutreach(lead.id, 'LeadHouse');

      return { success: true, leadId: lead.id };
    } catch (error) {
      console.error('❌ LeadHouse webhook error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Maps a raw LeadHouse payload into flat lead fields. Matches every field by
   * its title text (not the funnel-specific question key) so it survives new
   * funnels that reuse the same question wording under different ids.
   */
  private mapLeadHousePayload(body: any): {
    propertyAddress: string;
    propertyCity: string;
    propertyState: string;
    propertyZip: string;
    sellerFirstName: string;
    sellerLastName: string;
    sellerPhone: string;
    sellerEmail: string;
    propertyType?: string;
    timeline?: number;
    conditionLevel?: string;
    ownershipStatus?: string;
    sellerMotivation?: string;
    notes: string;
  } {
    // Build unified key → value and key → title maps from both `values`
    // (flat) and `profile` (nested { value, title }) so we cope with either
    // shape LeadHouse might send.
    const values: Record<string, any> = {};
    const titles: Record<string, string> = {};
    if (body?.values && typeof body.values === 'object') {
      for (const [k, v] of Object.entries(body.values)) values[k] = v;
    }
    if (body?.titles && typeof body.titles === 'object') {
      for (const [k, t] of Object.entries(body.titles)) titles[k] = String(t);
    }
    if (body?.profile && typeof body.profile === 'object') {
      for (const [k, obj] of Object.entries<any>(body.profile)) {
        if (obj && typeof obj === 'object') {
          if (values[k] == null) values[k] = obj.value;
          if (!titles[k] && obj.title) titles[k] = String(obj.title);
        }
      }
    }

    // Look up an answer by matching the question title against phrases.
    const byTitle = (...phrases: string[]): string | undefined => {
      for (const [key, title] of Object.entries(titles)) {
        const t = title.toLowerCase();
        if (phrases.some((p) => t.includes(p))) {
          const v = values[key];
          const s = v == null ? '' : String(v).trim();
          if (s) return s;
        }
      }
      return undefined;
    };
    // Direct key lookup for the stable, semantic keys LeadHouse always sends.
    const byKey = (key: string): string | undefined => {
      const v = values[key];
      const s = v == null ? '' : String(v).trim();
      return s || undefined;
    };

    // Strip Slack-style :emoji_shortcodes: that LeadHouse leaves in answers.
    const clean = (s?: string): string | undefined =>
      s ? s.replace(/:[a-z0-9_+-]+:/gi, '').replace(/\s+/g, ' ').trim() || undefined : undefined;

    const propertyAddress = byTitle('property address') || byKey('street') || '';
    const propertyCity = byTitle('property city') || byKey('city') || '';
    const propertyState = byTitle('property state') || '';
    const propertyZip = byTitle('property zip', 'zip code') || byKey('zip') || '';

    const sellerFirstName = byTitle('first name') || byKey('firstName') || '';
    const sellerLastName = byTitle('last name') || byKey('lastName') || '';
    const sellerEmail = byTitle('email') || byKey('email') || '';
    const sellerPhone = byTitle('phone') || byKey('phone') || '';

    const propertyType = clean(byTitle('type of property'));
    const conditionAnswer = clean(byTitle('condition of the property'));
    const ownershipAnswer = clean(byTitle('best describes you'));
    const timelineAnswer = clean(byTitle('how quickly'));
    const motivationAnswer = clean(byKey('reasonforselling') || byTitle('divorce, inheritance', 'reason for selling'));
    const mattersMost = clean(byTitle('matters most'));
    const belowMarket = clean(byTitle('below market'));
    const mlsListed = clean(byTitle('listed on'));

    // Assemble free-text notes from the qualifying answers we don't map to a
    // dedicated column, so nothing the seller told us is lost.
    const noteParts: string[] = [];
    if (timelineAnswer) noteParts.push(`Timeline: ${timelineAnswer}`);
    if (motivationAnswer) noteParts.push(`Reason for selling: ${motivationAnswer}`);
    if (mattersMost) noteParts.push(`What matters most: ${mattersMost}`);
    if (belowMarket) noteParts.push(`Open to below-market cash offer: ${belowMarket}`);
    if (mlsListed) noteParts.push(`MLS/Zillow listed: ${mlsListed}`);
    if (body?.funnelName) noteParts.push(`Funnel: ${String(body.funnelName).trim()}`);

    return {
      propertyAddress,
      propertyCity,
      propertyState: propertyState.toUpperCase(),
      propertyZip,
      sellerFirstName,
      sellerLastName,
      sellerPhone,
      sellerEmail,
      propertyType,
      timeline: this.mapLeadHouseTimelineToDays(timelineAnswer),
      conditionLevel: conditionAnswer,
      ownershipStatus: this.normalizeLeadHouseOwnership(ownershipAnswer),
      sellerMotivation: motivationAnswer,
      notes: noteParts.join(' | '),
    };
  }

  /**
   * Convert a LeadHouse "how quickly" answer to an approximate number of days
   * so the priority score can be computed. Returns undefined when unknown.
   */
  private mapLeadHouseTimelineToDays(answer?: string): number | undefined {
    if (!answer) return undefined;
    const a = answer.toLowerCase();
    if (a.includes('asap') || a.includes('immediate') || a.includes('right away')) return 7;
    if (a.includes('30') || a.includes('1 month') || a.includes('one month')) return 30;
    if (a.includes('60') || a.includes('2 month')) return 60;
    if (a.includes('90') || a.includes('3 month')) return 90;
    if (a.includes('just') || a.includes('curious') || a.includes('exploring') || a.includes('not sure')) return undefined;
    return undefined;
  }

  /**
   * Normalize a LeadHouse "which best describes you" answer into a readable
   * ownership status that also carries the keyword the authority score looks
   * for (sole / heir / helping). Falls back to the raw answer.
   */
  private normalizeLeadHouseOwnership(answer?: string): string | undefined {
    if (!answer) return undefined;
    const a = answer.toLowerCase();
    if (a.includes('inherit')) return 'Heir (inherited property)';
    if (a.includes('agent') || a.includes('realtor') || a.includes('wholesal') || a.includes('broker') || a.includes('behalf') || a.includes('someone else') || a.includes('helping')) {
      return 'Not the owner (helping / agent)';
    }
    if (a.includes('spouse') || a.includes('jointly') || a.includes('joint') || a.includes('co-own') || a.includes('together')) {
      return 'Co-owner';
    }
    if (a.includes('purchas') || a.includes('bought') || a.includes('myself') || a.includes('i own') || a.includes('own it')) {
      return 'Sole owner';
    }
    return answer;
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
        this.processInboundMediaInBackground(mediaUrls, result.leadId, result.messageId);
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
   * Dev-only: simulate an inbound SMS without hitting a real carrier.
   * POST /webhooks/dev/simulate-inbound
   * Body: { "from": "+17046812994", "message": "I want to sell my house" }
   *
   * Feeds the same path a real Twilio inbound message takes. Only active when
   * SMS_TEST_MODE=true.
   */
  @Post('dev/simulate-inbound')
  @HttpCode(200)
  async simulateInboundSms(@Body() body: any) {
    const testMode = process.env.SMS_TEST_MODE?.toLowerCase() === 'true';
    if (!testMode) {
      return { success: false, error: 'Simulation endpoint only available in TEST_MODE' };
    }

    const from: string = body.from || '+15550000000';
    const text: string = (body.message || body.body || body.text || 'Test inbound message').trim();

    console.log('🧪 Simulating Twilio inbound SMS:', { from, text });

    const keyword = text.toUpperCase();
    if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(keyword)) {
      await this.markDoNotText(from, 'Simulated STOP reply');
    } else if (['START', 'UNSTOP'].includes(keyword)) {
      await this.unmarkDoNotText(from);
    }

    const result = await this.messagesService.handleInboundMessage({
      MessageSid: `SIMULATED_${Date.now()}`,
      From: from,
      To: body.to || process.env.TWILIO_PHONE_NUMBER || '+15550000000',
      Body: text,
    });

    return { success: true, ...result };
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
    // status: 'DNC' matters as well as the doNotContact flag, because the
    // pipeline and list views filter on status. The old provider's dedicated
    // DNC webhook set it; Twilio only gives us the STOP keyword, so we set it
    // here or opted-out leads keep showing up as active.
    await this.leadsService['prisma'].lead.updateMany({
      where: { sellerPhone: phone },
      data: { doNotContact: true, unsubscribedAt: new Date(), status: 'DNC' },
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
  // Shared by the Twilio inbound webhook and the dev simulator.
  private processInboundMediaInBackground(mediaUrls: string[], leadId: string, messageId?: string) {
    // Run in background - don't block the webhook response
    setImmediate(async () => {
      try {
        // Collected so we can also attach the saved photos to the inbound
        // message, making them render inline in the conversation feed.
        const savedMedia: { url: string; thumbnailUrl: string }[] = [];
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
          const saved = await this.photosService.processAndSave(leadId, buffer, 'seller-mms');
          if (saved?.url && saved?.thumbnailUrl) {
            savedMedia.push({ url: saved.url, thumbnailUrl: saved.thumbnailUrl });
          }
          this.logger.log(`✅ Seller MMS photo saved for lead ${leadId}`);
        }

        // Attach the saved photos to the inbound message so the conversation
        // feed renders them inline instead of the "[📷 Photo]" placeholder.
        if (messageId && savedMedia.length > 0) {
          try {
            await this.leadsService['prisma'].message.update({
              where: { id: messageId },
              data: { mediaUrls: savedMedia },
            });
          } catch (err: any) {
            this.logger.warn(`Failed to attach media to message ${messageId}: ${err.message}`);
          }
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

}
