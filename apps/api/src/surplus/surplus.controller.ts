import {
  Controller, Get, Post, Patch, Body, Param, Query, Headers,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as jwt from 'jsonwebtoken';
import { SurplusService } from './surplus.service';
import { SurplusImportService } from './surplus-import.service';
import { SurplusIngestService } from './surplus-ingest.service';
import { SurplusSkiptraceService } from './surplus-skiptrace.service';
import { COMPLIANCE_RULES, DISCLOSURE_LABELS, FL_COUNTIES, SURPLUS_FLOOR } from './surplus-compliance';

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
