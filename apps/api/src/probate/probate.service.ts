import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadSource, ProbateWorkStatus } from '@fast-homes/shared';
import { countyForCity, stateForCity } from '../foreclosures/foreclosure-scoring.util';
import { ProbateLeadInput } from './probate.types';
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
}
