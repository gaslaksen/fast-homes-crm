import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { ForeclosureRulesService } from './foreclosure-rules.service';
import {
  SIGNALS_JSON_SCHEMA, SIGNALS_SYSTEM_PROMPT, ANALYSIS_VERSION, RECOMMENDED_ACTIONS,
} from './foreclosure-signals.schema';
import {
  buildSignalsInput, reconcileSignals, signalPreconditions, Signal,
} from './foreclosure-signals.util';
import { RulesResult } from './foreclosure-rules.util';

const INPUT_USD_PER_MTOK = 1;
const OUTPUT_USD_PER_MTOK = 5;
const ACTIONS = new Set<string>(RECOMMENDED_ACTIONS);

export interface SignalsResult {
  signals: Signal[];
  dropped: { signalCode: string; reason: string }[];
  analysisVersion: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * The synthesis layer. Takes extracted facts plus deterministic rules output and
 * produces a short list of typed signals.
 *
 * The model never sees the filing text - extraction already happened, and
 * re-reading it would only invite second-guessing of settled facts. What it
 * gets is a compact fact sheet, and its job is selection and phrasing.
 * reconcileSignals then enforces the parts that are not up for debate.
 */
@Injectable()
export class ForeclosureSignalsService {
  private readonly logger = new Logger(ForeclosureSignalsService.name);
  private anthropic: Anthropic | null = null;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private rules: ForeclosureRulesService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set - foreclosure signals disabled');
    }
  }

  /**
   * Run the synthesis pass over one filing's facts.
   *
   * When AI is unavailable the deterministic signals are still produced: the
   * reverse-mortgage catch and the deadline flags do not depend on a model
   * being reachable.
   */
  async analyze(
    filing: Record<string, any>,
    rulesResult: RulesResult,
    confidence?: Record<string, number> | null,
  ): Promise<SignalsResult> {
    const preconditions = signalPreconditions(rulesResult, filing, confidence);
    const empty = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

    if (!this.anthropic) {
      const { signals, dropped } = reconcileSignals({ signals: [] }, preconditions);
      return { signals, dropped, analysisVersion: ANALYSIS_VERSION, usage: empty };
    }

    const input = buildSignalsInput(filing, rulesResult, confidence);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 2000,
        temperature: 0,
        system: SIGNALS_SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: SIGNALS_JSON_SCHEMA as any } },
        messages: [{ role: 'user', content: JSON.stringify(input, null, 2) }],
      });

      const content = (response.content[0] as any)?.text?.trim();
      const raw = content ? JSON.parse(content) : { signals: [] };
      const { signals, dropped } = reconcileSignals(raw, preconditions);

      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      const costUsd =
        (inputTokens / 1e6) * INPUT_USD_PER_MTOK + (outputTokens / 1e6) * OUTPUT_USD_PER_MTOK;
      this.logger.log(
        `Signals: ${signals.length} kept, ${dropped.length} dropped, ` +
          `${inputTokens} in / ${outputTokens} out, $${costUsd.toFixed(4)}`,
      );
      if (dropped.length) {
        this.logger.debug(`Dropped: ${dropped.map((d) => `${d.signalCode} (${d.reason})`).join('; ')}`);
      }

      return {
        signals,
        dropped,
        analysisVersion: ANALYSIS_VERSION,
        usage: { inputTokens, outputTokens, costUsd },
      };
    } catch (error: any) {
      // A model failure must not lose the deterministic signals.
      this.logger.error(`Signals synthesis failed, falling back to rules only: ${error.message}`);
      const { signals, dropped } = reconcileSignals({ signals: [] }, preconditions);
      return { signals, dropped, analysisVersion: ANALYSIS_VERSION, usage: empty };
    }
  }

  /**
   * Analyze a lead's latest filing and replace its stored signals.
   *
   * Signals for codes that no longer apply are deleted, so a re-run after a
   * lender-profile correction leaves no stale flags behind. completedActions
   * survives for a signal that persists across the re-run - the user's ticks are
   * theirs, not the model's to reset.
   */
  async analyzeLead(leadId: string, organizationId?: string | null): Promise<SignalsResult | null> {
    const filing = await this.prisma.foreclosureFiling.findFirst({
      where: { leadId, ...(organizationId ? { organizationId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    if (!filing) return null;

    const detail = await this.prisma.foreclosureDetail.findUnique({
      where: { leadId },
      select: { assessedValue: true },
    });
    const rulesResult = await this.rules.evaluateFiling(filing, organizationId, detail?.assessedValue);
    const result = await this.analyze(
      filing as any,
      rulesResult,
      filing.fieldConfidence as Record<string, number> | null,
    );

    const keptCodes = result.signals.map((s) => s.signalCode);
    await this.prisma.foreclosureSignal.deleteMany({
      where: { filingId: filing.id, signalCode: { notIn: keptCodes.length ? keptCodes : ['__none__'] } },
    });

    for (const signal of result.signals) {
      const existing = await this.prisma.foreclosureSignal.findUnique({
        where: { filingId_signalCode: { filingId: filing.id, signalCode: signal.signalCode } },
        select: { id: true, completedActions: true },
      });
      const data = {
        leadId: filing.leadId,
        organizationId: filing.organizationId,
        analysisVersion: result.analysisVersion,
        severity: signal.severity,
        headline: signal.headline,
        evidence: signal.evidence,
        recommendedActions: signal.recommendedActions,
        generatedAt: new Date(),
      };
      if (existing) {
        await this.prisma.foreclosureSignal.update({
          where: { id: existing.id },
          data: {
            ...data,
            // Keep only ticks that still correspond to an offered action.
            completedActions: (existing.completedActions || []).filter((a) =>
              signal.recommendedActions.includes(a as any),
            ),
          },
        });
      } else {
        await this.prisma.foreclosureSignal.create({
          data: { ...data, filingId: filing.id, signalCode: signal.signalCode, completedActions: [] },
        });
      }
    }

    return result;
  }

  /** Stored signals for a lead, most severe first. */
  async forLead(leadId: string, organizationId?: string | null) {
    const rank = { critical: 3, notable: 2, info: 1 } as Record<string, number>;
    const rows = await this.prisma.foreclosureSignal.findMany({
      where: { leadId, ...(organizationId ? { organizationId } : {}) },
    });
    return rows.sort(
      (a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0) || a.signalCode.localeCompare(b.signalCode),
    );
  }

  /**
   * Tick or untick a recommended action. The checklist is the user's record of
   * what they did; nothing here triggers outreach.
   */
  async setActionCompletion(
    signalId: string,
    action: string,
    completed: boolean,
    organizationId?: string | null,
  ) {
    if (!ACTIONS.has(action)) return null;
    const signal = await this.prisma.foreclosureSignal.findFirst({
      where: { id: signalId, ...(organizationId ? { organizationId } : {}) },
      select: { id: true, completedActions: true, recommendedActions: true },
    });
    if (!signal) return null;
    if (!signal.recommendedActions.includes(action)) return null;

    const next = new Set(signal.completedActions || []);
    if (completed) next.add(action);
    else next.delete(action);

    return this.prisma.foreclosureSignal.update({
      where: { id: signal.id },
      data: { completedActions: Array.from(next) },
    });
  }
}
