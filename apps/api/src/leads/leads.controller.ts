import { Controller, Get, Post, Patch, Body, Param, Query, Headers, Res, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { LeadsService } from './leads.service';
import { RentCastService } from '../comps/rentcast.service';
import { LeadStatus, LeadSource } from '@fast-homes/shared';
import * as jwt from 'jsonwebtoken';

@Controller('leads')
export class LeadsController {
  constructor(
    private leadsService: LeadsService,
    private rentCastService: RentCastService,
  ) {}

  private decodeToken(authHeader?: string): { userId?: string; organizationId?: string; role?: string } {
    try {
      const token = authHeader?.replace('Bearer ', '');
      if (!token) return {};
      return jwt.decode(token) as any || {};
    } catch { return {}; }
  }

  @Post()
  async createLead(
    @Body() body: any,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.leadsService.createLead({ ...body, organizationId: body.organizationId || organizationId });
  }

  @Get()
  async listLeads(
    @Headers('authorization') authHeader?: string,
    @Query('source') source?: LeadSource,
    @Query('status') status?: LeadStatus,
    @Query('scoreBand') scoreBand?: string,
    @Query('assignedToUserId') assignedToUserId?: string,
    @Query('zip') zip?: string,
    @Query('minScore') minScore?: string,
    @Query('maxScore') maxScore?: string,
    @Query('search') search?: string,
    @Query('createdAfter') createdAfter?: string,
    @Query('createdBefore') createdBefore?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.leadsService.listLeads({
      source,
      status,
      scoreBand,
      assignedToUserId,
      zip,
      minScore: minScore ? parseInt(minScore) : undefined,
      maxScore: maxScore ? parseInt(maxScore) : undefined,
      search,
      createdAfter,
      createdBefore,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      organizationId,
    });
  }

  @Post('backfill-addresses')
  async backfillAddresses() {
    return this.leadsService.backfillMissingCityState();
  }

  @Post('bulk-delete')
  async bulkDelete(@Body() body: { ids: string[] }) {
    return this.leadsService.bulkDelete(body.ids);
  }

  @Post('bulk-status')
  async bulkUpdateStatus(@Body() body: { ids: string[]; status: LeadStatus }) {
    return this.leadsService.bulkUpdateStatus(body.ids, body.status);
  }

  @Post('export-csv')
  async exportCsv(@Body() body: any, @Res() res: Response) {
    const csv = await this.leadsService.exportCsv(body);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=leads-export.csv');
    res.send(csv);
  }

  @Get('stats')
  async getStats() {
    return this.leadsService.getLeadStats();
  }

  @Get('test-property-details')
  async testPropertyDetails(@Query('address') address?: string): Promise<Record<string, any>> {
    const testAddress = address || '248 Clairborne Ct, Matthews, NC 28104';
    try {
      const data = await this.rentCastService.getPropertyDetails(testAddress);
      return {
        success: !!data,
        address: testAddress,
        apiKeyConfigured: this.rentCastService.isConfigured,
        data: data || null,
      };
    } catch (error) {
      return {
        success: false,
        address: testAddress,
        apiKeyConfigured: this.rentCastService.isConfigured,
        error: error.message,
      };
    }
  }

  @Get(':id')
  async getLead(@Param('id') id: string) {
    return this.leadsService.getLead(id);
  }

  @Patch(':id')
  async updateLead(@Param('id') id: string, @Body() body: any) {
    try {
      return await this.leadsService.updateLead(id, body);
    } catch (error) {
      console.error('Update lead error:', error);
      throw new HttpException(
        error.message || 'Failed to update lead',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/tasks')
  async createTask(@Param('id') leadId: string, @Body() body: any) {
    return this.leadsService.createTask(leadId, body);
  }

  @Post(':id/notes')
  async addNote(
    @Param('id') leadId: string,
    @Body() body: { content: string; userId: string },
  ) {
    return this.leadsService.addNote(leadId, body.content, body.userId);
  }

  @Post(':id/send-outreach')
  async sendInitialOutreach(@Param('id') id: string) {
    try {
      const result = await this.leadsService.triggerInitialOutreach(id);
      return { success: true, result };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to send outreach',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /** One-time: normalize all stored phone numbers to E.164 format */
  @Post('admin/normalize-phones')
  async normalizePhones() {
    const result = await this.leadsService.normalizeAllPhones();
    return { success: true, ...result };
  }

  @Patch(':id/auto-respond')
  async toggleAutoRespond(
    @Param('id') id: string,
    @Body() body: { autoRespond: boolean },
  ) {
    return this.leadsService.updateLead(id, { autoRespond: body.autoRespond });
  }

  @Post(':id/property-details/refresh')
  async refreshPropertyDetails(@Param('id') id: string) {
    try {
      return await this.leadsService.refreshPropertyDetails(id);
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to refresh property details',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(':id/assign')
  async assignLead(
    @Param('id') id: string,
    @Body() body: { userId: string; stage: string },
  ) {
    return this.leadsService.assignLead(id, body.userId, body.stage);
  }

  @Patch(':id/unassign')
  async unassignLead(@Param('id') id: string) {
    return this.leadsService.unassignLead(id);
  }

  @Post(':id/contract')
  async upsertContract(@Param('id') leadId: string, @Body() body: any) {
    return this.leadsService.upsertContract(leadId, body);
  }
}

@Controller('tasks')
export class TasksController {
  constructor(private leadsService: LeadsService) {}

  @Post(':id/complete')
  async completeTask(
    @Param('id') taskId: string,
    @Body() body: { userId?: string },
  ) {
    return this.leadsService.completeTask(taskId, body.userId);
  }
}
