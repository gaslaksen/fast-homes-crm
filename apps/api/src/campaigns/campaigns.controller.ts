import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { CampaignsService } from './campaigns.service';
import { CampaignEnrollmentService } from './campaign-enrollment.service';
import { CampaignAiService } from './campaign-ai.service';

@Controller()
export class CampaignsController {
  constructor(
    private campaignsService: CampaignsService,
    private enrollmentService: CampaignEnrollmentService,
    private aiService: CampaignAiService,
  ) {}

  private decodeToken(authHeader?: string): {
    userId?: string;
    organizationId?: string;
    role?: string;
  } {
    try {
      const token = authHeader?.replace('Bearer ', '');
      if (!token) return {};
      return (jwt.decode(token) as any) || {};
    } catch {
      return {};
    }
  }

  // ─── Campaign CRUD ────────────────────────────────────────────────────────

  @Post('campaigns')
  async createCampaign(
    @Body() body: any,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.campaignsService.createCampaign(body, organizationId);
  }

  @Get('campaigns')
  async listCampaigns(@Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.campaignsService.getCampaigns(organizationId);
  }

  @Get('campaigns/:id')
  async getCampaign(@Param('id') id: string) {
    return this.campaignsService.getCampaignDetail(id);
  }

  @Put('campaigns/:id')
  async updateCampaign(@Param('id') id: string, @Body() body: any) {
    return this.campaignsService.updateCampaign(id, body);
  }

  @Delete('campaigns/:id')
  async deleteCampaign(@Param('id') id: string) {
    return this.campaignsService.deleteCampaign(id);
  }

  @Post('campaigns/:id/duplicate')
  async duplicateCampaign(@Param('id') id: string) {
    return this.campaignsService.duplicateCampaign(id);
  }

  @Patch('campaigns/:id/toggle')
  async toggleCampaign(@Param('id') id: string, @Body() body: { isActive: boolean }) {
    return this.campaignsService.toggleCampaign(id, body.isActive);
  }

  // ─── Campaign Stats ───────────────────────────────────────────────────────

  @Get('campaigns/:id/stats')
  async getCampaignStats(@Param('id') id: string) {
    return this.campaignsService.getCampaignDetail(id);
  }

  // ─── Enrollments ─────────────────────────────────────────────────────────

  @Post('campaigns/:id/enroll/:leadId')
  async enrollLead(
    @Param('id') campaignId: string,
    @Param('leadId') leadId: string,
  ) {
    return this.enrollmentService.enrollLead(leadId, campaignId);
  }

  @Get('campaigns/:id/enrollments')
  async getCampaignEnrollments(
    @Param('id') campaignId: string,
    @Query('status') status?: string,
  ) {
    return this.enrollmentService.getEnrollmentsForCampaign(campaignId, status);
  }

  @Delete('campaigns/enrollments/:enrollmentId')
  async unenrollLead(@Param('enrollmentId') enrollmentId: string) {
    return this.enrollmentService.unenrollLead(enrollmentId);
  }

  @Patch('campaigns/enrollments/:enrollmentId/pause')
  async pauseEnrollment(@Param('enrollmentId') enrollmentId: string) {
    return this.enrollmentService.pauseEnrollment(enrollmentId);
  }

  @Patch('campaigns/enrollments/:enrollmentId/resume')
  async resumeEnrollment(@Param('enrollmentId') enrollmentId: string) {
    return this.enrollmentService.resumeEnrollment(enrollmentId);
  }

  // ─── Lead-scoped enrollments ──────────────────────────────────────────────

  @Get('leads/:leadId/campaigns')
  async getLeadCampaigns(@Param('leadId') leadId: string) {
    return this.enrollmentService.getEnrollmentsForLead(leadId);
  }

  // ─── AI Endpoints ─────────────────────────────────────────────────────────

  @Post('campaigns/ai/suggest')
  async aiSuggest(@Body() body: any) {
    try {
      return await this.aiService.generateSuggestion(body);
    } catch (err) {
      throw new HttpException(err.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('campaigns/ai/improve')
  async aiImprove(@Body() body: any) {
    try {
      return await this.aiService.improveMessage(body);
    } catch (err) {
      throw new HttpException(err.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('campaigns/ai/generate-sequence')
  async aiGenerateSequence(@Body() body: any) {
    try {
      return await this.aiService.generateFullSequence(body);
    } catch (err) {
      throw new HttpException(err.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
