import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios, { AxiosError } from 'axios';
import {
  ReapiProperty,
  ReapiComp,
  ReapiPropertyDetailResponse,
  ReapiCompsResponse,
  ReapiPropGPTResponse,
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
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  lotSize?: number;             // acres (normalized)
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
  estimatedValue?: number;
  estimatedValueLow?: number;
  estimatedValueHigh?: number;
  equity?: number;
  mortgageData?: Record<string, unknown>;
  saleHistory?: Array<Record<string, unknown>>;
  features?: Record<string, unknown>;
  ownerData?: Record<string, unknown>;
}

// Convert lot sqft → acres if it's clearly > typical acre size
function normalizeLotSize(raw: number | undefined): number | undefined {
  if (!raw) return undefined;
  return raw > 100 ? parseFloat((raw / 43560).toFixed(4)) : raw;
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
   * Fetch full property detail from REAPI.
   * Endpoint: POST /v2/PropertyDetail
   */
  async getPropertyDetails(address: string): Promise<ReapiProperty | null> {
    if (!this.apiKey) {
      this.logger.warn('REAPI not configured — skipping property details lookup');
      return null;
    }

    this.logger.log(`Fetching REAPI property details for: ${address}`);

    try {
      const response = await axios.post<ReapiPropertyDetailResponse>(
        `${REAPI_BASE_URL}/v2/PropertyDetail`,
        { address },
        { headers: this.headers(), timeout: 20000 },
      );

      const raw = response.data as Record<string, unknown>;
      const extracted = this.extractProperty(raw);

      if (!extracted) {
        this.logger.warn(`REAPI returned no property for "${address}"`);
        return null;
      }

      this.logger.log(
        `REAPI property found: ${extracted.bedrooms ?? '?'}bd/${extracted.bathrooms ?? '?'}ba, ` +
        `${extracted.squareFeet ?? '?'} sqft, built ${extracted.yearBuilt ?? '?'}`,
      );

      extracted._raw = raw;
      return extracted;
    } catch (err) {
      this.handleApiError(err, 'getPropertyDetails');
      return null;
    }
  }

  /**
   * Extract a ReapiProperty from a loosely-typed response body.
   * REAPI returns variable shapes: { data: {...} }, { data: [{...}] }, or flat.
   */
  private extractProperty(raw: Record<string, unknown>): ReapiProperty | null {
    if (!raw) return null;
    const data = (raw as any).data ?? (raw as any).property ?? raw;
    const record = Array.isArray(data) ? data[0] : data;
    if (!record || typeof record !== 'object') return null;
    return record as ReapiProperty;
  }

  // ─── Comps ────────────────────────────────────────────────────────────────

  /**
   * Fetch comparable sales from REAPI.
   * Endpoint: POST /v3/PropertyComps  (v2 deprecates Jan 1 2026)
   */
  async getComps(
    address: string,
    opts?: { radiusMiles?: number; maxComps?: number; monthsBack?: number },
  ): Promise<ReapiComp[]> {
    if (!this.apiKey) return [];

    const body: Record<string, unknown> = { address };
    if (opts?.radiusMiles) body.radius = opts.radiusMiles;
    if (opts?.maxComps) body.max_results = opts.maxComps;
    if (opts?.monthsBack) body.months_back = opts.monthsBack;

    try {
      this.logger.log(`Fetching REAPI comps for: ${address}`);
      const response = await axios.post<ReapiCompsResponse>(
        `${REAPI_BASE_URL}/v3/PropertyComps`,
        body,
        { headers: this.headers(), timeout: 30000 },
      );

      const raw = response.data as Record<string, unknown>;
      const comps = this.extractComps(raw);
      this.logger.log(`REAPI returned ${comps.length} comps`);
      return comps;
    } catch (err) {
      this.handleApiError(err, 'getComps');
      return [];
    }
  }

  private extractComps(raw: Record<string, unknown>): ReapiComp[] {
    if (!raw) return [];
    const data =
      (raw as any).comps ??
      (raw as any).data ??
      (raw as any).results ??
      raw;
    if (!Array.isArray(data)) return [];
    return data as ReapiComp[];
  }

  // ─── Lead Enrichment ──────────────────────────────────────────────────────

  /**
   * Fetch property details for a lead and merge them onto the Lead record.
   * Mirrors the pattern in RentCastService/AttomService — only fills fields
   * that aren't already set on the lead, then writes REAPI-specific JSON
   * blobs to the reapi* columns. Honors a 24h cache unless forceRefresh.
   */
  async enrichLead(
    leadId: string,
    address: EnrichAddress,
    opts?: { forceRefresh?: boolean },
  ): Promise<ReapiEnrichmentResult | null> {
    if (!this.isConfigured) return null;

    // Cache check
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

    const property = await this.getPropertyDetails(this.formatAddress(address));
    if (!property) {
      this.logger.warn(`REAPI enrichment: no property found for lead ${leadId}`);
      return null;
    }

    const result = this.mapPropertyToEnrichment(property);

    // Only set Lead fields that aren't already populated
    const existing = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        bedrooms: true, bathrooms: true, sqft: true, propertyType: true,
        yearBuilt: true, lotSize: true, latitude: true, longitude: true,
        apn: true, ownerName: true, ownerOccupied: true, hoaFee: true,
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
    if (result.lastSaleDate) updates.lastSaleDate = new Date(result.lastSaleDate);
    if (result.lastSalePrice) updates.lastSalePrice = result.lastSalePrice;
    if (result.taxAssessedValue) updates.taxAssessedValue = result.taxAssessedValue;
    if (result.annualTaxAmount) updates.annualTaxAmount = result.annualTaxAmount;

    // REAPI-specific columns (always overwrite — these are REAPI's source of truth)
    updates.reapiId = property.id ?? null;
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
        description: `Property enriched from REAPI (${Object.keys(updates).filter(k => !k.startsWith('reapi')).join(', ') || 'no core fields changed'})`,
        metadata: { source: 'reapi', fields: Object.keys(updates) },
      },
    });

    this.logger.log(`REAPI enrichment complete for lead ${leadId}`);
    return result;
  }

  /**
   * Map a REAPI property response → normalized Lead-field-friendly shape.
   */
  private mapPropertyToEnrichment(p: ReapiProperty): ReapiEnrichmentResult {
    const result: ReapiEnrichmentResult = {
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      sqft: p.squareFeet,
      lotSize: normalizeLotSize(p.lotSquareFeet),
      yearBuilt: p.yearBuilt,
      propertyType: p.propertyType,
      lastSaleDate: p.lastSaleDate,
      lastSalePrice: p.lastSalePrice,
      taxAssessedValue: p.taxAssessedValue,
      annualTaxAmount: p.annualTaxAmount,
      ownerOccupied: p.ownerOccupied,
      ownerName: p.ownerName ?? (p.ownerNames?.[0]),
      hoaFee: p.hoaFee,
      latitude: p.address?.latitude,
      longitude: p.address?.longitude,
      apn: p.apn,
      estimatedValue: p.estimatedValue,
      estimatedValueLow: p.estimatedValueLow,
      estimatedValueHigh: p.estimatedValueHigh,
      equity: p.estimatedEquity,
    };

    if (p.mortgage || p.secondMortgage) {
      result.mortgageData = {
        first: p.mortgage,
        second: p.secondMortgage,
      };
    }

    if (p.saleHistory && p.saleHistory.length > 0) {
      result.saleHistory = p.saleHistory as Array<Record<string, unknown>>;
    }

    const features: Record<string, unknown> = {};
    if (p.hasPool != null) features.hasPool = p.hasPool;
    if (p.hasGarage != null) features.hasGarage = p.hasGarage;
    if (p.garageSpaces != null) features.garageSpaces = p.garageSpaces;
    if (p.hasBasement != null) features.hasBasement = p.hasBasement;
    if (p.basementSqft != null) features.basementSqft = p.basementSqft;
    if (p.stories != null) features.stories = p.stories;
    if (p.heatingType) features.heatingType = p.heatingType;
    if (p.coolingType) features.coolingType = p.coolingType;
    if (p.roofType) features.roofType = p.roofType;
    if (p.wallType) features.wallType = p.wallType;
    if (Object.keys(features).length > 0) result.features = features;

    if (p.ownerName || p.ownerNames || p.mailingAddress || p.absenteeOwner != null || p.corporateOwned != null) {
      result.ownerData = {
        ownerName: p.ownerName,
        ownerNames: p.ownerNames,
        mailingAddress: p.mailingAddress,
        absenteeOwner: p.absenteeOwner,
        corporateOwned: p.corporateOwned,
        ownerOccupied: p.ownerOccupied,
      };
    }

    return result;
  }

  // ─── Comps Fetch + Persist ────────────────────────────────────────────────

  /**
   * Fetch comps and persist to Comp table with source='reapi'.
   * Used by CompsService.fetchComps() when preferSource is 'reapi'.
   * Returns a summary identical in shape to the RentCast/ATTOM paths.
   */
  async fetchAndSaveComps(
    leadId: string,
    address: EnrichAddress,
    opts?: { forceRefresh?: boolean; maxComps?: number; radiusMiles?: number },
  ): Promise<{ arv: number; arvLow?: number; arvHigh?: number; confidence: number; compsCount: number; source: string }> {
    const full = this.formatAddress(address);
    const comps = await this.getComps(full, {
      maxComps: opts?.maxComps ?? 20,
      radiusMiles: opts?.radiusMiles ?? 1.5,
      monthsBack: 12,
    });

    // Clear any previous REAPI comps for this lead (analysisId null = primary list)
    await this.prisma.comp.deleteMany({
      where: { leadId, source: 'reapi', analysisId: null },
    });

    let saved = 0;
    for (const c of comps) {
      if (!c.lastSalePrice || !c.lastSaleDate) continue;
      try {
        await this.prisma.comp.create({
          data: {
            leadId,
            address: c.address || this.buildCompAddress(c),
            distance: c.distance ?? 0,
            soldPrice: c.lastSalePrice,
            soldDate: new Date(c.lastSaleDate),
            daysOnMarket: c.daysOnMarket ?? null,
            bedrooms: c.bedrooms ?? null,
            bathrooms: c.bathrooms ?? null,
            sqft: c.squareFeet ?? null,
            lotSize: normalizeLotSize(c.lotSquareFeet) ?? null,
            yearBuilt: c.yearBuilt ?? null,
            propertyType: c.propertyType ?? null,
            hasPool: c.hasPool ?? false,
            hasGarage: c.hasGarage ?? false,
            latitude: c.latitude ?? null,
            longitude: c.longitude ?? null,
            similarityScore: c.similarityScore ?? null,
            selected: true,
            source: 'reapi',
            sourceUrl: c.sourceUrl ?? null,
          },
        });
        saved += 1;
      } catch (err) {
        this.logger.warn(`Failed to save REAPI comp "${c.address}": ${(err as Error).message}`);
      }
    }

    // Compute simple average ARV from saved comps
    const savedComps = await this.prisma.comp.findMany({
      where: { leadId, source: 'reapi', analysisId: null },
    });

    let arv = 0;
    let arvLow: number | undefined;
    let arvHigh: number | undefined;
    let confidence = 0;

    if (savedComps.length > 0) {
      const prices = savedComps.map(c => c.soldPrice).sort((a, b) => a - b);
      arv = Math.round(prices.reduce((s, v) => s + v, 0) / prices.length);
      arvLow = prices[0];
      arvHigh = prices[prices.length - 1];
      // Simple confidence: more comps + tighter spread = higher
      const spread = arvHigh && arv ? (arvHigh - arvLow!) / arv : 0;
      confidence = Math.max(40, Math.min(95, Math.round(60 + savedComps.length * 2 - spread * 50)));
    }

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        arv: arv || undefined,
        arvConfidence: confidence || undefined,
        lastCompsDate: new Date(),
      },
    });

    return {
      arv,
      arvLow,
      arvHigh,
      confidence,
      compsCount: saved,
      source: 'reapi',
    };
  }

  private buildCompAddress(c: ReapiComp): string {
    return [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ') || 'Unknown';
  }

  // ─── PropGPT ──────────────────────────────────────────────────────────────

  /**
   * Call REAPI's PropGPT endpoint for AI-powered property analysis.
   * Endpoint: POST /v2/PropGPT
   *
   * PropGPT accepts a natural-language query and returns a text analysis.
   * We also try to extract a numeric ARV range from the response via regex.
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
      this.logger.warn('PropGPT requires OPENAI_API_KEY (passed via x-openai-key header) — skipping');
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
      // Response may be string (text/plain), or an object with text/response/result
      const text =
        typeof raw === 'string'
          ? raw
          : (raw.text ?? raw.response ?? raw.result ?? JSON.stringify(raw));

      if (!text) {
        this.logger.warn('PropGPT returned empty response');
        return null;
      }

      const parsed = this.parsePropGPTResponse(text);
      parsed.model = (typeof raw === 'object' && raw.model) ? raw.model : 'gpt-4o';
      return parsed;
    } catch (err) {
      this.handleApiError(err, 'runPropGPT');
      return null;
    }
  }

  /**
   * Best-effort regex extraction of ARV point/range from a PropGPT text
   * response. Falls back to text-only if numbers can't be parsed.
   */
  private parsePropGPTResponse(text: string): PropGPTParsed {
    const result: PropGPTParsed = { text };

    // Match "ARV: $350,000" or "ARV of $350,000"
    const arvPointMatch = text.match(/ARV[:\s]*(?:of\s*)?\$?([\d,]+(?:\.\d+)?)/i);
    if (arvPointMatch) {
      const n = Number(arvPointMatch[1].replace(/,/g, ''));
      if (!isNaN(n) && n > 1000) result.arv = n;
    }

    // Match "range $300,000 – $400,000" or "$300,000 to $400,000"
    const rangeMatch = text.match(/\$?([\d,]+)\s*[–\-to]+\s*\$?([\d,]+)/i);
    if (rangeMatch) {
      const low = Number(rangeMatch[1].replace(/,/g, ''));
      const high = Number(rangeMatch[2].replace(/,/g, ''));
      if (!isNaN(low) && !isNaN(high) && low < high && low > 1000) {
        result.arvLow = low;
        result.arvHigh = high;
      }
    }

    // Match "confidence: 85%" or "85% confidence"
    const confMatch = text.match(/(\d{1,3})\s*%\s*confidence|confidence[:\s]*(\d{1,3})\s*%/i);
    if (confMatch) {
      const n = Number(confMatch[1] || confMatch[2]);
      if (!isNaN(n) && n >= 0 && n <= 100) result.confidence = n;
    }

    return result;
  }
}
