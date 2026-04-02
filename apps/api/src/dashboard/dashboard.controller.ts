import { Controller, Get, Query, Headers } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import * as jwt from 'jsonwebtoken';

@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  private decodeOrg(authHeader?: string): string | undefined {
    try {
      const token = authHeader?.replace('Bearer ', '');
      if (!token) return undefined;
      const decoded = jwt.decode(token) as any;
      return decoded?.organizationId || undefined;
    } catch { return undefined; }
  }

  @Get('stats')
  async getStats(@Headers('authorization') authHeader?: string) {
    try {
      return await this.dashboardService.getStats(this.decodeOrg(authHeader));
    } catch (e) {
      console.error('[dashboard/stats] ERROR:', e?.message, e?.stack);
      throw e;
    }
  }

  @Get('activity')
  async getActivity(
    @Headers('authorization') authHeader?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dashboardService.getRecentActivity(
      limit ? parseInt(limit) : undefined,
      this.decodeOrg(authHeader),
    );
  }

  @Get('tasks')
  async getTasks(
    @Headers('authorization') authHeader?: string,
    @Query('userId') userId?: string,
  ) {
    return this.dashboardService.getUpcomingTasks(userId, this.decodeOrg(authHeader));
  }

  @Get('hot-leads')
  async getHotLeads(
    @Headers('authorization') authHeader?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dashboardService.getHotLeads(
      limit ? parseInt(limit) : undefined,
      this.decodeOrg(authHeader),
    );
  }

  @Get('new-leads')
  async getNewLeads(
    @Headers('authorization') authHeader?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dashboardService.getNewLeads(
      limit ? parseInt(limit) : undefined,
      this.decodeOrg(authHeader),
    );
  }

  @Get('stale-leads')
  async getStaleLeads(
    @Headers('authorization') authHeader?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dashboardService.getStaleLeads(
      limit ? parseInt(limit) : undefined,
      this.decodeOrg(authHeader),
    );
  }
}
