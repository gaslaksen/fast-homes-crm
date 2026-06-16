import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';
import { PrismaService } from '../prisma/prisma.service';
import { formatPhoneNumber } from '@fast-homes/shared';

const AccessToken = Twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;
const VoiceResponse = Twilio.twiml.VoiceResponse;

/**
 * Browser-based softphone on Twilio Programmable Voice.
 *
 * Flow:
 *  1. Browser asks /calls/twilio/token for a short-lived access token (identity = userId).
 *  2. @twilio/voice-sdk Device registers with that token.
 *  3. On dial, Twilio POSTs the TwiML App Voice URL -> generateDialTwiml() returns
 *     <Dial callerId=ourNumber><Number>lead</Number></Dial> and a CallLog row is opened.
 *  4. Status + recording callbacks update that CallLog by CallSid.
 *
 * Entirely dormant until TWILIO_API_KEY_SID / SECRET / TWIML_APP_SID are set, so it
 * never interferes with the live Smrtphone calling path.
 */
@Injectable()
export class TwilioVoiceService {
  private readonly logger = new Logger(TwilioVoiceService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  isConfigured(): boolean {
    return !!(
      this.config.get<string>('TWILIO_ACCOUNT_SID') &&
      this.config.get<string>('TWILIO_API_KEY_SID') &&
      this.config.get<string>('TWILIO_API_KEY_SECRET') &&
      this.config.get<string>('TWILIO_TWIML_APP_SID')
    );
  }

  /** Mint a Voice access token for a browser softphone. identity = userId. */
  generateToken(identity: string): { token: string; identity: string } {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const apiKeySid = this.config.get<string>('TWILIO_API_KEY_SID');
    const apiKeySecret = this.config.get<string>('TWILIO_API_KEY_SECRET');
    const twimlAppSid = this.config.get<string>('TWILIO_TWIML_APP_SID');

    if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
      throw new Error(
        'Twilio Voice not configured (need TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID)',
      );
    }

    // Token TTL: 1 hour. The browser refreshes via the Device tokenWillExpire event.
    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity,
      ttl: 3600,
    });

    token.addGrant(
      new VoiceGrant({
        outgoingApplicationSid: twimlAppSid,
        incomingAllow: true, // lets inbound reach this client later (Phase 3)
      }),
    );

    return { token: token.toJwt(), identity };
  }

  /**
   * Build the TwiML that connects the browser leg to the seller's phone.
   * Called by the TwiML App Voice webhook. `params` is the Twilio request body.
   */
  async generateDialTwiml(params: Record<string, string>): Promise<string> {
    const response = new VoiceResponse();

    const callerId =
      this.config.get<string>('TWILIO_PHONE_NUMBER') || '';
    const to = formatPhoneNumber(params.To || params.to || '');
    const callSid = params.CallSid || '';
    const leadId = params.leadId || params.LeadId || null;
    // From looks like "client:<userId>" for browser-originated calls
    const userId = (params.From || '').replace(/^client:/, '') || null;

    if (!to || !callerId) {
      this.logger.warn(
        `Twilio voice webhook missing ${!to ? 'To' : 'callerId'} — rejecting call`,
      );
      response.say('We could not place this call. Please try again.');
      return response.toString();
    }

    // Open a CallLog row keyed by the browser leg's CallSid
    if (callSid) {
      try {
        await this.prisma.callLog.upsert({
          where: { twilioCallSid: callSid },
          create: {
            twilioCallSid: callSid,
            leadId,
            initiatedByUserId: userId,
            fromNumber: callerId,
            toNumber: to,
            status: 'in-progress',
            type: 'twilio_browser',
          },
          update: { status: 'in-progress', toNumber: to },
        });
      } catch (err: any) {
        this.logger.error(`Failed to open CallLog for ${callSid}: ${err.message}`);
      }
    }

    const apiBase = this.config.get<string>('API_URL') || '';
    const recordCalls =
      (this.config.get<string>('TWILIO_RECORD_CALLS') || 'false').toLowerCase() === 'true';

    // Two-party-consent safety: optional spoken disclosure before connecting
    const disclosure = this.config.get<string>('TWILIO_RECORDING_DISCLOSURE');
    if (recordCalls && disclosure) {
      response.say(disclosure);
    }

    const dial = response.dial({
      callerId,
      answerOnBridge: true, // caller hears ringback, not silence
      // Dial 'action' fires when the dialed leg ends -> final status + duration
      action: apiBase ? `${apiBase}/calls/twilio/status` : undefined,
      method: 'POST',
      ...(recordCalls
        ? {
            record: 'record-from-answer-dual' as const,
            recordingStatusCallback: apiBase
              ? `${apiBase}/calls/twilio/recording`
              : undefined,
            recordingStatusCallbackMethod: 'POST' as const,
          }
        : {}),
    });
    dial.number(to);

    return response.toString();
  }

  /**
   * TwiML for an inbound call to the Twilio number. Rings the agents' browsers
   * via <Dial><Client>. Called by the phone number's Voice webhook.
   */
  async generateIncomingTwiml(params: Record<string, string>): Promise<string> {
    const response = new VoiceResponse();

    const from = params.From || params.from || '';
    const to = params.To || params.to || '';
    const callSid = params.CallSid || '';

    const lead = await this.findLeadByPhone(from);
    const callerName = lead
      ? `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim()
      : '';

    // Log the inbound call
    if (callSid) {
      try {
        await this.prisma.callLog.upsert({
          where: { twilioCallSid: callSid },
          create: {
            twilioCallSid: callSid,
            leadId: lead?.id || null,
            fromNumber: from,
            toNumber: to,
            status: 'in-progress',
            type: 'twilio_inbound',
          },
          update: { status: 'in-progress' },
        });
      } catch (err: any) {
        this.logger.error(`Failed to log inbound call ${callSid}: ${err.message}`);
      }
    }

    const identities = await this.getRingIdentities();
    if (identities.length === 0) {
      response.say('No agents are available to take your call. Please try again later.');
      return response.toString();
    }

    const apiBase = this.config.get<string>('API_URL') || '';
    const recordCalls =
      (this.config.get<string>('TWILIO_RECORD_CALLS') || 'false').toLowerCase() === 'true';

    const dial = response.dial({
      timeout: 25,
      answerOnBridge: true,
      action: apiBase ? `${apiBase}/calls/twilio/status` : undefined,
      method: 'POST',
      ...(recordCalls
        ? {
            record: 'record-from-answer-dual' as const,
            recordingStatusCallback: apiBase
              ? `${apiBase}/calls/twilio/recording`
              : undefined,
            recordingStatusCallbackMethod: 'POST' as const,
          }
        : {}),
    });

    // Ring every agent browser at once; first to answer wins, offline ones no-op.
    for (const identity of identities) {
      const client = dial.client();
      client.identity(identity);
      client.parameter({ name: 'From', value: from });
      if (callerName) client.parameter({ name: 'callerName', value: callerName });
      if (lead?.id) client.parameter({ name: 'leadId', value: lead.id });
    }

    return response.toString();
  }

  private async getRingIdentities(): Promise<string[]> {
    // Optional explicit allowlist of client identities (userIds) to ring
    const override = this.config.get<string>('TWILIO_INBOUND_RING_IDENTITIES');
    if (override) {
      return override.split(',').map((s) => s.trim()).filter(Boolean);
    }
    // Default: ring all users (single-tenant). Capped as a safety bound.
    const users = await this.prisma.user.findMany({ select: { id: true }, take: 20 });
    return users.map((u) => u.id);
  }

  private async findLeadByPhone(phone: string) {
    if (!phone) return null;
    const stripped = phone.replace(/\D/g, '').replace(/^1/, '');
    if (!stripped) return null;
    return this.prisma.lead.findFirst({
      where: {
        OR: [
          { sellerPhone: phone },
          { sellerPhone: stripped },
          { sellerPhone: `1${stripped}` },
          { sellerPhone: `+1${stripped}` },
        ],
      },
      select: { id: true, sellerFirstName: true, sellerLastName: true },
    });
  }

  /** Status callback (Dial action + per-call status). Updates CallLog by CallSid. */
  async handleStatusCallback(body: Record<string, string>): Promise<void> {
    const callSid = body.CallSid || '';
    if (!callSid) return;

    // Dial action posts DialCallStatus/DialCallDuration; status callbacks post CallStatus
    const rawStatus = body.DialCallStatus || body.CallStatus || '';
    const duration = parseInt(body.DialCallDuration || body.CallDuration || '0', 10);

    const statusMap: Record<string, string> = {
      completed: 'completed',
      answered: 'completed',
      busy: 'completed',
      'no-answer': 'completed',
      failed: 'failed',
      canceled: 'completed',
    };
    const status = statusMap[rawStatus] || 'in-progress';

    try {
      await this.prisma.callLog.updateMany({
        where: { twilioCallSid: callSid },
        data: {
          status,
          ...(duration ? { duration } : {}),
          ...(rawStatus ? { endedReason: rawStatus } : {}),
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to update CallLog ${callSid}: ${err.message}`);
    }
  }

  /** Recording callback. Stores the recording URL on the CallLog. */
  async handleRecordingCallback(body: Record<string, string>): Promise<void> {
    const callSid = body.CallSid || '';
    const recordingUrl = body.RecordingUrl || '';
    if (!callSid || !recordingUrl) return;

    try {
      await this.prisma.callLog.updateMany({
        where: { twilioCallSid: callSid },
        data: { recordingUrl: `${recordingUrl}.mp3` },
      });
    } catch (err: any) {
      this.logger.error(`Failed to store recording for ${callSid}: ${err.message}`);
    }
  }

  /**
   * Post-call disposition from the agent (Voicemail, Follow Up, Not Interested, ...).
   * Keyed by the browser leg's CallSid, which is what the client knows.
   */
  async setDisposition(
    callSid: string,
    disposition: string,
    notes?: string,
  ): Promise<void> {
    if (!callSid) return;
    await this.prisma.callLog.updateMany({
      where: { twilioCallSid: callSid },
      data: {
        disposition,
        ...(notes ? { summary: notes } : {}),
      },
    });
  }

  /** Recent calls for the dialer "Recents" tab. */
  async recentCalls(limit = 25) {
    return this.prisma.callLog.findMany({
      where: { type: 'twilio_browser' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        lead: {
          select: {
            id: true,
            sellerFirstName: true,
            sellerLastName: true,
            sellerPhone: true,
          },
        },
      },
    });
  }
}
