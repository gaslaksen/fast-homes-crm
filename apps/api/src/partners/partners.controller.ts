import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PartnersService } from './partners.service';
import { DealShareService } from './deal-share.service';

@Controller()
export class PartnersController {
  constructor(
    private partners: PartnersService,
    private dealShare: DealShareService,
  ) {}

  private decodeToken(authHeader?: string) {
    if (!authHeader) throw new UnauthorizedException();
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.decode(token) as any;
    if (!decoded?.userId) throw new UnauthorizedException();
    return decoded as { userId: string; organizationId: string; role: string; email: string };
  }

  // ── Partner CRUD ──────────────────────────────────────────────────

  @Post('partners')
  async createPartner(
    @Headers('authorization') auth: string,
    @Body() body: { name: string; email: string; company?: string; phone?: string; type?: string; tags?: string[]; notes?: string },
  ) {
    const { organizationId } = this.decodeToken(auth);
    return this.partners.create(organizationId, body);
  }

  @Get('partners')
  async listPartners(
    @Headers('authorization') auth: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { organizationId } = this.decodeToken(auth);
    return this.partners.list(organizationId, {
      search,
      type,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('partners/:id')
  async getPartner(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
  ) {
    const { organizationId } = this.decodeToken(auth);
    return this.partners.get(organizationId, id);
  }

  @Patch('partners/:id')
  async updatePartner(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body() body: { name?: string; email?: string; company?: string; phone?: string; type?: string; tags?: string[]; notes?: string },
  ) {
    const { organizationId } = this.decodeToken(auth);
    return this.partners.update(organizationId, id, body);
  }

  @Delete('partners/:id')
  async deletePartner(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
  ) {
    const { organizationId } = this.decodeToken(auth);
    return this.partners.delete(organizationId, id);
  }

  // ── Deal Sharing ──────────────────────────────────────────────────

  @Post('partners/share-deal')
  async shareDeal(
    @Headers('authorization') auth: string,
    @Body() body: {
      leadId: string;
      partnerIds: string[];
      channel?: 'resend' | 'gmail' | 'org-gmail';
      personalNote?: string;
      emailSubject?: string;
    },
  ) {
    const { userId, organizationId } = this.decodeToken(auth);
    return this.dealShare.shareDeal({
      ...body,
      userId,
      orgId: organizationId,
    });
  }

  @Get('leads/:leadId/shares')
  async getLeadShares(
    @Headers('authorization') auth: string,
    @Param('leadId') leadId: string,
  ) {
    const { organizationId } = this.decodeToken(auth);
    return this.dealShare.getSharesForLead(leadId, organizationId);
  }

  @Get('partners/:id/shares')
  async getPartnerShares(
    @Headers('authorization') auth: string,
    @Param('id') partnerId: string,
  ) {
    const { organizationId } = this.decodeToken(auth);
    return this.dealShare.getSharesForPartner(partnerId, organizationId);
  }

  @Post('partners/shares/:shareId/resend')
  async resendShare(
    @Headers('authorization') auth: string,
    @Param('shareId') shareId: string,
  ) {
    const { userId, organizationId } = this.decodeToken(auth);
    return this.dealShare.resendDeal(shareId, userId, organizationId);
  }

  // ── Public Deal View (no auth) ───────────────────────────────────

  @Get('deal-view/:token')
  async viewDeal(@Param('token') token: string) {
    return this.dealShare.trackOpen(token);
  }
}
