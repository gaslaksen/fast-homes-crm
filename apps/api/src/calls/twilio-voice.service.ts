import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';
import { PrismaService } from '../prisma/prisma.service';
import { CallsService } from './calls.service';
import { formatPhoneNumber } from '@fast-homes/shared';
import { PhoneNumbersService } from '../phone-numbers/phone-numbers.service';

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
 * Entirely dormant until TWILIO_API_KEY_SID / SECRET / TWIML_APP_SID are set.
 */
@Injectable()
export class TwilioVoiceService {
  private readonly logger = new Logger(TwilioVoiceService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => CallsService))
    private readonly callsService: CallsService,
    private readonly phoneNumbers: PhoneNumbersService,
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

  /**
   * Mint a Voice access token. identity = userId.
   *
   * For `platform === 'ios'` we attach the APNs VoIP push credential so the
   * mobile SDK can register for incoming calls (Twilio sends a VoIP push that
   * the Twilio Voice RN SDK turns into a CallKit ring). The browser path omits
   * it and relies on `incomingAllow` for WebRTC.
   */
  generateToken(
    identity: string,
    platform?: string,
  ): { token: string; identity: string } {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const apiKeySid = this.config.get<string>('TWILIO_API_KEY_SID');
    const apiKeySecret = this.config.get<string>('TWILIO_API_KEY_SECRET');
    const twimlAppSid = this.config.get<string>('TWILIO_TWIML_APP_SID');

    if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
      throw new Error(
        'Twilio Voice not configured (need TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID)',
      );
    }

    // Token TTL: 1 hour. Clients refresh via the SDK's tokenWillExpire event.
    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity,
      ttl: 3600,
    });

    const pushCredentialSid = this.config.get<string>(
      'TWILIO_APN_PUSH_CREDENTIAL_SID',
    );

    token.addGrant(
      new VoiceGrant({
        outgoingApplicationSid: twimlAppSid,
        incomingAllow: true,
        ...(platform === 'ios' && pushCredentialSid ? { pushCredentialSid } : {}),
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

    const to = formatPhoneNumber(params.To || params.to || '');
    const callSid = params.CallSid || '';
    const leadId = params.leadId || params.LeadId || null;
    // From looks like "client:<userId>" for browser-originated calls
    const userId = (params.From || '').replace(/^client:/, '') || null;

    // The browser sends the caller ID it picked. Never trust it directly: an
    // arbitrary value here would let the client spoof any number on the
    // account, so resolve it against the configured allowlist.
    const callerId = await this.resolveCallerId(params.callerId || params.CallerId);

    if (!to || !callerId) {
      this.logger.warn(
        `Twilio voice webhook missing ${!to ? 'To' : 'callerId'}, rejecting call`,
      );
      response.say('We could not place this call. Please try again.');
      return response.toString();
    }

    const conferenceName = this.conferenceNameFor(callSid);

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
            conferenceName,
          },
          update: { status: 'in-progress', toNumber: to, conferenceName },
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

    // Dial the seller immediately, as an independent leg that joins the same
    // conference.
    //
    // An earlier version deferred this to the conference-status webhook so the
    // seller could be added with earlyMedia (which gives true ringback). That
    // made placing a call depend on an inbound webhook arriving, and when it
    // did not, the call silently did nothing at all. Dialling here instead
    // means a call either connects or fails loudly. Ringback is handled by
    // waitUrl below.
    try {
      await this.client().calls.create({
        to,
        from: callerId,
        twiml: this.participantTwiml(conferenceName, 'customer'),
        statusCallback: apiBase ? `${apiBase}/calls/twilio/status` : undefined,
        statusCallbackMethod: 'POST',
        statusCallbackEvent: ['completed'],
      });
    } catch (err: any) {
      this.logger.error(`Failed to dial ${to} for ${callSid}: ${err.message}`);
      response.say('We could not reach that number. Please try again.');
      return response.toString();
    }

    const dial = response.dial({
      // Agent leg joins with no caller ID of its own; the seller's leg carries
      // the outbound caller ID.
      action: apiBase ? `${apiBase}/calls/twilio/status` : undefined,
      method: 'POST',
    });
    dial.conference(
      {
        participantLabel: 'agent',
        startConferenceOnEnter: true,
        // Left false so a warm transfer can drop the agent without killing the
        // call. A normal hangup is covered by the seller's endConferenceOnExit.
        endConferenceOnExit: false,
        beep: 'false',
        // What the agent hears while the seller's phone rings. Twilio's default
        // here is hold music, which does not sound like placing a call, so this
        // points at a ring tone instead. GET lets Twilio cache the file rather
        // than refetch it on every call.
        ...(this.ringbackUrl()
          ? { waitUrl: this.ringbackUrl(), waitMethod: 'GET' as const }
          : {}),
        ...(apiBase
          ? {
              statusCallback: `${apiBase}/calls/twilio/conference-status`,
              statusCallbackMethod: 'POST' as const,
              statusCallbackEvent: ['start', 'end'],
            }
          : {}),
        ...(recordCalls
          ? {
              record: 'record-from-start' as const,
              recordingStatusCallback: apiBase ? `${apiBase}/calls/twilio/recording` : undefined,
              recordingStatusCallbackMethod: 'POST' as const,
            }
          : {}),
      },
      conferenceName,
    );

    return response.toString();
  }

  /**
   * Conference status webhook. Bookkeeping only.
   *
   * The seller is dialled up front in generateDialTwiml, not from here. An
   * earlier version added them on `conference-start` so they could join with
   * earlyMedia, but that made every outbound call depend on this webhook
   * arriving, and a call that never dialled gave no visible error at all.
   */
  async handleConferenceStatus(params: Record<string, string>): Promise<void> {
    const event = params.StatusCallbackEvent || '';
    const conferenceName = params.FriendlyName || '';
    if (!conferenceName) return;

    if (event === 'conference-end') {
      await this.prisma.callLog
        .updateMany({ where: { conferenceName }, data: { status: 'completed' } })
        .catch((err) =>
          this.logger.warn(`Failed to close out ${conferenceName}: ${err.message}`),
        );
    }
  }

  // ── Conference helpers ────────────────────────────────────────────────────

  private client() {
    return Twilio(
      this.config.get<string>('TWILIO_ACCOUNT_SID'),
      this.config.get<string>('TWILIO_AUTH_TOKEN'),
    );
  }

  /** Conference name derived from the agent leg's CallSid, so the browser only
   *  ever has to send its own CallSid to address the call. */
  private conferenceNameFor(callSid: string): string {
    return `dc-${callSid}`;
  }

  /**
   * Audio the agent hears while the seller's phone rings.
   *
   * Defaults to the ring tone this API serves, because Twilio's built-in
   * conference wait audio is hold music, which does not sound like placing a
   * call. TWILIO_RINGBACK_URL overrides it with any URL returning audio or
   * TwiML.
   */
  private ringbackUrl(): string {
    const override = (this.config.get<string>('TWILIO_RINGBACK_URL') || '').trim();
    if (override) return override;
    const apiBase = this.callbackBase();
    return apiBase ? `${apiBase}/calls/twilio/ringback.wav` : '';
  }

  /** TwiML for a leg that joins an existing conference. */
  private participantTwiml(conferenceName: string, label: string): string {
    const vr = new VoiceResponse();
    const dial = vr.dial();
    dial.conference(
      {
        participantLabel: label,
        startConferenceOnEnter: true,
        // Seller hangs up -> the call is over, including any consult leg.
        endConferenceOnExit: true,
        beep: 'false',
      },
      conferenceName,
    );
    return vr.toString();
  }


  /**
   * Outbound caller IDs the dialer may present. Delegates to PhoneNumbersService
   * so voice and SMS share one list, managed in Settings > Phone Numbers.
   */
  async listCallerIds(): Promise<{ number: string; label: string }[]> {
    const list = await this.phoneNumbers.list({ channel: 'voice' });
    return list.map((n) => ({ number: n.number, label: n.label }));
  }

  /**
   * Validate a client-supplied caller ID against the allowlist.
   *
   * Falls back to TWILIO_PHONE_NUMBER if the lookup itself fails. Placing a
   * call must never depend on a database read succeeding: an unhandled throw
   * here returns no TwiML to Twilio, and the call dies before it dials.
   */
  private async resolveCallerId(requested?: string): Promise<string> {
    try {
      return await this.phoneNumbers.resolve(requested, 'voice');
    } catch (err: any) {
      const fallback = this.config.get<string>('TWILIO_PHONE_NUMBER') || '';
      this.logger.error(
        `Caller ID lookup failed (${err.message}); falling back to ${fallback || 'no number'}`,
      );
      return fallback;
    }
  }

  /** Look up the live conference for an agent call, or null if it has ended. */
  private async findConference(callSid: string) {
    const friendlyName = this.conferenceNameFor(callSid);
    const list = await this.client().conferences.list({
      friendlyName,
      status: 'in-progress',
      limit: 1,
    });
    return list[0] ?? null;
  }

  /** Put the seller on hold (or take them off). */
  async setHold(callSid: string, hold: boolean): Promise<{ ok: boolean }> {
    const conf = await this.findConference(callSid);
    if (!conf) throw new Error('Call is no longer active');
    await this.client()
      .conferences(conf.sid)
      .participants('customer')
      .update({ hold });
    this.logger.log(`${hold ? '⏸' : '▶️'} Hold=${hold} for call ${callSid}`);
    return { ok: true };
  }

  /**
   * Blind transfer: dial the target into the conference and drop the agent
   * immediately. The seller hears ringing until the target picks up.
   */
  async blindTransfer(callSid: string, rawTo: string): Promise<{ ok: boolean }> {
    const to = formatPhoneNumber(rawTo || '');
    if (!to) throw new Error('A transfer destination is required');

    const conf = await this.findConference(callSid);
    if (!conf) throw new Error('Call is no longer active');

    const callerId = await this.resolveCallerId();
    const client = this.client();

    await client.conferences(conf.sid).participants.create({
      to,
      from: callerId,
      label: 'consult',
      earlyMedia: true,
      endConferenceOnExit: true,
    });

    await this.dropAgent(conf.sid);
    await this.markTransfer(callSid, 'transferred', to);

    this.logger.log(`➡️  Blind transfer of ${callSid} to ${to}`);
    return { ok: true };
  }

  /**
   * Warm transfer step 1: hold the seller and dial the target so the agent can
   * brief them privately. Both agent and target stay in the conference; the
   * seller is on hold and hears nothing.
   */
  async startWarmTransfer(callSid: string, rawTo: string): Promise<{ ok: boolean }> {
    const to = formatPhoneNumber(rawTo || '');
    if (!to) throw new Error('A transfer destination is required');

    const conf = await this.findConference(callSid);
    if (!conf) throw new Error('Call is no longer active');

    const client = this.client();
    await client.conferences(conf.sid).participants('customer').update({ hold: true });
    await client.conferences(conf.sid).participants.create({
      to,
      from: await this.resolveCallerId(),
      label: 'consult',
      earlyMedia: true,
      endConferenceOnExit: false,
    });

    await this.markTransfer(callSid, 'warm_consulting', to);
    this.logger.log(`🤝 Warm transfer consult started for ${callSid} to ${to}`);
    return { ok: true };
  }

  /**
   * Warm transfer step 2a: hand off. Take the seller off hold, make the target
   * the party whose exit ends the call, and drop the agent.
   */
  async completeWarmTransfer(callSid: string): Promise<{ ok: boolean }> {
    const conf = await this.findConference(callSid);
    if (!conf) throw new Error('Call is no longer active');

    const client = this.client();
    await client.conferences(conf.sid).participants('consult').update({ endConferenceOnExit: true });
    await client.conferences(conf.sid).participants('customer').update({ hold: false });
    await this.dropAgent(conf.sid);

    const log = await this.prisma.callLog.findUnique({ where: { twilioCallSid: callSid } });
    await this.markTransfer(callSid, 'transferred', log?.transferTo ?? null);

    this.logger.log(`✅ Warm transfer of ${callSid} completed`);
    return { ok: true };
  }

  /**
   * Warm transfer step 2b: back out. Drop the target and return the seller to
   * the agent.
   */
  async cancelWarmTransfer(callSid: string): Promise<{ ok: boolean }> {
    const conf = await this.findConference(callSid);
    if (!conf) throw new Error('Call is no longer active');

    const client = this.client();
    try {
      await client.conferences(conf.sid).participants('consult').remove();
    } catch (err: any) {
      // Target may have already hung up; taking the seller off hold still matters.
      this.logger.warn(`Consult leg already gone for ${callSid}: ${err.message}`);
    }
    await client.conferences(conf.sid).participants('customer').update({ hold: false });

    await this.markTransfer(callSid, null, null);
    this.logger.log(`↩️  Warm transfer of ${callSid} cancelled`);
    return { ok: true };
  }

  /** Remove the agent without ending the conference. */
  private async dropAgent(conferenceSid: string) {
    const client = this.client();
    try {
      await client.conferences(conferenceSid).participants('agent').remove();
    } catch (err: any) {
      this.logger.warn(`Could not drop agent from ${conferenceSid}: ${err.message}`);
    }
  }

  private async markTransfer(callSid: string, state: string | null, to: string | null) {
    await this.prisma.callLog
      .update({
        where: { twilioCallSid: callSid },
        data: { transferState: state, transferTo: to },
      })
      .catch((err) =>
        this.logger.warn(`Failed to record transfer state for ${callSid}: ${err.message}`),
      );
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
      await this.callsService.processCallTranscript(call.leadId, text);
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
