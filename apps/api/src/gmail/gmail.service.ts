import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { google, Auth } from 'googleapis';

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private get clientId() {
    return this.config.get<string>('GOOGLE_CLIENT_ID');
  }
  private get clientSecret() {
    return this.config.get<string>('GOOGLE_CLIENT_SECRET');
  }
  private get redirectUri() {
    return this.config.get<string>('GOOGLE_REDIRECT_URI');
  }

  private get scopes() {
    return [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
    ];
  }

  private createOAuth2Client() {
    return new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
  }

  /**
   * Generate Google OAuth URL for a user
   */
  getAuthUrl(userId: string): string {
    const oauth2Client = this.createOAuth2Client();
    const state = Buffer.from(userId).toString('base64');
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: this.scopes,
      state,
    });
  }

  /**
   * Exchange auth code for tokens and save to DB
   */
  async handleCallback(code: string, userId: string): Promise<void> {
    const oauth2Client = this.createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Failed to get tokens from Google');
    }

    // Get the user's Gmail address
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress || '';

    const expiresAt = new Date(tokens.expiry_date || Date.now() + 3600 * 1000);

    await this.prisma.gmailToken.upsert({
      where: { userId },
      create: {
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        email,
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        email,
      },
    });

    this.logger.log(`Gmail connected for user ${userId}: ${email}`);
  }

  /**
   * Get an authenticated OAuth2 client for a user (auto-refreshes token)
   */
  async getClient(userId: string): Promise<Auth.OAuth2Client> {
    const token = await this.prisma.gmailToken.findUnique({ where: { userId } });
    if (!token) throw new Error('Gmail not connected');

    const oauth2Client = this.createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expiry_date: token.expiresAt.getTime(),
    });

    // Auto-refresh if expired
    if (token.expiresAt.getTime() < Date.now() + 60_000) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      await this.prisma.gmailToken.update({
        where: { userId },
        data: {
          accessToken: credentials.access_token!,
          expiresAt: new Date(credentials.expiry_date || Date.now() + 3600 * 1000),
        },
      });
      oauth2Client.setCredentials(credentials);
    }

    return oauth2Client;
  }

  /**
   * Send an email via Gmail API and save Email record
   */
  async sendEmail(
    userId: string,
    orgId: string | null | undefined,
    data: { to: string; subject: string; bodyHtml?: string; bodyText: string; leadId?: string },
  ) {
    const oauth2Client = await this.getClient(userId);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const token = await this.prisma.gmailToken.findUnique({ where: { userId } });

    // Resolve orgId from DB if not in JWT
    if (!orgId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
      orgId = user?.organizationId ?? 'unknown';
    }
    const fromAddress = token!.email;

    // Build RFC 2822 message
    const boundary = '____boundary____';
    const messageParts = [
      `From: ${fromAddress}`,
      `To: ${data.to}`,
      `Subject: ${data.subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      data.bodyText,
    ];

    if (data.bodyHtml) {
      messageParts.push(
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        '',
        data.bodyHtml,
      );
    }

    messageParts.push(`--${boundary}--`);

    const raw = Buffer.from(messageParts.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const sent = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    // Save to DB
    const email = await this.prisma.email.create({
      data: {
        orgId,
        leadId: data.leadId || null,
        gmailMsgId: sent.data.id || null,
        threadId: sent.data.threadId || null,
        direction: 'outbound',
        fromAddress,
        toAddress: data.to,
        subject: data.subject,
        bodyHtml: data.bodyHtml || null,
        bodyText: data.bodyText,
        sentAt: new Date(),
      },
    });

    this.logger.log(`Email sent to ${data.to} (gmailMsgId: ${sent.data.id})`);
    return email;
  }

  /**
   * Sync recent inbound emails from Gmail
   */
  async syncInbound(userId: string, orgId: string | null | undefined): Promise<number> {
    const oauth2Client = await this.getClient(userId);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const token = await this.prisma.gmailToken.findUnique({ where: { userId } });

    if (!orgId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
      orgId = user?.organizationId ?? 'unknown';
    }
    const myEmail = token!.email;

    // Fetch last 50 messages in INBOX
    const list = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 50,
      labelIds: ['INBOX'],
    });

    const messageIds = list.data.messages || [];
    if (messageIds.length === 0) return 0;

    // Get existing gmailMsgIds to skip
    const existing = await this.prisma.email.findMany({
      where: {
        gmailMsgId: { in: messageIds.map((m) => m.id!).filter(Boolean) },
      },
      select: { gmailMsgId: true },
    });
    const existingSet = new Set(existing.map((e) => e.gmailMsgId));

    let imported = 0;

    // Get all leads with email addresses for matching
    const leads = await this.prisma.lead.findMany({
      where: { organizationId: orgId, sellerEmail: { not: null } },
      select: { id: true, sellerEmail: true },
    });
    const emailToLeadId = new Map<string, string>();
    for (const lead of leads) {
      if (lead.sellerEmail) {
        emailToLeadId.set(lead.sellerEmail.toLowerCase(), lead.id);
      }
    }

    for (const msgRef of messageIds) {
      if (!msgRef.id || existingSet.has(msgRef.id)) continue;

      try {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: msgRef.id,
          format: 'full',
        });

        const headers = msg.data.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        const from = getHeader('From');
        const to = getHeader('To');
        const subject = getHeader('Subject');
        const dateStr = getHeader('Date');

        // Extract email address from "Name <email>" format
        const extractEmail = (str: string) => {
          const match = str.match(/<([^>]+)>/);
          return (match ? match[1] : str).toLowerCase().trim();
        };

        const fromEmail = extractEmail(from);
        const toEmail = extractEmail(to);

        // Determine direction
        const isOutbound = fromEmail === myEmail.toLowerCase();
        const direction = isOutbound ? 'outbound' : 'inbound';

        // Match to a lead
        const counterpartyEmail = isOutbound ? toEmail : fromEmail;
        const leadId = emailToLeadId.get(counterpartyEmail) || null;

        // Extract body text
        let bodyText = '';
        let bodyHtml: string | null = null;

        const extractBody = (payload: any): void => {
          if (payload.mimeType === 'text/plain' && payload.body?.data) {
            bodyText = Buffer.from(payload.body.data, 'base64').toString('utf-8');
          }
          if (payload.mimeType === 'text/html' && payload.body?.data) {
            bodyHtml = Buffer.from(payload.body.data, 'base64').toString('utf-8');
          }
          if (payload.parts) {
            for (const part of payload.parts) {
              extractBody(part);
            }
          }
        };

        if (msg.data.payload) {
          extractBody(msg.data.payload);
        }

        if (!bodyText && bodyHtml) {
          bodyText = bodyHtml.replace(/<[^>]+>/g, '');
        }

        if (!bodyText) bodyText = '(empty)';

        await this.prisma.email.create({
          data: {
            orgId,
            leadId,
            gmailMsgId: msgRef.id,
            threadId: msg.data.threadId || null,
            direction,
            fromAddress: fromEmail,
            toAddress: toEmail,
            subject: subject || '(no subject)',
            bodyHtml,
            bodyText,
            sentAt: dateStr ? new Date(dateStr) : new Date(),
          },
        });

        imported++;
      } catch (err: any) {
        this.logger.warn(`Failed to import message ${msgRef.id}: ${err.message}`);
      }
    }

    this.logger.log(`Synced ${imported} emails for user ${userId}`);
    return imported;
  }

  /**
   * Disconnect Gmail for a user
   */
  async disconnectGmail(userId: string): Promise<void> {
    const token = await this.prisma.gmailToken.findUnique({ where: { userId } });
    if (!token) return;

    // Try to revoke the token
    try {
      const oauth2Client = this.createOAuth2Client();
      oauth2Client.setCredentials({ access_token: token.accessToken });
      await oauth2Client.revokeToken(token.accessToken);
    } catch {
      // Revocation may fail if token is already expired — that's fine
    }

    await this.prisma.gmailToken.delete({ where: { userId } });
    this.logger.log(`Gmail disconnected for user ${userId}`);
  }

  /**
   * Re-match orphaned emails (leadId = null) to leads by email address
   */
  async rematchEmails(orgId: string): Promise<number> {
    const leads = await this.prisma.lead.findMany({
      where: { organizationId: orgId, sellerEmail: { not: null } },
      select: { id: true, sellerEmail: true },
    });
    const emailToLeadId = new Map<string, string>();
    for (const lead of leads) {
      if (lead.sellerEmail) emailToLeadId.set(lead.sellerEmail.toLowerCase(), lead.id);
    }

    const orphans = await this.prisma.email.findMany({
      where: { orgId, leadId: null },
      select: { id: true, fromAddress: true, toAddress: true },
    });

    let matched = 0;
    for (const email of orphans) {
      const candidates = [email.fromAddress, email.toAddress].map(e => e.toLowerCase());
      for (const addr of candidates) {
        const leadId = emailToLeadId.get(addr);
        if (leadId) {
          await this.prisma.email.update({ where: { id: email.id }, data: { leadId } });
          matched++;
          break;
        }
      }
    }
    this.logger.log(`Re-matched ${matched} orphaned emails to leads`);
    return matched;
  }

  /**
   * Get connection status for a user
   */
  async getStatus(userId: string): Promise<{ connected: boolean; email?: string }> {
    const token = await this.prisma.gmailToken.findUnique({
      where: { userId },
      select: { email: true },
    });
    return token
      ? { connected: true, email: token.email }
      : { connected: false };
  }

  /**
   * Get emails for a lead
   */
  async getEmailsForLead(leadId: string) {
    return this.prisma.email.findMany({
      where: { leadId },
      orderBy: { sentAt: 'asc' },
    });
  }
}
