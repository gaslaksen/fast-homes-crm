import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { InboxService, InboxFilter } from './inbox.service';

@Controller('inbox')
export class InboxController {
  constructor(private inboxService: InboxService) {}

  private decodeToken(authHeader?: string): { userId?: string; organizationId?: string } {
    try {
      const token = authHeader?.replace('Bearer ', '');
      if (!token) return {};
      return (jwt.decode(token) as any) || {};
    } catch {
      return {};
    }
  }

  @Get('threads')
  async threads(
    @Headers('authorization') authHeader?: string,
    @Query('filter') filter?: InboxFilter,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { userId, organizationId } = this.decodeToken(authHeader);
    return this.inboxService.listThreads({
      organizationId,
      userId,
      filter,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('counts')
  async counts(@Headers('authorization') authHeader?: string) {
    const { userId, organizationId } = this.decodeToken(authHeader);
    const [counts, voicemails] = await Promise.all([
      this.inboxService.counts(organizationId, userId),
      this.inboxService.countOpenVoicemails(),
    ]);
    return { ...counts, voicemails };
  }

  @Post('threads/:leadId/read')
  async markRead(
    @Param('leadId') leadId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const { userId } = this.decodeToken(authHeader);
    return this.inboxService.markRead(leadId, userId);
  }

  /** Voicemails from numbers that matched no lead, newest first. */
  @Get('voicemails')
  async voicemails(@Headers('authorization') authHeader?: string) {
    this.requireUser(authHeader);
    return this.inboxService.listOpenVoicemails();
  }

  @Post('voicemails/:id/dismiss')
  async dismissVoicemail(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    this.requireUser(authHeader);
    return this.inboxService.dismissVoicemail(id);
  }

  @Post('voicemails/:id/attach')
  async attachVoicemail(
    @Param('id') id: string,
    @Body() body: { leadId?: string },
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.requireUser(authHeader);
    if (!body?.leadId) throw new BadRequestException('leadId is required');
    return this.inboxService.attachVoicemail(id, body.leadId, organizationId);
  }

  /**
   * Voicemails carry a stranger's phone number and voice, so these routes
   * verify the token rather than only decoding it.
   */
  private requireUser(authHeader?: string): { userId: string; organizationId?: string } {
    try {
      const token = authHeader?.replace('Bearer ', '') || '';
      const claims = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key') as any;
      if (claims?.userId) return claims;
    } catch {
      // fall through
    }
    throw new UnauthorizedException('Not authenticated');
  }

  @Post('threads/:leadId/star')
  async setStarred(
    @Param('leadId') leadId: string,
    @Body() body: { starred: boolean },
  ) {
    return this.inboxService.setStarred(leadId, !!body.starred);
  }
}
