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
import { COMPLIANCE_RULES, DISCLOSURE_LABELS, FL_COUNTIES, SURPLUS_FLOOR } from './surplus-compliance';

/**
 * A probate filing upload. PDFs only and capped, because this goes straight to
 * a vision model: a wrong file type wastes a call and a huge one fails halfway.
 */
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
      sources: this.ingest.adapters().map((a) => ({ key: a.key, county: a.county })),
    };
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
    @Body() body: { ids: string[]; mailedAt?: string | null; address?: string | null; note?: string | null },
    @Headers('authorization') authHeader?: string,
  ) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      throw new BadRequestException('No lead ids provided');
    }
    const { userId, organizationId } = this.decodeToken(authHeader);
    return this.surplus.markLetterMailed(
      body.ids,
      { mailedAt: body.mailedAt, address: body.address, note: body.note },
      userId,
      organizationId,
    );
  }

  /**
   * Bulk stage change, including marking dead. The board can select a rack of
   * properties and clear them in one call.
   */
  @Post('bulk-stage')
  async bulkStage(
    @Body() body: { ids: string[]; stage: string },
    @Headers('authorization') authHeader?: string,
  ) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      throw new BadRequestException('No lead ids provided');
    }
    if (!body?.stage) throw new BadRequestException('stage is required');
    const { organizationId } = this.decodeToken(authHeader);
    return this.surplus.bulkStage(body.ids, body.stage, organizationId);
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
    const { organizationId } = this.decodeToken(authHeader);
    const updated = await this.surplus.update(id, body, organizationId);
    if (!updated) throw new BadRequestException('Surplus lead not found');
    return updated;
  }
}
