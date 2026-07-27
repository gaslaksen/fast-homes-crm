import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  Headers,
  Req,
  Res,
  HttpCode,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { CallsService } from './calls.service';
import { TwilioVoiceService } from './twilio-voice.service';
import { InitiateCallDto } from './dto/initiate-call.dto';
import { isTwilioRequestValid } from '../webhooks/twilio-signature.util';
import { RINGBACK_WAV } from './ringback.util';

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

  /** Mint a Voice access token for the logged-in user (browser or mobile). */
  @Post('twilio/token')
  async twilioToken(
    @Headers('authorization') authHeader?: string,
    @Query('platform') platform?: string,
  ) {
    const { userId } = this.decodeToken(authHeader);
    if (!userId) {
      // 401 so the web client clears the stale session instead of showing "not configured"
      throw new UnauthorizedException('Not authenticated');
    }
    if (!this.twilioVoiceService.isConfigured()) {
      return { configured: false };
    }
    return {
      configured: true,
      ...this.twilioVoiceService.generateToken(userId, platform),
    };
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

  /**
   * Inbound call webhook. Point your Twilio number's Voice "A call comes in" at
   * https://<api>/calls/twilio/incoming. Rings the agents' browser dialers.
   */
  @Post('twilio/incoming')
  @HttpCode(200)
  async twilioIncoming(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!this.verifyTwilioSignature(req, body)) {
      res.status(403).send('Invalid Twilio signature');
      return;
    }
    const twiml = await this.twilioVoiceService.generateIncomingTwiml(body);
    res.set('Content-Type', 'text/xml');
    res.send(twiml);
  }

  /**
   * Conference status callback. Fires when the agent's conference starts, which
   * is when we ring the seller into it (that ordering is what gives the agent
   * real ringback rather than silence).
   */
  @Post('twilio/conference-status')
  @HttpCode(200)
  async twilioConferenceStatus(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!this.verifyTwilioSignature(req, body)) {
      res.status(403).send('Invalid Twilio signature');
      return;
    }
    await this.twilioVoiceService.handleConferenceStatus(body);
    res.set('Content-Type', 'text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }

  /**
   * Ring tone the agent hears while the seller's phone rings.
   *
   * Fetched by Twilio as the conference waitUrl, so it is deliberately
   * unauthenticated: Twilio does not sign media fetches, and the response is a
   * fixed tone carrying no data. Served with a long cache header because the
   * bytes never change.
   */
  @Get('twilio/ringback.wav')
  ringback(@Res() res: Response) {
    res.set('Content-Type', 'audio/wav');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(RINGBACK_WAV);
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

  /**
   * Stream a call recording. Twilio media needs account auth, so the browser
   * can't hit it directly; this proxies with our credentials. <audio> can't send
   * an Authorization header, so the JWT is passed as ?token=.
   */
  @Get('twilio/recording-media/:recordingSid')
  async twilioRecordingMedia(
    @Param('recordingSid') recordingSid: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    try {
      jwt.verify(token || '', process.env.JWT_SECRET || 'dev-secret-key');
    } catch {
      res.status(401).send('Unauthorized');
      return;
    }
    const media = await this.twilioVoiceService.fetchRecordingMedia(recordingSid);
    if (!media) {
      res.status(404).send('Recording not found');
      return;
    }
    res.set('Content-Type', media.contentType);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(media.buffer);
  }

  /** Recent dialer calls for the Recents tab. */
  @Get('twilio/recents')
  async twilioRecents(
    @Query('limit') limit?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const { userId } = this.decodeToken(authHeader);
    if (!userId) throw new UnauthorizedException('Not authenticated');
    const calls = await this.twilioVoiceService.recentCalls(
      limit ? parseInt(limit, 10) : 25,
    );
    return { calls };
  }

  /** Outbound caller IDs the dialer may present, for the "Calling From" picker. */
  @Get('twilio/numbers')
  async twilioNumbers(@Headers('authorization') authHeader?: string) {
    const { userId } = this.decodeToken(authHeader);
    if (!userId) throw new UnauthorizedException('Not authenticated');
    return { numbers: await this.twilioVoiceService.listCallerIds() };
  }

  // ─── In-call controls (hold + transfer) ───────────────────────────────────
  // All of these address the call by the browser leg's CallSid; the service
  // resolves that to the live Twilio Conference.

  @Post('twilio/hold')
  async twilioHold(
    @Body() body: { callSid: string; hold: boolean },
    @Headers('authorization') authHeader?: string,
  ) {
    return this.runCallControl(authHeader, () =>
      this.twilioVoiceService.setHold(body.callSid, !!body.hold),
    );
  }

  /** Drop the seller onto the target and leave immediately. */
  @Post('twilio/transfer/blind')
  async twilioBlindTransfer(
    @Body() body: { callSid: string; to: string },
    @Headers('authorization') authHeader?: string,
  ) {
    return this.runCallControl(authHeader, () =>
      this.twilioVoiceService.blindTransfer(body.callSid, body.to),
    );
  }

  /** Hold the seller and dial the target so the agent can brief them first. */
  @Post('twilio/transfer/warm')
  async twilioWarmTransfer(
    @Body() body: { callSid: string; to: string },
    @Headers('authorization') authHeader?: string,
  ) {
    return this.runCallControl(authHeader, () =>
      this.twilioVoiceService.startWarmTransfer(body.callSid, body.to),
    );
  }

  /** Hand the seller over to the consulted target and drop the agent. */
  @Post('twilio/transfer/warm/complete')
  async twilioWarmTransferComplete(
    @Body() body: { callSid: string },
    @Headers('authorization') authHeader?: string,
  ) {
    return this.runCallControl(authHeader, () =>
      this.twilioVoiceService.completeWarmTransfer(body.callSid),
    );
  }

  /** Abandon the consult and take the seller off hold. */
  @Post('twilio/transfer/warm/cancel')
  async twilioWarmTransferCancel(
    @Body() body: { callSid: string },
    @Headers('authorization') authHeader?: string,
  ) {
    return this.runCallControl(authHeader, () =>
      this.twilioVoiceService.cancelWarmTransfer(body.callSid),
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Shared auth + error shape for the in-call control endpoints. Twilio errors
   * here (conference gone, participant already left) are expected during a live
   * call, so they come back as a message the dialer can show rather than a 500.
   */
  private async runCallControl(
    authHeader: string | undefined,
    fn: () => Promise<{ ok: boolean }>,
  ) {
    const { userId } = this.decodeToken(authHeader);
    if (!userId) throw new UnauthorizedException('Not authenticated');
    try {
      return await fn();
    } catch (err: any) {
      this.logger.warn(`Call control failed: ${err.message}`);
      return { ok: false, error: err.message || 'Call control failed' };
    }
  }

  private decodeToken(authHeader?: string): { userId?: string; organizationId?: string } {
    try {
      const token = authHeader?.replace('Bearer ', '');
      // verify (not decode): reject expired tokens and forged/foreign signatures
      return (jwt.verify(token || '', process.env.JWT_SECRET || 'dev-secret-key') as any) || {};
    } catch {
      return {};
    }
  }

  private verifyTwilioSignature(req: Request, params: Record<string, any>): boolean {
    return isTwilioRequestValid(req, params);
  }
}
