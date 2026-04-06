import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RentCastService } from './rentcast.service';
import axios, { AxiosError } from 'axios';

const ATTOM_BASE = 'https://api.gateway.attomdata.com/propertyapi/v1.0.0';

// Convert lot size: if value > 100 it's almost certainly sqft, convert to acres
function normalizeLotSize(raw: number | undefined): number | undefined {
  if (!raw) return undefined;
  return raw > 100 ? parseFloat((raw / 43560).toFixed(4)) : raw;
}

// ─── ATTOM Response Types ────────────────────────────────────────────────────

export interface AttomProperty {
  identifier: { Id: number; fips?: string; apn?: string; attomId: number };
  lot?: { lotnum?: string; lotsize1?: number; lotsize2?: number; pooltype?: string; poolind?: string };
  area?: {
    countrysecsubd?: string;
    munname?: string;
    subdname?: string;
    taxcodearea?: string;
  };
  address?: {
    countrySubd?: string;
    line1?: string;
    line2?: string;
    locality?: string;
    oneLine?: string;
    postal1?: string;
  };
  location?: {
    accuracy?: string;
    latitude?: string;
    longitude?: string;
    distance?: number;
  };
  summary?: {
    absenteeInd?: string;
    propclass?: string;
    proptype?: string;
    propertyType?: string;
    yearbuilt?: number;
    propLandUse?: string;
  };
  utilities?: {
    heatingfuel?: string;
    heatingtype?: string;
    coolingtype?: string;
  };
  building?: {
    size?: {
      bldgsize?: number;
      grosssize?: number;
      grosssizeadjusted?: number;
      groundfloorsize?: number;
      livingsize?: number;
      sizeInd?: string;
      universalsize?: number;
    };
    rooms?: {
      bathfixtures?: number;
      bathsfull?: number;
      bathspartial?: number;
      bathstotal?: number;
      beds?: number;
      roomsTotal?: number;
    };
    interior?: {
      bsmtsize?: number;
      bsmttype?: string;
      fplccount?: number;
      fplcind?: string;
      fplctype?: string;
    };
    construction?: {
      condition?: string;
      roofcover?: string;
      wallType?: string;
      foundationtype?: string;
    };
    parking?: {
      garagetype?: string;
      prkgSize?: number;
      prkgSpaces?: string;
      prkgType?: string;
    };
    summary?: {
      archStyle?: string;
      levels?: number;
      quality?: string;
      unitsCount?: string;
      view?: string;
      yearbuilteffective?: number;
    };
  };
  sale?: {
    saleTransDate?: string;
    saleSearchDate?: string;
    sellerName?: string;
    transactionIdent?: string;
    amount?: {
      saleAmt?: number;
      saleCode?: string;
      saleRecDate?: string;
      saleTransType?: string;
    };
  };
  assessment?: {
    assessed?: {
      assdImprValue?: number;
      assdLandValue?: number;
      assdTtlValue?: number;
    };
    market?: {
      mktImprValue?: number;
      mktLandValue?: number;
      mktTtlValue?: number;
    };
    tax?: {
      taxAmt?: number;
      taxPerSizeUnit?: number;
      taxYear?: number;
    };
    improvementPercent?: number;
    owner?: {
      owner1?: { fullName?: string; lastName?: string; firstNameAndMi?: string };
      absenteeOwnerStatus?: string;
    };
  };
  avm?: {
    eventDate?: string;
    amount?: {
      scr?: number;
      value?: number;
      high?: number;
      low?: number;
      valueRange?: number;
    };
    calculations?: {
      perSizeUnit?: number;
      ratioTaxAmt?: number;
      rangePctOfValue?: number;
    };
    AVMChange?: {
      avmlastmonthvalue?: number;
      avmamountchange?: number;
      avmpercentchange?: number;
    };
    condition?: {
      avmpoorlow?: number;
      avmpoorhigh?: number;
      avmgoodlow?: number;
      avmgoodhigh?: number;
      avmexcellentlow?: number;
      avmexcellenthigh?: number;
    };
  };
  vintage?: {
    lastModified?: string;
    pubDate?: string;
  };
}

export interface AttomSaleRecord {
  saleTransDate: string;
  saleRecDate?: string;
  saleAmt: number;
  saleTransType?: string;
  pricePerSqft?: number;
  sellerName?: string;
}

export interface AttomEnrichmentResult {
  saleHistory?: AttomSaleRecord[];
  attomId: string;
  // Property characteristics
  bedsFromAttom?: number;
  bathsFromAttom?: number;
  sqftFromAttom?: number;
  lotSizeFromAttom?: number;
  yearBuiltFromAttom?: number;
  effectiveYearBuilt?: number;
  storiesFromAttom?: number;
  propertyTypeFromAttom?: string;
  // Building details
  basementSqft?: number;
  hasBasement?: boolean;
  hasPool?: boolean;
  hasGarage?: boolean;
  garageSpaces?: number;
  hasFireplace?: boolean;
  condition?: string;
  quality?: string;
  wallType?: string;
  roofType?: string;
  heatingType?: string;
  coolingType?: string;
  // Location
  latitude?: number;
  longitude?: number;
  subdivision?: string;
  countyName?: string;
  // AVM data
  attomAvm?: number;
  attomAvmLow?: number;
  attomAvmHigh?: number;
  attomAvmConfidence?: number;
  attomAvmPerSqft?: number;
  // Condition-adjusted AVM (the crown jewel for investors)
  avmPoorLow?: number;
  avmPoorHigh?: number;
  avmGoodLow?: number;
  avmGoodHigh?: number;
  avmExcellentLow?: number;
  avmExcellentHigh?: number;   // ← True ARV (fully renovated)
  // Assessment / tax
  assessedValue?: number;
  marketValue?: number;
  annualTaxAmount?: number;
  taxYear?: number;
  pricePerSqft?: number;
  // Prior sale
  lastSaleDateFromAttom?: string;
  lastSalePriceFromAttom?: number;
  // Ownership
  ownerOccupied?: boolean;
  sellerName?: string;
  // Additional property details
  apn?:         string;
  ownerName?:   string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class AttomService {
  private readonly logger = new Logger(AttomService.name);
  private readonly apiKey: string | undefined;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private rentcast: RentCastService,
  ) {
    this.apiKey = this.config.get<string>('ATTOM_API_KEY');
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  // ─── Build address params (ATTOM format: address1=street, address2=city,state zip) ──

  private buildAddressParams(address: { street: string; city: string; state: string; zip: string }) {
    return {
      address1: address.street,
      address2: `${address.city}, ${address.state} ${address.zip}`,
    };
  }

  // ─── Get expanded property profile (detail + AVM in one call) ─────────────

  async getExpandedProfile(
    address: { street: string; city: string; state: string; zip: string },
  ): Promise<AttomProperty | null> {
    if (!this.apiKey) return null;

    const params = this.buildAddressParams(address);
    this.logger.log(`ATTOM expandedprofile for: ${params.address1}, ${params.address2}`);

    try {
      const response = await axios.get<{ property: AttomProperty[] }>(
        `${ATTOM_BASE}/property/expandedprofile`,
        {
          params,
          headers: { apikey: this.apiKey, Accept: 'application/json' },
          timeout: 15000,
        },
      );

      const property = response.data?.property?.[0];
      if (!property) {
        this.logger.warn(`ATTOM expandedprofile: no property found for ${params.address1}`);
        return null;
      }

      this.logger.log(
        `ATTOM found: attomId=${property.identifier.attomId}, ` +
        `${property.building?.rooms?.beds ?? '?'}bd/${property.building?.rooms?.bathstotal ?? '?'}ba, ` +
        `${property.building?.size?.livingsize ?? '?'} sqft, built ${property.summary?.yearbuilt ?? '?'}`,
      );
      return property;
    } catch (error) {
      this.handleError(error, 'getExpandedProfile');
      return null;
    }
  }

  // ─── Get full sale history ────────────────────────────────────────────────

  async getSaleHistory(
    address: { street: string; city: string; state: string; zip: string },
  ): Promise<AttomSaleRecord[]> {
    if (!this.apiKey) return [];
    const params = this.buildAddressParams(address);
    try {
      const response = await axios.get<{ property: Array<{ salehistory?: any[] }> }>(
        `${ATTOM_BASE}/saleshistory/detail`,
        { params, headers: { apikey: this.apiKey, Accept: 'application/json' }, timeout: 12000 },
      );
      const history = response.data?.property?.[0]?.salehistory || [];
      return history.map((h: any) => ({
        saleTransDate:  h.saleTransDate || h.saleSearchDate,
        saleRecDate:    h.amount?.salerecdate,
        saleAmt:        h.amount?.saleamt || 0,
        saleTransType:  h.amount?.saletranstype,
        pricePerSqft:   h.calculation?.pricepersizeunit,
        sellerName:     h.sellerName,
      })).filter((h: AttomSaleRecord) => h.saleAmt > 0);
    } catch (error) {
      this.handleError(error, 'getSaleHistory');
      return [];
    }
  }

  // ─── Get AVM with condition ranges ────────────────────────────────────────

  async getAVM(
    address: { street: string; city: string; state: string; zip: string },
  ): Promise<AttomProperty | null> {
    if (!this.apiKey) return null;

    const params = this.buildAddressParams(address);
    this.logger.log(`ATTOM AVM for: ${params.address1}, ${params.address2}`);

    try {
      const response = await axios.get<{ property: AttomProperty[] }>(
        `${ATTOM_BASE}/avm/detail`,
        {
          params,
          headers: { apikey: this.apiKey, Accept: 'application/json' },
          timeout: 15000,
        },
      );

      const property = response.data?.property?.[0];
      if (!property?.avm) {
        this.logger.warn(`ATTOM AVM: no valuation found for ${params.address1}`);
        return null;
      }

      const avm = property.avm;
      this.logger.log(
        `ATTOM AVM: $${avm.amount?.value?.toLocaleString() ?? '?'} ` +
        `(confidence: ${avm.amount?.scr ?? '?'}%) | ` +
        `AS-IS: $${avm.condition?.avmpoorhigh?.toLocaleString() ?? '?'} | ` +
        `After Repair: $${avm.condition?.avmexcellenthigh?.toLocaleString() ?? '?'}`,
      );
      return property;
    } catch (error) {
      this.handleError(error, 'getAVM');
      return null;
    }
  }

  // ─── Full enrichment: expandedprofile + AVM → save to lead ───────────────

  /**
   * Enriches a lead with ATTOM data:
   * 1. Fetches expandedprofile (property details + sale history + assessment + tax)
   * 2. Fetches AVM detail (condition-adjusted valuation ranges)
   * 3. Fills in missing lead fields (beds/baths/sqft/yearBuilt etc.)
   * 4. Saves ATTOM-specific fields to the lead
   * Returns structured enrichment data for use in comps analysis
   */
  async enrichLead(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
    options?: { forceRefresh?: boolean },
  ): Promise<AttomEnrichmentResult | null> {
    if (!this.apiKey) {
      this.logger.warn('ATTOM API key not configured — skipping enrichment');
      return null;
    }

    // ── Check if already enriched (24h cache) ──
    if (!options?.forceRefresh) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        select: { attomId: true, attomEnrichedAt: true, attomAvm: true },
      });
      if (lead?.attomId && lead?.attomEnrichedAt) {
        const hoursSince = (Date.now() - lead.attomEnrichedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSince < 24 && lead.attomAvm) {
          this.logger.log(`Using cached ATTOM data for lead ${leadId} (${hoursSince.toFixed(1)}h old)`);
          return this.buildEnrichmentFromLead(lead);
        }
      }
    }

    // ── Fetch all endpoints in parallel ──
    const [profileResult, avmResult, historyResult] = await Promise.allSettled([
      this.getExpandedProfile(address),
      this.getAVM(address),
      this.getSaleHistory(address),
    ]);

    const profile    = profileResult.status === 'fulfilled' ? profileResult.value : null;
    const avmData    = avmResult.status    === 'fulfilled' ? avmResult.value    : null;
    const saleHistory = historyResult.status === 'fulfilled' ? historyResult.value : [];

    if (!profile && !avmData) {
      this.logger.warn(`ATTOM enrichment: no data from either endpoint for lead ${leadId}`);
      return null;
    }

    // ── Extract all enrichment fields ──
    const prop = profile || avmData!;
    const avm = avmData?.avm || profile?.avm;
    const building = prop.building;
    const rooms = building?.rooms;
    const size = building?.size;
    const interior = building?.interior;
    const parking = building?.parking;
    const construction = building?.construction;
    const assessment = (profile || avmData)?.assessment;
    const sale = profile?.sale;

    const enrichment: AttomEnrichmentResult = {
      attomId: String(prop.identifier.attomId),

      // Property details
      bedsFromAttom:       rooms?.beds,
      bathsFromAttom:      rooms?.bathstotal,
      sqftFromAttom:       size?.livingsize,
      lotSizeFromAttom:    prop.lot?.lotsize1,
      yearBuiltFromAttom:  prop.summary?.yearbuilt,
      effectiveYearBuilt:  building?.summary?.yearbuilteffective,
      storiesFromAttom:    building?.summary?.levels,
      propertyTypeFromAttom: prop.summary?.propertyType,

      // Building features
      basementSqft:  interior?.bsmtsize,
      hasBasement:   (interior?.bsmtsize ?? 0) > 0 || interior?.bsmttype ? true : undefined,
      hasPool:       prop.lot?.poolind === 'YES' || (prop.lot?.pooltype ? !prop.lot.pooltype.toLowerCase().includes('no pool') : undefined),
      hasGarage:     parking?.garagetype ? !parking.garagetype.toLowerCase().includes('no garage') : undefined,
      garageSpaces:  parking?.prkgSpaces ? parseInt(parking.prkgSpaces) : undefined,
      hasFireplace:  interior?.fplcind === 'Y',
      condition:     construction?.condition,
      quality:       building?.summary?.quality,
      wallType:      construction?.wallType,
      roofType:      construction?.roofcover,
      heatingType:   prop.utilities?.heatingtype,
      coolingType:   prop.utilities?.coolingtype,

      // Location
      latitude:    prop.location?.latitude ? parseFloat(prop.location.latitude) : undefined,
      longitude:   prop.location?.longitude ? parseFloat(prop.location.longitude) : undefined,
      subdivision: prop.area?.subdname,
      countyName:  prop.area?.countrysecsubd,

      // AVM
      attomAvm:           avm?.amount?.value,
      attomAvmLow:        avm?.amount?.low,
      attomAvmHigh:       avm?.amount?.high,
      attomAvmConfidence: avm?.amount?.scr,
      attomAvmPerSqft:    avm?.calculations?.perSizeUnit,

      // Condition-adjusted AVM (the investor's toolset)
      avmPoorLow:      avm?.condition?.avmpoorlow,
      avmPoorHigh:     avm?.condition?.avmpoorhigh,
      avmGoodLow:      avm?.condition?.avmgoodlow,
      avmGoodHigh:     avm?.condition?.avmgoodhigh,
      avmExcellentLow: avm?.condition?.avmexcellentlow,
      avmExcellentHigh: avm?.condition?.avmexcellenthigh,  // ← True ARV

      // Assessment / tax
      assessedValue:  assessment?.assessed?.assdTtlValue,
      marketValue:    assessment?.market?.mktTtlValue,
      annualTaxAmount: assessment?.tax?.taxAmt,
      taxYear:        assessment?.tax?.taxYear ? Math.round(assessment.tax.taxYear) : undefined,
      pricePerSqft:   avm?.calculations?.perSizeUnit,

      // Prior sale (from expandedprofile — most recent)
      lastSaleDateFromAttom:  sale?.amount?.saleRecDate || sale?.saleTransDate,
      lastSalePriceFromAttom: sale?.amount?.saleAmt,

      // Full sale history
      saleHistory: saleHistory.length > 0 ? saleHistory : undefined,

      // Ownership
      ownerOccupied: prop.summary?.absenteeInd?.toLowerCase().includes('owner occupied'),
      sellerName:    sale?.sellerName,
      // Additional details
      apn:         prop.identifier?.apn,
      ownerName:   (profile || avmData)?.assessment?.owner?.owner1?.fullName,
    };

    // ── Persist to Lead: fill missing fields + ATTOM-specific columns ──
    await this.saveEnrichmentToLead(leadId, enrichment);

    return enrichment;
  }

  // ─── Save enrichment to the Lead record ──────────────────────────────────

  private async saveEnrichmentToLead(leadId: string, e: AttomEnrichmentResult) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        bedrooms: true, bathrooms: true, sqft: true, yearBuilt: true,
        lotSize: true, latitude: true, longitude: true,
        lastSaleDate: true, lastSalePrice: true, ownerOccupied: true,
      },
    });
    if (!lead) return;

    const update: any = {
      attomId:        e.attomId,
      attomEnrichedAt: new Date(),
      // AVM data always overwrites
      attomAvm:           e.attomAvm        ?? null,
      attomAvmLow:        e.attomAvmLow     ?? null,
      attomAvmHigh:       e.attomAvmHigh    ?? null,
      attomAvmConfidence: e.attomAvmConfidence ?? null,
      avmPoorLow:         e.avmPoorLow      ?? null,
      avmPoorHigh:        e.avmPoorHigh     ?? null,
      avmGoodLow:         e.avmGoodLow      ?? null,
      avmGoodHigh:        e.avmGoodHigh     ?? null,
      avmExcellentLow:    e.avmExcellentLow ?? null,
      avmExcellentHigh:   e.avmExcellentHigh ?? null,
      // Assessment data
      taxAssessedValue: e.assessedValue     ?? null,
      marketAssessedValue: e.marketValue    ?? null,
      annualTaxAmount:  e.annualTaxAmount   ?? null,
      // Sale history
      attomSaleHistory: e.saleHistory ?? undefined,
      // Building details (always save from ATTOM)
      propertyCondition: e.condition        ?? null,
      propertyQuality:   e.quality          ?? null,
      wallType:          e.wallType         ?? null,
      stories:           e.storiesFromAttom ?? null,
      basementSqft:      e.basementSqft     ?? null,
      effectiveYearBuilt: e.effectiveYearBuilt ?? null,
      subdivision:       e.subdivision      ?? null,
      coolingType:       e.coolingType      ?? null,
      heatingType:       e.heatingType      ?? null,
      apn:               e.apn              ?? null,
      ownerName:         e.ownerName        ?? null,
      ...(e.hasPool !== undefined && { hasPool: e.hasPool }),
    };

    // Only fill property details if they're missing on the lead
    if (!lead.bedrooms  && e.bedsFromAttom)   update.bedrooms  = e.bedsFromAttom;
    if (!lead.bathrooms && e.bathsFromAttom)  update.bathrooms = e.bathsFromAttom;
    if (!lead.sqft      && e.sqftFromAttom)   update.sqft      = e.sqftFromAttom;
    if (!lead.yearBuilt && e.yearBuiltFromAttom) update.yearBuilt = e.yearBuiltFromAttom;
    if (!lead.lotSize   && e.lotSizeFromAttom) update.lotSize   = normalizeLotSize(e.lotSizeFromAttom);
    if (!lead.latitude  && e.latitude)  update.latitude  = e.latitude;
    if (!lead.longitude && e.longitude) update.longitude = e.longitude;
    // Always update last sale from ATTOM — the lead may have been imported with
    // stale data, and ATTOM's expandedprofile reflects the most recent recording.
    if (e.lastSaleDateFromAttom)  update.lastSaleDate  = new Date(e.lastSaleDateFromAttom);
    if (e.lastSalePriceFromAttom) update.lastSalePrice = e.lastSalePriceFromAttom;
    if (lead.ownerOccupied === null || lead.ownerOccupied === undefined) {
      if (e.ownerOccupied !== undefined) update.ownerOccupied = e.ownerOccupied;
    }

    // Use ATTOM's "excellent condition" AVM as the initial ARV estimate.
    // avmExcellentHigh = after-repair value at excellent condition = true ARV.
    // Only set it if arv hasn't been set by a manual comps analysis yet
    // (i.e. no lastCompsDate from a comp analysis run, or arv is currently 0/null).
    const currentLead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { arv: true, lastCompsDate: true },
    });
    if (e.avmExcellentHigh && (!currentLead?.arv || !currentLead?.lastCompsDate)) {
      update.arv = Math.round(e.avmExcellentHigh);
      update.arvConfidence = e.attomAvmConfidence ?? 70;
      update.lastCompsDate = new Date();
    }

    await this.prisma.lead.update({ where: { id: leadId }, data: update });

    this.logger.log(
      `ATTOM enrichment saved for lead ${leadId}: ` +
      `AVM=$${e.attomAvm?.toLocaleString() ?? '?'}, ` +
      `ARV(excellent)=$${e.avmExcellentHigh?.toLocaleString() ?? '?'} ${e.avmExcellentHigh ? '→ saved as lead.arv' : '(not available)'}, ` +
      `AS-IS=$${e.avmPoorHigh?.toLocaleString() ?? '?'}`,
    );
  }

  // ─── Re-build enrichment result from already-saved lead fields ────────────

  private buildEnrichmentFromLead(lead: any): AttomEnrichmentResult {
    return {
      attomId: lead.attomId,
      attomAvm: lead.attomAvm,
      attomAvmLow: lead.attomAvmLow,
      attomAvmHigh: lead.attomAvmHigh,
      attomAvmConfidence: lead.attomAvmConfidence,
      avmPoorLow: lead.avmPoorLow,
      avmPoorHigh: lead.avmPoorHigh,
      avmGoodLow: lead.avmGoodLow,
      avmGoodHigh: lead.avmGoodHigh,
      avmExcellentLow: lead.avmExcellentLow,
      avmExcellentHigh: lead.avmExcellentHigh,
      assessedValue: lead.taxAssessedValue,
      marketValue: lead.marketAssessedValue,
      annualTaxAmount: lead.annualTaxAmount,
      condition: lead.propertyCondition,
      quality: lead.propertyQuality,
      wallType: lead.wallType,
      storiesFromAttom: lead.stories,
      basementSqft: lead.basementSqft,
      effectiveYearBuilt: lead.effectiveYearBuilt,
      subdivision: lead.subdivision,
    };
  }

  // ─── Fetch comparable sales from ATTOM /sale/detail (area search) ────────

  async fetchCompsFromAttom(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
    coords: { latitude: number; longitude: number },
    options?: {
      forceRefresh?: boolean;
      radiusOverride?: number;
      propertyType?: string;
      bedrooms?: number;
      sqft?: number;
    },
  ): Promise<{
    compsCount: number;
    source: string;
    arv?: number;
    arvLow?: number;
    arvHigh?: number;
    confidence: number;
  } | null> {
    if (!this.apiKey) return null;

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { bedrooms: true, bathrooms: true, sqft: true, propertyType: true },
    });

    const mappedType = this.mapPropertyTypeForComps(options?.propertyType || lead?.propertyType);
    const now = new Date();
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
    const today = now.toISOString().slice(0, 10);
    const startDate = twelveMonthsAgo.toISOString().slice(0, 10);

    const radiusTiers = options?.radiusOverride
      ? [options.radiusOverride]
      : [0.5, 1.0, 2.0, 3.0];

    let validComps: Array<{
      address: string;
      soldPrice: number;
      soldDate: Date;
      distance: number;
      bedrooms?: number;
      bathrooms?: number;
      sqft?: number;
      lotSize?: number;
      yearBuilt?: number;
      hasGarage: boolean;
      latitude?: number;
      longitude?: number;
      notes: string;
      similarityScore: number;
      // Enriched fields from ATTOM response
      features: Record<string, any>;
    }> = [];
    // Map comp address → raw AttomProperty for enrichment lookups
    const compSourceProps = new Map<string, AttomProperty>();

    for (const radius of radiusTiers) {
      this.logger.log(`ATTOM comp search: radius=${radius}mi, type=${mappedType}, coords=(${coords.latitude}, ${coords.longitude})`);

      try {
        const response = await axios.get<{ property: AttomProperty[] }>(
          `${ATTOM_BASE}/sale/detail`,
          {
            params: {
              radius,
              latitude: coords.latitude,
              longitude: coords.longitude,
              propertytype: mappedType,
              minsaleamt: 10000,
              startsalesearchdate: startDate,
              endsalesearchdate: today,
              pagesize: 25,
            },
            headers: { apikey: this.apiKey, Accept: 'application/json' },
            timeout: 15000,
          },
        );

        const properties = response.data?.property || [];
        this.logger.log(`ATTOM /sale/detail returned ${properties.length} properties at radius=${radius}mi`);

        // Filter and deduplicate
        const seenAddresses = new Set<string>();
        validComps = [];

        for (const prop of properties) {
          // ATTOM /sale/detail uses all-lowercase keys in amount block
          const amountBlock = prop.sale?.amount as any || {};
          const saleAmt = amountBlock.saleamt ?? amountBlock.saleAmt ?? 0;
          if (saleAmt <= 0) continue;

          const transType = (amountBlock.saletranstype ?? amountBlock.saleTransType ?? '') as string;
          if (/construction loan|financing/i.test(transType)) continue;

          const addr = prop.address?.oneLine || '';
          if (!addr) continue;
          const addrKey = addr.toLowerCase().trim();
          if (seenAddresses.has(addrKey)) continue;
          seenAddresses.add(addrKey);

          const saleDate = (amountBlock.salerecdate ?? amountBlock.saleRecDate) || prop.sale?.saleTransDate;

          // ── Enriched data extraction (leveraging deal search knowledge) ──
          const isDistressedSale = /foreclosure|reo|bank.owned|short.sale|auction|sheriff|tax.deed|tax.sale/i.test(transType);
          const sellerName = prop.sale?.sellerName || '';
          const isBankSeller = /bank|fannie|freddie|hud|va |fha |dept of|secretary of|wells fargo|chase|citi|nationstar/i.test(sellerName);

          // AVM data per comp
          const avmAmount = prop.avm?.amount;
          const avmValue = avmAmount?.value || null;
          const avmHigh = avmAmount?.high || null;
          const avmLow = avmAmount?.low || null;
          const avmConfidence = avmAmount?.scr || null;
          const avmPoorHigh = prop.avm?.condition?.avmpoorhigh || null;
          const avmExcellentHigh = prop.avm?.condition?.avmexcellenthigh || null;
          const soldPriceToAvmRatio = avmValue && saleAmt ? Math.round((saleAmt / avmValue) * 100) / 100 : null;

          // Assessment data per comp
          const assessed = prop.assessment?.assessed;
          const assdImpr = assessed?.assdImprValue ?? 0;
          const assdLand = assessed?.assdLandValue ?? 0;
          const assessedValue = assessed?.assdTtlValue || ((assdImpr + assdLand) > 0 ? assdImpr + assdLand : null);
          const taxAmount = prop.assessment?.tax?.taxAmt || null;

          // Condition & quality
          const condition = prop.building?.construction?.condition || null;
          const quality = prop.building?.summary?.quality || null;

          const features: Record<string, any> = {};
          // Sale type & distress
          if (transType) features.saleTransType = transType;
          if (isDistressedSale || isBankSeller) features.isDistressedSale = true;
          if (isBankSeller && !isDistressedSale) features.distressReason = 'bank_seller';
          if (sellerName) features.sellerName = sellerName;
          // AVM
          if (avmValue) features.avmValue = avmValue;
          if (avmHigh) features.avmHigh = avmHigh;
          if (avmLow) features.avmLow = avmLow;
          if (avmConfidence) features.avmConfidence = avmConfidence;
          if (avmPoorHigh) features.avmPoorHigh = avmPoorHigh;
          if (avmExcellentHigh) features.avmExcellentHigh = avmExcellentHigh;
          if (soldPriceToAvmRatio) features.soldPriceToAvmRatio = soldPriceToAvmRatio;
          // Assessment
          if (assessedValue) features.assessedValue = assessedValue;
          if (taxAmount) features.taxAmount = taxAmount;
          // Condition
          if (condition) features.condition = condition;
          if (quality) features.quality = quality;

          const distressLabel = (isDistressedSale || isBankSeller)
            ? ` | DISTRESSED: ${transType || 'Bank-owned'}`
            : '';
          const avmLabel = avmValue ? ` | AVM: $${avmValue.toLocaleString()}` : '';

          const comp = {
            address: addr,
            soldPrice: saleAmt,
            soldDate: saleDate ? new Date(saleDate) : new Date(),
            distance: prop.location?.distance ?? radius,
            bedrooms: prop.building?.rooms?.beds ?? undefined,
            bathrooms: prop.building?.rooms?.bathstotal ?? undefined,
            sqft: prop.building?.size?.universalsize ?? undefined,
            lotSize: prop.lot?.lotsize1 ?? undefined,
            yearBuilt: prop.building?.summary?.yearbuilteffective ?? prop.summary?.yearbuilt ?? undefined,
            hasGarage: !!prop.building?.parking?.garagetype,
            latitude: prop.location?.latitude ? parseFloat(prop.location.latitude) : undefined,
            longitude: prop.location?.longitude ? parseFloat(prop.location.longitude) : undefined,
            notes: `ATTOM verified sale | ${transType || 'Resale'}${distressLabel}${avmLabel} | Deed: ${prop.sale?.amount?.saleRecDate || 'N/A'}`,
            similarityScore: 0,
            features,
          };

          // Calculate similarity if lead data is available
          if (lead) {
            comp.similarityScore = this.calculateCompSimilarity(lead, comp);
          }

          validComps.push(comp);
          compSourceProps.set(addr, prop);
        }

        this.logger.log(`ATTOM comp search: ${validComps.length} valid comps after filtering at radius=${radius}mi`);
        if (validComps.length >= 3) break;
      } catch (error) {
        this.handleError(error, `fetchCompsFromAttom (radius=${radius})`);
        // Continue to next radius tier on error
      }
    }

    if (validComps.length === 0) {
      this.logger.warn(`ATTOM comp search: 0 valid comps found across all radius tiers`);
      return null;
    }

    // Enrich comps missing bedrooms/bathrooms via expandedprofile
    await this.enrichCompDetails(validComps, compSourceProps);

    // Recalculate similarity scores after enrichment (bed/bath data may have changed)
    if (lead) {
      for (const comp of validComps) {
        comp.similarityScore = this.calculateCompSimilarity(lead, comp);
      }
    }

    // Clear old ATTOM comps (not part of an analysis)
    await this.prisma.comp.deleteMany({
      where: { leadId, source: 'attom', analysisId: null },
    });

    // Debug: log enrichment field presence from first comp
    if (validComps.length > 0) {
      const sample = validComps[0].features;
      const fieldPresence = {
        hasAvm: !!sample.avmValue,
        hasAssessment: !!sample.assessedValue,
        hasCondition: !!sample.condition,
        hasSaleType: !!sample.saleTransType,
        distressedCount: validComps.filter(c => c.features.isDistressedSale).length,
      };
      this.logger.log(`ATTOM comp enrichment field presence: ${JSON.stringify(fieldPresence)}`);
    }

    // Save comps
    for (const comp of validComps) {
      await this.prisma.comp.create({
        data: {
          leadId,
          source: 'attom',
          address: comp.address,
          soldPrice: comp.soldPrice,
          soldDate: comp.soldDate,
          distance: comp.distance,
          bedrooms: comp.bedrooms,
          bathrooms: comp.bathrooms,
          sqft: comp.sqft,
          lotSize: comp.lotSize,
          yearBuilt: comp.yearBuilt,
          hasGarage: comp.hasGarage,
          latitude: comp.latitude,
          longitude: comp.longitude,
          correlation: null,
          notes: comp.notes,
          selected: comp.distance <= 1.0,
          similarityScore: comp.similarityScore,
          features: Object.keys(comp.features).length > 0 ? comp.features : undefined,
        },
      });
    }

    this.logger.log(`ATTOM: saved ${validComps.length} comps for lead ${leadId}`);

    // Calculate ARV (distance-weighted average)
    const totalWeight = validComps.reduce((sum, c) => sum + (1 / Math.max(c.distance, 0.1)), 0);
    const weightedArv = validComps.reduce(
      (sum, c) => sum + (c.soldPrice * (1 / Math.max(c.distance, 0.1))),
      0,
    ) / totalWeight;
    const arv = Math.round(weightedArv);

    const prices = validComps.map((c) => c.soldPrice).sort((a, b) => a - b);
    const arvLow = prices[0];
    const arvHigh = prices[prices.length - 1];

    // Confidence: count + proximity bonus
    let confidence = validComps.length >= 5 ? 85 : validComps.length >= 3 ? 70 : 50;
    const avgDistance = validComps.reduce((s, c) => s + c.distance, 0) / validComps.length;
    if (avgDistance <= 0.5) confidence += 10;
    else if (avgDistance <= 1.0) confidence += 5;
    confidence = Math.min(confidence, 95);

    // Update lead
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { arv, arvConfidence: confidence, lastCompsDate: new Date() },
    });

    return { compsCount: validComps.length, source: 'attom', arv, arvLow, arvHigh, confidence };
  }

  // ─── Enrich comps missing bedrooms/bathrooms via /property/expandedprofile ─

  private async enrichCompDetails(
    validComps: Array<{
      address: string;
      bedrooms?: number;
      bathrooms?: number;
      sqft?: number;
      yearBuilt?: number;
      [key: string]: any;
    }>,
    compSourceProps: Map<string, AttomProperty>,
  ): Promise<void> {
    const compsToEnrich = validComps.filter((c) => c.bedrooms == null);
    if (compsToEnrich.length === 0) {
      this.logger.log('ATTOM enrichment: all comps already have bedroom data, skipping');
      return;
    }

    this.logger.log(
      `ATTOM enrichment: ${compsToEnrich.length}/${validComps.length} comps missing bedrooms, fetching profiles...`,
    );

    const results = await Promise.allSettled(
      compsToEnrich.map(async (comp) => {
        const sourceProp = compSourceProps.get(comp.address);
        if (!sourceProp?.address) return null;

        // Build structured address from /sale/detail response fields
        const street = sourceProp.address.line1;
        const city = sourceProp.address.locality;
        const state = sourceProp.address.countrySubd;
        const zip = sourceProp.address.postal1;

        if (!street || !city || !state || !zip) {
          this.logger.warn(`ATTOM enrichment: incomplete address for ${comp.address}, skipping`);
          return null;
        }

        const profile = await this.getExpandedProfile({ street, city, state, zip });
        if (!profile) return null;

        // Backfill missing fields only
        const rooms = profile.building?.rooms;
        const size = profile.building?.size;
        const before = { beds: comp.bedrooms, baths: comp.bathrooms, sqft: comp.sqft };

        if (comp.bedrooms == null && rooms?.beds != null) comp.bedrooms = rooms.beds;
        if (comp.bathrooms == null && rooms?.bathstotal != null) comp.bathrooms = rooms.bathstotal;
        if (comp.sqft == null && size?.universalsize != null) comp.sqft = size.universalsize;
        if (comp.yearBuilt == null) {
          comp.yearBuilt = profile.building?.summary?.yearbuilteffective ?? profile.summary?.yearbuilt ?? undefined;
        }

        const filled = [
          comp.bedrooms !== before.beds ? `beds=${comp.bedrooms}` : null,
          comp.bathrooms !== before.baths ? `baths=${comp.bathrooms}` : null,
          comp.sqft !== before.sqft ? `sqft=${comp.sqft}` : null,
        ].filter(Boolean);

        this.logger.log(
          `ATTOM enrichment [${comp.address}]: profile has beds=${rooms?.beds ?? 'null'}, baths=${rooms?.bathstotal ?? 'null'}, sqft=${size?.universalsize ?? 'null'} → ${filled.length > 0 ? `backfilled: ${filled.join(', ')}` : 'no new data found in profile'}`,
        );

        return filled.length > 0 ? comp.address : null;
      }),
    );

    const enriched = results.filter(
      (r) => r.status === 'fulfilled' && r.value != null,
    ).length;
    const failed = results.filter(
      (r) => r.status === 'rejected',
    ).length;

    this.logger.log(
      `ATTOM enrichment complete: ${enriched} enriched, ${compsToEnrich.length - enriched - failed} no profile found, ${failed} failed`,
    );

    // ── RentCast fallback: try RentCast /properties for comps still missing bedrooms ──
    if (!this.rentcast.isConfigured) return;

    const stillMissing = validComps.filter((c) => c.bedrooms == null);
    if (stillMissing.length === 0) return;

    this.logger.log(
      `RentCast fallback: ${stillMissing.length} comps still missing bedrooms after ATTOM, trying RentCast...`,
    );

    const rcResults = await Promise.allSettled(
      stillMissing.map(async (comp) => {
        const sourceProp = compSourceProps.get(comp.address);
        if (!sourceProp?.address) return null;

        const { line1: street, locality: city, countrySubd: state, postal1: zip } = sourceProp.address;
        if (!street || !city || !state || !zip) return null;

        const fullAddr = `${street}, ${city}, ${state} ${zip}`;
        const property = await this.rentcast.getPropertyDetails(fullAddr);
        if (!property) return null;

        const before = { beds: comp.bedrooms, baths: comp.bathrooms, sqft: comp.sqft };

        if (comp.bedrooms == null && property.bedrooms != null) comp.bedrooms = property.bedrooms;
        if (comp.bathrooms == null && property.bathrooms != null) comp.bathrooms = property.bathrooms;
        if (comp.sqft == null && property.squareFootage != null) comp.sqft = property.squareFootage;
        if (comp.yearBuilt == null && property.yearBuilt != null) comp.yearBuilt = property.yearBuilt;

        const filled = [
          comp.bedrooms !== before.beds ? `beds=${comp.bedrooms}` : null,
          comp.bathrooms !== before.baths ? `baths=${comp.bathrooms}` : null,
          comp.sqft !== before.sqft ? `sqft=${comp.sqft}` : null,
        ].filter(Boolean);

        this.logger.log(
          `RentCast fallback [${comp.address}]: beds=${property.bedrooms ?? 'null'}, baths=${property.bathrooms ?? 'null'}, sqft=${property.squareFootage ?? 'null'} → ${filled.length > 0 ? `backfilled: ${filled.join(', ')}` : 'no new data'}`,
        );

        return filled.length > 0 ? comp.address : null;
      }),
    );

    const rcEnriched = rcResults.filter((r) => r.status === 'fulfilled' && r.value != null).length;
    const rcFailed = rcResults.filter((r) => r.status === 'rejected').length;

    this.logger.log(
      `RentCast fallback complete: ${rcEnriched}/${stillMissing.length} comps enriched${rcFailed > 0 ? `, ${rcFailed} failed` : ''}`,
    );
  }

  // ─── Property type mapping for comp search ────────────────────────────────

  private mapPropertyTypeForComps(type?: string | null): string {
    if (!type) return 'SFR';
    const t = type.toLowerCase();
    if (t.includes('single') || t.includes('sfr')) return 'SFR';
    if (t.includes('condo')) return 'CONDO';
    if (t.includes('townhouse') || t.includes('town')) return 'TOWNHOUSE';
    if (t.includes('multi') || t.includes('duplex')) return 'MULTI-FAMILY';
    return 'SFR';
  }

  // ─── Similarity score: beds/baths/sqft match (0-100) ──────────────────────

  private calculateCompSimilarity(
    subject: { bedrooms?: number | null; bathrooms?: number | null; sqft?: number | null; propertyType?: string | null },
    comp: { bedrooms?: number; bathrooms?: number; sqft?: number },
  ): number {
    let score = 0;
    let maxScore = 0;

    // Bedrooms (25 pts)
    maxScore += 25;
    if (subject.bedrooms != null && comp.bedrooms != null) {
      const diff = Math.abs(subject.bedrooms - comp.bedrooms);
      if (diff === 0) score += 25;
      else if (diff === 1) score += 15;
      else if (diff === 2) score += 5;
    }

    // Bathrooms (25 pts)
    maxScore += 25;
    if (subject.bathrooms != null && comp.bathrooms != null) {
      const diff = Math.abs(subject.bathrooms - comp.bathrooms);
      if (diff === 0) score += 25;
      else if (diff <= 0.5) score += 20;
      else if (diff <= 1) score += 10;
      else if (diff <= 1.5) score += 5;
    }

    // Sqft (40 pts)
    maxScore += 40;
    if (subject.sqft && comp.sqft && subject.sqft > 0) {
      const pctDiff = (Math.abs(subject.sqft - comp.sqft) / subject.sqft) * 100;
      if (pctDiff <= 5) score += 40;
      else if (pctDiff <= 10) score += 35;
      else if (pctDiff <= 15) score += 25;
      else if (pctDiff <= 20) score += 15;
      else if (pctDiff <= 30) score += 5;
    }

    // Property type (10 pts — not available in comp, give benefit of doubt)
    maxScore += 10;
    score += 10;

    return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  }

  // ─── Area-based property snapshot (for Deal Search) ───────────────────────

  async getPropertySnapshot(
    geoIdV4: string,
    params?: {
      propertytype?: string;
      minUniversalSize?: number;
      maxUniversalSize?: number;
      minyearbuilt?: number;
      maxyearbuilt?: number;
      minBeds?: number;
      maxBeds?: number;
      minBathsTotal?: number;
      maxBathsTotal?: number;
      page?: number;
      pagesize?: number;
    },
  ): Promise<{ property: AttomProperty[]; total: number }> {
    if (!this.apiKey) return { property: [], total: 0 };

    this.logger.log(`ATTOM property/snapshot for geoIdV4=${geoIdV4}`);

    try {
      const response = await axios.get(
        `${ATTOM_BASE}/property/snapshot`,
        {
          params: { geoid: geoIdV4, ...params, pagesize: params?.pagesize || 50 },
          headers: { apikey: this.apiKey, Accept: 'application/json' },
          timeout: 30000,
        },
      );

      const properties = response.data?.property || [];
      const total = response.data?.status?.total || properties.length;
      this.logger.log(`ATTOM property/snapshot returned ${properties.length} properties (total=${total})`);
      return { property: properties, total };
    } catch (error) {
      this.handleError(error, 'getPropertySnapshot');
      return { property: [], total: 0 };
    }
  }

  // ─── Area-based sale snapshot (for Deal Search) ──────────────────────────

  async getSaleSnapshot(
    geoIdV4: string,
    params?: {
      startsalesearchdate?: string;
      endsalesearchdate?: string;
      minsaleamt?: number;
      maxsaleamt?: number;
      page?: number;
      pagesize?: number;
    },
  ): Promise<{ property: any[]; total: number }> {
    if (!this.apiKey) return { property: [], total: 0 };

    this.logger.log(`ATTOM sale/snapshot for geoIdV4=${geoIdV4}`);

    try {
      const response = await axios.get(
        `${ATTOM_BASE}/sale/snapshot`,
        {
          params: { geoid: geoIdV4, ...params, pagesize: params?.pagesize || 50 },
          headers: { apikey: this.apiKey, Accept: 'application/json' },
          timeout: 30000,
        },
      );

      const properties = response.data?.property || [];
      const total = response.data?.status?.total || properties.length;
      this.logger.log(`ATTOM sale/snapshot returned ${properties.length} properties (total=${total})`);
      return { property: properties, total };
    } catch (error) {
      this.handleError(error, 'getSaleSnapshot');
      return { property: [], total: 0 };
    }
  }

  // ─── Area-based assessment snapshot (for Deal Search) ────────────────────

  async getAssessmentSnapshot(
    geoIdV4: string,
    params?: {
      page?: number;
      pagesize?: number;
    },
  ): Promise<{ property: any[]; total: number }> {
    if (!this.apiKey) return { property: [], total: 0 };

    this.logger.log(`ATTOM assessment/snapshot for geoIdV4=${geoIdV4}`);

    try {
      const response = await axios.get(
        `${ATTOM_BASE}/assessment/snapshot`,
        {
          params: { geoid: geoIdV4, ...params, pagesize: params?.pagesize || 50 },
          headers: { apikey: this.apiKey, Accept: 'application/json' },
          timeout: 30000,
        },
      );

      const properties = response.data?.property || [];
      const total = response.data?.status?.total || properties.length;
      this.logger.log(`ATTOM assessment/snapshot returned ${properties.length} properties (total=${total})`);
      return { property: properties, total };
    } catch (error) {
      this.handleError(error, 'getAssessmentSnapshot');
      return { property: [], total: 0 };
    }
  }

  // ─── Foreclosure / pre-foreclosure events (for Deal Search) ──────────────

  async getForeclosureEvents(
    geoIdV4: string,
    params?: {
      starteventdate?: string;
      endeventdate?: string;
      page?: number;
      pagesize?: number;
    },
  ): Promise<{ property: any[]; total: number }> {
    if (!this.apiKey) return { property: [], total: 0 };

    this.logger.log(`ATTOM allevents/detail for geoIdV4=${geoIdV4}`);

    try {
      const response = await axios.get(
        `${ATTOM_BASE}/allevents/detail`,
        {
          params: { geoid: geoIdV4, ...params, pagesize: params?.pagesize || 50 },
          headers: { apikey: this.apiKey, Accept: 'application/json' },
          timeout: 30000,
        },
      );

      const properties = response.data?.property || [];
      const total = response.data?.status?.total || properties.length;
      this.logger.log(`ATTOM allevents/detail returned ${properties.length} events (total=${total})`);
      return { property: properties, total };
    } catch (error) {
      this.handleError(error, 'getForeclosureEvents');
      return { property: [], total: 0 };
    }
  }

  // ─── Error handler ────────────────────────────────────────────────────────

  private handleError(error: unknown, method: string) {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const msg = error.response?.data?.status?.msg || error.message;
      if (status === 429) this.logger.warn(`ATTOM rate limit in ${method}`);
      else if (status === 401) this.logger.error(`ATTOM API key invalid in ${method}`);
      else if (status === 400) this.logger.warn(`ATTOM no results in ${method}: ${msg}`);
      else this.logger.error(`ATTOM API error in ${method} (${status}): ${msg}`);
    } else {
      this.logger.error(`ATTOM ${method} failed:`, error);
    }
  }
}
