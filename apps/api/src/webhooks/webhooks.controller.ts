import { Controller, Post, Body, Query, Req, Res, HttpCode, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { Request, Response } from 'express';
import { LeadsService } from '../leads/leads.service';
import { MessagesService } from '../messages/messages.service';
import { DripService } from '../drip/drip.service';
import { CallsService } from '../calls/calls.service';
import { PhotosService } from '../photos/photos.service';
import { CompAnalysisService } from '../comps/comp-analysis.service';
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
      // Map PropertyLeads fields to our schema
      // normalizeLeadAddressAsync handles full address strings and looks up city/state from zip
      const addr = await normalizeLeadAddressAsync(body);
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
      const addr = await normalizeLeadAddressAsync(body);
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
            // Run in background — don't block the webhook response
            setImmediate(async () => {
              try {
                for (const url of uniqueMediaUrls) {
                  this.logger.log(`📸 Downloading MMS photo for lead ${result.leadId}: ${url}`);
                  const response = await fetch(url, {
                    signal: AbortSignal.timeout(15000),
                  });
                  if (!response.ok) {
                    this.logger.warn(`Failed to download MMS photo: ${response.status} ${response.statusText}`);
                    continue;
                  }
                  const arrayBuffer = await response.arrayBuffer();
                  const buffer = Buffer.from(arrayBuffer);
                  await this.photosService.processAndSave(result.leadId, buffer, 'seller-mms');
                  this.logger.log(`✅ Seller MMS photo saved for lead ${result.leadId}`);
                }

                // Check if we now have 2+ seller-mms photos → auto-trigger repair analysis
                const lead = await this.leadsService['prisma'].lead.findUnique({
                  where: { id: result.leadId },
                });
                const photos = (lead?.photos as any[]) || [];
                const mmsCount = photos.filter((p: any) => p.source === 'seller-mms').length;

                if (mmsCount >= 2) {
                  // Find the most recent CompAnalysis for this lead
                  const latestAnalysis = await this.compAnalysisService['prisma'].compAnalysis.findFirst({
                    where: { leadId: result.leadId },
                    orderBy: { createdAt: 'desc' },
                  });

                  if (latestAnalysis) {
                    this.logger.log(`🔍 Auto-triggering photo repair analysis for lead ${result.leadId} (${mmsCount} MMS photos, analysis ${latestAnalysis.id})`);
                    await this.compAnalysisService.analyzePhotosFromLead(latestAnalysis.id, result.leadId);
                    this.logger.log(`✅ Auto photo repair analysis complete for lead ${result.leadId}`);
                  } else {
                    this.logger.log(`ℹ️ Lead ${result.leadId} has ${mmsCount} MMS photos but no CompAnalysis — skipping auto-analysis`);
                  }
                }
              } catch (err: any) {
                this.logger.error(`Failed to process MMS photos for lead ${result.leadId}: ${err.message}`);
              }
            });
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
          const recentCutoff = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago
          const existingByContent = !existingMsg
            ? await this.leadsService['prisma'].message.findFirst({
                where: {
                  leadId: outboundLead.id,
                  direction: 'OUTBOUND',
                  createdAt: { gte: recentCutoff },
                  OR: [
                    { body: coreBody },
                    { body: msgBody },
                    // Fallback: match if our stored body starts with the first 80 chars
                    // (handles edge cases where footer format varies)
                    ...(coreBody.length >= 80
                      ? [{ body: { startsWith: coreBody.substring(0, 80) } }]
                      : []),
                  ],
                },
              })
            : null;

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
              sentAt: new Date(),
            },
          });

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
