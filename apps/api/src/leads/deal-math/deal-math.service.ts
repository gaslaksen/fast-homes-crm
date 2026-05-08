import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExitStrategy, RepairEstimateMethod } from '@fast-homes/shared';
import {
  DealMathStrategyKey,
  STRATEGY_CONFIGS,
  STRATEGY_KEYS,
} from './strategy-config';

// Phase D — single entry point for everything that mutates Lead-level Deal
// Math state (strategy / repair estimate / strategy inputs). Every mutator
// triggers a recompute + persist of `currentDealNumbers` so Phase E can read
// without recomputing.
//
// We do NOT call ProfitCalculationService here because that service is built
// for *post-acquisition* P&L (it requires contract / sale prices). The Deal
// Math tab is *pre-acquisition* offer math, so we compute outputs in this
// service using the same formulas surfaced in dealMath.ts (FE) and the per-
// strategy config in strategy-config.ts.

const VALID_STRATEGIES: ReadonlySet<string> = new Set(STRATEGY_KEYS);

const VALID_METHODS: ReadonlySet<RepairEstimateMethod> = new Set([
  'PHOTO_ANALYSIS',
  'QUICK_SQFT',
  'MANUAL_BUILDER',
  'AI_TEXT',
  'MANUAL_OVERRIDE',
]);

export interface RepairEstimatePayload {
  value: number | null;
  method: RepairEstimateMethod;
  metadata?: Record<string, unknown> | null;
}

export interface DealMathReadModel {
  strategy: DealMathStrategyKey | null;
  arv: number | null;
  arvConfidence: number | null;
  askingPrice: number | null;
  repairEstimate: number | null;
  repairMethod: RepairEstimateMethod | null;
  repairMetadata: Record<string, unknown> | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, number | null>;
  latestPhotoAnalysis: {
    id: string;
    resultJson: unknown;
    rangeLow: number | null;
    rangeHigh: number | null;
    midpoint: number | null;
    photosAnalyzed: number | null;
    analyzedAt: string;
  } | null;
}

@Injectable()
export class DealMathService {
  private readonly logger = new Logger(DealMathService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Reads ──────────────────────────────────────────────────────────────
  async get(leadId: string): Promise<DealMathReadModel> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        arv: true,
        arvConfidence: true,
        askingPrice: true,
        dispositionStrategy: true,
        currentRepairEstimate: true,
        currentRepairEstimateMethod: true,
        currentRepairEstimateMetadata: true,
        dealMathInputs: true,
        currentDealNumbers: true,
      },
    });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    const strategy = (lead.dispositionStrategy as DealMathStrategyKey) ?? null;
    const inputs =
      strategy && lead.dealMathInputs
        ? ((lead.dealMathInputs as Record<string, unknown>)[strategy] as
            | Record<string, unknown>
            | undefined) ?? {}
        : {};

    const outputs =
      (lead.currentDealNumbers as { outputs?: Record<string, number | null> } | null)
        ?.outputs ?? {};

    const latestPhoto = await this.prisma.photoAnalysisResult.findFirst({
      where: { leadId },
      orderBy: { analyzedAt: 'desc' },
    });

    return {
      strategy,
      arv: lead.arv,
      arvConfidence: lead.arvConfidence,
      askingPrice: lead.askingPrice,
      repairEstimate: lead.currentRepairEstimate,
      repairMethod:
        (lead.currentRepairEstimateMethod as RepairEstimateMethod | null) ?? null,
      repairMetadata:
        (lead.currentRepairEstimateMetadata as Record<string, unknown> | null) ?? null,
      inputs,
      outputs,
      latestPhotoAnalysis: latestPhoto
        ? {
            id: latestPhoto.id,
            resultJson: latestPhoto.resultJson,
            rangeLow: latestPhoto.rangeLow,
            rangeHigh: latestPhoto.rangeHigh,
            midpoint: latestPhoto.midpoint,
            photosAnalyzed: latestPhoto.photosAnalyzed,
            analyzedAt: latestPhoto.analyzedAt.toISOString(),
          }
        : null,
    };
  }

  // ── Writes ─────────────────────────────────────────────────────────────
  async setStrategy(
    leadId: string,
    strategy: DealMathStrategyKey | null,
  ): Promise<DealMathReadModel> {
    if (strategy != null && !VALID_STRATEGIES.has(strategy)) {
      throw new Error(`Invalid strategy: ${strategy}`);
    }
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { dispositionStrategy: strategy ?? null },
    });
    // Mirror to Contract.exitStrategy for Disposition compatibility (Phase E).
    if (strategy != null) {
      await this.mirrorToContract(leadId, strategy);
    }
    await this.computeAndPersist(leadId);
    return this.get(leadId);
  }

  async setStrategyInputs(
    leadId: string,
    strategy: DealMathStrategyKey,
    patch: Record<string, unknown>,
  ): Promise<DealMathReadModel> {
    if (!VALID_STRATEGIES.has(strategy)) {
      throw new Error(`Invalid strategy: ${strategy}`);
    }
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { dealMathInputs: true },
    });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    const existing = (lead.dealMathInputs as Record<string, unknown>) ?? {};
    const existingForStrategy =
      (existing[strategy] as Record<string, unknown>) ?? {};
    const merged: Record<string, unknown> = {
      ...existing,
      [strategy]: { ...existingForStrategy, ...patch },
    };

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { dealMathInputs: merged as Prisma.InputJsonValue },
    });
    await this.computeAndPersist(leadId);
    return this.get(leadId);
  }

  async setRepairEstimate(
    leadId: string,
    payload: RepairEstimatePayload,
  ): Promise<DealMathReadModel> {
    if (!VALID_METHODS.has(payload.method)) {
      throw new Error(`Invalid repair method: ${payload.method}`);
    }
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        currentRepairEstimate: payload.value,
        currentRepairEstimateMethod: payload.method,
        currentRepairEstimateMetadata: (payload.metadata ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        currentRepairEstimateUpdatedAt: new Date(),
      },
    });
    await this.computeAndPersist(leadId);
    return this.get(leadId);
  }

  // ── Compute + persist ──────────────────────────────────────────────────
  async computeAndPersist(leadId: string): Promise<void> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        arv: true,
        askingPrice: true,
        dispositionStrategy: true,
        currentRepairEstimate: true,
        dealMathInputs: true,
      },
    });
    if (!lead) return;

    const strategy = lead.dispositionStrategy as DealMathStrategyKey | null;
    if (!strategy || !VALID_STRATEGIES.has(strategy)) {
      // No strategy selected — clear computed numbers.
      await this.prisma.lead.update({
        where: { id: leadId },
        data: { currentDealNumbers: null, currentDealNumbersUpdatedAt: null },
      });
      return;
    }

    const allInputs = (lead.dealMathInputs as Record<string, unknown>) ?? {};
    const stratInputs =
      (allInputs[strategy] as Record<string, number | string | null>) ?? {};

    const outputs = computeOutputs({
      strategy,
      arv: lead.arv,
      repairEstimate: lead.currentRepairEstimate,
      askingPrice: lead.askingPrice,
      inputs: stratInputs,
    });

    const snapshot = {
      strategy,
      arv: lead.arv,
      repairEstimate: lead.currentRepairEstimate,
      inputs: stratInputs,
      outputs,
      computedAt: new Date().toISOString(),
    };

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        currentDealNumbers: snapshot as unknown as Prisma.InputJsonValue,
        currentDealNumbersUpdatedAt: new Date(),
      },
    });
  }

  // ── Internal ───────────────────────────────────────────────────────────
  private async mirrorToContract(
    leadId: string,
    strategy: ExitStrategy,
  ): Promise<void> {
    // Contract.exitStrategy is required (default 'wholesale'). Upsert keeps
    // the existing path that handleSaveDealNumbers used.
    await this.prisma.contract.upsert({
      where: { leadId },
      update: { exitStrategy: strategy },
      create: { leadId, exitStrategy: strategy },
    });
  }
}

// ── Pure compute (exported for tests) ─────────────────────────────────────
export interface ComputeArgs {
  strategy: DealMathStrategyKey;
  arv: number | null;
  repairEstimate: number | null;
  askingPrice: number | null;
  inputs: Record<string, number | string | null>;
}

export function computeOutputs(args: ComputeArgs): Record<string, number | null> {
  const { strategy, arv, repairEstimate, inputs } = args;
  const r = numOr0(repairEstimate);

  switch (strategy) {
    case 'wholesale': {
      const fee = numOr(inputs.assignmentFee, 15000);
      const maoPct = numOr(inputs.maoPercent, 70) / 100;
      const mao = arv != null ? Math.round(arv * maoPct - r - fee) : null;
      const initialOffer = mao != null ? Math.round(mao * 0.95) : null;
      return {
        assignmentFee: fee,
        mao,
        initialOffer,
        salePrice: mao,
        spread: mao != null && args.askingPrice != null ? mao - args.askingPrice : null,
      };
    }

    case 'jv': {
      const fee = numOr(inputs.jvAssignmentFee, 15000);
      const maoPct = numOr(inputs.maoPercent, 70) / 100;
      const splitPct = numOr(inputs.jvSplitPercent, 50) / 100;
      const mao = arv != null ? Math.round(arv * maoPct - r - fee) : null;
      const totalProfit = fee;
      return {
        mao,
        initialOffer: mao != null ? Math.round(mao * 0.95) : null,
        totalProfit,
        ourShare: Math.round(totalProfit * splitPct),
        partnerShare: Math.round(totalProfit * (1 - splitPct)),
      };
    }

    case 'fix_flip': {
      const targetSale = numOr(inputs.targetSalePrice, arv ?? 0);
      const months = numOr(inputs.holdingPeriodMonths, 6);
      const monthlyCarry = numOr(inputs.monthlyCarryingCost, 1500);
      const acqClose = numOr(inputs.acquisitionClosingCosts, 3000);
      const saleClose = numOr(inputs.saleClosingCosts, 6000);
      const targetProfitPct = numOr(inputs.targetProfitPercent, 20) / 100;

      const carry = monthlyCarry * months;
      const totalCostsExceptAcq = r + carry + acqClose + saleClose;
      const targetProfit = targetSale * targetProfitPct;
      const mao = targetSale > 0
        ? Math.round(targetSale - totalCostsExceptAcq - targetProfit)
        : null;
      const totalInvestment = mao != null ? Math.round(mao + totalCostsExceptAcq) : null;
      const netProfit = mao != null ? Math.round(targetSale - totalInvestment! - 0) : null;
      const roiPercent =
        totalInvestment && totalInvestment > 0 && netProfit != null
          ? Math.round((netProfit / totalInvestment) * 100)
          : null;

      return {
        mao,
        totalInvestment,
        projectedSalePrice: Math.round(targetSale),
        netProfit,
        roiPercent,
      };
    }

    case 'novation': {
      const listPrice = numOr(inputs.targetListPrice, arv ?? 0);
      const commissionPct = numOr(inputs.agentCommissionPercent, 6) / 100;
      const sellerNet = numOr(inputs.sellerNetTarget, 0);
      const costs = numOr(inputs.costsTotal, 0);
      const commission = Math.round(listPrice * commissionPct);
      const estimatedNet = Math.round(listPrice - commission - costs);
      const estimatedProfit = sellerNet > 0 ? Math.round(estimatedNet - sellerNet) : null;
      return {
        listPrice: Math.round(listPrice),
        agentCommission: commission,
        estimatedNetToSeller: estimatedNet,
        estimatedProfit,
      };
    }

    case 'sub_to': {
      const acquisitionPrice = numOr(inputs.loanBalance, 0) + numOr(inputs.sellerEquity, 0);
      const salePrice = numOr(inputs.targetSalePrice, arv ?? 0);
      const costs = numOr(inputs.costsTotal, 0);
      const estimatedProfit = salePrice > 0
        ? Math.round(salePrice - acquisitionPrice - costs - r)
        : null;
      return {
        acquisitionPrice: Math.round(acquisitionPrice),
        salePrice: Math.round(salePrice),
        estimatedProfit,
      };
    }

    case 'other': {
      const acquisitionPrice = numOr(inputs.acquisitionPrice, 0);
      const salePrice = numOr(inputs.targetSalePrice, arv ?? 0);
      const costs = numOr(inputs.costsTotal, 0);
      const estimatedProfit = salePrice > 0
        ? Math.round(salePrice - acquisitionPrice - costs - r)
        : null;
      return {
        acquisitionPrice: Math.round(acquisitionPrice),
        salePrice: Math.round(salePrice),
        estimatedProfit,
      };
    }

    case 'double_close': {
      const targetSale = numOr(inputs.targetSalePrice, arv ?? 0);
      const lightRehab = numOr(inputs.lightRehabBudget, 5000);
      const months = numOr(inputs.holdingPeriodMonths, 2);
      const acqClose = numOr(inputs.acquisitionClosingCosts, 3000);
      const saleClose = numOr(inputs.saleClosingCosts, 6000);
      const carry = months * 1500;

      const costs = lightRehab + acqClose + saleClose + carry;
      const mao = targetSale > 0 ? Math.round(targetSale - costs - targetSale * 0.1) : null;
      const estimatedProfit = mao != null ? Math.round(targetSale - mao - costs) : null;
      return {
        mao,
        projectedSalePrice: Math.round(targetSale),
        estimatedProfit,
      };
    }

    case 'hold_rental': {
      const rent = numOr(inputs.monthlyRent, 0);
      const opex = numOr(inputs.monthlyOperatingExpenses, 0);
      const debt = numOr(inputs.monthlyDebtService, 0);
      const targetCap = numOr(inputs.targetCapRate, 7) / 100;
      const acqClose = numOr(inputs.acquisitionClosingCosts, 3000);

      const noi = (rent - opex) * 12;
      const monthlyCashflow = Math.round(rent - opex - debt);
      // MAO from target cap rate: NOI / cap = value; subtract repairs + acq close
      const valueAtTargetCap = targetCap > 0 ? noi / targetCap : 0;
      const mao = valueAtTargetCap > 0
        ? Math.round(valueAtTargetCap - r - acqClose)
        : null;
      const capRate = mao != null && mao > 0 ? Math.round((noi / mao) * 1000) / 10 : null;

      return {
        mao,
        monthlyCashflow,
        noi: Math.round(noi),
        capRate,
      };
    }

    case 'concierge_listing': {
      const listPrice = numOr(inputs.targetListPrice, arv ?? 0);
      const commissionPct = numOr(inputs.commissionPercent, 6) / 100;
      const closing = numOr(inputs.estimatedClosingCosts, 4000);
      const dom = numOr(inputs.expectedDom, 45);
      const commission = Math.round(listPrice * commissionPct);
      const estimatedNet = Math.round(listPrice - commission - closing);
      return {
        listPrice: Math.round(listPrice),
        commission,
        estimatedNetToSeller: estimatedNet,
        expectedDom: dom,
      };
    }

    default: {
      return {};
    }
  }
}

function numOr(v: unknown, fallback: number): number {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (isFinite(n)) return n;
  }
  return fallback;
}

function numOr0(v: number | null | undefined): number {
  return v != null && isFinite(v) ? v : 0;
}
