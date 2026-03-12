import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('stats')
  async getStats() {
    try {
      return await this.dashboardService.getStats();
    } catch (e) {
      console.error('[dashboard/stats] ERROR:', e?.message, e?.stack);
      throw e;
    }
  }

  @Get('activity')
  async getActivity(@Query('limit') limit?: string) {
    return this.dashboardService.getRecentActivity(
      limit ? parseInt(limit) : undefined,
    );
  }

  @Get('tasks')
  async getTasks(@Query('userId') userId?: string) {
    return this.dashboardService.getUpcomingTasks(userId);
  }

  @Get('hot-leads')
  async getHotLeads(@Query('limit') limit?: string) {
    return this.dashboardService.getHotLeads(limit ? parseInt(limit) : undefined);
  }

  @Get('stale-leads')
  async getStaleLeads(@Query('limit') limit?: string) {
    return this.dashboardService.getStaleLeads(limit ? parseInt(limit) : undefined);
  }
}
