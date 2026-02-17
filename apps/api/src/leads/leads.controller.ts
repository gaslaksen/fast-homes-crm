import { Controller, Get, Post, Patch, Body, Param, Query, HttpException, HttpStatus } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadStatus, LeadSource } from '@fast-homes/shared';

@Controller('leads')
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  @Post()
  async createLead(@Body() body: any) {
    return this.leadsService.createLead(body);
  }

  @Get()
  async listLeads(
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
    });
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
