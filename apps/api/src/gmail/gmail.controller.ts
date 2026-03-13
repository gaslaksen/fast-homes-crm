import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GmailService } from './gmail.service';
import * as jwt from 'jsonwebtoken';
import { Response } from 'express';

@Controller()
export class GmailController {
  constructor(
    private gmailService: GmailService,
    private config: ConfigService,
  ) {}

  private getUser(authHeader: string) {
    const token = authHeader?.replace('Bearer ', '');
    if (!token) throw new UnauthorizedException('No token');
    try {
      return jwt.verify(token, this.config.get('JWT_SECRET') || 'dev-secret-key') as any;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * GET /auth/gmail — redirect to Google OAuth
   * Accepts token via Authorization header OR ?token= query param (for browser redirects)
   */
  @Get('auth/gmail')
  async startOAuth(
    @Headers('authorization') authHeader: string,
    @Query('token') tokenParam: string,
    @Res() res: Response,
  ) {
    const effectiveAuth = authHeader || (tokenParam ? `Bearer ${tokenParam}` : '');
    const decoded = this.getUser(effectiveAuth);
    const url = this.gmailService.getAuthUrl(decoded.userId);
    res.redirect(url);
  }

  /**
   * GET /auth/gmail/callback — exchange code, save token, redirect to frontend
   */
  @Get('auth/gmail/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      res.redirect('/settings/profile?gmail=error');
      return;
    }

    const userId = Buffer.from(state, 'base64').toString('utf-8');

    try {
      await this.gmailService.handleCallback(code, userId);
      const frontendUrl = this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/settings/profile?gmail=connected`);
    } catch (err: any) {
      const frontendUrl = this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/settings/profile?gmail=error`);
    }
  }

  /**
   * GET /gmail/status — connection status
   */
  @Get('gmail/status')
  async getStatus(@Headers('authorization') authHeader: string) {
    const decoded = this.getUser(authHeader);
    return this.gmailService.getStatus(decoded.userId);
  }

  /**
   * POST /gmail/send — send an email
   */
  @Post('gmail/send')
  async sendEmail(
    @Headers('authorization') authHeader: string,
    @Body() body: { leadId?: string; to: string; subject: string; bodyHtml?: string; bodyText: string },
  ) {
    const decoded = this.getUser(authHeader);
    try {
      return await this.gmailService.sendEmail(decoded.userId, decoded.organizationId, body);
    } catch (e: any) {
      const detail = e?.response?.data || e?.message || String(e);
      console.error('[gmail/send] ERROR:', JSON.stringify(detail), e?.stack);
      throw e;
    }
  }

  /**
   * POST /gmail/sync — trigger inbound sync
   */
  @Post('gmail/sync')
  async syncInbound(@Headers('authorization') authHeader: string) {
    const decoded = this.getUser(authHeader);
    const count = await this.gmailService.syncInbound(decoded.userId, decoded.organizationId);
    return { imported: count };
  }

  /**
   * GET /gmail/emails/:leadId — get emails for a lead
   */
  @Get('gmail/emails/:leadId')
  async getEmails(
    @Headers('authorization') authHeader: string,
    @Param('leadId') leadId: string,
  ) {
    this.getUser(authHeader); // auth check
    return this.gmailService.getEmailsForLead(leadId);
  }

  /**
   * DELETE /gmail/disconnect — revoke and delete token
   */
  @Delete('gmail/disconnect')
  async disconnect(@Headers('authorization') authHeader: string) {
    const decoded = this.getUser(authHeader);
    await this.gmailService.disconnectGmail(decoded.userId);
    return { success: true };
  }
}
