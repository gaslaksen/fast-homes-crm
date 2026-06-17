import { Logger } from '@nestjs/common';
import { Request } from 'express';
import Twilio from 'twilio';

const logger = new Logger('TwilioSignature');

/**
 * Validate an inbound Twilio webhook signature.
 *
 * Twilio signs the exact public URL it POSTed to. Behind a proxy (Railway),
 * Express may see http:// or a different host than Twilio used, so we try every
 * reasonable host/proto reconstruction and accept if ANY matches. This stays
 * cryptographically secure: each candidate still requires a valid HMAC computed
 * from TWILIO_AUTH_TOKEN, so a wrong guess can't pass.
 *
 * Bypassed only when TWILIO_AUTH_TOKEN is unset or TWILIO_VALIDATE_WEBHOOKS=false.
 */
export function isTwilioRequestValid(req: Request, params: Record<string, any>): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const validationEnabled =
    (process.env.TWILIO_VALIDATE_WEBHOOKS || 'true').toLowerCase() !== 'false';

  if (!authToken || !validationEnabled) {
    if (!authToken) {
      logger.warn('TWILIO_AUTH_TOKEN not set - skipping Twilio signature validation');
    }
    return true;
  }

  const signature = (req.headers['x-twilio-signature'] as string) || '';
  if (!signature) {
    logger.warn(`No X-Twilio-Signature header on ${req.originalUrl}`);
    return false;
  }

  const path = req.originalUrl;
  const host = req.get('host');
  const fwdProto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim();

  const bases = new Set<string>();
  const configured = process.env.TWILIO_WEBHOOK_BASE_URL;
  if (configured) bases.add(configured.replace(/\/+$/, ''));
  if (host) {
    bases.add(`https://${host}`);
    bases.add(`http://${host}`);
    if (fwdProto) bases.add(`${fwdProto}://${host}`);
    if (req.protocol) bases.add(`${req.protocol}://${host}`);
  }

  for (const base of bases) {
    if (Twilio.validateRequest(authToken, signature, `${base}${path}`, params || {})) {
      return true;
    }
  }

  logger.warn(`🚫 Invalid Twilio signature for ${path} (tried ${bases.size} URL variants)`);
  return false;
}
