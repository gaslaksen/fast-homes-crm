import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LeadSource,
  TaxSaleStage,
  TaxSaleWorkStatus,
  TaxSaleOccupancy,
  TaxSaleMethod,
} from '@fast-homes/shared';
import {
  normalizePhoneDigits,
  isoWeekKey,
  touchDayCount,
  splitOwnerName,
  countyForCity,
  stateForCity,
} from '../foreclosures/foreclosure-scoring.util';
// The generic list-cell normalizers were written for the probate importer and
// are pipeline-agnostic. Imported rather than copied, the same way the probate
// service reuses the foreclosure city/county lookups.
import { cellText, normalizeZip, parseNum, phoneTypeOf, isoToDate } from '../probate/probate.util';
import {
  taxSaleUidOf,
  statuteFor,
  deedFor,
  methodFromText,
  stageFromText,
  occupancyFromText,
  parseDelinquentYears,
  daysUntil,
  saleElapsedPct,
  inCallWindow,
  equityOf,
  equityPctOf,
  netAfterCosts,
  cleanPhones,
  scrubAgeDays,
  scrubFresh,
  callable,
  rescueRuleApplies,
  workupComplete,
  scoreOf,
  priorityOf,
  upsetFloor,
  zillowUrlFor,
  realtorQueryFor,
  parcelUrlFor,
  TaxSalePhone,
  UPSET_DAYS,
} from './tax-sale.util';
import { TaxSaleLeadInput, TaxSaleListFilters, TaxSalePhoneInput } from './tax-sales.types';

export interface CreateTaxSaleResult {
  leadId: string | null;
  created: boolean;
  reason?: string;
}

@Injectable()
export class TaxSalesService {
  private readonly logger = new Logger(TaxSalesService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Writing ──────────────────────────────────────────────────────────────

  /**
   * Idempotently create a Lead + TaxSaleDetail from a normalized row.
   *
   * Uses raw prisma.lead.create rather than LeadsService.createLead so the
   * initial-outreach scheduler is never invoked, and sets autoRespond=false so
   * inbound AI stays silent. A tax sale lead is a stranger pulled off a public
   * county filing who has not asked to hear from anyone, and the calling rules
   * on this list are strict enough that nothing should go out until a tax sale
   * campaign is written and enrolled by hand. Same posture the foreclosure and
   * probate ingestion take, for the same reason.
   */
  async createTaxSaleLead(
    input: TaxSaleLeadInput,
    opts: { organizationId?: string | null },
  ): Promise<CreateTaxSaleResult> {
    const organizationId = opts.organizationId || null;

    const address = cellText(input.address);
    if (!address) {
      return { leadId: null, created: false, reason: 'no property address' };
    }

    const dedupeUid = taxSaleUidOf({ fileNumber: input.fileNumber, address });
    const existing = await this.prisma.taxSaleDetail.findFirst({
      where: { organizationId, dedupeUid },
      select: { leadId: true },
    });
    if (existing) {
      return { leadId: existing.leadId, created: false, reason: 'duplicate' };
    }

    const city = cellText(input.city);
    const state = cellText(input.state) || stateForCity(city) || 'NC';
    const zip = normalizeZip(input.zip);
    const county = cellText(input.county) || countyForCity(city);
    const owner = cellText(input.owner);
    const { firstName, lastName } = splitOwnerName(owner);

    const method = input.method
      ? methodFromText(input.method)
      : methodFromText(input.statute || input.filedBy);
    const stage = input.stage ? stageFromText(input.stage) : TaxSaleStage.JUDGMENT_DOCKETED;
    const occupancy = occupancyFromText(input.occupancy);

    const years = Array.isArray(input.delinquentYears)
      ? input.delinquentYears
      : parseDelinquentYears(input.delinquentYears as string);

    const phones = this.normalizePhones(input.phones);
    const emails = (input.emails || []).map((e) => cellText(e)).filter(Boolean);

    const saleDate = isoToDate(cellText(input.saleDate));
    const scrubbedAt = isoToDate(cellText(input.dncScrubbedAt));

    const money = {
      assessedValue: input.assessedValue ?? null,
      redemptionAmount: input.redemptionAmount ?? null,
    };
    const score = scoreOf({
      ...money,
      stage,
      workStatus: input.workStatus || TaxSaleWorkStatus.NOT_CONTACTED,
      occupancy,
      saleDate,
      doNotCall: false,
      hasMortgage: !!input.hasMortgage,
      hasIrsLien: !!input.hasIrsLien,
      delinquentYears: years,
      tags: input.tags || [],
      phones,
      emails,
      dncScrubbedAt: scrubbedAt,
    });

    const lead = await this.prisma.lead.create({
      data: {
        source: LeadSource.TAX_SALE,
        status: 'NEW',
        // No initial outreach ever (the raw create bypasses the scheduler) and
        // no inbound auto-reply until a tax sale campaign exists.
        autoRespond: false,
        doNotContact: false,
        propertyAddress: address,
        propertyCity: city,
        propertyState: state,
        propertyZip: zip,
        propertyType: cellText(input.propertyType) || null,
        taxAssessedValue: input.assessedValue ?? null,
        ownerOccupied: occupancy === TaxSaleOccupancy.OWNER_OCCUPIED ? true : null,
        sellerFirstName: firstName,
        sellerLastName: lastName,
        sellerPhone: phones[0]?.number ? `+1${phones[0].number}` : '',
        sellerEmail: emails[0] || null,
        organizationId,
        sourceMetadata: {
          taxSale: true,
          fileNumber: cellText(input.fileNumber) || null,
          method,
          importBatch: cellText(input.importBatch) || null,
        },
        taxSaleDetail: {
          create: {
            organizationId,
            dedupeUid,
            importBatch: cellText(input.importBatch) || null,
            fileNumber: cellText(input.fileNumber) || null,
            method,
            statute: cellText(input.statute) || statuteFor(method),
            deedType: cellText(input.deedType) || deedFor(method),
            filedBy: cellText(input.filedBy) || null,
            county: county || null,
            parcelId: cellText(input.parcelId) || null,
            countyOwner: owner || null,
            propertyType: cellText(input.propertyType) || null,
            acreage: input.acreage ?? null,
            ownedSince: cellText(input.ownedSince) || null,
            occupancy,
            saleDate,
            upsetDeadline: isoToDate(cellText(input.upsetDeadline)),
            assessedValue: input.assessedValue ?? null,
            taxesOwed: input.taxesOwed ?? null,
            redemptionAmount: input.redemptionAmount ?? null,
            openingBid: input.openingBid ?? null,
            currentBid: input.currentBid ?? null,
            depositPct: input.depositPct ?? 20,
            delinquentYears: years,
            cityTaxes: !!input.cityTaxes,
            hasMortgage: !!input.hasMortgage,
            hasIrsLien: !!input.hasIrsLien,
            stage,
            priority: priorityOf(score),
            leadScore: score,
            equityPct: equityPctOf(money),
            equitySpread: equityOf(money),
            workStatus: input.workStatus || TaxSaleWorkStatus.NOT_CONTACTED,
            doNotCall: false,
            callNotes: cellText(input.notes) || null,
            tags: input.tags || [],
            workup: { title: false, owner: false, occupancy: false, drive: false },
            touchDays: {},
            touchWeek: isoWeekKey(),
            touchCount: 0,
            phone2: phones[1]?.number || null,
            phone3: phones[2]?.number || null,
            phone4: phones[3]?.number || null,
            phone1Type: phones[0]?.type || null,
            phone2Type: phones[1]?.type || null,
            phone3Type: phones[2]?.type || null,
            phone4Type: phones[3]?.type || null,
            phone1Dnc: phones[0]?.dnc || null,
            phone2Dnc: phones[1]?.dnc || null,
            phone3Dnc: phones[2]?.dnc || null,
            phone4Dnc: phones[3]?.dnc || null,
            email2: emails[1] || null,
            dncScrubbedAt: scrubbedAt,
            zillowUrl: zillowUrlFor(address, city, state, zip),
            realtorQuery: realtorQueryFor(address, city, state, zip),
            realtorZip: zip || null,
            parcelUrl: parcelUrlFor(county),
          },
        },
      },
      select: { id: true },
    });

    return { leadId: lead.id, created: true };
  }

  /** Up to four numbers, 10 digits each, junk dropped rather than stored. */
  private normalizePhones(input?: TaxSalePhoneInput[]): TaxSalePhone[] {
    return (input || [])
      .map((p) => ({
        number: normalizePhoneDigits(p?.number) || '',
        type: phoneTypeOf(p?.type) || (p?.type ? cellText(p.type) : null),
        dnc: p?.dnc || null,
      }))
      .filter((p) => p.number)
      .slice(0, 4);
  }

  /**
   * Apply a card edit. Everything the board can change routes through here so
   * the derived score, priority and equity are recomputed from the values that
   * were actually written rather than drifting behind them.
   */
  async update(id: string, patch: any, organizationId?: string) {
    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        source: LeadSource.TAX_SALE,
        ...(organizationId ? { organizationId } : {}),
      },
      include: { taxSaleDetail: true },
    });
    if (!lead || !lead.taxSaleDetail) return null;

    const d = lead.taxSaleDetail;
    const detailPatch: any = {};
    const leadPatch: any = {};

    const passthrough = [
      'stage', 'workStatus', 'doNotCall', 'callNotes', 'fileNumber', 'filedBy',
      'county', 'parcelId', 'countyOwner', 'propertyType', 'ownedSince',
      'cityTaxes', 'hasMortgage', 'hasIrsLien',
    ];
    for (const k of passthrough) {
      if (patch[k] !== undefined) detailPatch[k] = patch[k];
    }

    const numeric = [
      'acreage', 'assessedValue', 'taxesOwed', 'redemptionAmount',
      'openingBid', 'currentBid', 'depositPct',
    ];
    for (const k of numeric) {
      if (patch[k] !== undefined) detailPatch[k] = patch[k] === null ? null : Number(patch[k]);
    }

    for (const k of ['saleDate', 'upsetDeadline', 'dncScrubbedAt']) {
      if (patch[k] !== undefined) {
        detailPatch[k] = patch[k] ? isoToDate(String(patch[k]).slice(0, 10)) : null;
      }
    }

    if (patch.method !== undefined) {
      const method = methodFromText(patch.method);
      detailPatch.method = method;
      // Statute and deed follow the track unless the caller states its own.
      if (patch.statute === undefined) detailPatch.statute = statuteFor(method);
      if (patch.deedType === undefined) detailPatch.deedType = deedFor(method);
    }
    if (patch.statute !== undefined) detailPatch.statute = patch.statute;
    if (patch.deedType !== undefined) detailPatch.deedType = patch.deedType;
    if (patch.occupancy !== undefined) detailPatch.occupancy = occupancyFromText(patch.occupancy);
    if (patch.tags !== undefined) detailPatch.tags = patch.tags;
    if (patch.workup !== undefined) detailPatch.workup = { ...(d.workup as any), ...patch.workup };
    if (patch.delinquentYears !== undefined) {
      detailPatch.delinquentYears = Array.isArray(patch.delinquentYears)
        ? patch.delinquentYears
        : parseDelinquentYears(patch.delinquentYears);
    }

    // Contacts. phone1/email1 live on the Lead, the rest on the detail. A
    // hand-edited number has not been scrubbed, so writing phones CLEARS the
    // scrub date unless the caller sets one: the alternative is a stale clean
    // bill of health carried over onto a number nobody has checked.
    if (patch.phones !== undefined) {
      const phones = this.normalizePhones(patch.phones);
      leadPatch.sellerPhone = phones[0]?.number ? `+1${phones[0].number}` : '';
      detailPatch.phone2 = phones[1]?.number || null;
      detailPatch.phone3 = phones[2]?.number || null;
      detailPatch.phone4 = phones[3]?.number || null;
      detailPatch.phone1Type = phones[0]?.type || null;
      detailPatch.phone2Type = phones[1]?.type || null;
      detailPatch.phone3Type = phones[2]?.type || null;
      detailPatch.phone4Type = phones[3]?.type || null;
      detailPatch.phone1Dnc = phones[0]?.dnc || null;
      detailPatch.phone2Dnc = phones[1]?.dnc || null;
      detailPatch.phone3Dnc = phones[2]?.dnc || null;
      detailPatch.phone4Dnc = phones[3]?.dnc || null;
      if (patch.dncScrubbedAt === undefined) detailPatch.dncScrubbedAt = null;
    }
    if (patch.emails !== undefined) {
      const emails = (patch.emails || []).map((e: any) => cellText(e)).filter(Boolean);
      leadPatch.sellerEmail = emails[0] || null;
      detailPatch.email2 = emails[1] || null;
    }

    // Weekly touch checkmarks. Checks belonging to a prior ISO week fold into
    // the running touchCount before this week's are applied.
    if (patch.touchDays !== undefined) {
      const week = isoWeekKey();
      if (d.touchWeek && d.touchWeek !== week) {
        detailPatch.touchCount = (d.touchCount || 0) + touchDayCount(d.touchDays);
      }
      detailPatch.touchDays = patch.touchDays;
      detailPatch.touchWeek = week;
      leadPatch.lastTouchedAt = new Date();
    }

    if (patch.workStatus === 'DEAD') leadPatch.status = 'DEAD';
    if (patch.doNotCall !== undefined) leadPatch.doNotContact = patch.doNotCall;

    const merged = { ...d, ...detailPatch };
    const phonesNow = this.phonesOf(
      leadPatch.sellerPhone !== undefined ? leadPatch.sellerPhone : lead.sellerPhone,
      merged,
    );
    const emailsNow = this.emailsOf(
      leadPatch.sellerEmail !== undefined ? leadPatch.sellerEmail : lead.sellerEmail,
      merged,
    );
    const score = scoreOf({
      assessedValue: merged.assessedValue,
      redemptionAmount: merged.redemptionAmount,
      stage: merged.stage,
      workStatus: merged.workStatus,
      occupancy: merged.occupancy,
      saleDate: merged.saleDate,
      doNotCall: merged.doNotCall,
      hasMortgage: merged.hasMortgage,
      hasIrsLien: merged.hasIrsLien,
      delinquentYears: (merged.delinquentYears as number[]) || [],
      tags: (merged.tags as string[]) || [],
      phones: phonesNow,
      emails: emailsNow,
      dncScrubbedAt: merged.dncScrubbedAt,
    });
    detailPatch.leadScore = score;
    detailPatch.priority = priorityOf(score);
    detailPatch.equityPct = equityPctOf(merged);
    detailPatch.equitySpread = equityOf(merged);

    if (detailPatch.assessedValue !== undefined) {
      leadPatch.taxAssessedValue = detailPatch.assessedValue;
    }

    await this.prisma.lead.update({
      where: { id },
      data: {
        ...leadPatch,
        taxSaleDetail: { update: detailPatch },
      },
    });

    return this.get(id, organizationId);
  }

  /**
   * Set the work status on every checked lead, which is how a lead is marked
   * Dead from the board.
   *
   * Deliberately the same shape as the other pipelines: ids in, a count out,
   * scoped to the organization and to this pipeline's own source so a stray id
   * from another board cannot be restaged through it.
   */
  async bulkStatus(
    ids: string[],
    status: string,
    organizationId?: string | null,
  ): Promise<{ updated: number; status: string }> {
    const target = String(status || '').toUpperCase();
    if (!Object.values(TaxSaleWorkStatus).includes(target as TaxSaleWorkStatus)) {
      throw new BadRequestException(`Unknown work status "${status}"`);
    }
    if (!ids?.length) return { updated: 0, status: target };

    const leads = await this.prisma.lead.findMany({
      where: {
        id: { in: ids },
        source: LeadSource.TAX_SALE,
        ...(organizationId ? { organizationId } : {}),
      },
      select: { id: true },
    });
    if (!leads.length) return { updated: 0, status: target };

    const res = await this.prisma.taxSaleDetail.updateMany({
      where: { leadId: { in: leads.map((l) => l.id) } },
      data: { workStatus: target },
    });
    return { updated: res.count, status: target };
  }

  async bulkDelete(ids: string[], organizationId?: string) {
    const leads = await this.prisma.lead.findMany({
      where: {
        id: { in: ids },
        source: LeadSource.TAX_SALE,
        ...(organizationId ? { organizationId } : {}),
      },
      select: { id: true },
    });
    if (!leads.length) return { deleted: 0 };
    // TaxSaleDetail cascades off the Lead, so deleting the lead is enough.
    const res = await this.prisma.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } });
    return { deleted: res.count };
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  async get(id: string, organizationId?: string) {
    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        source: LeadSource.TAX_SALE,
        ...(organizationId ? { organizationId } : {}),
      },
      include: { taxSaleDetail: true },
    });
    return lead && lead.taxSaleDetail ? this.toRow(lead) : null;
  }

  /**
   * The board's feed. Everything that can be pushed into Postgres is, and the
   * only pass done in memory is the phone-status filter, which depends on the
   * per-number DNC flags and the scrub age together and has no index to use.
   */
  async list(filters: TaxSaleListFilters) {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(200, filters.pageSize || 60);

    const asList = (v?: string) =>
      String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

    const detailWhere: any = {};

    const priorities = asList(filters.priority);
    if (priorities.length) detailWhere.priority = { in: priorities };

    const workStatuses = asList(filters.workStatus);
    if (workStatuses.length) detailWhere.workStatus = { in: workStatuses };

    const stages = asList(filters.stage);
    if (stages.length) detailWhere.stage = { in: stages };
    else if (filters.hideRedeemed) detailWhere.stage = { not: TaxSaleStage.REDEEMED };

    const methods = asList(filters.method);
    if (methods.length) detailWhere.method = { in: methods.map(methodFromText) };

    if (filters.county) detailWhere.county = filters.county;
    if (filters.propertyType) detailWhere.propertyType = filters.propertyType;
    if (filters.occupancy) detailWhere.occupancy = occupancyFromText(filters.occupancy);
    if (filters.hideDnc) detailWhere.doNotCall = false;
    if (filters.equityMin != null) detailWhere.equityPct = { gte: filters.equityMin };

    if (filters.saleWithinDays != null) {
      const until = new Date();
      until.setDate(until.getDate() + filters.saleWithinDays);
      detailWhere.saleDate = { not: null, lte: until };
    }

    if (filters.payoffBand === 'u10') detailWhere.redemptionAmount = { lt: 10000 };
    if (filters.payoffBand === '10-25') detailWhere.redemptionAmount = { gte: 10000, lt: 25000 };
    if (filters.payoffBand === '25+') detailWhere.redemptionAmount = { gte: 25000 };

    const where: any = {
      source: LeadSource.TAX_SALE,
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(Object.keys(detailWhere).length ? { taxSaleDetail: { is: detailWhere } } : {}),
    };
    if (filters.city) where.propertyCity = filters.city;

    const q = String(filters.search || '').trim();
    if (q) {
      where.OR = [
        { propertyAddress: { contains: q, mode: 'insensitive' } },
        { propertyCity: { contains: q, mode: 'insensitive' } },
        { sellerFirstName: { contains: q, mode: 'insensitive' } },
        { sellerLastName: { contains: q, mode: 'insensitive' } },
        { sellerEmail: { contains: q, mode: 'insensitive' } },
        { taxSaleDetail: { is: { countyOwner: { contains: q, mode: 'insensitive' } } } },
        { taxSaleDetail: { is: { fileNumber: { contains: q, mode: 'insensitive' } } } },
        { taxSaleDetail: { is: { parcelId: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const leads = await this.prisma.lead.findMany({
      where,
      include: { taxSaleDetail: true },
      orderBy: this.orderFor(filters.sort),
      take: 5000,
    });

    let rows = leads.filter((l) => l.taxSaleDetail).map((l) => this.toRow(l));

    // Years delinquent is stored as a JSON array, so its length is not
    // something Postgres can filter on without a generated column.
    if (filters.yearsMin != null) {
      rows = rows.filter((r) => r.yearsBehind >= filters.yearsMin!);
    }

    if (filters.phoneStatus === 'callable') rows = rows.filter((r) => r.callable);
    if (filters.phoneStatus === 'dnc') rows = rows.filter((r) => r.phones.some((p) => p.dnc));
    if (filters.phoneStatus === 'stale') {
      rows = rows.filter((r) => r.phones.length > 0 && !r.scrubFresh);
    }
    if (filters.phoneStatus === 'none') rows = rows.filter((r) => r.phones.length === 0);

    // Score-derived sorts need the computed row, not a column, when a lead has
    // been edited since its last write. leadScore is kept in sync on write, so
    // this only re-orders within the page Postgres already picked.
    if (filters.sort === 'score') rows.sort((a, b) => b.score - a.score);
    if (filters.sort === 'equity') rows.sort((a, b) => b.equity - a.equity);
    if (filters.sort === 'years') rows.sort((a, b) => b.yearsBehind - a.yearsBehind);

    const total = rows.length;
    const start = (page - 1) * pageSize;

    return {
      data: rows.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      cities: Array.from(new Set(leads.map((l) => l.propertyCity).filter(Boolean))).sort(),
      counties: Array.from(
        new Set(leads.map((l) => l.taxSaleDetail?.county).filter(Boolean) as string[]),
      ).sort(),
    };
  }

  private orderFor(sort?: string): any {
    switch (sort) {
      case 'sale':
        // Nulls last: a lead with no sale date has no clock and must not lead
        // a list that is being read as "what is closest to the hammer".
        return [{ taxSaleDetail: { saleDate: { sort: 'asc', nulls: 'last' } } }];
      case 'payoff':
        return [{ taxSaleDetail: { redemptionAmount: { sort: 'asc', nulls: 'last' } } }];
      case 'score':
        return [{ taxSaleDetail: { leadScore: 'desc' } }];
      case 'equity':
        return [{ taxSaleDetail: { equitySpread: { sort: 'desc', nulls: 'last' } } }];
      default:
        return [{ createdAt: 'desc' }];
    }
  }

  async stats(organizationId?: string) {
    const leads = await this.prisma.lead.findMany({
      where: {
        source: LeadSource.TAX_SALE,
        ...(organizationId ? { organizationId } : {}),
      },
      include: { taxSaleDetail: true },
    });
    const rows = leads.filter((l) => l.taxSaleDetail).map((l) => this.toRow(l));

    return {
      total: rows.length,
      high: rows.filter((r) => r.priority === 'HIGH').length,
      saleWithin14: rows.filter(
        (r) =>
          r.daysToSale !== null &&
          r.daysToSale >= 0 &&
          r.daysToSale <= 14 &&
          r.stage !== TaxSaleStage.REDEEMED,
      ).length,
      equity40: rows.filter((r) => r.equityPct >= 40).length,
    };
  }

  // ─── Shaping ──────────────────────────────────────────────────────────────

  private phonesOf(sellerPhone: string | null, d: any): TaxSalePhone[] {
    const raw: TaxSalePhone[] = [
      { number: normalizePhoneDigits(sellerPhone) || '', type: d.phone1Type, dnc: d.phone1Dnc },
      { number: normalizePhoneDigits(d.phone2) || '', type: d.phone2Type, dnc: d.phone2Dnc },
      { number: normalizePhoneDigits(d.phone3) || '', type: d.phone3Type, dnc: d.phone3Dnc },
      { number: normalizePhoneDigits(d.phone4) || '', type: d.phone4Type, dnc: d.phone4Dnc },
    ];
    return raw.filter((p) => p.number);
  }

  private emailsOf(sellerEmail: string | null, d: any): string[] {
    return [sellerEmail, d.email2].map((e) => cellText(e)).filter(Boolean);
  }

  /**
   * One card's worth of lead. Everything derived is computed here rather than
   * on the client so the board, the CSV export, and the stats all agree.
   */
  private toRow(lead: any) {
    const d = lead.taxSaleDetail;
    const phones = this.phonesOf(lead.sellerPhone, d);
    const emails = this.emailsOf(lead.sellerEmail, d);

    const week = isoWeekKey();
    const staleWeek = d.touchWeek && d.touchWeek !== week;
    const touchDays = staleWeek ? {} : (d.touchDays as Record<string, boolean>) || {};
    const totalTouches = (d.touchCount || 0) + touchDayCount(d.touchDays);

    const money = { assessedValue: d.assessedValue, redemptionAmount: d.redemptionAmount };
    const years = ((d.delinquentYears as number[]) || []).slice();
    const daysToSale = daysUntil(d.saleDate);
    const daysToUpset = daysUntil(d.upsetDeadline);

    const score = scoreOf({
      ...money,
      stage: d.stage,
      workStatus: d.workStatus,
      occupancy: d.occupancy,
      saleDate: d.saleDate,
      doNotCall: d.doNotCall,
      hasMortgage: d.hasMortgage,
      hasIrsLien: d.hasIrsLien,
      delinquentYears: years,
      tags: (d.tags as string[]) || [],
      phones,
      emails,
      dncScrubbedAt: d.dncScrubbedAt,
    });

    return {
      id: lead.id,
      address: lead.propertyAddress,
      city: lead.propertyCity,
      state: lead.propertyState,
      zip: lead.propertyZip,
      county: d.county,
      parcelId: d.parcelId,

      owner: d.countyOwner || `${lead.sellerFirstName} ${lead.sellerLastName}`.trim(),
      fileNumber: d.fileNumber,
      method: d.method || TaxSaleMethod.IN_REM,
      statute: d.statute || statuteFor(d.method),
      deedType: d.deedType || deedFor(d.method),
      filedBy: d.filedBy,

      stage: d.stage,
      workStatus: d.workStatus,
      priority: priorityOf(score),
      score,

      saleDate: d.saleDate,
      upsetDeadline: d.upsetDeadline,
      daysToSale,
      daysToUpset,
      saleElapsedPct: saleElapsedPct(d.saleDate),
      upsetDays: UPSET_DAYS,

      assessedValue: d.assessedValue,
      taxesOwed: d.taxesOwed,
      redemptionAmount: d.redemptionAmount,
      openingBid: d.openingBid,
      currentBid: d.currentBid,
      nextUpsetBid: d.currentBid ? upsetFloor(d.currentBid) : null,
      depositPct: d.depositPct,
      // What the payoff adds on top of the taxes themselves: interest, fees
      // and costs, which is the line the card shows in the waterfall.
      payoffExtras: Math.max(0, (d.redemptionAmount || 0) - (d.taxesOwed || 0)),
      delinquentYears: years,
      yearsBehind: years.length,
      cityTaxes: d.cityTaxes,
      hasMortgage: d.hasMortgage,
      hasIrsLien: d.hasIrsLien,

      equity: equityOf(money),
      equityPct: equityPctOf(money),
      netAfterCosts: netAfterCosts(money),

      propertyType: d.propertyType,
      acreage: d.acreage,
      ownedSince: d.ownedSince,
      occupancy: d.occupancy,
      rescueRuleApplies: rescueRuleApplies(d.occupancy),

      phones,
      emails,
      cleanPhoneCount: cleanPhones(phones).length,
      dncScrubbedAt: d.dncScrubbedAt,
      scrubAgeDays: scrubAgeDays(d.dncScrubbedAt),
      scrubFresh: scrubFresh(d.dncScrubbedAt),
      callable: callable({ doNotCall: d.doNotCall, phones, dncScrubbedAt: d.dncScrubbedAt }),
      inCallWindow: inCallWindow(),

      doNotCall: d.doNotCall,
      callNotes: d.callNotes || '',
      tags: (d.tags as string[]) || [],
      workup: (d.workup as Record<string, boolean>) || {},
      workupComplete: workupComplete(d.workup),

      touchDays,
      totalTouches,

      zillowUrl: d.zillowUrl,
      realtorQuery: d.realtorQuery,
      realtorZip: d.realtorZip,
      parcelUrl: d.parcelUrl,

      createdAt: lead.createdAt,
    };
  }
}
