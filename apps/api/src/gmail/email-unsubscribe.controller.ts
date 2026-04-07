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
import { GmailService } from './gmail.service';

/**
 * Public (no auth) endpoints that honor Gmail's `List-Unsubscribe` /
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers.
 *
 * GET  /email/unsubscribe?token=...  — human click from the email footer;
 *                                       returns a small HTML confirmation page
 * POST /email/unsubscribe?token=...  — Gmail one-click; returns 200 JSON
 *
 * Both share the same idempotent opt-out: set Lead.doNotContact = true and
 * move all ACTIVE/PAUSED campaign enrollments for that lead to OPTED_OUT.
 */
@Controller('email/unsubscribe')
export class EmailUnsubscribeController {
  private readonly logger = new Logger(EmailUnsubscribeController.name);

  constructor(
    private prisma: PrismaService,
    private gmailService: GmailService,
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
  ): Promise<{ ok: boolean; message: string }> {
    const leadId = this.gmailService.verifyUnsubscribeToken(token || '');
    if (!leadId) {
      this.logger.warn(`Unsubscribe rejected: invalid token`);
      return { ok: false, message: 'Invalid or expired unsubscribe link.' };
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, sellerEmail: true },
    });
    if (!lead) {
      this.logger.warn(`Unsubscribe rejected: lead ${leadId} not found`);
      return { ok: false, message: 'Lead not found.' };
    }

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
    };
  }

  private renderPage({ ok, message }: { ok: boolean; message: string }): string {
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
    Quick Cash Home Buyers &middot; (704) 471-3920
  </div>
</div>
</body>
</html>`;
  }
}
