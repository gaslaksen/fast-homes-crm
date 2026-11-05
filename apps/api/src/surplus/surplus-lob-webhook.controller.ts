import { Body, Controller, Headers, HttpCode, Logger, Post, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { verifyLobSignature } from '../lob/lob.util';
import { SurplusPrintRunService } from './surplus-print-run.service';

/**
 * Lob's tracking webhooks, at https://api.mydealcore.com/webhooks/lob.
 *
 * Set up in the Lob dashboard (Webhooks), one per environment, each with its
 * own secret. LOB_WEBHOOK_SECRET holds the secret, or several separated by
 * commas when both the test and the live webhook point here. The signature
 * is checked against the raw body, which main.ts keeps (rawBody: true).
 */
@Controller('webhooks/lob')
export class SurplusLobWebhookController {
  private readonly logger = new Logger(SurplusLobWebhookController.name);

  constructor(
    private config: ConfigService,
    private printRun: SurplusPrintRunService,
  ) {}

  @Public()
  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('lob-signature') signature?: string,
    @Headers('lob-signature-timestamp') timestamp?: string,
  ) {
    const secrets = String(this.config.get<string>('LOB_WEBHOOK_SECRET') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!secrets.length) throw new ServiceUnavailableException('LOB_WEBHOOK_SECRET is not set');
    if (!secrets.some((secret) => verifyLobSignature(secret, timestamp, req.rawBody, signature))) {
      this.logger.warn('Lob webhook: signature did not match');
      throw new UnauthorizedException('bad signature');
    }
    try {
      const res = await this.printRun.applyLobEvent(body);
      return { received: true, ...res };
    } catch (err: any) {
      // A 500 makes Lob retry, which is what a database hiccup wants.
      this.logger.error(`Lob webhook ${body?.id || ''} failed: ${err?.message || err}`);
      throw err;
    }
  }
}
