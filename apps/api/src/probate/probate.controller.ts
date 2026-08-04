import {
  Controller, Post, Body, Headers,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import * as jwt from 'jsonwebtoken';
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
  constructor(private importService: ProbateImportService) {}

  private decodeToken(authHeader?: string): { userId?: string; organizationId?: string } {
    try {
      const token = authHeader?.replace('Bearer ', '');
      if (!token) return {};
      return (jwt.decode(token) as any) || {};
    } catch {
      return {};
    }
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
}
