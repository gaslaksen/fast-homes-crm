import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import {
  AIArvCalculationInput,
  AIArvCalculationResult,
  CompForArv,
  RawAiArvResponse,
  ValuationMode,
  parseRawAiArv,
} from './types/arv-result';
import { buildPrompt, PROMPT_VERSION } from './prompts/arv-calculation.prompt.v1';
import { computeStats } from './utils/arv-stats';
import { computeConfidence } from './utils/confidence';
import { computeInputHash } from './utils/input-hash';
import { extractLargestJsonObject } from './utils/extract-json';
import { validateRawResponse } from './utils/validators';

// Per Build Prompt 016: judgment-heavy ARV reasoning runs on Opus 4.7.
// Sonnet drift on adjustment reasoning has been a problem historically.
const MODEL = 'claude-opus-4-7';
const MAX_TOKENS = 4096;

@Injectable()
export class AiArvCalculationService {
  private readonly logger = new Logger(AiArvCalculationService.name);
  private readonly anthropic: Anthropic | null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.anthropic = apiKey ? new Anthropic({ apiKey }) : null;
    if (!this.anthropic) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — AI ARV calculation will fail at runtime',
      );
    }
  }

  // ── Public read APIs ─────────────────────────────────────────────────────

  async getLatestForLead(leadId: string): Promise<AIArvCalculationResult | null> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { currentArvCalculationId: true },
    });
    if (!lead?.currentArvCalculationId) return null;
    const row = await this.prisma.aiArvCalculation.findUnique({
      where: { id: lead.currentArvCalculationId },
    });
    if (!row) return null;
    return rowToResult(row);
  }

  async getHistoryForLead(
    leadId: string,
    limit = 20,
  ): Promise<AIArvCalculationResult[]> {
    const rows = await this.prisma.aiArvCalculation.findMany({
      where: { leadId },
      orderBy: { computedAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => rowToResult(row));
  }

  // ── Calculation entry point ──────────────────────────────────────────────

  async calculate(params: {
    leadId: string;
    mode: ValuationMode;
    userId?: string;
    forceRefresh?: boolean;
    // Optional explicit list of comp IDs to use. When provided the backend
    // only loads these (verifying each belongs to the lead). Without it,
    // we fall back to "all comps with selected=true on this lead" — but
    // that path can over-count when REAPI + BatchData have duplicate rows
    // for the same property and both are flagged selected. Frontends that
    // dedupe their comp display should pass their deduped IDs here.
    selectedCompIds?: string[];
  }): Promise<AIArvCalculationResult> {
    const { leadId, mode, userId, forceRefresh = false, selectedCompIds } =
      params;
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        propertyZip: true,
        bedrooms: true,
        bathrooms: true,
        sqft: true,
        sqftOverride: true,
        yearBuilt: true,
        lotSize: true,
        conditionLevel: true,
        reapiEstimatedValue: true,
      },
    });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    // Load comps. When the caller passes explicit IDs we honor that exact
    // set (after verifying lead ownership). Otherwise we fall back to all
    // selected comps on the lead — see the contract note above.
    const compRows = selectedCompIds && selectedCompIds.length > 0
      ? await this.prisma.comp.findMany({
          where: { id: { in: selectedCompIds }, leadId },
          orderBy: { soldDate: 'desc' },
        })
      : await this.prisma.comp.findMany({
          where: { leadId, selected: true },
          orderBy: { soldDate: 'desc' },
        });
    if (selectedCompIds && compRows.length !== selectedCompIds.length) {
      const found = new Set(compRows.map((r) => r.id));
      const missing = selectedCompIds.filter((id) => !found.has(id));
      throw new BadRequestException(
        `Some comp IDs do not belong to lead ${leadId}: ${missing.join(', ')}`,
      );
    }
    if (compRows.length < 2) {
      throw new BadRequestException(
        `ARV calculation requires at least 2 selected comps; found ${compRows.length}`,
      );
    }

    const subjectSqft = lead.sqftOverride ?? lead.sqft;
    if (!subjectSqft || subjectSqft <= 0) {
      throw new BadRequestException(
        'Subject property is missing sqft — cannot compute $/sqft anchor',
      );
    }

    const subject = {
      id: lead.id,
      address: lead.propertyAddress,
      city: lead.propertyCity,
      state: lead.propertyState,
      zip: lead.propertyZip,
      bedrooms: lead.bedrooms,
      bathrooms: lead.bathrooms,
      sqft: subjectSqft,
      yearBuilt: lead.yearBuilt,
      lotSize: lead.lotSize,
      conditionLevel: lead.conditionLevel,
    };

    const selectedComps: CompForArv[] = compRows.map(toCompForArv);

    const input: AIArvCalculationInput = {
      leadId,
      subjectProperty: subject,
      selectedComps,
      mode,
      reapiAvm: lead.reapiEstimatedValue ?? null,
    };

    const inputHash = computeInputHash(input);

    // Cache hit?
    if (!forceRefresh) {
      const cached = await this.prisma.aiArvCalculation.findFirst({
        where: { leadId, inputHash, mode },
        orderBy: { computedAt: 'desc' },
      });
      if (cached) {
        return rowToResult(cached, { cached: true });
      }
    }

    if (!this.anthropic) {
      throw new ServiceUnavailableException(
        'AI ARV calculation unavailable — ANTHROPIC_API_KEY not configured',
      );
    }

    const { systemPrompt, userPrompt, promptVersion } = buildPrompt(input);
    const t0 = Date.now();
    let rawText = '';
    try {
      const message = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      rawText =
        (message.content.find((b) => b.type === 'text') as { text?: string } | undefined)
          ?.text ?? '';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Anthropic call failed: ${msg}`);
      throw new ServiceUnavailableException(`AI provider error: ${msg}`);
    }
    const latencyMs = Date.now() - t0;

    const stripped = rawText
      .replace(/^```[\w]*\s*/m, '')
      .replace(/\s*```$/m, '')
      .trim();
    const jsonText = extractLargestJsonObject(stripped);
    if (!jsonText) {
      this.logger.warn(
        `AI ARV: no JSON object in response (${rawText.length} chars). Head: ${rawText.slice(0, 400)}`,
      );
      throw new ServiceUnavailableException(
        'AI ARV response did not contain a JSON object',
      );
    }

    let raw: RawAiArvResponse;
    try {
      const parsed = JSON.parse(jsonText);
      const outcome = parseRawAiArv(parsed);
      if (outcome.ok === false) {
        this.logger.warn(`AI ARV parse failed: ${outcome.reason}`);
        throw new ServiceUnavailableException(
          `AI ARV response failed validation: ${outcome.reason}`,
        );
      }
      raw = outcome.value;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`AI ARV JSON.parse threw: ${msg}`);
      throw new ServiceUnavailableException(
        `AI ARV response JSON parse error: ${msg}`,
      );
    }

    // Guardrail enforcement: 30%-per-comp adjustment + weights sum-to-1.
    // Issues are warnings, not hard failures — the AI may have legitimate
    // edge cases. We log and persist the issues alongside the result so
    // they are visible in calculation history; we only HARD reject when
    // weights are mathematically broken (sum way off, weight outside [0,1]).
    const validation = validateRawResponse(raw);
    const hardFails = validation.issues.filter(
      (i) => i.kind === 'weight_invalid',
    );
    if (hardFails.length > 0) {
      this.logger.warn(
        `AI ARV hard validation failures: ${JSON.stringify(hardFails)}`,
      );
      throw new ServiceUnavailableException(
        `AI ARV validation failed: ${hardFails.map((i) => i.message).join('; ')}`,
      );
    }
    if (validation.issues.length > 0) {
      this.logger.warn(
        `AI ARV soft validation issues: ${JSON.stringify(validation.issues)}`,
      );
    }

    // Deterministic stats + confidence — TS owns the math.
    const stats = computeStats(subject, selectedComps, raw.compAdjustments);
    const { score: confidence, label: confidenceLabel } = computeConfidence(
      stats,
      raw.aiQualityScore,
    );

    const pricePerSqft = Number((raw.arv / subjectSqft).toFixed(2));

    const result: AIArvCalculationResult = {
      arv: round2(raw.arv),
      arvLow: round2(raw.arvLow),
      arvHigh: round2(raw.arvHigh),
      pricePerSqft,
      confidence,
      confidenceLabel,
      mode,
      compAdjustments: raw.compAdjustments,
      valuationMethod: raw.valuationMethod,
      keyFactors: raw.keyFactors,
      risks: raw.risks,
      avmDivergenceNote: raw.avmDivergenceNote,
      stats,
      modelUsed: MODEL,
      promptVersion,
      computedAt: new Date().toISOString(),
      inputHash,
      selectedCompIds: selectedComps.map((c) => c.id),
    };

    // Persist + atomically update lead canonical fields.
    const persisted = await this.prisma.$transaction(async (tx) => {
      const row = await tx.aiArvCalculation.create({
        data: {
          leadId,
          inputHash,
          mode,
          arv: result.arv,
          arvLow: result.arvLow,
          arvHigh: result.arvHigh,
          pricePerSqft: result.pricePerSqft,
          confidence: result.confidence,
          confidenceLabel: result.confidenceLabel,
          resultJson: result as unknown as object,
          selectedCompIds: selectedComps.map((c) => c.id),
          reapiAvmAtCalc: lead.reapiEstimatedValue ?? null,
          modelUsed: MODEL,
          promptVersion,
          computedByUserId: userId ?? null,
        },
      });
      await tx.lead.update({
        where: { id: leadId },
        data: {
          arv: result.arv,
          arvConfidence: result.confidence,
          lastCompsDate: new Date(),
          currentArvCalculationId: row.id,
          currentArvUpdatedAt: new Date(),
        },
      });
      return row;
    });

    this.logger.log(
      `AI ARV calc lead=${leadId} mode=${mode} arv=$${result.arv} confidence=${result.confidence}(${result.confidenceLabel}) latency=${latencyMs}ms rowId=${persisted.id}`,
    );

    return result;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface AiArvCalculationRow {
  id: string;
  resultJson: unknown;
  computedAt: Date;
}

function rowToResult(
  row: AiArvCalculationRow,
  opts?: { cached?: boolean },
): AIArvCalculationResult {
  const json = row.resultJson as AIArvCalculationResult;
  return {
    ...json,
    cached: opts?.cached ?? false,
  };
}

interface CompRow {
  id: string;
  address: string;
  soldPrice: number;
  soldDate: Date;
  distance: number | null;
  daysOnMarket: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  lotSize: number | null;
  isRenovated: boolean;
  features: unknown;
}

function toCompForArv(c: CompRow): CompForArv {
  const features =
    c.features && typeof c.features === 'object'
      ? (c.features as Record<string, unknown>)
      : null;
  const isDistressed =
    typeof features?.isDistressedSale === 'boolean'
      ? (features.isDistressedSale as boolean)
      : null;
  const saleTransType =
    typeof features?.saleTransType === 'string'
      ? (features.saleTransType as string)
      : null;
  return {
    id: c.id,
    address: c.address,
    soldPrice: c.soldPrice,
    soldDate: c.soldDate.toISOString(),
    distance: c.distance,
    daysOnMarket: c.daysOnMarket,
    bedrooms: c.bedrooms,
    bathrooms: c.bathrooms,
    sqft: c.sqft,
    yearBuilt: c.yearBuilt,
    lotSize: c.lotSize,
    isRenovated: c.isRenovated,
    isDistressed,
    saleTransType,
    features,
  };
}
