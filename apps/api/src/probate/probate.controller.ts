import {
  Controller, Get, Post, Patch, Body, Param, Query, Headers,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as jwt from 'jsonwebtoken';
import { ProbateService } from './probate.service';
import { ProbateImportService } from './probate-import.service';

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

@Controller('probate')
export class ProbateController {
  constructor(
    private probate: ProbateService,
    private importService: ProbateImportService,
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

  /** Probate leads grouped by contact, paginated by group. */
  @Get()
  async list(
    @Headers('authorization') authHeader?: string,
    @Query('search') search?: string,
    @Query('tier') tier?: string,
    @Query('county') county?: string,
    @Query('city') city?: string,
    @Query('workStatus') workStatus?: string,
    @Query('deathWindow') deathWindow?: string,
    @Query('absentee') absentee?: string,
    @Query('valueMin') valueMin?: string,
    @Query('hideDead') hideDead?: string,
    @Query('hideDnc') hideDnc?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.probate.list({
      organizationId,
      search,
      tier,
      county,
      city,
      workStatus,
      deathWindow,
      absentee,
      valueMin: valueMin ? Number(valueMin) : undefined,
      hideDead: hideDead === 'true',
      hideDnc: hideDnc === 'true',
      sort,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('stats')
  async stats(@Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.probate.stats(organizationId);
  }

  /** Headers, per-tier counts and a few sample rows, without writing anything. */
  @Post('import/parse')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD_OPTIONS))
  async importParse(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.importService.parseUpload(file.buffer);
  }

  /**
   * Import a probate list. `tier` restricts to one consensus tier (send 1 to
   * load only "Attack First"); omit it to take every row. `dryRun` reports
   * what would be created without writing.
   */
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

    const tier = body.tier == null || body.tier === '' ? null : Number(body.tier);
    if (tier != null && !Number.isFinite(tier)) {
      throw new BadRequestException('tier must be a number');
    }

    return this.importService.executeImport(file.buffer, {
      organizationId: orgId,
      tier,
      importBatch: body.importBatch || file.originalname,
      dryRun: body.dryRun === true || body.dryRun === 'true',
    });
  }

  /**
   * Set the work status on the checked leads. Marking a batch Dead from the
   * board goes through here.
   */
  @Post('bulk-status')
  async bulkStatus(
    @Body() body: { contactKeys: string[]; status: string },
    @Headers('authorization') authHeader?: string,
  ) {
    if (!Array.isArray(body?.contactKeys) || body.contactKeys.length === 0) {
      throw new BadRequestException('No contacts provided');
    }
    if (!body?.status) throw new BadRequestException('status is required');
    const { organizationId } = this.decodeToken(authHeader);
    return this.probate.bulkStatus(body.contactKeys, body.status, organizationId);
  }

  /** Delete every lead belonging to the checked heirs. */
  @Post('bulk-delete-contacts')
  async bulkDeleteContacts(
    @Body() body: { contactKeys: string[] },
    @Headers('authorization') authHeader?: string,
  ) {
    if (!Array.isArray(body?.contactKeys) || body.contactKeys.length === 0) {
      throw new BadRequestException('No contacts provided');
    }
    const { organizationId } = this.decodeToken(authHeader);
    return this.probate.bulkDeleteContacts(body.contactKeys, organizationId);
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
    return this.probate.bulkDelete(body.ids, organizationId);
  }

  /**
   * Apply a working-field change across every property one heir holds. Ticking
   * "do not call" has to cover all of them, not just the row that was clicked.
   */
  @Patch('contacts/:contactKey')
  async updateContact(
    @Param('contactKey') contactKey: string,
    @Body() body: { workStatus?: string; doNotCall?: boolean },
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.probate.updateContact(decodeURIComponent(contactKey), body, organizationId);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    const lead = await this.probate.get(id, organizationId);
    if (!lead) throw new BadRequestException('Probate lead not found');
    return lead;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { workStatus?: string; doNotCall?: boolean; callNotes?: string },
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    const updated = await this.probate.update(id, body, organizationId);
    if (!updated) throw new BadRequestException('Probate lead not found');
    return updated;
  }
}
