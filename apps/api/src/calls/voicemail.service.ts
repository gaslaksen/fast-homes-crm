import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { MailerService } from '../mailer/mailer.service';
import { prettyNumber } from '../phone-numbers/phone-numbers.service';
import { TwilioVoiceService } from './twilio-voice.service';
import { appendVoicemailTwiml, voicemailGreetingFor } from './voicemail.util';

const VoiceResponse = Twilio.twiml.VoiceResponse;

/** DialCallStatus values that mean somebody picked up. */
const ANSWERED = new Set(['completed', 'answered']);

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Voicemail on our inbound numbers.
 *
 * Flow:
 *  1. An inbound call rings the agents (TwilioVoiceService.generateIncomingTwiml).
 *     On a number with a greeting, the <Dial> action points here.
 *  2. Nobody answered: play the greeting and <Record>.
 *  3. Twilio posts the finished recording. The CallLog becomes a voicemail,
 *     then in the background it is transcribed and the team is told: push to
 *     everyone the call rang, and an email to the brand's inbox.
 *
 * A caller who matches a lead lands on that lead's thread as an unread inbound
 * item. One who matches nothing waits in the inbox's voicemail list until
 * someone dismisses it or attaches it to a lead.
 */
@Injectable()
export class VoicemailService {
  private readonly logger = new Logger(VoicemailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly twilioVoice: TwilioVoiceService,
    private readonly push: PushService,
    private readonly mailer: MailerService,
  ) {}

  /**
   * The <Dial> action for an inbound call on a number with a greeting. Keeps
   * the same CallLog bookkeeping as /calls/twilio/status, then sends an
   * unanswered caller to voicemail.
   */
  async afterDialTwiml(params: Record<string, string>): Promise<string> {
    await this.twilioVoice.handleStatusCallback(params);

    const response = new VoiceResponse();
    const apiBase = this.twilioVoice.callbackBase();
    const greeting = voicemailGreetingFor(params.To || params.to);
    if (!ANSWERED.has(params.DialCallStatus || '') && greeting && apiBase) {
      appendVoicemailTwiml(response, greeting, apiBase);
    }
    return response.toString();
  }

  /** The <Record> action: the caller finished (pressed #, went quiet, or hit the limit). */
  doneTwiml(): string {
    const response = new VoiceResponse();
    response.hangup();
    return response.toString();
  }

  /**
   * Recording status callback for a voicemail. Marks the CallLog as one and
   * stores the playback URL, then transcribes and notifies in the background
   * so Twilio gets its answer well inside its timeout.
   */
  async handleRecording(body: Record<string, string>): Promise<void> {
    const callSid = body.CallSid || '';
    const recordingSid = body.RecordingSid || '';
    if (!callSid || !recordingSid) return;
    if ((body.RecordingStatus || 'completed') !== 'completed') return;

    const seconds = parseInt(body.RecordingDuration || '', 10);
    if (Number.isFinite(seconds) && seconds < 1) {
      this.logger.log(`Voicemail on ${callSid} was empty, ignoring`);
      return;
    }

    const call = await this.prisma.callLog.findUnique({
      where: { twilioCallSid: callSid },
      select: { id: true },
    });
    if (!call) {
      // The inbound webhook opens this row before the call rings, so this
      // only happens if that write failed. The recording is still in Twilio.
      this.logger.error(`Voicemail ${recordingSid} for ${callSid} has no CallLog, not stored`);
      return;
    }

    await this.prisma.callLog.update({
      where: { id: call.id },
      data: {
        voicemail: true,
        status: 'completed',
        endedReason: 'voicemail',
        recordingUrl: this.twilioVoice.recordingPlaybackUrl(recordingSid, body.RecordingUrl),
        // The length of the message, which is what anyone looking at a
        // voicemail wants to know.
        ...(Number.isFinite(seconds) ? { duration: seconds } : {}),
      },
    });
    this.logger.log(`📼 Voicemail stored for ${callSid} (recordingSid=${recordingSid})`);

    setImmediate(() => {
      this.transcribeAndNotify(call.id, recordingSid).catch((err) =>
        this.logger.error(`Voicemail follow-up failed for ${callSid}: ${err.message}`),
      );
    });
  }

  private async transcribeAndNotify(callLogId: string, recordingSid: string): Promise<void> {
    // A missing transcript must not cost the alert: the team still needs to
    // know someone left a message.
    const transcript = await this.twilioVoice.transcribeRecording(recordingSid).catch((err) => {
      this.logger.warn(`Voicemail transcription failed for ${recordingSid}: ${err.message}`);
      return null;
    });
    if (transcript) {
      await this.prisma.callLog.update({ where: { id: callLogId }, data: { transcript } });
    }

    const call = await this.prisma.callLog.findUnique({
      where: { id: callLogId },
      select: {
        fromNumber: true,
        toNumber: true,
        duration: true,
        createdAt: true,
        lead: {
          select: {
            id: true,
            organizationId: true,
            assignedToUserId: true,
            sellerFirstName: true,
            sellerLastName: true,
            propertyAddress: true,
          },
        },
      },
    });
    if (!call) return;

    const lead = call.lead;
    const caller = prettyNumber(call.fromNumber || '') || call.fromNumber || 'an unknown number';
    const preview = `Voicemail: ${transcript || '(no transcript)'}`;

    if (lead) {
      // Same summary an inbound text writes, so the voicemail shows as the
      // newest unread item on the lead's thread and in the daily brief.
      await this.prisma.lead
        .update({
          where: { id: lead.id },
          data: {
            lastMessageAt: new Date(),
            lastMessagePreview: preview.slice(0, 160),
            lastMessageDirection: 'INBOUND',
            threadUnread: true,
          },
        })
        .catch((err) => this.logger.warn(`Thread summary for ${lead.id} not updated: ${err.message}`));
      await this.push.notifyNewMessage(lead, preview);
    } else {
      await this.push.notifyUsers(await this.twilioVoice.ringIdentities(), {
        title: `Voicemail from ${caller}`,
        body: transcript
          ? transcript.length > 140
            ? `${transcript.slice(0, 139)}…`
            : transcript
          : 'Open the Dealcore inbox to listen.',
        data: { type: 'voicemail' },
      });
    }

    await this.emailTeam({ ...call, caller, transcript }).catch((err) =>
      this.logger.error(`Voicemail email failed for call ${callLogId}: ${err.message}`),
    );
  }

  private async emailTeam(vm: {
    caller: string;
    toNumber: string | null;
    duration: number | null;
    createdAt: Date;
    transcript: string | null;
    lead: { id: string; sellerFirstName: string | null; sellerLastName: string | null; propertyAddress: string } | null;
  }): Promise<void> {
    const greeting = voicemailGreetingFor(vm.toNumber);
    if (!greeting) return;
    const to = (this.config.get<string>(greeting.notifyToEnv) || '').trim() || greeting.notifyToDefault;

    const frontend = (this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000').replace(/\/+$/, '');
    const link = vm.lead ? `${frontend}/inbox?lead=${vm.lead.id}` : `${frontend}/inbox`;
    const leadName = vm.lead
      ? `${vm.lead.sellerFirstName || ''} ${vm.lead.sellerLastName || ''}`.trim() || vm.lead.propertyAddress
      : null;

    const rows: [string, string][] = [
      ['From', vm.caller],
      ['Lead', leadName || 'No lead on file for this number'],
      ['Line', `${greeting.brand.companyName} ${greeting.brand.phone}`],
      ['Length', vm.duration != null ? `${vm.duration}s` : 'unknown'],
      ['Received', vm.createdAt.toISOString()],
      ['Message', vm.transcript || 'No transcript. Listen in Dealcore.'],
    ];

    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#222;">
<p><strong>New voicemail on the ${escapeHtml(greeting.brand.companyName)} line</strong></p>
<table cellpadding="6" style="border-collapse:collapse;">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="color:#666;vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td><td>${escapeHtml(v).replace(/\n/g, '<br>')}</td></tr>`,
  )
  .join('\n')}
</table>
<p><a href="${escapeHtml(link)}">Listen in Dealcore</a></p>
<p style="color:#666;font-size:13px;">The transcript is machine-made. Check names and numbers against the recording.</p>
</body></html>`;
    const text = [...rows.map(([k, v]) => `${k}: ${v}`), '', `Listen: ${link}`].join('\n');

    await this.mailer.sendInternalHtml({
      to,
      subject: `Voicemail from ${leadName || vm.caller}`,
      html,
      text,
      tags: ['voicemail', greeting.brand.key],
    });
  }
}
