import {
  Controller, Get, Post, Patch, Body, Param, Query, Headers,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as jwt from 'jsonwebtoken';
import { ForeclosuresService } from './foreclosures.service';
import { ForeclosureImportService } from './foreclosure-import.service';
import { ForeclosureIngestService } from './foreclosure-ingest.service';
import { ForeclosureSkiptraceService } from './foreclosure-skiptrace.service';
import { ForeclosureDocumentService } from './foreclosure-document.service';
import { ForeclosureFilingService } from './foreclosure-filing.service';
import { ForeclosureRulesService } from './foreclosure-rules.service';
import { ForeclosureSignalsService } from './foreclosure-signals.service';

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
  limits: { fileSize: 50 * 1024 * 1024 },
};

const PDF_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  fileFilter: (_req: any, file: any, cb: any) => {
    if (file.mimetype === 'application/pdf' || file.originalname.match(/\.pdf$/i)) {
      cb(null, true);
    } else {
      cb(new BadRequestException('Only PDF files are allowed'), false);
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
};

@Controller('foreclosures')
export class ForeclosuresController {
  constructor(
    private foreclosures: ForeclosuresService,
    private importService: ForeclosureImportService,
    private ingest: ForeclosureIngestService,
    private skiptrace: ForeclosureSkiptraceService,
    private documents: ForeclosureDocumentService,
    private filings: ForeclosureFilingService,
    private rules: ForeclosureRulesService,
    private signals: ForeclosureSignalsService,
  ) {}

  private decodeToken(authHeader?: string): { userId?: string; organizationId?: string; role?: string } {
    try {
      const token = authHeader?.replace('Bearer ', '');
      if (!token) return {};
      return (jwt.decode(token) as any) || {};
    } catch {
      return {};
    }
  }

  @Get()
  async list(
    @Headers('authorization') authHeader?: string,
    @Query('search') search?: string,
    @Query('priority') priority?: string,
    @Query('noticeType') noticeType?: string,
    @Query('workStatus') workStatus?: string,
    @Query('city') city?: string,
    @Query('county') county?: string,
    @Query('occupancy') occupancy?: string,
    @Query('equityBand') equityBand?: string,
    @Query('ownedYearsMin') ownedYearsMin?: string,
    @Query('saleWindow') saleWindow?: string,
    @Query('valueMin') valueMin?: string,
    @Query('hideDead') hideDead?: string,
    @Query('hideDnc') hideDnc?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.foreclosures.list({
      organizationId,
      search,
      priority,
      noticeType,
      workStatus,
      city,
      county,
      occupancy,
      equityBand,
      ownedYearsMin: ownedYearsMin ? Number(ownedYearsMin) : undefined,
      saleWindow,
      valueMin: valueMin ? Number(valueMin) : undefined,
      hideDead: hideDead === 'true',
      hideDnc: hideDnc === 'true',
      sort,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /**
   * Ids for the whole filtered set, for the lead detail prev/next queue.
   * Takes the same query params as the list so the two cannot drift apart.
   */
  @Get('ids')
  async listIds(
    @Headers('authorization') authHeader?: string,
    @Query('search') search?: string,
    @Query('priority') priority?: string,
    @Query('noticeType') noticeType?: string,
    @Query('workStatus') workStatus?: string,
    @Query('city') city?: string,
    @Query('county') county?: string,
    @Query('occupancy') occupancy?: string,
    @Query('equityBand') equityBand?: string,
    @Query('ownedYearsMin') ownedYearsMin?: string,
    @Query('saleWindow') saleWindow?: string,
    @Query('valueMin') valueMin?: string,
    @Query('hideDead') hideDead?: string,
    @Query('hideDnc') hideDnc?: string,
    @Query('sort') sort?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.foreclosures.listIds({
      organizationId,
      search,
      priority,
      noticeType,
      workStatus,
      city,
      county,
      occupancy,
      equityBand,
      ownedYearsMin: ownedYearsMin ? Number(ownedYearsMin) : undefined,
      saleWindow,
      valueMin: valueMin ? Number(valueMin) : undefined,
      hideDead: hideDead === 'true',
      hideDnc: hideDnc === 'true',
      sort,
    });
  }

  @Get('stats')
  async stats(@Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.foreclosures.stats(organizationId);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    const lead = await this.foreclosures.get(id, organizationId);
    if (!lead) throw new BadRequestException('Foreclosure lead not found');
    return lead;
  }

  /** Signals for this lead, most severe first. */
  @Get(':id/signals')
  async signalsForLead(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.signals.forLead(id, organizationId);
  }

  /** Re-run the synthesis pass, e.g. after correcting a field or a lender. */
  @Post(':id/analyze-signals')
  async analyzeSignals(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    const result = await this.signals.analyzeLead(id, organizationId);
    if (!result) throw new BadRequestException('No extracted filing for this lead yet');
    return result;
  }

  /**
   * Tick or untick one recommended action. A record of what the user did -
   * nothing here sends a message or contacts anyone.
   */
  @Patch('signals/:signalId/actions')
  async setSignalAction(
    @Param('signalId') signalId: string,
    @Body() body: { action?: string; completed?: boolean },
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    if (!body?.action) throw new BadRequestException('action is required');
    const updated = await this.signals.setActionCompletion(
      signalId, body.action, body.completed !== false, organizationId,
    );
    if (!updated) throw new BadRequestException('Signal not found or action not offered on it');
    return updated;
  }

  /** Lender patterns driving loan-type classification. Editable in-app. */
  @Get('lender-profiles')
  async listLenderProfiles(@Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.rules.listProfiles(organizationId);
  }

  @Post('lender-profiles')
  async createLenderProfile(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    if (!body?.matchPattern || !body?.lenderName || !body?.loanType) {
      throw new BadRequestException('matchPattern, lenderName, and loanType are required');
    }
    return this.rules.createProfile(body, organizationId);
  }

  @Patch('lender-profiles/:profileId')
  async updateLenderProfile(
    @Param('profileId') profileId: string,
    @Body() body: any,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    const updated = await this.rules.updateProfile(profileId, body || {}, organizationId);
    if (!updated) throw new BadRequestException('Lender profile not found');
    return updated;
  }

  @Post('lender-profiles/:profileId/delete')
  async deleteLenderProfile(
    @Param('profileId') profileId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    const removed = await this.rules.deleteProfile(profileId, organizationId);
    if (!removed) throw new BadRequestException('Lender profile not found or not editable');
    return removed;
  }

  /** Re-run the deterministic rules for one lead (after a lender edit). */
  @Post(':id/evaluate-rules')
  async evaluateRules(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    const result = await this.rules.evaluateLead(id, organizationId);
    if (!result) throw new BadRequestException('No extracted filing for this lead yet');
    return result;
  }

  /** The extracted 25-field filing for this lead, with per-field confidence. */
  @Get(':id/filing')
  async filingForLead(
    @Param('id') id: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.filings.forLead(id, organizationId);
  }

  /**
   * Correct extracted fields by hand. Every field in the body is marked
   * verified and is never overwritten by a later re-extraction.
   */
  @Patch('filings/:filingId')
  async updateFiling(
    @Param('filingId') filingId: string,
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    const updated = await this.filings.applyUserEdits(filingId, body || {}, organizationId);
    if (!updated) throw new BadRequestException('Filing not found or no valid fields supplied');
    return updated;
  }

  /** Every filing on this lead's case, newest first. Text is not included. */
  @Get(':id/documents')
  async documentsForLead(
    @Param('id') id: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.documents.listForLead(id, organizationId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    const updated = await this.foreclosures.update(id, body, organizationId);
    if (!updated) throw new BadRequestException('Foreclosure lead not found');
    return updated;
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD_OPTIONS))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @Headers('authorization') authHeader?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const { organizationId } = this.decodeToken(authHeader);
    const orgId = body.organizationId || organizationId || null;
    return this.importService.executeImport(file.buffer, { organizationId: orgId });
  }

  @Post('import/parse')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD_OPTIONS))
  async importParse(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.importService.parseUpload(file.buffer);
  }

  @Post('upload-pdf')
  @UseInterceptors(FileInterceptor('file', PDF_UPLOAD_OPTIONS))
  async uploadPdf(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @Headers('authorization') authHeader?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const { organizationId } = this.decodeToken(authHeader);
    const orgId = body.organizationId || organizationId || null;
    return this.ingest.ingestPdf(file.buffer, file.originalname, { organizationId: orgId });
  }

  /**
   * Set the work status on the checked leads. Marking a batch Dead from the
   * board goes through here.
   */
  @Post('bulk-status')
  async bulkStatus(
    @Body() body: { ids: string[]; status: string },
    @Headers('authorization') authHeader?: string,
  ) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      throw new BadRequestException('No lead ids provided');
    }
    if (!body?.status) throw new BadRequestException('status is required');
    const { organizationId } = this.decodeToken(authHeader);
    return this.foreclosures.bulkStatus(body.ids, body.status, organizationId);
  }

  @Post('bulk-delete')
  async bulkDelete(
    @Body() body: { ids: string[] },
    @Headers('authorization') authHeader?: string,
  ) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      throw new BadRequestException('No lead ids provided');
    }
    const { organizationId } = this.decodeToken(authHeader);
    return this.foreclosures.bulkDelete(body.ids, organizationId);
  }

  @Post('refresh')
  async refresh(@Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.ingest.ingestRssFeed({ organizationId, trigger: 'manual' });
  }

  /**
   * Fold duplicate leads for one property together. Destructive, so it
   * previews unless the body says apply:true - call it once to read the plan,
   * again to run it.
   */
  @Post('merge-duplicates')
  async mergeDuplicates(
    @Body() body: { apply?: boolean },
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.foreclosures.mergeDuplicates({ organizationId, apply: body?.apply === true });
  }

  @Post('bulk-skiptrace')
  async bulkSkiptrace(
    @Body() body: { ids: string[] },
    @Headers('authorization') authHeader?: string,
  ) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      throw new BadRequestException('No lead ids provided');
    }
    const { organizationId } = this.decodeToken(authHeader);
    return this.skiptrace.enrichMany(body.ids, organizationId);
  }

  @Post(':id/skiptrace')
  async runSkiptrace(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.skiptrace.enrichLead(id, organizationId);
  }
}
