import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Safety Guard — blocks SMS sends when TEST_MODE is enabled
// ---------------------------------------------------------------------------
const safetyLogger = new Logger('SmsSafetyGuard');

export function checkSmsAllowed(
  to: string,
  config: ConfigService,
): { allowed: boolean; reason?: string } {
  const testMode = config.get<string>('SMRTPHONE_TEST_MODE', 'false').toLowerCase() === 'true';

  if (!testMode) {
    return { allowed: true };
  }

  const rawList = config.get<string>('SMRTPHONE_ALLOWED_NUMBERS', '');
  const allowedNumbers = rawList
    .split(',')
    .map((n) => n.trim().replace(/\D/g, ''))
    .filter(Boolean);

  const normalizedTo = to.replace(/\D/g, '');

  // Match last 10 digits to handle +1 prefix differences
  const isAllowed = allowedNumbers.some(
    (n) => normalizedTo.endsWith(n.slice(-10)) || n.endsWith(normalizedTo.slice(-10)),
  );

  if (!isAllowed) {
    safetyLogger.warn(
      `🚫 TEST_MODE: Blocked SMS to ${to} — not in allowed list. Add to SMRTPHONE_ALLOWED_NUMBERS or set SMRTPHONE_TEST_MODE=false`,
    );
    return { allowed: false, reason: `TEST_MODE active — ${to} not in SMRTPHONE_ALLOWED_NUMBERS` };
  }

  safetyLogger.log(`✅ TEST_MODE: Allowed SMS to ${to}`);
  return { allowed: true };
}
import Twilio from 'twilio';

export interface SmsProvider {
  sendSms(to: string, from: string, body: string): Promise<{ sid: string }>;
  isConfigured(): boolean;
}

// ---------------------------------------------------------------------------
// Twilio
// ---------------------------------------------------------------------------
export class TwilioSmsProvider implements SmsProvider {
  private client: Twilio.Twilio;
  private readonly logger = new Logger(TwilioSmsProvider.name);

  constructor(accountSid: string, authToken: string) {
    this.client = Twilio(accountSid, authToken);
  }

  isConfigured() {
    return !!this.client;
  }

  async sendSms(to: string, from: string, body: string): Promise<{ sid: string }> {
    const msg = await this.client.messages.create({ body, from, to });
    return { sid: msg.sid };
  }
}

// ---------------------------------------------------------------------------
// Smrtphone
// ---------------------------------------------------------------------------
export class SmrtphoneSmsProvider implements SmsProvider {
  private readonly logger = new Logger(SmrtphoneSmsProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly phoneNumber: string,
    private readonly config?: ConfigService,
  ) {}

  isConfigured() {
    return !!this.apiKey;
  }

  async sendSms(to: string, from: string, body: string): Promise<{ sid: string }> {
    // Safety guard — respect TEST_MODE allowlist before any outbound send
    if (this.config) {
      const check = checkSmsAllowed(to, this.config);
      if (!check.allowed) {
        return { sid: `BLOCKED_TEST_MODE_${Date.now()}` };
      }
    }

    const fromNumber = from || this.phoneNumber;

    // SmrtPhone API: https://phone.smrt.studio/sms/send
    // Auth: X-Auth-smrtPhone header
    // Body: application/x-www-form-urlencoded  (from, to, message)
    const params = new URLSearchParams({
      from: fromNumber,
      to,
      message: body,
    });

    let response: Response;
    try {
      response = await fetch('https://phone.smrt.studio/sms/send', {
        method: 'POST',
        headers: {
          'X-Auth-smrtPhone': this.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(10000),
      });
    } catch (fetchErr: any) {
      this.logger.warn(`⚠️  SmrtPhone unreachable (${fetchErr.message}) — simulating send locally`);
      this.logger.log(`📱 [SIMULATED SMS] To: ${to} | "${body.substring(0, 80)}"`);
      return { sid: `SIMULATED_OFFLINE_${Date.now()}` };
    }

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`SmrtPhone API error ${response.status}: ${responseText}`);
    }

    this.logger.log(`✅ SmrtPhone SMS sent to ${to} — response: ${responseText.substring(0, 100)}`);

    // SmrtPhone returns plain text or a message ID — extract if present
    let sid = 'smrtphone-sent';
    try {
      const data = JSON.parse(responseText);
      sid = data.messageId || data.id || data.smsId || sid;
    } catch {
      // Plain text response — use it as the SID if it looks like an ID
      if (responseText && responseText.length < 100 && !responseText.includes(' ')) {
        sid = responseText.trim();
      }
    }

    return { sid };
  }
}

// ---------------------------------------------------------------------------
// Simulated (dev / no credentials)
// ---------------------------------------------------------------------------
export class SimulatedSmsProvider implements SmsProvider {
  private readonly logger = new Logger(SimulatedSmsProvider.name);

  isConfigured() {
    return true; // Always available as fallback
  }

  async sendSms(to: string, _from: string, body: string): Promise<{ sid: string }> {
    this.logger.log(`📱 [SIMULATED SMS] To: ${to} | "${body.substring(0, 80)}"`);
    return { sid: `SIMULATED_${Date.now()}` };
  }
}

// ---------------------------------------------------------------------------
// Factory — picks the right provider based on env config
// ---------------------------------------------------------------------------
export function createSmsProvider(config: ConfigService): SmsProvider {
  const logger = new Logger('SmsProviderFactory');

  const smrtphoneKey = config.get<string>('SMRTPHONE_API_KEY');
  const smrtphoneNumber = config.get<string>('SMRTPHONE_PHONE_NUMBER') || config.get<string>('TWILIO_PHONE_NUMBER') || '';

  if (smrtphoneKey) {
    logger.log('📞 Using Smrtphone SMS provider');
    const testMode = config.get<string>('SMRTPHONE_TEST_MODE', 'false');
    if (testMode.toLowerCase() === 'true') {
      logger.warn('🔒 SMRTPHONE_TEST_MODE=true — SMS sends restricted to SMRTPHONE_ALLOWED_NUMBERS');
    }
    return new SmrtphoneSmsProvider(smrtphoneKey, smrtphoneNumber, config);
  }

  const twilioSid = config.get<string>('TWILIO_ACCOUNT_SID');
  const twilioToken = config.get<string>('TWILIO_AUTH_TOKEN');

  if (twilioSid && twilioToken) {
    logger.log('📞 Using Twilio SMS provider');
    return new TwilioSmsProvider(twilioSid, twilioToken);
  }

  logger.warn('⚠️  No SMS provider configured — messages will be simulated');
  return new SimulatedSmsProvider();
}
