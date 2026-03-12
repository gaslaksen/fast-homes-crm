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
  coolingType?: string;
  heatingType?: string;
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
      coolingType: prop.utilities?.coolingtype,
      heatingType: prop.utilities?.heatingtype,
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

    await this.prisma.lead.update({ where: { id: leadId }, data: update });

    this.logger.log(
      `ATTOM enrichment saved for lead ${leadId}: ` +
      `AVM=$${e.attomAvm?.toLocaleString() ?? '?'}, ` +
      `ARV(excellent)=$${e.avmExcellentHigh?.toLocaleString() ?? '?'}, ` +
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
