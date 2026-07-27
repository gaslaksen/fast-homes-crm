import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Safety Guard — blocks SMS sends when TEST_MODE is enabled
// ---------------------------------------------------------------------------
const safetyLogger = new Logger('SmsSafetyGuard');

export function checkSmsAllowed(
  to: string,
  config: ConfigService,
): { allowed: boolean; reason?: string } {
  const testMode =
    (config.get<string>('SMS_TEST_MODE', 'false')).toLowerCase() === 'true';

  if (!testMode) {
    return { allowed: true };
  }

  const rawList = config.get<string>('SMS_ALLOWED_NUMBERS', '');
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
      `🚫 TEST_MODE: Blocked SMS to ${to} - not in allowed list. Add to SMS_ALLOWED_NUMBERS or set SMS_TEST_MODE=false`,
    );
    return { allowed: false, reason: `TEST_MODE active - ${to} not in SMS_ALLOWED_NUMBERS` };
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
  private readonly defaultFrom: string;
  private readonly statusCallback?: string;

  constructor(
    accountSid: string,
    authToken: string,
    private readonly config?: ConfigService,
  ) {
    this.client = Twilio(accountSid, authToken);
    this.defaultFrom = config?.get<string>('TWILIO_PHONE_NUMBER') || '';
    // Delivery receipts: Twilio POSTs status updates here (e.g. https://<api>/webhooks/twilio/status)
    this.statusCallback = config?.get<string>('TWILIO_STATUS_CALLBACK_URL');
  }

  isConfigured() {
    return !!this.client;
  }

  async sendSms(to: string, from: string, body: string): Promise<{ sid: string }> {
    // Safety guard - respect TEST_MODE allowlist before any outbound send
    if (this.config) {
      const check = checkSmsAllowed(to, this.config);
      if (!check.allowed) {
        return { sid: `BLOCKED_TEST_MODE_${Date.now()}` };
      }
    }

    const msg = await this.client.messages.create({
      body,
      from: from || this.defaultFrom,
      to,
      ...(this.statusCallback ? { statusCallback: this.statusCallback } : {}),
    });
    this.logger.log(`✅ Twilio SMS sent to ${to} - sid=${msg.sid} status=${msg.status}`);
    return { sid: msg.sid };
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

  const logBootIdentity = (providerName: string) => {
    const dbHost = (() => {
      try {
        return new URL(config.get<string>('DATABASE_URL') || '').host;
      } catch {
        return 'unknown';
      }
    })();
    logger.log(
      `🪪 SMS provider boot: provider=${providerName} ` +
        `host=${os.hostname()} pid=${process.pid} ` +
        `nodeEnv=${config.get<string>('NODE_ENV') ?? 'unset'} ` +
        `railwayService=${process.env.RAILWAY_SERVICE_NAME ?? 'n/a'} ` +
        `railwayEnv=${process.env.RAILWAY_ENVIRONMENT ?? 'n/a'} ` +
        `dbHost=${dbHost}`,
    );
  };

  const twilioSid = config.get<string>('TWILIO_ACCOUNT_SID');
  const twilioToken = config.get<string>('TWILIO_AUTH_TOKEN');

  const testMode = (config.get<string>('SMS_TEST_MODE', 'false')).toLowerCase() === 'true';
  if (testMode) {
    logger.warn('🔒 SMS_TEST_MODE=true - SMS sends restricted to SMS_ALLOWED_NUMBERS');
  }

  if (twilioSid && twilioToken) {
    logger.log('📞 Using Twilio SMS provider');
    logBootIdentity('TwilioSmsProvider');
    return new TwilioSmsProvider(twilioSid, twilioToken, config);
  }

  // No real provider configured. This is the misconfig that caused the
  // 04/07/2026 incident: an orphan Railway service (`fast-homes-crm`) deployed
  // from the same repo with only DATABASE_URL set fell through to the
  // simulator, then raced the real `@fast-homes/api` service for campaign
  // enrollments and won most of them, so real SMS was never delivered.
  // The earlier `NODE_ENV === 'production'` gate didn't catch it because the
  // orphan had NODE_ENV unset. Now we always crash unless ALLOW_SIMULATED_SMS
  // is explicitly set, regardless of NODE_ENV.
  const allowSimulated = (config.get<string>('ALLOW_SIMULATED_SMS') || '').toLowerCase() === 'true';

  if (!allowSimulated) {
    const msg =
      '❌ No SMS provider configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing). ' +
      'Refusing to start. Set the Twilio credentials, or set ALLOW_SIMULATED_SMS=true ' +
      'to explicitly opt in to the simulator (dev only).';
    logger.error(msg);
    throw new Error(msg);
  }

  logger.warn(
    '⚠️  ALLOW_SIMULATED_SMS=true — using SimulatedSmsProvider. ' +
      'Real SMS will NOT be delivered.',
  );
  logBootIdentity('SimulatedSmsProvider');
  return new SimulatedSmsProvider();
}
