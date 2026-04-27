import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitCalculationService } from '../leads/profit-calculation.service';

const ALLOWED_EXIT_STRATEGIES = [
  'wholesale',
  'novation',
  'double_close',
  'fix_flip',
  'hold_rental',
  'jv',
  'sub_to',
  'other',
] as const;

const ALLOWED_JV_SPLIT_MODES = ['none', 'fifty_fifty', 'custom'] as const;

const ALLOWED_COST_CATEGORIES = [
  'holding',
  'repair_prep',
  'utilities',
  'marketing',
  'closing',
  'jv_payout',
  'other',
] as const;

export interface UpsertDispositionPlanDto {
  exitStrategy?: string;
  targetSalePrice?: number | null;
  targetCloseDate?: string | null;
  jvPartnerId?: string | null;
  jvSplitMode?: string | null;
  jvSplitPercent?: number | null;
  notes?: string | null;
}

export interface CreateDispositionCostDto {
  category: string;
  description?: string | null;
  amount: number;
  incurredAt?: string | null;
  paidTo?: string | null;
  receiptUrl?: string | null;
}

export interface UpdateDispositionCostDto extends Partial<CreateDispositionCostDto> {}

export interface UpsertFinalSaleDto {
  buyerName?: string | null;
  buyerPartnerId?: string | null;
  finalSalePrice: number;
  saleClosingCosts?: number | null;
  netProceeds?: number | null;
  closedAt: string;
  notes?: string | null;
}

@Injectable()
export class DispositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profitCalc: ProfitCalculationService,
  ) {}

  // ── Disposition Plan ───────────────────────────────────────────────────────

  async getPlan(leadId: string) {
    return (this.prisma as any).dispositionPlan.findUnique({ where: { leadId } });
  }

  async upsertPlan(leadId: string, data: UpsertDispositionPlanDto) {
    if (data.exitStrategy && !(ALLOWED_EXIT_STRATEGIES as readonly string[]).includes(data.exitStrategy)) {
      throw new BadRequestException(`Invalid exit strategy. Must be one of: ${ALLOWED_EXIT_STRATEGIES.join(', ')}`);
    }
    if (data.jvSplitMode != null && !(ALLOWED_JV_SPLIT_MODES as readonly string[]).includes(data.jvSplitMode)) {
      throw new BadRequestException(`Invalid JV split mode. Must be one of: ${ALLOWED_JV_SPLIT_MODES.join(', ')}`);
    }
    if (data.jvSplitMode === 'custom') {
      if (data.jvSplitPercent == null || data.jvSplitPercent < 0 || data.jvSplitPercent > 100) {
        throw new BadRequestException('Custom JV split requires jvSplitPercent in 0–100');
      }
    }
    if (data.jvSplitMode && data.jvSplitMode !== 'none' && !data.jvPartnerId) {
      throw new BadRequestException('JV split mode requires a jvPartnerId');
    }

    const existing = await (this.prisma as any).dispositionPlan.findUnique({ where: { leadId } });

    // First-time create: prefill targetSalePrice from lead.arv so the upgrade
    // path is non-destructive (matches "use ARV as default sale price" UX).
    let computedTarget = data.targetSalePrice;
    if (!existing && computedTarget === undefined) {
      const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { arv: true } });
      computedTarget = lead?.arv ?? null;
    }

    const cleanData: any = {
      ...(data.exitStrategy !== undefined && { exitStrategy: data.exitStrategy }),
      ...(computedTarget !== undefined && { targetSalePrice: computedTarget }),
      ...(data.targetCloseDate !== undefined && {
        targetCloseDate: data.targetCloseDate ? new Date(data.targetCloseDate) : null,
      }),
      ...(data.jvPartnerId !== undefined && { jvPartnerId: data.jvPartnerId }),
      ...(data.jvSplitMode !== undefined && { jvSplitMode: data.jvSplitMode }),
      ...(data.jvSplitPercent !== undefined && { jvSplitPercent: data.jvSplitPercent }),
      ...(data.notes !== undefined && { notes: data.notes }),
    };

    const plan = await (this.prisma as any).dispositionPlan.upsert({
      where: { leadId },
      create: { leadId, exitStrategy: data.exitStrategy ?? 'wholesale', ...cleanData },
      update: cleanData,
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'DISPOSITION_PLAN_UPDATED',
        description: `Disposition plan ${existing ? 'updated' : 'created'}: ${plan.exitStrategy}`,
        metadata: {
          exitStrategy: plan.exitStrategy,
          targetSalePrice: plan.targetSalePrice,
          jvSplitMode: plan.jvSplitMode,
          jvPartnerId: plan.jvPartnerId,
        } as any,
      },
    });

    // Denormalize targetSalePrice + acquired/sold dates onto the lead for fast
    // hero-strip queries; recalculate profit against new plan.
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { targetSalePrice: plan.targetSalePrice ?? null } as any,
    });
    await this.profitCalc.recalculate(leadId);

    return plan;
  }

  // ── Disposition Costs ──────────────────────────────────────────────────────

  async listCosts(leadId: string) {
    return (this.prisma as any).dispositionCost.findMany({
      where: { leadId },
      orderBy: { incurredAt: 'desc' },
    });
  }

  async createCost(leadId: string, data: CreateDispositionCostDto) {
    if (!(ALLOWED_COST_CATEGORIES as readonly string[]).includes(data.category)) {
      throw new BadRequestException(`Invalid cost category. Must be one of: ${ALLOWED_COST_CATEGORIES.join(', ')}`);
    }
    if (data.amount == null || data.amount <= 0) {
      throw new BadRequestException('Cost amount must be greater than zero');
    }

    const cost = await (this.prisma as any).dispositionCost.create({
      data: {
        leadId,
        category: data.category,
        description: data.description ?? null,
        amount: data.amount,
        incurredAt: data.incurredAt ? new Date(data.incurredAt) : new Date(),
        paidTo: data.paidTo ?? null,
        receiptUrl: data.receiptUrl ?? null,
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'COST_ADDED',
        description: `Cost added: ${data.category} — $${Number(data.amount).toLocaleString()}`,
        metadata: { costId: cost.id, category: data.category, amount: data.amount } as any,
      },
    });

    await this.profitCalc.recalculate(leadId);
    return cost;
  }

  async updateCost(leadId: string, costId: string, data: UpdateDispositionCostDto) {
    const existing = await (this.prisma as any).dispositionCost.findFirst({
      where: { id: costId, leadId },
    });
    if (!existing) throw new NotFoundException('Cost not found');

    if (data.category != null && !(ALLOWED_COST_CATEGORIES as readonly string[]).includes(data.category)) {
      throw new BadRequestException(`Invalid cost category. Must be one of: ${ALLOWED_COST_CATEGORIES.join(', ')}`);
    }
    if (data.amount != null && data.amount <= 0) {
      throw new BadRequestException('Cost amount must be greater than zero');
    }

    const cost = await (this.prisma as any).dispositionCost.update({
      where: { id: costId },
      data: {
        ...(data.category !== undefined && { category: data.category }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.incurredAt !== undefined && {
          incurredAt: data.incurredAt ? new Date(data.incurredAt) : new Date(),
        }),
        ...(data.paidTo !== undefined && { paidTo: data.paidTo }),
        ...(data.receiptUrl !== undefined && { receiptUrl: data.receiptUrl }),
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'COST_UPDATED',
        description: `Cost updated: ${cost.category} — $${Number(cost.amount).toLocaleString()}`,
        metadata: { costId, before: existing.amount, after: cost.amount } as any,
      },
    });

    await this.profitCalc.recalculate(leadId);
    return cost;
  }

  async deleteCost(leadId: string, costId: string) {
    const existing = await (this.prisma as any).dispositionCost.findFirst({
      where: { id: costId, leadId },
    });
    if (!existing) throw new NotFoundException('Cost not found');

    await (this.prisma as any).dispositionCost.delete({ where: { id: costId } });
    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'COST_DELETED',
        description: `Cost removed: ${existing.category} — $${Number(existing.amount).toLocaleString()}`,
        metadata: { costId, category: existing.category, amount: existing.amount } as any,
      },
    });

    await this.profitCalc.recalculate(leadId);
    return { deleted: true };
  }

  // ── Final Sale ─────────────────────────────────────────────────────────────

  async getFinalSale(leadId: string) {
    return (this.prisma as any).finalSale.findUnique({ where: { leadId } });
  }

  async upsertFinalSale(leadId: string, data: UpsertFinalSaleDto) {
    if (data.finalSalePrice == null) {
      throw new BadRequestException('finalSalePrice is required');
    }
    if (data.finalSalePrice < 0) {
      throw new BadRequestException('finalSalePrice cannot be negative');
    }
    if (!data.closedAt) {
      throw new BadRequestException('closedAt is required');
    }

    const closedAt = new Date(data.closedAt);

    const sale = await (this.prisma as any).finalSale.upsert({
      where: { leadId },
      create: {
        leadId,
        buyerName: data.buyerName ?? null,
        buyerPartnerId: data.buyerPartnerId ?? null,
        finalSalePrice: data.finalSalePrice,
        saleClosingCosts: data.saleClosingCosts ?? null,
        netProceeds: data.netProceeds ?? null,
        closedAt,
        notes: data.notes ?? null,
      },
      update: {
        ...(data.buyerName !== undefined && { buyerName: data.buyerName }),
        ...(data.buyerPartnerId !== undefined && { buyerPartnerId: data.buyerPartnerId }),
        finalSalePrice: data.finalSalePrice,
        ...(data.saleClosingCosts !== undefined && { saleClosingCosts: data.saleClosingCosts }),
        ...(data.netProceeds !== undefined && { netProceeds: data.netProceeds }),
        closedAt,
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });

    // Denormalize soldDate on the lead for fast queries.
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { soldDate: closedAt } as any,
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'FINAL_SALE_RECORDED',
        description: `Final sale recorded: $${Number(data.finalSalePrice).toLocaleString()} on ${closedAt.toLocaleDateString()}`,
        metadata: {
          finalSalePrice: data.finalSalePrice,
          buyer: data.buyerName,
          buyerPartnerId: data.buyerPartnerId,
        } as any,
      },
    });

    await this.profitCalc.recalculate(leadId);
    return sale;
  }

  // ── Stage transitions ──────────────────────────────────────────────────────

  async markAcquired(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { contract: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    if (!lead.contract || lead.contract.contractStatus !== 'signed') {
      throw new BadRequestException('Cannot mark acquired without a signed contract');
    }

    const now = new Date();
    await this.prisma.contract.update({
      where: { leadId },
      data: { acquiredAt: now } as any,
    });

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { status: 'ACQUIRED', acquiredDate: now } as any,
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'LEAD_ACQUIRED',
        description: 'Lead marked as acquired (title transferred)',
        metadata: { acquiredAt: now.toISOString() } as any,
      },
    });

    await this.profitCalc.recalculate(leadId);
    return { id: leadId, status: 'ACQUIRED', acquiredAt: now };
  }

  async markSold(leadId: string) {
    const finalSale = await (this.prisma as any).finalSale.findUnique({ where: { leadId } });
    if (!finalSale) {
      throw new BadRequestException('Cannot mark sold without a final sale record');
    }

    const profit = await this.profitCalc.recalculate(leadId);
    // Loss → SOLD_LOSS automatically; profitable → SOLD.
    const newStatus =
      profit.ourShare != null && profit.ourShare < 0 ? 'SOLD_LOSS' : 'SOLD';

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { status: newStatus } as any,
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'STATUS_CHANGED',
        description: `Lead marked ${newStatus} (realized profit: ${profit.ourShare != null ? `$${Math.round(profit.ourShare).toLocaleString()}` : 'unknown'})`,
        metadata: { newStatus, ourShare: profit.ourShare, gross: profit.gross } as any,
      },
    });

    return { id: leadId, status: newStatus, profit };
  }
}
