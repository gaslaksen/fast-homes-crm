import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { ActionsService } from './actions.service';
import type {
  ActionCategory,
  ActionQueueFilters,
} from './actions.types';

interface DecodedToken {
  userId?: string;
  organizationId?: string;
}

@Controller('actions')
export class ActionsController {
  constructor(private readonly actions: ActionsService) {}

  private decode(authHeader?: string): DecodedToken {
    try {
      const token = authHeader?.replace('Bearer ', '');
      if (!token) return {};
      return (jwt.decode(token) as DecodedToken) || {};
    } catch {
      return {};
    }
  }

  private requireUser(authHeader?: string): DecodedToken & { userId: string } {
    const decoded = this.decode(authHeader);
    if (!decoded.userId) {
      throw new UnauthorizedException('Missing user token');
    }
    return decoded as DecodedToken & { userId: string };
  }

  @Get('queue')
  async getQueue(
    @Headers('authorization') authHeader?: string,
    @Query('category') category?: string,
    @Query('sort') sort?: string,
    @Query('limit') limit?: string,
  ) {
    const { userId, organizationId } = this.decode(authHeader);
    const filters: ActionQueueFilters = {};
    if (category) {
      filters.category = category.split(',') as ActionCategory[];
    }
    if (sort === 'priority' || sort === 'oldest' || sort === 'newest') {
      filters.sort = sort;
    }
    if (limit) {
      const n = parseInt(limit, 10);
      if (Number.isFinite(n) && n > 0) filters.limit = n;
    }
    const items = await this.actions.getQueue(userId, organizationId, filters);
    return { items };
  }

  @Get('badges')
  async getBadges(@Headers('authorization') authHeader?: string) {
    const { userId, organizationId } = this.decode(authHeader);
    return this.actions.getBadges(userId, organizationId);
  }

  @Post('seen')
  async markSeen(@Headers('authorization') authHeader?: string) {
    const { userId } = this.requireUser(authHeader);
    await this.actions.markSeen(userId);
    return { ok: true };
  }

  @Post(':actionKey/dismiss')
  async dismiss(
    @Param('actionKey') actionKey: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const { userId } = this.requireUser(authHeader);
    await this.actions.dismiss(userId, actionKey);
    return { ok: true };
  }

  @Post(':actionKey/snooze')
  async snooze(
    @Param('actionKey') actionKey: string,
    @Body() body: { until: string },
    @Headers('authorization') authHeader?: string,
  ) {
    const { userId } = this.requireUser(authHeader);
    const until = new Date(body?.until);
    if (Number.isNaN(until.getTime())) {
      throw new UnauthorizedException('Invalid until timestamp');
    }
    await this.actions.snooze(userId, actionKey, until);
    return { ok: true };
  }

  @Post(':actionKey/complete')
  async complete(
    @Param('actionKey') actionKey: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const { userId, organizationId } = this.requireUser(authHeader);
    await this.actions.complete(userId, actionKey, organizationId);
    return { ok: true };
  }
}
