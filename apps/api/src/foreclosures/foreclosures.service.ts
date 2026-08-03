import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadSource } from '@fast-homes/shared';
import { ForeclosureLeadInput, ForeclosureListFilters } from './foreclosure.types';
import {
  uidOf,
  scoreOf,
  normalizePriority,
  equitySpreadOf,
  daysToSale,
  parseDateISO,
  isoToDate,
  normalizePhoneDigits,
  phoneTypeOf,
  isoWeekKey,
  touchDayCount,
  zillowUrlOf,
  realtorQueryOf,
  parcelLinkFor,
  splitOwnerName,
  ownerOccupiedFrom,
  looksDead,
  stateForCity,
  countyForCity,
  citiesInCounty,
} from './foreclosure-scoring.util';
import { normalizeCaseNumber } from './foreclosure-document.util';
import { mergeFilingFields } from './foreclosure-case-merge.util';

/** Most severe first, matching the signals service's own ordering. */
const SEVERITY_RANK: Record<string, number> = { critical: 3, notable: 2, info: 1 };

export interface CreateForeclosureResult {
  leadId: string | null;
  created: boolean;
  reason?: string;
}

@Injectable()
export class ForeclosuresService {
  private readonly logger = new Logger(ForeclosuresService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Idempotently create a foreclosure Lead + ForeclosureDetail from a
   * normalized input. Uses raw prisma.lead.create so the initial-outreach
   * scheduler is never invoked, and sets autoRespond=false so inbound AI stays
   * silent until foreclosure campaigns are enabled. Dedupes on dedupeUid.
   */
  async createForeclosureLead(
    input: ForeclosureLeadInput,
    opts: { organizationId?: string | null },
  ): Promise<CreateForeclosureResult> {
    const organizationId = opts.organizationId || null;

    const address = (input.address || '').trim();
    if (!address && !input.ownerNames && !input.caseNumber) {
      return { leadId: null, created: false, reason: 'empty row' };
    }

    const saleIso = parseDateISO(input.saleDate);
    const hearingIso = parseDateISO(input.hearingDate);
    const loanIso = parseDateISO(input.loanDate);
    const dedupeUid = uidOf({ caseNumber: input.caseNumber, address, saleDate: saleIso });
    const caseKey = normalizeCaseNumber(input.caseNumber);

    // Idempotency, in three layers. dedupeUid and noticeId identify the same
    // notice; caseNumber identifies the same CASE, which is what stops a later
    // filing (a Notice of Sale, carrying the auction date) forking a second
    // lead for a property we are already working. dedupeUid cannot do that job
    // on its own because it folds in the sale date, so it changes the moment
    // the sale is scheduled.
    const existing = await this.prisma.foreclosureDetail.findFirst({
      where: {
        organizationId,
        OR: [
          { dedupeUid },
          ...(input.noticeId ? [{ noticeId: input.noticeId }] : []),
          ...(caseKey ? [{ caseNumber: caseKey }] : []),
        ],
      },
      select: {
        id: true,
        leadId: true,
        dedupeUid: true,
        noticeId: true,
        caseNumber: true,
        noticeType: true,
        noticeUrl: true,
        trustee: true,
        county: true,
        saleDate: true,
        hearingDate: true,
        loanDate: true,
        loanAmount: true,
        assessedValue: true,
        equityPct: true,
        ownerOccupied: true,
        skipStatus: true,
        debtFigureReliable: true,
      },
    });

    if (existing) {
      const sameNotice =
        existing.dedupeUid === dedupeUid ||
        (!!input.noticeId && existing.noticeId === input.noticeId);
      if (sameNotice) {
        return { leadId: existing.leadId, created: false, reason: 'duplicate' };
      }
      // Matched on case number alone: a genuinely new filing on a case we
      // already track. Fold its facts in rather than dropping them.
      return this.mergeIntoExistingCase(existing, input, { saleIso, hearingIso, loanIso });
    }

    // Fall back to comparing the mailing and property addresses when the
    // source carries no occupancy column. Purchased lists ship the mailing
    // address but never the flag, and occupancy drives both the absentee
    // filter and the score, so deriving it beats leaving it blank.
    const ownerOccupied =
      input.ownerOccupied || ownerOccupiedFrom(input.mailingAddress, address) || undefined;

    const derived = this.buildDerived({ ...input, ownerOccupied }, { saleIso, loanIso });

    const split = splitOwnerName(input.ownerNames || input.countyOwner);
    const firstName = (input.ownerFirstName || '').trim() || split.firstName;
    const lastName = (input.ownerLastName || '').trim() || split.lastName;
    const phone1 = normalizePhoneDigits(input.phone1) || '';
    const phone2 = normalizePhoneDigits(input.phone2) || null;
    const phone3 = normalizePhoneDigits(input.phone3) || null;
    const phone4 = normalizePhoneDigits(input.phone4) || null;
    const int = (n?: number | null) => (n == null ? undefined : Math.round(n));

    const lead = await this.prisma.lead.create({
      data: {
        source: LeadSource.FORECLOSURE,
        status: 'NEW',
        // No initial outreach ever (raw create bypasses the scheduler); hold
        // inbound AI too until foreclosure campaigns are built.
        autoRespond: false,
        doNotContact: false,
        propertyAddress: address || 'Unknown',
        propertyCity: (input.city || '').trim(),
        propertyState: (input.state || stateForCity(input.city)).trim(),
        propertyZip: (input.zip || '').trim(),
        propertyType: input.propertyType || null,
        bedrooms: int(input.bedrooms),
        bathrooms: input.bathrooms ?? undefined,
        sqft: int(input.sqft),
        yearBuilt: int(input.yearBuilt),
        sellerFirstName: firstName,
        sellerLastName: lastName,
        sellerPhone: phone1,
        sellerEmail: input.email || null,
        organizationId,
        sourceMetadata: {
          foreclosure: true,
          noticeType: input.noticeType || null,
          caseNumber: input.caseNumber || null,
          sourceKind: input.sourceKind,
        },
        ...(input.dateAdded && isoToDate(parseDateISO(input.dateAdded))
          ? { createdAt: isoToDate(parseDateISO(input.dateAdded))! }
          : {}),
        foreclosureDetail: {
          create: {
            organizationId,
            dedupeUid,
            noticeId: input.noticeId || null,
            noticeType: input.noticeType || null,
            noticeUrl: input.noticeUrl || null,
            // Stored canonical so a later filing on the same case matches on
            // the dedupe lookup regardless of how the source spaced it.
            caseNumber: caseKey || input.caseNumber || null,
            county: input.county || countyForCity(input.city),
            trustee: input.trustee || null,
            rawSnippet: input.rawSnippet || null,
            sourceKind: input.sourceKind,
            saleDate: isoToDate(saleIso),
            hearingDate: isoToDate(hearingIso),
            loanDate: isoToDate(loanIso),
            loanAmount: input.loanAmount ?? null,
            assessedValue: input.assessedValue ?? null,
            priority: derived.priority,
            leadScore: derived.score,
            equityPct: input.equityPct ?? null,
            equitySpread: derived.equitySpread,
            workStatus: 'NOT_CONTACTED',
            doNotCall: false,
            countyOwner: input.countyOwner || null,
            ownerOccupied: ownerOccupied || null,
            mailingAddress: input.mailingAddress || null,
            mailCity: input.mailCity || null,
            mailState: input.mailState || null,
            mailZip: input.mailZip || null,
            skipStatus: input.skipStatus || null,
            phone2,
            phone3,
            phone4,
            phone1Type: input.phone1Type || phoneTypeOf(input.phone1),
            phone2Type: input.phone2Type || phoneTypeOf(input.phone2),
            phone3Type: input.phone3Type || phoneTypeOf(input.phone3),
            phone4Type: input.phone4Type || phoneTypeOf(input.phone4),
            email2: input.email2 || null,
            parcelId: derived.parcel.parcelId || null,
            parcelUrl: derived.parcel.parcelUrl,
            parcelType: derived.parcel.parcelType,
            parcelLabel: derived.parcel.parcelLabel,
            zillowUrl: derived.zillowUrl || null,
            realtorQuery: derived.realtorQuery || null,
            realtorZip: input.zip || input.city || null,
          },
        },
      },
      select: { id: true },
    });

    return { leadId: lead.id, created: true };
  }

  /**
   * Fold a later filing on a known case into the lead that already represents
   * it. Only court facts move; work status, do-not-call, call notes, touch
   * tracking, and everything skip trace wrote are left alone.
   *
   * Priority and score are recomputed when a date moves, because both are
   * derived from days-to-sale and neither is user-editable (see update(), which
   * exposes no priority field). A merge that changes nothing writes nothing.
   */
  private async mergeIntoExistingCase(
    existing: {
      id: string;
      leadId: string;
      caseNumber: string | null;
      noticeType: string | null;
      noticeUrl: string | null;
      trustee: string | null;
      county: string | null;
      saleDate: Date | null;
      hearingDate: Date | null;
      loanDate: Date | null;
      loanAmount: number | null;
      assessedValue: number | null;
      equityPct: number | null;
      ownerOccupied: string | null;
      skipStatus: string | null;
      debtFigureReliable: boolean;
    },
    input: ForeclosureLeadInput,
    dates: { saleIso: string; hearingIso: string; loanIso: string },
  ): Promise<CreateForeclosureResult> {
    const patch = mergeFilingFields(existing, {
      caseNumber: normalizeCaseNumber(input.caseNumber),
      noticeType: input.noticeType || null,
      noticeUrl: input.noticeUrl || null,
      trustee: input.trustee || null,
      county: input.county || countyForCity(input.city),
      saleDate: isoToDate(dates.saleIso),
      hearingDate: isoToDate(dates.hearingIso),
      loanDate: isoToDate(dates.loanIso),
      loanAmount: input.loanAmount ?? null,
      assessedValue: input.assessedValue ?? null,
    });

    if (!Object.keys(patch).length) {
      return { leadId: existing.leadId, created: false, reason: 'duplicate' };
    }

    // Rescore off the merged view of the case, not the incoming filing alone:
    // a Notice of Sale carries a date but no equity or contact facts.
    const merged = { ...existing, ...patch };
    const detailPatch: any = { ...patch };
    if (patch.saleDate !== undefined || patch.loanDate !== undefined) {
      const derived = this.buildDerived(
        {
          ...input,
          equityPct: merged.equityPct,
          assessedValue: merged.assessedValue,
          loanAmount: merged.loanAmount,
          ownerOccupied: merged.ownerOccupied || undefined,
          skipStatus: merged.skipStatus || undefined,
        },
        {
          saleIso: merged.saleDate ? merged.saleDate.toISOString().slice(0, 10) : '',
          loanIso: merged.loanDate ? merged.loanDate.toISOString().slice(0, 10) : '',
        },
      );
      detailPatch.priority = derived.priority;
      detailPatch.leadScore = derived.score;
      // Leave a suppressed spread suppressed. The rules engine blanked it
      // because the recorded debt figure cannot support the arithmetic, and a
      // later filing on the same case does not change that.
      if (existing.debtFigureReliable !== false) {
        detailPatch.equitySpread = derived.equitySpread;
      }
    }

    await this.prisma.foreclosureDetail.update({
      where: { id: existing.id },
      data: detailPatch,
    });

    this.logger.log(
      `Merged filing into existing case ${existing.caseNumber || '(unknown)'} ` +
        `on lead ${existing.leadId}: ${Object.keys(patch).join(', ')}`,
    );
    return { leadId: existing.leadId, created: false, reason: 'merged into existing case' };
  }

  /** Compute the derived scoring/link fields shared by every ingestion path. */
  private buildDerived(
    input: ForeclosureLeadInput,
    dates: { saleIso: string; loanIso: string },
  ) {
    const priority = normalizePriority(input.priority);
    const dts = daysToSale(dates.saleIso);
    const phoneCount = [input.phone1, input.phone2].filter((p) => normalizePhoneDigits(p)).length;
    const dead = looksDead(`${input.notes || ''} ${input.skipStatus || ''}`);
    const score = scoreOf({
      priority,
      equityPct: input.equityPct ?? null,
      ownerOccupied: input.ownerOccupied || null,
      phoneCount,
      hasEmail: !!input.email,
      daysToSale: dts,
      loanDateIso: dates.loanIso || null,
      skipStatus: input.skipStatus || null,
      dead,
    });
    return {
      priority,
      score,
      equitySpread: equitySpreadOf(input.assessedValue ?? null, input.loanAmount ?? null),
      zillowUrl: zillowUrlOf(input.address, input.city, input.zip),
      realtorQuery: realtorQueryOf(input.address, input.city, input.zip),
      parcel: parcelLinkFor(input.address, input.city, input.parcelId),
    };
  }

  /** List foreclosure leads (Lead joined with ForeclosureDetail) with filters. */
  async list(filters: ForeclosureListFilters) {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(200, filters.pageSize || 60);

    // Chip filters arrive as comma-separated lists (multi-select).
    const asList = (v?: string) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

    const detailWhere: any = {};
    const priorities = asList(filters.priority).map((p) => p.toUpperCase());
    if (priorities.length) detailWhere.priority = { in: priorities };
    const workStatuses = asList(filters.workStatus);
    if (workStatuses.length) detailWhere.workStatus = { in: workStatuses };
    const noticeTypes = asList(filters.noticeType);
    if (noticeTypes.length) detailWhere.noticeType = { in: noticeTypes };
    if (filters.occupancy === 'owner') detailWhere.ownerOccupied = 'Y';
    if (filters.occupancy === 'absentee') detailWhere.ownerOccupied = 'N';

    // Equity bands, mirroring the tracker: 50%+, 30-50, 0-30, negative.
    switch (filters.equityBand) {
      case '50': detailWhere.equityPct = { gte: 50 }; break;
      case '30': detailWhere.equityPct = { gte: 30, lt: 50 }; break;
      case '0': detailWhere.equityPct = { gte: 0, lt: 30 }; break;
      case 'neg': detailWhere.equityPct = { lt: 0 }; break;
    }

    // Ownership length: loan originated at least N years ago.
    if (filters.ownedYearsMin) {
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - filters.ownedYearsMin);
      detailWhere.loanDate = { lte: cutoff };
    }

    // Sale window: overdue, or coming up within N days.
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    if (filters.saleWindow === 'over') {
      detailWhere.saleDate = { lt: todayStart };
    } else if (filters.saleWindow && /^\d+$/.test(filters.saleWindow)) {
      const until = new Date();
      until.setDate(until.getDate() + Number(filters.saleWindow));
      detailWhere.saleDate = { gte: todayStart, lte: until };
    }

    if (filters.valueMin) detailWhere.assessedValue = { gte: filters.valueMin };
    if (filters.hideDead && !workStatuses.length) detailWhere.workStatus = { not: 'DEAD' };
    if (filters.hideDnc) detailWhere.doNotCall = false;

    const where: any = {
      source: LeadSource.FORECLOSURE,
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      foreclosureDetail: { is: detailWhere },
    };
    if (filters.city) where.propertyCity = { equals: filters.city, mode: 'insensitive' };
    // County is derived from the city (leads store county but older imports may
    // not), so match on the set of cities that belong to the chosen county.
    if (filters.county) {
      const cityList = citiesInCounty(filters.county);
      where.AND = [
        ...(where.AND || []),
        {
          OR: cityList.length
            ? cityList.map((c) => ({ propertyCity: { equals: c, mode: 'insensitive' } }))
            : [{ foreclosureDetail: { is: { county: filters.county } } }],
        },
      ];
    }
    if (filters.search) {
      const q = filters.search.trim();
      where.OR = [
        { propertyAddress: { contains: q, mode: 'insensitive' } },
        { propertyCity: { contains: q, mode: 'insensitive' } },
        { propertyZip: { contains: q } },
        { sellerFirstName: { contains: q, mode: 'insensitive' } },
        { sellerLastName: { contains: q, mode: 'insensitive' } },
        { sellerEmail: { contains: q, mode: 'insensitive' } },
        { foreclosureDetail: { is: { caseNumber: { contains: q, mode: 'insensitive' } } } },
        { foreclosureDetail: { is: { countyOwner: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const orderBy = this.orderByFor(filters.sort);

    const [rows, total, cityRows] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: { foreclosureDetail: true, foreclosureSignals: true },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
      // Distinct cities across the whole org's foreclosure set (unfiltered),
      // for the city filter dropdown.
      this.prisma.lead.findMany({
        where: {
          source: LeadSource.FORECLOSURE,
          ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
        },
        select: { propertyCity: true },
        distinct: ['propertyCity'],
      }),
    ]);

    const cities = cityRows
      .map((c) => c.propertyCity)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    // Counties present, derived from the cities that actually have leads.
    const counties = Array.from(
      new Set(cities.map((c) => countyForCity(c)).filter(Boolean) as string[]),
    ).sort((a, b) => a.localeCompare(b));

    return {
      leads: rows.map((r) => this.toDto(r)),
      cities,
      counties,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  private orderByFor(sort?: string): any {
    switch (sort) {
      case 'score':
        return { foreclosureDetail: { leadScore: 'desc' } };
      case 'equity':
        return { foreclosureDetail: { equityPct: 'desc' } };
      case 'added':
        return { createdAt: 'desc' };
      case 'sale':
      default:
        return { foreclosureDetail: { saleDate: 'asc' } };
    }
  }

  async get(id: string, organizationId?: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, source: LeadSource.FORECLOSURE, ...(organizationId ? { organizationId } : {}) },
      include: { foreclosureDetail: true, foreclosureSignals: true },
    });
    return lead ? this.toDto(lead) : null;
  }

  /** Update workflow + editable contact fields on a foreclosure lead. */
  async update(
    id: string,
    patch: {
      workStatus?: string;
      doNotCall?: boolean;
      notes?: string;
      callNotes?: string;
      touchDays?: Record<string, boolean>;
      assignedToUserId?: string | null;
      // Editable contact fields (from the card's Edit dialog)
      ownerNames?: string;
      phone1?: string;
      phone2?: string;
      phone3?: string;
      phone4?: string;
      phone1Type?: string | null;
      phone2Type?: string | null;
      phone3Type?: string | null;
      phone4Type?: string | null;
      email?: string;
      email2?: string;
    },
    organizationId?: string,
  ) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, source: LeadSource.FORECLOSURE, ...(organizationId ? { organizationId } : {}) },
      select: { id: true, foreclosureDetail: { select: { touchDays: true, touchWeek: true, touchCount: true } } },
    });
    if (!lead) return null;

    const detailPatch: any = {};
    if (patch.workStatus !== undefined) detailPatch.workStatus = patch.workStatus;
    if (patch.doNotCall !== undefined) detailPatch.doNotCall = patch.doNotCall;
    if (patch.callNotes !== undefined) detailPatch.callNotes = patch.callNotes;

    // Contact edits. phone1/email live on the Lead; the rest on the detail.
    // Numbers are normalized to 10 digits; empty string clears a field.
    const cleanPhone = (v?: string) => (v === undefined ? undefined : normalizePhoneDigits(v) || '');
    if (patch.phone2 !== undefined) detailPatch.phone2 = cleanPhone(patch.phone2) || null;
    if (patch.phone3 !== undefined) detailPatch.phone3 = cleanPhone(patch.phone3) || null;
    if (patch.phone4 !== undefined) detailPatch.phone4 = cleanPhone(patch.phone4) || null;
    if (patch.phone1Type !== undefined) detailPatch.phone1Type = patch.phone1Type || null;
    if (patch.phone2Type !== undefined) detailPatch.phone2Type = patch.phone2Type || null;
    if (patch.phone3Type !== undefined) detailPatch.phone3Type = patch.phone3Type || null;
    if (patch.phone4Type !== undefined) detailPatch.phone4Type = patch.phone4Type || null;
    if (patch.email2 !== undefined) detailPatch.email2 = patch.email2 || null;

    // Weekly touch checkmarks. If the stored checks belong to a prior ISO
    // week, fold them into the running touchCount before applying this week's.
    if (patch.touchDays !== undefined) {
      const week = isoWeekKey();
      const d = lead.foreclosureDetail;
      if (d && d.touchWeek && d.touchWeek !== week) {
        detailPatch.touchCount = (d.touchCount || 0) + touchDayCount(d.touchDays);
      }
      detailPatch.touchDays = patch.touchDays;
      detailPatch.touchWeek = week;
    }

    const leadPatch: any = {};
    if (patch.assignedToUserId !== undefined) leadPatch.assignedToUserId = patch.assignedToUserId;
    // Mirror DEAD work status onto the Lead status so it drops out of pipelines.
    if (patch.workStatus === 'DEAD') leadPatch.status = 'DEAD';
    if (patch.doNotCall !== undefined) leadPatch.doNotContact = patch.doNotCall;
    if (patch.touchDays !== undefined) leadPatch.lastTouchedAt = new Date();
    if (patch.phone1 !== undefined) leadPatch.sellerPhone = cleanPhone(patch.phone1) || '';
    if (patch.email !== undefined) leadPatch.sellerEmail = patch.email || null;
    if (patch.ownerNames !== undefined) {
      const { firstName, lastName } = splitOwnerName(patch.ownerNames);
      leadPatch.sellerFirstName = firstName;
      leadPatch.sellerLastName = lastName;
    }

    await this.prisma.lead.update({
      where: { id },
      data: {
        ...leadPatch,
        foreclosureDetail: { update: detailPatch },
      },
    });

    return this.get(id, organizationId);
  }

  /**
   * Bulk delete foreclosure leads. Scoped to the org and to source=FORECLOSURE
   * so stray ids cannot touch other pipelines; ForeclosureDetail rows cascade.
   */
  async bulkDelete(ids: string[], organizationId?: string): Promise<{ deleted: number }> {
    if (!ids?.length) return { deleted: 0 };
    const result = await this.prisma.lead.deleteMany({
      where: {
        id: { in: ids },
        source: LeadSource.FORECLOSURE,
        ...(organizationId ? { organizationId } : {}),
      },
    });
    return { deleted: result.count };
  }

  /** Aggregate stat tiles for the top of the Foreclosures tab. */
  async stats(organizationId?: string) {
    const base: any = {
      source: LeadSource.FORECLOSURE,
      ...(organizationId ? { organizationId } : {}),
    };
    const now = new Date();
    const in14 = new Date();
    in14.setDate(in14.getDate() + 14);

    // Poll runs are read unscoped by org on purpose. There is one feed, and
    // scoping would hide the exact failure this record exists to expose: a
    // cron filing notices under an org the viewer is not in.
    const runSelect = {
      startedAt: true,
      finishedAt: true,
      trigger: true,
      ok: true,
      scanned: true,
      created: true,
      skipped: true,
      pastDated: true,
      errors: true,
      message: true,
      organizationId: true,
    } as const;

    const [total, high, soon, highEquity, lastRun, lastCronRun] = await Promise.all([
      this.prisma.lead.count({ where: base }),
      this.prisma.lead.count({ where: { ...base, foreclosureDetail: { is: { priority: 'HIGH' } } } }),
      this.prisma.lead.count({
        where: { ...base, foreclosureDetail: { is: { saleDate: { gte: now, lte: in14 } } } },
      }),
      this.prisma.lead.count({
        where: { ...base, foreclosureDetail: { is: { equityPct: { gte: 40 } } } },
      }),
      this.prisma.foreclosurePollRun.findFirst({
        orderBy: { startedAt: 'desc' },
        select: runSelect,
      }),
      this.prisma.foreclosurePollRun.findFirst({
        where: { trigger: 'cron' },
        orderBy: { startedAt: 'desc' },
        select: runSelect,
      }),
    ]);

    const shape = (r: typeof lastRun) =>
      r && {
        at: (r.finishedAt ?? r.startedAt).toISOString(),
        trigger: r.trigger,
        ok: r.ok,
        scanned: r.scanned,
        created: r.created,
        skipped: r.skipped,
        pastDated: r.pastDated,
        errors: r.errors,
        message: r.message,
        // The cron files leads under FORECLOSURE_DEFAULT_ORG_ID. When that does
        // not match the viewer's org the notices are created but invisible on
        // this page, which looks identical to the poll having stopped.
        orgMismatch: (r.organizationId || null) !== (organizationId || null),
      };

    return {
      total,
      high,
      soon,
      highEquity,
      lastPoll: shape(lastRun) || null,
      lastCronPoll: shape(lastCronRun) || null,
    };
  }

  private toDto(lead: any) {
    const d = lead.foreclosureDetail || {};
    const saleIso = d.saleDate ? new Date(d.saleDate).toISOString().slice(0, 10) : null;

    // Weekly touch state: report a prior week's leftover checks as part of the
    // running total, and an empty current week (write-side rollover persists
    // this the next time a day is toggled).
    const week = isoWeekKey();
    const stale = d.touchWeek && d.touchWeek !== week;
    const touchDays = stale ? {} : (d.touchDays || {});
    // Stale days count as accumulated history; current days as this week's.
    // Either way the total is the running count plus whatever is stored.
    const totalTouches = (d.touchCount || 0) + touchDayCount(d.touchDays);

    return {
      id: lead.id,
      address: lead.propertyAddress,
      city: lead.propertyCity,
      state: lead.propertyState,
      zip: lead.propertyZip,
      ownerNames: [lead.sellerFirstName, lead.sellerLastName].filter(Boolean).join(' ').trim(),
      countyOwner: d.countyOwner || null,
      email: lead.sellerEmail || null,
      email2: d.email2 || null,
      phone1: lead.sellerPhone || null,
      phone2: d.phone2 || null,
      phone3: d.phone3 || null,
      phone4: d.phone4 || null,
      status: lead.status,
      assignedToUserId: lead.assignedToUserId || null,
      // Foreclosure detail
      noticeType: d.noticeType || null,
      noticeUrl: d.noticeUrl || null,
      caseNumber: d.caseNumber || null,
      county: d.county || countyForCity(lead.propertyCity),
      trustee: d.trustee || null,
      sourceKind: d.sourceKind || null,
      saleDate: saleIso,
      hearingDate: d.hearingDate ? new Date(d.hearingDate).toISOString().slice(0, 10) : null,
      loanDate: d.loanDate ? new Date(d.loanDate).toISOString().slice(0, 10) : null,
      loanAmount: d.loanAmount ?? null,
      assessedValue: d.assessedValue ?? null,
      priority: d.priority || 'LOW',
      score: d.leadScore ?? 0,
      equityPct: d.equityPct ?? null,
      equitySpread: d.equitySpread ?? null,
      // Rules-engine verdict. debtFigureReliable=false means equityPct and
      // equitySpread above are deliberately null, not merely unknown.
      loanType: d.loanType || null,
      lenderName: d.lenderName || null,
      debtFigureReliable: d.debtFigureReliable !== false,
      workStatus: d.workStatus || 'NOT_CONTACTED',
      doNotCall: !!d.doNotCall,
      callNotes: d.callNotes || '',
      touchDays,
      totalTouches,
      phone1Type: d.phone1Type || null,
      phone2Type: d.phone2Type || null,
      phone3Type: d.phone3Type || null,
      phone4Type: d.phone4Type || null,
      ownerOccupied: d.ownerOccupied || null,
      mailingAddress: d.mailingAddress || null,
      mailCity: d.mailCity || null,
      mailState: d.mailState || null,
      mailZip: d.mailZip || null,
      skipStatus: d.skipStatus || null,
      parcelId: d.parcelId || null,
      parcelUrl: d.parcelUrl || null,
      parcelType: d.parcelType || null,
      parcelLabel: d.parcelLabel || null,
      zillowUrl: d.zillowUrl || null,
      realtorQuery: d.realtorQuery || null,
      realtorZip: d.realtorZip || null,
      daysToSale: saleIso ? daysToSale(saleIso) : null,
      signals: (lead.foreclosureSignals || [])
        .slice()
        .sort((a: any, b: any) =>
          (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) ||
          a.signalCode.localeCompare(b.signalCode))
        .map((s: any) => ({
          id: s.id,
          signalCode: s.signalCode,
          severity: s.severity,
          headline: s.headline,
          evidence: s.evidence || [],
          recommendedActions: s.recommendedActions || [],
          completedActions: s.completedActions || [],
        })),
      createdAt: lead.createdAt,
    };
  }
}
