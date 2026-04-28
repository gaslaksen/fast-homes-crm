import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ExitStrategy,
  JvSplitMode,
  ProfitBucket,
  ProfitCalcResult,
} from '@fast-homes/shared';

// Statuses that mean a deal is closed/terminal — drives bucket=realized
// even when no FinalSale record exists yet (e.g. CANCELLED with sunk costs,
// HELD_LONG_TERM with carrying costs).
const TERMINAL_OUTCOME_STATUSES = new Set([
  'SOLD',
  'SOLD_LOSS',
  'HELD_LONG_TERM',
  'CANCELLED',
]);

// Inputs to the pure calculate() method. Every field is independently nullable
// so missing data degrades to warnings, never throws.
export interface ProfitCalcInput {
  exitStrategy: ExitStrategy | null;
  acquisitionPrice: number | null;       // contract.offerAmount
  acquisitionClosingCosts: number | null; // contract.acquisitionClosingCosts
  assignmentFee: number | null;          // wholesale-only revenue
  targetSalePrice: number | null;        // dispositionPlan.targetSalePrice
  finalSalePrice: number | null;         // finalSale.finalSalePrice — supersedes target when present
  saleClosingCosts: number | null;       // finalSale.saleClosingCosts
  costsTotal: number;                    // SUM(disposition_costs.amount)
  jvSplitMode: JvSplitMode | null;
  jvSplitPercent: number | null;         // our-share percent (0-100) when 'custom'
  outcomeStatus: string | null;          // lead.status — informs bucket
  hasContract: boolean;                  // signed contract present? — informs bucket
  hasFinalSale: boolean;                 // finalSale row present? — informs bucket
}

@Injectable()
export class ProfitCalculationService {
  private readonly logger = new Logger(ProfitCalculationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pure calculation. No DB access. Inputs assemble in callers from current
   * Lead/Contract/DispositionPlan/Cost/FinalSale state.
   */
  calculate(input: ProfitCalcInput): ProfitCalcResult {
    const warnings: string[] = [];
    const bucket = this.determineBucket(input);
    const strategy = input.exitStrategy ?? 'wholesale';

    let gross: number | null = null;
    let formulaUsed = '';

    // For sale-price-driven strategies, prefer finalSalePrice (actual) over
    // targetSalePrice (planned). Wholesale ignores both.
    const salePrice = input.finalSalePrice ?? input.targetSalePrice;

    switch (strategy) {
      case 'wholesale': {
        if (input.assignmentFee == null) {
          warnings.push('Missing assignment fee');
          formulaUsed = 'wholesale: assignmentFee (missing)';
          break;
        }
        gross = input.assignmentFee;
        formulaUsed = 'wholesale: assignmentFee';
        break;
      }

      case 'novation':
      case 'sub_to': {
        // No acquisition closing costs in these strategies — title doesn't
        // transfer to user. Acquisition price is what we owe the seller at exit.
        if (salePrice == null || input.acquisitionPrice == null) {
          if (salePrice == null) warnings.push('Missing target sale price');
          if (input.acquisitionPrice == null) warnings.push('Missing acquisition price');
          formulaUsed = `${strategy}: sale − acquisition − costs (missing inputs)`;
          break;
        }
        gross = salePrice - input.acquisitionPrice - input.costsTotal;
        formulaUsed = `${strategy}: sale − acquisition − costs`;
        break;
      }

      case 'double_close':
      case 'fix_flip':
      case 'concierge_listing':
      case 'hold_rental':
      case 'jv':
      case 'other':
      default: {
        // Full acquisition path — title transfers, both sides have closing costs.
        if (salePrice == null || input.acquisitionPrice == null) {
          if (salePrice == null) warnings.push('Missing target sale price');
          if (input.acquisitionPrice == null) warnings.push('Missing acquisition price');
          formulaUsed = `${strategy}: sale − acq − acqClose − saleClose − costs (missing inputs)`;
          break;
        }
        gross =
          salePrice -
          input.acquisitionPrice -
          (input.acquisitionClosingCosts ?? 0) -
          (input.saleClosingCosts ?? 0) -
          input.costsTotal;
        formulaUsed = `${strategy}: sale − acq − acqClose − saleClose − costs`;
      }
    }

    // CANCELLED with no sale: realized loss = sunk costs only.
    if (input.outcomeStatus === 'CANCELLED' && gross == null) {
      gross = -input.costsTotal;
      formulaUsed = 'cancelled: −costsTotal';
    }

    const { ourShare, jvShare } = this.applyJvSplit(
      gross,
      input.jvSplitMode,
      input.jvSplitPercent,
      warnings,
    );

    return { bucket, gross, ourShare, jvShare, formulaUsed, warnings };
  }

  /**
   * Recalculate cached realized profit for a lead and persist the result on
   * the Lead row. Emits PROFIT_BUCKET_CHANGED activity only when the bucket
   * transitions — avoid noise on every cost edit.
   */
  async recalculate(leadId: string): Promise<ProfitCalcResult> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        contract: { include: { acceptedOffer: true } },
        dispositionPlan: true,
        dispositionCosts: true,
        finalSale: true,
      } as any,
    });
    if (!lead) {
      throw new Error(`Lead ${leadId} not found`);
    }

    const anyLead = lead as any;
    const contract = anyLead.contract;
    const plan = anyLead.dispositionPlan;
    const costs: any[] = anyLead.dispositionCosts ?? [];
    const finalSale = anyLead.finalSale;

    const costsTotal = costs.reduce((sum, c) => sum + (c.amount ?? 0), 0);

    const input: ProfitCalcInput = {
      exitStrategy: (plan?.exitStrategy as ExitStrategy) ?? null,
      acquisitionPrice:
        contract?.offerAmount ?? contract?.acceptedOffer?.offerAmount ?? null,
      acquisitionClosingCosts: contract?.acquisitionClosingCosts ?? null,
      assignmentFee: contract?.assignmentFee ?? lead.assignmentFee ?? null,
      targetSalePrice: plan?.targetSalePrice ?? null,
      finalSalePrice: finalSale?.finalSalePrice ?? null,
      saleClosingCosts: finalSale?.saleClosingCosts ?? null,
      costsTotal,
      jvSplitMode: (plan?.jvSplitMode as JvSplitMode) ?? null,
      jvSplitPercent: plan?.jvSplitPercent ?? null,
      outcomeStatus: lead.status,
      hasContract: contract?.contractStatus === 'signed' || !!contract?.acquiredAt,
      hasFinalSale: !!finalSale,
    };

    const result = this.calculate(input);
    const oldBucket = (lead as any).profitBucket as ProfitBucket | null;

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        realizedProfit: result.ourShare,
        profitBucket: result.bucket,
      } as any,
    });

    if (oldBucket && oldBucket !== result.bucket) {
      try {
        await this.prisma.activity.create({
          data: {
            leadId,
            type: 'PROFIT_BUCKET_CHANGED',
            description: `Profit bucket changed: ${oldBucket} → ${result.bucket}`,
            metadata: {
              from: oldBucket,
              to: result.bucket,
              ourShare: result.ourShare,
              gross: result.gross,
            } as any,
          },
        });
      } catch (err: any) {
        this.logger.warn(`Failed to log PROFIT_BUCKET_CHANGED for ${leadId}: ${err.message}`);
      }
    }

    return result;
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private determineBucket(input: ProfitCalcInput): ProfitBucket {
    if (input.hasFinalSale) return 'realized';
    if (input.outcomeStatus && TERMINAL_OUTCOME_STATUSES.has(input.outcomeStatus)) return 'realized';
    if (input.hasContract) return 'expected';
    return 'potential';
  }

  private applyJvSplit(
    gross: number | null,
    mode: JvSplitMode | null,
    percent: number | null,
    warnings: string[],
  ): { ourShare: number | null; jvShare: number | null } {
    if (gross == null) return { ourShare: null, jvShare: null };
    if (!mode || mode === 'none') return { ourShare: gross, jvShare: 0 };

    if (mode === 'fifty_fifty') {
      const half = gross / 2;
      return { ourShare: half, jvShare: gross - half };
    }

    if (mode === 'custom') {
      if (percent == null) {
        warnings.push('JV split is custom but percent is missing — falling back to 100% our share');
        return { ourShare: gross, jvShare: 0 };
      }
      if (percent < 0 || percent > 100) {
        warnings.push(`JV split percent ${percent} out of range — clamping`);
        const clamped = Math.max(0, Math.min(100, percent));
        const ours = gross * (clamped / 100);
        return { ourShare: ours, jvShare: gross - ours };
      }
      const ours = gross * (percent / 100);
      return { ourShare: ours, jvShare: gross - ours };
    }

    // Unknown mode — degrade to no split.
    warnings.push(`Unknown JV split mode: ${mode}`);
    return { ourShare: gross, jvShare: 0 };
  }
}
