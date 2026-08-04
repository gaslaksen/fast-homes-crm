import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadSource, ProbateWorkStatus } from '@fast-homes/shared';
import { countyForCity, stateForCity, citiesInCounty } from '../foreclosures/foreclosure-scoring.util';
import {
  ProbateLeadInput,
  ProbateListFilters,
  ProbateContactGroup,
  ProbatePropertyRow,
} from './probate.types';
import {
  probateUidOf,
  normalizeCaseNumber,
  normalizeZip,
  normalizePhoneDigits,
  phoneTypeOf,
  parseListDate,
  isoToDate,
  contactKeyOf,
  cellText,
} from './probate.util';

export interface CreateProbateResult {
  leadId: string | null;
  created: boolean;
  /** True when this lead is the one a drip should enroll for its contact. */
  primaryContact: boolean;
  reason?: string;
}

@Injectable()
export class ProbateService {
  private readonly logger = new Logger(ProbateService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Idempotently create a probate Lead + ProbateDetail from a normalized row.
   *
   * Uses raw prisma.lead.create rather than LeadsService.createLead so the
   * initial-outreach scheduler is never invoked, and sets autoRespond=false so
   * inbound AI stays silent. Probate is the one list where an automated first
   * text lands on someone who just buried a parent, so nothing goes out until
   * a probate campaign is written and enrolled by hand. Same posture the
   * foreclosure ingestion takes, for the same reason.
   */
  async createProbateLead(
    input: ProbateLeadInput,
    opts: { organizationId?: string | null },
  ): Promise<CreateProbateResult> {
    const organizationId = opts.organizationId || null;

    const address = cellText(input.address);
    const phone = normalizePhoneDigits(input.phone1);
    if (!address) {
      return { leadId: null, created: false, primaryContact: false, reason: 'no property address' };
    }
    if (!phone) {
      return { leadId: null, created: false, primaryContact: false, reason: 'no usable phone' };
    }

    const caseKey = normalizeCaseNumber(input.caseNumber);
    const dedupeUid = probateUidOf({ caseNumber: caseKey, address });

    const existing = await this.prisma.probateDetail.findFirst({
      where: { organizationId, dedupeUid },
      select: { leadId: true, primaryContact: true },
    });
    if (existing) {
      return {
        leadId: existing.leadId,
        created: false,
        primaryContact: existing.primaryContact,
        reason: 'duplicate',
      };
    }

    // One estate, several properties, one heir: every lead after the first on
    // a given contact is created but flagged non-primary, so the drip enrolls
    // the person once and the other properties still exist to be worked.
    const contactKey = contactKeyOf({ phone, email: input.email });
    const priorForContact = contactKey
      ? await this.prisma.probateDetail.count({
          where: { organizationId, contactKey, primaryContact: true },
        })
      : 0;
    const primaryContact = priorForContact === 0;

    const city = cellText(input.city);
    const heirCity = cellText(input.heirCity);
    // The list's own absentee flag wins whenever it has one: it compares the
    // heir's full address to the property's, so an heir who inherited a house
    // three streets from their own still counts. Comparing cities is strictly
    // coarser than that and would quietly drop every same-city absentee, so it
    // is only the fallback for a list that ships no flag.
    const absenteeHeir =
      input.absenteeHeir != null
        ? input.absenteeHeir
        : !!(heirCity && city && heirCity.toUpperCase() !== city.toUpperCase());

    const filedIso = parseListDate(input.caseFiledDate) || cellText(input.caseFiledDate);

    const lead = await this.prisma.lead.create({
      data: {
        source: LeadSource.PROBATE,
        status: 'NEW',
        // No initial outreach ever (the raw create bypasses the scheduler) and
        // no inbound auto-reply until a probate campaign exists.
        autoRespond: false,
        doNotContact: false,
        propertyAddress: address,
        propertyCity: city,
        propertyState: cellText(input.state) || stateForCity(city),
        propertyZip: normalizeZip(input.zip),
        // The seller fields describe the HEIR, not the decedent: the heir is
        // who answers the phone and who can actually sell.
        sellerFirstName: cellText(input.heirFirstName),
        sellerLastName: cellText(input.heirLastName),
        sellerPhone: `+1${phone}`,
        sellerEmail: cellText(input.email) || null,
        sellerMotivation: cellText(input.whyThisLead) || null,
        organizationId,
        sourceMetadata: {
          probate: true,
          caseNumber: caseKey || null,
          consensusTier: cellText(input.consensusTier) || null,
          importBatch: cellText(input.importBatch) || null,
        },
        probateDetail: {
          create: {
            organizationId,
            dedupeUid,
            importBatch: cellText(input.importBatch) || null,
            caseNumber: caseKey || null,
            caseFiledDate: isoToDate(filedIso),
            county: cellText(input.county) || countyForCity(city),
            deceasedName: cellText(input.deceasedName) || null,
            monthsSinceDeath: input.monthsSinceDeath ?? null,
            heirCity: heirCity || null,
            absenteeHeir,
            consensusRank: input.consensusRank ?? null,
            consensusScore: input.consensusScore ?? null,
            consensusTier: cellText(input.consensusTier) || null,
            agreement: cellText(input.agreement) || null,
            eslPriority: input.eslPriority ?? null,
            eslTier: cellText(input.eslTier) || null,
            motivationScore: input.motivationScore ?? null,
            motivationTier: cellText(input.motivationTier) || null,
            whyThisLead: cellText(input.whyThisLead) || null,
            estValue: input.estValue ?? null,
            phone1Type: phoneTypeOf(input.phone1Type) || null,
            phone2: normalizePhoneDigits(input.phone2),
            phone2Type: phoneTypeOf(input.phone2Type) || null,
            email2: cellText(input.email2) || null,
            moreOnFile: cellText(input.moreOnFile) || null,
            contactKey: contactKey || null,
            primaryContact,
            workStatus: ProbateWorkStatus.NOT_CONTACTED,
            doNotCall: false,
          },
        },
      },
      select: { id: true },
    });

    return { leadId: lead.id, created: true, primaryContact };
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  /**
   * Probate leads, grouped by contact and paginated by GROUP rather than by
   * lead. Grouping happens in memory because the group is the unit the list
   * pages over: a heir with sixteen properties is one row, and there is no way
   * to ask Postgres for "page 2 of the groups" without materializing them
   * first. The row cap keeps that honest at list sizes we actually hold.
   */
  async list(filters: ProbateListFilters) {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(200, filters.pageSize || 40);
    const ROW_CAP = 10000;

    const asList = (v?: string) =>
      String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

    const detailWhere: any = {};

    // Tiers arrive as numbers; the stored label is the list's full spelling.
    const tiers = asList(filters.tier);
    if (tiers.length) {
      detailWhere.OR = tiers.map((t) => ({
        consensusTier: { startsWith: `Tier ${t}`, mode: 'insensitive' },
      }));
    }

    const workStatuses = asList(filters.workStatus);
    if (workStatuses.length) detailWhere.workStatus = { in: workStatuses };
    else if (filters.hideDead) detailWhere.workStatus = { not: 'DEAD' };

    if (filters.absentee === 'yes') detailWhere.absenteeHeir = true;
    if (filters.absentee === 'no') detailWhere.absenteeHeir = false;
    if (filters.hideDnc) detailWhere.doNotCall = false;
    if (filters.valueMin) detailWhere.estValue = { gte: filters.valueMin };

    // Months since death. The 3-9 month band is where these lists score
    // hardest: past the raw grief, before the estate has found a realtor.
    switch (filters.deathWindow) {
      case 'fresh': detailWhere.monthsSinceDeath = { lt: 3 }; break;
      case 'sweet': detailWhere.monthsSinceDeath = { gte: 3, lte: 9 }; break;
      case 'stale': detailWhere.monthsSinceDeath = { gt: 9 }; break;
    }

    const where: any = {
      source: LeadSource.PROBATE,
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      probateDetail: { is: detailWhere },
    };

    if (filters.city) where.propertyCity = { equals: filters.city, mode: 'insensitive' };
    if (filters.county) {
      const cityList = citiesInCounty(filters.county);
      where.AND = [
        {
          OR: cityList.length
            ? cityList.map((c) => ({ propertyCity: { equals: c, mode: 'insensitive' } }))
            : [{ probateDetail: { is: { county: filters.county } } }],
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
        { probateDetail: { is: { caseNumber: { contains: q, mode: 'insensitive' } } } },
        { probateDetail: { is: { deceasedName: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const [rows, cityRows] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: {
          probateDetail: true,
          campaignEnrollments: {
            where: { status: { in: ['ACTIVE', 'PAUSED'] } },
            select: { campaign: { select: { name: true } } },
          },
        },
        orderBy: { probateDetail: { consensusRank: 'asc' } },
        take: ROW_CAP,
      }),
      // Distinct cities across the org's whole probate set, for the filter.
      this.prisma.lead.findMany({
        where: {
          source: LeadSource.PROBATE,
          ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
        },
        select: { propertyCity: true },
        distinct: ['propertyCity'],
      }),
    ]);

    const groups = this.groupByContact(rows);
    this.sortGroups(groups, filters.sort);

    const start = (page - 1) * pageSize;
    return {
      groups: groups.slice(start, start + pageSize),
      total: groups.length,
      leadTotal: rows.length,
      truncated: rows.length >= ROW_CAP,
      page,
      pageSize,
      cities: cityRows.map((c) => c.propertyCity).filter(Boolean).sort(),
    };
  }

  /** Collapse leads sharing a contactKey into one group row. */
  private groupByContact(rows: any[]): ProbateContactGroup[] {
    const byKey = new Map<string, ProbateContactGroup>();

    for (const lead of rows) {
      const d = lead.probateDetail;
      if (!d) continue;
      // A lead with no contactKey stands alone rather than being folded in
      // with every other keyless lead.
      const key = d.contactKey || `lead:${lead.id}`;

      const property: ProbatePropertyRow = {
        leadId: lead.id,
        address: lead.propertyAddress,
        city: lead.propertyCity,
        zip: lead.propertyZip,
        estValue: d.estValue,
        consensusRank: d.consensusRank,
        consensusScore: d.consensusScore,
        consensusTier: d.consensusTier,
        caseNumber: d.caseNumber,
        caseFiledDate: d.caseFiledDate,
        deceasedName: d.deceasedName,
        whyThisLead: d.whyThisLead,
        status: lead.status,
        primaryContact: d.primaryContact,
      };

      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          contactKey: key,
          primaryLeadId: lead.id,
          heirName: [lead.sellerFirstName, lead.sellerLastName].filter(Boolean).join(' ').trim(),
          heirCity: d.heirCity,
          phone: lead.sellerPhone,
          phoneType: d.phone1Type,
          email: lead.sellerEmail,
          absenteeHeir: d.absenteeHeir,
          deceasedNames: d.deceasedName ? [d.deceasedName] : [],
          caseNumbers: d.caseNumber ? [d.caseNumber] : [],
          monthsSinceDeath: d.monthsSinceDeath,
          earliestFiled: d.caseFiledDate,
          propertyCount: 1,
          totalValue: d.estValue || 0,
          bestRank: d.consensusRank,
          bestTier: d.consensusTier,
          workStatus: d.workStatus,
          doNotCall: d.doNotCall,
          enrolledCampaigns: (lead.campaignEnrollments || []).map((e: any) => e.campaign.name),
          properties: [property],
        });
        continue;
      }

      existing.properties.push(property);
      existing.propertyCount++;
      existing.totalValue += d.estValue || 0;
      if (d.primaryContact) existing.primaryLeadId = lead.id;
      if (d.deceasedName && !existing.deceasedNames.includes(d.deceasedName)) {
        existing.deceasedNames.push(d.deceasedName);
      }
      if (d.caseNumber && !existing.caseNumbers.includes(d.caseNumber)) {
        existing.caseNumbers.push(d.caseNumber);
      }
      if (d.consensusRank != null && (existing.bestRank == null || d.consensusRank < existing.bestRank)) {
        existing.bestRank = d.consensusRank;
        existing.bestTier = d.consensusTier;
      }
      if (d.caseFiledDate && (!existing.earliestFiled || d.caseFiledDate < existing.earliestFiled)) {
        existing.earliestFiled = d.caseFiledDate;
      }
      // Any property under contract or in conversation speaks for the group.
      if (d.doNotCall) existing.doNotCall = true;
      for (const e of lead.campaignEnrollments || []) {
        if (!existing.enrolledCampaigns.includes(e.campaign.name)) {
          existing.enrolledCampaigns.push(e.campaign.name);
        }
      }
    }

    for (const g of byKey.values()) {
      g.properties.sort((a, b) => (a.consensusRank ?? 1e9) - (b.consensusRank ?? 1e9));
    }
    return Array.from(byKey.values());
  }

  private sortGroups(groups: ProbateContactGroup[], sort?: string) {
    const nz = (v: number | null | undefined, fallback: number) => (v == null ? fallback : v);
    switch (sort) {
      case 'value':
        groups.sort((a, b) => b.totalValue - a.totalValue);
        break;
      case 'properties':
        groups.sort((a, b) => b.propertyCount - a.propertyCount);
        break;
      case 'recent':
        groups.sort((a, b) => nz(a.monthsSinceDeath, 1e9) - nz(b.monthsSinceDeath, 1e9));
        break;
      case 'name':
        groups.sort((a, b) => a.heirName.localeCompare(b.heirName));
        break;
      default: // 'rank'
        groups.sort((a, b) => nz(a.bestRank, 1e9) - nz(b.bestRank, 1e9));
    }
  }

  async stats(organizationId?: string) {
    const where: any = {
      source: LeadSource.PROBATE,
      ...(organizationId ? { organizationId } : {}),
    };

    const rows = await this.prisma.lead.findMany({
      where,
      select: {
        probateDetail: {
          select: {
            contactKey: true,
            consensusTier: true,
            workStatus: true,
            estValue: true,
            monthsSinceDeath: true,
            primaryContact: true,
            doNotCall: true,
          },
        },
      },
    });

    const details = rows.map((r) => r.probateDetail).filter(Boolean) as any[];
    const tierCounts: Record<string, number> = {};
    const contacts = new Set<string>();
    let notContacted = 0;
    let totalValue = 0;
    let monthsSum = 0;
    let monthsN = 0;

    for (const d of details) {
      const tier = d.consensusTier || 'Untiered';
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
      if (d.contactKey) contacts.add(d.contactKey);
      if (d.workStatus === 'NOT_CONTACTED') notContacted++;
      totalValue += d.estValue || 0;
      if (d.monthsSinceDeath != null) { monthsSum += d.monthsSinceDeath; monthsN++; }
    }

    return {
      leads: details.length,
      // The number a drip actually reaches, which is never the lead count.
      contacts: contacts.size,
      primaryContacts: details.filter((d) => d.primaryContact).length,
      notContacted,
      doNotCall: details.filter((d) => d.doNotCall).length,
      tierCounts,
      totalValue,
      avgMonthsSinceDeath: monthsN ? monthsSum / monthsN : null,
    };
  }

  /** One probate lead with its detail, for the drill-in. */
  async get(leadId: string, organizationId?: string) {
    return this.prisma.lead.findFirst({
      where: {
        id: leadId,
        source: LeadSource.PROBATE,
        ...(organizationId ? { organizationId } : {}),
      },
      include: { probateDetail: true },
    });
  }

  /**
   * Update the working fields on a probate lead. Deliberately narrow: this
   * endpoint records what the team did, it never sends anything.
   */
  async update(
    leadId: string,
    body: { workStatus?: string; doNotCall?: boolean; callNotes?: string },
    organizationId?: string,
  ) {
    const existing = await this.prisma.probateDetail.findFirst({
      where: {
        leadId,
        ...(organizationId ? { organizationId } : {}),
      },
      select: { id: true },
    });
    if (!existing) return null;

    return this.prisma.probateDetail.update({
      where: { id: existing.id },
      data: {
        ...(body.workStatus !== undefined ? { workStatus: body.workStatus } : {}),
        ...(body.doNotCall !== undefined ? { doNotCall: body.doNotCall } : {}),
        ...(body.callNotes !== undefined ? { callNotes: body.callNotes } : {}),
      },
    });
  }

  /**
   * Apply a working-field update to every lead sharing a contact. Ticking one
   * heir "do not call" has to cover all sixteen of their properties, or the
   * next person to open the list sees a contradiction.
   */
  async updateContact(
    contactKey: string,
    body: { workStatus?: string; doNotCall?: boolean },
    organizationId?: string,
  ) {
    return this.prisma.probateDetail.updateMany({
      where: {
        contactKey,
        ...(organizationId ? { organizationId } : {}),
      },
      data: {
        ...(body.workStatus !== undefined ? { workStatus: body.workStatus } : {}),
        ...(body.doNotCall !== undefined ? { doNotCall: body.doNotCall } : {}),
      },
    });
  }

  async bulkDelete(leadIds: string[], organizationId?: string) {
    const result = await this.prisma.lead.deleteMany({
      where: {
        id: { in: leadIds },
        source: LeadSource.PROBATE,
        ...(organizationId ? { organizationId } : {}),
      },
    });
    return { deleted: result.count };
  }
}
