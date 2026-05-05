import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Subject } from 'rxjs';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { CompsService } from '../comps/comps.service';
import { CompAnalysisService } from '../comps/comp-analysis.service';
import { ReapiService } from '../comps/reapi.service';
import { BatchDataService } from '../comps/batchdata.service';
import {
  CurationEvent,
  StepName,
  StepStatus,
} from './types/curation-events';
import {
  CurationResult,
  ValuationMode,
  parseCurationResult,
} from './types/curation-result';
import { canonicalize, isTypeMatch } from './utils/property-type';
import { buildExternalLinks } from './utils/external-links';
import { computeCacheKey } from './utils/cache-key';
import { deriveDensity, ladderFor } from './utils/market-density';
import {
  selectPhotoBudget,
  CandidatePhotoSource,
} from './utils/photo-budget';
import { fetchAndResize } from './utils/image-fetch';
import {
  PROMPT_V1,
  PromptCandidate,
  PromptInput,
  PromptSubject,
  validateRankingsCoverage,
} from './prompts/comp-curation.prompt.v1';

const MODEL = 'claude-opus-4-7';
const MAX_TOKENS = 8000;
const TARGET_SURVIVOR_COUNT = 6;
const PHOTO_BUDGET = 30;

export interface RunCurationInput {
  leadId: string;
  userId: string;
  valuationMode: ValuationMode;
  hardConstraints: HardConstraints;
  maxDistance: number | 'auto';
  forceRefresh?: boolean;
  isValidationRun?: boolean;
  validationPropertyId?: string | null;
}

export interface HardConstraints {
  matchBedsBathsExact?: boolean;
  sameSchoolDistrict?: boolean;
  sameSubdivision?: boolean;
  renovatedOnly?: boolean;
  distressedOnly?: boolean;
  hasGarage?: boolean;
  hasPool?: boolean;
  builtWithinYears?: number;
}

@Injectable()
export class AiCompCurationService {
  private readonly logger = new Logger(AiCompCurationService.name);
  private readonly anthropic: Anthropic | null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly comps: CompsService,
    private readonly compAnalysis: CompAnalysisService,
    private readonly reapi: ReapiService,
    private readonly batchData: BatchDataService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.anthropic = apiKey ? new Anthropic({ apiKey }) : null;
    if (!this.anthropic) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — AI comp curation will fail at runtime',
      );
    }
  }

  // Returns a Subject the SSE controller pipes to the client. Caller never
  // awaits — this fires and forgets, completing on success or error.
  // Defer the start by a microtask so NestJS's SSE machinery has a chance
  // to subscribe before the first event lands; otherwise early emissions
  // on this hot Subject are lost.
  runCuration(input: RunCurationInput): Subject<CurationEvent> {
    const subject = new Subject<CurationEvent>();
    setImmediate(() => {
      this.executeCuration(input, subject).catch((err) => {
        this.logger.error(`runCuration failed: ${err?.message ?? err}`);
        subject.next({
          type: 'error',
          code: 'INTERNAL',
          message: err?.message ?? 'Unknown error',
        });
        subject.complete();
      });
    });
    return subject;
  }

  async getLatestForLead(
    leadId: string,
    cacheKey: string,
  ): Promise<{ id: string; result: CurationResult } | null> {
    const row = await this.prisma.aiCompCuration.findFirst({
      where: { leadId, cacheKey },
      orderBy: { createdAt: 'desc' },
    });
    if (!row || !row.parsedResponse) return null;
    return {
      id: row.id,
      result: row.parsedResponse as unknown as CurationResult,
    };
  }

  async bulkSelect(analysisId: string, includeIds: string[]) {
    // Find the analysis and lead.
    const analysis = await this.prisma.compAnalysis.findUnique({
      where: { id: analysisId },
      select: { id: true, leadId: true },
    });
    if (!analysis) {
      return { ok: false, message: 'analysis not found' };
    }
    // Single transaction: deselect everything in this analysis, then
    // re-select only the IDs in `include`.
    await this.prisma.$transaction([
      this.prisma.comp.updateMany({
        where: { analysisId },
        data: { selected: false },
      }),
      this.prisma.comp.updateMany({
        where: { id: { in: includeIds }, analysisId },
        data: { selected: true },
      }),
    ]);
    // Recalculate ARV from the new selection.
    await this.comps.recalculateArv(analysis.leadId);
    return { ok: true, leadId: analysis.leadId, includedCount: includeIds.length };
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async executeCuration(
    input: RunCurationInput,
    subject: Subject<CurationEvent>,
  ): Promise<void> {
    const emit = (
      step: StepName,
      status: StepStatus,
      payload?: Record<string, unknown>,
    ) => subject.next({ type: 'step', step, status, payload });

    if (!this.anthropic) {
      subject.next({
        type: 'error',
        code: 'NO_API_KEY',
        message: 'Anthropic API key not configured',
      });
      subject.complete();
      return;
    }

    // 1. Load subject + comps.
    emit('load_subject', 'start');
    const lead = await this.prisma.lead.findUnique({
      where: { id: input.leadId },
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
    if (!lead) {
      subject.next({
        type: 'error',
        code: 'LEAD_NOT_FOUND',
        message: `Lead ${input.leadId} not found`,
      });
      subject.complete();
      return;
    }
    const analysis = (lead as any).compAnalyses?.[0] ?? null;
    const allComps = await this.prisma.comp.findMany({
      where: { leadId: input.leadId, ...(analysis ? { analysisId: analysis.id } : {}) },
      orderBy: { distance: 'asc' },
    });
    emit('load_subject', 'done', {
      compCount: allComps.length,
      analysisId: analysis?.id,
    });

    // 2. Classify subject type.
    emit('classify_type', 'start');
    const subjectType = canonicalize(
      (lead as any).propertyType,
      (lead as any).yearBuilt,
    );
    if (subjectType.type === 'UNKNOWN') {
      subject.next({
        type: 'error',
        code: 'TYPE_REQUIRED',
        message:
          'Subject property type unknown — set property type before running curation.',
        step: 'classify_type',
      });
      subject.complete();
      return;
    }
    emit('classify_type', 'done', {
      type: subjectType.type,
      subtypes: subjectType.subtypes,
    });

    // 3. Pre-AI filter type mismatches.
    emit('filter_type_mismatches', 'start');
    const typeFiltered: typeof allComps = [];
    const excludedDueToTypeMismatch: Array<{ candidateId: string; reason: string }> = [];
    for (const c of allComps) {
      const candType = canonicalize(c.propertyType ?? null, c.yearBuilt ?? null);
      if (isTypeMatch(subjectType, candType)) {
        typeFiltered.push(c);
      } else {
        excludedDueToTypeMismatch.push({
          candidateId: c.id,
          reason: `Subject is ${subjectType.type}; candidate is ${candType.type}`,
        });
      }
    }
    emit('filter_type_mismatches', 'done', {
      kept: typeFiltered.length,
      excluded: excludedDueToTypeMismatch.length,
    });

    // 4. Pre-AI filter hard constraints.
    emit('filter_constraints', 'start');
    const constraintFiltered: typeof allComps = [];
    const excludedDueToConstraints: Array<{ candidateId: string; constraintFailed: string }> = [];
    for (const c of typeFiltered) {
      const fail = checkConstraint(c, lead, input.hardConstraints);
      if (fail) {
        excludedDueToConstraints.push({ candidateId: c.id, constraintFailed: fail });
      } else {
        constraintFiltered.push(c);
      }
    }
    emit('filter_constraints', 'done', {
      kept: constraintFiltered.length,
      excluded: excludedDueToConstraints.length,
    });

    // 5. Derive market density.
    emit('derive_density', 'start');
    const density = deriveDensity({
      state: (lead as any).propertyState,
      zip: (lead as any).propertyZip,
    });
    const ladder = ladderFor(density);
    emit('derive_density', 'done', { density, ladder });

    // 6. Cache check.
    emit('cache_check', 'start');
    const candidateIds = constraintFiltered.map((c) => c.id).sort();
    const cacheKey = computeCacheKey({
      leadId: input.leadId,
      candidateIds,
      valuationMode: input.valuationMode,
      hardConstraints: input.hardConstraints as Record<string, unknown>,
      maxDistance: input.maxDistance,
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
    if (!input.forceRefresh) {
      const cached = await this.prisma.aiCompCuration.findFirst({
        where: { leadId: input.leadId, cacheKey },
        orderBy: { createdAt: 'desc' },
      });
      if (cached && cached.parsedResponse) {
        emit('cache_check', 'done', { hit: true });
        subject.next({
          type: 'cache_hit',
          curationId: cached.id,
          result: cached.parsedResponse as unknown as CurationResult,
        });
        subject.complete();
        return;
      }
    }
    emit('cache_check', 'done', { hit: false });

    // 7. Expansion loop — placeholder for v1. The current pool comes from
    // already-fetched comps. If we're below the survivor target, we record
    // that fact in the searchExpansion narrative and let the AI flag thin
    // inventory. Provider re-fetches at wider radii are wired but only
    // engaged when the user explicitly opts into auto-distance — out of
    // scope to actually mutate the persisted pool from this path.
    const survivorCount = constraintFiltered.length;
    const initialRadius =
      typeof input.maxDistance === 'number' ? input.maxDistance : ladder.initial;
    const finalRadius = initialRadius;
    const expansionPath = [initialRadius];
    if (
      input.maxDistance === 'auto' &&
      survivorCount < TARGET_SURVIVOR_COUNT &&
      ladder.tiers.length > 1
    ) {
      // Record what would have happened. Actual ephemeral fetching of
      // additional candidates from REAPI / BatchData is deferred — the v1
      // surface focuses on advisory ranking over the existing pool. The
      // AI's narrative will flag thin inventory and recommend the user
      // widen the manual filter.
      emit('expansion_tier', 'start', {
        reason: 'survivor_below_target',
        target: TARGET_SURVIVOR_COUNT,
        actual: survivorCount,
      });
      emit('expansion_tier', 'done', {
        tiersConsidered: ladder.tiers,
        notice: 'auto-expansion narration only in v1; manual radius widening recommended',
      });
    }

    // 8. Photo budget.
    emit('photo_budget', 'start');
    const subjectPhotos = extractSubjectPhotos(lead);
    const candidatePhotos: CandidatePhotoSource[] = constraintFiltered.map((c) => ({
      candidateId: c.id,
      photoUrls: c.photoUrl ? [c.photoUrl] : [],
      uncertainty: uncertaintyScore(c, lead),
      distance: c.distance,
    }));
    const allocations = selectPhotoBudget(subjectPhotos, candidatePhotos, {
      total: PHOTO_BUDGET,
    });
    emit('photo_budget', 'done', {
      subjectPhotosTaken: allocations.filter((a) => a.compId === null).length,
      candidatePhotosTaken: allocations.filter((a) => a.compId !== null).length,
    });

    // 9. Fetch + resize images in parallel; degrade individual failures.
    emit('fetch_resize', 'start');
    const fetched = await Promise.allSettled(
      allocations.map(async (a) => ({
        allocation: a,
        image: await fetchAndResize(a.url),
      })),
    );
    const successfulImages: Array<{
      allocation: (typeof allocations)[number];
      image: Awaited<ReturnType<typeof fetchAndResize>>;
    }> = [];
    for (const r of fetched) {
      if (r.status === 'fulfilled') successfulImages.push(r.value);
    }
    emit('fetch_resize', 'done', {
      requested: allocations.length,
      succeeded: successfulImages.length,
    });

    // 10. Build prompt.
    emit('build_prompt', 'start');
    const promptInput: PromptInput = {
      subject: buildPromptSubject(lead, subjectType.subtypes),
      candidates: constraintFiltered.map((c) =>
        buildPromptCandidate(c, successfulImages),
      ),
      valuationMode: input.valuationMode,
      marketDensity: density,
      searchExpansion: {
        initialRadius,
        finalRadius,
        expansionPath,
      },
      hardConstraints: input.hardConstraints as Record<string, unknown>,
      photoLabelsInOrder: successfulImages.map((s) =>
        photoLabel(s.allocation),
      ),
    };
    const promptText = PROMPT_V1.build(promptInput);
    emit('build_prompt', 'done', {
      candidateCount: constraintFiltered.length,
      photoCount: successfulImages.length,
      promptChars: promptText.length,
    });

    // 11. Anthropic call.
    emit('anthropic_call', 'start');
    const t0 = Date.now();
    const imageBlocks: Anthropic.ImageBlockParam[] = successfulImages.map(
      ({ image }) => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: image.mediaType,
          data: image.base64,
        },
      }),
    );
    const response = await this.anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: [...imageBlocks, { type: 'text', text: promptText }],
        },
      ],
    });
    const latencyMs = Date.now() - t0;
    const fullText = (response.content[0] as any)?.text ?? '';
    emit('anthropic_call', 'done', {
      latencyMs,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    });

    // 12. Parse + validate.
    emit('parse', 'start');
    const stripped = fullText
      .replace(/^```[\w]*\s*/m, '')
      .replace(/\s*```$/m, '')
      .trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    let parsed: CurationResult | null = null;
    if (jsonMatch) {
      try {
        const raw = JSON.parse(jsonMatch[0]);
        parsed = parseCurationResult(raw);
      } catch (e) {
        this.logger.warn(`First parse failed: ${(e as Error).message}`);
      }
    }
    if (parsed) {
      // Ensure pre-filtered exclusions are recorded (not from AI).
      parsed.excludedDueToTypeMismatch = excludedDueToTypeMismatch;
      parsed.excludedDueToConstraints = excludedDueToConstraints.map((e) => ({
        candidateId: e.candidateId,
        reason: e.constraintFailed,
      }));
      // Backfill external links per ranking.
      for (const r of parsed.rankings) {
        const cand = constraintFiltered.find((c) => c.id === r.candidateId);
        if (cand) {
          r.externalLinks = buildExternalLinks({
            address: cand.address,
            city: null,
            state: null,
            zip: null,
          });
        }
      }
      // Coverage check — if rankings don't cover every candidate, treat
      // as parse failure for safety.
      const cov = validateRankingsCoverage(parsed.rankings, candidateIds);
      if (cov.ok === false) {
        this.logger.warn(
          `Ranking coverage mismatch: missing=${cov.missing.length} extra=${cov.extra.length}`,
        );
        parsed = null;
      }
    }
    emit('parse', 'done', { ok: !!parsed });

    // 13. Persist.
    emit('persist', 'start');
    const modelMetadata = {
      model: MODEL,
      promptVersion: PROMPT_V1.version,
      tokensUsed: {
        input: response.usage?.input_tokens ?? 0,
        output: response.usage?.output_tokens ?? 0,
      },
      latencyMs,
      timestamp: new Date().toISOString(),
      photoCount: successfulImages.length,
    };
    const row = await this.prisma.aiCompCuration.create({
      data: {
        leadId: input.leadId,
        userId: input.userId,
        subjectSnapshot: serializeSubject(lead) as any,
        valuationMode: input.valuationMode,
        hardConstraints: input.hardConstraints as any,
        candidateIds,
        excludedTypeMismatches: excludedDueToTypeMismatch as any,
        excludedConstraints: excludedDueToConstraints as any,
        searchExpansion: { initialRadius, finalRadius, expansionPath } as any,
        promptText,
        promptVersion: PROMPT_V1.version,
        rawResponse: { text: fullText, usage: response.usage } as any,
        parsedResponse: parsed
          ? ({ ...parsed, modelMetadata } as any)
          : null,
        modelMetadata: modelMetadata as any,
        isValidationRun: !!input.isValidationRun,
        validationPropertyId: input.validationPropertyId ?? null,
        cacheKey,
      },
    });
    emit('persist', 'done', { curationId: row.id });

    // 14. Final event.
    if (parsed) {
      subject.next({
        type: 'done',
        curationId: row.id,
        result: { ...parsed, modelMetadata },
      });
    } else {
      subject.next({
        type: 'error',
        code: 'AI_PARSE_FAILED',
        message:
          'AI response could not be parsed into the expected JSON shape',
        step: 'parse',
      });
    }
    subject.complete();
  }
}

// ── helpers ─────────────────────────────────────────────────────────────

function checkConstraint(
  c: any,
  lead: any,
  hc: HardConstraints,
): string | null {
  if (hc.matchBedsBathsExact) {
    if (lead.bedrooms != null && c.bedrooms !== lead.bedrooms) {
      return 'matchBedsBathsExact (bedrooms)';
    }
    if (lead.bathrooms != null && c.bathrooms !== lead.bathrooms) {
      return 'matchBedsBathsExact (bathrooms)';
    }
  }
  if (hc.sameSchoolDistrict && c.schoolDistrict !== lead.schoolDistrict) {
    return 'sameSchoolDistrict';
  }
  if (hc.sameSubdivision && c.subdivision !== lead.subdivision) {
    return 'sameSubdivision';
  }
  if (hc.renovatedOnly && !c.isRenovated) return 'renovatedOnly';
  if (hc.hasGarage === true && !c.hasGarage) return 'hasGarage';
  if (hc.hasPool === true && !c.hasPool) return 'hasPool';
  if (
    typeof hc.builtWithinYears === 'number' &&
    c.yearBuilt &&
    new Date().getFullYear() - c.yearBuilt > hc.builtWithinYears
  ) {
    return 'builtWithinYears';
  }
  return null;
}

function uncertaintyScore(c: any, lead: any): number {
  // Higher = AI benefits more from photos. Heuristic — large size delta
  // or missing condition data raises uncertainty.
  let score = 0.3;
  const subjSqft = lead.sqftOverride ?? lead.sqft;
  if (subjSqft && c.sqft) {
    const delta = Math.abs(c.sqft - subjSqft) / subjSqft;
    if (delta > 0.2) score += 0.3;
  }
  if (!c.isRenovated && !lead.condition) score += 0.2;
  if (c.distance > 2) score += 0.2;
  return Math.min(1, score);
}

function extractSubjectPhotos(lead: any): string[] {
  // Prefer reapiMlsPhotos if present, then primaryPhoto, then array.
  const mls = lead.reapiMlsPhotos;
  if (Array.isArray(mls)) {
    return mls
      .map((p: any) => p?.midRes || p?.highRes || p?.lowRes || p?.url)
      .filter(Boolean)
      .slice(0, 4);
  }
  if (lead.primaryPhoto) return [lead.primaryPhoto];
  if (Array.isArray(lead.photos) && lead.photos.length > 0) {
    return lead.photos
      .map((p: any) => p?.url)
      .filter(Boolean)
      .slice(0, 4);
  }
  return [];
}

function buildPromptSubject(lead: any, subtypes: string[]): PromptSubject {
  return {
    address: lead.propertyAddress,
    city: lead.propertyCity,
    state: lead.propertyState,
    zip: lead.propertyZip,
    propertyType: lead.propertyType ?? '',
    propertySubtypes: subtypes,
    bedrooms: lead.bedrooms,
    bathrooms: lead.bathrooms,
    squareFeet: lead.sqftOverride ?? lead.sqft,
    yearBuilt: lead.yearBuilt,
    lotSize: lead.lotSize,
    condition: lead.condition ?? null,
    occupancyStatus: lead.ownerOccupied != null ? (lead.ownerOccupied ? 'owner-occupied' : 'non-owner-occupied') : null,
    schoolDistrict: lead.schoolDistrict ?? null,
    subdivision: lead.subdivision ?? null,
    externalLinks: buildExternalLinks({
      address: lead.propertyAddress,
      city: lead.propertyCity,
      state: lead.propertyState,
      zip: lead.propertyZip,
    }),
  };
}

function buildPromptCandidate(
  c: any,
  successfulImages: Array<{
    allocation: { compId: string | null; photoIndex: number; url: string };
  }>,
): PromptCandidate {
  const candType = canonicalize(c.propertyType ?? null, c.yearBuilt ?? null);
  const photoLabels = successfulImages
    .filter((s) => s.allocation.compId === c.id)
    .map((s) => photoLabel(s.allocation));
  return {
    candidateId: c.id,
    address: c.address,
    city: '',
    state: '',
    zip: '',
    distance: c.distance,
    propertyType: c.propertyType ?? '',
    propertySubtypes: candType.subtypes,
    bedrooms: c.bedrooms,
    bathrooms: c.bathrooms,
    squareFeet: c.sqft,
    yearBuilt: c.yearBuilt,
    lotSize: c.lotSize,
    salePrice: c.soldPrice,
    saleDate: c.soldDate?.toISOString?.().slice(0, 10) ?? String(c.soldDate),
    saleType: c.features?.saleTransType ?? null,
    daysOnMarket: c.daysOnMarket,
    listingDescription: c.notes ?? null,
    schoolDistrict: c.schoolDistrict ?? null,
    subdivision: c.features?.subdivision ?? null,
    hasGarage: c.hasGarage,
    hasPool: c.hasPool,
    source: c.source,
    externalLinks: buildExternalLinks({
      address: c.address,
      city: null,
      state: null,
      zip: null,
    }),
    photoLabels,
  };
}

function photoLabel(allocation: {
  compId: string | null;
  photoIndex: number;
}): string {
  return allocation.compId === null
    ? `subject photo #${allocation.photoIndex}`
    : `${allocation.compId} photo #${allocation.photoIndex}`;
}

function serializeSubject(lead: any) {
  return {
    propertyAddress: lead.propertyAddress,
    propertyCity: lead.propertyCity,
    propertyState: lead.propertyState,
    propertyZip: lead.propertyZip,
    propertyType: lead.propertyType,
    bedrooms: lead.bedrooms,
    bathrooms: lead.bathrooms,
    sqft: lead.sqftOverride ?? lead.sqft,
    yearBuilt: lead.yearBuilt,
    lotSize: lead.lotSize,
    condition: lead.condition ?? null,
  };
}
