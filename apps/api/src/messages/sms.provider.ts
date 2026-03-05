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

    const response = await fetch('https://api.smrtphone.io/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, from: from || this.phoneNumber, text: body }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Smrtphone API error ${response.status}: ${text}`);
    }

    const data: any = await response.json();
    return { sid: data.messageId || data.id || 'smrtphone-sent' };
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
