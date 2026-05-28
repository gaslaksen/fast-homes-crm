import { Controller, Get, Post, Body, Param, Query, Headers } from '@nestjs/common';
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
    const { organizationId } = this.decodeToken(authHeader);
    return this.inboxService.counts(organizationId);
  }

  @Post('threads/:leadId/read')
  async markRead(
    @Param('leadId') leadId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const { userId } = this.decodeToken(authHeader);
    return this.inboxService.markRead(leadId, userId);
  }

  @Post('threads/:leadId/star')
  async setStarred(
    @Param('leadId') leadId: string,
    @Body() body: { starred: boolean },
  ) {
    return this.inboxService.setStarred(leadId, !!body.starred);
  }
}
