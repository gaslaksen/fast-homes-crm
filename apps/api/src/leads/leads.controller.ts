import { Controller, Get, Post, Patch, Put, Delete, Body, Param, Query, Headers, Res, HttpException, HttpStatus, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { LeadsService } from './leads.service';
import { CommunicationsService } from './communications.service';
import { LeadImportService, IMPORTABLE_FIELDS } from './lead-import.service';
import { AiInsightService } from './ai-insight.service';
import { LeadPhonesService } from '../phone-numbers/lead-phones.service';
import { LeadStatus, LeadSource } from '@fast-homes/shared';
import * as jwt from 'jsonwebtoken';

const IMPORT_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  fileFilter: (_req: any, file: any, cb: any) => {
    const allowed = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(csv|xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new BadRequestException('Only CSV and Excel files are allowed'), false);
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
};

@Controller('leads')
export class LeadsController {
  constructor(
    private leadsService: LeadsService,
    private leadImportService: LeadImportService,
    private aiInsightService: AiInsightService,
    private communicationsService: CommunicationsService,
    private leadPhones: LeadPhonesService,
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
    @Query('includePipelines') includePipelines?: string,
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
    @Query('tier') tier?: string,
    @Query('propertyState') propertyState?: string,
    @Query('staleMinDays') staleMinDays?: string,
    @Query('arvFilter') arvFilter?: string,
    @Query('showInactive') showInactive?: string,
    @Query('inDrip') inDrip?: string,
    @Query('needsReply') needsReply?: string,
    @Query('untouched') untouched?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
    @Query('idsOnly') idsOnly?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.leadsService.listLeads({
      idsOnly: idsOnly === 'true',
      source,
      includePipelines: includePipelines === 'true',
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
      tier: tier ? parseInt(tier) : undefined,
      propertyState,
      staleMinDays: staleMinDays ? parseInt(staleMinDays) : undefined,
      arvFilter: arvFilter as 'has' | 'none' | undefined,
      showInactive: showInactive === 'true',
      inDrip: inDrip === 'active' ? 'active' : undefined,
      needsReply: needsReply === 'true',
      untouched: untouched === 'true',
      sort,
      dir: dir as 'asc' | 'desc' | undefined,
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

  @Post('bulk-source')
  async bulkUpdateSource(@Body() body: { ids: string[]; source: LeadSource }) {
    return this.leadsService.bulkUpdateSource(body.ids, body.source);
  }

  @Post('export-csv')
  async exportCsv(@Body() body: any, @Res() res: Response) {
    const csv = await this.leadsService.exportCsv(body);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=leads-export.csv');
    res.send(csv);
  }

  @Post('export')
  async exportLeads(@Body() body: any, @Res() res: Response) {
    const { filters, fields, format } = body;
    const result = await this.leadsService.exportLeads(filters || {}, fields, format || 'csv');
    if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=leads-export.xlsx');
      res.send(result);
    } else {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=leads-export.csv');
      res.send(result);
    }
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  @Get('import/fields')
  getImportableFields() {
    return { fields: IMPORTABLE_FIELDS };
  }

  @Post('import/parse')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD_OPTIONS))
  async parseImportFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const { headers, sampleRows, totalRows, detectedMapping } =
      this.leadImportService.parseUpload(file.buffer, file.mimetype);
    return { headers, sampleRows, totalRows, detectedMapping, availableFields: IMPORTABLE_FIELDS };
  }

  @Post('import/execute')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD_OPTIONS))
  async executeImport(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @Headers('authorization') authHeader?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const { userId, organizationId } = this.decodeToken(authHeader);
    const mapping = typeof body.mapping === 'string' ? JSON.parse(body.mapping) : body.mapping;
    const options = typeof body.options === 'string' ? JSON.parse(body.options) : (body.options || {});

    const { headers, allRows } = this.leadImportService.parseUpload(file.buffer, file.mimetype);
    return this.leadImportService.executeImport(headers, allRows, mapping, {
      ...options,
      organizationId: options.organizationId || organizationId,
      userId,
    });
  }

  @Get('pipeline')
  async getPipelineLeads(
    @Headers('authorization') authHeader?: string,
    @Query('search') search?: string,
    @Query('tier') tier?: string,
    @Query('scoreBand') scoreBand?: string,
    @Query('assignedToUserId') assignedToUserId?: string,
    @Query('limitPerStage') limitPerStage?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.leadsService.getPipelineLeads({
      organizationId,
      search,
      tier: tier ? parseInt(tier) : undefined,
      scoreBand,
      assignedToUserId,
      limitPerStage: limitPerStage ? parseInt(limitPerStage) : undefined,
    });
  }

  @Get('stats')
  async getStats() {
    return this.leadsService.getLeadStats();
  }

  @Get(':id')
  async getLead(@Param('id') id: string) {
    return this.leadsService.getLead(id);
  }

  @Get(':id/communications')
  async getCommunications(@Param('id') id: string) {
    return this.communicationsService.getCommunications(id);
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

  @Post(':id/drip/cancel')
  async cancelDrip(@Param('id') leadId: string, @Body() body: { reason?: string }) {
    await this.leadsService.cancelDripForLead(leadId, body?.reason || 'User paused drip from lead page');
    return { ok: true };
  }

  @Get(':id/ai-insight')
  async getAiInsight(
    @Param('id') leadId: string,
    @Query('regenerate') regenerate?: string,
  ) {
    const result = await this.aiInsightService.getInsight(leadId, regenerate === '1' || regenerate === 'true');
    return result;
  }

  @Get(':id/alert-dismissals')
  async getAlertDismissals(@Param('id') leadId: string) {
    const lead = await this.leadsService.getLead(leadId);
    return lead?.alertDismissals ?? {};
  }

  @Post(':id/alert-dismissals')
  async upsertAlertDismissal(
    @Param('id') leadId: string,
    @Body() body: { ruleId: string; fingerprint: string },
  ) {
    const lead = await this.leadsService.getLead(leadId);
    const current = (lead?.alertDismissals as Record<string, any>) || {};
    current[body.ruleId] = { fingerprint: body.fingerprint, dismissedAt: new Date().toISOString() };
    await this.leadsService.updateLead(leadId, { alertDismissals: current });
    return current;
  }

  @Get(':id/tasks')
  async getTasks(@Param('id') leadId: string) {
    return this.leadsService.getLeadTasks(leadId);
  }

  @Post(':id/tasks')
  async createTask(@Param('id') leadId: string, @Body() body: any) {
    return this.leadsService.createTask(leadId, body);
  }

  @Post(':id/notes')
  async addNote(
    @Param('id') leadId: string,
    @Body() body: { content: string; userId: string; isInternalComment?: boolean; mentions?: string[] },
  ) {
    return this.leadsService.addNote(leadId, body.content, body.userId, {
      isInternalComment: body.isInternalComment,
      mentions: body.mentions,
    });
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

  /** One-time: backfill touchCount from outbound messages + completed calls */
  @Post('admin/backfill-touches')
  async backfillTouches() {
    const result = await this.leadsService.backfillTouchCounts();
    return { success: true, ...result };
  }

  @Patch(':id/auto-respond')
  async toggleAutoRespond(
    @Param('id') id: string,
    @Body() body: { autoRespond: boolean },
  ) {
    return this.leadsService.updateLead(id, { autoRespond: body.autoRespond });
  }

  /**
   * Promote one of the seller's skip-traced numbers to primary. Everything
   * automated sends to the primary, so this is how a number that actually
   * answers becomes the one the drip and the AI use.
   */
  @Patch(':id/primary-phone')
  async setPrimaryPhone(@Param('id') id: string, @Body() body: { number: string }) {
    const numbers = await this.leadPhones.setPrimary(id, body.number);
    return { numbers };
  }

  /**
   * The contacts on file for a lead, with the reasons not to use each: a DNC
   * registry flag, or a note that somebody tried it and it does not reach them.
   *
   * On leads.* rather than per pipeline, because every pipeline hangs off Lead
   * and four copies of this would drift the way listForLead already had.
   */
  @Get(':id/contacts')
  async contacts(@Param('id') id: string) {
    const [numbers, emails] = await Promise.all([
      this.leadPhones.listForLead(id),
      this.leadPhones.listEmailsForLead(id),
    ]);
    return { numbers, emails };
  }

  /**
   * Replace the numbers and emails on file. The whole list is sent, primary
   * first, because the slots are positional and "add to the first empty one"
   * races with a skip trace writing the same slots.
   */
  @Put(':id/contacts')
  async setContacts(
    @Param('id') id: string,
    @Body() body: { phones?: { number: string; type?: string | null }[]; emails?: string[] },
  ) {
    if (body.phones !== undefined) await this.leadPhones.setPhones(id, body.phones);
    if (body.emails !== undefined) await this.leadPhones.setEmails(id, body.emails);
    return this.contacts(id);
  }

  /**
   * Mark a number or an address as one that does not reach this person, or
   * clear the mark. The contact is kept either way: that it was tried and
   * failed is worth more than the empty slot, and without it the next person
   * to open the lead dials it again.
   */
  @Post(':id/contacts/flag')
  async flagContact(
    @Param('id') id: string,
    @Body() body: { value: string; bad?: boolean },
  ) {
    if (!body?.value) throw new HttpException('value is required', HttpStatus.BAD_REQUEST);
    await this.leadPhones.flagContact(id, body.value, body.bad !== false);
    return this.contacts(id);
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
  @Put(':id/contract')
  async upsertContract(@Param('id') leadId: string, @Body() body: any) {
    return this.leadsService.upsertContract(leadId, body);
  }

  // ── Dispo summary ─────────────────────────────────────────────────────────
  @Get(':id/dispo')
  async getDispoSummary(@Param('id') leadId: string) {
    return this.leadsService.getDispoSummary(leadId);
  }

  // ── Offers ────────────────────────────────────────────────────────────────
  @Get(':id/offers')
  async listOffers(@Param('id') leadId: string) {
    return this.leadsService.listOffers(leadId);
  }

  @Post(':id/offers')
  async createOffer(@Param('id') leadId: string, @Body() body: any) {
    return this.leadsService.createOffer(leadId, body);
  }

  @Patch(':id/offers/:offerId')
  async updateOffer(
    @Param('id') leadId: string,
    @Param('offerId') offerId: string,
    @Body() body: any,
  ) {
    return this.leadsService.updateOffer(leadId, offerId, body);
  }

  @Delete(':id/offers/:offerId')
  async deleteOffer(
    @Param('id') leadId: string,
    @Param('offerId') offerId: string,
  ) {
    return this.leadsService.deleteOffer(leadId, offerId);
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
