/**
 * Call-back requests from a public brand website, today only
 * digdeeperllc.com.
 *
 * This deliberately does NOT create a Lead. Lead creation schedules initial
 * outreach under the Quick Cash brand, and a stranger typing into a public
 * form must never be able to start automated messaging. An inquiry is a row
 * and an email to the team; a person decides what happens next.
 *
 * The row is also the opt-in record for A2P: which consent boxes were ticked,
 * the exact wording for that version of the form, when, and from what network
 * address. Consent is only recorded against a phone number, because consent to
 * text nobody is meaningless.
 */

import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { CreateWebInquiryDto } from './web-inquiry.dto';
import {
  DIGDEEPER_CONSENT_TEXT,
  INQUIRY_RATE_LIMIT,
  INQUIRY_RATE_WINDOW_MS,
} from './web-inquiries.constants';

export interface InquiryContext {
  ip: string | null;
  userAgent: string | null;
}

/** Digits only, as E.164 for a US number, or null when it is not one. */
export function normalizeUsPhone(raw?: string | null): string | null {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

@Injectable()
export class WebInquiriesService {
  private readonly logger = new Logger(WebInquiriesService.name);
  /** ip -> submission times inside the window. In memory is enough for one API instance. */
  private readonly hits = new Map<string, number[]>();

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private config: ConfigService,
  ) {}

  async createDigDeeperInquiry(dto: CreateWebInquiryDto, ctx: InquiryContext) {
    // A filled honeypot gets the same answer as a real submission, so a bot
    // learns nothing, and nothing is stored or sent.
    if ((dto.website || '').trim()) {
      this.logger.warn(`Honeypot tripped from ${ctx.ip || 'unknown address'}, inquiry dropped`);
      return { ok: true };
    }

    this.enforceRateLimit(ctx.ip);

    const fullName = dto.fullName.trim();
    const email = (dto.email || '').trim().toLowerCase() || null;
    const rawPhone = (dto.phone || '').trim();
    const phone = rawPhone ? normalizeUsPhone(rawPhone) : null;

    if (rawPhone && !phone) throw new BadRequestException('Please enter a 10 digit phone number.');
    if (!phone && !email) {
      throw new BadRequestException('Please enter a phone number or an email address so we can reach you.');
    }

    const wantsTexts = dto.smsMarketingConsent || dto.smsServiceConsent;
    if (wantsTexts && !phone) {
      throw new BadRequestException('To receive text messages, please enter the phone number to text.');
    }
    const wording = DIGDEEPER_CONSENT_TEXT[dto.consentVersion];
    if (wantsTexts && !wording) {
      // An unknown version means the page and the API disagree about what was
      // shown. Refuse rather than record consent to words we cannot produce.
      throw new BadRequestException('This form is out of date. Please reload the page and try again.');
    }

    const agreed: string[] = [];
    if (dto.smsMarketingConsent && wording) agreed.push(wording.marketing);
    if (dto.smsServiceConsent && wording) agreed.push(wording.service);

    const inquiry = await this.prisma.webInquiry.create({
      data: {
        site: 'digdeeper',
        fullName,
        phone,
        email,
        city: (dto.city || '').trim() || null,
        state: (dto.state || '').trim() || null,
        message: (dto.message || '').trim() || null,
        smsMarketingConsent: !!dto.smsMarketingConsent,
        smsServiceConsent: !!dto.smsServiceConsent,
        consentVersion: wantsTexts ? dto.consentVersion : null,
        consentText: agreed.length ? agreed.join('\n\n') : null,
        consentedAt: wantsTexts ? new Date() : null,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 400) : null,
        pageUrl: (dto.pageUrl || '').trim() || null,
      },
    });

    // The row is the record. A failed notification must not lose the inquiry
    // or show the visitor an error, so it is logged and swallowed.
    this.notifyTeam(inquiry).catch((err) =>
      this.logger.error(`Inquiry ${inquiry.id} stored but the team email failed: ${err?.message || err}`),
    );

    return { ok: true };
  }

  private enforceRateLimit(ip: string | null) {
    const key = ip || 'unknown';
    const now = Date.now();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < INQUIRY_RATE_WINDOW_MS);
    if (recent.length >= INQUIRY_RATE_LIMIT) {
      this.hits.set(key, recent);
      throw new HttpException('Too many requests. Please call us instead.', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Keep the map from growing without bound on a long-lived process.
    if (this.hits.size > 5000) {
      for (const [k, times] of this.hits) {
        if (!times.some((t) => now - t < INQUIRY_RATE_WINDOW_MS)) this.hits.delete(k);
      }
    }
  }

  private async notifyTeam(inquiry: {
    id: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    state: string | null;
    message: string | null;
    smsMarketingConsent: boolean;
    smsServiceConsent: boolean;
    createdAt: Date;
  }) {
    const to = (this.config.get<string>('DIGDEEPER_INQUIRY_NOTIFY_TO') || '').trim() || 'deals@digdeeperllc.com';
    const consent = [
      inquiry.smsMarketingConsent ? 'marketing texts' : null,
      inquiry.smsServiceConsent ? 'non-marketing texts' : null,
    ].filter(Boolean);

    const rows: [string, string][] = [
      ['Name', inquiry.fullName],
      ['Phone', inquiry.phone || 'not given'],
      ['Email', inquiry.email || 'not given'],
      ['City, state', [inquiry.city, inquiry.state].filter(Boolean).join(', ') || 'not given'],
      ['Text consent', consent.length ? `Yes: ${consent.join(' and ')}` : 'NO. Do not text this person.'],
      ['Message', inquiry.message || 'none'],
      ['Received', inquiry.createdAt.toISOString()],
      ['Inquiry id', inquiry.id],
    ];

    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#222;">
<p><strong>New call-back request from digdeeperllc.com</strong></p>
<table cellpadding="6" style="border-collapse:collapse;">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="color:#666;vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td><td>${escapeHtml(v).replace(/\n/g, '<br>')}</td></tr>`,
  )
  .join('\n')}
</table>
<p style="color:#666;font-size:13px;">This person is not a lead in Dealcore yet. Nothing automated has been sent to them.</p>
</body></html>`;
    const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');

    await this.mailer.sendInternalHtml({
      to,
      subject: `Call-back request: ${inquiry.fullName}`,
      html,
      text,
      tags: ['web-inquiry', 'digdeeper'],
    });
  }
}
