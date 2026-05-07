import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AiArvCalculationService } from './ai-arv-calculation.service';
import type { ValuationMode } from './types/arv-result';

interface DecodedToken {
  userId?: string;
  organizationId?: string;
}

interface CalculateBody {
  mode?: string;
  forceRefresh?: boolean;
  selectedCompIds?: string[];
}

@Controller()
export class AiArvCalculationController {
  private readonly logger = new Logger(AiArvCalculationController.name);

  constructor(private readonly service: AiArvCalculationService) {}

  @Get('leads/:leadId/arv-calculation/_ping')
  ping(@Param('leadId') leadId: string) {
    this.logger.log(`arv-calculation _ping for lead ${leadId}`);
    return { ok: true, leadId, service: 'ai-arv-calculation' };
  }

  @Get('leads/:leadId/arv-calculation')
  async getLatest(
    @Param('leadId') leadId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    this.requireUser(authHeader);
    const result = await this.service.getLatestForLead(leadId);
    return { result };
  }

  @Get('leads/:leadId/arv-calculation/history')
  async getHistory(
    @Param('leadId') leadId: string,
    @Query('limit') limit?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    this.requireUser(authHeader);
    const lim = limit ? Math.max(1, Math.min(100, Number(limit) || 20)) : 20;
    const items = await this.service.getHistoryForLead(leadId, lim);
    return { items };
  }

  @Post('leads/:leadId/arv-calculation')
  async calculate(
    @Param('leadId') leadId: string,
    @Body() body: CalculateBody,
    @Headers('authorization') authHeader?: string,
  ) {
    const { userId } = this.requireUser(authHeader);
    const mode = parseMode(body?.mode);
    const result = await this.service.calculate({
      leadId,
      mode,
      userId,
      forceRefresh: body?.forceRefresh === true,
      selectedCompIds: Array.isArray(body?.selectedCompIds)
        ? body!.selectedCompIds.filter(
            (s): s is string => typeof s === 'string' && s.length > 0,
          )
        : undefined,
    });
    return { result };
  }

  private requireUser(authHeader?: string): { userId: string } {
    try {
      const token = authHeader?.replace('Bearer ', '');
      const decoded = (token ? (jwt.decode(token) as DecodedToken) : null) || {};
      if (!decoded.userId) throw new UnauthorizedException('Missing user token');
      return { userId: decoded.userId };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid auth token');
    }
  }
}

function parseMode(raw: string | undefined): ValuationMode {
  if (!raw) {
    throw new BadRequestException(
      'mode is required (ARV_RENOVATED or AS_IS)',
    );
  }
  const k = raw.trim().toUpperCase().replace(/[\s-]/g, '_');
  if (k === 'ARV_RENOVATED' || k === 'ARV' || k === 'RENOVATED') {
    return 'ARV_RENOVATED';
  }
  if (k === 'AS_IS' || k === 'ASIS' || k === 'AS') {
    return 'AS_IS';
  }
  throw new BadRequestException(`Unrecognized mode: ${raw}`);
}
