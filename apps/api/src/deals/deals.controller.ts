import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { LeadStatus } from '@fast-homes/shared';
import { DealsService } from './deals.service';
import {
  DealsListFilters,
  DealsViewSortKey,
  ProfitBucket,
} from './deals.types';

@Controller('deals')
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  private requireAuth(authHeader?: string) {
    try {
      const token = authHeader?.replace('Bearer ', '');
      if (!token) throw new UnauthorizedException('Authentication required');
      const decoded = (jwt.decode(token) as any) || {};
      if (!decoded.organizationId) {
        throw new UnauthorizedException('Authentication required');
      }
      return decoded as { userId: string; organizationId: string; role?: string };
    } catch {
      throw new UnauthorizedException('Authentication required');
    }
  }

  @Get('summary')
  async getSummary(
    @Headers('authorization') authHeader: string,
    @Query('realizedFrom') realizedFrom?: string,
    @Query('realizedTo') realizedTo?: string,
  ) {
    const { organizationId } = this.requireAuth(authHeader);
    return this.dealsService.getSummary({
      organizationId,
      realizedFrom: realizedFrom ? new Date(realizedFrom) : undefined,
      realizedTo: realizedTo ? new Date(realizedTo) : undefined,
    });
  }

  @Get()
  async listDeals(
    @Headers('authorization') authHeader: string,
    @Query('status') status?: string,
    @Query('bucket') bucket?: string,
    @Query('exitStrategy') exitStrategy?: string,
    @Query('hasJvPartner') hasJvPartner?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('acquiredFrom') acquiredFrom?: string,
    @Query('acquiredTo') acquiredTo?: string,
    @Query('soldFrom') soldFrom?: string,
    @Query('soldTo') soldTo?: string,
  ) {
    const { organizationId } = this.requireAuth(authHeader);
    return this.dealsService.listDeals(
      this.parseFilters(organizationId, {
        status,
        bucket,
        exitStrategy,
        hasJvPartner,
        search,
        sort,
        dir,
        page,
        limit,
        acquiredFrom,
        acquiredTo,
        soldFrom,
        soldTo,
      }),
    );
  }

  @Post('export-csv')
  async exportCsv(
    @Headers('authorization') authHeader: string,
    @Body() body: Record<string, any>,
    @Res() res: Response,
  ) {
    const { organizationId } = this.requireAuth(authHeader);
    const filters = this.parseFilters(organizationId, {
      ...body,
      status: arrayToString(body.status),
      bucket: arrayToString(body.bucket),
      exitStrategy: arrayToString(body.exitStrategy),
      hasJvPartner: body.hasJvPartner ? String(body.hasJvPartner) : undefined,
    });
    const csv = await this.dealsService.exportCsv(filters);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="deals-export-${Date.now()}.csv"`,
    );
    res.send(csv);
  }

  private parseFilters(
    organizationId: string,
    raw: {
      status?: string;
      bucket?: string;
      exitStrategy?: string;
      hasJvPartner?: string;
      search?: string;
      sort?: string;
      dir?: string;
      page?: string;
      limit?: string;
      acquiredFrom?: string;
      acquiredTo?: string;
      soldFrom?: string;
      soldTo?: string;
    },
  ): DealsListFilters {
    return {
      organizationId,
      status: parseCsvList(raw.status) as LeadStatus[] | undefined,
      bucket: parseCsvList(raw.bucket) as ProfitBucket[] | undefined,
      exitStrategy: parseCsvList(raw.exitStrategy),
      hasJvPartner: raw.hasJvPartner === 'true' ? true : undefined,
      search: raw.search?.trim() || undefined,
      sort: (raw.sort as DealsViewSortKey) || 'profit',
      dir: raw.dir === 'asc' ? 'asc' : 'desc',
      page: raw.page ? Math.max(1, parseInt(raw.page, 10)) : 1,
      limit: raw.limit ? Math.min(200, Math.max(1, parseInt(raw.limit, 10))) : 25,
      acquiredFrom: raw.acquiredFrom ? new Date(raw.acquiredFrom) : undefined,
      acquiredTo: raw.acquiredTo ? new Date(raw.acquiredTo) : undefined,
      soldFrom: raw.soldFrom ? new Date(raw.soldFrom) : undefined,
      soldTo: raw.soldTo ? new Date(raw.soldTo) : undefined,
    };
  }
}

function parseCsvList(v?: string): string[] | undefined {
  if (!v) return undefined;
  const parts = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function arrayToString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.join(',');
  return String(v);
}
