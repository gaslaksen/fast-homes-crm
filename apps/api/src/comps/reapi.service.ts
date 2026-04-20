import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios, { AxiosError } from 'axios';
import {
  ReapiPropertyData,
  ReapiComp,
  ReapiPropertyDetailResponse,
  ReapiPropertyCompsResponse,
  ReapiPropGPTResponse,
  ReapiMortgageRecord,
  ReapiSaleRecord,
  PropGPTParsed,
} from './reapi.types';

const REAPI_BASE_URL = 'https://api.realestateapi.com';
const CACHE_TTL_HOURS = 24;

interface EnrichAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface ReapiEnrichmentResult {
  // Core lead fields
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  lotSize?: number;             // acres
  yearBuilt?: number;
  propertyType?: string;
  lastSaleDate?: string;
  lastSalePrice?: number;
  taxAssessedValue?: number;
  annualTaxAmount?: number;
  ownerOccupied?: boolean;
  ownerName?: string;
  hoaFee?: number;
  latitude?: number;
  longitude?: number;
  apn?: string;
  subdivision?: string;
  stories?: number;
  basementSqft?: number;
  coolingType?: string;
  heatingType?: string;
  propertyCondition?: string;

  // REAPI-specific blobs
  reapiId?: string;
  estimatedValue?: number;
  estimatedValueLow?: number;
  estimatedValueHigh?: number;
  equity?: number;
  mortgageData?: Record<string, unknown>;   // normalized to attom-like shape for UI reuse
  saleHistory?: Array<Record<string, unknown>>;
  features?: Record<string, unknown>;
  ownerData?: Record<string, unknown>;
}

function normalizeLotAcres(lotSquareFeet: number | undefined): number | undefined {
  if (!lotSquareFeet) return undefined;
  return parseFloat((lotSquareFeet / 43560).toFixed(4));
}

function toNumber(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Map REAPI loan type codes to the codes the Overview tab's mortgage UI
 * already understands (CNV/FHA/VA/USDA/HEL/RVS).
 */
function mapLoanTypeCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const up = code.toUpperCase();
  if (up === 'COV' || up === 'CONV' || up === 'CNV') return 'CNV';
  if (up === 'FHA') return 'FHA';
  if (up === 'VA') return 'VA';
  if (up === 'USDA') return 'USDA';
  return up;
}

/** "Month"/"Year" → "MOS"/"YRS" to match the UI's termType handling. */
function mapTermType(tt: string | undefined): string | undefined {
  if (!tt) return undefined;
  const up = tt.toUpperCase();
  if (up.startsWith('MONTH') || up === 'MOS' || up === 'M') return 'MOS';
  if (up.startsWith('YEAR') || up === 'YRS' || up === 'Y') return 'YRS';
  return up;
}

/** "Fixed"/"Adjustable" → "FIX"/"ARM" for UI display. */
function mapRateType(rt: string | null | undefined): string | undefined {
  if (!rt) return undefined;
  const up = rt.toUpperCase();
  if (up.includes('FIX')) return 'FIX';
  if (up.includes('ADJ') || up === 'ARM') return 'ARM';
  return up;
}

@Injectable()
export class ReapiService {
  private readonly logger = new Logger(ReapiService.name);
  private readonly apiKey: string | undefined;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('REAPI_API_KEY');
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  private formatAddress(addr: EnrichAddress): string {
    return `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}`;
  }

  private headers() {
    return {
      'x-api-key': this.apiKey!,
      'x-user-id': 'fast-homes-crm',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private handleApiError(err: unknown, context: string) {
    if (err instanceof AxiosError) {
      this.logger.warn(
        `REAPI ${context} failed: ${err.response?.status ?? 'no-status'} ${err.message}${
          err.response?.data ? ` — ${JSON.stringify(err.response.data).slice(0, 300)}` : ''
        }`,
      );
    } else {
      this.logger.warn(`REAPI ${context} failed: ${(err as Error).message}`);
    }
  }

  // ─── Property Detail ──────────────────────────────────────────────────────

  /**
   * POST /v2/PropertyDetail — returns full property profile.
   * Returns the `data` object (deeply nested) or null if 404 / no data.
   */
  async getPropertyDetails(address: string): Promise<ReapiPropertyData | null> {
    if (!this.apiKey) return null;

    this.logger.log(`Fetching REAPI property details for: ${address}`);

    try {
      const response = await axios.post<ReapiPropertyDetailResponse>(
        `${REAPI_BASE_URL}/v2/PropertyDetail`,
        { address },
        { headers: this.headers(), timeout: 20000 },
      );

      const body = response.data;
      if (body?.statusCode && body.statusCode >= 400) {
        this.logger.warn(`REAPI PropertyDetail ${body.statusCode}: ${body.statusMessage} for "${address}"`);
        return null;
      }

      const data = body?.data;
      if (!data || Object.keys(data).length === 0) {
        this.logger.warn(`REAPI PropertyDetail returned empty data for "${address}"`);
        return null;
      }

      const info = data.propertyInfo;
      this.logger.log(
        `REAPI property found: ${info?.bedrooms ?? '?'}bd/${info?.bathrooms ?? '?'}ba, ` +
        `${info?.buildingSquareFeet ?? info?.livingSquareFeet ?? '?'} sqft, built ${info?.yearBuilt ?? '?'}, ` +
        `AVM $${(data.estimatedValue ?? 0).toLocaleString()}`,
      );

      return data;
    } catch (err) {
      this.handleApiError(err, 'getPropertyDetails');
      return null;
    }
  }

  // ─── Comps ────────────────────────────────────────────────────────────────

  /**
   * POST /v3/PropertyComps — returns `{ subject, comps[], reapiAvm, reapiAvmLow, reapiAvmHigh }`.
   * Only accepts `address` or `id` in the body; radius/size are not supported.
   */
  async getComps(address: string): Promise<ReapiPropertyCompsResponse | null> {
    if (!this.apiKey) return null;

    try {
      this.logger.log(`Fetching REAPI comps for: ${address}`);
      const response = await axios.post<ReapiPropertyCompsResponse>(
        `${REAPI_BASE_URL}/v3/PropertyComps`,
        { address },
        { headers: this.headers(), timeout: 45000 },
      );

      const body = response.data;
      if (body?.statusCode && body.statusCode >= 400) {
        this.logger.warn(`REAPI PropertyComps ${body.statusCode}: ${body.statusMessage} for "${address}"`);
        return null;
      }
      this.logger.log(
        `REAPI returned ${body?.comps?.length ?? 0} comps, subject AVM $${(body?.reapiAvm ?? 0).toLocaleString()}`,
      );
      return body;
    } catch (err) {
      this.handleApiError(err, 'getComps');
      return null;
    }
  }

  // ─── Lead Enrichment ──────────────────────────────────────────────────────

  async enrichLead(
    leadId: string,
    address: EnrichAddress,
    opts?: { forceRefresh?: boolean },
  ): Promise<ReapiEnrichmentResult | null> {
    if (!this.isConfigured) return null;

    // 24h cache check
    if (!opts?.forceRefresh) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        select: { reapiEnrichedAt: true },
      });
      if (lead?.reapiEnrichedAt) {
        const ageMs = Date.now() - lead.reapiEnrichedAt.getTime();
        if (ageMs < CACHE_TTL_HOURS * 60 * 60 * 1000) {
          this.logger.log(`REAPI enrichment fresh for lead ${leadId} (<24h) — skipping`);
          return null;
        }
      }
    }

    const data = await this.getPropertyDetails(this.formatAddress(address));
    if (!data) {
      this.logger.warn(`REAPI enrichment: no property found for lead ${leadId}`);
      return null;
    }

    const result = this.mapPropertyToEnrichment(data);

    const existing = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        bedrooms: true, bathrooms: true, sqft: true, propertyType: true,
        yearBuilt: true, lotSize: true, latitude: true, longitude: true,
        apn: true, ownerName: true, ownerOccupied: true, hoaFee: true,
        subdivision: true, lastSaleDate: true, lastSalePrice: true,
        taxAssessedValue: true, annualTaxAmount: true,
        stories: true, basementSqft: true, coolingType: true, heatingType: true,
        propertyCondition: true,
      },
    });

    const updates: Record<string, unknown> = {};
    if (!existing?.bedrooms && result.bedrooms) updates.bedrooms = result.bedrooms;
    if (!existing?.bathrooms && result.bathrooms) updates.bathrooms = result.bathrooms;
    if (!existing?.sqft && result.sqft) updates.sqft = result.sqft;
    if (!existing?.propertyType && result.propertyType) updates.propertyType = result.propertyType;
    if (!existing?.yearBuilt && result.yearBuilt) updates.yearBuilt = result.yearBuilt;
    if (!existing?.lotSize && result.lotSize) updates.lotSize = result.lotSize;
    if (!existing?.latitude && result.latitude) updates.latitude = result.latitude;
    if (!existing?.longitude && result.longitude) updates.longitude = result.longitude;
    if (!existing?.apn && result.apn) updates.apn = result.apn;
    if (!existing?.ownerName && result.ownerName) updates.ownerName = result.ownerName;
    if (existing?.ownerOccupied == null && result.ownerOccupied != null) updates.ownerOccupied = result.ownerOccupied;
    if (!existing?.hoaFee && result.hoaFee) updates.hoaFee = result.hoaFee;
    if (!existing?.subdivision && result.subdivision) updates.subdivision = result.subdivision;
    if (!existing?.stories && result.stories) updates.stories = result.stories;
    if (!existing?.basementSqft && result.basementSqft) updates.basementSqft = result.basementSqft;
    if (!existing?.coolingType && result.coolingType) updates.coolingType = result.coolingType;
    if (!existing?.heatingType && result.heatingType) updates.heatingType = result.heatingType;
    if (!existing?.propertyCondition && result.propertyCondition) updates.propertyCondition = result.propertyCondition;
    if (!existing?.lastSaleDate && result.lastSaleDate) updates.lastSaleDate = new Date(result.lastSaleDate);
    if (!existing?.lastSalePrice && result.lastSalePrice) updates.lastSalePrice = result.lastSalePrice;
    if (!existing?.taxAssessedValue && result.taxAssessedValue) updates.taxAssessedValue = result.taxAssessedValue;
    if (!existing?.annualTaxAmount && result.annualTaxAmount) updates.annualTaxAmount = result.annualTaxAmount;

    // REAPI-specific blobs — always overwrite
    updates.reapiId = result.reapiId ?? null;
    updates.reapiEnrichedAt = new Date();
    if (result.estimatedValue != null) updates.reapiEstimatedValue = result.estimatedValue;
    if (result.estimatedValueLow != null) updates.reapiEstimatedValueLow = result.estimatedValueLow;
    if (result.estimatedValueHigh != null) updates.reapiEstimatedValueHigh = result.estimatedValueHigh;
    if (result.equity != null) updates.reapiEquity = result.equity;
    if (result.mortgageData) updates.reapiMortgageData = result.mortgageData;
    if (result.saleHistory) updates.reapiSaleHistory = result.saleHistory;
    if (result.features) updates.reapiFeatures = result.features;
    if (result.ownerData) updates.reapiOwnerData = result.ownerData;

    await this.prisma.lead.update({ where: { id: leadId }, data: updates });

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'FIELD_UPDATED',
        description: `Property enriched from REAPI (${Object.keys(updates).filter(k => !k.startsWith('reapi')).join(', ') || 'REAPI-only fields'})`,
        metadata: { source: 'reapi', fields: Object.keys(updates) },
      },
    });

    this.logger.log(`REAPI enrichment complete for lead ${leadId}`);
    return result;
  }

  /**
   * Translate a REAPI PropertyDetail response into fields we write to Lead.
   * All nested sections are pulled into a normalized shape.
   */
  private mapPropertyToEnrichment(d: ReapiPropertyData): ReapiEnrichmentResult {
    const info = d.propertyInfo;
    const lot = d.lotInfo;
    const owner = d.ownerInfo;
    const tax = d.taxInfo;
    const lastSale = d.lastSale;

    const sqft = info?.buildingSquareFeet ?? info?.livingSquareFeet;
    const lotSqft = lot?.lotSquareFeet ?? info?.lotSquareFeet;
    const lotAcresRaw = lot?.lotAcres;
    const lotAcres = lotAcresRaw != null ? toNumber(lotAcresRaw) : normalizeLotAcres(lotSqft);

    // Pick best last-sale: top-level fields first, then lastSale nested
    const topLastPrice = toNumber(d.lastSalePrice);
    const nestedLastPrice = toNumber(lastSale?.saleAmount);
    const lastSalePriceBest = (topLastPrice && topLastPrice > 0) ? topLastPrice
                           : (nestedLastPrice && nestedLastPrice > 0) ? nestedLastPrice
                           : undefined;
    const lastSaleDateBest = d.lastSaleDate || lastSale?.saleDate || lastSale?.recordingDate;

    // Map mortgages to attom-compatible shape so the existing Overview UI works
    const mortgageData = this.mapMortgages(d.currentMortgages);

    // Sale history → attom-compatible shape
    const saleHistory = this.mapSaleHistory(d.saleHistory, sqft);

    // Features
    const features: Record<string, unknown> = {};
    if (info?.pool != null) features.hasPool = info.pool;
    if (info?.garageType) features.garageType = info.garageType;
    if (info?.garageSquareFeet != null) features.garageSquareFeet = info.garageSquareFeet;
    if (info?.parkingSpaces != null) features.parkingSpaces = info.parkingSpaces;
    if (info?.basementType) features.basementType = info.basementType;
    if (info?.basementSquareFeet != null) features.basementSquareFeet = info.basementSquareFeet;
    if (info?.stories != null) features.stories = info.stories;
    if (info?.heatingType) features.heatingType = info.heatingType;
    if (info?.airConditioningType) features.coolingType = info.airConditioningType;
    if (info?.fireplace != null) features.fireplace = info.fireplace;
    if (info?.patio != null) features.patio = info.patio;

    // Owner blob
    const ownerData: Record<string, unknown> = {
      ownerName: owner?.owner1FullName,
      ownerNames: [owner?.owner1FullName, owner?.owner2FullName].filter(Boolean),
      mailAddress: owner?.mailAddress,
      absenteeOwner: owner?.absenteeOwner,
      corporateOwned: owner?.corporateOwned,
      ownerOccupied: owner?.ownerOccupied,
      ownershipLength: owner?.ownershipLength,
    };

    // AVM range — REAPI PropertyDetail only returns a point estimate. For a
    // range we'd normally pull from PropertyComps. As a rough default
    // construct ±5% so the Overview tab has something to render.
    const avm = d.estimatedValue;
    const avmLow = avm ? Math.round(avm * 0.95) : undefined;
    const avmHigh = avm ? Math.round(avm * 1.05) : undefined;

    return {
      bedrooms: info?.bedrooms,
      bathrooms: info?.bathrooms,
      sqft,
      lotSize: lotAcres,
      yearBuilt: info?.yearBuilt,
      propertyType: d.propertyType ?? info?.propertyUse,
      lastSaleDate: lastSaleDateBest,
      lastSalePrice: lastSalePriceBest,
      taxAssessedValue: tax?.assessedValue,
      annualTaxAmount: toNumber(tax?.taxAmount),
      ownerOccupied: owner?.ownerOccupied ?? d.ownerOccupied,
      ownerName: owner?.owner1FullName,
      hoaFee: undefined,
      latitude: info?.latitude,
      longitude: info?.longitude,
      apn: lot?.apn ?? undefined,
      subdivision: lot?.subdivision,
      stories: info?.stories ?? undefined,
      basementSqft: info?.basementSquareFeet ?? undefined,
      coolingType: info?.airConditioningType ?? undefined,
      heatingType: info?.heatingType ?? undefined,
      propertyCondition: (info as any)?.buildingCondition ?? undefined,

      reapiId: d.id != null ? String(d.id) : undefined,
      estimatedValue: avm,
      estimatedValueLow: avmLow,
      estimatedValueHigh: avmHigh,
      equity: d.estimatedEquity ?? d.equity,
      mortgageData,
      saleHistory,
      features: Object.keys(features).length > 0 ? features : undefined,
      ownerData,
    };
  }

  /**
   * Normalize REAPI currentMortgages[] → ATTOM-compatible
   * { firstConcurrent, secondConcurrent, title? } shape so the existing
   * Overview tab mortgage panel can render it without changes.
   */
  private mapMortgages(mortgages: ReapiMortgageRecord[] | undefined): Record<string, unknown> | undefined {
    if (!mortgages || mortgages.length === 0) return undefined;
    const toAttom = (m: ReapiMortgageRecord) => ({
      amount: m.amount,
      lenderLastName: m.lenderName,
      date: m.documentDate ?? m.recordingDate,
      dueDate: m.maturityDate,
      interestRate: m.interestRate,
      interestRateType: mapRateType(m.interestRateType),
      loanTypeCode: mapLoanTypeCode(m.loanTypeCode),
      term: toNumber(m.term),
      termType: mapTermType(m.termType),
    });

    const first = mortgages.find((m) => (m.position || '').toLowerCase() === 'first') ?? mortgages[0];
    const second = mortgages.find((m) => (m.position || '').toLowerCase() === 'second');

    return {
      firstConcurrent: first ? toAttom(first) : undefined,
      secondConcurrent: second ? toAttom(second) : undefined,
    };
  }

  /**
   * Normalize REAPI saleHistory[] → ATTOM-compatible array of
   * { saleTransDate, saleAmt, saleTransType, pricePerSqft }.
   */
  private mapSaleHistory(history: ReapiSaleRecord[] | undefined, sqft: number | undefined): Array<Record<string, unknown>> | undefined {
    if (!history || history.length === 0) return undefined;
    return history
      .filter((s) => s.saleDate || s.recordingDate)
      .sort((a, b) => {
        const da = new Date(a.saleDate || a.recordingDate || 0).getTime();
        const db = new Date(b.saleDate || b.recordingDate || 0).getTime();
        return db - da;
      })
      .map((s) => ({
        saleTransDate: s.saleDate || s.recordingDate,
        saleAmt: s.saleAmount ?? 0,
        saleTransType: s.transactionType || s.purchaseMethod,
        pricePerSqft: (s.saleAmount && sqft && sqft > 0) ? Math.round((s.saleAmount / sqft) * 100) / 100 : undefined,
      }));
  }

  // ─── Comps Fetch + Persist ────────────────────────────────────────────────

  /**
   * Fetch comps from REAPI and persist them with source='reapi'.
   * Uses REAPI's subject AVM (reapiAvm) as the ARV — which is better than a
   * simple comps average in non-disclosure states where lastSaleAmount is 0.
   * For each comp we use lastSaleAmount if > 0, else fall back to estimatedValue
   * (the comp's AVM) and annotate notes so users can see the distinction.
   */
  async fetchAndSaveComps(
    leadId: string,
    address: EnrichAddress,
    _opts?: { forceRefresh?: boolean },
  ): Promise<{ arv: number; arvLow?: number; arvHigh?: number; confidence: number; compsCount: number; source: string }> {
    const full = this.formatAddress(address);
    const result = await this.getComps(full);

    if (!result || !result.comps || result.comps.length === 0) {
      return { arv: 0, arvLow: 0, arvHigh: 0, confidence: 0, compsCount: 0, source: 'reapi (no data)' };
    }

    await this.prisma.comp.deleteMany({
      where: { leadId, source: 'reapi', analysisId: null },
    });

    let nonDisclosedCount = 0;
    let saved = 0;
    for (const c of result.comps) {
      if (!c.lastSaleDate) continue;
      const recordedSale = toNumber(c.lastSaleAmount);
      const avm = toNumber(c.estimatedValue);
      // Use recorded sale if > 0, else AVM fallback
      const soldPrice = (recordedSale && recordedSale > 0) ? recordedSale : avm;
      if (!soldPrice || soldPrice <= 0) continue;

      const isAvmFallback = !recordedSale || recordedSale === 0;
      if (isAvmFallback) nonDisclosedCount += 1;

      const compAddress = c.address?.address || c.address?.label || 'Unknown';

      try {
        await this.prisma.comp.create({
          data: {
            leadId,
            address: compAddress,
            distance: c.distance ?? 0,
            soldPrice,
            soldDate: new Date(c.lastSaleDate),
            daysOnMarket: null,
            bedrooms: c.bedrooms ?? null,
            bathrooms: c.bathrooms ?? null,
            sqft: toNumber(c.squareFeet) ?? null,
            lotSize: normalizeLotAcres(toNumber(c.lotSquareFeet)) ?? null,
            yearBuilt: toNumber(c.yearBuilt) ?? null,
            propertyType: c.propertyType ?? null,
            hasPool: c.pool ?? false,
            hasGarage: c.garageAvailable ?? false,
            latitude: c.latitude ?? null,
            longitude: c.longitude ?? null,
            similarityScore: null,
            selected: true,
            source: 'reapi',
            notes: isAvmFallback
              ? 'Sale price non-disclosed — using REAPI AVM as price estimate'
              : undefined,
          },
        });
        saved += 1;
      } catch (err) {
        this.logger.warn(`Failed to save REAPI comp "${compAddress}": ${(err as Error).message}`);
      }
    }

    // ARV: prefer REAPI's subject AVM; fall back to comps average
    let arv = result.reapiAvm ?? 0;
    let arvLow = result.reapiAvmLow;
    let arvHigh = result.reapiAvmHigh;

    if (!arv) {
      const savedComps = await this.prisma.comp.findMany({
        where: { leadId, source: 'reapi', analysisId: null },
      });
      if (savedComps.length > 0) {
        const prices = savedComps.map((c) => c.soldPrice).sort((a, b) => a - b);
        arv = Math.round(prices.reduce((s, v) => s + v, 0) / prices.length);
        arvLow = prices[0];
        arvHigh = prices[prices.length - 1];
      }
    }

    // Confidence: higher when AVM-only is minority of comps, and when we have more comps
    let confidence = 0;
    if (arv && saved > 0) {
      const disclosedRatio = 1 - (nonDisclosedCount / saved);
      confidence = Math.max(40, Math.min(95, Math.round(55 + saved * 1.2 + disclosedRatio * 15)));
    }

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        arv: Math.round(arv) || undefined,
        arvConfidence: confidence || undefined,
        lastCompsDate: new Date(),
        // Also update the REAPI AVM columns so the Overview tab reflects them
        reapiEstimatedValue: arv || undefined,
        reapiEstimatedValueLow: arvLow || undefined,
        reapiEstimatedValueHigh: arvHigh || undefined,
      },
    });

    const sourceLabel = nonDisclosedCount === saved
      ? 'reapi (AVM-based — non-disclosure)'
      : nonDisclosedCount > 0
        ? `reapi (${saved - nonDisclosedCount} disclosed + ${nonDisclosedCount} AVM)`
        : 'reapi';

    return { arv: Math.round(arv), arvLow, arvHigh, confidence, compsCount: saved, source: sourceLabel };
  }

  // ─── PropGPT ──────────────────────────────────────────────────────────────

  /**
   * REAPI PropGPT endpoint — POST /v2/PropGPT.
   * Accepts a natural-language `query`; returns text. Requires both
   * x-api-key (REAPI) and x-openai-key headers.
   */
  async runPropGPT(
    address: string,
    subject: {
      bedrooms?: number | null;
      bathrooms?: number | null;
      sqft?: number | null;
      yearBuilt?: number | null;
      lotSize?: number | null;
      propertyType?: string | null;
      askingPrice?: number | null;
      condition?: string | null;
    },
    compsContext?: Array<{ address: string; soldPrice: number; sqft?: number | null; distance?: number | null }>,
  ): Promise<PropGPTParsed | null> {
    if (!this.apiKey) return null;

    const openaiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!openaiKey) {
      this.logger.warn('PropGPT requires OPENAI_API_KEY — skipping');
      return null;
    }

    const subjectLine = [
      `${subject.bedrooms ?? '?'}bd/${subject.bathrooms ?? '?'}ba`,
      subject.sqft ? `${subject.sqft} sqft` : null,
      subject.yearBuilt ? `built ${subject.yearBuilt}` : null,
      subject.lotSize ? `${subject.lotSize} ac lot` : null,
      subject.propertyType ?? null,
      subject.condition ? `condition: ${subject.condition}` : null,
      subject.askingPrice ? `seller asking $${subject.askingPrice.toLocaleString()}` : null,
    ].filter(Boolean).join(', ');

    const compsLine = compsContext && compsContext.length > 0
      ? compsContext.slice(0, 10).map(c =>
          `${c.address} sold $${c.soldPrice.toLocaleString()}${c.sqft ? ` (${c.sqft} sqft)` : ''}${c.distance != null ? ` — ${c.distance.toFixed(2)}mi` : ''}`,
        ).join('; ')
      : 'none provided';

    const query = [
      `Analyze this property for real-estate investment (wholesale / fix-and-flip).`,
      `Subject: ${address}. ${subjectLine}.`,
      `Selected comps: ${compsLine}.`,
      `Please provide:`,
      `1. ARV (point estimate and range) with reasoning`,
      `2. Estimated repair range`,
      `3. Key risks and red flags`,
      `4. Summary recommendation (strong deal / marginal / pass)`,
      `Format numeric answers as "ARV: $XXX,XXX (range $XXX,XXX – $XXX,XXX)" so they're parseable.`,
    ].join('\n');

    try {
      this.logger.log(`Calling REAPI PropGPT for: ${address}`);
      const response = await axios.post<ReapiPropGPTResponse>(
        `${REAPI_BASE_URL}/v2/PropGPT`,
        { query, size: 1, model: 'gpt-4o' },
        {
          headers: {
            ...this.headers(),
            'x-openai-key': openaiKey,
            'Accept': 'text/plain, application/json',
          },
          timeout: 60000,
        },
      );

      const raw = response.data;
      const text =
        typeof raw === 'string'
          ? raw
          : (raw.text ?? raw.response ?? raw.result ?? JSON.stringify(raw));

      if (!text) return null;

      const parsed = this.parsePropGPTResponse(text);
      parsed.model = (typeof raw === 'object' && raw.model) ? raw.model : 'gpt-4o';
      return parsed;
    } catch (err) {
      this.handleApiError(err, 'runPropGPT');
      return null;
    }
  }

  private parsePropGPTResponse(text: string): PropGPTParsed {
    const result: PropGPTParsed = { text };

    const arvPointMatch = text.match(/ARV[:\s]*(?:of\s*)?\$?([\d,]+(?:\.\d+)?)/i);
    if (arvPointMatch) {
      const n = Number(arvPointMatch[1].replace(/,/g, ''));
      if (!isNaN(n) && n > 1000) result.arv = n;
    }

    const rangeMatch = text.match(/\$?([\d,]+)\s*[–\-to]+\s*\$?([\d,]+)/i);
    if (rangeMatch) {
      const low = Number(rangeMatch[1].replace(/,/g, ''));
      const high = Number(rangeMatch[2].replace(/,/g, ''));
      if (!isNaN(low) && !isNaN(high) && low < high && low > 1000) {
        result.arvLow = low;
        result.arvHigh = high;
      }
    }

    const confMatch = text.match(/(\d{1,3})\s*%\s*confidence|confidence[:\s]*(\d{1,3})\s*%/i);
    if (confMatch) {
      const n = Number(confMatch[1] || confMatch[2]);
      if (!isNaN(n) && n >= 0 && n <= 100) result.confidence = n;
    }

    return result;
  }
}
