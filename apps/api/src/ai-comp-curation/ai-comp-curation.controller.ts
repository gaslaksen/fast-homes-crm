import {
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Param,
  Post,
  Query,
  Res,
  Sse,
  UnauthorizedException,
  MessageEvent,
} from '@nestjs/common';
import type { Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { Observable, map } from 'rxjs';
import { AiCompCurationService, HardConstraints } from './ai-comp-curation.service';
import { computeCacheKey } from './utils/cache-key';
import { canonicalize } from './utils/property-type';
import { PROMPT_V1 } from './prompts/comp-curation.prompt.v1';
import { PrismaService } from '../prisma/prisma.service';
import type { ValuationMode } from './types/curation-result';

interface DecodedToken {
  userId?: string;
  organizationId?: string;
}

interface CurationQuery {
  valuationMode?: string;
  hardConstraints?: string; // JSON-stringified
  maxDistance?: string; // number or 'auto'
  force?: string; // 'true' to bypass cache
  token?: string; // SSE fallback when EventSource can't send Authorization header
}

@Controller()
export class AiCompCurationController {
  private readonly logger = new Logger(AiCompCurationController.name);

  constructor(
    private readonly service: AiCompCurationService,
    private readonly prisma: PrismaService,
  ) {}

  // Routing smoke test: hit this with curl to confirm the API is up,
  // CORS is configured, and the new module is wired correctly. No auth.
  @Get('leads/:leadId/curate/_ping')
  ping(@Param('leadId') leadId: string) {
    this.logger.log(`curate _ping for lead ${leadId}`);
    return { ok: true, leadId, service: 'ai-comp-curation' };
  }

  private requireUser(
    authHeader?: string,
    fallbackToken?: string,
  ): { userId: string } {
    try {
      const token = authHeader?.replace('Bearer ', '') ?? fallbackToken;
      const decoded = (token ? (jwt.decode(token) as DecodedToken) : null) || {};
      if (!decoded.userId) {
        throw new UnauthorizedException('Missing user token');
      }
      return { userId: decoded.userId };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid auth token');
    }
  }

  private parseInput(query: CurationQuery): {
    valuationMode: ValuationMode;
    hardConstraints: HardConstraints;
    maxDistance: number | 'auto';
    force: boolean;
  } {
    const valuationMode: ValuationMode =
      query.valuationMode === 'AS_IS' ? 'AS_IS' : 'ARV_RENOVATED';
    let hardConstraints: HardConstraints = {};
    if (query.hardConstraints) {
      try {
        hardConstraints = JSON.parse(query.hardConstraints) as HardConstraints;
      } catch {
        hardConstraints = {};
      }
    }
    let maxDistance: number | 'auto' = 'auto';
    if (query.maxDistance && query.maxDistance !== 'auto') {
      const n = Number(query.maxDistance);
      if (Number.isFinite(n) && n > 0) maxDistance = n;
    }
    return {
      valuationMode,
      hardConstraints,
      maxDistance,
      force: query.force === 'true',
    };
  }

  // SSE endpoint. EventSource is GET-only — pass inputs as query params.
  @Sse('leads/:leadId/curate')
  curate(
    @Param('leadId') leadId: string,
    @Query() query: CurationQuery,
    @Headers('authorization') authHeader?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Observable<MessageEvent> {
    this.logger.log(
      `SSE curate hit: leadId=${leadId} hasAuth=${!!authHeader} hasTokenQuery=${!!query?.token}`,
    );
    // Disable proxy buffering — Railway / nginx will otherwise buffer the
    // SSE stream and the client never sees frames.
    if (res) {
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
    }
    const { userId } = this.requireUser(authHeader, query.token);
    const parsed = this.parseInput(query);
    this.logger.log(
      `SSE curate accepted: leadId=${leadId} userId=${userId} mode=${parsed.valuationMode} maxDistance=${parsed.maxDistance}`,
    );
    const subject = this.service.runCuration({
      leadId,
      userId,
      valuationMode: parsed.valuationMode,
      hardConstraints: parsed.hardConstraints,
      maxDistance: parsed.maxDistance,
      forceRefresh: parsed.force,
    });
    // NestJS shapes each emitted value into an SSE frame. Send all events
    // through the default "message" channel (no `type` field) — using a
    // named event would force the client to attach per-name listeners
    // instead of the default `EventSource.onmessage`. The CurationEvent
    // JSON already carries its own `type` field for client dispatch.
    return subject.asObservable().pipe(
      map((evt) => ({
        data: evt as unknown as Record<string, unknown>,
      })),
    );
  }

  @Get('leads/:leadId/curate/latest')
  async latest(
    @Param('leadId') leadId: string,
    @Query() query: CurationQuery,
    @Headers('authorization') authHeader?: string,
  ) {
    this.requireUser(authHeader);
    const parsed = this.parseInput(query);

    // Recompute the cacheKey from the current lead snapshot + inputs.
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        comps: {
          where: { selected: true },
          orderBy: { distance: 'asc' },
        },
        compAnalyses: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      } as any,
    });
    if (!lead) return { result: null };
    const analysis = (lead as any).compAnalyses?.[0] ?? null;
    const allComps = await this.prisma.comp.findMany({
      where: { leadId, ...(analysis ? { analysisId: analysis.id } : {}) },
      orderBy: { distance: 'asc' },
    });
    const subjectType = canonicalize(
      (lead as any).propertyType,
      (lead as any).yearBuilt,
    );
    const candidateIds = allComps
      .filter((c) => {
        const ct = canonicalize(c.propertyType ?? null, c.yearBuilt ?? null);
        return (
          subjectType.type !== 'UNKNOWN' &&
          ct.type !== 'UNKNOWN' &&
          subjectType.type === ct.type
        );
      })
      .map((c) => c.id)
      .sort();
    const cacheKey = computeCacheKey({
      leadId,
      candidateIds,
      valuationMode: parsed.valuationMode,
      hardConstraints: parsed.hardConstraints as Record<string, unknown>,
      maxDistance: parsed.maxDistance,
      promptVersion: PROMPT_V1.version,
      subjectFingerprint: {
        propertyType: (lead as any).propertyType,
        bedrooms: (lead as any).bedrooms,
        bathrooms: (lead as any).bathrooms,
        squareFeet: (lead as any).sqftOverride ?? (lead as any).sqft,
        yearBuilt: (lead as any).yearBuilt,
        condition: (lead as any).condition ?? null,
        address: (lead as any).propertyAddress,
        zip: (lead as any).propertyZip,
      },
    });
    const found = await this.service.getLatestForLead(leadId, cacheKey);
    if (!found) return { result: null };
    const row = await this.prisma.aiCompCuration.findUnique({
      where: { id: found.id },
      select: { createdAt: true },
    });
    return {
      result: found.result,
      curationId: found.id,
      createdAt: row?.createdAt,
    };
  }

  @Post('comp-analyses/:analysisId/comps/bulk-select')
  async bulkSelect(
    @Param('analysisId') analysisId: string,
    @Body() body: { include: string[] },
    @Headers('authorization') authHeader?: string,
  ) {
    this.requireUser(authHeader);
    return this.service.bulkSelect(analysisId, body?.include || []);
  }
}
