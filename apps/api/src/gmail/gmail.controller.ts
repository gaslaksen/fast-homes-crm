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
  ForbiddenException,
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

  private requireAdmin(decoded: any) {
    if (decoded.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }
  }

  private async resolveOrgId(decoded: any): Promise<string> {
    if (decoded.organizationId) return decoded.organizationId;
    const user = await this.gmailService['prisma'].user.findUnique({
      where: { id: decoded.userId },
      select: { organizationId: true },
    });
    return user?.organizationId ?? 'unknown';
  }

  // ─── Per-user Gmail ──────────────────────────────────────────────────────────

  /**
   * GET /auth/gmail — redirect to Google OAuth (per-user)
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
   * GET /auth/gmail/callback — shared callback for both per-user and org Gmail
   * Differentiates by state prefix: "org:<orgId>:<userId>" vs plain userId
   */
  @Get('auth/gmail/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';

    if (!code || !state) {
      res.redirect(`${frontendUrl}/settings/profile?gmail=error`);
      return;
    }

    const decoded = Buffer.from(state, 'base64').toString('utf-8');

    // Org Gmail flow: state = "org:<orgId>:<userId>"
    if (decoded.startsWith('org:')) {
      const parts = decoded.split(':');
      const orgId = parts[1];
      const userId = parts[2];

      try {
        await this.gmailService.handleOrgCallback(code, orgId, userId);
        res.redirect(`${frontendUrl}/settings/team?orgGmail=connected`);
      } catch (err: any) {
        console.error('[org-gmail/callback] ERROR:', err.message);
        res.redirect(`${frontendUrl}/settings/team?orgGmail=error`);
      }
      return;
    }

    // Per-user Gmail flow: state = userId
    try {
      await this.gmailService.handleCallback(code, decoded);
      res.redirect(`${frontendUrl}/settings/profile?gmail=connected`);
    } catch (err: any) {
      res.redirect(`${frontendUrl}/settings/profile?gmail=error`);
    }
  }

  /**
   * GET /gmail/status — per-user connection status
   */
  @Get('gmail/status')
  async getStatus(@Headers('authorization') authHeader: string) {
    const decoded = this.getUser(authHeader);
    return this.gmailService.getStatus(decoded.userId);
  }

  /**
   * POST /gmail/send — send an email from per-user Gmail
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
   * POST /gmail/sync — trigger inbound sync (per-user)
   */
  @Post('gmail/sync')
  async syncInbound(@Headers('authorization') authHeader: string) {
    const decoded = this.getUser(authHeader);
    const resolvedOrgId = await this.resolveOrgId(decoded);
    const imported = await this.gmailService.syncInbound(decoded.userId, resolvedOrgId);
    const rematched = await this.gmailService.rematchEmails(resolvedOrgId);
    return { imported, rematched };
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
   * DELETE /gmail/disconnect — revoke and delete per-user token
   */
  @Delete('gmail/disconnect')
  async disconnect(@Headers('authorization') authHeader: string) {
    const decoded = this.getUser(authHeader);
    await this.gmailService.disconnectGmail(decoded.userId);
    return { success: true };
  }

  // ─── Org Gmail (shared inbox) ────────────────────────────────────────────────

  /**
   * GET /auth/org-gmail — redirect to Google OAuth for org Gmail (admin only)
   */
  @Get('auth/org-gmail')
  async startOrgOAuth(
    @Headers('authorization') authHeader: string,
    @Query('token') tokenParam: string,
    @Res() res: Response,
  ) {
    const effectiveAuth = authHeader || (tokenParam ? `Bearer ${tokenParam}` : '');
    const decoded = this.getUser(effectiveAuth);
    this.requireAdmin(decoded);
    const orgId = await this.resolveOrgId(decoded);
    const url = this.gmailService.getOrgAuthUrl(orgId, decoded.userId);
    res.redirect(url);
  }

  /**
   * GET /gmail/org-status — org Gmail connection status (any team member)
   */
  @Get('gmail/org-status')
  async getOrgStatus(@Headers('authorization') authHeader: string) {
    const decoded = this.getUser(authHeader);
    const orgId = await this.resolveOrgId(decoded);
    return this.gmailService.getOrgGmailStatus(orgId);
  }

  /**
   * POST /gmail/org-send — send an email from org Gmail (any team member)
   */
  @Post('gmail/org-send')
  async sendOrgEmail(
    @Headers('authorization') authHeader: string,
    @Body() body: { leadId?: string; to: string; subject: string; bodyHtml?: string; bodyText: string },
  ) {
    const decoded = this.getUser(authHeader);
    const orgId = await this.resolveOrgId(decoded);
    try {
      return await this.gmailService.sendOrgEmail(orgId, body);
    } catch (e: any) {
      const detail = e?.response?.data || e?.message || String(e);
      console.error('[gmail/org-send] ERROR:', JSON.stringify(detail), e?.stack);
      throw e;
    }
  }

  /**
   * POST /gmail/org-sync — sync org Gmail inbox (admin only)
   */
  @Post('gmail/org-sync')
  async syncOrgInbound(@Headers('authorization') authHeader: string) {
    const decoded = this.getUser(authHeader);
    this.requireAdmin(decoded);
    const orgId = await this.resolveOrgId(decoded);
    const imported = await this.gmailService.syncOrgInbound(orgId);
    const rematched = await this.gmailService.rematchEmails(orgId);
    return { imported, rematched };
  }

  /**
   * DELETE /gmail/org-disconnect — disconnect org Gmail (admin only)
   */
  @Delete('gmail/org-disconnect')
  async disconnectOrg(@Headers('authorization') authHeader: string) {
    const decoded = this.getUser(authHeader);
    this.requireAdmin(decoded);
    const orgId = await this.resolveOrgId(decoded);
    await this.gmailService.disconnectOrgGmail(orgId);
    return { success: true };
  }
}
