import { Controller, Post, Body, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { LeadsService } from '../leads/leads.service';
import { MessagesService } from '../messages/messages.service';
import { formatPhoneNumber, LeadSource } from '@fast-homes/shared';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private leadsService: LeadsService,
    private messagesService: MessagesService,
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
      // Adjust mapping based on actual PropertyLeads payload structure
      const leadData = {
        source: LeadSource.PROPERTY_LEADS,
        propertyAddress: body.property_address || body.address,
        propertyCity: body.city,
        propertyState: body.state,
        propertyZip: body.zip || body.zipcode,
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
      const leadData = {
        source: LeadSource.GOOGLE_ADS,
        propertyAddress: body.propertyAddress || body.address,
        propertyCity: body.propertyCity || body.city,
        propertyState: body.propertyState || body.state,
        propertyZip: body.propertyZip || body.zip,
        sellerFirstName: body.sellerFirstName || body.firstName || body.name?.split(' ')[0] || 'Unknown',
        sellerLastName: body.sellerLastName || body.lastName || body.name?.split(' ').slice(1).join(' ') || '',
        sellerPhone: formatPhoneNumber(body.sellerPhone || body.phone),
        sellerEmail: body.sellerEmail || body.email,
        sourceMetadata: body,
      };

      const lead = await this.leadsService.createLead(leadData);

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
