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
    @Query('occupancy') occupancy?: string,
    @Query('equityMin') equityMin?: string,
    @Query('saleWithinDays') saleWithinDays?: string,
    @Query('sort') sort?: string,
    @Query('includeDead') includeDead?: string,
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
      occupancy,
      equityMin: equityMin ? Number(equityMin) : undefined,
      saleWithinDays: saleWithinDays ? Number(saleWithinDays) : undefined,
      sort,
      includeDead: includeDead === 'true',
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
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

  @Post('refresh')
  async refresh(@Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.ingest.ingestRssFeed({ organizationId });
  }

  @Post(':id/skiptrace')
  async runSkiptrace(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.skiptrace.enrichLead(id, organizationId);
  }
}
