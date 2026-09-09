import {
  Controller, Get, Post, Patch, Body, Param, Query, Headers,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as jwt from 'jsonwebtoken';
import { SurplusHeirsService } from './surplus-heirs.service';
import { SurplusService } from './surplus.service';
import { SurplusImportService } from './surplus-import.service';
import { SurplusIngestService } from './surplus-ingest.service';
import { SurplusSkiptraceService } from './surplus-skiptrace.service';
import { SurplusTemplatesService } from './surplus-templates.service';
import { SurplusCredibilityService, CredibilityChannel } from './surplus-credibility.service';
import { SurplusCountiesService, ACCEPTED_METHOD_LABEL } from './surplus-counties.service';
import { SurplusDocumentsService, DOCUMENT_MIME_TYPES, DOCUMENT_MAX_BYTES } from './surplus-documents.service';
import { StorageService } from '../storage/storage.service';
import { SurplusCadenceService } from './surplus-cadence.service';
import { COMPLIANCE_RULES, DISCLOSURE_LABELS, FL_COUNTIES, SURPLUS_FLOOR } from './surplus-compliance';

/**
 * A probate filing upload. PDFs only and capped, because this goes straight to
 * a vision model: a wrong file type wastes a call and a huge one fails halfway.
 */
/** A claim document: scans and photos of paper, capped at 20 MB. */
const DOCUMENT_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  fileFilter: (_req: any, file: any, cb: any) => {
    if (DOCUMENT_MIME_TYPES.includes(file.mimetype) || /\.(pdf|jpe?g|png|heic|webp)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new BadRequestException('Upload a PDF or an image (JPEG, PNG, HEIC, WebP)'), false);
    }
  },
  limits: { fileSize: DOCUMENT_MAX_BYTES },
};

const PDF_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  fileFilter: (_req: any, file: any, cb: any) => {
    if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname)) cb(null, true);
    else cb(new BadRequestException('Only PDF files are allowed'), false);
  },
  limits: { fileSize: 12 * 1024 * 1024 },
};

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

@Controller('surplus')
export class SurplusController {
  constructor(
    private surplus: SurplusService,
    private importService: SurplusImportService,
    private ingest: SurplusIngestService,
    private skiptrace: SurplusSkiptraceService,
    private heirs: SurplusHeirsService,
    private templates: SurplusTemplatesService,
    private credibility: SurplusCredibilityService,
    private counties: SurplusCountiesService,
    private documents: SurplusDocumentsService,
    private storage: StorageService,
    private cadence: SurplusCadenceService,
  ) {}

  private decodeToken(authHeader?: string): { userId?: string; organizationId?: string } {
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
    @Query('tier') tier?: string,
    @Query('queue') queue?: string,
    @Query('stage') stage?: string,
    @Query('claimantType') claimantType?: string,
    @Query('county') county?: string,
    @Query('band') band?: string,
    @Query('noticeAge') noticeAge?: string,
    @Query('lienWindow') lienWindow?: string,
    @Query('group') group?: string,
    @Query('claimStatus') claimStatus?: string,
    @Query('hideRetired') hideRetired?: string,
    @Query('blockedOnly') blockedOnly?: string,
    @Query('hideDead') hideDead?: string,
    @Query('hideDnc') hideDnc?: string,
    @Query('contact') contact?: string,
    @Query('missingChannel') missingChannel?: string,
    @Query('letterDue') letterDue?: string,
    @Query('updateOverdue') updateOverdue?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    const num = (v?: string) => (v == null || v === '' ? undefined : Number(v));
    return this.surplus.list({
      organizationId,
      search,
      tier,
      queue,
      stage,
      claimantType,
      county,
      band,
      noticeAge,
      lienWindow,
      group,
      claimStatus,
      hideRetired: hideRetired !== 'false',
      blockedOnly: blockedOnly === 'true',
      hideDead: hideDead === 'true',
      hideDnc: hideDnc === 'true',
      contact,
      missingChannel: missingChannel === 'true',
      letterDue: letterDue === 'true',
      updateOverdue: updateOverdue === 'true',
      sort,
      page: num(page),
      pageSize: num(pageSize),
    });
  }

  @Get('stats')
  async stats(@Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.surplus.stats(organizationId);
  }

  /**
   * The compliance table itself, so the board can show WHY a send is blocked
   * and when the rule was last checked rather than just refusing.
   */
  @Get('compliance-rules')
  async rules() {
    return {
      rules: COMPLIANCE_RULES,
      disclosureLabels: DISCLOSURE_LABELS,
      counties: FL_COUNTIES,
      surplusFloor: SURPLUS_FLOOR,
    };
  }

  /**
   * The last few county poll runs, for the health strip on the board. A poll
   * that has been failing for a week should be visible without reading logs.
   */
  @Get('poll-runs')
  async pollRuns(@Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return {
      runs: await this.ingest.recentRuns(organizationId),
      // Cadence travels with the source so the board can judge staleness per
      // feed: a weekly pull is not late after thirty hours.
      sources: this.ingest
        .adapters()
        .map((a) => ({ key: a.key, county: a.county, cadence: a.cadence })),
    };
  }

  /**
   * Connect rate by weekday and hour for surplus calls, so the team's best
   * calling windows come from the call log rather than a hunch.
   */
  @Get('call-stats')
  async callStats(@Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.surplus.callStats(organizationId);
  }

  /**
   * Run the two follow-up cadences now rather than at 6:15. For checking
   * the rule against real claims without waiting for the morning.
   */
  @Post('cadence/run')
  async runCadence() {
    return this.cadence.runOnce();
  }

  // ── Scripts and letters, versioned ────────────────────────────────────────

  /** Every template kind with its active version, or the built-in default. */
  @Get('templates')
  async listTemplates(@Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.templates.list(organizationId);
  }

  @Get('templates/:kind/versions')
  async templateVersions(
    @Param('kind') kind: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.templates.versions(organizationId, kind);
  }

  /** Save an edit as the next version and make it the active one. */
  @Post('templates/:kind')
  async saveTemplate(
    @Param('kind') kind: string,
    @Body() body: { body: string; name?: string; subject?: string; notes?: string },
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId, userId } = this.decodeToken(authHeader);
    return this.templates.save(organizationId, kind, body, userId);
  }

  /** Make an earlier version the active one again. */
  @Post('templates/:kind/activate')
  async activateTemplate(
    @Param('kind') kind: string,
    @Body() body: { version: number },
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.templates.activate(organizationId, kind, Number(body?.version));
  }

  // ── Counties ──────────────────────────────────────────────────────────────

  /**
   * What each county requires to file. Seeded from the code list on first
   * read; the feed key says which counties have an automated pull.
   */
  @Get('counties')
  async listCounties(@Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    const feeds = this.ingest.adapters();
    const counties = await this.counties.list(organizationId);
    return {
      counties: counties.map((c) => ({
        ...c,
        feedKey: feeds.find((a) => a.county.toLowerCase() === c.name.toLowerCase())?.key || null,
      })),
      methodLabels: ACCEPTED_METHOD_LABEL,
    };
  }

  @Post('counties')
  async createCounty(@Body() body: { name: string }, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.counties.create(organizationId, body?.name);
  }

  @Patch('counties/:countyId')
  async updateCounty(
    @Param('countyId') countyId: string,
    @Body() body: any,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.counties.update(countyId, body || {}, organizationId);
  }

  /** The county's own claim form, stored. PDF only. */
  @Post('counties/:countyId/claim-form')
  @UseInterceptors(FileInterceptor('file', PDF_UPLOAD_OPTIONS))
  async uploadCountyForm(
    @Param('countyId') countyId: string,
    @UploadedFile() file: Express.Multer.File,
    @Headers('authorization') authHeader?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const { organizationId } = this.decodeToken(authHeader);
    return this.counties.uploadClaimForm(countyId, file, organizationId);
  }

  @Get('counties/:countyId/claim-form/url')
  async countyFormUrl(@Param('countyId') countyId: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.counties.claimFormUrl(countyId, organizationId);
  }

  @Post('counties/:countyId/claim-form/delete')
  async removeCountyForm(@Param('countyId') countyId: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.counties.removeClaimForm(countyId, organizationId);
  }

  // ── Documents ─────────────────────────────────────────────────────────────

  /** Whether files can be stored at all, for the settings page and the panel. */
  @Get('storage/status')
  async storageStatus() {
    return { configured: this.storage.configured(), ...(await this.storage.ping()) };
  }

  /** The document checklist for one claim, with what is still missing. */
  @Get(':id/documents')
  async listDocuments(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.documents.list(id, organizationId);
  }

  /** Attach a file to one document kind. Replaces any file already on it. */
  @Post(':id/documents/:kind')
  @UseInterceptors(FileInterceptor('file', DOCUMENT_UPLOAD_OPTIONS))
  async uploadDocument(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { status?: string; note?: string },
    @Headers('authorization') authHeader?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const { organizationId, userId } = this.decodeToken(authHeader);
    return this.documents.upload(id, kind, file, body || {}, organizationId, userId);
  }

  /** Move a document's status without a file: ticked from paper. */
  @Patch(':id/documents/:kind')
  async setDocumentStatus(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() body: { status: string; note?: string | null; signedAt?: string | null },
    @Headers('authorization') authHeader?: string,
  ) {
    if (!body?.status) throw new BadRequestException('status is required');
    const { organizationId, userId } = this.decodeToken(authHeader);
    return this.documents.setStatus(id, kind, body, organizationId, userId);
  }

  /**
   * One of our standard documents for a claim, rendered from its template
   * for the print page. Records nothing until marked drafted from there.
   */
  @Get(':id/document-draft')
  async documentDraft(
    @Param('id') id: string,
    @Query('kind') kind?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    if (!kind) throw new BadRequestException('kind is required');
    const { organizationId, userId } = this.decodeToken(authHeader);
    const out = await this.templates.documentFor(id, kind, organizationId, userId);
    if (!out) throw new BadRequestException('Surplus lead not found');
    return out;
  }

  // ── Disbursement ──────────────────────────────────────────────────────────

  @Get(':id/expenses')
  async listExpenses(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.surplus.listExpenses(id, organizationId);
  }

  @Post(':id/expenses')
  async addExpense(
    @Param('id') id: string,
    @Body() body: { kind: string; amount: number; incurredAt?: string | null; note?: string | null },
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId, userId } = this.decodeToken(authHeader);
    return this.surplus.addExpense(id, body || ({} as any), organizationId, userId);
  }

  @Post('expenses/:expenseId/delete')
  async removeExpense(@Param('expenseId') expenseId: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.surplus.removeExpense(expenseId, organizationId);
  }

  /** The disbursement report for the print page: expenses, fee, both shares, the cap check. */
  @Get(':id/disbursement-report')
  async disbursementReport(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.surplus.disbursementReport(id, organizationId);
  }

  /**
   * The mobile notary packet for the print page: the instruction sheet as a
   * cover, then the documents for this appointment in signing order. The
   * assignment is withheld until retention is confirmed unless the whole
   * set is asked for.
   */
  @Get(':id/notary-packet')
  async notaryPacket(
    @Param('id') id: string,
    @Query('includeAll') includeAll?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId, userId } = this.decodeToken(authHeader);
    const out = await this.templates.notaryPacket(id, { includeAll: includeAll === 'true' }, organizationId, userId);
    if (!out) throw new BadRequestException('Surplus lead not found');
    return out;
  }

  /** A five-minute link to the file itself. */
  @Get('documents/:docId/url')
  async documentUrl(@Param('docId') docId: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.documents.signedUrl(docId, organizationId);
  }

  /** Detach the file and reset the checklist entry to outstanding. */
  @Post('documents/:docId/delete')
  async removeDocument(@Param('docId') docId: string, @Headers('authorization') authHeader?: string) {
    const { organizationId, userId } = this.decodeToken(authHeader);
    return this.documents.remove(docId, organizationId, userId);
  }

  /** The answers were just checked with the clerk. Resets the 180-day clock. */
  @Post('counties/:countyId/verified')
  async verifyCounty(@Param('countyId') countyId: string, @Headers('authorization') authHeader?: string) {
    const { organizationId, userId } = this.decodeToken(authHeader);
    return this.counties.markVerified(countyId, organizationId, userId);
  }

  /** Whether the credibility packet can be sent, and what is missing if not. */
  @Get('credibility/status')
  credibilityStatus() {
    return this.templates.credibilityReadiness();
  }

  /**
   * Send the credibility packet (website, Sunbiz filing, one-pager, callback
   * number) to one claimant by text, email, or both, as Dig Deeper.
   */
  @Post(':id/credibility')
  async sendCredibility(
    @Param('id') id: string,
    @Body() body: { channels: CredibilityChannel[]; phone?: string | null; email?: string | null },
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId, userId } = this.decodeToken(authHeader);
    return this.credibility.send(id, body || { channels: [] }, organizationId, userId);
  }

  /**
   * The scripts for one claimant, merge fields filled, plus the facts the
   * caller needs on screen. What the dialer shows during a surplus call.
   */
  @Get(':id/script')
  async script(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const { organizationId, userId } = this.decodeToken(authHeader);
    const out = await this.templates.scriptFor(id, organizationId, userId);
    if (!out) throw new BadRequestException('Surplus lead not found');
    return out;
  }

  /**
   * A fresh link to one county document.
   *
   * RealTDM hands out pre-signed S3 URLs that expire within the hour, so the
   * ledger stores the document id and the link is minted when somebody clicks
   * it. Duval links are durable and never come through here.
   */
  @Get('document-link')
  async documentLink(
    @Query('source') source?: string,
    @Query('docId') docId?: string,
    @Query('docType') docType?: string,
  ) {
    const adapter = source ? this.ingest.adapterFor(source) : undefined;
    if (!adapter?.resolveDocumentUrl) {
      throw new BadRequestException(`No document links for source "${source || ''}"`);
    }
    if (!docId) throw new BadRequestException('docId is required');
    const url = await adapter.resolveDocumentUrl({ docId, docType: docType || null });
    if (!url) throw new BadRequestException('The county did not return a link for that document');
    return { url };
  }

  /**
   * Run a county ingest now. `limit` caps the detail fetches, which is what a
   * discovery pass on a new county wants: pull ten cases, look at what came
   * back, and only then let the cron loose on the whole docket.
   */
  @Post('poll')
  async poll(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    const source = body?.source || 'duval_taxdeed';
    if (!this.ingest.adapterFor(source)) {
      throw new BadRequestException(`Unknown surplus source "${source}"`);
    }
    const limit = body?.limit == null ? undefined : Number(body.limit);
    if (limit != null && (!Number.isFinite(limit) || limit < 1)) {
      throw new BadRequestException('limit must be a positive number');
    }
    return this.ingest.ingestCounty(source, {
      organizationId: body?.organizationId || organizationId || null,
      trigger: 'manual',
      limit,
      // Re-read notices and correct the addresses they produced. Off by
      // default: a notice read costs a vision call and its answer does not
      // change between polls. Asked for when the EXTRACTOR changed.
      reread: body?.reread === true,
      // Fetch every case in full rather than probing held ones for changes.
      // Off by default: the tiered refresh is what keeps a weekly county pull
      // a few hundred requests instead of a few thousand.
      full: body?.full === true,
    });
  }

  /**
   * Skip trace surplus claimants through BatchData.
   *
   * `limit` caps the number of ADDRESSES submitted, which is what costs credits,
   * not the number of leads touched: co-owners at one property share a single
   * submission because BatchData matches on address and ignores names.
   *
   * Deliberately a manual call rather than something ingestion does on its own.
   * Every submission spends money, and a trace of a property that has just sold
   * at auction often returns the new occupant rather than the former owner.
   */
  @Post('skip-trace')
  async skipTrace(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    const limit = body?.limit == null ? undefined : Number(body.limit);
    if (limit != null && (!Number.isFinite(limit) || limit < 1)) {
      throw new BadRequestException('limit must be a positive number');
    }
    return this.skiptrace.traceLeads({
      organizationId: body?.organizationId || organizationId || null,
      leadIds: Array.isArray(body?.leadIds) ? body.leadIds : undefined,
      limit,
      includeTraced: body?.includeTraced === true,
    });
  }

  // ─── Heirs of a deceased claimant ─────────────────────────────────────────

  /** Heirs on file for a claimant, living first. */
  @Get(':id/heirs')
  async listHeirs(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return { heirs: await this.heirs.list(id, organizationId) };
  }

  /**
   * Read an uploaded probate filing and return the heirs for confirmation.
   *
   * Deliberately does NOT save. The one judgement a document cannot make for
   * itself is whether this case belongs to this claimant, so a person confirms
   * before anything is written: a wrong heir is a stranger being told they have
   * money coming.
   */
  @Post(':id/heirs/read-filing')
  @UseInterceptors(FileInterceptor('file', PDF_UPLOAD_OPTIONS))
  async readFiling(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Headers('authorization') authHeader?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const { organizationId } = this.decodeToken(authHeader);
    try {
      return await this.heirs.preview(id, file.buffer, file.originalname, organizationId);
    } catch (e: any) {
      // Surface the reason. This is somebody waiting on an upload they just
      // made, not a background job that can fall back to something else.
      throw new BadRequestException(e?.message || 'That filing could not be read.');
    }
  }

  /** Save the confirmed heirs onto the claimant. */
  @Post(':id/heirs')
  async saveHeirs(
    @Param('id') id: string,
    @Body() body: { heirs: any[]; caseNumber?: string; sourceDocument?: string },
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId, userId } = this.decodeToken(authHeader);
    if (!Array.isArray(body?.heirs) || !body.heirs.length) {
      throw new BadRequestException('No heirs to save');
    }
    const saved = await this.heirs.save(
      id,
      body.heirs,
      { caseNumber: body.caseNumber, sourceDocument: body.sourceDocument, userId },
      organizationId,
    );
    return { ...saved, heirs: await this.heirs.list(id, organizationId) };
  }

  @Patch('heirs/:heirId')
  async updateHeir(
    @Param('heirId') heirId: string,
    @Body() body: any,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.heirs.update(heirId, body, organizationId);
  }

  @Post('heirs/:heirId/delete')
  async deleteHeir(
    @Param('heirId') heirId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.heirs.remove(heirId, organizationId);
  }

  /**
   * Skip trace heirs at their own addresses from the filing.
   *
   * Separate from the claimant trace because the target is better: an address
   * off a recent probate petition beats one off a notice the clerk's own mail
   * came back from. A deceased heir is refused rather than submitted.
   */
  @Post('heirs/skip-trace')
  async skipTraceHeirs(
    @Body() body: { heirIds?: string[]; limit?: number; includeTraced?: boolean },
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    const limit = body?.limit == null ? undefined : Number(body.limit);
    if (limit != null && (!Number.isFinite(limit) || limit < 1)) {
      throw new BadRequestException('limit must be a positive number');
    }
    return this.skiptrace.traceHeirs({
      organizationId,
      heirIds: Array.isArray(body?.heirIds) ? body.heirIds : undefined,
      limit,
      includeTraced: body?.includeTraced === true,
    });
  }

  @Post('import/parse')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD_OPTIONS))
  async importParse(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.importService.parseUpload(file.buffer);
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
    return this.importService.executeImport(file.buffer, {
      organizationId: body.organizationId || organizationId || null,
      importBatch: body.importBatch || file.originalname,
      dryRun: body.dryRun === true || body.dryRun === 'true',
      // Optional: names the county for a file that does not carry one.
      county: body.county || undefined,
    });
  }

  @Post()
  async create(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    if (!body?.claimant) throw new BadRequestException('claimant is required');
    const res = await this.surplus.createSurplusLead(body, { organizationId });
    if (!res.created) throw new BadRequestException(res.reason || 'Lead was not created');
    return this.surplus.get(res.leadId!, organizationId);
  }

  @Post('bulk-delete')
  async bulkDelete(@Body() body: { ids: string[] }, @Headers('authorization') authHeader?: string) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      throw new BadRequestException('No lead ids provided');
    }
    const { organizationId } = this.decodeToken(authHeader);
    return this.surplus.bulkDelete(body.ids, organizationId);
  }

  /**
   * A letter went out. One id from the panel or a rack of them from the board;
   * the date defaults to today and the address to where the clerk wrote to
   * each claimant.
   */
  @Post('letter-mailed')
  async letterMailed(
    @Body()
    body: {
      ids: string[];
      mailedAt?: string | null;
      address?: string | null;
      note?: string | null;
      mailType?: string | null;
      trackingNumber?: string | null;
      templateKind?: string | null;
      templateVersion?: number | null;
      recipientName?: string | null;
      heirId?: string | null;
    },
    @Headers('authorization') authHeader?: string,
  ) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      throw new BadRequestException('No lead ids provided');
    }
    const { userId, organizationId } = this.decodeToken(authHeader);
    const { ids, ...opts } = body;
    return this.surplus.markLetterMailed(ids, opts, userId, organizationId);
  }

  /** Take one envelope out of the history. Re-caches the latest for the queue. */
  @Post('letters/:letterId/delete')
  async removeLetter(@Param('letterId') letterId: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.surplus.removeLetter(letterId, organizationId);
  }

  /**
   * A letter for one claimant or heir, rendered from the template of that
   * kind, ready for the print view. Nothing is recorded until the person
   * says it was mailed.
   */
  @Get(':id/letter')
  async letter(
    @Param('id') id: string,
    @Query('kind') kind?: string,
    @Query('heirId') heirId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId, userId } = this.decodeToken(authHeader);
    const out = await this.templates.letterFor(id, kind || 'letter_claimant', heirId || null, organizationId, userId);
    if (!out) throw new BadRequestException('Surplus lead not found');
    return out;
  }

  /**
   * Bulk stage change, including marking dead. The board can select a rack of
   * properties and clear them in one call.
   */
  @Post('bulk-stage')
  async bulkStage(
    @Body() body: { ids: string[]; stage: string; deadReason?: string | null; deadNote?: string | null },
    @Headers('authorization') authHeader?: string,
  ) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      throw new BadRequestException('No lead ids provided');
    }
    if (!body?.stage) throw new BadRequestException('stage is required');
    const { organizationId, userId } = this.decodeToken(authHeader);
    return this.surplus.bulkStage(body.ids, body.stage, organizationId, userId, {
      reason: body.deadReason,
      note: body.deadNote,
    });
  }

  @Get(':id')
  async get(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    const row = await this.surplus.get(id, organizationId);
    if (!row) throw new BadRequestException('Surplus lead not found');
    return row;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId, userId } = this.decodeToken(authHeader);
    const updated = await this.surplus.update(id, body, organizationId, userId);
    if (!updated) throw new BadRequestException('Surplus lead not found');
    return updated;
  }
}
