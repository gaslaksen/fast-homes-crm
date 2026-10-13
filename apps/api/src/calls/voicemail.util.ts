import * as fs from 'fs';
import * as path from 'path';
import Twilio from 'twilio';
import { Brand, DIG_DEEPER_BRAND } from '../common/company.constants';
import { numberKey } from '../phone-numbers/phone-numbers.service';

type VoiceResponse = InstanceType<typeof Twilio.twiml.VoiceResponse>;

/**
 * The voicemail a caller reaches when nobody answers one of our numbers.
 *
 * Keyed by the number they dialled, not by who is calling: a claimant who
 * rings the D.I.G. Deeper line must hear D.I.G. Deeper, whatever lead they
 * turn out to be. A number with no entry here keeps the old behavior (the
 * call ends when nobody answers).
 */
export interface VoicemailGreeting {
  brand: Brand;
  /**
   * The recorded greeting, a file in apps/api/assets/voicemail. Played when
   * the file is there; until then Twilio reads `fallbackText` aloud.
   */
  audioFile: string;
  fallbackText: string;
  /** Env var listing who is emailed about a new voicemail (comma-separated). */
  notifyToEnv: string;
  notifyToDefault: string;
}

export const VOICEMAIL_GREETINGS: VoicemailGreeting[] = [
  {
    brand: DIG_DEEPER_BRAND,
    audioFile: 'digdeeper.mp3',
    // Spelled out so text to speech says the letters rather than "dig".
    fallbackText:
      'Thank you for calling D. I. G. Deeper. We help people recover unclaimed money that belongs to them. ' +
      "We're helping someone else right now, so please leave your name, your phone number, and the " +
      "reference number from your letter if you have one, and we'll call you back as soon as possible. " +
      'Our hours are Monday through Friday, 9 to 6 Eastern. Talk soon!',
    // Same inbox the digdeeperllc.com call-back form reports to.
    notifyToEnv: 'DIGDEEPER_INQUIRY_NOTIFY_TO',
    notifyToDefault: 'deals@digdeeperllc.com',
  },
];

/** Longest message a caller can leave, in seconds. */
export const VOICEMAIL_MAX_SECONDS = 180;

export function voicemailGreetingFor(dialled?: string | null): VoicemailGreeting | null {
  const key = numberKey(dialled || '');
  if (key.length !== 10) return null;
  return VOICEMAIL_GREETINGS.find((g) => numberKey(g.brand.phoneE164) === key) || null;
}

/** Only files a greeting names are ever served, so the route cannot read anything else. */
export function voicemailAudioPath(file: string): string | null {
  if (!VOICEMAIL_GREETINGS.some((g) => g.audioFile === file)) return null;
  // The API runs from apps/api in both the Docker image and `pnpm dev`.
  const full = path.resolve(process.cwd(), 'assets', 'voicemail', file);
  return fs.existsSync(full) ? full : null;
}

/**
 * Append the greeting and the <Record> to a response. Every URL here must be
 * absolute and `apiBase` must be set: a <Record> with no action makes Twilio
 * re-request the current document, which would play the greeting again.
 */
export function appendVoicemailTwiml(
  response: VoiceResponse,
  greeting: VoicemailGreeting,
  apiBase: string,
): void {
  if (voicemailAudioPath(greeting.audioFile)) {
    response.play(`${apiBase}/calls/twilio/voicemail/greeting/${greeting.audioFile}`);
  } else {
    response.say({ voice: 'Polly.Joanna-Neural' }, greeting.fallbackText);
  }

  response.record({
    action: `${apiBase}/calls/twilio/voicemail/done`,
    method: 'POST',
    maxLength: VOICEMAIL_MAX_SECONDS,
    timeout: 6,
    playBeep: true,
    finishOnKey: '#',
    trim: 'trim-silence',
    recordingStatusCallback: `${apiBase}/calls/twilio/voicemail/recording`,
    recordingStatusCallbackMethod: 'POST',
    recordingStatusCallbackEvent: ['completed'],
  });

  // Only reached when nothing was recorded: Twilio skips the action and
  // carries on with the next verb.
  response.say({ voice: 'Polly.Joanna-Neural' }, 'We did not get a message. Goodbye.');
  response.hangup();
}
