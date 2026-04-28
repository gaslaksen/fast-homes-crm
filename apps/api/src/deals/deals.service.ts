import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LeadStatus } from '@fast-homes/shared';
import {
  DEAL_STATUSES,
  DealRow,
  DealsListCounts,
  DealsListFilters,
  DealsListResponse,
  DealsSummaryFilters,
  DealsSummaryResponse,
  DealsViewSortKey,
  EXPECTED_STATUSES,
  POTENTIAL_STATUSES,
  ProfitBucket,
  REALIZED_STATUSES,
} from './deals.types';

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Summary ────────────────────────────────────────────────────────────

  async getSummary(filters: DealsSummaryFilters): Promise<DealsSummaryResponse> {
    const orgFilter = { organizationId: filters.organizationId };

    // Realized range defaults to YTD if not provided. Clients usually pass
    // explicit ISO bounds (computed in browser tz); this is just a fallback
    // so the endpoint is usable without args.
    let realizedFrom = filters.realizedFrom;
    let realizedTo = filters.realizedTo;
    if (!realizedFrom && !realizedTo) {
      const now = new Date();
      realizedFrom = new Date(now.getFullYear(), 0, 1);
      realizedTo = now;
    }

    const realizedDateClause: Prisma.DateTimeNullableFilter<'Lead'> = {};
    if (realizedFrom) realizedDateClause.gte = realizedFrom;
    if (realizedTo) realizedDateClause.lte = realizedTo;

    // Status is the source of truth for which bucket a deal belongs to —
    // the cached `profitBucket` column can lag behind status changes (it
    // only refreshes on disposition mutations, not on bare status moves).
    // Filtering by status alone keeps the cards consistent with the table.
    const [potential, expected, realized] = await Promise.all([
      this.prisma.lead.aggregate({
        where: { ...orgFilter, status: { in: POTENTIAL_STATUSES } },
        _sum: { realizedProfit: true },
        _count: true,
      }),
      this.prisma.lead.aggregate({
        where: { ...orgFilter, status: { in: EXPECTED_STATUSES } },
        _sum: { realizedProfit: true },
        _count: true,
      }),
      this.prisma.lead.aggregate({
        where: {
          ...orgFilter,
          status: { in: REALIZED_STATUSES },
          ...(Object.keys(realizedDateClause).length
            ? { soldDate: realizedDateClause }
            : {}),
        },
        _sum: { realizedProfit: true },
        _count: true,
      }),
    ]);

    return {
      potential: {
        sum: potential._sum.realizedProfit ?? 0,
        count: potential._count,
      },
      expected: {
        sum: expected._sum.realizedProfit ?? 0,
        count: expected._count,
      },
      realized: {
        sum: realized._sum.realizedProfit ?? 0,
        count: realized._count,
        range: {
          from: realizedFrom ? realizedFrom.toISOString() : null,
          to: realizedTo ? realizedTo.toISOString() : null,
        },
      },
    };
  }

  // ─── List ───────────────────────────────────────────────────────────────

  async listDeals(filters: DealsListFilters): Promise<DealsListResponse> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 25;
    const skip = (page - 1) * limit;

    const where = this.buildListWhere(filters);

    const orderBy = this.buildOrderBy(filters.sort, filters.dir);

    const [rows, total, counts] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: {
          dispositionPlan: {
            include: { jvPartner: { select: { id: true, name: true } } },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.lead.count({ where }),
      this.computeCounts(filters),
    ]);

    return {
      deals: rows.map((r) => this.toDealRow(r)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      counts,
    };
  }

  // ─── CSV Export ─────────────────────────────────────────────────────────

  async exportCsv(filters: DealsListFilters): Promise<string> {
    // Pull all matching rows. The brief's richer columns require dispositionCosts
    // grouped by category; pull them inline.
    const where = this.buildListWhere(filters);
    const rows = await this.prisma.lead.findMany({
      where,
      include: {
        dispositionPlan: {
          include: { jvPartner: { select: { id: true, name: true } } },
        },
        dispositionCosts: { select: { category: true, amount: true } },
        finalSale: { select: { finalSalePrice: true, saleClosingCosts: true, closedAt: true } },
        contract: { select: { offerAmount: true, acquisitionClosingCosts: true } },
      },
      orderBy: this.buildOrderBy(filters.sort, filters.dir),
    });

    const headers = [
      'Seller',
      'Property Address',
      'City',
      'State',
      'Zip',
      'Stage',
      'Exit Strategy',
      'JV Partner',
      'JV Split Mode',
      'JV Split %',
      'Acquisition Price',
      'Acquisition Closing Costs',
      'Target Sale Price',
      'Final Sale Price',
      'Sale Closing Costs',
      'Holding Costs',
      'Repair / Prep Costs',
      'Utilities',
      'Marketing',
      'JV Payout',
      'Other Costs',
      'Our-Share Profit',
      'Gross Profit',
      'Profit Bucket',
      'Days in Stage',
      'Acquired Date',
      'Sold Date',
    ];

    const csvRows = rows.map((r: any) => {
      const costsByCategory = (r.dispositionCosts ?? []).reduce(
        (acc: Record<string, number>, c: any) => {
          acc[c.category] = (acc[c.category] ?? 0) + (c.amount ?? 0);
          return acc;
        },
        {},
      );

      const ourShare = r.realizedProfit ?? null;
      const gross = this.computeGross(
        ourShare,
        r.dispositionPlan?.jvSplitMode ?? null,
        r.dispositionPlan?.jvSplitPercent ?? null,
      );

      return [
        csvField(`${r.sellerFirstName ?? ''} ${r.sellerLastName ?? ''}`.trim()),
        csvField(r.propertyAddress),
        csvField(r.propertyCity ?? ''),
        r.propertyState ?? '',
        r.propertyZip ?? '',
        r.status ?? '',
        r.dispositionPlan?.exitStrategy ?? '',
        csvField(r.dispositionPlan?.jvPartner?.name ?? ''),
        r.dispositionPlan?.jvSplitMode ?? '',
        r.dispositionPlan?.jvSplitPercent ?? '',
        r.contract?.offerAmount ?? '',
        r.contract?.acquisitionClosingCosts ?? '',
        r.dispositionPlan?.targetSalePrice ?? r.targetSalePrice ?? '',
        r.finalSale?.finalSalePrice ?? '',
        r.finalSale?.saleClosingCosts ?? '',
        costsByCategory['holding'] ?? '',
        costsByCategory['repair_prep'] ?? '',
        costsByCategory['utilities'] ?? '',
        costsByCategory['marketing'] ?? '',
        costsByCategory['jv_payout'] ?? '',
        costsByCategory['other'] ?? '',
        ourShare ?? '',
        gross ?? '',
        bucketFromStatus(r.status) ?? '',
        r.daysInStage ?? '',
        r.acquiredDate ? new Date(r.acquiredDate).toISOString().slice(0, 10) : '',
        r.soldDate ? new Date(r.soldDate).toISOString().slice(0, 10) : '',
      ];
    });

    return [headers.join(','), ...csvRows.map((r) => r.join(','))].join('\n');
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private buildListWhere(filters: DealsListFilters): Prisma.LeadWhereInput {
    const where: Prisma.LeadWhereInput = {
      organizationId: filters.organizationId,
      status: { in: filters.status?.length ? filters.status : DEAL_STATUSES },
    };

    // Bucket filter is implemented by status membership, not by the cached
    // profitBucket column — status is authoritative (see summary query).
    if (filters.bucket?.length) {
      const allowed = new Set<string>();
      for (const b of filters.bucket) {
        if (b === 'potential') POTENTIAL_STATUSES.forEach((s) => allowed.add(s));
        else if (b === 'expected') EXPECTED_STATUSES.forEach((s) => allowed.add(s));
        else if (b === 'realized') REALIZED_STATUSES.forEach((s) => allowed.add(s));
      }
      // Intersect with any status filter the caller already set.
      if (filters.status?.length) {
        const inter = filters.status.filter((s) => allowed.has(s));
        where.status = { in: inter.length ? inter : Array.from(allowed) };
      } else {
        where.status = { in: Array.from(allowed) };
      }
    }

    if (filters.exitStrategy?.length) {
      where.dispositionPlan = { exitStrategy: { in: filters.exitStrategy } };
    }

    if (filters.hasJvPartner) {
      where.dispositionPlan = {
        ...(where.dispositionPlan as Prisma.DispositionPlanWhereInput | undefined),
        jvPartnerId: { not: null },
      };
    }

    if (filters.search) {
      where.OR = [
        { propertyAddress: { contains: filters.search, mode: 'insensitive' } },
        { propertyCity: { contains: filters.search, mode: 'insensitive' } },
        { sellerFirstName: { contains: filters.search, mode: 'insensitive' } },
        { sellerLastName: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (filters.acquiredFrom || filters.acquiredTo) {
      const f: Prisma.DateTimeNullableFilter<'Lead'> = {};
      if (filters.acquiredFrom) f.gte = filters.acquiredFrom;
      if (filters.acquiredTo) f.lte = filters.acquiredTo;
      where.acquiredDate = f;
    }

    if (filters.soldFrom || filters.soldTo) {
      const f: Prisma.DateTimeNullableFilter<'Lead'> = {};
      if (filters.soldFrom) f.gte = filters.soldFrom;
      if (filters.soldTo) f.lte = filters.soldTo;
      where.soldDate = f;
    }

    return where;
  }

  private buildOrderBy(
    sort?: DealsViewSortKey,
    dir?: 'asc' | 'desc',
  ): Prisma.LeadOrderByWithRelationInput[] {
    const d = dir ?? 'desc';
    switch (sort) {
      case 'daysInStage':
        return [{ daysInStage: d }, { stageChangedAt: 'asc' }];
      case 'acquiredDate':
        return [{ acquiredDate: { sort: d, nulls: 'last' } }, { id: 'desc' }];
      case 'soldDate':
        return [{ soldDate: { sort: d, nulls: 'last' } }, { id: 'desc' }];
      case 'propertyAddress':
        return [{ propertyAddress: d }];
      case 'profit':
      default:
        return [{ realizedProfit: { sort: d, nulls: 'last' } }, { id: 'desc' }];
    }
  }

  // For each chip group, run a count query with that group's own filter
  // dropped — so chip counts reflect "what would happen if I added this chip
  // to my current selection." Mirrors LeadsService.listLeads chip-counts.
  private async computeCounts(filters: DealsListFilters): Promise<DealsListCounts> {
    const baseForStage: DealsListFilters = { ...filters, status: undefined };
    const baseForBucket: DealsListFilters = { ...filters, bucket: undefined };
    const baseForExit: DealsListFilters = { ...filters, exitStrategy: undefined };
    const baseForJv: DealsListFilters = { ...filters, hasJvPartner: undefined };

    const [byStageGroups, byBucketGroups, byExitGroups, hasJvPartner] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['status'],
        where: this.buildListWhere(baseForStage),
        _count: true,
      }),
      // Bucket counts derived from status groupings (see summary).
      this.prisma.lead.groupBy({
        by: ['status'],
        where: this.buildListWhere(baseForBucket),
        _count: true,
      }),
      this.prisma.dispositionPlan.groupBy({
        by: ['exitStrategy'],
        where: {
          lead: this.buildListWhere(baseForExit),
        },
        _count: true,
      }),
      this.prisma.lead.count({
        where: {
          ...this.buildListWhere(baseForJv),
          dispositionPlan: { jvPartnerId: { not: null } },
        },
      }),
    ]);

    const byStage: Record<string, number> = {};
    for (const g of byStageGroups) byStage[g.status] = g._count;

    const byBucket: Record<string, number> = { potential: 0, expected: 0, realized: 0 };
    for (const g of byBucketGroups) {
      const b = bucketFromStatus(g.status);
      if (b) byBucket[b] += g._count;
    }

    const byExitStrategy: Record<string, number> = {};
    for (const g of byExitGroups) {
      if (g.exitStrategy) byExitStrategy[g.exitStrategy] = g._count;
    }

    return { byStage, byBucket, byExitStrategy, hasJvPartner };
  }

  private toDealRow(r: any): DealRow {
    const ourShare = r.realizedProfit ?? null;
    const plan = r.dispositionPlan ?? null;
    const gross = this.computeGross(
      ourShare,
      plan?.jvSplitMode ?? null,
      plan?.jvSplitPercent ?? null,
    );

    const ownerName =
      `${r.sellerFirstName ?? ''} ${r.sellerLastName ?? ''}`.trim() ||
      'Unknown Owner';

    return {
      id: r.id,
      ownerName,
      propertyAddress: r.propertyAddress ?? '',
      propertyCity: r.propertyCity ?? '',
      propertyState: r.propertyState ?? '',
      status: r.status,
      // Bucket derived from status (see summary query) — keeps row badge
      // and hero card in sync even when the cached profitBucket is stale.
      bucket: bucketFromStatus(r.status),
      exitStrategy: plan?.exitStrategy ?? null,
      jvPartnerId: plan?.jvPartnerId ?? null,
      jvPartnerName: plan?.jvPartner?.name ?? null,
      jvSplitMode: plan?.jvSplitMode ?? null,
      jvSplitPercent: plan?.jvSplitPercent ?? null,
      ourShareProfit: ourShare,
      grossProfit: gross,
      daysInStage: r.daysInStage ?? 0,
      stageChangedAt: r.stageChangedAt ? new Date(r.stageChangedAt).toISOString() : new Date().toISOString(),
      acquiredDate: r.acquiredDate ? new Date(r.acquiredDate).toISOString() : null,
      soldDate: r.soldDate ? new Date(r.soldDate).toISOString() : null,
    };
  }

  // Derive gross from cached our-share without re-running the full calculator.
  // Mirrors ProfitCalculationService.applyJvSplit inversely.
  private computeGross(
    ourShare: number | null,
    mode: string | null,
    pct: number | null,
  ): number | null {
    if (ourShare == null) return null;
    if (!mode || mode === 'none') return ourShare;
    if (mode === 'fifty_fifty') return ourShare * 2;
    if (mode === 'custom' && pct && pct > 0) return ourShare / (pct / 100);
    return ourShare;
  }
}

function bucketFromStatus(status: string): ProfitBucket | null {
  if (POTENTIAL_STATUSES.includes(status as any)) return 'potential';
  if (EXPECTED_STATUSES.includes(status as any)) return 'expected';
  if (REALIZED_STATUSES.includes(status as any)) return 'realized';
  return null;
}

function csvField(s: string): string {
  // Quote anything that might contain commas/quotes/newlines.
  const needsQuotes = /[",\n\r]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}
