import { Injectable, Inject, forwardRef, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { MessagesService } from '../messages/messages.service';
import { DripService } from '../drip/drip.service';
import { CampaignEnrollmentService } from '../campaigns/campaign-enrollment.service';
import { PhotosService } from '../photos/photos.service';
import { SellerPortalService } from '../seller-portal/seller-portal.service';
import { RentCastService } from '../comps/rentcast.service';
import { CompsService } from '../comps/comps.service';
import { AttomService } from '../comps/attom.service';
import { ReapiService } from '../comps/reapi.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { LeadStatus, LeadSource, formatPhoneNumber, toTitleCase } from '@fast-homes/shared';
import { Prisma } from '@prisma/client';
import { enrichAddressFromZip, cleanStreetAddress, lookupCityStateFromZip } from '../webhooks/address-parser';
import * as XLSX from 'xlsx';

const INITIAL_OUTREACH_DELAY_MS = 60_000; // 1 minute
const DEMO_OUTREACH_DELAY_MS = 3_000;     // 3 seconds in demo mode

// Convert lot size: if value > 10 it's almost certainly sqft, convert to acres
function normalizeLotSize(raw: number | undefined): number | undefined {
  if (!raw) return undefined;
  return raw > 100 ? parseFloat((raw / 43560).toFixed(4)) : raw;
}

// Get most recent tax assessed value from RentCast taxAssessments map
function latestTaxAssessment(taxAssessments?: Record<string, any>): number | undefined {
  if (!taxAssessments) return undefined;
  const years = Object.keys(taxAssessments).sort().reverse();
  return years.length ? taxAssessments[years[0]]?.value : undefined;
}


@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private prisma: PrismaService,
    private scoringService: ScoringService,
    @Inject(forwardRef(() => MessagesService))
    private messagesService: MessagesService,
    @Inject(forwardRef(() => DripService))
    private dripService: DripService,
    @Inject(forwardRef(() => CampaignEnrollmentService))
    private campaignEnrollmentService: CampaignEnrollmentService,
    @Optional() private photosService: PhotosService,
    @Optional() private sellerPortalService: SellerPortalService,
    private rentCastService: RentCastService,
    private compsService: CompsService,
    private attomService: AttomService,
    private reapiService: ReapiService,
    private pipelineService: PipelineService,
  ) {}

  /**
   * Create a new lead
   */
  /** Recompute and persist tier for a lead. Call after ARV or score changes. */
  async refreshTier(leadId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return;
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { tier: this.computeTier(lead) },
    });
  }

  /** Compute deal tier from lead data. Mirrors client-side computeTier(). */
  private computeTier(lead: { status: string; scoreBand: string; totalScore: number; arv?: number | null; askingPrice?: number | null }): number {
    if (['DEAD', 'CLOSED_LOST'].includes(lead.status)) return 3;
    const mao = lead.arv ? Math.round(lead.arv * 0.7 - 40000 - 15000) : null;
    const pencils = mao !== null && lead.askingPrice != null && mao >= lead.askingPrice;
    if ((lead.scoreBand === 'STRIKE_ZONE' || lead.scoreBand === 'HOT') && pencils) return 1;
    if (lead.scoreBand === 'DEAD_COLD' && lead.totalScore <= 2 && !pencils) return 3;
    return 2;
  }

  async createLead(data: {
    source: LeadSource;
    propertyAddress: string;
    propertyCity: string;
    propertyState: string;
    propertyZip: string;
    sellerFirstName: string;
    sellerLastName: string;
    sellerPhone: string;
    sellerEmail?: string;
    propertyType?: string;
    bedrooms?: number;
    bathrooms?: number;
    sqft?: number;
    yearBuilt?: number;
    lotSize?: number;
    timeline?: number;
    askingPrice?: number;
    conditionLevel?: string;
    distressSignals?: string[];
    ownershipStatus?: string;
    assignedToUserId?: string;
    sourceMetadata?: any;
    organizationId?: string;
  }) {
    // Enrich address — fill in missing city/state from zip lookup if needed
    const enriched = await enrichAddressFromZip({
      propertyAddress: data.propertyAddress || '',
      propertyCity: data.propertyCity || '',
      propertyState: data.propertyState || '',
      propertyZip: data.propertyZip || '',
    });
    data.propertyAddress = enriched.propertyAddress;
    data.propertyCity = enriched.propertyCity;
    data.propertyState = enriched.propertyState;
    data.propertyZip = enriched.propertyZip;

    // Initial scoring
    const scoringResult = await this.scoringService.scoreLead({
      timeline: data.timeline,
      askingPrice: data.askingPrice,
      conditionLevel: data.conditionLevel,
      distressSignals: data.distressSignals,
      ownershipStatus: data.ownershipStatus,
    });

    // Always store phone in E.164 format so inbound webhook lookups match
    if (data.sellerPhone) {
      data.sellerPhone = formatPhoneNumber(data.sellerPhone);
    }

    // Normalize names to title case (e.g. "JOHN DOE" → "John Doe")
    if (data.sellerFirstName) {
      data.sellerFirstName = toTitleCase(data.sellerFirstName);
    }
    if (data.sellerLastName) {
      data.sellerLastName = toTitleCase(data.sellerLastName);
    }

    const lead = await this.prisma.lead.create({
      data: {
        ...data,
        challengeScore: scoringResult.challengeScore,
        authorityScore: scoringResult.authorityScore,
        moneyScore: scoringResult.moneyScore,
        priorityScore: scoringResult.priorityScore,
        totalScore: scoringResult.totalScore,
        scoreBand: scoringResult.scoreBand,
        abcdFit: scoringResult.abcdFit,
        scoringRationale: scoringResult.rationale,
        lastScoredAt: new Date(),
        // Pre-populate CAMP flags
        campPriorityComplete: data.timeline != null,
        campMoneyComplete: data.askingPrice != null,
        campChallengeComplete: data.conditionLevel != null,
        campAuthorityComplete: data.ownershipStatus != null,
        // Pipeline tracking
        lastTouchedAt: new Date(),
        touchCount: 0,
        daysInStage: 0,
        // Computed tier for server-side filtering/sorting
        tier: this.computeTier({
          status: 'NEW',
          scoreBand: scoringResult.scoreBand,
          totalScore: scoringResult.totalScore,
          askingPrice: data.askingPrice,
        }),
      },
    });

    // Log activity
    await this.prisma.activity.create({
      data: {
        leadId: lead.id,
        type: 'LEAD_CREATED',
        description: `Lead created from ${data.source}`,
        metadata: { source: data.source },
      },
    });

    // Schedule automatic initial outreach
    if (lead.autoRespond && !lead.doNotContact) {
      this.scheduleInitialOutreach(lead.id);
    }

    // Non-blocking photo fetch from all sources (Street View + SerpAPI)
    if (this.photosService) {
      console.log(`📍 Lead created: ${lead.id} - ${data.propertyAddress}. Fetching photos...`);
      this.photosService.fetchAllPhotos(lead.id).catch((err) => {
        console.log(`⚠️ Photo fetch failed for ${lead.id}: ${err.message}`);
      });
      // MLS listing status check disabled — RentCast/Zillow data is unreliable
      // and was producing false positives on almost every lead. Re-enable once
      // a reliable data source is identified.
    } else {
      console.log(`📍 Lead created: ${lead.id} - ${data.propertyAddress}. No PhotosService available.`);
    }

    // Auto-create seller portal (non-blocking)
    if (this.sellerPortalService) {
      this.sellerPortalService.createPortal(lead.id).catch((err) => {
        this.logger.error(`Seller portal creation failed for ${lead.id}: ${err.message}`);
      });
    }

    // Auto-populate property details from RentCast (non-blocking)
    this.autoPopulatePropertyDetails(lead.id, data).catch((err) => {
      this.logger.error(`Property details auto-population failed for ${lead.id}: ${err.message}`);
    });

    return lead;
  }

  /**
   * Schedule the initial outreach message after a short delay.
   * Uses setImmediate in demo mode (next tick) and a short setTimeout otherwise.
   * Kept intentionally short — Railway restarts kill long timers.
   */
  private async scheduleInitialOutreach(leadId: string) {
    let delay = INITIAL_OUTREACH_DELAY_MS;
    try {
      const settings = await this.prisma.dripSettings.findUnique({ where: { id: 'default' } });
      if (settings?.demoMode) {
        delay = DEMO_OUTREACH_DELAY_MS;
      }
    } catch {
      // Use default delay
    }

    this.logger.log(`Scheduling initial outreach for lead ${leadId} in ${delay}ms`);

    const fire = async () => {
      try {
        await this.messagesService.sendInitialOutreach(leadId);
        // Campaign auto-enrollment now happens on first inbound reply
        // (in handleInboundMessage) — NOT on lead creation. Enrolling here
        // caused 3+ campaign messages to fire immediately alongside the
        // initial outreach, spamming the seller.
      } catch (error) {
        this.logger.error(`Initial outreach failed for lead ${leadId}: ${error.message}`);
      }
    };

    if (delay <= 5000) {
      // Demo mode or very short delay — fire on next event loop tick
      setImmediate(fire);
    } else {
      setTimeout(fire, delay);
    }
  }

  /**
   * Auto-populate property details. Primary source is REAPI. RentCast is a
   * fallback if REAPI is unconfigured or returns nothing. ATTOM is no longer
   * called on the initial pull — the user must explicitly trigger it from
   * the Comps tab if they want ATTOM data for a specific lead.
   */
  private async autoPopulatePropertyDetails(
    leadId: string,
    data: { propertyAddress: string; propertyCity: string; propertyState: string; propertyZip: string },
  ) {
    if (!data.propertyAddress || !data.propertyCity) return;

    const fullAddress = `${data.propertyAddress}, ${data.propertyCity}, ${data.propertyState} ${data.propertyZip}`;
    const addressObj = {
      street: data.propertyAddress,
      city: data.propertyCity,
      state: data.propertyState,
      zip: data.propertyZip,
    };
    this.logger.log(`Looking up property details for lead ${leadId}: ${fullAddress}`);

    let enrichedFromReapi = false;
    if (this.reapiService.isConfigured) {
      try {
        const reapiResult = await this.reapiService.enrichLead(leadId, addressObj, { forceRefresh: true });
        if (reapiResult) {
          enrichedFromReapi = true;
          this.logger.log(`Property details populated from REAPI for lead ${leadId}`);
        } else {
          this.logger.warn(`REAPI returned no data for lead ${leadId} — falling back to RentCast`);
        }
      } catch (err) {
        this.logger.warn(`REAPI enrichment failed for lead ${leadId} — falling back to RentCast: ${(err as Error).message}`);
      }
    }

    if (!enrichedFromReapi) {
      const property = await this.rentCastService.getPropertyDetails(fullAddress);

      if (property) {
        const lead = await this.prisma.lead.findUnique({
          where: { id: leadId },
          select: { bedrooms: true, bathrooms: true, sqft: true, propertyType: true, yearBuilt: true, lotSize: true },
        });

        const updates: Record<string, any> = {};
        if (!lead?.bedrooms && property.bedrooms) updates.bedrooms = property.bedrooms;
        if (!lead?.bathrooms && property.bathrooms) updates.bathrooms = property.bathrooms;
        if (!lead?.sqft && property.squareFootage) updates.sqft = property.squareFootage;
        if (!lead?.propertyType && property.propertyType) updates.propertyType = property.propertyType;
        if (!lead?.yearBuilt && property.yearBuilt) updates.yearBuilt = property.yearBuilt;
        if (property.lotSize) updates.lotSize = normalizeLotSize(property.lotSize);
        if (property.lastSaleDate) updates.lastSaleDate = new Date(property.lastSaleDate);
        if (property.lastSalePrice) updates.lastSalePrice = property.lastSalePrice;
        const taxVal = latestTaxAssessment((property as any).taxAssessments);
        if (taxVal) updates.taxAssessedValue = taxVal;
        if ((property as any).ownerOccupied != null) updates.ownerOccupied = (property as any).ownerOccupied;
        if (property.hoa?.fee) updates.hoaFee = property.hoa.fee;

        if (Object.keys(updates).length > 0) {
          await this.prisma.lead.update({ where: { id: leadId }, data: updates });
          this.logger.log(`Property details auto-populated from RentCast for lead ${leadId}: ${JSON.stringify(updates)}`);

          await this.prisma.activity.create({
            data: {
              leadId,
              type: 'FIELD_UPDATED',
              description: `Property details auto-populated from public records (${Object.keys(updates).join(', ')})`,
              metadata: { source: 'rentcast', fields: Object.keys(updates) },
            },
          });
        }
      } else {
        this.logger.warn(`Property details not found for lead ${leadId} (REAPI + RentCast both empty)`);
        await this.prisma.activity.create({
          data: {
            leadId,
            type: 'FIELD_UPDATED',
            description: 'Property details not found — manual entry or ATTOM/REAPI refresh may be needed',
          },
        });
      }
    }

    // Fetch comps now that we have property details. Default provider is REAPI
    // (set via lead.compsProvider default). User can still override from UI.
    await this.fetchCompsForLead(leadId);
  }

  /**
   * Fetch comps for a lead using the CompsService fallback chain.
   */
  async fetchCompsForLead(leadId: string): Promise<void> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        propertyZip: true,
        bedrooms: true,
        sqft: true,
      },
    });
    if (!lead) return;

    if (!lead.bedrooms && !lead.sqft) {
      this.logger.warn(`Missing property details for lead ${leadId}, skipping comps fetch`);
      return;
    }

    this.logger.log(`Fetching comps for lead ${leadId}`);

    try {
      // New leads always fetch from REAPI. ATTOM/RentCast are manual-only
      // via the Comps tab toggle. Passing 'reapi' explicitly (instead of
      // falling through to 'auto') also prevents the lead's compsProvider
      // from being overwritten to 'auto'.
      const result = await this.compsService.fetchComps(leadId, {
        street: lead.propertyAddress,
        city: lead.propertyCity,
        state: lead.propertyState,
        zip: lead.propertyZip,
      }, { preferSource: 'reapi' });

      this.logger.log(
        `Comps fetched for lead ${leadId}: ${result.compsCount} comps, ARV: $${result.arv.toLocaleString()} (${result.source})`,
      );

      // Recompute tier now that ARV is set
      await this.refreshTier(leadId);
    } catch (error) {
      this.logger.error(`Comps fetch failed for lead ${leadId}: ${error.message}`);
    }
  }

  /**
   * Refresh property details for an existing lead. Prefers REAPI; falls back
   * to RentCast if REAPI is unconfigured or returns no data.
   */
  async refreshPropertyDetails(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        propertyZip: true,
      },
    });
    if (!lead) throw new Error('Lead not found');

    const addressObj = {
      street: lead.propertyAddress,
      city: lead.propertyCity,
      state: lead.propertyState,
      zip: lead.propertyZip,
    };

    // Try REAPI first (forceRefresh bypasses 24h cache)
    if (this.reapiService.isConfigured) {
      try {
        const reapiResult = await this.reapiService.enrichLead(leadId, addressObj, { forceRefresh: true });
        if (reapiResult) {
          return {
            success: true,
            source: 'reapi',
            message: 'Property details refreshed from REAPI',
          };
        }
      } catch (err) {
        this.logger.warn(`REAPI refresh failed for lead ${leadId} — falling back to RentCast: ${(err as Error).message}`);
      }
    }

    // Fallback: RentCast
    const address = `${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}`;
    const property = await this.rentCastService.getPropertyDetails(address);

    if (!property) {
      return { success: false, message: 'Property details not found (REAPI + RentCast both empty)' };
    }

    const updates: Record<string, any> = {};
    if (property.bedrooms) updates.bedrooms = property.bedrooms;
    if (property.bathrooms) updates.bathrooms = property.bathrooms;
    if (property.squareFootage) updates.sqft = property.squareFootage;
    if (property.propertyType) updates.propertyType = property.propertyType;
    if (property.yearBuilt) updates.yearBuilt = property.yearBuilt;
    if (property.lotSize) updates.lotSize = normalizeLotSize(property.lotSize);
    if (property.lastSaleDate) updates.lastSaleDate = new Date(property.lastSaleDate);
    if (property.lastSalePrice) updates.lastSalePrice = property.lastSalePrice;
    const taxVal = latestTaxAssessment((property as any).taxAssessments);
    if (taxVal) updates.taxAssessedValue = taxVal;
    if ((property as any).ownerOccupied != null) updates.ownerOccupied = (property as any).ownerOccupied;
    if (property.hoa?.fee) updates.hoaFee = property.hoa.fee;

    if (Object.keys(updates).length > 0) {
      await this.prisma.lead.update({
        where: { id: leadId },
        data: updates,
      });

      await this.prisma.activity.create({
        data: {
          leadId,
          type: 'FIELD_UPDATED',
          description: `Property details refreshed from RentCast (${Object.keys(updates).join(', ')})`,
          metadata: { source: 'rentcast', fields: Object.keys(updates) },
        },
      });
    }

    return {
      success: true,
      source: 'rentcast',
      details: updates,
      message: `Property details refreshed from RentCast: ${Object.keys(updates).join(', ')}`,
    };
  }

  /**
   * Get lead by ID
   */
  async getLead(id: string) {
    return this.prisma.lead.findUnique({
      where: { id },
      include: {
        assignedTo: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        comps: {
          orderBy: { distance: 'asc' },
        },
        tasks: {
          orderBy: { createdAt: 'desc' },
        },
        notes: {
          orderBy: { createdAt: 'desc' },
          include: { user: true },
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { user: true },
        },
        contract: true,
        offers: {
          orderBy: { createdAt: 'desc' },
        },
        callLogs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        sellerPortal: true,
        dripSequence: true,
      },
    });
  }

  /**
   * List leads with filters
   */
  async listLeads(filters: {
    source?: LeadSource;
    status?: LeadStatus;
    scoreBand?: string;
    assignedToUserId?: string;
    zip?: string;
    minScore?: number;
    maxScore?: number;
    search?: string;
    createdAfter?: string;
    createdBefore?: string;
    page?: number;
    limit?: number;
    organizationId?: string;
    tier?: number;
    propertyState?: string;
    staleMinDays?: number;
    arvFilter?: 'has' | 'none';
    showInactive?: boolean;
    inDrip?: 'active';
    sort?: string;
    dir?: 'asc' | 'desc';
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const skip = (page - 1) * limit;

    // Base WHERE scoped to org (used for aggregate counts)
    const baseWhere: Prisma.LeadWhereInput = {};
    if (filters.organizationId) baseWhere.organizationId = filters.organizationId;

    // Full WHERE including user filters
    const where: Prisma.LeadWhereInput = { ...baseWhere };

    if (filters.source) where.source = filters.source;
    if (filters.status) where.status = filters.status;
    if (filters.scoreBand) where.scoreBand = filters.scoreBand as any;
    if (filters.assignedToUserId === 'none') {
      where.assignedToUserId = null;
    } else if (filters.assignedToUserId) {
      where.assignedToUserId = filters.assignedToUserId;
    }
    if (filters.zip) where.propertyZip = filters.zip;
    if (filters.minScore || filters.maxScore) {
      const scoreFilter: Prisma.IntFilter<'Lead'> = {};
      if (filters.minScore) scoreFilter.gte = filters.minScore;
      if (filters.maxScore) scoreFilter.lte = filters.maxScore;
      where.totalScore = scoreFilter;
    }

    if (filters.search) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { propertyAddress: { contains: filters.search, mode: 'insensitive' } },
            { sellerFirstName: { contains: filters.search, mode: 'insensitive' } },
            { sellerLastName: { contains: filters.search, mode: 'insensitive' } },
            { sellerPhone: { contains: filters.search, mode: 'insensitive' } },
            { sellerEmail: { contains: filters.search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    if (filters.createdAfter || filters.createdBefore) {
      const dateFilter: Prisma.DateTimeFilter<'Lead'> = {};
      if (filters.createdAfter) dateFilter.gte = new Date(filters.createdAfter);
      if (filters.createdBefore) dateFilter.lte = new Date(filters.createdBefore);
      where.createdAt = dateFilter;
    }

    // New filters
    if (filters.tier) where.tier = filters.tier;
    if (filters.propertyState) where.propertyState = { equals: filters.propertyState, mode: 'insensitive' };

    // Hide inactive (DEAD/CLOSED_WON/CLOSED_LOST) by default unless showInactive or specific status filter
    if (!filters.showInactive && !filters.status) {
      where.status = { notIn: ['DEAD', 'CLOSED_WON', 'CLOSED_LOST'] };
    }

    if (filters.staleMinDays) {
      const cutoff = new Date(Date.now() - filters.staleMinDays * 24 * 3600000);
      where.lastTouchedAt = { lt: cutoff };
    }

    if (filters.arvFilter === 'has') where.arv = { gt: 0 };
    if (filters.arvFilter === 'none') {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        { OR: [{ arv: null }, { arv: 0 }] },
      ];
    }

    if (filters.inDrip === 'active') {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { dripSequence: { status: 'ACTIVE' } },
            { campaignEnrollments: { some: { status: 'ACTIVE' } } },
          ],
        },
      ];
    }

    // Dynamic sort
    const dir = filters.dir || 'asc';
    const sortMap: Record<string, Prisma.LeadOrderByWithRelationInput[]> = {
      tier:     [{ tier: dir }, { totalScore: 'desc' }],
      score:    [{ totalScore: dir }, { createdAt: 'desc' }],
      arv:      [{ arv: dir }, { createdAt: 'desc' }],
      // MAO is monotonic with ARV (MAO = ARV × 0.7 − $55k), so ARV order is
      // identical to MAO order for non-null ARV rows.
      mao:      [{ arv: dir }, { createdAt: 'desc' }],
      asking:   [{ askingPrice: dir }, { createdAt: 'desc' }],
      // Spread isn't a stored column. We order by ARV as a rough proxy for
      // the DB query, then the service re-sorts the returned page in memory
      // by true (MAO − Asking). This keeps the top-of-page correct for the
      // user without requiring a full-org computed scan.
      spread:   [{ arv: dir }, { createdAt: 'desc' }],
      // Stage groups by status; Prisma orders enum strings alphabetically,
      // which isn't the pipeline's semantic order but does cluster same-stage
      // leads together (the actual UX goal when a user clicks "Stage").
      stage:    [{ status: dir }, { totalScore: 'desc' }],
      created:  [{ createdAt: dir }],
      touched:  [{ lastTouchedAt: dir }, { createdAt: 'desc' }],
      touches:  [{ touchCount: dir }, { createdAt: 'desc' }],
      address:  [{ propertyAddress: dir }],
    };
    const orderBy = sortMap[filters.sort || 'tier'] || sortMap.tier;

    // Chip counts must reflect "how many leads would I see if I added this
    // chip to my current selection," not "how many exist in the database."
    // So: for each chip group, clone the full filter-applied `where` and drop
    // that group's own key. Inactive-hiding, search, tier/band/other filters
    // all carry through.
    const whereForTier: Prisma.LeadWhereInput = { ...where };
    delete (whereForTier as any).tier;
    const whereForBand: Prisma.LeadWhereInput = { ...where };
    delete (whereForBand as any).scoreBand;

    // "In Drip (N)" chip: count leads in active drip, ignoring the inDrip
    // filter itself. Mirrors the AND clause in the inDrip filter application
    // above. Built as a fresh object so we don't mutate the user's filter.
    const whereForDripActive: Prisma.LeadWhereInput = {
      ...where,
      AND: [
        ...(Array.isArray(where.AND)
          ? (where.AND as Prisma.LeadWhereInput[]).filter((c) => {
              // strip the inDrip clause we added earlier (the OR on
              // dripSequence/campaignEnrollments); everything else stays.
              const or = (c as any).OR;
              if (!Array.isArray(or)) return true;
              const looksLikeDrip =
                or.length === 2 &&
                or.some((x: any) => x?.dripSequence?.status === 'ACTIVE') &&
                or.some((x: any) => x?.campaignEnrollments?.some?.status === 'ACTIVE');
              return !looksLikeDrip;
            })
          : where.AND
          ? [where.AND]
          : []),
        {
          OR: [
            { dripSequence: { status: 'ACTIVE' } },
            { campaignEnrollments: { some: { status: 'ACTIVE' } } },
          ],
        },
      ],
    };

    // Run data query, count, and aggregate counts in parallel
    const [leadsRaw, total, tierGroups, bandGroups, dripActiveCount, inactiveCount, stateRows] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: {
          assignedTo: true,
          // List view v2 renders an envelope icon on rows in an active drip.
          // We only need a lightweight shape — campaign name isn't rendered
          // in the List cell (just presence), so this stays cheap.
          dripSequence: {
            select: { id: true, status: true, currentStep: true },
          },
          campaignEnrollments: {
            where: { status: 'ACTIVE' },
            select: { id: true, status: true, campaignId: true },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.lead.count({ where }),
      this.prisma.lead.groupBy({ by: ['tier'], where: whereForTier, _count: true }),
      this.prisma.lead.groupBy({ by: ['scoreBand'], where: whereForBand, _count: true }),
      this.prisma.lead.count({ where: whereForDripActive }),
      this.prisma.lead.count({
        where: { ...baseWhere, status: { in: ['DEAD', 'CLOSED_WON', 'CLOSED_LOST'] } },
      }),
      this.prisma.lead.findMany({
        where: baseWhere,
        select: { propertyState: true },
        distinct: ['propertyState'],
      }),
    ]);

    // Shape aggregate counts
    const tierCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    for (const g of tierGroups) {
      if (g.tier != null) tierCounts[g.tier] = g._count;
    }
    const bandCounts: Record<string, number> = {};
    for (const g of bandGroups) {
      bandCounts[g.scoreBand] = g._count;
    }

    // In-page Spread re-sort: when the user sorts by spread, the DB returns
    // rows roughly ordered by ARV (set in sortMap above). Re-sort the page
    // by true (MAO − Asking) so the top-of-page rows are correct for what
    // the user sees. Rows missing ARV or Asking sink to the bottom.
    //
    // Formula mirrors Lead Detail (apps/web/src/app/leads/[id]/page.tsx:1148-1149):
    //   MAO = ARV × (maoPercent/100 || 0.7) − repairCosts − assignmentFee
    let leads = leadsRaw as typeof leadsRaw;
    if (filters.sort === 'spread') {
      const compSpread = (l: any): number | null => {
        if (l.arv == null || l.arv <= 0) return null;
        if (l.askingPrice == null || l.askingPrice <= 0) return null;
        const pct = (l.maoPercent ?? 70) / 100;
        const repairs = l.repairCosts ?? 0;
        const fee = l.assignmentFee ?? 0;
        const mao = Math.round(l.arv * pct - repairs - fee);
        return mao - l.askingPrice;
      };
      leads = [...leadsRaw].sort((a: any, b: any) => {
        const sa = compSpread(a);
        const sb = compSpread(b);
        if (sa == null && sb == null) return 0;
        if (sa == null) return 1; // nulls to bottom regardless of dir
        if (sb == null) return -1;
        return dir === 'desc' ? sb - sa : sa - sb;
      }) as typeof leadsRaw;
    }

    return {
      leads,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      counts: {
        tiers: tierCounts,
        bands: bandCounts,
        dripActive: dripActiveCount,
        hiddenInactive: inactiveCount,
      },
      availableStates: stateRows
        .map(r => r.propertyState)
        .filter(Boolean)
        .sort(),
    };
  }

  /**
   * Get leads grouped by pipeline stage for kanban view.
   */
  async getPipelineLeads(filters: {
    organizationId?: string;
    search?: string;
    tier?: number;
    scoreBand?: string;
    assignedToUserId?: string;
    limitPerStage?: number;
  }) {
    const limitPerStage = filters.limitPerStage || 50;
    const stages = ['NEW', 'ATTEMPTING_CONTACT', 'QUALIFYING', 'QUALIFIED', 'OFFER_SENT', 'NEGOTIATING', 'UNDER_CONTRACT', 'CLOSING', 'NURTURE'];

    // Build shared WHERE (excluding status, which varies per stage)
    const baseWhere: Prisma.LeadWhereInput = {};
    if (filters.organizationId) baseWhere.organizationId = filters.organizationId;
    if (filters.tier) baseWhere.tier = filters.tier;
    if (filters.scoreBand) baseWhere.scoreBand = filters.scoreBand as any;
    if (filters.assignedToUserId === 'none') {
      baseWhere.assignedToUserId = null;
    } else if (filters.assignedToUserId) {
      baseWhere.assignedToUserId = filters.assignedToUserId;
    }
    if (filters.search) {
      baseWhere.AND = [{
        OR: [
          { propertyAddress: { contains: filters.search, mode: 'insensitive' } },
          { sellerFirstName: { contains: filters.search, mode: 'insensitive' } },
          { sellerLastName: { contains: filters.search, mode: 'insensitive' } },
          { sellerPhone: { contains: filters.search, mode: 'insensitive' } },
          { sellerEmail: { contains: filters.search, mode: 'insensitive' } },
        ],
      }];
    }

    // Query all stages in parallel
    const stageResults = await Promise.all(
      stages.map(async (status) => {
        const where = { ...baseWhere, status };
        const [leads, total] = await Promise.all([
          this.prisma.lead.findMany({
            where,
            include: { assignedTo: true },
            orderBy: [{ totalScore: 'desc' }, { createdAt: 'desc' }],
            take: limitPerStage,
          }),
          this.prisma.lead.count({ where }),
        ]);
        return { status, leads, total };
      }),
    );

    const stagesMap: Record<string, { leads: any[]; total: number }> = {};
    for (const r of stageResults) {
      stagesMap[r.status] = { leads: r.leads, total: r.total };
    }

    return { stages: stagesMap };
  }

  /**
   * Update lead
   */
  async updateLead(id: string, data: {
    status?: LeadStatus;
    propertyType?: string;
    bedrooms?: number;
    bathrooms?: number;
    sqft?: number;
    timeline?: number;
    askingPrice?: number;
    conditionLevel?: string;
    distressSignals?: string[];
    ownershipStatus?: string;
    arv?: number;
    assignedToUserId?: string;
    tags?: string[];
    autoRespond?: boolean;
    [key: string]: any;
  }) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new Error('Lead not found');

    // Track status change
    if (data.status && data.status !== lead.status) {
      await this.prisma.activity.create({
        data: {
          leadId: id,
          type: 'STATUS_CHANGED',
          description: `Status changed from ${lead.status} to ${data.status}`,
          metadata: { oldStatus: lead.status, newStatus: data.status },
        },
      });

      // Remove from campaigns and cancel drip when lead is dead/won/opted out
      if (['DEAD', 'CLOSED_WON', 'OPTED_OUT'].includes(data.status)) {
        try {
          await this.campaignEnrollmentService.removeAllActive(id);
        } catch (err) {
          this.logger.error(`Failed to remove campaign enrollments for lead ${id}: ${err.message}`);
        }
        try {
          await this.dripService.cancelByLeadId(id, `Lead status changed to ${data.status}`);
        } catch (err) {
          // Drip may not exist — that's fine
        }
      }
    }

    // Track field updates
    const scoringFields = ['timeline', 'askingPrice', 'conditionLevel', 'distressSignals', 'ownershipStatus', 'arv'];
    const needsRescore = scoringFields.some(field => field in data);

    // Update lead
    const updated = await this.prisma.lead.update({
      where: { id },
      data: data as Prisma.LeadUncheckedUpdateInput,
    });

    // Rescore if needed
    if (needsRescore) {
      const scoringResult = await this.scoringService.scoreLead({
        timeline: updated.timeline,
        askingPrice: updated.askingPrice,
        arv: updated.arv,
        conditionLevel: updated.conditionLevel,
        distressSignals: updated.distressSignals as string[] | undefined,
        ownershipStatus: updated.ownershipStatus,
      });

      await this.prisma.lead.update({
        where: { id },
        data: {
          challengeScore: scoringResult.challengeScore,
          authorityScore: scoringResult.authorityScore,
          moneyScore: scoringResult.moneyScore,
          priorityScore: scoringResult.priorityScore,
          totalScore: scoringResult.totalScore,
          scoreBand: scoringResult.scoreBand,
          abcdFit: scoringResult.abcdFit,
          scoringRationale: scoringResult.rationale,
          lastScoredAt: new Date(),
        },
      });

      // Refresh CAMP flags
      await this.scoringService.refreshCampFlags(id);

      if (lead.totalScore !== scoringResult.totalScore) {
        await this.prisma.activity.create({
          data: {
            leadId: id,
            type: 'SCORE_UPDATED',
            description: `Score updated: ${lead.totalScore} → ${scoringResult.totalScore} (${scoringResult.scoreBand})`,
            metadata: {
              oldScore: lead.totalScore,
              newScore: scoringResult.totalScore,
              oldBand: lead.scoreBand,
              newBand: scoringResult.scoreBand,
            },
          },
        });
      }
    }

    // Recompute tier if relevant fields changed
    const tierFields = ['status', 'arv', 'askingPrice', 'scoreBand', 'totalScore'];
    const needsTierUpdate = needsRescore || tierFields.some(f => f in data);
    if (needsTierUpdate) {
      const fresh = await this.prisma.lead.findUnique({ where: { id } });
      if (fresh) {
        await this.prisma.lead.update({
          where: { id },
          data: {
            tier: this.computeTier({
              status: fresh.status,
              scoreBand: fresh.scoreBand,
              totalScore: fresh.totalScore,
              arv: fresh.arv,
              askingPrice: fresh.askingPrice,
            }),
          },
        });
      }
    }

    return this.getLead(id);
  }

  /**
   * Backfill city/state on leads where those fields are blank but a zip is present.
   * Uses the free zippopotam.us API. Safe to run multiple times.
   */
  async backfillMissingCityState(): Promise<{ updated: number; skipped: number; failed: number }> {
    // Find leads missing city/state OR with potentially dirty street fields
    const leads = await this.prisma.lead.findMany({
      select: { id: true, propertyAddress: true, propertyCity: true, propertyState: true, propertyZip: true },
    });

    this.logger.log(`backfillMissingCityState: ${leads.length} leads to process`);

    let updated = 0, skipped = 0, failed = 0;

    for (const lead of leads) {
      try {
        const patch: Record<string, string> = {};

        // 1. Clean the street address field (strip embedded city/state/zip/country)
        if (lead.propertyAddress) {
          const cleanStreet = cleanStreetAddress(lead.propertyAddress);
          if (cleanStreet !== lead.propertyAddress) {
            patch.propertyAddress = cleanStreet;
          }
        }

        // 2. Fill in missing city/state from zip
        if (lead.propertyZip && (!lead.propertyCity || !lead.propertyState)) {
          const looked = await lookupCityStateFromZip(lead.propertyZip);
          if (looked) {
            if (!lead.propertyCity) patch.propertyCity = looked.city;
            if (!lead.propertyState) patch.propertyState = looked.state;
          }
        }

        if (Object.keys(patch).length === 0) { skipped++; continue; }

        await this.prisma.lead.update({ where: { id: lead.id }, data: patch });
        await this.prisma.activity.create({
          data: {
            leadId: lead.id,
            type: 'FIELD_UPDATED',
            description: `Address cleaned: ${Object.entries(patch).map(([k, v]) => `${k}="${v}"`).join(', ')}`,
            metadata: { source: 'address-backfill', ...patch },
          },
        });
        updated++;
      } catch (err) {
        this.logger.error(`backfillMissingCityState: failed for lead ${lead.id}: ${err.message}`);
        failed++;
      }
    }

    this.logger.log(`backfillMissingCityState complete: updated=${updated}, skipped=${skipped}, failed=${failed}`);
    return { updated, skipped, failed };
  }

  /**
   * Normalize all stored phone numbers to E.164 (+1XXXXXXXXXX) format.
   * Safe to run multiple times — skips numbers already in E.164.
   */
  async normalizeAllPhones(): Promise<{ updated: number; skipped: number }> {
    const leads = await this.prisma.lead.findMany({ select: { id: true, sellerPhone: true } });
    let updated = 0;
    let skipped = 0;
    for (const lead of leads) {
      if (!lead.sellerPhone) { skipped++; continue; }
      const normalized = formatPhoneNumber(lead.sellerPhone);
      if (normalized === lead.sellerPhone) { skipped++; continue; }
      await this.prisma.lead.update({ where: { id: lead.id }, data: { sellerPhone: normalized } });
      updated++;
    }
    this.logger.log(`normalizeAllPhones: updated=${updated}, skipped=${skipped}`);
    return { updated, skipped };
  }

  /**
   * Backfill touchCount for all leads based on actual outbound messages + completed calls.
   * Safe to run multiple times — overwrites touchCount with the real count.
   */
  async backfillTouchCounts(): Promise<{ updated: number; total: number }> {
    const leads = await this.prisma.lead.findMany({ select: { id: true, touchCount: true } });
    let updated = 0;

    for (const lead of leads) {
      const [outboundMessages, completedCalls] = await Promise.all([
        this.prisma.message.count({
          where: { leadId: lead.id, direction: 'OUTBOUND' },
        }),
        this.prisma.callLog.count({
          where: { leadId: lead.id, status: 'completed' },
        }),
      ]);

      const realCount = outboundMessages + completedCalls;
      if (realCount !== lead.touchCount) {
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: { touchCount: realCount },
        });
        updated++;
      }
    }

    this.logger.log(`backfillTouchCounts: updated=${updated}, total=${leads.length}`);
    return { updated, total: leads.length };
  }

  /**
   * Manually trigger initial outreach for a lead (useful for testing / retroactive sends)
   */
  async triggerInitialOutreach(leadId: string): Promise<string | null> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error('Lead not found');
    if (lead.doNotContact) throw new Error('Lead is marked Do Not Contact');
    return this.messagesService.sendInitialOutreach(leadId);
  }

  /**
   * Get tasks for a lead
   */
  async getLeadTasks(leadId: string) {
    return this.prisma.task.findMany({
      where: { leadId },
      orderBy: [{ completed: 'asc' }, { dueDate: 'asc' }],
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  async cancelDripForLead(leadId: string, reason: string) {
    await this.dripService.cancelByLeadId(leadId, reason);
  }

  /**
   * Create task for lead
   */
  async createTask(leadId: string, data: {
    title: string;
    description?: string;
    dueDate?: Date;
    userId?: string;
  }) {
    const task = await this.prisma.task.create({
      data: {
        leadId,
        ...data,
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        userId: data.userId,
        type: 'TASK_CREATED',
        description: `Task created: ${data.title}`,
        metadata: { title: data.title },
      },
    });

    return task;
  }

  /**
   * Complete task
   */
  async completeTask(taskId: string, userId?: string) {
    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        completed: true,
        completedAt: new Date(),
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId: task.leadId,
        userId,
        type: 'TASK_COMPLETED',
        description: `Task completed: ${task.title}`,
        metadata: { title: task.title },
      },
    });

    return task;
  }

  /**
   * Add note to lead
   */
  async addNote(leadId: string, content: string, userId: string) {
    const note = await this.prisma.note.create({
      data: {
        leadId,
        userId,
        content,
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        userId,
        type: 'NOTE_ADDED',
        description: 'Note added',
      },
    });

    return note;
  }

  /**
   * Bulk delete leads by IDs
   */
  async bulkDelete(ids: string[]): Promise<{ deleted: number }> {
    const result = await this.prisma.lead.deleteMany({
      where: { id: { in: ids } },
    });
    return { deleted: result.count };
  }

  /**
   * Bulk update lead status
   */
  async bulkUpdateStatus(ids: string[], status: LeadStatus): Promise<{ updated: number }> {
    const result = await this.prisma.lead.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });
    return { updated: result.count };
  }

  /**
   * Bulk update lead source
   */
  async bulkUpdateSource(ids: string[], source: LeadSource): Promise<{ updated: number }> {
    const result = await this.prisma.lead.updateMany({
      where: { id: { in: ids } },
      data: { source },
    });
    return { updated: result.count };
  }

  /**
   * Export leads as CSV string
   */
  async exportCsv(filters: {
    source?: LeadSource;
    status?: LeadStatus;
    scoreBand?: string;
    search?: string;
    createdAfter?: string;
    createdBefore?: string;
  }): Promise<string> {
    const where: Prisma.LeadWhereInput = {};
    if (filters.source) where.source = filters.source;
    if (filters.status) where.status = filters.status;
    if (filters.scoreBand) where.scoreBand = filters.scoreBand as any;
    if (filters.search) {
      where.OR = [
        { propertyAddress: { contains: filters.search, mode: 'insensitive' } },
        { sellerFirstName: { contains: filters.search, mode: 'insensitive' } },
        { sellerLastName: { contains: filters.search, mode: 'insensitive' } },
        { sellerPhone: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.createdAfter || filters.createdBefore) {
      const dateFilter: Prisma.DateTimeFilter<'Lead'> = {};
      if (filters.createdAfter) dateFilter.gte = new Date(filters.createdAfter);
      if (filters.createdBefore) dateFilter.lte = new Date(filters.createdBefore);
      where.createdAt = dateFilter;
    }

    const leads = await this.prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' } });

    const headers = ['Name', 'Phone', 'Email', 'Address', 'City', 'State', 'Zip', 'Status', 'Score', 'Band', 'Source', 'Created', 'Timeline', 'Asking Price'];
    const csvEscape = (val: string | null | undefined) => {
      if (val == null) return '';
      const str = String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const rows = leads.map((l) => [
      csvEscape(`${l.sellerFirstName} ${l.sellerLastName}`),
      csvEscape(l.sellerPhone),
      csvEscape(l.sellerEmail),
      csvEscape(l.propertyAddress),
      csvEscape(l.propertyCity),
      csvEscape(l.propertyState),
      csvEscape(l.propertyZip),
      csvEscape(l.status),
      l.totalScore ?? '',
      csvEscape(l.scoreBand),
      csvEscape(l.source),
      l.createdAt ? new Date(l.createdAt).toISOString().split('T')[0] : '',
      l.timeline ?? '',
      l.askingPrice ?? '',
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  // ── Enhanced export with field selection and XLSX support ────────────────

  private static readonly EXPORT_FIELD_DEFS: { key: string; label: string; accessor: (l: any) => any }[] = [
    { key: 'sellerFirstName', label: 'First Name', accessor: (l) => l.sellerFirstName },
    { key: 'sellerLastName', label: 'Last Name', accessor: (l) => l.sellerLastName },
    { key: 'sellerPhone', label: 'Phone', accessor: (l) => l.sellerPhone },
    { key: 'sellerEmail', label: 'Email', accessor: (l) => l.sellerEmail },
    { key: 'propertyAddress', label: 'Property Address', accessor: (l) => l.propertyAddress },
    { key: 'propertyCity', label: 'City', accessor: (l) => l.propertyCity },
    { key: 'propertyState', label: 'State', accessor: (l) => l.propertyState },
    { key: 'propertyZip', label: 'Zip', accessor: (l) => l.propertyZip },
    { key: 'propertyType', label: 'Property Type', accessor: (l) => l.propertyType },
    { key: 'bedrooms', label: 'Bedrooms', accessor: (l) => l.bedrooms },
    { key: 'bathrooms', label: 'Bathrooms', accessor: (l) => l.bathrooms },
    { key: 'sqft', label: 'Sqft', accessor: (l) => l.sqft },
    { key: 'lotSize', label: 'Lot Size', accessor: (l) => l.lotSize },
    { key: 'yearBuilt', label: 'Year Built', accessor: (l) => l.yearBuilt },
    { key: 'subdivision', label: 'Subdivision', accessor: (l) => l.subdivision },
    { key: 'status', label: 'Status', accessor: (l) => l.status },
    { key: 'source', label: 'Source', accessor: (l) => l.source },
    { key: 'totalScore', label: 'Score', accessor: (l) => l.totalScore },
    { key: 'scoreBand', label: 'Score Band', accessor: (l) => l.scoreBand },
    { key: 'tier', label: 'Tier', accessor: (l) => l.tier },
    { key: 'askingPrice', label: 'Asking Price', accessor: (l) => l.askingPrice },
    { key: 'arv', label: 'ARV', accessor: (l) => l.arv },
    { key: 'timeline', label: 'Timeline', accessor: (l) => l.timeline },
    { key: 'conditionLevel', label: 'Condition', accessor: (l) => l.conditionLevel },
    { key: 'ownershipStatus', label: 'Ownership', accessor: (l) => l.ownershipStatus },
    { key: 'sellerMotivation', label: 'Motivation', accessor: (l) => l.sellerMotivation },
    { key: 'touchCount', label: 'Touches', accessor: (l) => l.touchCount },
    { key: 'lastTouchedAt', label: 'Last Touched', accessor: (l) => l.lastTouchedAt ? new Date(l.lastTouchedAt).toISOString().split('T')[0] : '' },
    { key: 'createdAt', label: 'Created', accessor: (l) => l.createdAt ? new Date(l.createdAt).toISOString().split('T')[0] : '' },
    { key: 'latitude', label: 'Latitude', accessor: (l) => l.latitude },
    { key: 'longitude', label: 'Longitude', accessor: (l) => l.longitude },
    { key: 'repairCosts', label: 'Repair Costs', accessor: (l) => l.repairCosts },
    { key: 'assignmentFee', label: 'Assignment Fee', accessor: (l) => l.assignmentFee },
    { key: 'maoPercent', label: 'MAO %', accessor: (l) => l.maoPercent },
  ];

  async exportLeads(
    filters: {
      source?: LeadSource;
      status?: LeadStatus;
      scoreBand?: string;
      search?: string;
      createdAfter?: string;
      createdBefore?: string;
    },
    fields?: string[],
    format: 'csv' | 'xlsx' = 'csv',
  ): Promise<string | Buffer> {
    const where: Prisma.LeadWhereInput = {};
    if (filters.source) where.source = filters.source;
    if (filters.status) where.status = filters.status;
    if (filters.scoreBand) where.scoreBand = filters.scoreBand as any;
    if (filters.search) {
      where.OR = [
        { propertyAddress: { contains: filters.search, mode: 'insensitive' } },
        { sellerFirstName: { contains: filters.search, mode: 'insensitive' } },
        { sellerLastName: { contains: filters.search, mode: 'insensitive' } },
        { sellerPhone: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.createdAfter || filters.createdBefore) {
      const dateFilter: Prisma.DateTimeFilter<'Lead'> = {};
      if (filters.createdAfter) dateFilter.gte = new Date(filters.createdAfter);
      if (filters.createdBefore) dateFilter.lte = new Date(filters.createdBefore);
      where.createdAt = dateFilter;
    }

    const leads = await this.prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' } });

    // Pick fields to export
    const selectedDefs = fields?.length
      ? LeadsService.EXPORT_FIELD_DEFS.filter((d) => fields.includes(d.key))
      : LeadsService.EXPORT_FIELD_DEFS;

    const headers = selectedDefs.map((d) => d.label);
    const dataRows = leads.map((l) => selectedDefs.map((d) => {
      const val = d.accessor(l);
      return val != null ? val : '';
    }));

    if (format === 'xlsx') {
      const wb = XLSX.utils.book_new();
      const wsData = [headers, ...dataRows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      // Auto-size columns
      ws['!cols'] = headers.map((h, i) => {
        const maxLen = Math.max(h.length, ...dataRows.map((r) => String(r[i] || '').length));
        return { wch: Math.min(maxLen + 2, 40) };
      });
      XLSX.utils.book_append_sheet(wb, ws, 'Leads');
      return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    }

    // CSV format
    const csvEscape = (val: any) => {
      if (val == null) return '';
      const str = String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const csvRows = dataRows.map((row) => row.map(csvEscape).join(','));
    return [headers.join(','), ...csvRows].join('\n');
  }

  /**
   * Get lead counts grouped by status and source
   */
  async getLeadStats() {
    const [byStatus, bySource, byBand, total] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['status'], _count: true }),
      this.prisma.lead.groupBy({ by: ['source'], _count: true }),
      this.prisma.lead.groupBy({ by: ['scoreBand'], _count: true }),
      this.prisma.lead.count(),
    ]);
    return {
      total,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
      bySource: Object.fromEntries(bySource.map((r) => [r.source, r._count])),
      byBand: Object.fromEntries(byBand.map((r) => [r.scoreBand, r._count])),
    };
  }

  /**
   * Assign a lead to a user for a specific workflow stage
   */
  async assignLead(leadId: string, userId: string, stage: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error('Lead not found');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!user) throw new Error('User not found');

    const updated = await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        assignedToUserId: userId,
        assignedStage: stage,
        assignedAt: new Date(),
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        userId,
        type: 'LEAD_ASSIGNED',
        description: `Lead assigned to ${user.firstName} ${user.lastName} for ${stage}`,
        metadata: { userId, stage },
      },
    });

    return this.getLead(leadId);
  }

  /**
   * Remove assignment from a lead
   */
  async unassignLead(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { assignedTo: { select: { firstName: true, lastName: true } } },
    });
    if (!lead) throw new Error('Lead not found');

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        assignedToUserId: null,
        assignedStage: null,
        assignedAt: null,
      },
    });

    const prevName = lead.assignedTo
      ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`
      : 'unknown';

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'LEAD_UNASSIGNED',
        description: `Lead unassigned from ${prevName}`,
      },
    });

    return this.getLead(leadId);
  }

  /**
   * Create or update contract
   */
  async upsertContract(leadId: string, data: any) {
    // Parse date strings to Date objects
    const clean: any = { ...data };
    if (clean.contractDate) clean.contractDate = new Date(clean.contractDate);
    if (clean.expectedCloseDate) clean.expectedCloseDate = new Date(clean.expectedCloseDate);
    if (clean.actualCloseDate) clean.actualCloseDate = new Date(clean.actualCloseDate);

    const contract = await this.prisma.contract.upsert({
      where: { leadId },
      create: { leadId, ...clean },
      update: clean,
    });

    // Advance lead status when contract is signed
    if (clean.contractStatus === 'signed') {
      const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
      if (lead && !['UNDER_CONTRACT', 'CLOSING', 'CLOSED'].includes(lead.status)) {
        await this.updateLead(leadId, { status: 'UNDER_CONTRACT' as LeadStatus });
      }
    }

    return contract;
  }

  // ── Dispo Summary ──────────────────────────────────────────────────────────

  async getDispoSummary(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        contract: true,
        offers: { orderBy: { createdAt: 'desc' } },
        compAnalyses: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!lead) throw new Error('Lead not found');

    // Use the comp analysis that was saved to the lead first, then most recent
    const analysis =
      lead.compAnalyses.find((c) => c.savedToLead) ?? lead.compAnalyses[0] ?? null;

    const arv = lead.arv ?? analysis?.arvEstimate ?? null;
    const repairCost = (lead as any).repairCosts ?? analysis?.repairCosts ?? null;
    const maoFactor = ((lead as any).maoPercent ?? 70) / 100;
    const mao = arv != null && repairCost != null ? arv * maoFactor - repairCost : null;

    const offers = lead.offers ?? [];
    const acceptedOffer = [...offers].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).find((o: any) => o.status === 'accepted') ?? null;
    const offerAmount = lead.contract?.offerAmount ?? acceptedOffer?.offerAmount ?? null;
    // Never fall back to analysis.assignmentFee (always 15000 default) — only use explicitly saved values
    const assignmentFee = lead.contract?.assignmentFee ?? (lead as any).assignmentFee ?? null;
    const exitStrategy = lead.contract?.exitStrategy ?? 'wholesale';

    // Buyer's All-In Price: what the end buyer pays (offer to seller + assignment fee)
    // For novation/sub-to, the "buyer" is the eventual end buyer — all-in = ARV (market price)
    // For wholesale/creative, all-in = offer + assignment fee
    const isWholesale = exitStrategy === 'wholesale' || exitStrategy === 'creative_finance';
    const buyerPrice = isWholesale
      ? (offerAmount != null && assignmentFee != null ? offerAmount + assignmentFee : null)
      : arv; // novation/sub-to: end buyer pays market value (ARV)

    // Buyer's Spread: equity left for the end buyer after purchase
    const buyerSpread = arv != null && buyerPrice != null ? arv - buyerPrice : null;

    // Your Profit depends on exit strategy:
    //   wholesale: your profit = assignment fee (you flip the contract)
    //   novation/sub-to: your profit = ARV - offer to seller - repairs (you sell the property)
    let projectedProfit: number | null = null;
    if (exitStrategy === 'wholesale') {
      projectedProfit = assignmentFee ?? null;
    } else if (exitStrategy === 'novation' || exitStrategy === 'subject_to' || exitStrategy === 'owner_finance') {
      projectedProfit = arv != null && offerAmount != null
        ? arv - offerAmount - (repairCost ?? 0)
        : null;
    } else {
      // fallback: use assignment fee if set, else ARV spread
      projectedProfit = assignmentFee ?? (arv != null && offerAmount != null ? arv - offerAmount - (repairCost ?? 0) : null);
    }

    return {
      arv,
      repairCost,
      mao,
      maoPercent: Math.round(maoFactor * 100),
      askingPrice: lead.askingPrice ?? null,
      offerAmount,
      assignmentFee,
      leadAssignmentFee: (lead as any).assignmentFee ?? null,
      exitStrategy,
      buyerPrice,
      buyerSpread,
      projectedProfit,
      contract: lead.contract ?? null,
      offers: lead.offers,
      latestCompAnalysis: analysis
        ? {
            repairCosts: analysis.repairCosts,
            assignmentFee: analysis.assignmentFee,
            arvEstimate: analysis.arvEstimate,
            dealType: analysis.dealType,
            repairNotes: analysis.repairNotes,
          }
        : null,
    };
  }

  // ── Offers ─────────────────────────────────────────────────────────────────

  async listOffers(leadId: string) {
    return this.prisma.offer.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createOffer(leadId: string, data: any) {
    const offer = await this.prisma.offer.create({
      data: {
        leadId,
        offerAmount: data.offerAmount,
        offerDate: data.offerDate ? new Date(data.offerDate) : new Date(),
        status: data.status ?? 'pending',
        notes: data.notes ?? null,
        visibleOnPortal: data.visibleOnPortal ?? false,
        terms: data.terms ?? null,
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'OFFER_MADE',
        description: `Offer made: $${offer.offerAmount.toLocaleString()}`,
        metadata: { offerId: offer.id, amount: offer.offerAmount },
      },
    });

    // Advance lead status to OFFER_SENT if not already further along
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    const advanceStatuses = ['NEW', 'ATTEMPTING_CONTACT', 'QUALIFYING', 'QUALIFIED'];
    if (lead && advanceStatuses.includes(lead.status)) {
      await this.updateLead(leadId, { status: LeadStatus.OFFER_SENT });
    }

    return offer;
  }

  async updateOffer(leadId: string, offerId: string, data: any) {
    const offer = await this.prisma.offer.update({
      where: { id: offerId, leadId },
      data: {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.counterAmount !== undefined && { counterAmount: data.counterAmount }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.offerAmount !== undefined && { offerAmount: data.offerAmount }),
        ...(data.visibleOnPortal !== undefined && { visibleOnPortal: data.visibleOnPortal }),
        ...(data.terms !== undefined && { terms: data.terms }),
      },
    });

    if (data.status === 'accepted') {
      await this.prisma.activity.create({
        data: {
          leadId,
          type: 'OFFER_ACCEPTED',
          description: `Offer accepted: $${offer.offerAmount.toLocaleString()}`,
          metadata: { offerId: offer.id },
        },
      });
    }

    return offer;
  }

  async deleteOffer(leadId: string, offerId: string) {
    await this.prisma.offer.delete({ where: { id: offerId, leadId } });
    return { deleted: true };
  }

  /**
   * Centralized touch recording — called by all outbound channels (SMS, email, calls).
   * Updates lastTouchedAt, increments touchCount, optionally advances pipeline stage,
   * and logs an Activity record.
   */
  async recordTouch(
    leadId: string,
    type: string,
    opts?: {
      userId?: string;
      description?: string;
      metadata?: Record<string, any>;
    },
  ): Promise<void> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { status: true },
    });
    if (!lead) return;

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        lastTouchedAt: new Date(),
        touchCount: { increment: 1 },
        ...(lead.status === 'NEW'
          ? { status: 'ATTEMPTING_CONTACT', stageChangedAt: new Date(), daysInStage: 0 }
          : {}),
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        userId: opts?.userId,
        type,
        description: opts?.description || type,
        metadata: opts?.metadata ?? {},
      },
    });
  }
}
