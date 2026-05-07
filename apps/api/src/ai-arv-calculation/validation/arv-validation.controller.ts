import {
  Controller,
  Headers,
  Logger,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { ArvValidationService } from './arv-validation.service';
import type { ValuationMode } from '../types/arv-result';

@Controller('admin/arv-validation')
export class ArvValidationController {
  private readonly logger = new Logger(ArvValidationController.name);

  constructor(private readonly service: ArvValidationService) {}

  @Post('run')
  async run(
    @Query('mode') mode?: string,
    @Query('forceRefresh') forceRefresh?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    this.requireUser(authHeader);
    const parsedMode = parseMode(mode);
    const report = await this.service.scoreAgainstValidationSet({
      mode: parsedMode,
      forceRefresh: forceRefresh === 'true',
    });
    this.logger.log(
      `arv-validation run: total=${report.totalEntries} evaluable=${report.evaluable} passed=${report.passed} meanAbsPct=${report.meanAbsPct}`,
    );
    return report;
  }

  private requireUser(authHeader?: string): void {
    try {
      const token = authHeader?.replace('Bearer ', '');
      const decoded = token ? (jwt.decode(token) as { userId?: string }) : null;
      if (!decoded?.userId) throw new UnauthorizedException('Missing user token');
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid auth token');
    }
  }
}

function parseMode(raw: string | undefined): ValuationMode | undefined {
  if (!raw) return undefined;
  const k = raw.trim().toUpperCase().replace(/[\s-]/g, '_');
  if (k === 'AS_IS' || k === 'ASIS') return 'AS_IS';
  if (k === 'ARV_RENOVATED' || k === 'ARV' || k === 'RENOVATED') {
    return 'ARV_RENOVATED';
  }
  return undefined;
}
