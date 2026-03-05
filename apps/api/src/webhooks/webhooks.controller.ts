import { Controller, Post, Body, Req, Res, HttpCode } from '@nestjs/common';
import { Request, Response } from 'express';
import { LeadsService } from '../leads/leads.service';
import { MessagesService } from '../messages/messages.service';
import { DripService } from '../drip/drip.service';
import { CallsService } from '../calls/calls.service';
import { SlackLeadService } from './slack-lead.service';
import { InvestorFuseService } from './investorfuse.service';
import { formatPhoneNumber, LeadSource } from '@fast-homes/shared';
import { normalizeLeadAddress } from './address-parser';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private leadsService: LeadsService,
    private messagesService: MessagesService,
    private dripService: DripService,
    private callsService: CallsService,
    private slackLeadService: SlackLeadService,
    private investorFuseService: InvestorFuseService,
  ) {}

  /**
   * PropertyLeads.com webhook endpoint
   * Ingests leads from PropertyLeads
   */
  @Post('propertyleads')
  async handlePropertyLeads(@Body() body: any) {
    console.log('📥 PropertyLeads webhook received:', body);

    try {
      // Map PropertyLeads fields to our schema
      // normalizeLeadAddress handles full address strings like "123 Main St, Austin, TX 78701"
      const addr = normalizeLeadAddress(body);
      console.log('📍 Parsed address:', addr);
      const leadData = {
        source: LeadSource.PROPERTY_LEADS,
        propertyAddress: addr.propertyAddress,
        propertyCity: addr.propertyCity,
        propertyState: addr.propertyState,
        propertyZip: addr.propertyZip,
        sellerFirstName: body.first_name || body.firstName,
        sellerLastName: body.last_name || body.lastName,
        sellerPhone: formatPhoneNumber(body.phone || body.phoneNumber),
        sellerEmail: body.email,
        propertyType: body.property_type || body.propertyType,
        bedrooms: body.bedrooms ? parseInt(body.bedrooms) : undefined,
        bathrooms: body.bathrooms ? parseFloat(body.bathrooms) : undefined,
        sqft: body.sqft || body.squareFeet ? parseInt(body.sqft || body.squareFeet) : undefined,
        timeline: body.timeline_days ? parseInt(body.timeline_days) : undefined,
        askingPrice: body.asking_price ? parseFloat(body.asking_price) : undefined,
        sourceMetadata: body,
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
  async handleGoogleAds(@Body() body: any) {
    console.log('📥 Google Ads webhook received:', body);

    try {
      const addr = normalizeLeadAddress(body);
      console.log('📍 Parsed address:', addr);
      const leadData = {
        source: LeadSource.GOOGLE_ADS,
        propertyAddress: addr.propertyAddress,
        propertyCity: addr.propertyCity,
        propertyState: addr.propertyState,
        propertyZip: addr.propertyZip,
        sellerFirstName: body.sellerFirstName || body.firstName || body.name?.split(' ')[0] || 'Unknown',
        sellerLastName: body.sellerLastName || body.lastName || body.name?.split(' ').slice(1).join(' ') || '',
        sellerPhone: formatPhoneNumber(body.sellerPhone || body.phone),
        sellerEmail: body.sellerEmail || body.email,
        sourceMetadata: body,
      };

      const lead = await this.leadsService.createLead(leadData);

      await this.triggerAiOutreach(lead.id, 'GoogleAds');

      return {
        success: true,
        leadId: lead.id,
      };
    } catch (error) {
      console.error('❌ Google Ads webhook error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Twilio inbound message webhook
   * Receives incoming SMS messages
   */
  @Post('twilio/inbound')
  async handleTwilioInbound(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    console.log('📥 Twilio inbound message:', body);

    try {
      // Twilio sends form-encoded data
      const result = await this.messagesService.handleInboundMessage({
        MessageSid: body.MessageSid || body.SmsSid,
        From: body.From,
        To: body.To,
        Body: body.Body,
      });

      console.log('✅ Twilio message processed:', result);

      // Respond to Twilio with TwiML (empty response = no auto-reply)
      res.set('Content-Type', 'text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    } catch (error) {
      console.error('❌ Twilio webhook error:', error);
      res.set('Content-Type', 'text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  }

  /**
   * InvestorFuse "opportunity created" webhook
   * Paste this URL into InvestorFuse Settings → Integrations → Webhook
   * Format: https://your-tunnel.loca.lt/webhooks/investorfuse
   *
   * On receipt: parses address, fetches RentCast comps + Claude analysis,
   * posts full breakdown to Slack.
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
   * Parses the address, fetches RentCast comps + Claude analysis,
   * and posts the full breakdown back to Slack.
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
   * Shared helper: fire AI SMS drip + schedule AI call for a newly created lead.
   * Both actions respect their respective global toggles from DripSettings.
   */
  private async triggerAiOutreach(leadId: string, source: string) {
    // 1. AI SMS drip (checks aiSmsEnabled internally)
    try {
      await this.dripService.startSequence(leadId);
    } catch (err) {
      console.error(`⚠️  [${source}] Failed to start drip sequence:`, err.message);
    }

    // 2. AI outbound call (reads callDelayMs from settings, checks aiCallEnabled at fire time)
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
    console.log(`📥 SmrtPhone webhook [${event}]:`, JSON.stringify(body).substring(0, 300));

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

          if (!from || !text) {
            console.warn('⚠️  smsIncoming: missing from/message fields');
            return { success: false, error: 'Missing required fields' };
          }

          const result = await this.messagesService.handleInboundMessage({
            MessageSid: smsId,
            From: from,
            To: to,
            Body: text,
          });

          console.log('✅ smsIncoming processed:', result);
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
            await this.leadsService['prisma'].lead.updateMany({
              where: { sellerPhone: phone },
              data: { doNotContact: true, status: 'DNC' },
            });
            console.log(`🚫 DNC: ${phone}`);
          }
          return { success: true };
        }

        // ── Compliance: DNT (Do Not Text / STOP reply) ───────────────────
        case 'addNumberToDNT': {
          // { phone, timestamp, userId, source, event }
          const phone = formatPhoneNumber(body.phone || '');
          if (phone) {
            await this.leadsService['prisma'].lead.updateMany({
              where: { sellerPhone: phone },
              data: { doNotContact: true, unsubscribedAt: new Date() },
            });
            console.log(`🚫 DNT (STOP): ${phone} — source: ${body.source}`);
          }
          return { success: true };
        }

        // ── Compliance: re-subscribed (START reply) ──────────────────────
        case 'removeNumberFromDNT': {
          // { phone, timestamp, userId, source, event }
          const phone = formatPhoneNumber(body.phone || '');
          if (phone) {
            await this.leadsService['prisma'].lead.updateMany({
              where: { sellerPhone: phone },
              data: { doNotContact: false },
            });
            console.log(`✅ DNT removed (START): ${phone}`);
          }
          return { success: true };
        }

        // ── AI Tools: call transcript/summary/keywords ───────────────────
        case 'aiTools': {
          // { callId, timestamp, ai_keywords, ai_summary, ai_transcript, event }
          console.log(`🧠 AI Tools data for call ${body.callId}:`, {
            keywords: body.ai_keywords,
            summary: body.ai_summary?.substring(0, 100),
          });
          // TODO: match callId to a lead and store transcript/summary
          // Requires callId → leadId mapping when calls are initiated
          return { success: true };
        }

        // ── smrtAgent: AI voice agent call ended ─────────────────────────
        case 'smrtAgentCallEnded': {
          // { callId, id, agentName, timestamp, summary, transcript, callDetails, event }
          // callDetails includes: Property Address, Reason For Sale, Ownership Status, Sale Timeline
          console.log(`🤖 smrtAgent call ended [${body.callId}]:`, {
            summary: body.summary?.substring(0, 150),
            callDetails: body.callDetails,
          });
          // TODO: parse callDetails HTML, match to lead, update qualification fields
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
   * Twilio delivery status webhook (optional)
   * Receives status updates for sent messages
   */
  @Post('twilio/status')
  async handleTwilioStatus(@Body() body: any) {
    console.log('📥 Twilio status update:', body);

    try {
      const messageSid = body.MessageSid || body.SmsSid;
      const status = body.MessageStatus || body.SmsStatus;

      // Update message status in database
      await this.messagesService['prisma'].message.updateMany({
        where: { twilioSid: messageSid },
        data: {
          status: status.toUpperCase(),
          deliveredAt: status === 'delivered' ? new Date() : undefined,
        },
      });

      return { success: true };
    } catch (error) {
      console.error('❌ Twilio status webhook error:', error);
      return { success: false };
    }
  }
}
