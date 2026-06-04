import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Verifies the shared-secret header on GHL webhook calls.
 *
 * Closercontrol configures their GHL webhook to include the header
 *   X-Dealcore-Webhook-Secret: <secret>
 * on every request. The expected value is read from GHL_WEBHOOK_SECRET env.
 *
 * If GHL_WEBHOOK_SECRET is unset, all requests are rejected. There is no
 * "dev mode bypass" - misconfiguration must fail closed.
 */
@Injectable()
export class GhlWebhookGuard implements CanActivate {
  private readonly logger = new Logger(GhlWebhookGuard.name);

  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('GHL_WEBHOOK_SECRET');
    if (!expected) {
      this.logger.warn('GHL_WEBHOOK_SECRET not configured - rejecting webhook');
      throw new UnauthorizedException('Webhook auth not configured');
    }

    const req = context.switchToHttp().getRequest();
    const got = (req.headers['x-dealcore-webhook-secret'] || req.headers['X-Dealcore-Webhook-Secret'] || '') as string;
    if (!got || got !== expected) {
      throw new UnauthorizedException('Invalid or missing webhook secret');
    }
    return true;
  }
}
