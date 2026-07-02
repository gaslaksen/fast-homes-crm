import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import * as crypto from 'crypto';

/**
 * All outbound email flows through Mailgun on the verified sending subdomain
 * (MAILGUN_DOMAIN, e.g. crm.quickcashhomebuyers.com). Visible From addresses
 * use the root domain (deals@ / user@quickcashhomebuyers.com) so recipients see
 * a natural address; DKIM signs as the subdomain. Replies are routed back into
 * Dealcore via a per-lead Reply-To (reply+{leadId}@MAILGUN_DOMAIN) whose MX
 * points at Mailgun, which POSTs them to the inbound webhook.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  private get domain(): string {
    return this.config.get<string>('MAILGUN_DOMAIN') || 'crm.quickcashhomebuyers.com';
  }

  private get mg() {
    const mailgun = new Mailgun(FormData as any);
    return mailgun.client({
      username: 'api',
      key: this.config.get<string>('MAILGUN_API_KEY') || '',
      url: this.config.get<string>('MAILGUN_API_BASE') || 'https://api.mailgun.net',
    });
  }

  /** Per-lead Reply-To so inbound replies map back to the right lead thread. */
  private replyToForLead(leadId?: string): string | undefined {
    if (!leadId) return undefined;
    return `reply+${leadId}@${this.domain}`;
  }

  private buildFrom(displayName: string | undefined, address: string): string {
    return displayName ? `${displayName} <${address}>` : address;
  }

  /**
   * Low-level send + Email persistence. Callers pick the From identity.
   */
  private async send(params: {
    from: string;
    fromAddress: string;
    to: string;
    subject: string;
    bodyText: string;
    bodyHtml: string;
    replyTo?: string;
    inReplyTo?: string;
    references?: string;
    listUnsubscribeUrl?: string;
    orgId?: string | null;
    leadId?: string | null;
    sentByUserId?: string | null;
    tags?: string[];
  }): Promise<{ mailgunId: string | null }> {
    const message: Record<string, any> = {
      from: params.from,
      to: params.to,
      subject: params.subject,
      text: params.bodyText,
      html: params.bodyHtml,
    };
    if (params.replyTo) message['h:Reply-To'] = params.replyTo;
    if (params.inReplyTo) message['h:In-Reply-To'] = params.inReplyTo;
    if (params.references) message['h:References'] = params.references;
    if (params.listUnsubscribeUrl) {
      message['h:List-Unsubscribe'] = `<mailto:unsubscribe@${this.domain}>, <${params.listUnsubscribeUrl}>`;
      message['h:List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
    if (params.leadId) message['v:leadId'] = params.leadId;
    if (params.tags && params.tags.length) message['o:tag'] = params.tags;

    let mailgunId: string | null = null;
    try {
      const res = await this.mg.messages.create(this.domain, message as any);
      // Mailgun returns id wrapped in angle brackets: <xxx@domain>
      mailgunId = (res?.id || '').replace(/^</, '').replace(/>$/, '') || null;
    } catch (err: any) {
      this.logger.error(`Mailgun send to ${params.to} failed: ${err?.message}`);
      throw err;
    }

    // Persist to the Email table so it shows in the lead conversation thread.
    if (params.orgId) {
      try {
        await this.prisma.email.create({
          data: {
            orgId: params.orgId,
            leadId: params.leadId ?? null,
            direction: 'outbound',
            fromAddress: params.fromAddress,
            toAddress: params.to,
            subject: params.subject,
            bodyHtml: params.bodyHtml,
            bodyText: params.bodyText,
            sentByUserId: params.sentByUserId ?? null,
            sentAt: new Date(),
            threadId: params.leadId ?? null,
            mailgunMessageId: mailgunId,
            messageIdHeader: mailgunId ? `<${mailgunId}>` : null,
          },
        });
      } catch (err: any) {
        this.logger.warn(`Failed to persist Email record: ${err?.message}`);
      }
    }

    return { mailgunId };
  }

  /**
   * Initial lead outreach + any automated org-level email, sent as deals@.
   * Body is wrapped with the branded signature + unsubscribe footer.
   */
  async sendAsDeals(params: {
    orgId: string;
    to: string;
    subject: string;
    bodyText: string;
    leadId?: string;
    listUnsubscribeUrl?: string;
    sentByUserId?: string | null;
  }): Promise<{ mailgunId: string | null }> {
    const address = this.config.get<string>('EMAIL_DEALS_FROM') || 'deals@quickcashhomebuyers.com';
    const displayName = this.config.get<string>('EMAIL_DEALS_FROM_NAME') || 'Quick Cash Home Buyers';
    const { bodyText, bodyHtml } = this.wrapEmailBody(params.bodyText, params.listUnsubscribeUrl);
    return this.send({
      from: this.buildFrom(displayName, address),
      fromAddress: address,
      to: params.to,
      subject: params.subject,
      bodyText,
      bodyHtml,
      replyTo: this.replyToForLead(params.leadId),
      listUnsubscribeUrl: params.listUnsubscribeUrl,
      orgId: params.orgId,
      leadId: params.leadId,
      sentByUserId: params.sentByUserId ?? null,
      tags: ['deals-outreach'],
    });
  }

  /**
   * A reply/message sent by a logged-in user, appearing from their own
   * root-domain address (e.g. Ian@quickcashhomebuyers.com).
   */
  async sendAsUser(params: {
    orgId: string;
    user: { firstName?: string | null; lastName?: string | null; email: string };
    to: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    leadId?: string;
    inReplyToEmailId?: string;
    sentByUserId?: string | null;
  }): Promise<{ mailgunId: string | null }> {
    const displayName = [params.user.firstName, params.user.lastName].filter(Boolean).join(' ') || undefined;

    // Thread onto the prior message if replying within a lead conversation.
    let inReplyTo: string | undefined;
    let references: string | undefined;
    if (params.inReplyToEmailId) {
      const prior = await this.prisma.email.findUnique({
        where: { id: params.inReplyToEmailId },
        select: { messageIdHeader: true },
      });
      if (prior?.messageIdHeader) {
        inReplyTo = prior.messageIdHeader;
        references = prior.messageIdHeader;
      }
    }

    const bodyHtml = params.bodyHtml ?? this.wrapEmailBody(params.bodyText).bodyHtml;
    return this.send({
      from: this.buildFrom(displayName, params.user.email),
      fromAddress: params.user.email,
      to: params.to,
      subject: params.subject,
      bodyText: params.bodyText,
      bodyHtml,
      replyTo: this.replyToForLead(params.leadId),
      inReplyTo,
      references,
      orgId: params.orgId,
      leadId: params.leadId,
      sentByUserId: params.sentByUserId ?? null,
      tags: ['user-reply'],
    });
  }

  /**
   * Deal-package share email. Kept for the partners flow.
   */
  async sendDealPackage(to: string, subject: string, html: string, replyTo?: string) {
    const from = this.config.get('SMTP_FROM') || 'Deal Core <noreply@crm.quickcashhomebuyers.com>';
    const fromAddress = this.extractAddress(from);
    await this.mg.messages.create(this.domain, {
      from,
      to,
      subject,
      html,
      ...(replyTo ? { 'h:Reply-To': replyTo } : {}),
      'o:tag': ['deal-package'],
    });
  }

  async sendPasswordResetEmail(email: string, token: string, firstName: string) {
    const frontendUrl = this.config.get('FRONTEND_URL') || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;
    const from = this.config.get('SMTP_FROM') || 'Deal Core <noreply@crm.quickcashhomebuyers.com>';

    await this.mg.messages.create(this.domain, {
      from,
      to: email,
      subject: 'Reset your Deal Core password',
      'o:tag': ['password-reset'],
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #111827; margin-bottom: 16px;">Reset your password</h2>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">
            Hi ${firstName},
          </p>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">
            We received a request to reset your Deal Core password. Click the button below to choose a new password.
          </p>
          <div style="margin: 32px 0;">
            <a href="${resetUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 8px;">
              Reset Password
            </a>
          </div>
          <p style="color: #9ca3af; font-size: 13px; line-height: 1.5;">
            This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">Deal Core, real estate deal intelligence</p>
        </div>
      `,
    });
  }

  private extractAddress(from: string): string {
    const m = from.match(/<([^>]+)>/);
    return m ? m[1] : from;
  }

  // ─── Unsubscribe token machinery (moved from GmailService) ──────────────────

  /**
   * Build a stateless, HMAC-signed unsubscribe URL for a lead. Reused by
   * campaign sends and any transactional email that should honor opt-outs.
   */
  buildUnsubscribeUrl(leadId: string): string {
    const token = `${leadId}.${this.signUnsubscribe(leadId)}`;
    const apiBase = this.config.get<string>('API_URL') || 'https://api.mydealcore.com';
    return `${apiBase.replace(/\/$/, '')}/email/unsubscribe?token=${encodeURIComponent(token)}`;
  }

  /**
   * Verify an unsubscribe token and return the leadId if valid, else null.
   */
  verifyUnsubscribeToken(token: string): string | null {
    if (!token || typeof token !== 'string') return null;
    const idx = token.lastIndexOf('.');
    if (idx <= 0) return null;
    const leadId = token.slice(0, idx);
    const sig = token.slice(idx + 1);
    const expected = this.signUnsubscribe(leadId);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
    return leadId;
  }

  private signUnsubscribe(leadId: string): string {
    const secret = this.config.get<string>('JWT_SECRET') || 'dev-secret-key';
    return crypto
      .createHmac('sha256', secret)
      .update(leadId)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Wrap a plain-text body into a branded plain+HTML pair with a Quick Cash
   * Home Buyers signature and an optional unsubscribe footer.
   */
  wrapEmailBody(bodyText: string, unsubscribeUrl?: string): { bodyText: string; bodyHtml: string } {
    const companyName = 'Quick Cash Home Buyers';
    const phone = '(704) 471-3920';
    const website = 'www.quickcashhomebuyers.com';
    const websiteHref = 'https://www.quickcashhomebuyers.com';

    const textSignature = `\n\n-\n${companyName}\n${phone}\n${website}`;
    const textUnsub = unsubscribeUrl ? `\n\nNot interested? Unsubscribe: ${unsubscribeUrl}` : '';
    const finalText = `${bodyText}${textSignature}${textUnsub}`;

    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const paragraphs = bodyText
      .split(/\n{2,}/)
      .map((p) => `<p style="margin:0 0 14px 0;">${escape(p).replace(/\n/g, '<br>')}</p>`)
      .join('\n');

    const unsubHtml = unsubscribeUrl
      ? `<p style="margin:16px 0 0 0;font-size:12px;color:#888;">
  If these messages aren't useful, you can
  <a href="${escape(unsubscribeUrl)}" style="color:#888;text-decoration:underline;">unsubscribe here</a>
  and we won't contact you again.
</p>`
      : '';

    const bodyHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;">
<div style="max-width:600px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#222;background:#ffffff;">
${paragraphs}
<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e5;font-size:14px;color:#555;">
  <div style="font-weight:600;color:#222;">${companyName}</div>
  <div><a href="tel:+17044713920" style="color:#555;text-decoration:none;">${phone}</a></div>
  <div><a href="${websiteHref}" style="color:#555;text-decoration:none;">${website}</a></div>
</div>
${unsubHtml}
</div>
</body>
</html>`;

    return { bodyText: finalText, bodyHtml };
  }
}
