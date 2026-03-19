import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios, { AxiosError } from 'axios';

const ATTOM_BASE = 'https://api.gateway.attomdata.com/propertyapi/v1.0.0';

// ─── ATTOM Response Types ────────────────────────────────────────────────────

interface AttomProperty {
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
    if (!lead.lotSize   && e.lotSizeFromAttom) update.lotSize   = e.lotSizeFromAttom;
    if (!lead.latitude  && e.latitude)  update.latitude  = e.latitude;
    if (!lead.longitude && e.longitude) update.longitude = e.longitude;
    if (!lead.lastSaleDate  && e.lastSaleDateFromAttom)  update.lastSaleDate  = new Date(e.lastSaleDateFromAttom);
    if (!lead.lastSalePrice && e.lastSalePriceFromAttom) update.lastSalePrice = e.lastSalePriceFromAttom;
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
    }> = [];

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
            notes: `ATTOM verified sale | ${transType || 'Resale'} | Deed: ${prop.sale?.amount?.saleRecDate || 'N/A'}`,
            similarityScore: 0,
          };

          // Calculate similarity if lead data is available
          if (lead) {
            comp.similarityScore = this.calculateCompSimilarity(lead, comp);
          }

          validComps.push(comp);
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

    // Clear old ATTOM comps (not part of an analysis)
    await this.prisma.comp.deleteMany({
      where: { leadId, source: 'attom', analysisId: null },
    });

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
