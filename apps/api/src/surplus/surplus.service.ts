import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LeadSource,
  SurplusStage,
  SurplusClaimantType,
  SurplusType,
  SurplusFundLocation,
  SurplusTier,
  SurplusClaimStatus,
  SURPLUS_QUEUE_LABEL,
  SurplusQueue,
  SURPLUS_QUEUE_RANK,
  surplusCallConnected,
  SurplusDeadReason,
  SURPLUS_DEAD_REASON_LABEL,
  SurplusDocumentKind,
  SurplusDocumentStatus,
  surplusDocumentAtLeast,
} from '@fast-homes/shared';
import { CLAIM_STATUS_LABEL } from './surplus-classify.util';
import { nameSearchPlan } from './surplus-name-search.util';
import { traceState } from './surplus-skiptrace.util';
import { heirRow } from './surplus-heirs.util';
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
  workScore,
  workReason,
  claimantTypeFromText,
  stageFromText,
  tierOf,
  queueOf,
  queueReason,
  dripTrack,
  isDeceased,
  noticeAge,
  daysSinceSale,
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
  stageGateError,
  stageBlocks,
  StageGateContext,
  complianceGate,
  SurplusLien,
} from './surplus.util';
import {
  SURPLUS_FLOOR,
  DISCLOSURE_LABELS,
  courtRecordsUrl,
} from './surplus-compliance';
import { SurplusLeadInput, SurplusListFilters, SurplusPhoneInput } from './surplus.types';
import { SurplusCountiesService, CountyRow } from './surplus-counties.service';
import { SurplusDocumentsService } from './surplus-documents.service';
import { SurplusTemplatesService } from './surplus-templates.service';

/** What toRow needs beyond the lead: per-request lookups fetched once. */
interface RowContext {
  counties?: Map<string, CountyRow>;
  /** Active template version per kind, for the stale flag on documents. */
  templateVersions?: Record<string, number>;
}

/**
 * What every surplus read pulls alongside the lead. Heirs, because an Estate
 * claimant's queue depends on whether a living heir is on file. Open tasks,
 * because the board and the panel show the next action and whether it is
 * overdue, and a follow-up nobody can see is a follow-up nobody does.
 */
/** The default letter cadence, per the course: biweekly unless the file says weekly. */
const DEFAULT_LETTER_CADENCE_DAYS = 14;
/** Unanswered standard letters before the panel suggests Priority or FedEx. */
const LETTER_ESCALATE_AFTER = 3;

const LEAD_INCLUDE = {
  surplusDetail: {
    include: {
      heirs: true,
      letters: { orderBy: { mailedAt: 'desc' as const }, take: 10 },
      documents: true,
    },
  },
  tasks: {
    where: { completed: false },
    orderBy: { dueDate: 'asc' as const },
    take: 3,
    select: { id: true, title: true, dueDate: true, userId: true },
  },
  // Whether each channel has been TRIED, counted off the records the
  // channels themselves write. The course's rule is that a file is not worked
  // until it has been called, texted, emailed and lettered, and a checkbox
  // somebody ticks would drift from what actually went out.
  _count: {
    select: {
      callLogs: { where: { type: { in: ['twilio_browser', 'ai_outbound'] } } },
      messages: { where: { direction: 'OUTBOUND' } },
      emails: { where: { direction: 'outbound' } },
    },
  },
};

const CHANNELS = ['called', 'texted', 'emailed', 'lettered'] as const;
const CONTACT_RANK: Record<string, number> = { not_tapped: 0, tapped: 1, recap_scheduled: 2 };

/** Days after a stage change before its follow-up task comes due. */
/**
 * The follow-up each stage change creates. Where an attorney is engaged the
 * county tasks are addressed to the attorney, per the course: once one is on
 * the case, nobody contacts the clerk directly.
 */
const STAGE_TASK_DAYS: Partial<
  Record<SurplusStage, { title: (name: string, attorney: string | null) => string; days: number }>
> = {
  [SurplusStage.AGREEMENT_SIGNED]: {
    title: (n) => `Book the notary and get ${n}'s assignment signed`,
    days: 7,
  },
  [SurplusStage.ASSIGNMENT_NOTARIZED]: {
    title: (n, a) => (a ? `Have ${a} file ${n}'s claim with the clerk` : `File ${n}'s claim with the clerk`),
    days: 7,
  },
  [SurplusStage.CLAIM_FILED]: {
    title: (n, a) => (a ? `Ask ${a} where ${n}'s claim stands with the clerk` : `Check with the clerk on ${n}'s claim`),
    days: 21,
  },
  [SurplusStage.AWAITING_DISBURSEMENT]: {
    title: (n, a) =>
      a ? `Ask ${a} when the county will pay ${n}'s claim` : `Check with the clerk on ${n}'s disbursement`,
    days: 30,
  },
  [SurplusStage.CHECK_RECEIVED]: {
    title: (n) => `Tell ${n} the check arrived and start the disbursement report`,
    days: 1,
  },
};

/** The reason string, when it is one of ours. */
function deadReasonOf(raw: unknown): SurplusDeadReason | null {
  return (Object.values(SurplusDeadReason) as string[]).includes(String(raw || ''))
    ? (raw as SurplusDeadReason)
    : null;
}

/** Days after a letter goes out before checking for a reply. */
const LETTER_FOLLOW_UP_DAYS = 14;

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
  /** On a duplicate: what the existing file is, so an import can say "previously worked". */
  existing?: { stage: string | null; deadReason: string | null; deadAt: Date | null };
}

/**
 * A claimant name that belongs to an organization rather than a person.
 *
 * One definition, used by both the work queue and the name-search plan. They
 * disagreeing would put a claimant in the "find the registered agent" queue
 * while handing them a people-search link, or the reverse.
 */
const ENTITY_NAME =
  /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|LP|LLP|LLLP|LTD|TRUST|ASSOCIATION|CHURCH|BANK|PARTNERS|HOLDINGS)\b/i;

@Injectable()
export class SurplusService {
  private readonly logger = new Logger(SurplusService.name);

  constructor(
    private prisma: PrismaService,
    private counties: SurplusCountiesService,
    private documents: SurplusDocumentsService,
    private templates: SurplusTemplatesService,
  ) {}

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
   * out of a view: under the floor the fee does not cover the title search and
   * the filing, so the lead should not exist. See surplus-compliance.ts for
   * where the floor currently sits and why it moved.
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
      select: { leadId: true, stage: true, deadReason: true, deadAt: true },
    });
    if (existing) {
      // Say what the existing file is, so an import can tell "already on
      // the board" from "previously worked and retired" instead of both
      // reading as a silent skip.
      return {
        leadId: existing.leadId,
        created: false,
        reason: 'duplicate',
        existing: { stage: existing.stage, deadReason: existing.deadReason, deadAt: existing.deadAt },
      };
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
            claimStatus: input.claimStatus || SurplusClaimStatus.UNKNOWN,
            surplusAtNotice: input.surplusAtNotice ?? null,
            mailVerdict: input.mailVerdict || null,
            claimLedger: (input.claimLedger as any) ?? null,
            noticeRecipient: input.noticeRecipient || null,
            ownerMailingStreet: input.ownerMailingStreet || null,
            ownerMailingCity: input.ownerMailingCity || null,
            ownerMailingState: input.ownerMailingState || null,
            ownerMailingZip: input.ownerMailingZip || null,
            ownerAddressSource: input.ownerAddressSource || null,
            sourceSystem: input.sourceSystem || null,
            sourceCaseId: input.sourceCaseId || null,
            sourceUrl: input.sourceUrl || null,
            lastPolledAt: input.sourceSystem ? new Date() : null,
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
  async update(id: string, patch: any, organizationId?: string, userId?: string | null) {
    const lead = await this.prisma.lead.findFirst({
      where: {
        id,
        source: LeadSource.SURPLUS,
        ...(organizationId ? { organizationId } : {}),
      },
      // Heirs travel with the detail: an Estate claimant's queue, card and
      // panel all depend on whether a living heir is on file.
      include: LEAD_INCLUDE,
    });
    if (!lead || !lead.surplusDetail) return null;

    const d = lead.surplusDetail;
    const detailPatch: any = {};
    const leadPatch: any = {};

    const passthrough = [
      'county', 'caseNumber', 'parcelId', 'deceased', 'heirsRequired', 'competingLien',
      'surplusType', 'fundLocation', 'noticeConfirmed', 'arrangement', 'licensedRepId',
      'entitlementVerified', 'titleSearchComplete', 'doNotCall', 'callNotes',
      'letterMailedTo',
      'notaryName', 'notaryPhone', 'notaryEmail', 'notarySource', 'notaryNotes', 'notaryAppointmentPlace',
      'attorneyRequired', 'attorneyName', 'attorneyFirm', 'attorneyPhone', 'attorneyEmail', 'attorneySource',
      'attorneyNotes',
      'submissionTrackingNumber', 'submissionSignatureRequired', 'clerkContactName', 'clerkStatusNote',
      'additionalDocsRequested',
    ];
    if (patch.submissionMethod !== undefined) {
      const m = patch.submissionMethod === null ? null : String(patch.submissionMethod).toLowerCase();
      if (m && !['usps', 'fedex', 'ups', 'in_person', 'efile'].includes(m)) {
        throw new BadRequestException('Submission method is USPS, FedEx, UPS, in person, or e-file.');
      }
      detailPatch.submissionMethod = m;
    }
    for (const k of passthrough) {
      if (patch[k] !== undefined) detailPatch[k] = patch[k];
    }

    for (const k of ['salePrice', 'grossSurplus', 'totalConsideration']) {
      if (patch[k] !== undefined) detailPatch[k] = patch[k] === null ? null : Number(patch[k]);
    }
    if (patch.letterCadenceDays !== undefined) {
      const n = patch.letterCadenceDays === null ? null : Number(patch.letterCadenceDays);
      if (n !== null && n !== 7 && n !== 14) {
        throw new BadRequestException('Letter cadence is weekly (7) or biweekly (14).');
      }
      detailPatch.letterCadenceDays = n;
    }

    for (const k of ['saleDate', 'noticeDate', 'certOfDisbursements', 'letterMailedAt']) {
      if (patch[k] !== undefined) {
        detailPatch[k] = patch[k] ? isoToDate(String(patch[k]).slice(0, 10)) : null;
      }
    }

    // The notary's dates keep their time of day: an appointment is at 2pm,
    // not on a day. The agreement date is the gate on the appointment, per
    // the course: the notary signs the instruction sheet before anything is
    // booked, so the document list and the signing order are locked first.
    for (const k of [
      'notaryAgreementSignedAt',
      'notaryAppointmentAt',
      'notarySignedInOrderAt',
      'attorneyEngagedAt',
      'submittedAt',
      'countyAcknowledgedAt',
      'expectedDisbursementAt',
    ]) {
      if (patch[k] === undefined) continue;
      if (patch[k] === null) {
        detailPatch[k] = null;
        continue;
      }
      const at = new Date(patch[k]);
      if (Number.isNaN(at.getTime())) throw new BadRequestException(`${k} is not a date.`);
      detailPatch[k] = at;
    }
    const agreementSignedAt =
      detailPatch.notaryAgreementSignedAt !== undefined ? detailPatch.notaryAgreementSignedAt : d.notaryAgreementSignedAt;
    if (detailPatch.notaryAppointmentAt && !agreementSignedAt) {
      throw new BadRequestException(
        'Book the claimant appointment after the notary has signed the agreement. That locks in the document list and the signing order.',
      );
    }
    // Clearing the letter is now removing the latest one from the history
    // and re-caching from what is left, so a mistaken click leaves nothing
    // behind that reads as if a letter went out.
    if (patch.letterMailedAt === null) {
      const latest = await this.prisma.surplusLetter.findFirst({
        where: { surplusDetailId: d.id },
        orderBy: { mailedAt: 'desc' },
      });
      if (latest) await this.prisma.surplusLetter.delete({ where: { id: latest.id } });
      const prev = await this.prisma.surplusLetter.findFirst({
        where: { surplusDetailId: d.id },
        orderBy: { mailedAt: 'desc' },
      });
      detailPatch.letterMailedAt = prev?.mailedAt || null;
      detailPatch.letterMailedTo = prev?.address || null;
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
      const refused = stageGateError(after, next, await this.gateContext(lead, after));
      if (refused) throw new BadRequestException(refused);
      detailPatch.stage = next;
      // Entering Claim Filed is the filing: stamp the date unless one was
      // given, so the county follow-up clock has a start.
      if (next === SurplusStage.CLAIM_FILED && !d.submittedAt && detailPatch.submittedAt === undefined) {
        detailPatch.submittedAt = new Date();
      }
      if (next === SurplusStage.DEAD) {
        // Dead needs a reason. Recorded rather than deleted, so a re-listed
        // case is matched against why it was retired.
        const reason = patch.deadReason !== undefined ? patch.deadReason : d.deadReason;
        if (!deadReasonOf(reason)) {
          throw new BadRequestException('Marking a claim Dead needs a reason: below the floor, deceased with no heirs, competing claim, unresponsive, already assigned, or other.');
        }
        detailPatch.deadReason = reason;
        detailPatch.deadNote = patch.deadNote !== undefined ? (patch.deadNote || '').trim() || null : d.deadNote;
        detailPatch.deadAt = d.stage === SurplusStage.DEAD && d.deadAt ? d.deadAt : new Date();
        leadPatch.status = 'DEAD';
      } else if (d.stage === SurplusStage.DEAD) {
        // Revived. The reason is cleared so the row does not read as dead
        // and alive at once; the timeline still has the history.
        detailPatch.deadReason = null;
        detailPatch.deadNote = null;
        detailPatch.deadAt = null;
        leadPatch.status = 'NEW';
      }
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

    if (detailPatch.stage && detailPatch.stage !== d.stage) {
      await this.scheduleStageTask(id, detailPatch.stage, userId);
    }

    // The notary's own documents follow the notary's dates, so the document
    // set and the notary section cannot disagree about what has been signed.
    const claimant = `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim() || 'the claimant';
    if (detailPatch.notaryAgreementSignedAt) {
      await this.documents
        .setStatus(id, SurplusDocumentKind.NOTARY_AGREEMENT, { status: SurplusDocumentStatus.SIGNED }, organizationId, userId)
        .catch(() => undefined);
    }
    if (detailPatch.notaryAppointmentAt) {
      const when = new Date(detailPatch.notaryAppointmentAt);
      const label = when.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
      });
      await this.createTaskAt(id, `Notary appointment with ${claimant}, ${label}`, when, userId);
    }
    if (detailPatch.notarySignedInOrderAt) {
      await this.recordSignedInOrder(id, organizationId, userId);
    }

    // The county acknowledging receipt is what Awaiting Disbursement means,
    // so a claim at Claim Filed moves on its own when the date is recorded,
    // and the "check with the clerk" task that was waiting for it closes.
    if (detailPatch.countyAcknowledgedAt && !d.countyAcknowledgedAt) {
      const stageNow = detailPatch.stage || d.stage;
      await this.completeOpenTasks(id, [
        `Check with the clerk on ${claimant}'s claim`,
        `Ask ${d.attorneyName || 'the attorney'} where ${claimant}'s claim stands with the clerk`,
      ]);
      await this.prisma.activity.create({
        data: {
          leadId: id,
          userId: userId || undefined,
          type: 'COUNTY_ACKNOWLEDGED',
          description: `${d.county || 'The county'} acknowledged receipt of ${claimant}'s claim`,
          metadata: { acknowledgedAt: new Date(detailPatch.countyAcknowledgedAt).toISOString() },
        },
      });
      if (stageNow === SurplusStage.CLAIM_FILED) {
        await this.prisma.surplusDetail.update({
          where: { id: d.id },
          data: { stage: SurplusStage.AWAITING_DISBURSEMENT },
        });
        await this.scheduleStageTask(id, SurplusStage.AWAITING_DISBURSEMENT, userId);
      }
    }

    // Engaging an attorney is a rule change on the case, not a note: from
    // here every county contact goes through them. Logged on the timeline
    // so the thread says when it changed, and the open county tasks are
    // re-addressed so nobody picks one up and rings the clerk.
    if (detailPatch.attorneyEngagedAt && !d.attorneyEngagedAt) {
      const who = detailPatch.attorneyName || d.attorneyName || 'the attorney';
      await this.prisma.activity.create({
        data: {
          leadId: id,
          userId: userId || undefined,
          type: 'ATTORNEY_ENGAGED',
          description: `${who} engaged. All contact with the county and the court now goes through them.`,
          metadata: { attorneyName: who, firm: detailPatch.attorneyFirm || d.attorneyFirm || null },
        },
      });
      await this.readdressCountyTasks(id, claimant, who);
    }

    return this.get(id, organizationId);
  }

  /** Open county tasks re-titled to go through the attorney. */
  private async readdressCountyTasks(leadId: string, claimant: string, attorney: string) {
    const open = await this.prisma.task.findMany({ where: { leadId, completed: false } });
    const fileTitle = `File ${claimant}'s claim with the clerk`;
    const checkTitle = `Check with the clerk on ${claimant}'s claim`;
    for (const t of open) {
      if (t.title === fileTitle) {
        await this.prisma.task.update({ where: { id: t.id }, data: { title: `Have ${attorney} file ${claimant}'s claim with the clerk` } });
      } else if (t.title === checkTitle) {
        await this.prisma.task.update({ where: { id: t.id }, data: { title: `Ask ${attorney} where ${claimant}'s claim stands with the clerk` } });
      }
    }
  }

  /**
   * The notary reported everything signed in the printed order. That is the
   * fact the signing gate waits for, so the documents move together: the
   * retention pair to signed, the assignment to notarized, the rest to
   * signed. Only ever upgrades; a document already further along stays.
   */
  private async recordSignedInOrder(leadId: string, organizationId?: string | null, userId?: string | null) {
    const moves: [SurplusDocumentKind, SurplusDocumentStatus][] = [
      [SurplusDocumentKind.FEE_AGREEMENT, SurplusDocumentStatus.SIGNED],
      [SurplusDocumentKind.LIMITED_POA, SurplusDocumentStatus.SIGNED],
      [SurplusDocumentKind.ASSIGNMENT_OF_RIGHTS, SurplusDocumentStatus.NOTARIZED],
      [SurplusDocumentKind.LETTER_OF_DIRECTION, SurplusDocumentStatus.SIGNED],
      [SurplusDocumentKind.COUNTY_CLAIM_FORM, SurplusDocumentStatus.SIGNED],
    ];
    const detail = await this.prisma.surplusDetail.findUnique({
      where: { leadId },
      select: { documents: { select: { kind: true, status: true } } },
    });
    const current = new Map((detail?.documents || []).map((x) => [x.kind, x.status]));
    for (const [kind, status] of moves) {
      if (surplusDocumentAtLeast(current.get(kind), status)) continue;
      await this.documents.setStatus(leadId, kind, { status }, organizationId, userId).catch(() => undefined);
    }
    await this.prisma.activity.create({
      data: {
        leadId,
        userId: userId || undefined,
        type: 'NOTARY_SIGNED_IN_ORDER',
        description: 'Notary confirmed every document was signed in the printed order',
        metadata: { moved: moves.map(([k]) => k) },
      },
    });
  }

  /** Close open tasks by title, when the thing they waited for has happened. */
  private async completeOpenTasks(leadId: string, titles: string[]) {
    await this.prisma.task.updateMany({
      where: { leadId, completed: false, title: { in: titles } },
      data: { completed: true, completedAt: new Date() },
    });
  }

  /** A task due at an exact time, for an appointment. Idempotent on title. */
  private async createTaskAt(leadId: string, title: string, dueDate: Date, userId?: string | null) {
    const open = await this.prisma.task.findFirst({ where: { leadId, title, completed: false } });
    if (open) return;
    await this.prisma.task.create({ data: { leadId, title, dueDate, userId: userId || undefined } });
    await this.prisma.activity.create({
      data: {
        leadId,
        userId: userId || undefined,
        type: 'TASK_CREATED',
        description: `Task created: ${title}`,
        metadata: { title, dueDate: dueDate.toISOString(), auto: true },
      },
    });
  }

  /**
   * What the stage gate reads beyond the three qualification flags: the
   * document statuses, the compliance blocks, and the required documents
   * still missing. Built from the detail as it stands (or as it is about to
   * be written), so the gate and the panel's explanation agree.
   */
  private async gateContext(lead: any, d: any): Promise<StageGateContext> {
    // The county's attorney answer is the default the case inherits, so the
    // gate has to read it here as well as in the row builder.
    const countyRow = d.county
      ? (await this.counties.mapFor(lead.organizationId)).get(String(d.county).toLowerCase()) || null
      : null;
    lead = { ...lead, _countyRow: countyRow };
    const facts = {
      surplusType: d.surplusType,
      fundLocation: d.fundLocation,
      claimantType: d.claimantType,
      deceased: d.deceased,
      heirsRequired: d.heirsRequired,
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
    const checklist = this.documents.checklist(d.documents || [], {
      deceased: isDeceased(facts),
      isEntity: ENTITY_NAME.test(`${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`),
    });
    const docs: Record<string, string> = {};
    for (const doc of d.documents || []) docs[doc.kind] = doc.status;
    return {
      docs,
      complianceBlocks: complianceGate(facts).blocks,
      docsMissing: checklist.missing,
      ...this.attorneyGate(d, lead),
      submissionMethod: d.submissionMethod,
      submissionTrackingNumber: d.submissionTrackingNumber,
      countyAcknowledgedAt: d.countyAcknowledgedAt,
    };
  }

  /**
   * Whether this case needs an attorney and has one. The case's own flag
   * wins; otherwise the county's answer applies. Engaged means a person
   * marked them engaged, or at least named them.
   */
  private attorneyGate(d: any, lead: any): { attorneyRequired: boolean; attorneyEngaged: boolean } {
    const county = lead?._countyRow || null;
    const required = d.attorneyRequired ?? county?.attorneyRequired ?? false;
    return { attorneyRequired: !!required, attorneyEngaged: !!(d.attorneyEngagedAt || d.attorneyName) };
  }

  /**
   * The follow-up a stage change creates, so a deadline is a dated task and
   * not a memory. Idempotent on title: moving a claimant back and forward
   * does not stack reminders. The task has no owner when the change came from
   * ingestion; a person's change is theirs to chase.
   */
  private async scheduleStageTask(leadId: string, stage: string, userId?: string | null) {
    const rule = STAGE_TASK_DAYS[stage as SurplusStage];
    if (!rule) return;
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        sellerFirstName: true,
        sellerLastName: true,
        surplusDetail: { select: { attorneyName: true, attorneyEngagedAt: true } },
      },
    });
    const name = `${lead?.sellerFirstName || ''} ${lead?.sellerLastName || ''}`.trim() || 'the claimant';
    const attorney =
      lead?.surplusDetail?.attorneyEngagedAt || lead?.surplusDetail?.attorneyName
        ? lead.surplusDetail.attorneyName || 'the attorney'
        : null;
    await this.createTaskOnce(leadId, rule.title(name, attorney), rule.days, userId);
  }

  private async createTaskOnce(leadId: string, title: string, days: number, userId?: string | null) {
    const open = await this.prisma.task.findFirst({ where: { leadId, title, completed: false } });
    if (open) return;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + days);
    dueDate.setHours(9, 0, 0, 0);
    await this.prisma.task.create({
      data: { leadId, title, dueDate, userId: userId || undefined },
    });
    await this.prisma.activity.create({
      data: {
        leadId,
        userId: userId || undefined,
        type: 'TASK_CREATED',
        description: `Task created: ${title}`,
        metadata: { title, dueDate: dueDate.toISOString(), auto: true },
      },
    });
  }

  /**
   * Move several claimants to one stage at once, for clearing a board.
   *
   * Separate from update() so marking forty leads dead is one round trip rather
   * than forty, and so the stage is validated once against the enum instead of
   * trusting whatever the client sent.
   */
  /**
   * Record that a letter went out to each of these claimants. One call serves
   * the panel (one id) and the board's bulk action (a rack of them).
   *
   * The envelope address defaults to where the clerk wrote to the owner, per
   * CLAIMANT, because co-owners are routinely at different addresses and the
   * whole point of the record is which address has been written to. A note is
   * added to the lead as well, so the mailing shows in the timeline beside
   * every call and text and the team's habit of logging it there keeps working.
   */
  async markLetterMailed(
    ids: string[],
    opts: {
      mailedAt?: string | null;
      address?: string | null;
      note?: string | null;
      /** 'standard' | 'priority' | 'fedex' */
      mailType?: string | null;
      trackingNumber?: string | null;
      /** SurplusTemplateKind, when the letter came off a template. */
      templateKind?: string | null;
      templateVersion?: number | null;
      recipientName?: string | null;
      /** The envelope went to this heir rather than the claimant. One id only. */
      heirId?: string | null;
    },
    userId?: string | null,
    organizationId?: string | null,
  ) {
    const where: any = { id: { in: ids }, source: LeadSource.SURPLUS };
    if (organizationId) where.organizationId = organizationId;
    const leads = await this.prisma.lead.findMany({
      where,
      select: {
        id: true,
        organizationId: true,
        sellerFirstName: true,
        sellerLastName: true,
        surplusDetail: {
          select: {
            id: true,
            ownerMailingStreet: true,
            ownerMailingCity: true,
            ownerMailingState: true,
            ownerMailingZip: true,
            heirs: { select: { id: true, name: true, street: true, city: true, state: true, zip: true } },
          },
        },
      },
    });
    if (!leads.length) return { updated: 0 };

    const mailType = ['standard', 'priority', 'fedex'].includes(String(opts.mailType || ''))
      ? String(opts.mailType)
      : 'standard';

    const mailedAt = opts.mailedAt
      ? isoToDate(String(opts.mailedAt).slice(0, 10))
      : new Date();
    const dateLabel = mailedAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });

    let updated = 0;
    for (const lead of leads) {
      const d = lead.surplusDetail;
      if (!d) continue;
      const claimantName = `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim();
      // An heir's envelope goes to the heir's own address off the filing, not
      // the dead claimant's, and is recorded against the heir.
      const heir = opts.heirId ? d.heirs.find((h) => h.id === opts.heirId) || null : null;
      const defaultAddress = heir
        ? [heir.street, heir.city, [heir.state, heir.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
        : [d.ownerMailingStreet, d.ownerMailingCity, [d.ownerMailingState, d.ownerMailingZip].filter(Boolean).join(' ')]
            .filter(Boolean)
            .join(', ');
      const address = (opts.address || '').trim() || defaultAddress || null;
      const recipientName = (opts.recipientName || '').trim() || heir?.name || claimantName || null;

      await this.prisma.surplusLetter.create({
        data: {
          surplusDetailId: d.id,
          heirId: heir?.id || null,
          organizationId: lead.organizationId,
          mailedAt,
          recipientName,
          address,
          templateKind: opts.templateKind || null,
          templateVersion: opts.templateVersion ?? null,
          mailType,
          trackingNumber: (opts.trackingNumber || '').trim() || null,
          note: (opts.note || '').trim() || null,
          sentByUserId: userId || null,
        },
      });
      // The cache the queue reads: the latest envelope, whoever it went to.
      // A letter to an heir still parks the claim in Letter sent, since it
      // is the same claim waiting on the same reply.
      await this.prisma.surplusDetail.update({
        where: { id: d.id },
        data: { letterMailedAt: mailedAt, letterMailedTo: address },
      });
      updated += 1;

      // A letter in the post is a promise to check for a reply. Two weeks is
      // the course's cadence, and past it the claimant is due another one.
      const name = `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim() || 'the claimant';
      await this.createTaskOnce(
        lead.id,
        `Check for a reply to the letter to ${name}`,
        LETTER_FOLLOW_UP_DAYS,
        userId,
      );

      if (userId) {
        const extra = (opts.note || '').trim();
        await this.prisma.note.create({
          data: {
            leadId: lead.id,
            userId,
            content:
              `Letter mailed ${dateLabel}` +
              (recipientName && recipientName !== claimantName ? ` to ${recipientName}` : '') +
              (address ? ` at ${address}` : ', address not recorded') +
              (mailType !== 'standard' ? ` by ${mailType === 'fedex' ? 'FedEx' : 'Priority Mail'}` : '') +
              (opts.trackingNumber ? `, tracking ${String(opts.trackingNumber).trim()}` : '') +
              (extra ? `. ${extra}` : ''),
          },
        });
      }
    }
    return { updated, mailedAt };
  }

  /** Take one envelope out of the history and re-cache the latest. */
  async removeLetter(letterId: string, organizationId?: string | null) {
    const letter = await this.prisma.surplusLetter.findFirst({
      where: { id: letterId, ...(organizationId ? { organizationId } : {}) },
    });
    if (!letter) throw new BadRequestException('Letter not found');
    await this.prisma.surplusLetter.delete({ where: { id: letter.id } });
    const latest = await this.prisma.surplusLetter.findFirst({
      where: { surplusDetailId: letter.surplusDetailId },
      orderBy: { mailedAt: 'desc' },
    });
    await this.prisma.surplusDetail.update({
      where: { id: letter.surplusDetailId },
      data: { letterMailedAt: latest?.mailedAt || null, letterMailedTo: latest?.address || null },
    });
    return { removed: 1 };
  }

  async bulkStage(
    ids: string[],
    stage: string,
    organizationId?: string | null,
    userId?: string | null,
    dead?: { reason?: string | null; note?: string | null },
  ) {
    const target = stageFromText(stage);
    if (target === SurplusStage.DEAD && !deadReasonOf(dead?.reason)) {
      throw new BadRequestException('Marking claims Dead needs a reason.');
    }
    const where: any = { id: { in: ids }, source: LeadSource.SURPLUS };
    if (organizationId) where.organizationId = organizationId;
    const leads = await this.prisma.lead.findMany({ where, include: LEAD_INCLUDE });
    if (!leads.length) return { updated: 0, stage: target };

    // The same gate as update(). Refused as a whole rather than moving the
    // claimants that pass: a kanban drag restages one property, and half a
    // property at Agreement Signed reads as if the agreement covered everyone.
    const refused = (
      await Promise.all(
        leads.map(async (l) => ({
          name: `${l.sellerFirstName || ''} ${l.sellerLastName || ''}`.trim() || 'a claimant',
          why: l.surplusDetail
            ? stageGateError(l.surplusDetail, target, await this.gateContext(l, l.surplusDetail))
            : null,
        })),
      )
    )
      .filter((r) => r.why);
    if (refused.length) {
      const first = refused[0];
      const more = refused.length > 1 ? ` (and ${refused.length - 1} more)` : '';
      throw new BadRequestException(`${first.name}${more}: ${first.why}`);
    }

    const leadIds = leads.map((l) => l.id);
    const res = await this.prisma.surplusDetail.updateMany({
      where: { leadId: { in: leadIds } },
      data: { stage: target },
    });
    // Dead is the one stage the Lead row mirrors, so the lead list and the
    // digest stop offering the claimant. update() does the same for one card.
    if (target === SurplusStage.DEAD) {
      await this.prisma.lead.updateMany({ where: { id: { in: leadIds } }, data: { status: 'DEAD' } });
      await this.prisma.surplusDetail.updateMany({
        where: { leadId: { in: leadIds } },
        data: { deadReason: dead!.reason, deadNote: (dead?.note || '').trim() || null, deadAt: new Date() },
      });
    } else {
      // Anything moved out of Dead is revived: the reason goes with it.
      await this.prisma.surplusDetail.updateMany({
        where: { leadId: { in: leadIds }, deadReason: { not: null } },
        data: { deadReason: null, deadNote: null, deadAt: null },
      });
    }
    for (const id of leadIds) await this.scheduleStageTask(id, target, userId);
    return { updated: res.count, stage: target };
  }

  /**
   * When surplus calls actually connect, by weekday and hour, over the last
   * ninety days. Read straight off the call log: every browser call on a
   * surplus lead is an attempt, and an outcome where a person picked up is a
   * connection. The course asks for this so the team's real best calling
   * windows surface from evidence rather than folklore.
   *
   * Hours are America/New_York, because that is where the claimants are.
   */
  async callStats(organizationId?: string | null) {
    const since = new Date(Date.now() - 90 * 86_400_000);
    const calls = await this.prisma.callLog.findMany({
      where: {
        type: 'twilio_browser',
        createdAt: { gte: since },
        lead: {
          source: LeadSource.SURPLUS,
          ...(organizationId ? { organizationId } : {}),
        },
      },
      select: { createdAt: true, outcome: true, disposition: true },
    });

    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    });
    const byWeekday = DAYS.map((day) => ({ day, calls: 0, connected: 0 }));
    const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, calls: 0, connected: 0 }));
    /** Weekday by two-hour block, for naming a best window. */
    const blocks = new Map<string, { day: string; fromHour: number; calls: number; connected: number }>();

    let connectedTotal = 0;
    for (const c of calls) {
      const parts = fmt.formatToParts(c.createdAt);
      const day = parts.find((p) => p.type === 'weekday')?.value || 'Sun';
      const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0) % 24;
      // Calls logged before the outcome enum existed carry only the
      // wholesaling disposition; the three that imply a conversation count.
      const connected =
        surplusCallConnected(c.outcome) ||
        (!c.outcome && ['Follow Up', 'Requested Appointment', 'Not Interested'].includes(c.disposition || ''));
      const di = Math.max(0, DAYS.indexOf(day));
      byWeekday[di].calls += 1;
      byHour[hour].calls += 1;
      const fromHour = hour - (hour % 2);
      const key = `${day}:${fromHour}`;
      const b = blocks.get(key) || { day, fromHour, calls: 0, connected: 0 };
      b.calls += 1;
      if (connected) {
        connectedTotal += 1;
        byWeekday[di].connected += 1;
        byHour[hour].connected += 1;
        b.connected += 1;
      }
      blocks.set(key, b);
    }

    // A best window needs enough calls behind it to mean anything.
    const MIN_BLOCK = 5;
    const best = Array.from(blocks.values())
      .filter((b) => b.calls >= MIN_BLOCK && b.connected > 0)
      .sort((a, b) => b.connected / b.calls - a.connected / a.calls || b.calls - a.calls)[0] || null;
    const clock = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;

    return {
      sinceDays: 90,
      calls: calls.length,
      connected: connectedTotal,
      connectRate: calls.length ? connectedTotal / calls.length : 0,
      byWeekday,
      byHour,
      best: best
        ? {
            label: `${best.day} ${clock(best.fromHour)} to ${clock(best.fromHour + 2)}`,
            calls: best.calls,
            connected: best.connected,
            rate: best.connected / best.calls,
          }
        : null,
    };
  }

  /**
   * Remove leads outright, and record a tombstone so the county poll cannot
   * bring them back.
   *
   * The tombstone is written FIRST and deliberately. Deleting the lead cascades
   * SurplusDetail away, taking the dedupeUid the poll matches on with it, so
   * after the delete there is nothing left to write one from. Without it the
   * case reads as brand new the next morning and returns with every note,
   * edited number and Dead marking gone, which is exactly what was happening.
   *
   * Marking a lead Dead is the normal way to retire one. This exists for a case
   * that should never have been ingested at all.
   */
  async bulkDelete(ids: string[], organizationId?: string) {
    const doomed = await this.prisma.lead.findMany({
      where: {
        id: { in: ids },
        source: LeadSource.SURPLUS,
        ...(organizationId ? { organizationId } : {}),
      },
      select: {
        id: true,
        propertyAddress: true,
        organizationId: true,
        surplusDetail: {
          select: { dedupeUid: true, county: true, caseNumber: true },
        },
        sellerFirstName: true,
        sellerLastName: true,
      },
    });
    if (!doomed.length) return { deleted: 0 };

    const tombstones = doomed
      .filter((l) => l.surplusDetail?.dedupeUid)
      .map((l) => ({
        organizationId: l.organizationId,
        dedupeUid: l.surplusDetail!.dedupeUid,
        county: l.surplusDetail!.county,
        caseNumber: l.surplusDetail!.caseNumber,
        claimant: `${l.sellerFirstName || ''} ${l.sellerLastName || ''}`.trim() || null,
        propertyAddress: l.propertyAddress,
        reason: 'deleted',
      }));

    if (tombstones.length) {
      await this.prisma.surplusSuppression.createMany({ data: tombstones });
    }

    const res = await this.prisma.lead.deleteMany({
      where: { id: { in: doomed.map((l) => l.id) } },
    });
    this.logger.log(
      `Deleted ${res.count} surplus lead(s), ${tombstones.length} suppressed from re-ingestion`,
    );
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
      // Heirs travel with the detail: an Estate claimant's queue, card and
      // panel all depend on whether a living heir is on file.
      include: LEAD_INCLUDE,
    });
    if (!lead || !lead.surplusDetail) return null;
    return this.toRow(lead, await this.rowContext(organizationId));
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

    // Default is every county we hold data for, which is what "no filter"
    // should mean. The old default filtered to a hardcoded "active" list, so a
    // county we started ingesting was invisible until somebody edited a
    // constant and redeployed.
    const county = filters.county || 'all';
    if (county !== 'all') detailWhere.county = county;

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
      // Heirs travel with the detail: an Estate claimant's queue, card and
      // panel all depend on whether a living heir is on file.
      include: LEAD_INCLUDE,
      orderBy: this.orderFor(filters.sort),
      take: 5000,
    });

    const ctx = await this.rowContext(filters.organizationId);
    let rows = leads.filter((l) => l.surplusDetail).map((l) => this.toRow(l, ctx));

    // These read the compliance gate, a derived clock, or the per-number DNC
    // flags, none of which is a single column, so they are the passes done in
    // memory.
    // A skip trace flags DNC per number, so a lead is uncallable when every
    // number it has is on a registry. The detail-level doNotCall flag only
    // catches leads somebody marked by hand, which is why hiding DNC appeared
    // to do nothing on imported rows. A lead with no numbers at all is not
    // do-not-call, it is un-traced, and hiding it would bury the mismatches
    // that need a manual re-trace.
    if (filters.hideDnc) {
      rows = rows.filter((r) => !(r.phones.length > 0 && r.cleanPhoneCount === 0));
    }
    // Retired cases are hidden by default. A distributed or already-assigned
    // case is not a lead, and the board is a call list before it is an archive.
    if (filters.claimStatus) {
      const wanted = asList(filters.claimStatus);
      rows = rows.filter((r) => wanted.includes(r.claimStatus));
    } else if (filters.hideRetired !== false) {
      rows = rows.filter((r) => r.workScore > 0 || r.stage === SurplusStage.DEAD);
    }

    // The queue is computed, so it filters here rather than in SQL. Cheap: the
    // list already materializes every matching row before paginating.
    const queues = asList(filters.queue);
    if (queues.length) rows = rows.filter((r) => queues.includes(r.queue));

    if (filters.lienWindow === 'open') rows = rows.filter((r) => r.lienWindowOpen);
    if (filters.lienWindow === 'closed') rows = rows.filter((r) => !r.lienWindowOpen);
    if (filters.blockedOnly) rows = rows.filter((r) => !r.compliance.clear);

    // The course's two working lists: people we have never heard from, and
    // files with a channel nobody has tried yet.
    if (filters.contact) rows = rows.filter((r) => r.contactStatus === filters.contact);
    if (filters.missingChannel) rows = rows.filter((r) => r.channelsMissing.length > 0);
    if (filters.letterDue) rows = rows.filter((r) => r.letterDue);

    if (filters.sort === 'untapped') {
      rows.sort(
        (a, b) =>
          (CONTACT_RANK[a.contactStatus] || 0) - (CONTACT_RANK[b.contactStatus] || 0) ||
          b.workScore - a.workScore,
      );
    }

    if (filters.sort === 'notice') {
      rows.sort((a, b) => (a.noticeAge ?? 9999) - (b.noticeAge ?? 9999));
    }
    if (filters.sort === 'net') rows.sort((a, b) => b.netToClaimant - a.netToClaimant);
    if (filters.sort === 'surplus') rows.sort((a, b) => b.grossSurplus - a.grossSurplus);
    // The default the board opens on: who to call first.
    if (!filters.sort || filters.sort === 'work') {
      rows.sort((a, b) => b.workScore - a.workScore || b.netToClaimant - a.netToClaimant);
    }
    if (filters.sort === 'tier') {
      const order = [SurplusTier.A, SurplusTier.B, SurplusTier.C, SurplusTier.UNBANDED];
      rows.sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
    }

    // ── Group by subject property ────────────────────────────────────────────
    // One sale owes several people, and each is its own lead with its own claim
    // and its own conversation. On the board that read as duplicate cards for
    // one house: Myrtis Griffin and Jessie Hall are both owed on 0 Hardee St,
    // and a reviewer sees the same address twice and cannot tell why.
    //
    // Grouping happens HERE and not in the browser because the board pages. Two
    // claimants on one property can land either side of a page boundary, and a
    // client-side group would then split them and show the duplicate anyway.
    if (filters.group !== 'lead') {
      const groups = groupByProperty(rows);
      const total = groups.length;
      const start = (page - 1) * pageSize;
      return {
        data: groups.slice(start, start + pageSize),
        grouped: true,
        total,
        leadCount: rows.length,
        page,
        pageSize,
        counties: await this.countiesInUse(filters.organizationId),
        surplusFloor: SURPLUS_FLOOR,
        disclosureLabels: DISCLOSURE_LABELS,
      };
    }

    const total = rows.length;
    const start = (page - 1) * pageSize;

    return {
      data: rows.slice(start, start + pageSize),
      grouped: false,
      leadCount: rows.length,
      total,
      page,
      pageSize,
      counties: await this.countiesInUse(filters.organizationId),
      surplusFloor: SURPLUS_FLOOR,
      disclosureLabels: DISCLOSURE_LABELS,
    };
  }

  /**
   * The counties actually represented in the data, for the filter.
   *
   * Was a hardcoded list of four "active" and four "candidate" Florida
   * counties, which offered Lee, Marion, Volusia and four more that hold no
   * leads: a filter whose every option but one returns an empty board. The
   * list of counties we INTEND to work is a roadmap, not a filter, and it does
   * not belong in a dropdown that is there to narrow what is on screen.
   */
  private async countiesInUse(organizationId?: string | null): Promise<string[]> {
    const rows = await this.prisma.surplusDetail.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        county: { not: null },
      },
      distinct: ['county'],
      select: { county: true },
      orderBy: { county: 'asc' },
    });
    return rows.map((r) => r.county!).filter(Boolean);
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
      // Heirs travel with the detail: an Estate claimant's queue, card and
      // panel all depend on whether a living heir is on file.
      include: LEAD_INCLUDE,
    });
    const ctx = await this.rowContext(organizationId);
    const all = leads.filter((l) => l.surplusDetail).map((l) => this.toRow(l, ctx));
    const feed = all.filter(
      (r) => r.grossSurplus >= SURPLUS_FLOOR && r.claimantType !== SurplusClaimantType.LIENHOLDER,
    );

    // Counted the way the board counts, on three axes that were all wrong.
    //
    // PROPERTIES, not claimants. A sale that owes two co-owners is one case
    // with one pot of money, and counting it twice made the headline disagree
    // with the row count directly under it: 74 against 47.
    //
    // LIVE ONLY. Dead is hidden on the board by default, so counting retired
    // leads in the headline describes a board nobody is looking at.
    //
    // And the money is summed PER PROPERTY. netToClaimant is the whole surplus
    // as it stands for that claimant, so adding it up across co-owners counted
    // the same pot once per person: on the live board that inflated the
    // pipeline by $594,723 across fourteen co-owned properties.
    const live = feed.filter((r) => r.stage !== SurplusStage.DEAD);
    const props = groupByProperty(live);

    return {
      openClaims: props.length,
      claimantCount: live.length,
      newSevenDays: props.filter((p: any) => p.noticeAge !== null && p.noticeAge <= 7).length,
      tierA: props.filter((p: any) => p.tier === SurplusTier.A).length,
      // Counts per work queue, so the quick filters can show what they hold
      // without the board guessing. Property counts, because clicking a chip
      // filters properties.
      queues: Object.values(SurplusQueue).reduce((acc: Record<string, number>, q) => {
        acc[q] = props.filter((p: any) => p.queue === q).length;
        return acc;
      }, {}),
      /** One pot per sale. See the note above. */
      netInPipeline: props.reduce((acc: number, p: any) => acc + (p.netToClaimant || 0), 0),
      // The two working lists, as property counts to match the chips.
      notTapped: props.filter((p: any) => p.contactStatus === 'not_tapped' && p.workScore > 0).length,
      missingChannel: props.filter((p: any) => p.channelsMissing?.length > 0 && p.workScore > 0).length,
      letterDue: props.filter((p: any) => p.letterDue).length,
      complianceBlocked: all.filter((r) => !r.compliance.clear).length,
      belowFloor: all.length - all.filter((r) => r.grossSurplus >= SURPLUS_FLOOR).length,
      total: all.length,
    };
  }

  // ─── Shaping ──────────────────────────────────────────────────────────────

  /** The per-request lookups every row reads, fetched once. */
  private async rowContext(organizationId?: string | null): Promise<RowContext> {
    const [counties, templateVersions] = await Promise.all([
      this.counties.mapFor(organizationId),
      this.templates.activeVersions(organizationId),
    ]);
    return { counties, templateVersions };
  }

  private toRow(lead: any, ctx: RowContext = {}) {
    const d = lead.surplusDetail;
    const county = d.county ? ctx.counties?.get(String(d.county).toLowerCase()) || null : null;

    const phones = [
      { number: normalizePhoneDigits(lead.sellerPhone) || '', type: d.phone1Type, dnc: d.phone1Dnc },
      { number: normalizePhoneDigits(d.phone2) || '', type: d.phone2Type, dnc: d.phone2Dnc },
      { number: normalizePhoneDigits(d.phone3) || '', type: d.phone3Type, dnc: d.phone3Dnc },
      { number: normalizePhoneDigits(d.phone4) || '', type: d.phone4Type, dnc: d.phone4Dnc },
    ].filter((p) => p.number);
    const emails = [lead.sellerEmail, d.email2].map((e) => cellText(e)).filter(Boolean);

    // Heirs come off the detail row. Shaped by the same function the heirs
    // endpoint uses, so the board and the panel cannot disagree about who is
    // callable. The counts consider only the LIVING: a dead heir cannot sign
    // either, and their share needs its own estate opened.
    const heirRows = (d.heirs || []).map((h: any) => heirRow(h));
    const livingHeirs = heirRows.filter((h: any) => !h.deceased);
    const callableHeirs = livingHeirs.filter((h: any) => h.callable);

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
      /** Where to find this county's probate filings by hand, when known. */
      courtRecordsUrl: county?.courtRecordsUrl || courtRecordsUrl(d.county),
      /**
       * What this county requires to file, off the county table. Null when
       * the county is not on the list yet, which the panel says out loud
       * rather than showing an empty section.
       */
      countyInfo: county
        ? {
            id: county.id,
            claimFormUrl: county.claimFormUrl,
            surplusListUrl: county.surplusListUrl,
            assignmentPreference: county.assignmentPreference,
            acceptedMethods: county.acceptedMethods,
            signatureRequired: county.signatureRequired,
            attorneyRequired: county.attorneyRequired,
            clerkContactName: county.clerkContactName,
            clerkContactPhone: county.clerkContactPhone,
            clerkContactEmail: county.clerkContactEmail,
            clerkAddress: county.clerkAddress,
            notes: county.notes,
            practiceRunAt: county.practiceRunAt,
            lastVerifiedAt: county.lastVerifiedAt,
            stale: county.stale,
            unknowns: county.unknowns,
          }
        : null,

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
      daysSinceSale: daysSinceSale({ saleDate: d.saleDate }),
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
      // The document set: what this claim needs, what is in hand, what is
      // missing. Computed against the claim (an estate needs the death
      // certificate; an entity its papers) so "complete" means filable.
      ...(() => {
        const checklist = this.documents.checklist(
          d.documents || [],
          {
            deceased: isDeceased(facts),
            isEntity: ENTITY_NAME.test(`${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`),
          },
          ctx.templateVersions || {},
        );
        const docs: Record<string, string> = {};
        for (const doc of d.documents || []) docs[doc.kind] = doc.status;
        return {
          documents: checklist.documents,
          docsRequired: checklist.required,
          docsMissing: checklist.missing,
          docsComplete: checklist.complete,
          // What each gated stage still needs, so the panel can say it
          // before a move is tried and the refusal never surprises anyone.
          stageBlocks: stageBlocks(facts, {
            docs,
            complianceBlocks: gate.blocks,
            docsMissing: checklist.missing,
            ...this.attorneyGate(d, { _countyRow: county }),
            submissionMethod: d.submissionMethod,
            submissionTrackingNumber: d.submissionTrackingNumber,
            countyAcknowledgedAt: d.countyAcknowledgedAt,
          }),
          // The attorney, and the rule that follows from one being engaged.
          attorney: {
            required: d.attorneyRequired ?? county?.attorneyRequired ?? null,
            requiredFrom: d.attorneyRequired != null ? 'case' : county?.attorneyRequired != null ? 'county' : null,
            name: d.attorneyName || null,
            firm: d.attorneyFirm || null,
            phone: d.attorneyPhone || null,
            email: d.attorneyEmail || null,
            source: d.attorneySource || null,
            engagedAt: d.attorneyEngagedAt || null,
            notes: d.attorneyNotes || null,
            engaged: !!(d.attorneyEngagedAt || d.attorneyName),
          },
          /** Who to contact about the claim: the attorney once one is engaged, the clerk otherwise. */
          countyContactVia: d.attorneyEngagedAt || d.attorneyName ? 'attorney' : 'clerk',
        };
      })(),

      compliance: {
        clear: gate.clear,
        blocks: gate.blocks,
        warns: gate.warns,
        rule: gate.rule,
      },

      // The name-first route, for when the address route is exhausted. Built
      // per claimant because it keys on their name and their state.
      nameSearch: nameSearchPlan({
        claimant: `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim(),
        ownerState: d.ownerMailingState || lead.propertyState,
        propertyAddress: lead.propertyAddress,
        propertyCity: lead.propertyCity,
        isEntity: ENTITY_NAME.test(`${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`),
        mailVerdict: d.mailVerdict,
      }),

      claimStatus: d.claimStatus || SurplusClaimStatus.UNKNOWN,
      claimStatusLabel: CLAIM_STATUS_LABEL[(d.claimStatus || SurplusClaimStatus.UNKNOWN) as SurplusClaimStatus],
      surplusAtNotice: d.surplusAtNotice,
      noticeRecipient: d.noticeRecipient,
      ownerMailingStreet: d.ownerMailingStreet,
      ownerMailingCity: d.ownerMailingCity,
      ownerMailingState: d.ownerMailingState,
      ownerMailingZip: d.ownerMailingZip,
      ownerAddressSource: d.ownerAddressSource,
      mailVerdict: d.mailVerdict,
      claimLedger: d.claimLedger || null,
      sourceSystem: d.sourceSystem,
      sourceCaseId: d.sourceCaseId,
      sourceUrl: d.sourceUrl,
      lastPolledAt: d.lastPolledAt,

      phones,
      emails,
      cleanPhoneCount: phones.filter((p) => !p.dnc).length,
      dncScrubbedAt: d.dncScrubbedAt,
      contactMismatch: d.contactMismatch,
      mismatchedName: d.mismatchedName,
      // Where the skip trace stands for THIS claimant. Co-claimants on one
      // address get one submission and routinely end differently, so this is
      // per person and never rolled up to the property.
      trace: traceState(d, phones.length + emails.length),

      // Who inherited, living first. The counts are what the queue and the card
      // key on; heirs is what the panel renders.
      heirs: heirRows,
      heirCount: heirRows.length,
      livingHeirCount: livingHeirs.length,
      callableHeirCount: callableHeirs.length,
      deceasedHeirCount: heirRows.length - livingHeirs.length,
      doNotCall: d.doNotCall,
      callNotes: d.callNotes || '',
      letterMailedAt: d.letterMailedAt,
      letterMailedTo: d.letterMailedTo || null,
      ...this.letterState(d),
      // Two different things, deliberately both here.
      //
      // touchDays/plannedTouches is the WEEKLY PLANNER: boxes somebody ticks to
      // pace their own callbacks. touches/lastTouchedAt is the RECORD: every
      // call placed, text sent and email sent, written by the channel that sent
      // it. The planner says what was intended, the record says what happened,
      // and merging them would let a ticked box look like a placed call.
      touchDays,
      plannedTouches: totalTouches,
      totalTouches,
      touches: lead.touchCount || 0,
      lastTouchedAt: lead.lastTouchedAt,

      // Tapped / Not Tapped, and which of the four channels have been tried.
      // Recap scheduled is tapped with a dated follow-up on the books.
      // The filing: how the package went and what the county said.
      submission: {
        method: d.submissionMethod || null,
        trackingNumber: d.submissionTrackingNumber || null,
        signatureRequired: d.submissionSignatureRequired ?? null,
        submittedAt: d.submittedAt || null,
        countyAcknowledgedAt: d.countyAcknowledgedAt || null,
        clerkContactName: d.clerkContactName || null,
        clerkStatusNote: d.clerkStatusNote || null,
        additionalDocsRequested: d.additionalDocsRequested || null,
        expectedDisbursementAt: d.expectedDisbursementAt || null,
        /** Days since the filing with no acknowledgement, for the flag. */
        daysUnacknowledged:
          d.submittedAt && !d.countyAcknowledgedAt
            ? Math.floor((Date.now() - new Date(d.submittedAt).getTime()) / 86_400_000)
            : null,
      },

      // Why it died, when it did. Kept so the board's Dead column reads as
      // a list of reasons and a re-listed case says what happened last time.
      deadReason: d.deadReason || null,
      deadReasonLabel: d.deadReason ? SURPLUS_DEAD_REASON_LABEL[d.deadReason as SurplusDeadReason] || d.deadReason : null,
      deadNote: d.deadNote || null,
      deadAt: d.deadAt || null,

      // The notary, and where the appointment stands. The packet reads the
      // document set; this is the person and the dates.
      notary: {
        name: d.notaryName || null,
        phone: d.notaryPhone || null,
        email: d.notaryEmail || null,
        source: d.notarySource || null,
        notes: d.notaryNotes || null,
        agreementSignedAt: d.notaryAgreementSignedAt,
        appointmentAt: d.notaryAppointmentAt,
        appointmentPlace: d.notaryAppointmentPlace || null,
        signedInOrderAt: d.notarySignedInOrderAt,
        /** Retention documents (fee agreement, POA) both signed: the assignment may go in the packet. */
        retentionConfirmed:
          surplusDocumentAtLeast(
            (d.documents || []).find((x: any) => x.kind === SurplusDocumentKind.FEE_AGREEMENT)?.status,
            SurplusDocumentStatus.SIGNED,
          ) &&
          surplusDocumentAtLeast(
            (d.documents || []).find((x: any) => x.kind === SurplusDocumentKind.LIMITED_POA)?.status,
            SurplusDocumentStatus.SIGNED,
          ),
      },
      tappedAt: d.tappedAt,
      contactStatus: !d.tappedAt
        ? 'not_tapped'
        : (lead.tasks || []).some((t: any) => t.dueDate)
          ? 'recap_scheduled'
          : 'tapped',
      channels: {
        called: (lead._count?.callLogs || 0) > 0,
        texted: (lead._count?.messages || 0) > 0,
        emailed: (lead._count?.emails || 0) > 0,
        lettered: !!d.letterMailedAt,
      },
      channelsMissing: CHANNELS.filter((c) => {
        const tried = {
          called: (lead._count?.callLogs || 0) > 0,
          texted: (lead._count?.messages || 0) > 0,
          emailed: (lead._count?.emails || 0) > 0,
          lettered: !!d.letterMailedAt,
        };
        return !tried[c];
      }),
      credibilitySentAt: d.credibilitySentAt,
      credibilityChannels: d.credibilityChannels ? String(d.credibilityChannels).split(',') : [],

      // The next thing somebody has committed to doing on this claimant, and
      // whether it has slipped. Open tasks only, soonest first.
      nextTask: lead.tasks?.[0]
        ? { id: lead.tasks[0].id, title: lead.tasks[0].title, dueDate: lead.tasks[0].dueDate }
        : null,
      openTaskCount: lead.tasks?.length || 0,
      overdueTaskCount: (lead.tasks || []).filter(
        (t: any) => t.dueDate && new Date(t.dueDate).getTime() < Date.now(),
      ).length,

      createdAt: lead.createdAt,
      ...this.workRank(d, facts, phones),
      ...this.queueOf(
        d,
        lead,
        phones,
        traceState(d, phones.length + emails.length),
        livingHeirs.length,
        callableHeirs.length,
      ),
    };
  }

  /**
   * The letter history and where the cadence stands.
   *
   * Due means: nobody has replied, there is an address to write to, and
   * either no letter has gone out or the last one is older than the file's
   * cadence. Escalate means the course's rule: after three unanswered
   * standard letters, the next one goes Priority or FedEx so it is actually
   * opened.
   */
  private letterState(d: any) {
    const letters = ((d.letters || []) as any[]).map((l) => ({
      id: l.id,
      mailedAt: l.mailedAt,
      recipientName: l.recipientName || null,
      address: l.address || null,
      mailType: l.mailType || 'standard',
      trackingNumber: l.trackingNumber || null,
      templateKind: l.templateKind || null,
      templateVersion: l.templateVersion ?? null,
      heirId: l.heirId || null,
      note: l.note || null,
    }));
    const cadence = d.letterCadenceDays || DEFAULT_LETTER_CADENCE_DAYS;
    const last = letters[0]?.mailedAt ? new Date(letters[0].mailedAt) : null;
    const dueAt = last ? new Date(last.getTime() + cadence * 86_400_000) : null;
    const hasAddress = !!(d.ownerMailingStreet || d.letterMailedTo);
    const replied = !!d.tappedAt;
    const standardUnanswered = replied ? 0 : letters.filter((l) => l.mailType === 'standard').length;
    return {
      letters,
      letterCount: letters.length,
      letterCadenceDays: cadence,
      letterDueAt: dueAt,
      letterDue: !replied && hasAddress && !d.doNotCall && (!last || dueAt!.getTime() <= Date.now()),
      escalateMail: standardUnanswered >= LETTER_ESCALATE_AFTER,
    };
  }

  /**
   * Which work queue this claimant is in, and why. Computed per request like
   * workScore, so a rule change lands on the next page load rather than needing
   * a backfill over every row.
   */
  private queueOf(
    d: any,
    lead: any,
    phones: { dnc?: string | null }[],
    trace: { state: string },
    livingHeirCount = 0,
    callableHeirCount = 0,
  ) {
    const f = {
      claimStatus: d.claimStatus,
      cleanPhoneCount: phones.filter((p) => !p.dnc).length,
      doNotCall: d.doNotCall,
      isEntity: ENTITY_NAME.test(`${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`),
      traceState: trace.state,
      mailVerdict: d.mailVerdict,
      ownerMailingStreet: d.ownerMailingStreet,
      // A dead claimant cannot sign, so the queue asks for heirs before it asks
      // for a phone number.
      isDeceased: !!d.deceased || !!d.heirsRequired,
      livingHeirCount,
      callableHeirCount,
      letterMailed: !!d.letterMailedAt,
    };
    const queue = queueOf(f);
    return { queue, queueLabel: SURPLUS_QUEUE_LABEL[queue], queueReason: queueReason(f) };
  }

  /**
   * The call-now ranking. Computed here rather than stored so a weighting
   * change takes effect on the next page load instead of needing a backfill.
   */
  private workRank(
    d: any,
    facts: Parameters<typeof netToClaimant>[0],
    phones: { dnc?: string | null }[],
  ) {
    const wf = {
      claimStatus: d.claimStatus,
      netToClaimant: netToClaimant(facts),
      cleanPhoneCount: phones.filter((p) => !p.dnc).length,
      mailVerdict: d.mailVerdict,
      daysRemaining: daysRemaining(facts),
      contactMismatch: d.contactMismatch,
      doNotCall: d.doNotCall,
    };
    return { workScore: workScore(wf), workReason: workReason(wf) };
  }
}

/**
 * Collapse per-claimant lead rows into one entry per subject property.
 *
 * A group is a CASE, not an address: two parcels can share a street line
 * ("0 HARDEE ST" is a placeholder the tax roll reuses), and two separate sales
 * of the same parcel in different years are two different pots of money. The
 * case number is the thing that identifies one surplus, with the parcel and
 * then the address as fallbacks for sources that ship no case number.
 *
 * Shared facts (the property, the money, the clock, the claim status) come off
 * the case and are identical across its claimants, so they are lifted to the
 * group. Per-person facts (phones, mismatch flags, touches) stay on each
 * claimant and are worked in the panel.
 */
export function groupByProperty(rows: any[]): any[] {
  const norm = (v: any) => String(v || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const byKey = new Map<string, any[]>();

  for (const r of rows) {
    const key =
      norm(r.county) + '|' + (norm(r.caseNumber) || norm(r.parcelId) || norm(r.address));
    byKey.set(key, [...(byKey.get(key) || []), r]);
  }

  return [...byKey.entries()].map(([key, members]) => {
    // The best-ranked claimant leads the group: it is the one that decides where
    // the property sorts, and the one whose reason explains the placement.
    const ranked = [...members].sort((a, b) => b.workScore - a.workScore);
    const head = ranked[0];
    return {
      key,
      // ── Shared: the case ──
      county: head.county,
      caseNumber: head.caseNumber,
      parcelId: head.parcelId,
      address: head.address,
      city: head.city,
      state: head.state,
      zip: head.zip,
      sourceUrl: head.sourceUrl,
      sourceSystem: head.sourceSystem,
      lastPolledAt: head.lastPolledAt,

      // ── Shared: where the notice went ──
      noticeRecipient: head.noticeRecipient,
      ownerMailingStreet: head.ownerMailingStreet,
      ownerMailingCity: head.ownerMailingCity,
      ownerMailingState: head.ownerMailingState,
      ownerMailingZip: head.ownerMailingZip,
      ownerAddressSource: head.ownerAddressSource,

      // ── Shared: the money and the clock ──
      grossSurplus: head.grossSurplus,
      surplusAtNotice: head.surplusAtNotice,
      netToClaimant: head.netToClaimant,
      estFee: head.estFee,
      saleDate: head.saleDate,
      daysSinceSale: head.daysSinceSale,
      noticeDate: head.noticeDate,
      noticeConfirmed: head.noticeConfirmed,
      daysRemaining: head.daysRemaining,
      windowElapsedPct: head.windowElapsedPct,
      lienWindowOpen: head.lienWindowOpen,

      // ── Shared: how the case stands ──
      claimStatus: head.claimStatus,
      claimStatusLabel: head.claimStatusLabel,
      mailVerdict: head.mailVerdict,
      claimLedger: head.claimLedger,
      tier: head.tier,
      dripTrack: head.dripTrack,
      surplusType: head.surplusType,
      fundLocation: head.fundLocation,
      compliance: head.compliance,

      // The property sorts on its best claimant, and says why.
      workScore: head.workScore,
      workReason: head.workReason,

      // ── Per person ──
      claimants: ranked,
      claimantCount: ranked.length,
      /** Names for the card, so the group reads as one property with N owners. */
      claimantNames: ranked.map((m) => m.claimant),
      /** Rolled up so the card can show contact state without opening. */
      anyContactable: ranked.some((m) => m.cleanPhoneCount > 0),
      anyMismatch: ranked.some((m) => m.contactMismatch),
      /** Claimants nothing has been submitted for. Distinct from "no numbers". */
      untracedCount: ranked.filter((m) => m.trace?.state === 'never').length,
      /** How many claimants have had a letter, and the most recent date, for the card. */
      letterMailedCount: ranked.filter((m: any) => m.letterMailedAt).length,
      letterCount: ranked.reduce((n: number, m: any) => n + (m.letterCount || 0), 0),
      letterDue: ranked.some((m: any) => m.letterDue && m.workScore > 0),
      escalateMail: ranked.some((m: any) => m.escalateMail),
      letterMailedAt: ranked
        .map((m: any) => m.letterMailedAt)
        .filter(Boolean)
        .sort()
        .pop() || null,
      // Summed and maxed across the claimants, since the property is worked as
      // one thing even though each claimant is contacted separately.
      touches: ranked.reduce((n: number, m: any) => n + (m.touches || 0), 0),
      lastTouchedAt: ranked
        .map((m: any) => m.lastTouchedAt)
        .filter(Boolean)
        .sort()
        .pop() || null,
      // Contact state rolled up: the property is tapped if anyone on it has
      // replied, and a channel counts as tried if it was tried on anyone.
      contactStatus: ranked
        .map((m: any) => m.contactStatus || 'not_tapped')
        .sort((a: string, b: string) => (CONTACT_RANK[b] || 0) - (CONTACT_RANK[a] || 0))[0],
      tappedAt: ranked.map((m: any) => m.tappedAt).filter(Boolean).sort().pop() || null,
      channels: CHANNELS.reduce((acc: Record<string, boolean>, c) => {
        acc[c] = ranked.some((m: any) => m.channels?.[c]);
        return acc;
      }, {}),
      channelsMissing: CHANNELS.filter((c) => !ranked.some((m: any) => m.channels?.[c])),
      credibilitySentAt: ranked.map((m: any) => m.credibilitySentAt).filter(Boolean).sort().pop() || null,
      // The soonest open task across the claimants, so the board can sort on
      // what is due next and flag what has slipped.
      nextTask: ranked
        .map((m: any) => m.nextTask)
        .filter((t: any) => t && t.dueDate)
        .sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0] || null,
      openTaskCount: ranked.reduce((n: number, m: any) => n + (m.openTaskCount || 0), 0),
      overdueTaskCount: ranked.reduce((n: number, m: any) => n + (m.overdueTaskCount || 0), 0),
      // A property takes its most actionable claimant's queue, since that is
      // the work it represents: one callable owner makes the house callable
      // even when their co-owner is a dead end.
      //
      // Ranked by QUEUE, not by work score. Those are different orderings and
      // the difference showed on 1624 W 35th St: a deceased claimant with no
      // heirs on file outranked her co-owner whose son had just been found with
      // four numbers, so the card read "Find the heirs, nobody can sign yet"
      // about a house somebody could ring that morning.
      ...(() => {
        const best = ranked.reduce((a: any, b: any) =>
          (SURPLUS_QUEUE_RANK[b.queue as SurplusQueue] ?? 0) >
          (SURPLUS_QUEUE_RANK[a.queue as SurplusQueue] ?? 0)
            ? b
            : a,
        );
        return {
          queue: best.queue,
          queueLabel: best.queueLabel,
          queueReason: best.queueReason,
        };
      })(),
      /** How many claimants sit in each queue, for the card. */
      queueCounts: ranked.reduce((acc: Record<string, number>, m: any) => {
        acc[m.queue] = (acc[m.queue] || 0) + 1;
        return acc;
      }, {}),
      allDeceased: ranked.every((m) => m.isDeceased),
      anyDeceased: ranked.some((m) => m.isDeceased),
      // Heirs rolled up across the claimants, so a card can say "2 deceased, 2
      // heirs" instead of leaving somebody to open the panel to find out there
      // is nobody alive to ring.
      heirCount: ranked.reduce((n: number, m: any) => n + (m.heirCount || 0), 0),
      livingHeirCount: ranked.reduce((n: number, m: any) => n + (m.livingHeirCount || 0), 0),
      callableHeirCount: ranked.reduce((n: number, m: any) => n + (m.callableHeirCount || 0), 0),
      /**
       * A dead claimant with nobody on file to inherit. The state that used to
       * be invisible: the card showed "no number" and the queue said name
       * search, when the actual next step is finding the probate case.
       */
      needsHeirs: ranked.some((m: any) => m.isDeceased && !(m.livingHeirCount || 0)),
      // The stage the property is furthest along on.
      stage: head.stage,
    };
  });
}
