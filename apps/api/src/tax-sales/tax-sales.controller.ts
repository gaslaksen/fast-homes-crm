import {
  Controller, Get, Post, Patch, Body, Param, Query, Headers,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as jwt from 'jsonwebtoken';
import { TaxSalesService } from './tax-sales.service';
import { TaxSaleImportService } from './tax-sale-import.service';

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

@Controller('tax-sales')
export class TaxSalesController {
  constructor(
    private taxSales: TaxSalesService,
    private importService: TaxSaleImportService,
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
    @Query('priority') priority?: string,
    @Query('workStatus') workStatus?: string,
    @Query('stage') stage?: string,
    @Query('method') method?: string,
    @Query('county') county?: string,
    @Query('city') city?: string,
    @Query('propertyType') propertyType?: string,
    @Query('occupancy') occupancy?: string,
    @Query('equityMin') equityMin?: string,
    @Query('yearsMin') yearsMin?: string,
    @Query('saleWithinDays') saleWithinDays?: string,
    @Query('payoffBand') payoffBand?: string,
    @Query('phoneStatus') phoneStatus?: string,
    @Query('hideRedeemed') hideRedeemed?: string,
    @Query('hideDnc') hideDnc?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    const num = (v?: string) => (v == null || v === '' ? undefined : Number(v));
    return this.taxSales.list({
      organizationId,
      search,
      priority,
      workStatus,
      stage,
      method,
      county,
      city,
      propertyType,
      occupancy,
      equityMin: num(equityMin),
      yearsMin: num(yearsMin),
      saleWithinDays: num(saleWithinDays),
      payoffBand,
      phoneStatus,
      hideRedeemed: hideRedeemed === 'true',
      hideDnc: hideDnc === 'true',
      sort,
      page: num(page),
      pageSize: num(pageSize),
    });
  }

  @Get('stats')
  async stats(@Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    return this.taxSales.stats(organizationId);
  }

  /** Headers, matched-column count and a few sample rows, without writing. */
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
    });
  }

  /** One lead off the Add lead sheet. */
  @Post()
  async create(@Body() body: any, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    if (!body?.address) throw new BadRequestException('address is required');
    const res = await this.taxSales.createTaxSaleLead(body, { organizationId });
    if (!res.created) {
      throw new BadRequestException(res.reason || 'Lead was not created');
    }
    return this.taxSales.get(res.leadId!, organizationId);
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
    return this.taxSales.bulkStatus(body.ids, body.status, organizationId);
  }

  @Post('bulk-delete')
  async bulkDelete(@Body() body: { ids: string[] }, @Headers('authorization') authHeader?: string) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      throw new BadRequestException('No lead ids provided');
    }
    const { organizationId } = this.decodeToken(authHeader);
    return this.taxSales.bulkDelete(body.ids, organizationId);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Headers('authorization') authHeader?: string) {
    const { organizationId } = this.decodeToken(authHeader);
    const row = await this.taxSales.get(id, organizationId);
    if (!row) throw new BadRequestException('Tax sale lead not found');
    return row;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: any,
    @Headers('authorization') authHeader?: string,
  ) {
    const { organizationId } = this.decodeToken(authHeader);
    const updated = await this.taxSales.update(id, body, organizationId);
    if (!updated) throw new BadRequestException('Tax sale lead not found');
    return updated;
  }
}
