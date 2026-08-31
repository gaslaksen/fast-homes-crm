import {
  Controller,
  Get,
  Post,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from './mailer.service';
import { Brand, DEFAULT_BRAND, brandForLeadSource } from '../common/company.constants';

/**
 * Public (no auth) endpoints that honor the `List-Unsubscribe` /
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers on outbound email.
 *
 * GET  /email/unsubscribe?token=...  — human click from the email footer;
 *                                       returns a small HTML confirmation page
 * POST /email/unsubscribe?token=...  — one-click; returns 200 JSON
 *
 * Both share the same idempotent opt-out: set Lead.doNotContact = true and
 * move all ACTIVE/PAUSED campaign enrollments for that lead to OPTED_OUT.
 */
@Controller('email/unsubscribe')
export class EmailUnsubscribeController {
  private readonly logger = new Logger(EmailUnsubscribeController.name);

  constructor(
    private prisma: PrismaService,
    private mailerService: MailerService,
  ) {}

  @Get()
  async unsubscribeGet(@Query('token') token: string, @Res() res: Response) {
    const result = await this.processUnsubscribe(token);
    res.status(result.ok ? 200 : 400).type('html').send(this.renderPage(result));
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async unsubscribePost(@Query('token') token: string) {
    const result = await this.processUnsubscribe(token);
    return { ok: result.ok, message: result.message };
  }

  private async processUnsubscribe(
    token: string,
  ): Promise<{ ok: boolean; message: string; brand: Brand }> {
    const leadId = this.mailerService.verifyUnsubscribeToken(token || '');
    if (!leadId) {
      this.logger.warn(`Unsubscribe rejected: invalid token`);
      // No lead, so no brand to show: fall back to the default.
      return { ok: false, message: 'Invalid or expired unsubscribe link.', brand: DEFAULT_BRAND };
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, sellerEmail: true, source: true },
    });
    if (!lead) {
      this.logger.warn(`Unsubscribe rejected: lead ${leadId} not found`);
      return { ok: false, message: 'Lead not found.', brand: DEFAULT_BRAND };
    }

    // The page must name the same company the email did, or the seller lands
    // on an unsubscribe confirmation from a business they never heard from.
    const brand = brandForLeadSource(lead.source);

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { doNotContact: true },
    });
    const enrollments = await this.prisma.campaignEnrollment.updateMany({
      where: { leadId, status: { in: ['ACTIVE', 'PAUSED'] } },
      data: { status: 'OPTED_OUT' },
    });

    this.logger.log(
      `📭 Unsubscribed lead ${leadId} (${lead.sellerEmail || 'no email'}) — ` +
        `${enrollments.count} enrollment(s) opted out`,
    );

    return {
      ok: true,
      message: "You've been unsubscribed. We won't contact you again.",
      brand,
    };
  }

  private renderPage({ ok, message, brand }: { ok: boolean; message: string; brand: Brand }): string {
    const title = ok ? 'Unsubscribed' : 'Something went wrong';
    const color = ok ? '#0a7d30' : '#b42318';
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:80px auto;padding:32px 28px;background:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);text-align:center;">
  <div style="font-size:20px;font-weight:600;color:${color};margin-bottom:12px;">${title}</div>
  <div style="font-size:15px;color:#444;line-height:1.5;">${message}</div>
  <div style="margin-top:24px;font-size:13px;color:#888;">
    ${brand.companyName} &middot; ${brand.phone}
  </div>
</div>
</body>
</html>`;
  }
}
