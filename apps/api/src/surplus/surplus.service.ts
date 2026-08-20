import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LeadSource,
  SurplusStage,
  SurplusClaimantType,
  SurplusType,
  SurplusFundLocation,
  SurplusTier,
} from '@fast-homes/shared';
import {
  normalizePhoneDigits,
  isoWeekKey,
  touchDayCount,
  splitOwnerName,
} from '../foreclosures/foreclosure-scoring.util';
// Generic list-cell normalizers, written for the probate importer and
// pipeline-agnostic. Imported rather than copied, the same way the probate
// service reuses the foreclosure city/county lookups.
import { cellText, normalizeZip, phoneTypeOf, isoToDate } from '../probate/probate.util';
import {
  surplusUidOf,
  claimantTypeFromText,
  stageFromText,
  tierOf,
  dripTrack,
  isDeceased,
  noticeAge,
  claimDeadline,
  daysRemaining,
  windowElapsedPct,
  assignmentDeadline,
  assignmentDaysLeft,
  lienWindowOpen,
  sortedLiens,
  totalLiens,
  netToClaimant,
  estFee,
  consideration,
  pctOfGross,
  pctOfNet,
  governingPct,
  canQualify,
  complianceGate,
  SurplusLien,
} from './surplus.util';
import {
  SURPLUS_FLOOR,
  FL_COUNTIES,
  ALL_FL_COUNTIES,
  DISCLOSURE_LABELS,
} from './surplus-compliance';
import { SurplusLeadInput, SurplusListFilters, SurplusPhoneInput } from './surplus.types';

const EMPTY_DISCLOSURES = {
  financial: false,
  noAttorneyNeeded: false,
  allConsideration: false,
};

const EMPTY_DOCS = {
  claimForm: false,
  photoId: false,
  proofOwnership: false,
  w9: false,
  feeAgreement: false,
  titleSearch: false,
  deathCert: false,
  letters: false,
};

export interface CreateSurplusResult {
  leadId: string | null;
  created: boolean;
  reason?: string;
}

@Injectable()
export class SurplusService {
  private readonly logger = new Logger(SurplusService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Writing ──────────────────────────────────────────────────────────────

  /**
   * Idempotently create a Lead + SurplusDetail from a normalized row.
   *
   * Two things are unusual here and both are deliberate.
   *
   * First, the Lead's seller fields describe the CLAIMANT, not a homeowner:
   * there is no property to buy, the person is a former owner or an heir with
   * money already sitting at a clerk, and they are who answers the phone. The
   * property fields identify the case, nothing more.
   *
   * Second, this uses raw prisma.lead.create rather than LeadsService.createLead
   * so the initial-outreach scheduler is never invoked, and sets
   * autoRespond=false. Surplus outreach is regulated speech: FS 45.033 governs
   * what may be offered and the required disclosures, so nothing automated goes
   * out until a surplus campaign is written and enrolled by hand.
   *
   * A surplus below SURPLUS_FLOOR is refused at ingestion rather than filtered
   * out of a view. The fee on a $12k surplus does not cover the title search
   * and the filing, so the lead should not exist.
   */
  async createSurplusLead(
    input: SurplusLeadInput,
    opts: { organizationId?: string | null },
  ): Promise<CreateSurplusResult> {
    const organizationId = opts.organizationId || null;

    const address = cellText(input.address);
    const claimant = cellText(input.claimant);
    const county = cellText(input.county);
    if (!claimant) {
      return { leadId: null, created: false, reason: 'no claimant name' };
    }

    const gross = input.grossSurplus ?? null;
    if ((gross || 0) < SURPLUS_FLOOR) {
      return { leadId: null, created: false, reason: 'below the surplus floor' };
    }

    const dedupeUid = surplusUidOf({
      county,
      caseNumber: input.caseNumber,
      parcelId: input.parcelId,
      claimant,
    });
    const existing = await this.prisma.surplusDetail.findFirst({
      where: { organizationId, dedupeUid },
      select: { leadId: true },
    });
    if (existing) {
      return { leadId: existing.leadId, created: false, reason: 'duplicate' };
    }

    const { firstName, lastName } = splitOwnerName(claimant);
    const claimantType = input.claimantType
      ? claimantTypeFromText(input.claimantType)
      : claimantTypeFromText(claimant);
    const stage = input.stage ? stageFromText(input.stage) : SurplusStage.NEW;

    const phones = this.normalizePhones(input.phones);
    const emails = (input.emails || []).map((e) => cellText(e)).filter(Boolean);
    const liens = this.normalizeLiens(input.liens);

    const facts = {
      surplusType: input.surplusType || SurplusType.TAX_DEED,
      fundLocation: input.fundLocation || SurplusFundLocation.CLERK,
      claimantType,
      deceased: !!input.deceased || claimantType === SurplusClaimantType.HEIR_ESTATE,
      heirsRequired: !!input.heirsRequired,
      competingLien: !!input.competingLien,
      grossSurplus: gross,
      liens,
    };

    const lead = await this.prisma.lead.create({
      data: {
        source: LeadSource.SURPLUS,
        status: 'NEW',
        autoRespond: false,
        doNotContact: false,
        // The property that produced the surplus. It identifies the case; it
        // is not something being bought.
        propertyAddress: address || `${county} County surplus claim`,
        propertyCity: cellText(input.city),
        propertyState: cellText(input.state) || 'FL',
        propertyZip: normalizeZip(input.zip),
        // The claimant, the person actually owed the money.
        sellerFirstName: firstName,
        sellerLastName: lastName,
        sellerPhone: phones[0]?.number ? `+1${phones[0].number}` : '',
        sellerEmail: emails[0] || null,
        organizationId,
        sourceMetadata: {
          surplus: true,
          caseNumber: cellText(input.caseNumber) || null,
          county: county || null,
          importBatch: cellText(input.importBatch) || null,
        },
        surplusDetail: {
          create: {
            organizationId,
            dedupeUid,
            importBatch: cellText(input.importBatch) || null,
            county: county || null,
            caseNumber: cellText(input.caseNumber) || null,
            parcelId: cellText(input.parcelId) || null,
            claimantType,
            deceased: facts.deceased,
            heirsRequired: facts.heirsRequired,
            competingLien: facts.competingLien,
            surplusType: facts.surplusType,
            fundLocation: facts.fundLocation,
            saleDate: isoToDate(cellText(input.saleDate)),
            salePrice: input.salePrice ?? null,
            noticeDate: isoToDate(cellText(input.noticeDate)),
            noticeConfirmed: !!input.noticeConfirmed,
            certOfDisbursements: isoToDate(cellText(input.certOfDisbursements)),
            grossSurplus: gross,
            liens: liens as any,
            arrangement: input.arrangement || 'assignment',
            totalConsideration: input.totalConsideration ?? 0,
            licensedRepId: input.licensedRepId || null,
            stage,
            tier: tierOf(facts),
            entitlementVerified: false,
            titleSearchComplete: false,
            disclosures: { ...EMPTY_DISCLOSURES },
            docs: { ...EMPTY_DOCS },
            doNotCall: false,
            callNotes: cellText(input.notes) || null,
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
            dncScrubbedAt: isoToDate(cellText(input.dncScrubbedAt)),
            contactMismatch: !!input.contactMismatch,
            mismatchedName: input.mismatchedName || null,
          },
        },
      },
      select: { id: true },
    });

    return { leadId: lead.id, created: true };
  }

  private normalizePhones(input?: SurplusPhoneInput[]) {
    return (input || [])
      .map((p) => ({
        number: normalizePhoneDigits(p?.number) || '',
        type: phoneTypeOf(p?.type) || (p?.type ? cellText(p.type) : null),
        dnc: p?.dnc || null,
      }))
      .filter((p) => p.number)
      // Only four fit. Clean numbers are kept ahead of registered ones so a
      // dialable number is never crowded out by one nobody may call.
      .sort((a, b) => (a.dnc ? 1 : 0) - (b.dnc ? 1 : 0))
      .slice(0, 4);
  }

  /** Liens are stored as JSON, so anything malformed is dropped rather than kept. */
  private normalizeLiens(input?: SurplusLien[] | null): SurplusLien[] {
    return (input || [])
      .map((l, i) => ({
        type: cellText(l?.type) || 'Lien',
        holder: cellText(l?.holder),
        amount: Number(l?.amount) || 0,
        priority: Number.isFinite(Number(l?.priority)) ? Number(l.priority) : i + 1,
        governmental: !!l?.governmental,
      }))
      .filter((l) => l.amount > 0);
  }

  /**
   * Apply a card edit. Advancing to Agreement Signed is refused unless the
   * qualification gate is satisfied, because that is the one stage change that
   * commits us to a claim we may not be entitled to file.
   */
  async update(id: string, patch: any, organizationId?: string) {
    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        source: LeadSource.SURPLUS,
        ...(organizationId ? { organizationId } : {}),
      },
      include: { surplusDetail: true },
    });
    if (!lead || !lead.surplusDetail) return null;

    const d = lead.surplusDetail;
    const detailPatch: any = {};
    const leadPatch: any = {};

    const passthrough = [
      'county', 'caseNumber', 'parcelId', 'deceased', 'heirsRequired', 'competingLien',
      'surplusType', 'fundLocation', 'noticeConfirmed', 'arrangement', 'licensedRepId',
      'entitlementVerified', 'titleSearchComplete', 'doNotCall', 'callNotes',
    ];
    for (const k of passthrough) {
      if (patch[k] !== undefined) detailPatch[k] = patch[k];
    }

    for (const k of ['salePrice', 'grossSurplus', 'totalConsideration']) {
      if (patch[k] !== undefined) detailPatch[k] = patch[k] === null ? null : Number(patch[k]);
    }

    for (const k of ['saleDate', 'noticeDate', 'certOfDisbursements']) {
      if (patch[k] !== undefined) {
        detailPatch[k] = patch[k] ? isoToDate(String(patch[k]).slice(0, 10)) : null;
      }
    }

    if (patch.claimantType !== undefined) {
      detailPatch.claimantType = claimantTypeFromText(patch.claimantType);
    }
    if (patch.liens !== undefined) detailPatch.liens = this.normalizeLiens(patch.liens) as any;
    if (patch.disclosures !== undefined) {
      detailPatch.disclosures = { ...(d.disclosures as any), ...patch.disclosures };
    }
    if (patch.docs !== undefined) {
      detailPatch.docs = { ...(d.docs as any), ...patch.docs };
    }

    if (patch.stage !== undefined) {
      const next = stageFromText(patch.stage);
      const after = { ...d, ...detailPatch };
      // The gate is checked against the values being written, so ticking the
      // last checkbox and advancing the stage in one request is allowed.
      if (next === SurplusStage.AGREEMENT_SIGNED && !canQualify(after)) {
        throw new BadRequestException(
          'An agreement needs entitlement verified, notice date confirmed, and title search complete.',
        );
      }
      detailPatch.stage = next;
      if (next === SurplusStage.DEAD) leadPatch.status = 'DEAD';
    }

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
      // A hand-entered number has not been scrubbed, and once somebody has
      // supplied the right contact the old mismatch no longer describes it.
      if (patch.dncScrubbedAt === undefined) detailPatch.dncScrubbedAt = null;
      detailPatch.contactMismatch = false;
      detailPatch.mismatchedName = null;
    }
    if (patch.emails !== undefined) {
      const emails = (patch.emails || []).map((e: any) => cellText(e)).filter(Boolean);
      leadPatch.sellerEmail = emails[0] || null;
      detailPatch.email2 = emails[1] || null;
    }
    if (patch.claimant !== undefined) {
      const { firstName, lastName } = splitOwnerName(patch.claimant);
      leadPatch.sellerFirstName = firstName;
      leadPatch.sellerLastName = lastName;
    }

    if (patch.touchDays !== undefined) {
      const week = isoWeekKey();
      if (d.touchWeek && d.touchWeek !== week) {
        detailPatch.touchCount = (d.touchCount || 0) + touchDayCount(d.touchDays);
      }
      detailPatch.touchDays = patch.touchDays;
      detailPatch.touchWeek = week;
      leadPatch.lastTouchedAt = new Date();
    }

    if (patch.doNotCall !== undefined) leadPatch.doNotContact = patch.doNotCall;

    // Tier is cached so the board can sort and count without recomputing over
    // every row, so it has to be rewritten whenever an input to it moves.
    detailPatch.tier = tierOf({ ...d, ...detailPatch } as any);

    await this.prisma.lead.update({
      where: { id },
      data: { ...leadPatch, surplusDetail: { update: detailPatch } },
    });

    return this.get(id, organizationId);
  }

  async bulkDelete(ids: string[], organizationId?: string) {
    const leads = await this.prisma.lead.findMany({
      where: {
        id: { in: ids },
        source: LeadSource.SURPLUS,
        ...(organizationId ? { organizationId } : {}),
      },
      select: { id: true },
    });
    if (!leads.length) return { deleted: 0 };
    const res = await this.prisma.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } });
    return { deleted: res.count };
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  async get(id: string, organizationId?: string) {
    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        source: LeadSource.SURPLUS,
        ...(organizationId ? { organizationId } : {}),
      },
      include: { surplusDetail: true },
    });
    return lead && lead.surplusDetail ? this.toRow(lead) : null;
  }

  async list(filters: SurplusListFilters) {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(200, filters.pageSize || 60);

    const asList = (v?: string) =>
      String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

    const detailWhere: any = {};

    const tiers = asList(filters.tier);
    if (tiers.length) detailWhere.tier = { in: tiers };

    const stages = asList(filters.stage);
    if (stages.length) detailWhere.stage = { in: stages };
    else if (filters.hideDead) detailWhere.stage = { not: SurplusStage.DEAD };

    if (filters.claimantType) {
      detailWhere.claimantType = claimantTypeFromText(filters.claimantType);
    } else {
      // Lienholders are a different conversation with different economics and
      // are out of the default view rather than mixed in with owners and heirs.
      detailWhere.claimantType = { not: SurplusClaimantType.LIENHOLDER };
    }

    // The floor is enforced at ingestion, but a lead whose surplus was later
    // revised down should drop out of the feed too.
    detailWhere.grossSurplus = { gte: SURPLUS_FLOOR };
    if (filters.band === '15-25') detailWhere.grossSurplus = { gte: 15000, lt: 25000 };
    if (filters.band === '25-50') detailWhere.grossSurplus = { gte: 25000, lt: 50000 };
    if (filters.band === '50+') detailWhere.grossSurplus = { gte: 50000 };

    const county = filters.county || 'active';
    if (county === 'active') detailWhere.county = { in: FL_COUNTIES.active };
    else if (county === 'all') detailWhere.county = { in: ALL_FL_COUNTIES };
    else detailWhere.county = county;

    if (filters.hideDnc) detailWhere.doNotCall = false;

    if (filters.noticeAge) {
      const now = new Date();
      const back = (days: number) => {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        d.setDate(d.getDate() - days);
        return d;
      };
      if (filters.noticeAge === '0-7') detailWhere.noticeDate = { gte: back(7) };
      if (filters.noticeAge === '8-30') detailWhere.noticeDate = { gte: back(30), lt: back(7) };
      if (filters.noticeAge === '31-120') detailWhere.noticeDate = { gte: back(120), lt: back(30) };
      if (filters.noticeAge === '120+') detailWhere.noticeDate = { lt: back(120) };
    }

    const where: any = {
      source: LeadSource.SURPLUS,
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      surplusDetail: { is: detailWhere },
    };

    const q = String(filters.search || '').trim();
    if (q) {
      where.OR = [
        { propertyAddress: { contains: q, mode: 'insensitive' } },
        { propertyCity: { contains: q, mode: 'insensitive' } },
        { sellerFirstName: { contains: q, mode: 'insensitive' } },
        { sellerLastName: { contains: q, mode: 'insensitive' } },
        { surplusDetail: { is: { county: { contains: q, mode: 'insensitive' } } } },
        { surplusDetail: { is: { caseNumber: { contains: q, mode: 'insensitive' } } } },
        { surplusDetail: { is: { parcelId: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const leads = await this.prisma.lead.findMany({
      where,
      include: { surplusDetail: true },
      orderBy: this.orderFor(filters.sort),
      take: 5000,
    });

    let rows = leads.filter((l) => l.surplusDetail).map((l) => this.toRow(l));

    // Both of these read the compliance gate or a derived clock, neither of
    // which is a column, so they are the only passes done in memory.
    if (filters.lienWindow === 'open') rows = rows.filter((r) => r.lienWindowOpen);
    if (filters.lienWindow === 'closed') rows = rows.filter((r) => !r.lienWindowOpen);
    if (filters.blockedOnly) rows = rows.filter((r) => !r.compliance.clear);

    if (filters.sort === 'notice') {
      rows.sort((a, b) => (a.noticeAge ?? 9999) - (b.noticeAge ?? 9999));
    }
    if (filters.sort === 'net') rows.sort((a, b) => b.netToClaimant - a.netToClaimant);
    if (filters.sort === 'tier') {
      const order = [SurplusTier.A, SurplusTier.B, SurplusTier.C, SurplusTier.UNBANDED];
      rows.sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
    }

    const total = rows.length;
    const start = (page - 1) * pageSize;

    return {
      data: rows.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      counties: {
        active: FL_COUNTIES.active,
        candidate: FL_COUNTIES.candidate,
      },
      surplusFloor: SURPLUS_FLOOR,
      disclosureLabels: DISCLOSURE_LABELS,
    };
  }

  private orderFor(sort?: string): any {
    switch (sort) {
      case 'surplus':
        return [{ surplusDetail: { grossSurplus: { sort: 'desc', nulls: 'last' } } }];
      case 'tier':
        return [{ surplusDetail: { tier: 'asc' } }];
      default:
        // Newest notice first: the clock starts at the notice, so the freshest
        // one has the most runway left to work.
        return [{ surplusDetail: { noticeDate: { sort: 'desc', nulls: 'last' } } }];
    }
  }

  /**
   * Board headline numbers. `belowFloor` counts leads that were ingested above
   * the floor and have since been revised under it, which is why the number can
   * be non-zero at all.
   */
  async stats(organizationId?: string) {
    const leads = await this.prisma.lead.findMany({
      where: {
        source: LeadSource.SURPLUS,
        ...(organizationId ? { organizationId } : {}),
      },
      include: { surplusDetail: true },
    });
    const all = leads.filter((l) => l.surplusDetail).map((l) => this.toRow(l));
    const feed = all.filter(
      (r) => r.grossSurplus >= SURPLUS_FLOOR && r.claimantType !== SurplusClaimantType.LIENHOLDER,
    );

    return {
      openClaims: feed.length,
      newSevenDays: feed.filter((r) => r.noticeAge !== null && r.noticeAge <= 7).length,
      tierA: feed.filter((r) => r.tier === SurplusTier.A).length,
      complianceBlocked: all.filter((r) => !r.compliance.clear).length,
      netInPipeline: feed.reduce((acc, r) => acc + r.netToClaimant, 0),
      belowFloor: all.length - all.filter((r) => r.grossSurplus >= SURPLUS_FLOOR).length,
      total: all.length,
    };
  }

  // ─── Shaping ──────────────────────────────────────────────────────────────

  private toRow(lead: any) {
    const d = lead.surplusDetail;

    const phones = [
      { number: normalizePhoneDigits(lead.sellerPhone) || '', type: d.phone1Type, dnc: d.phone1Dnc },
      { number: normalizePhoneDigits(d.phone2) || '', type: d.phone2Type, dnc: d.phone2Dnc },
      { number: normalizePhoneDigits(d.phone3) || '', type: d.phone3Type, dnc: d.phone3Dnc },
      { number: normalizePhoneDigits(d.phone4) || '', type: d.phone4Type, dnc: d.phone4Dnc },
    ].filter((p) => p.number);
    const emails = [lead.sellerEmail, d.email2].map((e) => cellText(e)).filter(Boolean);

    const week = isoWeekKey();
    const staleWeek = d.touchWeek && d.touchWeek !== week;
    const touchDays = staleWeek ? {} : (d.touchDays as Record<string, boolean>) || {};
    const totalTouches = (d.touchCount || 0) + touchDayCount(d.touchDays);

    const facts = {
      surplusType: d.surplusType,
      fundLocation: d.fundLocation,
      claimantType: d.claimantType,
      deceased: d.deceased,
      heirsRequired: d.heirsRequired,
      competingLien: d.competingLien,
      grossSurplus: d.grossSurplus,
      liens: (d.liens as SurplusLien[]) || [],
      noticeDate: d.noticeDate,
      noticeConfirmed: d.noticeConfirmed,
      certOfDisbursements: d.certOfDisbursements,
      totalConsideration: d.totalConsideration,
      licensedRepId: d.licensedRepId,
      disclosures: (d.disclosures as Record<string, boolean>) || {},
      entitlementVerified: d.entitlementVerified,
      titleSearchComplete: d.titleSearchComplete,
      stage: d.stage,
    };

    const gate = complianceGate(facts);

    return {
      id: lead.id,
      claimant: `${lead.sellerFirstName} ${lead.sellerLastName}`.trim(),
      claimantType: d.claimantType,
      address: lead.propertyAddress,
      city: lead.propertyCity,
      state: lead.propertyState,
      zip: lead.propertyZip,
      county: d.county,
      caseNumber: d.caseNumber,
      parcelId: d.parcelId,

      deceased: d.deceased,
      heirsRequired: d.heirsRequired,
      isDeceased: isDeceased(facts),
      competingLien: d.competingLien,

      surplusType: d.surplusType,
      fundLocation: d.fundLocation,

      stage: d.stage,
      tier: tierOf(facts),
      dripTrack: dripTrack(facts),

      saleDate: d.saleDate,
      salePrice: d.salePrice,
      noticeDate: d.noticeDate,
      noticeConfirmed: d.noticeConfirmed,
      noticeAge: noticeAge(facts),
      claimDeadline: claimDeadline(facts),
      daysRemaining: daysRemaining(facts),
      windowElapsedPct: windowElapsedPct(facts),
      certOfDisbursements: d.certOfDisbursements,
      assignmentDeadline: assignmentDeadline(facts),
      assignmentDaysLeft: assignmentDaysLeft(facts),
      lienWindowOpen: lienWindowOpen(facts),

      grossSurplus: d.grossSurplus || 0,
      liens: sortedLiens(facts),
      totalLiens: totalLiens(facts),
      netToClaimant: netToClaimant(facts),
      estFee: estFee(facts),

      arrangement: d.arrangement,
      totalConsideration: consideration(facts),
      pctOfGross: pctOfGross(facts),
      pctOfNet: pctOfNet(facts),
      governingPct: governingPct(facts),
      licensedRepId: d.licensedRepId,

      entitlementVerified: d.entitlementVerified,
      titleSearchComplete: d.titleSearchComplete,
      canQualify: canQualify(facts),
      disclosures: facts.disclosures,
      docs: (d.docs as Record<string, boolean>) || {},

      compliance: {
        clear: gate.clear,
        blocks: gate.blocks,
        warns: gate.warns,
        rule: gate.rule,
      },

      phones,
      emails,
      cleanPhoneCount: phones.filter((p) => !p.dnc).length,
      dncScrubbedAt: d.dncScrubbedAt,
      contactMismatch: d.contactMismatch,
      mismatchedName: d.mismatchedName,
      doNotCall: d.doNotCall,
      callNotes: d.callNotes || '',
      touchDays,
      totalTouches,

      createdAt: lead.createdAt,
    };
  }
}
