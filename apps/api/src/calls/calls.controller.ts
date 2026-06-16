import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Headers,
  Req,
  Res,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import Twilio from 'twilio';
import { CallsService } from './calls.service';
import { TwilioVoiceService } from './twilio-voice.service';
import { InitiateCallDto } from './dto/initiate-call.dto';

@Controller('calls')
export class CallsController {
  private readonly logger = new Logger(CallsController.name);

  constructor(
    private callsService: CallsService,
    private twilioVoiceService: TwilioVoiceService,
  ) {}

  @Post('ai-initiate')
  async initiateAiCall(@Body() dto: InitiateCallDto) {
    return this.callsService.initiateAiCall(dto.leadId);
  }

  @Post('vapi-webhook')
  async vapiWebhook(@Body() body: any) {
    return this.callsService.handleWebhookEvent(body);
  }

  // ─── Twilio browser dialer ────────────────────────────────────────────────

  /** Mint a Voice access token for the logged-in user's browser softphone. */
  @Post('twilio/token')
  async twilioToken(@Headers('authorization') authHeader?: string) {
    const { userId } = this.decodeToken(authHeader);
    if (!userId) {
      return { configured: false, error: 'Not authenticated' };
    }
    if (!this.twilioVoiceService.isConfigured()) {
      return { configured: false };
    }
    return { configured: true, ...this.twilioVoiceService.generateToken(userId) };
  }

  /**
   * TwiML App Voice webhook. Twilio POSTs here when the browser places a call;
   * we return the <Dial> that connects to the seller. Called by Twilio, not the UI.
   */
  @Post('twilio/voice')
  @HttpCode(200)
  async twilioVoice(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!this.verifyTwilioSignature(req, body)) {
      res.status(403).send('Invalid Twilio signature');
      return;
    }
    const twiml = await this.twilioVoiceService.generateDialTwiml(body);
    res.set('Content-Type', 'text/xml');
    res.send(twiml);
  }

  /** Call status + Dial action callback. */
  @Post('twilio/status')
  @HttpCode(200)
  async twilioStatus(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (this.verifyTwilioSignature(req, body)) {
      await this.twilioVoiceService.handleStatusCallback(body);
    }
    // Twilio expects TwiML (empty = nothing further to do on this leg)
    res.set('Content-Type', 'text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }

  /** Recording status callback. */
  @Post('twilio/recording')
  @HttpCode(200)
  async twilioRecording(@Body() body: any, @Req() req: Request) {
    if (this.verifyTwilioSignature(req, body)) {
      await this.twilioVoiceService.handleRecordingCallback(body);
    }
    return { received: true };
  }

  /** Post-call disposition from the agent. */
  @Post('twilio/disposition')
  async twilioDisposition(
    @Body() body: { callSid: string; disposition: string; notes?: string },
    @Headers('authorization') authHeader?: string,
  ) {
    const { userId } = this.decodeToken(authHeader);
    if (!userId) return { success: false, error: 'Not authenticated' };
    await this.twilioVoiceService.setDisposition(
      body.callSid,
      body.disposition,
      body.notes,
    );
    return { success: true };
  }

  /** Recent dialer calls for the Recents tab. */
  @Get('twilio/recents')
  async twilioRecents(@Query('limit') limit?: string) {
    const calls = await this.twilioVoiceService.recentCalls(
      limit ? parseInt(limit, 10) : 25,
    );
    return { calls };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private decodeToken(authHeader?: string): { userId?: string; organizationId?: string } {
    try {
      const token = authHeader?.replace('Bearer ', '');
      return (jwt.decode(token) as any) || {};
    } catch {
      return {};
    }
  }

  private verifyTwilioSignature(req: Request, params: Record<string, any>): boolean {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const validationEnabled =
      (process.env.TWILIO_VALIDATE_WEBHOOKS || 'true').toLowerCase() !== 'false';
    if (!authToken || !validationEnabled) {
      if (!authToken) {
        this.logger.warn('TWILIO_AUTH_TOKEN not set — skipping Twilio voice signature validation');
      }
      return true;
    }
    const signature = (req.headers['x-twilio-signature'] as string) || '';
    const base = process.env.TWILIO_WEBHOOK_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const url = `${base}${req.originalUrl}`;
    const valid = Twilio.validateRequest(authToken, signature, url, params || {});
    if (!valid) {
      this.logger.warn(`🚫 Invalid Twilio signature for ${url}`);
    }
    return valid;
  }
}
