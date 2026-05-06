import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import axios, { AxiosError } from 'axios';
import {
  ReapiPropertyData,
  ReapiComp,
  ReapiPropertyDetailResponse,
  ReapiPropertyCompsResponse,
  ReapiMortgageRecord,
  ReapiSaleRecord,
  ReapiMlsSearchResponse,
  ReapiMlsDetailResponse,
  ReapiMlsListing,
  ReapiMlsDetailData,
} from './reapi.types';
import { computeSimilarityScore } from './comp-similarity';

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
      'x-user-id': 'dealcore',
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
   * Accepted body params (verified live against REAPI):
   *   address           string  required (or use id)
   *   max_radius_miles  number  0.1-100 — search radius from subject
   *   max_days_back     integer — cutoff for sale date (e.g. 730 = 2 years)
   *   max_results       integer — cap on comps returned (REAPI max ~50)
   * Without max_radius_miles / max_days_back, REAPI uses a tight default
   * (~0.5mi, ~6mo) which leaves a lot of valid comps unreturned.
   */
  async getComps(
    address: string,
    opts?: { maxRadiusMiles?: number; maxDaysBack?: number; maxResults?: number },
  ): Promise<ReapiPropertyCompsResponse | null> {
    if (!this.apiKey) return null;

    const body: Record<string, unknown> = { address };
    if (opts?.maxRadiusMiles != null) body.max_radius_miles = opts.maxRadiusMiles;
    if (opts?.maxDaysBack != null) body.max_days_back = opts.maxDaysBack;
    if (opts?.maxResults != null) body.max_results = opts.maxResults;

    try {
      this.logger.log(
        `Fetching REAPI comps for: ${address} ` +
        `(radius=${opts?.maxRadiusMiles ?? 'default'}mi, ` +
        `daysBack=${opts?.maxDaysBack ?? 'default'}, ` +
        `maxResults=${opts?.maxResults ?? 'default'})`,
      );
      const response = await axios.post<ReapiPropertyCompsResponse>(
        `${REAPI_BASE_URL}/v3/PropertyComps`,
        body,
        { headers: this.headers(), timeout: 45000 },
      );

      const respBody = response.data;
      if (respBody?.statusCode && respBody.statusCode >= 400) {
        // REAPI overloads statusCode=404 to mean "no comparable properties in
        // our dataset" (very common for rural/sparse areas) — not a real API
        // error. Log that as INFO so it doesn't look like a failure. Any other
        // 4xx/5xx is a real problem and still logs as WARN.
        const reason = (respBody as unknown as { reason?: string }).reason ?? '';
        const isNoCompsSemantic =
          respBody.statusCode === 404 && /no\s+comparable|no\s+comps?/i.test(reason);
        if (isNoCompsSemantic) {
          this.logger.log(
            `REAPI returned 0 comparable properties for "${address}" — likely rural/sparse area with no matching sales in REAPI's dataset. Try ATTOM from the Comps tab.`,
          );
        } else {
          this.logger.warn(
            `REAPI PropertyComps ${respBody.statusCode}: ${respBody.statusMessage} for "${address}"${reason ? ` — reason: ${reason}` : ''}`,
          );
        }
        return null;
      }
      this.logger.log(
        `REAPI returned ${respBody?.comps?.length ?? 0} comps, subject AVM $${(respBody?.reapiAvm ?? 0).toLocaleString()}`,
      );
      return respBody;
    } catch (err) {
      this.handleApiError(err, 'getComps');
      return null;
    }
  }

  // ─── MLS add-on (v2/MLSSearch + v2/MLSDetail) ─────────────────────────────

  /**
   * POST /v2/MLSSearch — returns MLS listings (sold + active) matching filters.
   * Use this for comps in disclosure states where MLS data is ground truth
   * (no AVM-fallback noise like v3/PropertyComps has).
   */
  async getMlsComps(
    addressOrLatLng: { address: string; latitude?: number | null; longitude?: number | null },
    opts?: { maxRadiusMiles?: number; maxDaysBack?: number; maxResults?: number },
  ): Promise<ReapiMlsListing[] | null> {
    if (!this.apiKey) return null;

    // listing_property_type: 'RESIDENTIAL' already filters out RENTAL / LAND /
    // COMMERCIAL — no need for an `exclude` param (which REAPI rejects unless
    // it's an array of objects).
    const body: Record<string, unknown> = {
      listing_property_type: 'RESIDENTIAL',
      include_photos: false,
      size: opts?.maxResults ?? 25,
      sort: { sold_date: 'desc' },
    };

    // Geo strategy: lat/lng + radius is more precise than address-string search.
    // Fall back to address only when subject coords aren't populated yet.
    if (
      addressOrLatLng.latitude != null &&
      addressOrLatLng.longitude != null &&
      Number.isFinite(addressOrLatLng.latitude) &&
      Number.isFinite(addressOrLatLng.longitude)
    ) {
      body.latitude = addressOrLatLng.latitude;
      body.longitude = addressOrLatLng.longitude;
      body.radius = opts?.maxRadiusMiles ?? 1;
    } else {
      body.address = addressOrLatLng.address;
    }

    // sold_date_min cutoff
    if (opts?.maxDaysBack != null) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - opts.maxDaysBack);
      body.sold_date_min = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD
    }

    try {
      this.logger.log(
        `Fetching REAPI MLS comps for: ${addressOrLatLng.address} ` +
        `(geo=${body.latitude != null ? 'latlng' : 'address'}, ` +
        `radius=${body.radius ?? 'n/a'}mi, daysBack=${opts?.maxDaysBack ?? 'default'}, ` +
        `size=${body.size})`,
      );
      const response = await axios.post<ReapiMlsSearchResponse>(
        `${REAPI_BASE_URL}/v2/MLSSearch`,
        body,
        { headers: this.headers(), timeout: 45000 },
      );

      const respBody = response.data;
      if (respBody?.statusCode && respBody.statusCode >= 400) {
        const reason = respBody.reason ?? '';
        const isNoCompsSemantic =
          respBody.statusCode === 404 && /no\s+listings?|no\s+results?/i.test(reason);
        if (isNoCompsSemantic) {
          this.logger.log(
            `REAPI MLSSearch returned 0 listings for "${addressOrLatLng.address}" — no MLS coverage in this area or no recent sales`,
          );
        } else {
          this.logger.warn(
            `REAPI MLSSearch ${respBody.statusCode}: ${respBody.statusMessage} for "${addressOrLatLng.address}"${reason ? ` — reason: ${reason}` : ''}`,
          );
        }
        return null;
      }

      const listings = respBody?.data ?? [];
      this.logger.log(`REAPI MLSSearch returned ${listings.length} listings`);
      return listings;
    } catch (err) {
      this.handleApiError(err, 'getMlsComps');
      return null;
    }
  }

  /**
   * POST /v2/MLSDetail — single listing detail with photos, agent, mlsHistory.
   * Used to enrich the subject lead with active/recent MLS listing data.
   */
  async getMlsDetail(address: string): Promise<ReapiMlsDetailData | null> {
    if (!this.apiKey) return null;

    try {
      this.logger.log(`Fetching REAPI MLS detail for: ${address}`);
      const response = await axios.post<ReapiMlsDetailResponse>(
        `${REAPI_BASE_URL}/v2/MLSDetail`,
        { address },
        { headers: this.headers(), timeout: 20000 },
      );

      const body = response.data;
      if (body?.statusCode && body.statusCode >= 400) {
        const reason = body.reason ?? '';
        // 404 with "no listing" reason is normal — most properties never hit MLS.
        const isNoListingSemantic =
          body.statusCode === 404 && /no\s+listing|not\s+found/i.test(reason);
        if (isNoListingSemantic) {
          this.logger.log(`REAPI MLSDetail: no MLS listing for "${address}" (off-market/never-listed)`);
        } else {
          this.logger.warn(
            `REAPI MLSDetail ${body.statusCode}: ${body.statusMessage} for "${address}"${reason ? ` — reason: ${reason}` : ''}`,
          );
        }
        return null;
      }

      const data = body?.data;
      if (!data || Object.keys(data).length === 0) {
        this.logger.log(`REAPI MLSDetail returned empty data for "${address}"`);
        return null;
      }

      this.logger.log(
        `REAPI MLS listing found: status=${data.standardStatus ?? '?'}, ` +
        `mlsNumber=${data.mlsNumber ?? '?'}, photos=${data.media?.photosList?.length ?? 0}, ` +
        `historyEntries=${data.mlsHistory?.length ?? 0}`,
      );
      return data;
    } catch (err) {
      this.handleApiError(err, 'getMlsDetail');
      return null;
    }
  }

  /**
   * Normalize an address into a stable dedup key. Prefers (house number + zip)
   * since address-string formats differ between sources — MLS may return
   * "123 N Main Street, Denver, CO 80202" while PropertyComps returns
   * "123 MAIN ST". A property has at most one house number per zip, so this
   * pair is collision-proof in practice.
   *
   * Falls back to the fully-stripped address string when house number or zip
   * is missing (rural / partial-address records).
   */
  private addressDedupKey(addr: string | undefined | null): string {
    if (!addr) return '';
    const lower = addr.toLowerCase();
    const houseNumMatch = lower.match(/^\s*(\d+)\b/);
    const zipMatch = lower.match(/\b(\d{5})(?:-\d{4})?\b/);
    if (houseNumMatch && zipMatch) {
      return `${houseNumMatch[1]}|${zipMatch[1]}`;
    }
    return lower.replace(/[^a-z0-9]/g, '');
  }

  /**
   * Translate an MLS listing into the same shape ReapiComp uses, so the
   * existing comp filtering/persistence loop in fetchAndSaveComps can handle
   * MLS rows alongside PropertyComps rows.
   *
   * Returns null for non-sold listings (active/pending/cancelled). Active
   * listings have asking prices, not realized sale prices — they aren't
   * comparables for ARV math. Surfacing them as comps would inflate ARV with
   * what sellers HOPE to get rather than what buyers actually paid.
   */
  private mlsListingToComp(item: ReapiMlsListing): (ReapiComp & { _mlsRaw: ReapiMlsListing }) | null {
    const l = item.listing ?? {};
    const lt = (l.leadTypes ?? {}) as Record<string, unknown>;
    const p = (l.property ?? {}) as Record<string, unknown>;
    const a = l.address ?? {};

    const standardStatus = (l as Record<string, unknown>).standardStatus as string | undefined;
    const mlsStatus = (lt.mlsStatus as string | undefined) ?? standardStatus;
    const soldDateRaw = (l as Record<string, unknown>).soldDate as string | undefined;
    const isSold =
      lt.mlsSold === true ||
      /sold|closed/i.test(standardStatus ?? '') ||
      /sold|closed/i.test(mlsStatus ?? '') ||
      !!soldDateRaw;
    if (!isSold) return null;

    // Sold-price candidates (varies by board: some return soldPrice, others
    // closePrice, others tuck the close price into mlsListingPrice once sold).
    const soldPriceCandidate =
      toNumber((l as Record<string, unknown>).soldPrice) ??
      toNumber((l as Record<string, unknown>).closePrice) ??
      toNumber((l as Record<string, unknown>).price) ??
      toNumber(lt.mlsListingPrice);
    if (!soldPriceCandidate || soldPriceCandidate <= 0) return null;

    const soldDateForComp =
      soldDateRaw ?? (lt.mlsLastStatusDate as string | undefined);
    if (!soldDateForComp) return null;

    return {
      id: item.id ?? (item.listingId != null ? String(item.listingId) : undefined),
      distance: toNumber((item as Record<string, unknown>).distance) ?? 0,
      address: {
        address: a.unparsedAddress,
        label: a.unparsedAddress,
        city: a.city,
        state: a.stateOrProvince,
        zip: a.zipCode,
        county: a.countyOrParish,
      },
      latitude: toNumber(p.latitude),
      longitude: toNumber(p.longitude),
      bedrooms: toNumber(p.bedroomsTotal),
      bathrooms: toNumber(p.bathroomsTotal),
      yearBuilt: toNumber(p.yearBuilt),
      squareFeet: toNumber(p.livingArea),
      lotSquareFeet: toNumber(p.lotSizeSquareFeet),
      propertyType: (p.propertyType as string) ?? undefined,
      lastSaleAmount: soldPriceCandidate,
      lastSaleDate: soldDateForComp,
      pool: (p.hasPool as boolean | undefined) ?? false,
      garageAvailable: !!p.garageSpaces && p.garageSpaces !== '0',
      mlsListingDate: (lt.mlsListingDate as string | undefined) ?? null,
      mlsLastStatusDate: (lt.mlsLastStatusDate as string | undefined) ?? null,
      mlsListingPrice: toNumber(lt.mlsListingPrice) ?? null,
      _mlsRaw: item,
    };
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

    // ── MLS add-on enrichment (best-effort; silently skips if no MLS coverage) ──
    const mlsDetail = await this.getMlsDetail(this.formatAddress(address));
    let mlsPhotosCount = 0;
    let mlsHistoryCount = 0;
    if (mlsDetail) {
      const mls = this.mapMlsToEnrichment(mlsDetail);
      updates.reapiMlsListingId = mls.reapiMlsListingId ?? null;
      updates.reapiMlsNumber = mls.reapiMlsNumber ?? null;
      updates.reapiMlsStatus = mls.reapiMlsStatus ?? null;
      updates.reapiMlsListPrice = mls.reapiMlsListPrice ?? null;
      updates.reapiMlsSoldPrice = mls.reapiMlsSoldPrice ?? null;
      updates.reapiMlsListDate = mls.reapiMlsListDate ?? null;
      updates.reapiMlsSoldDate = mls.reapiMlsSoldDate ?? null;
      updates.reapiMlsDaysOnMarket = mls.reapiMlsDaysOnMarket ?? null;
      updates.reapiMlsHistory = mls.reapiMlsHistory ?? null;
      updates.reapiMlsPhotos = mls.reapiMlsPhotos ?? null;
      updates.reapiMlsAgent = mls.reapiMlsAgent ?? null;
      updates.reapiMlsRemarks = mls.reapiMlsRemarks ?? null;
      mlsPhotosCount = Array.isArray(mls.reapiMlsPhotos) ? mls.reapiMlsPhotos.length : 0;
      mlsHistoryCount = Array.isArray(mls.reapiMlsHistory) ? mls.reapiMlsHistory.length : 0;

      // Promote MLS photos into the main lead.photos gallery so they render
      // in the Overview's PhotosCard (alongside any user uploads / Street View).
      // Mirror the street-view.service pattern: dedupe prior 'mls' entries,
      // append fresh ones, and update primaryPhoto when the current primary is
      // unset or is the brittle Google Street View URL.
      if (mlsPhotosCount > 0 && Array.isArray(mls.reapiMlsPhotos)) {
        const currentLead = await this.prisma.lead.findUnique({
          where: { id: leadId },
          select: { photos: true, primaryPhoto: true },
        });
        const currentPhotos = (currentLead?.photos as unknown as Array<Record<string, unknown>>) || [];
        const withoutOldMls = currentPhotos.filter((p) => p?.source !== 'mls');
        const newMlsPhotos = (mls.reapiMlsPhotos as Array<Record<string, unknown>>)
          .map((p) => {
            const url = (p.highRes as string) || (p.midRes as string) || (p.lowRes as string);
            const thumb = (p.midRes as string) || (p.lowRes as string) || (p.highRes as string);
            if (!url) return null;
            return {
              id: randomUUID(),
              url,
              thumbnailUrl: thumb || url,
              source: 'mls',
              uploadedAt: new Date().toISOString(),
            };
          })
          .filter((p): p is NonNullable<typeof p> => p !== null);

        const updatedPhotos = [...newMlsPhotos, ...withoutOldMls];
        const oldPrimary = currentLead?.primaryPhoto;
        const shouldPromotePrimary =
          !oldPrimary ||
          oldPrimary.includes('maps.googleapis.com/maps/api/streetview') ||
          // also replace any prior MLS primary (URLs may have rotated)
          (currentPhotos.find((p) => p?.url === oldPrimary)?.source === 'mls');

        updates.photos = updatedPhotos as unknown as Prisma.InputJsonValue;
        if (shouldPromotePrimary && newMlsPhotos[0]) {
          updates.primaryPhoto = newMlsPhotos[0].url;
        }
      }
    }

    await this.prisma.lead.update({ where: { id: leadId }, data: updates });

    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'FIELD_UPDATED',
        description: mlsDetail
          ? `Property enriched from REAPI + MLS (${mlsPhotosCount} photos, ${mlsHistoryCount} history records)`
          : `Property enriched from REAPI (${Object.keys(updates).filter(k => !k.startsWith('reapi')).join(', ') || 'REAPI-only fields'})`,
        metadata: { source: 'reapi', fields: Object.keys(updates), mlsCovered: !!mlsDetail },
      },
    });

    this.logger.log(`REAPI enrichment complete for lead ${leadId}${mlsDetail ? ` (+ MLS: ${mlsPhotosCount} photos, ${mlsHistoryCount} history)` : ''}`);
    return result;
  }

  /**
   * Translate a REAPI MLSDetail response into the per-lead reapiMls* fields.
   * Defensive: most fields are optional and absent for off-market properties.
   */
  private mapMlsToEnrichment(d: ReapiMlsDetailData): {
    reapiMlsListingId?: string;
    reapiMlsNumber?: string;
    reapiMlsStatus?: string;
    reapiMlsListPrice?: number;
    reapiMlsSoldPrice?: number;
    reapiMlsListDate?: Date;
    reapiMlsSoldDate?: Date;
    reapiMlsDaysOnMarket?: number;
    reapiMlsHistory?: Array<Record<string, unknown>>;
    reapiMlsPhotos?: Array<Record<string, unknown>>;
    reapiMlsAgent?: Record<string, unknown>;
    reapiMlsRemarks?: string;
  } {
    const listPrice = toNumber(d.listPrice);
    const soldPrice =
      toNumber(d.soldPrice) ??
      toNumber((d as Record<string, unknown>).closePrice);

    const parseDate = (s: string | undefined): Date | undefined => {
      if (!s) return undefined;
      const dt = new Date(s);
      return Number.isFinite(dt.getTime()) ? dt : undefined;
    };

    const photosList = d.media?.photosList;
    const photos = Array.isArray(photosList) && photosList.length > 0
      ? photosList.map((p) => ({ lowRes: p?.lowRes, midRes: p?.midRes, highRes: p?.highRes }))
      : undefined;

    const agent = d.listingAgent
      ? {
          fullName: d.listingAgent.fullName,
          email: d.listingAgent.email,
          phone: d.listingAgent.phone,
          mlsCode: d.listingAgent.mlsCode,
          officeName: d.listingOffice?.name,
          officePhone: d.listingOffice?.phone,
        }
      : undefined;

    return {
      reapiMlsListingId: d.listingId != null ? String(d.listingId) : undefined,
      reapiMlsNumber: d.mlsNumber ?? undefined,
      reapiMlsStatus: d.standardStatus ?? d.customStatus ?? undefined,
      reapiMlsListPrice: listPrice,
      reapiMlsSoldPrice: soldPrice,
      reapiMlsListDate: parseDate(d.listingContractDate),
      reapiMlsSoldDate: parseDate(d.soldDate),
      reapiMlsDaysOnMarket: toNumber(d.daysOnMarket),
      reapiMlsHistory: Array.isArray(d.mlsHistory) && d.mlsHistory.length > 0
        ? (d.mlsHistory as unknown as Array<Record<string, unknown>>)
        : undefined,
      reapiMlsPhotos: photos,
      reapiMlsAgent: agent,
      reapiMlsRemarks: d.publicRemarks ?? undefined,
    };
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
    // Coerce to Number — REAPI sometimes returns these as strings.
    const avm = toNumber(d.estimatedValue);
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
      equity: toNumber(d.estimatedEquity) ?? toNumber(d.equity),
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
    opts?: {
      forceRefresh?: boolean;
      maxRadiusMiles?: number;
      maxDaysBack?: number;
      maxResults?: number;
    },
  ): Promise<{ arv: number; arvLow?: number; arvHigh?: number; confidence: number; compsCount: number; source: string }> {
    const full = this.formatAddress(address);
    const radius = opts?.maxRadiusMiles ?? 1;
    const daysBack = opts?.maxDaysBack ?? 365;    // ~12 months
    const maxResults = opts?.maxResults ?? 25;

    // Load the subject lead's basic features for correlation scoring AND
    // lat/lng for the MLS Search geo lookup (more precise than address string).
    const subject = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        bedrooms: true, bathrooms: true, sqft: true, sqftOverride: true,
        propertyType: true, latitude: true, longitude: true,
      },
    });
    const subjectSqftForScore = subject?.sqftOverride ?? subject?.sqft ?? null;

    // Default pull is tight on purpose — 1mi / 12mo / 25 records to match
    // BatchData's posture for honest cross-provider comparison. The user
    // can widen via the Comps tab Distance/Age filter buttons (1/2/3/5mi,
    // 6/12/24mo); those persist on CompAnalysis and override these defaults.
    //
    // Two-source pull: MLS Search (true sold prices, photos, status) + v3
    // PropertyComps (broader coverage, AVM fallback for non-disclosure states).
    // We dedup by address, preferring MLS when both have it.
    const [mlsListings, result] = await Promise.all([
      this.getMlsComps(
        { address: full, latitude: subject?.latitude ?? null, longitude: subject?.longitude ?? null },
        { maxRadiusMiles: radius, maxDaysBack: daysBack, maxResults },
      ),
      this.getComps(full, { maxRadiusMiles: radius, maxDaysBack: daysBack, maxResults }),
    ]);

    const mlsRawCount = (mlsListings ?? []).length;
    const mlsCompsRaw = (mlsListings ?? [])
      .map((l) => this.mlsListingToComp(l))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const mlsDroppedNonSold = mlsRawCount - mlsCompsRaw.length;
    const propertyComps = result?.comps ?? [];

    // Build merged list: MLS first (so it wins when deduped), then PropertyComps.
    // Each entry carries its method tag for features.method.
    type MergedComp = {
      comp: ReapiComp;
      method: 'mls' | 'reapi-comps';
      mlsRaw?: ReapiMlsListing;
    };
    const seenKeys = new Set<string>();
    const merged: MergedComp[] = [];
    let dedupedCount = 0;

    for (const m of mlsCompsRaw) {
      const addr = m.address?.address || m.address?.label;
      const key = this.addressDedupKey(addr);
      if (key) seenKeys.add(key);
      merged.push({ comp: m, method: 'mls', mlsRaw: m._mlsRaw });
    }
    for (const c of propertyComps) {
      const addr = c.address?.address || c.address?.label;
      const key = this.addressDedupKey(addr);
      if (key && seenKeys.has(key)) {
        dedupedCount += 1;
        continue;
      }
      if (key) seenKeys.add(key);
      merged.push({ comp: c, method: 'reapi-comps' });
    }
    if (mlsDroppedNonSold > 0) {
      this.logger.log(
        `REAPI MLS: dropped ${mlsDroppedNonSold}/${mlsRawCount} non-sold listings (active/pending/cancelled — not valid comps for ARV)`,
      );
    }

    if (merged.length === 0) {
      return { arv: 0, arvLow: 0, arvHigh: 0, confidence: 0, compsCount: 0, source: 'reapi (no data)' };
    }

    await this.prisma.comp.deleteMany({
      where: { leadId, source: 'reapi', analysisId: null },
    });

    // Minimal filters — we only discard records that are literally unusable.
    // No outlier/price-range guards: REAPI's top-level reapiAvm is sometimes
    // wildly wrong (saw $26M for a $367k FL condo) and would cause every legit
    // comp to be filtered out as an "outlier". The user has explicitly chosen
    // to see all raw comps and make outlier decisions themselves.
    // Age cap is 24 months so the Comps tab age filter (6/12/24mo) has data
    // to narrow from. Display-time filter defaults to 12mo — anything between
    // 12 and 24 months is in the DB but not auto-selected.
    const MAX_AGE_MONTHS = 24;
    const ageCutoff = new Date();
    ageCutoff.setMonth(ageCutoff.getMonth() - MAX_AGE_MONTHS);

    let nonDisclosedCount = 0;
    let mlsCount = 0;
    let saved = 0;
    let filteredNoDate = 0, filteredStale = 0, filteredNoPrice = 0, filteredNoSqft = 0;

    for (const { comp: c, method, mlsRaw } of merged) {
      if (!c.lastSaleDate) { filteredNoDate += 1; continue; }

      const soldDate = new Date(c.lastSaleDate);
      if (isNaN(soldDate.getTime()) || soldDate < ageCutoff) { filteredStale += 1; continue; }

      const recordedSale = toNumber(c.lastSaleAmount);
      const avm = toNumber(c.estimatedValue);
      const soldPrice = (recordedSale && recordedSale > 0) ? recordedSale : avm;
      if (!soldPrice || soldPrice <= 0) { filteredNoPrice += 1; continue; }

      const sqft = toNumber(c.squareFeet);
      // Degenerate record: no sqft AND no beds/baths → skip (vacant lot, demolished, bad data)
      if ((!sqft || sqft <= 0) && !c.bedrooms && !c.bathrooms) { filteredNoSqft += 1; continue; }

      const isAvmFallback = !recordedSale || recordedSale === 0;
      // MLS rows have true sold prices — they should never be AVM-fallback.
      // PropertyComps rows in non-disclosure states are AVM-fallback.
      if (isAvmFallback && method !== 'mls') nonDisclosedCount += 1;
      if (method === 'mls') mlsCount += 1;

      const compAddress = c.address?.address || c.address?.label || 'Unknown';

      // Similarity score (0-100) and correlation (0-1) — same bed/bath/sqft/type
      // math as CompsService.calculateSimilarityScore. Stored so the Comps tab
      // can sort by Correlation, and so the value flows through
      // importExistingComps into the Comparable Properties Table.
      const similarityScore = computeSimilarityScore(
        {
          bedrooms: subject?.bedrooms ?? null,
          bathrooms: subject?.bathrooms ?? null,
          sqft: subjectSqftForScore,
          propertyType: subject?.propertyType ?? null,
        },
        {
          bedrooms: c.bedrooms ?? null,
          bathrooms: c.bathrooms ?? null,
          sqft: sqft ?? null,
          propertyType: c.propertyType ?? null,
        },
      );
      const correlation = similarityScore != null ? similarityScore / 100 : null;

      // Per-comp features blob: tag the data-source method, attach MLS-only
      // metadata when present (mlsNumber, list price, primary photo) so the
      // UI can show the "MLS" badge and a thumbnail without a second lookup.
      const features: Record<string, unknown> = { method };
      if (method === 'mls' && mlsRaw?.listing) {
        const ml = mlsRaw.listing;
        features.mlsNumber = ml.mlsNumber;
        features.mlsBoardCode = ml.mlsBoardCode;
        features.mlsStatus = (ml as Record<string, unknown>).standardStatus ?? (ml.leadTypes as Record<string, unknown> | undefined)?.mlsStatus;
        features.listPrice = toNumber((ml as Record<string, unknown>).listPrice) ?? toNumber(ml.leadTypes?.mlsListingPrice);
        features.listDate = ml.leadTypes?.mlsListingDate;
        features.daysOnMarket = ml.leadTypes?.mlsDaysOnMarket;
        features.photoUrl = ml.media?.primaryListingImageUrl;
        features.publicRemarks = ml.publicRemarks;
        features.listingUrl = ml.url;
      }

      // Capture the full photo list (REAPI MLS only) so the AI prompt
      // can attach 1-2 photos per comp instead of only the primary.
      // Prefer midRes (~900px) — sufficient for AI vision, smaller payload.
      const photoUrls: string[] =
        method === 'mls'
          ? (mlsRaw?.listing?.media?.photosList ?? [])
              .map((p) => p?.midRes ?? p?.highRes ?? p?.lowRes)
              .filter((u): u is string => typeof u === 'string' && u.length > 0)
          : [];
      features.photoUrls = photoUrls;

      try {
        await this.prisma.comp.create({
          data: {
            leadId,
            address: compAddress,
            distance: c.distance ?? 0,
            soldPrice,
            soldDate,
            daysOnMarket: method === 'mls' ? toNumber(mlsRaw?.listing?.leadTypes?.mlsDaysOnMarket) ?? null : null,
            bedrooms: c.bedrooms ?? null,
            bathrooms: c.bathrooms ?? null,
            sqft: sqft ?? null,
            lotSize: normalizeLotAcres(toNumber(c.lotSquareFeet)) ?? null,
            yearBuilt: toNumber(c.yearBuilt) ?? null,
            propertyType: c.propertyType ?? null,
            hasPool: c.pool ?? false,
            hasGarage: c.garageAvailable ?? false,
            photoUrl: method === 'mls' ? (mlsRaw?.listing?.media?.primaryListingImageUrl ?? null) : null,
            sourceUrl: method === 'mls' ? (mlsRaw?.listing?.url ?? null) : null,
            latitude: c.latitude ?? null,
            longitude: c.longitude ?? null,
            similarityScore,
            correlation,
            selected: true,
            source: 'reapi',
            features: features as Prisma.InputJsonValue,
            notes: isAvmFallback && method !== 'mls'
              ? 'Sale price non-disclosed — using REAPI AVM as price estimate'
              : undefined,
          },
        });
        saved += 1;
      } catch (err) {
        this.logger.warn(`Failed to save REAPI comp "${compAddress}": ${(err as Error).message}`);
      }
    }

    const filteredTotal = filteredNoDate + filteredStale + filteredNoPrice + filteredNoSqft;
    if (filteredTotal > 0) {
      this.logger.log(
        `REAPI comps filtered ${filteredTotal}/${merged.length}: ` +
        `no-date=${filteredNoDate}, stale>${MAX_AGE_MONTHS}mo=${filteredStale}, ` +
        `no-price=${filteredNoPrice}, no-sqft=${filteredNoSqft}`,
      );
    }
    this.logger.log(
      `REAPI comps merged: ${mlsCompsRaw.length} from MLS + ${propertyComps.length} from PropertyComps, ` +
      `${dedupedCount} dedup'd → ${saved} saved (${mlsCount} MLS, ${nonDisclosedCount} AVM-fallback)`,
    );

    // ARV: prefer REAPI's subject AVM (from PropertyComps); fall back to
    // comps average. REAPI occasionally returns these as strings ("92133.00")
    // — coerce to Number so Prisma accepts them on the `Float?` columns.
    let arv = toNumber(result?.reapiAvm) ?? 0;
    let arvLow = toNumber(result?.reapiAvmLow);
    let arvHigh = toNumber(result?.reapiAvmHigh);

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

    // Confidence: higher when AVM-only is minority of comps, when we have more
    // comps, and when MLS data covers the majority (true sold prices > AVM
    // estimates).
    let confidence = 0;
    if (arv && saved > 0) {
      const disclosedRatio = 1 - (nonDisclosedCount / saved);
      const mlsBonus = (mlsCount / saved) > 0.5 ? 5 : 0;
      confidence = Math.max(40, Math.min(95, Math.round(55 + saved * 1.2 + disclosedRatio * 15 + mlsBonus)));
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

    const parts: string[] = [];
    if (mlsCount > 0) parts.push(`${mlsCount} MLS`);
    const recordedSales = saved - mlsCount - nonDisclosedCount;
    if (recordedSales > 0) parts.push(`${recordedSales} disclosed`);
    if (nonDisclosedCount > 0) parts.push(`${nonDisclosedCount} AVM`);
    const sourceLabel = parts.length > 0 ? `reapi (${parts.join(' + ')})` : 'reapi';

    return { arv: Math.round(arv), arvLow, arvHigh, confidence, compsCount: saved, source: sourceLabel };
  }

  // PropGPT support removed — REAPI's PropGPT is a natural-language
  // property-search frontend (translates a text query into PropertySearch
  // filters and returns matching properties), not an analysis chatbot.
  // DealCore's aiAdjustComps (Claude) is the single AI ARV path.
}
