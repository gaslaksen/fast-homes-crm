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
  looksDead,
  stateForCity,
} from './foreclosure-scoring.util';

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

    // Idempotency: skip if we already have this notice for the org.
    const existing = await this.prisma.foreclosureDetail.findFirst({
      where: {
        organizationId,
        OR: [
          { dedupeUid },
          ...(input.noticeId ? [{ noticeId: input.noticeId }] : []),
        ],
      },
      select: { leadId: true },
    });
    if (existing) {
      return { leadId: existing.leadId, created: false, reason: 'duplicate' };
    }

    const derived = this.buildDerived(input, { saleIso, loanIso });

    const { firstName, lastName } = splitOwnerName(input.ownerNames || input.countyOwner);
    const phone1 = normalizePhoneDigits(input.phone1) || '';
    const phone2 = normalizePhoneDigits(input.phone2) || null;

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
            caseNumber: input.caseNumber || null,
            county: input.county || null,
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
            ownerOccupied: input.ownerOccupied || null,
            mailingAddress: input.mailingAddress || null,
            mailCity: input.mailCity || null,
            mailState: input.mailState || null,
            mailZip: input.mailZip || null,
            skipStatus: input.skipStatus || null,
            phone2,
            phone1Type: input.phone1Type || phoneTypeOf(input.phone1),
            phone2Type: input.phone2Type || phoneTypeOf(input.phone2),
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
      parcel: parcelLinkFor(input.address, input.city),
    };
  }

  /** List foreclosure leads (Lead joined with ForeclosureDetail) with filters. */
  async list(filters: ForeclosureListFilters) {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(200, filters.pageSize || 60);

    const detailWhere: any = {};
    if (filters.priority) detailWhere.priority = filters.priority.toUpperCase();
    if (filters.workStatus) detailWhere.workStatus = filters.workStatus;
    if (filters.noticeType) detailWhere.noticeType = filters.noticeType;
    if (filters.occupancy === 'owner') detailWhere.ownerOccupied = 'Y';
    if (filters.occupancy === 'absentee') detailWhere.ownerOccupied = 'N';
    if (filters.equityMin != null) detailWhere.equityPct = { gte: filters.equityMin };
    if (filters.saleWithinDays != null) {
      const until = new Date();
      until.setDate(until.getDate() + filters.saleWithinDays);
      detailWhere.saleDate = { gte: new Date(new Date().setHours(0, 0, 0, 0)), lte: until };
    }

    const where: any = {
      source: LeadSource.FORECLOSURE,
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      foreclosureDetail: { is: detailWhere },
    };
    if (!filters.includeDead) {
      where.foreclosureDetail.is = { ...detailWhere, workStatus: { not: 'DEAD' } };
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

    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: { foreclosureDetail: true },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      leads: rows.map((r) => this.toDto(r)),
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
      include: { foreclosureDetail: true },
    });
    return lead ? this.toDto(lead) : null;
  }

  /** Update workflow fields on a foreclosure lead (work status, DNC, etc). */
  async update(
    id: string,
    patch: {
      workStatus?: string;
      doNotCall?: boolean;
      notes?: string;
      callNotes?: string;
      touchDays?: Record<string, boolean>;
      assignedToUserId?: string | null;
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

    await this.prisma.lead.update({
      where: { id },
      data: {
        ...leadPatch,
        foreclosureDetail: { update: detailPatch },
      },
    });

    return this.get(id, organizationId);
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

    const [total, high, soon, highEquity] = await Promise.all([
      this.prisma.lead.count({ where: base }),
      this.prisma.lead.count({ where: { ...base, foreclosureDetail: { is: { priority: 'HIGH' } } } }),
      this.prisma.lead.count({
        where: { ...base, foreclosureDetail: { is: { saleDate: { gte: now, lte: in14 } } } },
      }),
      this.prisma.lead.count({
        where: { ...base, foreclosureDetail: { is: { equityPct: { gte: 40 } } } },
      }),
    ]);
    return { total, high, soon, highEquity };
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
      phone1: lead.sellerPhone || null,
      phone2: d.phone2 || null,
      status: lead.status,
      assignedToUserId: lead.assignedToUserId || null,
      // Foreclosure detail
      noticeType: d.noticeType || null,
      noticeUrl: d.noticeUrl || null,
      caseNumber: d.caseNumber || null,
      county: d.county || null,
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
      workStatus: d.workStatus || 'NOT_CONTACTED',
      doNotCall: !!d.doNotCall,
      callNotes: d.callNotes || '',
      touchDays,
      totalTouches,
      phone1Type: d.phone1Type || null,
      phone2Type: d.phone2Type || null,
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
      createdAt: lead.createdAt,
    };
  }
}
