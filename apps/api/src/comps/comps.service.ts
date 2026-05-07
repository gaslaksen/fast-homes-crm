import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ReapiService } from './reapi.service';
import { BatchDataCompService } from './batchdata-comp.service';
import { dedupCompList, dedupCompGroups } from './comp-dedup';
import axios from 'axios';

interface ChatARVResponse {
  arv: number;
  confidence: number;
  comps: Array<{
    address: string;
    distance: number;
    soldPrice: number;
    soldDate: string;
    daysOnMarket?: number;
    bedrooms?: number;
    bathrooms?: number;
    sqft?: number;
    sourceUrl?: string;
  }>;
}

@Injectable()
export class CompsService {
  private readonly logger = new Logger(CompsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private reapiService: ReapiService,
    private batchDataCompService: BatchDataCompService,
  ) {}

  /**
   * Fetch comps and ARV for a property. Provider selection is per-request via preferSource:
   *   - 'reapi'     → run REAPI /v3/PropertyComps; NO fallback.
   *   - 'batchdata' → run BatchData /property/search compAddress; NO fallback.
   *   - 'auto'      → try REAPI → ChatARV → placeholder.
   * Persists the chosen provider on lead.compsProvider.
   */
  async fetchComps(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
    options?: { forceRefresh?: boolean; preferSource?: 'reapi' | 'batchdata' | 'auto' },
  ): Promise<{
    arv: number;
    arvLow?: number;
    arvHigh?: number;
    confidence: number;
    compsCount: number;
    source: string;
  }> {
    const preferSource = options?.preferSource || 'auto';

    // Persist the user's provider choice on the lead so the UI toggle sticks across visits.
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { compsProvider: preferSource },
    }).catch(err => this.logger.warn(`Failed to persist compsProvider for lead ${leadId}: ${err.message}`));

    // ── Explicit REAPI ──────────────────────────────────────────────────────
    if (preferSource === 'reapi') {
      if (!this.reapiService.isConfigured) {
        this.logger.error(`REAPI requested but not configured for lead ${leadId}`);
        return { arv: 0, confidence: 0, compsCount: 0, source: 'reapi (not configured)' };
      }
      return await this.runReapiPipeline(leadId, address, options);
    }

    // ── Explicit BatchData — no fallback ────────────────────────────────────
    if (preferSource === 'batchdata') {
      this.logger.log(`Using BatchData comps pipeline for lead ${leadId}`);
      // Honor the user's saved Age + Distance filters from CompAnalysis,
      // same as the REAPI pipeline does. Falls back to BatchData service
      // defaults (1mi / 12mo / 25 results) if no analysis exists.
      const analysis = await this.prisma.compAnalysis.findFirst({
        where: { leadId },
        orderBy: { updatedAt: 'desc' },
        select: { maxDistance: true, timeFrameMonths: true },
      });
      return await this.batchDataCompService.fetchAndSaveComps(leadId, address, {
        forceRefresh: options?.forceRefresh,
        maxRadiusMiles: analysis?.maxDistance ?? undefined,
        maxAgeMonths: analysis?.timeFrameMonths ?? undefined,
      });
    }

    // ── Auto: REAPI first, then ChatARV → placeholder ──────────────────────
    if (this.reapiService.isConfigured) {
      try {
        const result = await this.runReapiPipeline(leadId, address, options);
        if (result.compsCount >= 1) {
          this.logger.log(`REAPI comps (auto): ${result.compsCount} found`);
          return result;
        }
        this.logger.warn(`REAPI returned 0 comps — falling back to ChatARV (auto mode)`);
      } catch (err) {
        this.logger.warn(`REAPI failed in auto mode — falling back to ChatARV: ${(err as Error).message}`);
      }
    }

    // Auto fallback: ChatARV → placeholder.
    return await this.fetchCompsWithFallback(leadId, address);
  }

  /**
   * Run the REAPI comps pipeline — fetch + persist + compute a summary ARV.
   *
   * If a CompAnalysis already exists for the lead, we read the user's chosen
   * Age + Distance filters from it and pass them through to REAPI as
   * max_days_back / max_radius_miles. That way clicking "Refresh Comps" with
   * the slider at 24mo / ≤3mi actually pulls a wider set from REAPI, not
   * just narrows what was already in the DB.
   */
  private async runReapiPipeline(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
    options?: { forceRefresh?: boolean },
  ): Promise<{
    arv: number; arvLow?: number; arvHigh?: number; confidence: number; compsCount: number; source: string;
  }> {
    this.logger.log(`Using REAPI comps pipeline for lead ${leadId}`);

    // Pull current filter prefs from the most recent CompAnalysis (if any).
    // Falls back to the wide defaults baked into reapi.service.ts.
    // Hard cap radius at 5 miles — anything beyond that is rarely a useful
    // comp and lets REAPI's matching reach into other towns/markets that
    // drown out the local set. (UI Distance filter also capped at 5mi.)
    const REAPI_MAX_RADIUS_CAP = 5;
    const analysis = await this.prisma.compAnalysis.findFirst({
      where: { leadId },
      orderBy: { updatedAt: 'desc' },
      select: { maxDistance: true, timeFrameMonths: true },
    });
    const maxRadiusMiles = analysis?.maxDistance != null
      ? Math.min(analysis.maxDistance, REAPI_MAX_RADIUS_CAP)
      : undefined;
    const maxDaysBack = analysis?.timeFrameMonths
      ? Math.round(analysis.timeFrameMonths * 30.4)
      : undefined;

    try {
      const result = await this.reapiService.fetchAndSaveComps(leadId, address, {
        forceRefresh: options?.forceRefresh,
        maxRadiusMiles,
        maxDaysBack,
      });
      this.logger.log(
        `REAPI pipeline complete: ARV=$${(result.arv || 0).toLocaleString()}, ${result.compsCount} comps`,
      );
      return result;
    } catch (err) {
      this.logger.error(`REAPI pipeline failed for lead ${leadId}: ${(err as Error).message}`);
      return { arv: 0, confidence: 0, compsCount: 0, source: 'reapi (error)' };
    }
  }

  private async fetchCompsWithFallback(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
  ) {
    // 1) Try ChatARV
    const chatARVKey = this.config.get<string>('CHATARV_API_KEY');
    if (chatARVKey) {
      try {
        this.logger.log(`Fetching comps via ChatARV for lead ${leadId}`);
        return await this.fetchFromChatARV(leadId, address, chatARVKey);
      } catch (error) {
        this.logger.error(`ChatARV fetch failed: ${error.message}`);
      }
    }

    // 2) Fallback to placeholder
    this.logger.log(`Using placeholder comps for lead ${leadId}`);
    return await this.createPlaceholderComps(leadId, address);
  }

  /**
   * Fetch from ChatARV.ai API
   */
  private async fetchFromChatARV(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
    apiKey: string,
  ): Promise<{ arv: number; confidence: number; compsCount: number; source: string }> {
    const fullAddress = `${address.street}, ${address.city}, ${address.state} ${address.zip}`;

    const response = await axios.post<ChatARVResponse>(
      'https://api.chatarv.ai/v1/comps',
      { address: fullAddress, radius: 1.0, max_comps: 10 },
      {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      },
    );

    const data = response.data;

    await this.prisma.comp.deleteMany({ where: { leadId, source: 'chatarv', analysisId: null } });

    for (const comp of data.comps) {
      await this.prisma.comp.create({
        data: {
          leadId,
          address: comp.address,
          distance: comp.distance,
          soldPrice: comp.soldPrice,
          soldDate: new Date(comp.soldDate),
          daysOnMarket: comp.daysOnMarket,
          bedrooms: comp.bedrooms,
          bathrooms: comp.bathrooms,
          sqft: comp.sqft,
          sourceUrl: comp.sourceUrl,
          source: 'chatarv',
        },
      });
    }

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { arv: data.arv, arvConfidence: data.confidence, lastCompsDate: new Date() },
    });

    return { arv: data.arv, confidence: data.confidence, compsCount: data.comps.length, source: 'chatarv' };
  }

  /**
   * Create placeholder comps for development/demo
   */
  private async createPlaceholderComps(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
  ): Promise<{ arv: number; confidence: number; compsCount: number; source: string }> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { askingPrice: true, bedrooms: true, bathrooms: true, sqft: true },
    });

    const baseValue = lead?.askingPrice || 200000;
    const arv = Math.round(baseValue * 1.15);
    const confidence = 50; // Lower confidence for placeholder data

    const compCount = 3;
    const comps: Array<{
      address: string;
      distance: number;
      soldPrice: number;
      soldDate: Date;
      daysOnMarket: number;
      bedrooms?: number;
      bathrooms?: number;
      sqft?: number;
    }> = [];

    for (let i = 0; i < compCount; i++) {
      const variance = 0.95 + Math.random() * 0.1;
      comps.push({
        address: `${100 + i * 100} Comparable St, ${address.city}, ${address.state}`,
        distance: Math.round((0.2 + Math.random() * 0.8) * 10) / 10,
        soldPrice: Math.round(arv * variance),
        soldDate: new Date(Date.now() - (30 + i * 15) * 24 * 60 * 60 * 1000),
        daysOnMarket: 15 + Math.floor(Math.random() * 30),
        bedrooms: lead?.bedrooms,
        bathrooms: lead?.bathrooms,
        sqft: lead?.sqft,
      });
    }

    await this.prisma.comp.deleteMany({ where: { leadId, source: 'placeholder', analysisId: null } });

    for (const comp of comps) {
      await this.prisma.comp.create({
        data: { leadId, ...comp, source: 'placeholder' },
      });
    }

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { arv, arvConfidence: confidence, lastCompsDate: new Date() },
    });

    return { arv, confidence, compsCount: compCount, source: 'placeholder' };
  }

  /**
   * Get comps for a lead.
   * Auto-backfills similarity scores if any are missing.
   *
   * Deduplicated by default — when REAPI MLS and BatchData both return
   * the same property (or two refresh runs from the same provider end
   * up persisting overlapping rows), the canonical row wins and the
   * other duplicate(s) are filtered out. Pass `{ raw: true }` for the
   * Compare Providers view, which needs both providers' rows visible
   * side-by-side.
   */
  async getComps(leadId: string, opts?: { raw?: boolean }) {
    const comps = await this.prisma.comp.findMany({
      where: { leadId },
      orderBy: [{ similarityScore: 'desc' }, { distance: 'asc' }],
    });

    // Backfill similarity if any comp is missing a score
    const needsBackfill = comps.some((c) => c.similarityScore == null);
    if (needsBackfill && comps.length > 0) {
      await this.recalculateSimilarityScores(leadId);
      const refreshed = await this.prisma.comp.findMany({
        where: { leadId },
        orderBy: [{ similarityScore: 'desc' }, { distance: 'asc' }],
      });
      return opts?.raw ? refreshed : dedupCompList(refreshed);
    }

    return opts?.raw ? comps : dedupCompList(comps);
  }

  // dedup helpers live in `./comp-dedup.ts` — single source of truth
  // shared with comp-analysis.service. Reference them directly below.

  /**
   * Fetch full MLS detail for a comp's listing and return a normalized
   * timeline of events. Backs the Comp Drill-in modal's Price History
   * tab. Caches the result on `comp.features.mlsDetailCache` for 24h
   * to avoid burning a paid REAPI call on every modal open.
   *
   * Returns `{ events, cachedAt, source: 'cache'|'fresh'|'unavailable' }`.
   * - `unavailable` when the comp isn't an MLS comp or has no MLS#.
   * - Listed + Sold from the persisted Comp row are always merged with
   *   the fetched mlsHistory so the timeline never falls below 2
   *   events for a sold MLS comp.
   */
  async getCompMlsDetail(compId: string): Promise<{
    events: Array<{
      type: string;
      date: string;
      price: number | null;
      source: string | null;
      daysOnMarket: number | null;
      agentName?: string;
      agentOffice?: string;
    }>;
    cachedAt: string | null;
    source: 'cache' | 'fresh' | 'unavailable';
    boardCode?: string | null;
    listingUrl?: string | null;
  }> {
    const comp = await this.prisma.comp.findUnique({ where: { id: compId } });
    if (!comp) throw new Error(`Comp ${compId} not found`);
    if (comp.source !== 'reapi') {
      return { events: [], cachedAt: null, source: 'unavailable' };
    }
    const features = (comp.features as Record<string, unknown> | null) ?? {};
    const mlsNumber = features.mlsNumber as string | undefined;
    const cached = features.mlsDetailCache as
      | { fetchedAt: string; data: any }
      | undefined;
    const cacheTtlMs = 24 * 60 * 60 * 1000;
    if (
      cached?.fetchedAt &&
      Date.now() - new Date(cached.fetchedAt).getTime() < cacheTtlMs
    ) {
      return {
        events: this.buildTimeline(comp, cached.data),
        cachedAt: cached.fetchedAt,
        source: 'cache',
        boardCode: (features.mlsBoardCode as string) ?? null,
        listingUrl: (features.listingUrl as string) ?? comp.sourceUrl ?? null,
      };
    }
    if (!mlsNumber && !comp.address) {
      return { events: this.buildTimeline(comp, null), cachedAt: null, source: 'unavailable' };
    }

    // REAPI's MLSDetail looks up by address (most reliable across boards).
    const detail = await this.reapiService.getMlsDetail(comp.address);
    const fetchedAt = new Date().toISOString();

    if (detail) {
      const updated = {
        ...features,
        mlsDetailCache: { fetchedAt, data: detail },
      };
      await this.prisma.comp.update({
        where: { id: compId },
        data: { features: updated as any },
      });
    }
    return {
      events: this.buildTimeline(comp, detail),
      cachedAt: detail ? fetchedAt : null,
      source: detail ? 'fresh' : 'unavailable',
      boardCode: (features.mlsBoardCode as string) ?? null,
      listingUrl: (features.listingUrl as string) ?? comp.sourceUrl ?? null,
    };
  }

  // Normalize REAPI mlsHistory entries + fall back to stored Listed/Sold
  // when the detail call returned nothing. Sorted newest-first.
  private buildTimeline(comp: any, detail: any) {
    const events: Array<{
      type: string;
      date: string;
      price: number | null;
      source: string | null;
      daysOnMarket: number | null;
      agentName?: string;
      agentOffice?: string;
    }> = [];

    const features = (comp.features as Record<string, unknown> | null) ?? {};
    const board = (features.mlsBoardCode as string | undefined) ?? null;

    // Always seed with stored Sold + Listed events so the timeline is
    // never empty for a successfully-persisted MLS comp.
    if (comp.soldDate && comp.soldPrice) {
      events.push({
        type: 'Sold',
        date: new Date(comp.soldDate).toISOString(),
        price: Math.round(comp.soldPrice),
        source: board,
        daysOnMarket: comp.daysOnMarket ?? null,
      });
    }
    const listDateRaw = features.listDate as string | undefined;
    const listPriceRaw = features.listPrice as number | undefined;
    if (listDateRaw && listDateRaw !== (comp.soldDate as any)) {
      events.push({
        type: 'Listed',
        date: new Date(listDateRaw).toISOString(),
        price: typeof listPriceRaw === 'number' ? listPriceRaw : null,
        source: board,
        daysOnMarket: null,
      });
    }

    // Layer in REAPI mlsHistory when available.
    const history: any[] = Array.isArray(detail?.mlsHistory) ? detail.mlsHistory : [];
    for (const h of history) {
      if (!h?.statusDate) continue;
      const priceNum =
        typeof h.price === 'number'
          ? h.price
          : typeof h.price === 'string'
            ? Number(h.price.replace(/[$,]/g, '')) || null
            : null;
      events.push({
        type: normalizeStatus(h.status),
        date: new Date(h.statusDate).toISOString(),
        price: priceNum,
        source: board,
        daysOnMarket: typeof h.daysOnMarket === 'number' ? h.daysOnMarket : null,
        agentName: h.agentName,
        agentOffice: h.agentOffice,
      });
    }

    // Dedup by (date, type, price) and sort newest-first.
    const seen = new Set<string>();
    const deduped = events.filter((e) => {
      const key = `${e.date.slice(0, 10)}|${e.type}|${e.price ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    deduped.sort((a, b) => b.date.localeCompare(a.date));
    return deduped;
  }

  /**
   * Recalculate similarity scores for all comps of a lead
   */
  async recalculateSimilarityScores(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { bedrooms: true, bathrooms: true, sqft: true, propertyType: true },
    });
    if (!lead) return;

    const comps = await this.prisma.comp.findMany({
      where: { leadId },
    });

    this.logger.log(`Recalculating similarity for ${comps.length} comps (lead ${leadId})`);

    for (const comp of comps) {
      const score = this.calculateSimilarityScore(lead, comp);
      await this.prisma.comp.update({
        where: { id: comp.id },
        data: { similarityScore: score },
      });
    }
  }

  /**
   * Toggle comp selection. When the toggled row has duplicates in the
   * pool (cross-provider overlap, etc.), propagate the new selected
   * state to all members of the dedup group so the canonical's display
   * state stays consistent with what the math actually uses.
   */
  async toggleCompSelection(compId: string) {
    const comp = await this.prisma.comp.findUnique({ where: { id: compId } });
    if (!comp) throw new Error('Comp not found');

    const newSelected = !comp.selected;

    // Find this comp's duplicate group in the lead's pool. The dedup
    // util returns a list of `groups` with canonical + duplicate IDs;
    // we apply the new selected state to every member regardless of
    // which one was clicked.
    const allInLead = await this.prisma.comp.findMany({
      where: { leadId: comp.leadId, analysisId: null },
    });
    const result = dedupCompGroups(allInLead);
    const group = result.groups.find(
      (g) => g.canonicalId === compId || g.duplicateIds.includes(compId),
    );
    const idsToUpdate = group
      ? [group.canonicalId, ...group.duplicateIds]
      : [compId];

    await this.prisma.comp.updateMany({
      where: { id: { in: idsToUpdate } },
      data: { selected: newSelected },
    });

    // ARV is no longer auto-recomputed on toggle (Build 016). The Valuation
    // tab's strip enters a stale state and prompts the user to recalculate.
    return { ...comp, selected: newSelected };
  }

  /**
   * Bulk update comp selections based on similarity threshold
   */
  async autoSelectComps(leadId: string, minSimilarity: number, maxDistance: number) {
    // Deselect all first
    await this.prisma.comp.updateMany({
      where: { leadId, analysisId: null },
      data: { selected: false },
    });

    // Select comps meeting criteria
    const comps = await this.prisma.comp.findMany({
      where: { leadId, analysisId: null },
    });

    for (const comp of comps) {
      const meetsThreshold = (comp.similarityScore || 0) >= minSimilarity && comp.distance <= maxDistance;
      if (meetsThreshold) {
        await this.prisma.comp.update({
          where: { id: comp.id },
          data: { selected: true },
        });
      }
    }

    // ARV no longer auto-recomputed on bulk select (Build 016). The strip
    // goes stale and the user clicks Recalculate explicitly.
    return this.getComps(leadId);
  }

  // recalculateArv removed in Build 016. ARV is produced by
  // AiArvCalculationService at POST /leads/:id/arv-calculation.

  /**
   * Calculate similarity score between subject property and a comp (0-100)
   */
  calculateSimilarityScore(
    subject: { bedrooms?: number | null; bathrooms?: number | null; sqft?: number | null; propertyType?: string | null },
    comp: { bedrooms?: number | null; bathrooms?: number | null; sqft?: number | null; propertyType?: string | null },
  ): number {
    let score = 0;
    let maxScore = 0;

    // Bedrooms (25 points)
    maxScore += 25;
    if (subject.bedrooms != null && comp.bedrooms != null) {
      const diff = Math.abs(subject.bedrooms - comp.bedrooms);
      if (diff === 0) score += 25;
      else if (diff === 1) score += 15;
      else if (diff === 2) score += 5;
    }

    // Bathrooms (25 points)
    maxScore += 25;
    if (subject.bathrooms != null && comp.bathrooms != null) {
      const diff = Math.abs(subject.bathrooms - comp.bathrooms);
      if (diff === 0) score += 25;
      else if (diff <= 0.5) score += 20;
      else if (diff <= 1) score += 10;
      else if (diff <= 1.5) score += 5;
    }

    // Square footage (40 points — most important)
    maxScore += 40;
    if (subject.sqft && comp.sqft && subject.sqft > 0) {
      const pctDiff = (Math.abs(subject.sqft - comp.sqft) / subject.sqft) * 100;
      if (pctDiff <= 5) score += 40;
      else if (pctDiff <= 10) score += 35;
      else if (pctDiff <= 15) score += 25;
      else if (pctDiff <= 20) score += 15;
      else if (pctDiff <= 30) score += 5;
    }

    // Property type (10 points)
    maxScore += 10;
    if (subject.propertyType && comp.propertyType) {
      if (subject.propertyType.toLowerCase() === comp.propertyType.toLowerCase()) score += 10;
    }

    return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  }

  /**
   * Calculate zip-code $/sqft baseline from local comps and other leads in same zip.
   */
  async getZipCodeBaseline(leadId: string): Promise<{
    medianPricePerSqft: number;
    sampleSize: number;
    source: string;
  } | null> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { propertyZip: true },
    });
    if (!lead?.propertyZip) return null;

    const priceSqftValues: number[] = [];

    // 1) Comps for this lead with both soldPrice and sqft
    const comps = await this.prisma.comp.findMany({
      where: { leadId },
      select: { soldPrice: true, sqft: true },
    });
    for (const c of comps) {
      if (c.soldPrice > 0 && c.sqft && c.sqft > 0) {
        priceSqftValues.push(c.soldPrice / c.sqft);
      }
    }

    // 2) Other leads in the same zip with arv + sqft
    const zipLeads = await this.prisma.lead.findMany({
      where: {
        propertyZip: lead.propertyZip,
        id: { not: leadId },
        arv: { not: null, gt: 0 },
        sqft: { not: null, gt: 0 },
      },
      select: { arv: true, sqft: true },
    });
    for (const l of zipLeads) {
      if (l.arv && l.sqft && l.sqft > 0) {
        priceSqftValues.push(l.arv / l.sqft);
      }
    }

    if (priceSqftValues.length < 3) {
      this.logger.log(`Zip baseline for ${lead.propertyZip}: only ${priceSqftValues.length} data points (need 3+)`);
      return null;
    }

    // Calculate median
    priceSqftValues.sort((a, b) => a - b);
    const mid = Math.floor(priceSqftValues.length / 2);
    const median = priceSqftValues.length % 2 === 0
      ? (priceSqftValues[mid - 1] + priceSqftValues[mid]) / 2
      : priceSqftValues[mid];

    const source = zipLeads.length > 0 ? 'local_comps+zip_leads' : 'local_comps';
    this.logger.log(
      `Zip baseline for ${lead.propertyZip}: $${Math.round(median)}/sqft from ${priceSqftValues.length} data points (${source})`,
    );

    return {
      medianPricePerSqft: Math.round(median * 100) / 100,
      sampleSize: priceSqftValues.length,
      source,
    };
  }
}

// REAPI status strings vary by board; normalize to a small enum the
// UI can color/label consistently.
function normalizeStatus(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'Unknown';
  const k = raw.trim().toLowerCase();
  if (k === 'active' || k === 'listed' || k.includes('for sale')) return 'Listed';
  if (k === 'sold' || k === 'closed') return 'Sold';
  if (k === 'pending' || k.includes('contingent')) return 'Pending';
  if (k.includes('removed') || k === 'withdrawn' || k === 'cancelled' || k === 'canceled' || k === 'expired') return 'Removed';
  if (k.includes('price') && k.includes('change')) return 'Price Change';
  if (k.includes('price reduce') || k.includes('reduced')) return 'Price Change';
  // Capitalize first letter as a fallback.
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
