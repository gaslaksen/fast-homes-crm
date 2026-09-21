import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { WebInquiriesService } from './web-inquiries.service';
import { CreateWebInquiryDto } from './web-inquiry.dto';

/**
 * Public, unauthenticated. Reached from digdeeperllc.com through a Vercel
 * rewrite of /api/inquiry, so the browser request is same-origin and this API
 * needs no CORS entry for that site.
 */
@Controller('public/web-inquiries')
export class WebInquiriesController {
  constructor(private inquiries: WebInquiriesService) {}

  @Post('digdeeper')
  @HttpCode(200)
  async createDigDeeper(@Body() dto: CreateWebInquiryDto, @Req() req: any) {
    // Vercel puts the visitor first in x-forwarded-for and Railway appends its
    // own hop, so the first entry is the one that identifies the sender.
    const forwarded = String(req.headers?.['x-forwarded-for'] || '')
      .split(',')[0]
      .trim();
    const ip = forwarded || req.ip || null;
    const userAgent = (req.headers?.['user-agent'] as string) || null;
    return this.inquiries.createDigDeeperInquiry(dto, { ip, userAgent });
  }
}
