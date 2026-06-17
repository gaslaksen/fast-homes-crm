import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';
import { PrismaService } from '../prisma/prisma.service';
import { CallsService } from './calls.service';
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
    @Inject(forwardRef(() => CallsService))
    private readonly callsService: CallsService,
  ) {}

  /**
   * Public base URL Twilio uses to reach our callbacks. Prefer API_URL, fall
   * back to TWILIO_WEBHOOK_BASE_URL so status/recording callbacks keep working
   * even if only one is configured.
   */
  private callbackBase(): string {
    const base =
      this.config.get<string>('API_URL') ||
      this.config.get<string>('TWILIO_WEBHOOK_BASE_URL') ||
      '';
    if (!base) {
      this.logger.warn(
        'Neither API_URL nor TWILIO_WEBHOOK_BASE_URL is set — Twilio status/recording callbacks will not fire',
      );
    }
    return base.replace(/\/+$/, '');
  }

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

    const apiBase = this.callbackBase();
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

    const apiBase = this.callbackBase();
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
      const result = await this.prisma.callLog.updateMany({
        where: { twilioCallSid: callSid },
        data: {
          status,
          ...(duration ? { duration } : {}),
          ...(rawStatus ? { endedReason: rawStatus } : {}),
        },
      });
      this.logger.log(
        `📞 Status callback ${callSid}: ${rawStatus || '(none)'} -> ${status} (${duration}s), ${result.count} row(s) updated`,
      );
    } catch (err: any) {
      this.logger.error(`Failed to update CallLog ${callSid}: ${err.message}`);
    }
  }

  /**
   * Recording callback. Stores a playback proxy URL on the CallLog, then kicks
   * off transcription + CAMP extraction in the background.
   */
  async handleRecordingCallback(body: Record<string, string>): Promise<void> {
    const callSid = body.CallSid || '';
    const recordingSid = body.RecordingSid || '';
    const recordingStatus = body.RecordingStatus || 'completed';
    if (!callSid || !recordingSid) return;
    if (recordingStatus !== 'completed') return; // only act on the final recording

    // The raw Twilio media URL needs account auth to fetch, so we store a proxy
    // URL the browser <audio> can hit; the proxy streams it with our credentials.
    const base = this.callbackBase();
    const proxyUrl = base
      ? `${base}/calls/twilio/recording-media/${recordingSid}`
      : `${body.RecordingUrl}.mp3`;

    try {
      await this.prisma.callLog.updateMany({
        where: { twilioCallSid: callSid },
        data: { recordingUrl: proxyUrl },
      });
      this.logger.log(`🎙️  Recording stored for ${callSid} (recordingSid=${recordingSid})`);
    } catch (err: any) {
      this.logger.error(`Failed to store recording for ${callSid}: ${err.message}`);
    }

    // Transcribe + extract CAMP in the background (best-effort, never blocks)
    setImmediate(() => {
      this.transcribeAndExtract(callSid, recordingSid).catch((err) =>
        this.logger.error(`Transcription failed for ${callSid}: ${err.message}`),
      );
    });
  }

  /** Fetch the recording, transcribe via OpenAI, store it, and run CAMP extraction. */
  private async transcribeAndExtract(callSid: string, recordingSid: string): Promise<void> {
    const openaiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!openaiKey) {
      this.logger.warn('OPENAI_API_KEY not set — skipping Twilio call transcription');
      return;
    }

    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    if (!accountSid || !authToken) return;

    // Pull the audio from Twilio (account-authenticated)
    const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const audioRes = await fetch(mediaUrl, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!audioRes.ok) {
      this.logger.warn(`Could not fetch recording ${recordingSid}: ${audioRes.status}`);
      return;
    }
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    // OpenAI Whisper transcription (multipart upload)
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), `${recordingSid}.mp3`);
    form.append('model', 'whisper-1');
    const trRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
      signal: AbortSignal.timeout(120000),
    });
    if (!trRes.ok) {
      this.logger.warn(`Whisper transcription failed (${trRes.status}): ${await trRes.text()}`);
      return;
    }
    const { text } = (await trRes.json()) as { text: string };
    if (!text?.trim()) return;

    const call = await this.prisma.callLog.findUnique({
      where: { twilioCallSid: callSid },
      select: { id: true, leadId: true },
    });
    if (!call) return;

    await this.prisma.callLog.update({
      where: { id: call.id },
      data: { transcript: text },
    });
    this.logger.log(`📝 Transcribed ${callSid} (${text.length} chars)`);

    // Reuse the existing CAMP extraction (generic over any call transcript)
    if (call.leadId) {
      await this.callsService.processSmrtPhoneTranscript(call.leadId, text);
    }
  }

  /** Stream a Twilio recording through our credentials so the browser can play it. */
  async fetchRecordingMedia(
    recordingSid: string,
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    if (!accountSid || !authToken || !recordingSid) return null;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      this.logger.warn(`Recording media fetch failed for ${recordingSid}: ${res.status}`);
      return null;
    }
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'audio/mpeg',
    };
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
