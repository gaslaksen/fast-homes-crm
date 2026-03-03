import { Controller, Post, Body, Req, Res, HttpCode } from '@nestjs/common';
import { Request, Response } from 'express';
import { LeadsService } from '../leads/leads.service';
import { MessagesService } from '../messages/messages.service';
import { DripService } from '../drip/drip.service';
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

      // Start auto-text drip sequence
      try {
        await this.dripService.startSequence(lead.id);
      } catch (err) {
        console.error('⚠️  Failed to start drip sequence:', err.message);
      }

      console.log(`✅ PropertyLeads lead created: ${lead.id}`);

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

      // Start auto-text drip sequence
      try {
        await this.dripService.startSequence(lead.id);
      } catch (err) {
        console.error('⚠️  Failed to start drip sequence:', err.message);
      }

      console.log(`✅ Google Ads lead created: ${lead.id}`);

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
