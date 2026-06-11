'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { leadsAPI, compsAPI, compAnalysisAPI, photosAPI, arvCalculationAPI } from '@/lib/api';
import ArvResultStrip, { type StripState } from '@/components/aiArvCalculation/ArvResultStrip';
import ArvCalculationDrawer from '@/components/aiArvCalculation/ArvCalculationDrawer';
import type { AIArvCalculationResult, ValuationMode } from '@/lib/aiArvCalculation/types';
import AppShell from '@/components/AppShell';
import LeadTabNav, { COMPS_TABS, DETAIL_TABS } from '@/components/LeadTabNav';
import DealMathPanel from './deal-math/DealMathPanel';
import LeadRail from '@/components/leadDetailV2/LeadRail';
import CompRow from '@/components/CompRow';
import SubjectPropertyCard from '@/components/SubjectPropertyCard';
import CompsToolbar from '@/components/CompsToolbar';
import CurationErrorBoundary from '@/components/aiCompCuration/CurationErrorBoundary';
import SubjectPropertySection from '@/components/aiCompCuration/SubjectPropertySection';
import ComparablePropertiesSection from '@/components/aiCompCuration/ComparablePropertiesSection';
import { compDistance } from '@/lib/geo';
import { isAiCompCurationEnabled } from '@/lib/flags';
import type {
  AiCurationDecision,
  CurationResult,
} from '@/lib/aiCompCuration/types';

const CompsMap = dynamic(() => import('@/components/CompsMap'), { ssr: false, loading: () => <div className="w-full h-64 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" /> });

// ─── Types ────────────────────────────────────────────────────────────────────
interface Lead {
  id: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  propertyType?: string;
  askingPrice?: number;
  arv?: number;
  arvConfidence?: number;
  conditionLevel?: string;
  lastCompsDate?: string;
  primaryPhoto?: string;
  photos?: any[];
  scoreBand?: string;
  totalScore?: number;
  yearBuilt?: number;
  lotSize?: number;
  lastSaleDate?: string;
  lastSalePrice?: number;
  taxAssessedValue?: number;
  ownerOccupied?: boolean;
  hoaFee?: number;
  latitude?: number;
  longitude?: number;
}

interface Comp {
  id: string;
  address: string;
  distance: number;
  soldPrice: number;
  soldDate: string;
  daysOnMarket?: number;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  lotSize?: number;
  yearBuilt?: number;
  hasPool: boolean;
  hasGarage: boolean;
  isRenovated: boolean;
  propertyType?: string;
  hoaFees?: number;
  schoolDistrict?: string;
  photoUrl?: string;
  notes?: string;
  selected: boolean;
  adjustmentAmount?: number;
  adjustedPrice?: number;
  adjustmentNotes?: string;
  source?: string;
  correlation?: number;
  latitude?: number;
  longitude?: number;
  features?: any;
}

interface Analysis {
  id: string;
  mode: string;
  maxDistance: number;
  timeFrameMonths: number;
  propertyStatus: string[];
  propertyType: string;
  confidenceScore: number;
  aiSummary?: string;
  arvEstimate?: number;
  arvLow?: number;
  arvHigh?: number;
  arvMethod: string;
  avgAdjustment?: number;
  pricePerSqft?: number;
  medianPricePerSqft?: number;
  comparableSalesValue?: number;
  adjustmentsEnabled: boolean;
  adjustmentConfig?: Record<string, any>;
  repairCosts?: number;
  repairFinishLevel?: string;
  repairNotes?: string;
  repairItems?: string[];
  dealType: string;
  assignmentFee: number;
  maoPercent: number;
  // Cost approach (display-only reference)
  costApproachValue?: number;
  costApproachLandValue?: number;
  costApproachBuildCost?: number;
  // AI-adjusted ARV (blended with comparableSalesValue to produce arvEstimate)
  aiArvEstimate?: number;
  aiArvLow?: number;
  aiArvHigh?: number;
  aiConfidence?: number;
  confidenceTier?: string;
  // Phase 2: Risk flags
  riskAdjustedArv?: number;
  riskFlags?: string[];
  sellerMotivationTier?: string;
  sellerMotivationMaoPercent?: number;
  conditionTier?: string;
  repairCostLow?: number;
  repairCostHigh?: number;
  negotiationRangeLow?: number;
  negotiationRangeHigh?: number;
  functionalObsolescenceAdj?: number;
  buyerPoolReduction?: number;
  landUtilityReduction?: number;
  dealIntelligence?: string;
  comps: Comp[];
  lead: Lead;
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CompsAnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadId = params.id as string;

  // Derive active tab from URL; redirect old tabs and detail-page tabs.
  const rawTab = searchParams.get('tab') || 'valuation';
  // Build 016: legacy ?tab=comps and ?tab=arv both map to ?tab=valuation.
  const isLegacyValuationTab = rawTab === 'comps' || rawTab === 'arv';
  // Phase D: legacy ?tab=repairs and ?tab=deal-analysis both map to ?tab=deal-math.
  const isLegacyDealMathTab = rawTab === 'repairs' || rawTab === 'deal-analysis';
  const activeSection = isLegacyValuationTab
    ? 'valuation'
    : isLegacyDealMathTab
      ? 'deal-math'
      : COMPS_TABS.includes(rawTab as any)
        ? rawTab
        : 'valuation';

  useEffect(() => {
    if (isLegacyValuationTab) {
      router.replace(
        `/leads/${leadId}/comps-analysis?tab=valuation`,
        { scroll: false },
      );
      return;
    }
    if (isLegacyDealMathTab) {
      router.replace(
        `/leads/${leadId}/comps-analysis?tab=deal-math`,
        { scroll: false },
      );
      return;
    }
    if (rawTab && DETAIL_TABS.includes(rawTab as any)) {
      router.replace(`/leads/${leadId}?tab=${rawTab}`);
    }
  }, [rawTab, leadId, router, isLegacyValuationTab, isLegacyDealMathTab]);

  const [lead, setLead] = useState<Lead | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchingComps, setFetchingComps] = useState(false);
  const [compsSource, setCompsSource] = useState<'reapi' | 'batchdata'>('reapi');
  const [comparisonMode, setComparisonMode] = useState(false);
  const [aiCurationResult, setAiCurationResult] = useState<CurationResult | null>(null);
  const aiDecisionMap: Record<string, AiCurationDecision> = useMemo(() => {
    if (!aiCurationResult) return {};
    const out: Record<string, AiCurationDecision> = {};
    for (const r of aiCurationResult.rankings) {
      out[r.candidateId] = {
        rank: r.rank,
        inclusion: r.inclusion,
        reasoning: r.reasoning,
        flags: r.flags,
        externalLinks: r.externalLinks,
      };
    }
    return out;
  }, [aiCurationResult]);
  const aiCurationFlag = isAiCompCurationEnabled();

  // ── ARV calculation state (Build 016) ─────────────────────────────────
  const [arvResult, setArvResult] = useState<AIArvCalculationResult | null>(null);
  const [arvHistory, setArvHistory] = useState<AIArvCalculationResult[]>([]);
  const [arvHistoryLoading, setArvHistoryLoading] = useState(false);
  const [arvCalculating, setArvCalculating] = useState(false);
  const [arvError, setArvError] = useState<string | null>(null);
  const [valuationMode, setValuationMode] = useState<ValuationMode>('ARV_RENOVATED');
  // Raw comps for the lead, unfiltered by analysis source. Populated when
  // entering comparison mode so the side-by-side view sees both providers'
  // rows even though importExistingComps filters the analysis to one source.
  const [comparisonComps, setComparisonComps] = useState<any[]>([]);
  const BATCHDATA_ENABLED = process.env.NEXT_PUBLIC_BATCHDATA_ENABLED === 'true';
  const [sortField, setSortField] = useState<string>('distance');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [hoveredCompId, setHoveredCompId] = useState<string | null>(null);
  const compListRef = useRef<HTMLDivElement>(null);
  const compRowRefs = useRef<Record<string, HTMLElement | null>>({});

  // Stable comp-id → display number map (must be here, before early returns, to satisfy Rules of Hooks)
  const compIndexMap = useMemo(
    () => new Map((analysis?.comps || []).map((c, i) => [c.id, i + 1])),
    [analysis?.comps],
  );

  // Add comp form
  const [showAddComp, setShowAddComp] = useState(false);
  const [compForm, setCompForm] = useState({
    address: '', distance: '', soldPrice: '', soldDate: '',
    daysOnMarket: '', bedrooms: '', bathrooms: '', sqft: '',
    lotSize: '', yearBuilt: '', hasPool: false, hasGarage: false,
    isRenovated: false, propertyType: '', notes: '',
  });

  // Processing states still used by deal-intel branch.
  const [generatingDealIntel, setGeneratingDealIntel] = useState(false);

  useEffect(() => {
    loadData();
  }, [leadId]);

  // Auto-load comps on Comps tab entry when the pool is empty.
  // Replaces the "Find Comps" button gate from earlier iterations.
  // Provider cache layer (24h BatchData / REAPI logic) handles
  // freshness — this just kicks the initial fetch.
  const autoFetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!aiCurationFlag) return;
    if (activeSection !== 'valuation') return;
    if (loading || !lead) return;
    if (fetchingComps) return;
    // Already fetched this lead in this session — don't refetch.
    if (autoFetchedRef.current === leadId) return;
    const compCount = analysis?.comps?.length ?? 0;
    if (compCount > 0) {
      autoFetchedRef.current = leadId;
      return;
    }
    autoFetchedRef.current = leadId;
    void handleFindComps(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, loading, lead, leadId, analysis?.comps?.length]);

  const loadData = async () => {
    try {
      const leadRes = await leadsAPI.get(leadId);
      setLead(leadRes.data);
      // Initialize provider toggle from lead's last-used provider
      const savedProvider = (leadRes.data as any).compsProvider;
      if (savedProvider === 'reapi' || savedProvider === 'batchdata') {
        setCompsSource(savedProvider);
      }

      // Check for existing analyses
      const analyses = await compAnalysisAPI.list(leadId);
      if (analyses.data?.length > 0) {
        const latest = analyses.data[0];
        const full = await compAnalysisAPI.get(leadId, latest.id);
        setAnalysis(full.data);
      } else {
        // Auto-create analysis importing existing comps
        const existingComps = await compsAPI.list(leadId);
        if (existingComps.data?.length > 0) {
          const res = await compAnalysisAPI.create(leadId, {
            importExistingComps: true,
          });
          const full = await compAnalysisAPI.get(leadId, res.data.id);
          setAnalysis(full.data);
        }
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshAnalysis = useCallback(async () => {
    if (!analysis) return;
    const res = await compAnalysisAPI.get(leadId, analysis.id);
    setAnalysis(res.data);
  }, [analysis, leadId]);

  // Load latest persisted ARV calc whenever the lead changes.
  useEffect(() => {
    let cancelled = false;
    if (!leadId) return;
    void (async () => {
      try {
        const res = await arvCalculationAPI.getLatest(leadId);
        if (!cancelled) setArvResult(res.data?.result ?? null);
      } catch (err) {
        if (!cancelled) setArvResult(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  // Lazy-load history once when first viewing the valuation tab.
  const fetchArvHistory = useCallback(async () => {
    if (!leadId) return;
    setArvHistoryLoading(true);
    try {
      const res = await arvCalculationAPI.getHistory(leadId, 10);
      setArvHistory(res.data?.items ?? []);
    } catch {
      setArvHistory([]);
    } finally {
      setArvHistoryLoading(false);
    }
  }, [leadId]);
  useEffect(() => {
    if (activeSection === 'valuation') {
      void fetchArvHistory();
    }
  }, [activeSection, fetchArvHistory, arvResult?.computedAt]);

  // Trigger an ARV calculation. Pass exact selected comp IDs so the
  // backend uses the same set the user sees on screen (the analysis is
  // already deduped client-side; the backend would otherwise re-include
  // any duplicate provider rows that share the same canonical address).
  const handleCalculateArv = useCallback(async () => {
    if (!leadId) return;
    const ids = (analysis?.comps || [])
      .filter((c) => c.selected)
      .map((c) => c.id);
    if (ids.length < 2) {
      setArvError('Select at least 2 comps before calculating ARV.');
      return;
    }
    setArvCalculating(true);
    setArvError(null);
    try {
      const res = await arvCalculationAPI.calculate(leadId, {
        mode: valuationMode,
        selectedCompIds: ids,
      });
      setArvResult(res.data?.result ?? null);
      try {
        const lr = await leadsAPI.get(leadId);
        setLead(lr.data);
      } catch {
        /* non-fatal */
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'ARV calculation failed';
      setArvError(typeof msg === 'string' ? msg : 'ARV calculation failed');
    } finally {
      setArvCalculating(false);
    }
  }, [leadId, valuationMode, analysis]);

  // ─── Find Comps (provider chosen by compsSource toggle) ─────────────────────
  const handleFindComps = async (forceRefresh = false) => {
    setFetchingComps(true);
    try {
      const result = await compsAPI.fetch(leadId, forceRefresh, compsSource);

      // Refresh lead data (ARV gets updated)
      const leadRes = await leadsAPI.get(leadId);
      setLead(leadRes.data);

      // Create new analysis — on force refresh, only import comps from the selected source
      const res = await compAnalysisAPI.create(leadId, {
        importExistingComps: true,
        sourceFilter: forceRefresh ? compsSource : undefined,
      });
      const full = await compAnalysisAPI.get(leadId, res.data.id);
      setAnalysis(full.data);
      router.replace(`/leads/${leadId}/comps-analysis?tab=comps`, { scroll: false });

      // If REAPI returned 0 comps, tell the user clearly.
      if ((result.data?.compsCount ?? 0) === 0) {
        const providerLabel = compsSource === 'batchdata' ? 'BatchData' : 'REAPI';
        alert(`${providerLabel} found 0 comps for this property — likely a sparse market with no recent matching sales.`);
      }
    } catch (error: any) {
      console.error('Failed to fetch comps:', error);
      alert(error.response?.data?.message || 'Failed to fetch comps');
    } finally {
      setFetchingComps(false);
    }
  };

  // ─── Compare Providers (run REAPI + BatchData side-by-side) ────────────────
  const handleCompareProviders = async () => {
    setFetchingComps(true);
    try {
      // Run both providers in parallel. Each persists Comp rows tagged with
      // its source. forceRefresh=true so we always get fresh comparable data
      // on demand.
      await Promise.all([
        compsAPI.fetch(leadId, true, 'reapi'),
        compsAPI.fetch(leadId, true, 'batchdata'),
      ]);

      // Refresh lead (ARV may have moved)
      const leadRes = await leadsAPI.get(leadId);
      setLead(leadRes.data);

      // Pull RAW comps for the lead (unfiltered by analysis source). The
      // analysis-import path filters to a single provider based on
      // lead.compsProvider; for the side-by-side view we want both.
      const rawComps = await compsAPI.list(leadId);
      setComparisonComps(rawComps.data || []);

      setComparisonMode(true);
      router.replace(`/leads/${leadId}/comps-analysis?tab=comps`, { scroll: false });
    } catch (error: any) {
      console.error('Compare Providers failed:', error);
      alert(error.response?.data?.message || 'Comparison failed — check that both providers are configured.');
    } finally {
      setFetchingComps(false);
    }
  };

  // ─── Add Comp ─────────────────────────────────────────────────────────────
  const handleAddComp = async () => {
    if (!analysis || !compForm.address || !compForm.soldPrice || !compForm.soldDate) {
      alert('Please fill in Address, Sold Price, and Sold Date');
      return;
    }
    try {
      await compAnalysisAPI.addComp(leadId, analysis.id, {
        address: compForm.address,
        distance: parseFloat(compForm.distance) || 0,
        soldPrice: parseFloat(compForm.soldPrice),
        soldDate: compForm.soldDate,
        daysOnMarket: compForm.daysOnMarket ? parseInt(compForm.daysOnMarket) : undefined,
        bedrooms: compForm.bedrooms ? parseInt(compForm.bedrooms) : undefined,
        bathrooms: compForm.bathrooms ? parseFloat(compForm.bathrooms) : undefined,
        sqft: compForm.sqft ? parseInt(compForm.sqft) : undefined,
        lotSize: compForm.lotSize ? parseFloat(compForm.lotSize) : undefined,
        yearBuilt: compForm.yearBuilt ? parseInt(compForm.yearBuilt) : undefined,
        hasPool: compForm.hasPool,
        hasGarage: compForm.hasGarage,
        isRenovated: compForm.isRenovated,
        propertyType: compForm.propertyType || undefined,
        notes: compForm.notes || undefined,
      });
      setCompForm({
        address: '', distance: '', soldPrice: '', soldDate: '',
        daysOnMarket: '', bedrooms: '', bathrooms: '', sqft: '',
        lotSize: '', yearBuilt: '', hasPool: false, hasGarage: false,
        isRenovated: false, propertyType: '', notes: '',
      });
      setShowAddComp(false);
      await refreshAnalysis();
    } catch (error) {
      console.error('Failed to add comp:', error);
      alert('Failed to add comp');
    }
  };

  // ─── Toggle Comp ──────────────────────────────────────────────────────────
  const handleToggleComp = async (compId: string) => {
    if (!analysis) return;
    try {
      await compAnalysisAPI.toggleComp(leadId, analysis.id, compId);
      await refreshAnalysis();
    } catch (error) {
      console.error('Failed to toggle comp:', error);
    }
  };

  // ─── Delete Comp ──────────────────────────────────────────────────────────
  const handleDeleteComp = async (compId: string) => {
    if (!analysis) return;
    if (!window.confirm('Remove this comp?')) return;
    try {
      await compAnalysisAPI.deleteComp(leadId, analysis.id, compId);
      await refreshAnalysis();
    } catch (error) {
      console.error('Failed to delete comp:', error);
    }
  };

  // calculateArv / aiAdjustComps / generateAssessment removed in Build 016.
  // ARV is now calculated by AiArvCalculationService — see ArvResultStrip
  // mounted inside SubjectPropertySection on the Valuation tab.

  // ─── Deal Intelligence ──────────────────────────────────────────────────────
  const handleGenerateDealIntelligence = async () => {
    if (!analysis) return;
    setGeneratingDealIntel(true);
    try {
      await compAnalysisAPI.dealIntelligence(leadId, analysis.id);
      const updated = await compAnalysisAPI.get(leadId, analysis.id);
      setAnalysis(updated.data);
    } catch (error) {
      console.error("Deal intelligence failed:", error);
      alert("Failed to generate deal intelligence");
    } finally {
      setGeneratingDealIntel(false);
    }
  };

  // saveToLead handler removed in Build 016 — ARV is now persisted
  // implicitly inside AiArvCalculationService on each successful calc.

  // ─── Sorting ──────────────────────────────────────────────────────────────
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Auto-scroll comp list to hovered comp (triggered from map hover)
  useEffect(() => {
    if (!hoveredCompId) return;
    const row = compRowRefs.current[hoveredCompId];
    const container = compListRef.current;
    if (!row || !container) return;
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top >= containerRect.top && rowRect.bottom <= containerRect.bottom) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [hoveredCompId]);

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-lg text-gray-500 dark:text-gray-400">Loading analysis...</div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-lg text-gray-500 dark:text-gray-400">Lead not found</div>
      </div>
    );
  }

  const allComps = analysis?.comps || [];
  const selectedComps = allComps.filter((c) => c.selected);

  // ARV strip state derivation: pre-calc / post-calc / stale / calculating
  const arvStripState: StripState = (() => {
    if (arvCalculating) return 'calculating';
    if (!arvResult) return 'pre-calc';
    const prevSet = new Set(arvResult.selectedCompIds || []);
    const currentIds = selectedComps.map((c) => c.id);
    const sameSet =
      currentIds.length === prevSet.size &&
      currentIds.every((id) => prevSet.has(id)) &&
      arvResult.mode === valuationMode;
    return sameSet ? 'post-calc' : 'stale';
  })();
  const reapiAvm = (lead as any)?.reapiEstimatedValue ?? null;

  // Sort comps
  const sortedComps = [...allComps].sort((a, b) => {
    let aVal: any, bVal: any;
    switch (sortField) {
      case 'distance': aVal = a.distance; bVal = b.distance; break;
      case 'soldPrice': aVal = a.soldPrice; bVal = b.soldPrice; break;
      case 'sqft': aVal = a.sqft || 0; bVal = b.sqft || 0; break;
      case 'soldDate': aVal = new Date(a.soldDate).getTime(); bVal = new Date(b.soldDate).getTime(); break;
      case 'correlation': aVal = a.correlation || 0; bVal = b.correlation || 0; break;
      default: aVal = a.distance; bVal = b.distance;
    }
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  // Stats
  const avgPrice = selectedComps.length > 0
    ? Math.round(selectedComps.reduce((s, c) => s + c.soldPrice, 0) / selectedComps.length)
    : 0;
  const avgPricePerSqft = selectedComps.length > 0
    ? Math.round(
        selectedComps.filter(c => c.sqft).reduce((s, c) => s + c.soldPrice / (c.sqft || 1), 0) /
        selectedComps.filter(c => c.sqft).length || 0
      )
    : 0;
  const compsFromReapi = allComps.filter(c => c.source === 'reapi').length;
  const compsFromBatchData = allComps.filter(c => c.source === 'batchdata').length;
  const compsWithSource = compsFromReapi + compsFromBatchData;

  return (
    <AppShell>
      <div className="lg:flex">

      {/* Left rail: shared lead workspace summary (sticky on desktop) */}
      <aside className="hidden lg:block w-80 xl:w-96 shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:overflow-y-auto">
        {lead && (
          <LeadRail
            lead={lead}
            onLeadPatch={(patch: any) => setLead((prev: any) => (prev ? { ...prev, ...patch } : prev))}
            onMarkDead={async () => {
              try {
                await leadsAPI.update(leadId, { status: 'DEAD' });
              } catch (err) {
                console.error('Failed to mark dead', err);
              }
              router.push(`/leads/${leadId}?tab=disposition`);
            }}
          />
        )}
      </aside>

      <div className="flex-1 min-w-0">

      {/* Unified Tab Nav */}
      <LeadTabNav leadId={leadId} activeTab={activeSection} />

      {/* ═══════════════ VALUATION SECTION — Build 016: comps + ARV unified ═══════════════ */}
      {activeSection === 'valuation' && aiCurationFlag && lead && (
        <div>
          {/* Subject Property — hero photo + full data grid + ARV strip */}
          <SubjectPropertySection
            lead={lead as any}
            onLeadRefresh={async () => {
              try {
                const lr = await leadsAPI.get(leadId);
                setLead(lr.data);
              } catch (err) {
                console.error('Failed to refresh lead after Street View fetch:', err);
              }
            }}
            onUploadPhotos={async (files) => {
              if (files.length === 1) await photosAPI.upload(leadId, files[0]);
              else await photosAPI.uploadMultiple(leadId, files);
              const lr = await leadsAPI.get(leadId);
              setLead(lr.data);
            }}
            arvStripSlot={
              <ArvResultStrip
                state={arvStripState}
                result={arvResult}
                reapiAvm={reapiAvm}
                mode={valuationMode}
                onCalculate={handleCalculateArv}
                selectedCount={selectedComps.length}
                errorMessage={arvError}
              />
            }
          />

          {/* Drawer sits between subject + comp grid when a result exists.
              Auto-expands on first calc; tabs cover adjustments / method /
              stats / history. */}
          {arvResult && (
            <div className="px-3 sm:px-4 lg:px-6 pt-4">
              <ArvCalculationDrawer
                result={arvResult}
                history={arvHistory}
                historyLoading={arvHistoryLoading}
              />
            </div>
          )}

          {comparisonMode ? (
            <div className="px-3 sm:px-4 lg:px-6 py-4">
              <ProviderComparisonView
                comps={comparisonComps}
                lead={lead}
                hoveredCompId={hoveredCompId}
                setHoveredCompId={setHoveredCompId}
                onToggle={handleToggleComp}
                onDelete={handleDeleteComp}
                onClose={() => setComparisonMode(false)}
                onUseProvider={async (provider) => {
                  setCompsSource(provider);
                  setComparisonMode(false);
                  try {
                    await leadsAPI.update(leadId, { compsProvider: provider } as any);
                  } catch (err) {
                    console.error('Failed to persist compsProvider:', err);
                  }
                }}
                compIndexMap={compIndexMap}
              />
            </div>
          ) : (
            <CurationErrorBoundary>
              <ComparablePropertiesSection
                leadId={leadId}
                analysisId={analysis?.id ?? null}
                comps={allComps.map((c: any) => ({
                  ...c,
                  // Backfill missing/zero distance with haversine when
                  // both subject and comp coords are present. Mirrors
                  // the backend's Phase A.7 fallback so existing rows
                  // don't show 0.00mi until they're re-fetched.
                  distance: compDistance(c, lead),
                })) as any}
                subject={{
                  bedrooms: lead.bedrooms,
                  bathrooms: lead.bathrooms,
                  sqft: lead.sqft,
                }}
                mapLead={lead as any}
                selectedCompIds={
                  new Set(allComps.filter((c) => c.selected).map((c) => c.id))
                }
                onToggleCompSelection={handleToggleComp}
                filters={{
                  compsSource,
                  batchDataEnabled: BATCHDATA_ENABLED,
                  filterMonths: analysis?.timeFrameMonths ?? 12,
                  filterDistance: analysis?.maxDistance ?? 1,
                  sortField,
                  sortDir,
                  fetchingComps,
                  onSetCompsSource: setCompsSource,
                  onCompareProviders: handleCompareProviders,
                  onSetFilterMonths: async (months) => {
                    if (!analysis) return;
                    try {
                      await compAnalysisAPI.applyFilters(leadId, analysis.id, { timeFrameMonths: months });
                      await refreshAnalysis();
                    } catch (err) {
                      console.error('Failed to apply age filter:', err);
                    }
                  },
                  onSetFilterDistance: async (miles) => {
                    if (!analysis) return;
                    try {
                      await compAnalysisAPI.applyFilters(leadId, analysis.id, { maxDistance: miles });
                      await refreshAnalysis();
                    } catch (err) {
                      console.error('Failed to apply distance filter:', err);
                    }
                  },
                  onSort: handleSort,
                  onSelectAll: async (selected) => {
                    if (!analysis) return;
                    await compAnalysisAPI.selectAll(leadId, analysis.id, selected);
                    await refreshAnalysis();
                  },
                  onRefreshComps: () => handleFindComps(true),
                }}
                onResultChange={setAiCurationResult}
                onCurationApplied={() => {
                  void refreshAnalysis();
                }}
                onAddManualComp={() => setShowAddComp(true)}
              />
            </CurationErrorBoundary>
          )}

          {/* Build 016: the legacy "AI Adjust & Calculate ARV" button is
              gone. ARV is now triggered from the Calculate / Recalculate
              button on the ArvResultStrip inside SubjectPropertySection. */}

          {/* If no result yet, mount the drawer at the bottom (collapsed)
              as a placeholder hint. After first calc the drawer at the
              top — placed between subject and comp grid — takes over. */}
          {!arvResult && (
            <div className="px-3 sm:px-4 lg:px-6 pb-6">
              <ArvCalculationDrawer
                result={null}
                history={arvHistory}
                historyLoading={arvHistoryLoading}
              />
            </div>
          )}
        </div>
      )}

      {/* ═══════════════ COMPS SECTION (legacy split-pane, flag-off) ═══════════════ */}
      {activeSection === 'valuation' && !aiCurationFlag && (
        <div className="px-4 sm:px-6 lg:px-8 py-6 flex flex-col lg:flex-row lg:h-[calc(100vh-12rem)]">
          {/* ── LEFT PANE: Map + Subject Property ── */}
          <div className="lg:w-[45%] xl:w-[42%] flex flex-col border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 lg:overflow-y-auto rounded-l-lg">
            {/* Map */}
            {(allComps.some(c => c.latitude && c.longitude) || (lead?.latitude && lead?.longitude)) ? (
              <div className="h-64 lg:h-[500px] shrink-0 relative">
                <div className="absolute inset-0">
                  <CompsMap
                    lead={lead!}
                    comps={allComps}
                    compIndexMap={compIndexMap}
                    hoveredCompId={hoveredCompId}
                    onHoverComp={setHoveredCompId}
                    onToggleComp={async (compId) => {
                      if (!analysis) return;
                      await compAnalysisAPI.toggleComp(leadId, analysis.id, compId);
                      await refreshAnalysis();
                    }}
                  />
                </div>
                {/* Map legend overlay */}
                <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-3 text-[10px] items-center bg-white/90 dark:bg-gray-900/90 rounded-lg px-2 py-1.5 backdrop-blur-sm z-[400]">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-red-600 rounded-full border border-white shadow" />
                    <span className="text-gray-600 dark:text-gray-400">Subject</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-blue-600 rounded-full border border-white shadow" />
                    <span className="text-gray-600 dark:text-gray-400">Selected</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-gray-400 rounded-full border border-white shadow" />
                    <span className="text-gray-600 dark:text-gray-400">Unselected</span>
                  </div>
                  <span className="text-gray-400 dark:text-gray-500 italic ml-auto">
                    {allComps.filter(c => c.latitude && c.longitude).length}/{allComps.length} mapped
                  </span>
                </div>
              </div>
            ) : (
              <div className="h-64 lg:h-[500px] shrink-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-400 rounded-tl-lg">
                No coordinates available
              </div>
            )}

            {/* Subject Property (compact on desktop, full on mobile) */}
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="hidden lg:block">
                <SubjectPropertyCard lead={lead} compact />
              </div>
              <div className="lg:hidden">
                <SubjectPropertyCard lead={lead} />
              </div>
            </div>
          </div>

          {/* ── RIGHT PANE: Toolbar + Comp List ── */}
          <div className="lg:w-[55%] xl:w-[58%] flex flex-col lg:overflow-y-auto" ref={compListRef}>
            {/* Sticky toolbar */}
            <div className="sticky top-0 z-10">
              <CompsToolbar
                allCompsCount={allComps.length}
                selectedCompsCount={selectedComps.length}
                compsFromReapi={compsFromReapi}
                compsFromBatchData={compsFromBatchData}
                compsSource={compsSource}
                batchDataEnabled={BATCHDATA_ENABLED}
                onSetCompsSource={setCompsSource}
                onCompareProviders={handleCompareProviders}
                sortField={sortField}
                sortDir={sortDir}
                fetchingComps={fetchingComps}
                hasAnalysis={!!analysis}
                filterMonths={analysis?.timeFrameMonths ?? 12}
                filterDistance={analysis?.maxDistance ?? 1}
                onSetFilterMonths={async (months) => {
                  if (!analysis) return;
                  try {
                    await compAnalysisAPI.applyFilters(leadId, analysis.id, { timeFrameMonths: months });
                    await refreshAnalysis();
                  } catch (err) {
                    console.error('Failed to apply age filter:', err);
                  }
                }}
                onSetFilterDistance={async (miles) => {
                  if (!analysis) return;
                  try {
                    await compAnalysisAPI.applyFilters(leadId, analysis.id, { maxDistance: miles });
                    await refreshAnalysis();
                  } catch (err) {
                    console.error('Failed to apply distance filter:', err);
                  }
                }}
                onSort={handleSort}
                onSelectAll={async (selected) => {
                  if (!analysis) return;
                  await compAnalysisAPI.selectAll(leadId, analysis.id, selected);
                  await refreshAnalysis();
                }}
                onRefreshComps={() => handleFindComps(true)}
                onAddManual={() => setShowAddComp(true)}
              />
            </div>

            {/* Comp rows */}
            <div className="flex-1 p-3 space-y-1.5">
              {comparisonMode ? (
                <ProviderComparisonView
                  comps={comparisonComps}
                  lead={lead}
                  hoveredCompId={hoveredCompId}
                  setHoveredCompId={setHoveredCompId}
                  onToggle={handleToggleComp}
                  onDelete={handleDeleteComp}
                  onClose={() => setComparisonMode(false)}
                  onUseProvider={async (provider) => {
                    setCompsSource(provider);
                    setComparisonMode(false);
                    // Persist provider choice; downstream comps stay in DB
                    // tagged by source so we can re-enter comparison anytime.
                    try {
                      await leadsAPI.update(leadId, { compsProvider: provider } as any);
                    } catch (err) {
                      console.error('Failed to persist compsProvider:', err);
                    }
                  }}
                  compIndexMap={compIndexMap}
                />
              ) : allComps.length === 0 ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  <div className="text-5xl mb-3">&#127968;</div>
                  <p className="font-medium text-lg">No comparables yet</p>
                  <p className="text-sm mt-1 mb-4">
                    Click &quot;Refresh&quot; to fetch deed-verified comparable sales
                  </p>
                  <button
                    onClick={() => handleFindComps(false)}
                    disabled={fetchingComps}
                    className="btn btn-primary"
                  >
                    {fetchingComps ? `Fetching from ${compsSource === 'batchdata' ? 'BatchData' : 'REAPI'}...` : 'Find Comps'}
                  </button>
                </div>
              ) : (
                sortedComps.map((comp) => (
                  <CompRow
                    key={comp.id}
                    ref={(el) => { compRowRefs.current[comp.id] = el; }}
                    comp={comp}
                    lead={lead}
                    compIndex={compIndexMap.get(comp.id)}
                    isHovered={hoveredCompId === comp.id}
                    onHoverEnter={() => setHoveredCompId(comp.id)}
                    onHoverLeave={() => setHoveredCompId(null)}
                    onToggle={() => handleToggleComp(comp.id)}
                    onDelete={() => handleDeleteComp(comp.id)}
                    aiDecision={aiCurationFlag ? aiDecisionMap[comp.id] : undefined}
                  />
                ))
              )}

              {/* Build 016: ARV is calculated from the strip on this same
                  Valuation tab, not from a button at the bottom of the
                  legacy comps view. */}
            </div>
          </div>
        </div>
      )}

      {/* Add Comp Modal */}
      {showAddComp && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAddComp(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Add Comparable Property</h3>
              <button onClick={() => setShowAddComp(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Address *</label>
                <input type="text" value={compForm.address}
                  onChange={(e) => setCompForm({ ...compForm, address: e.target.value })}
                  placeholder="123 Main St, City, ST" className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Sold Price *</label>
                <input type="number" value={compForm.soldPrice}
                  onChange={(e) => setCompForm({ ...compForm, soldPrice: e.target.value })}
                  placeholder="350000" className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Sold Date *</label>
                <input type="date" value={compForm.soldDate}
                  onChange={(e) => setCompForm({ ...compForm, soldDate: e.target.value })}
                  className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Distance (mi)</label>
                <input type="number" step="0.1" value={compForm.distance}
                  onChange={(e) => setCompForm({ ...compForm, distance: e.target.value })}
                  placeholder="0.5" className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Sq Ft</label>
                <input type="number" value={compForm.sqft}
                  onChange={(e) => setCompForm({ ...compForm, sqft: e.target.value })}
                  placeholder="1800" className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Beds</label>
                <input type="number" value={compForm.bedrooms}
                  onChange={(e) => setCompForm({ ...compForm, bedrooms: e.target.value })}
                  placeholder="3" className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Baths</label>
                <input type="number" step="0.5" value={compForm.bathrooms}
                  onChange={(e) => setCompForm({ ...compForm, bathrooms: e.target.value })}
                  placeholder="2" className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Year Built</label>
                <input type="number" value={compForm.yearBuilt}
                  onChange={(e) => setCompForm({ ...compForm, yearBuilt: e.target.value })}
                  placeholder="1990" className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Lot (acres)</label>
                <input type="number" step="0.01" value={compForm.lotSize}
                  onChange={(e) => setCompForm({ ...compForm, lotSize: e.target.value })}
                  placeholder="0.25" className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">DOM</label>
                <input type="number" value={compForm.daysOnMarket}
                  onChange={(e) => setCompForm({ ...compForm, daysOnMarket: e.target.value })}
                  placeholder="30" className="input text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
                <select value={compForm.propertyType}
                  onChange={(e) => setCompForm({ ...compForm, propertyType: e.target.value })}
                  className="input text-sm">
                  <option value="">-</option>
                  <option value="Single Family">Single Family</option>
                  <option value="Townhouse">Townhouse</option>
                  <option value="Condo">Condo</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-4 mt-3">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={compForm.hasPool}
                  onChange={(e) => setCompForm({ ...compForm, hasPool: e.target.checked })}
                  className="rounded border-gray-300 dark:border-gray-600" /> Pool
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={compForm.hasGarage}
                  onChange={(e) => setCompForm({ ...compForm, hasGarage: e.target.checked })}
                  className="rounded border-gray-300 dark:border-gray-600" /> Garage
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={compForm.isRenovated}
                  onChange={(e) => setCompForm({ ...compForm, isRenovated: e.target.checked })}
                  className="rounded border-gray-300 dark:border-gray-600" /> Renovated
              </label>
            </div>
            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
              <input type="text" value={compForm.notes}
                onChange={(e) => setCompForm({ ...compForm, notes: e.target.value })}
                placeholder="e.g., Comp has pool but subject does not"
                className="input text-sm w-full" />
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setShowAddComp(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={() => { handleAddComp(); setShowAddComp(false); }} className="btn btn-primary">Add Comparable</button>
            </div>
          </div>
        </div>
      )}

      <main className="px-4 sm:px-6 lg:px-8 py-6">


        {/* ═══════════════ DEAL MATH (Phase D) ═══════════════ */}
        {activeSection === 'deal-math' && (
          <DealMathPanel
            leadId={leadId}
            analysisId={analysis?.id ?? null}
            sqft={(lead as any)?.sqftOverride || lead?.sqft || null}
            arvCalculationMode={null}
            leadPhotos={(lead?.photos as any[]) || []}
          />
        )}

        {/* ═══════════════ DEAL INTEL SECTION ═══════════════ */}
        {activeSection === 'deal-intel' && (
          <div className="space-y-6">
          {/* Deal Intelligence */}
          <div className="card border border-emerald-200 dark:border-emerald-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                
                <h3 className="font-bold text-gray-900 dark:text-gray-100">Deal Intelligence</h3>
                {(analysis as any)?.dealIntelligence && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium">Generated</span>
                )}
              </div>
              <button
                onClick={handleGenerateDealIntelligence}
                disabled={generatingDealIntel || !analysis || allComps.length === 0}
                className="btn btn-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {generatingDealIntel ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                    Analyzing...
                  </span>
                ) : (analysis as any)?.dealIntelligence ? "Regenerate" : "Generate Deal Intelligence"}
              </button>
            </div>
            {(() => {
              const raw = (analysis as any)?.dealIntelligence;
              if (!raw) {
                return (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                    {allComps.length === 0
                      ? "Fetch comps and run ARV calculation first."
                      : "Generate a full investor reasoning report: market velocity, $/sqft anchoring, exit scenarios, deal math, and a ready-to-use seller pitch."}
                  </p>
                );
              }
              let parsed: any = null;
              try {
                const stripped = raw.replace(/^```[\w]*\s*/m, "").replace(/\s*```$/m, "").trim();
                const m = stripped.match(/\{[\s\S]*/);
                if (m) parsed = JSON.parse(m[0]);
              } catch {}
              if (!parsed) {
                return <p className="text-sm text-gray-500 dark:text-gray-400 italic">Could not parse deal intelligence output.</p>;
              }
              return (
                <div className="space-y-5">
                  {parsed.bottomLine && (
                    <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
                      <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide mb-1">Bottom Line</div>
                      <p className="text-sm text-emerald-900 leading-relaxed font-medium">{parsed.bottomLine}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {parsed.marketVelocity && (
                      <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">Market Velocity</div>
                          {parsed.marketVelocity.verdict && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${parsed.marketVelocity.verdict === "hot" ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" : parsed.marketVelocity.verdict === "normal" ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : parsed.marketVelocity.verdict === "slow" ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"}`}>{parsed.marketVelocity.verdict}</span>
                          )}
                        </div>
                        <p className="text-sm text-blue-900">{parsed.marketVelocity.summary}</p>
                      </div>
                    )}
                    {parsed.ppsfAnalysis && (
                      <div className="bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded-xl p-4">
                        <div className="text-xs font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wide mb-2">$/sqft Analysis</div>
                        <div className="flex gap-4 mb-2">
                          {parsed.ppsfAnalysis.avgPpsf && (
                            <div>
                              <div className="text-lg font-bold text-purple-800 dark:text-purple-400">${parsed.ppsfAnalysis.avgPpsf}/sqft</div>
                              <div className="text-xs text-purple-600">Avg from comps</div>
                            </div>
                          )}
                          {parsed.ppsfAnalysis.anchoredValue && (
                            <div>
                              <div className="text-lg font-bold text-purple-800 dark:text-purple-400">${parsed.ppsfAnalysis.anchoredValue.toLocaleString()}</div>
                              <div className="text-xs text-purple-600">Anchored value</div>
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-purple-900">{parsed.ppsfAnalysis.summary}</p>
                      </div>
                    )}
                  </div>
                  {parsed.lotValueAnalysis?.applicable && (
                    <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Lot Value</div>
                        {parsed.lotValueAnalysis.estimatedLotValue && (
                          <span className="text-sm font-bold text-amber-800 dark:text-amber-400">${parsed.lotValueAnalysis.estimatedLotValue.toLocaleString()}</span>
                        )}
                      </div>
                      <p className="text-sm text-amber-900">{parsed.lotValueAnalysis.summary}</p>
                    </div>
                  )}
                  {parsed.sellerEquity && (
                    <div className={`border rounded-xl p-4 ${parsed.sellerEquity.cashOfferViable === false ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800' : 'bg-teal-50 dark:bg-teal-950 border-teal-200 dark:border-teal-800'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`text-xs font-semibold uppercase tracking-wide ${parsed.sellerEquity.cashOfferViable === false ? 'text-red-700 dark:text-red-400' : 'text-teal-700 dark:text-teal-400'}`}>Seller Purchase History</div>
                        {parsed.sellerEquity.lastPurchasePrice && (
                          <span className={`text-sm font-bold ${parsed.sellerEquity.cashOfferViable === false ? 'text-red-800 dark:text-red-400' : 'text-teal-800 dark:text-teal-400'}`}>
                            Paid ${parsed.sellerEquity.lastPurchasePrice.toLocaleString()}
                            {parsed.sellerEquity.lastPurchaseDate && (
                              <span className="font-normal text-xs ml-1">({parsed.sellerEquity.lastPurchaseDate})</span>
                            )}
                          </span>
                        )}
                        {parsed.sellerEquity.equityPosition && parsed.sellerEquity.equityPosition !== 'unknown' && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            parsed.sellerEquity.equityPosition === 'deep' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                            parsed.sellerEquity.equityPosition === 'moderate' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                            parsed.sellerEquity.equityPosition === 'thin' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' :
                            'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          }`}>{parsed.sellerEquity.equityPosition} equity</span>
                        )}
                      </div>
                      <p className={`text-sm ${parsed.sellerEquity.cashOfferViable === false ? 'text-red-900' : 'text-teal-900'}`}>{parsed.sellerEquity.summary}</p>
                    </div>
                  )}
                  {parsed.exitScenarios?.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Exit Scenarios</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {parsed.exitScenarios.map((scenario: any, i: number) => (
                          <div key={i} className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                            <div className="font-semibold text-sm text-gray-800 dark:text-gray-200 mb-1">{scenario.name}</div>
                            <div className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-0.5">${scenario.estimatedSalePrice?.toLocaleString()}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">${scenario.saleRange?.low?.toLocaleString()} – ${scenario.saleRange?.high?.toLocaleString()}</div>
                            {scenario.estimatedRepairCost ? (
                              <div className="text-xs text-orange-600 mb-1">Repairs: ${scenario.estimatedRepairCost.toLocaleString()}</div>
                            ) : null}
                            {scenario.timeToSell && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">⏱ {scenario.timeToSell}</div>
                            )}
                            {scenario.netToSeller != null && (
                              <div className="text-xs text-green-600 mb-1">Net to seller: ${scenario.netToSeller.toLocaleString()}</div>
                            )}
                            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{scenario.notes}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {parsed.dealMath && (
                    <div className="bg-gray-900 text-white rounded-xl p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Deal Math</div>
                        {parsed.dealMath.recommendedExitStrategy && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-700 text-emerald-100 font-medium">Recommended: {parsed.dealMath.recommendedExitStrategy}</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                        {parsed.dealMath.targetArv ? (
                          <div>
                            <div className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Target ARV</div>
                            <div className="text-lg font-bold text-white">${parsed.dealMath.targetArv.toLocaleString()}</div>
                          </div>
                        ) : null}
                        {parsed.dealMath.maoAt70Percent ? (
                          <div>
                            <div className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">MAO @ 70%</div>
                            <div className="text-lg font-bold text-yellow-400">${parsed.dealMath.maoAt70Percent.toLocaleString()}</div>
                          </div>
                        ) : null}
                        {parsed.dealMath.maoAt65Percent ? (
                          <div>
                            <div className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">MAO @ 65%</div>
                            <div className="text-lg font-bold text-orange-400">${parsed.dealMath.maoAt65Percent.toLocaleString()}</div>
                          </div>
                        ) : null}
                        {parsed.dealMath.suggestedOfferRange ? (
                          <div>
                            <div className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Offer Range</div>
                            <div className="text-lg font-bold text-emerald-400">${parsed.dealMath.suggestedOfferRange.low?.toLocaleString()} – ${parsed.dealMath.suggestedOfferRange.high?.toLocaleString()}</div>
                          </div>
                        ) : null}
                      </div>
                      {/* New deal math fields */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4 pt-3 border-t border-gray-700">
                        {parsed.dealMath.netProceedsEstimate != null && (
                          <div>
                            <div className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Net Proceeds Est</div>
                            <div className="text-lg font-bold text-blue-400">${parsed.dealMath.netProceedsEstimate.toLocaleString()}</div>
                          </div>
                        )}
                        {parsed.dealMath.profitAtAskingPrice != null && (
                          <div>
                            <div className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Profit @ Asking</div>
                            <div className={`text-lg font-bold ${parsed.dealMath.profitAtAskingPrice < 0 ? 'text-red-400' : parsed.dealMath.profitAtAskingPrice <= 20000 ? 'text-yellow-400' : 'text-green-400'}`}>
                              {parsed.dealMath.profitAtAskingPrice < 0 ? '-' : ''}${Math.abs(parsed.dealMath.profitAtAskingPrice).toLocaleString()}
                            </div>
                          </div>
                        )}
                        {parsed.dealMath.profitAtSuggestedOffer != null && (
                          <div>
                            <div className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Profit @ Offer</div>
                            <div className={`text-lg font-bold ${parsed.dealMath.profitAtSuggestedOffer < 0 ? 'text-red-400' : parsed.dealMath.profitAtSuggestedOffer <= 20000 ? 'text-yellow-400' : 'text-green-400'}`}>
                              {parsed.dealMath.profitAtSuggestedOffer < 0 ? '-' : ''}${Math.abs(parsed.dealMath.profitAtSuggestedOffer).toLocaleString()}
                            </div>
                          </div>
                        )}
                      </div>
                      {parsed.dealMath.meetsMinimumProfit != null && (
                        <div className={`text-xs px-2 py-1 rounded inline-block mb-3 ${parsed.dealMath.meetsMinimumProfit ? 'bg-green-800 text-green-200' : 'bg-red-800 text-red-200'}`}>
                          {parsed.dealMath.meetsMinimumProfit ? '✓ Meets $20k minimum profit target' : '✗ Does NOT meet $20k minimum profit target'}
                        </div>
                      )}
                      {parsed.dealMath.novationListPrice != null && (
                        <div className="text-xs text-gray-400 dark:text-gray-500 mb-3">
                          Novation list price: <span className="text-indigo-400 font-bold">${parsed.dealMath.novationListPrice.toLocaleString()}</span>
                        </div>
                      )}
                      {parsed.dealMath.summary && (
                        <p className="text-sm text-gray-300 leading-relaxed">{parsed.dealMath.summary}</p>
                      )}
                    </div>
                  )}
                  {/* Offer Strategy */}
                  {parsed.offerStrategy && (
                    <div>
                      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Offer Strategy</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {parsed.offerStrategy.primaryOffer && (
                          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-xl p-5">
                            <div className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide mb-2">Primary Offer</div>
                            <div className="text-2xl font-bold text-green-800 dark:text-green-400 mb-2">${parsed.offerStrategy.primaryOffer.amount?.toLocaleString()}</div>
                            <p className="text-sm text-green-900 mb-2">{parsed.offerStrategy.primaryOffer.rationale}</p>
                            {parsed.offerStrategy.primaryOffer.contractTerms && (
                              <div className="text-xs text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 rounded px-2 py-1 inline-block">{parsed.offerStrategy.primaryOffer.contractTerms}</div>
                            )}
                          </div>
                        )}
                        {parsed.offerStrategy.fallbackOffer && (
                          <div className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wide">Fallback Offer</div>
                              {parsed.offerStrategy.fallbackOffer.strategy && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-200 text-indigo-800 dark:text-indigo-400 font-medium">{parsed.offerStrategy.fallbackOffer.strategy}</span>
                              )}
                            </div>
                            <div className="text-2xl font-bold text-indigo-800 dark:text-indigo-400 mb-2">${parsed.offerStrategy.fallbackOffer.amount?.toLocaleString()}</div>
                            <p className="text-sm text-indigo-900 mb-2">{parsed.offerStrategy.fallbackOffer.rationale}</p>
                            {parsed.offerStrategy.fallbackOffer.sellerBenefit && (
                              <div className="text-xs text-indigo-700 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/30 rounded px-2 py-1">{parsed.offerStrategy.fallbackOffer.sellerBenefit}</div>
                            )}
                          </div>
                        )}
                      </div>
                      {parsed.offerStrategy.walkAwayPrice != null && (
                        <div className="mt-3 text-center text-sm text-gray-500 dark:text-gray-400">
                          Walk-away price: <span className="font-bold text-red-600">${parsed.offerStrategy.walkAwayPrice.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {parsed.riskFactors?.length > 0 && (
                    <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl p-4">
                      <div className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide mb-3">Risk Factors</div>
                      <div className="space-y-2">
                        {parsed.riskFactors.map((rf: any, i: number) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 mt-0.5 ${rf.impact === "high" ? "bg-red-200 text-red-800 dark:text-red-400" : rf.impact === "medium" ? "bg-yellow-200 text-yellow-800 dark:text-yellow-400" : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"}`}>{rf.impact}</span>
                            <div>
                              <span className="text-sm font-medium text-red-900">{rf.factor}: </span>
                              <span className="text-sm text-red-800 dark:text-red-400">{rf.detail}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {parsed.sellerPitch && (
                    <div className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5">
                      <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wide mb-3">Seller Pitch</div>
                      {parsed.sellerPitch.framingStrategy && (
                        <p className="text-sm text-indigo-800 dark:text-indigo-400 mb-3 italic">{parsed.sellerPitch.framingStrategy}</p>
                      )}
                      {parsed.sellerPitch.suggestedScript && (
                        <div className="bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3 mb-3">
                          <div className="text-xs font-medium text-indigo-600 mb-1">Suggested Script</div>
                          <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">{parsed.sellerPitch.suggestedScript}</p>
                        </div>
                      )}
                      {parsed.sellerPitch.novationPitch && (
                        <div className="bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded-lg p-3 mb-3">
                          <div className="text-xs font-medium text-purple-600 mb-1">Novation / Listing Pitch</div>
                          <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">{parsed.sellerPitch.novationPitch}</p>
                        </div>
                      )}
                      {parsed.sellerPitch.objectionHandling && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {parsed.sellerPitch.objectionHandling.priceObjection && (
                            <div className="bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3">
                              <div className="text-xs font-medium text-indigo-600 mb-1">If they say the price is too low...</div>
                              <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{parsed.sellerPitch.objectionHandling.priceObjection}</p>
                            </div>
                          )}
                          {parsed.sellerPitch.objectionHandling.listingObjection && (
                            <div className="bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3">
                              <div className="text-xs font-medium text-indigo-600 mb-1">If they want to list with a realtor...</div>
                              <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{parsed.sellerPitch.objectionHandling.listingObjection}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          </div>
        )}



      </main>

      {/* Attribution */}
      {compsWithSource > 0 && (
        <div className="text-center text-xs text-gray-400 dark:text-gray-500 pb-4">
          Comparable data powered by REAPI
        </div>
      )}

      </div>{/* end content column */}
      </div>{/* end rail + content row */}
    </AppShell>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ProviderComparisonView({
  comps,
  lead,
  hoveredCompId,
  setHoveredCompId,
  onToggle,
  onDelete,
  onClose,
  onUseProvider,
  compIndexMap,
}: {
  comps: any[];
  lead: any;
  hoveredCompId: string | null;
  setHoveredCompId: (id: string | null) => void;
  onToggle: (compId: string) => void;
  onDelete: (compId: string) => void;
  onClose: () => void;
  onUseProvider: (provider: 'reapi' | 'batchdata') => void;
  compIndexMap: Map<string, number>;
}) {
  const reapiComps = comps.filter((c) => c.source === 'reapi');
  const batchComps = comps.filter((c) => c.source === 'batchdata');

  const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0);
  const reapiArv = avg(reapiComps.map((c) => c.soldPrice).filter(Boolean));
  const batchArv = avg(batchComps.map((c) => c.soldPrice).filter(Boolean));
  const divergencePct = reapiArv > 0 && batchArv > 0
    ? Math.round(Math.abs(reapiArv - batchArv) / reapiArv * 100)
    : null;

  // Comp overlap by (address, sold price). Address strings differ slightly
  // between providers so this is approximate; close-enough for the validation
  // signal we're after.
  const reapiKeys = new Set(reapiComps.map((c) => `${c.address?.toLowerCase().trim()}|${c.soldPrice}`));
  const batchKeys = new Set(batchComps.map((c) => `${c.address?.toLowerCase().trim()}|${c.soldPrice}`));
  const overlap = [...reapiKeys].filter((k) => batchKeys.has(k)).length;
  const reapiOnly = reapiComps.length - overlap;
  const batchOnly = batchComps.length - overlap;

  const renderColumn = (
    columnComps: any[],
    label: string,
    color: 'emerald' | 'orange',
    arv: number,
  ) => {
    const badgeClass = color === 'emerald'
      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
      : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400';
    return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badgeClass}`}>
            {label}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{columnComps.length} comps</span>
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-400">
          ARV avg: <span className="font-bold text-gray-900 dark:text-gray-100">{arv ? `$${arv.toLocaleString()}` : '—'}</span>
        </div>
      </div>
      <div className="space-y-1.5 min-h-[200px]">
        {columnComps.length === 0 ? (
          <div className="text-center py-8 text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900 rounded-lg border border-dashed border-gray-300 dark:border-gray-700">
            No comps returned by {label}
          </div>
        ) : (
          columnComps.map((comp) => (
            <CompRow
              key={comp.id}
              comp={comp}
              lead={lead}
              compIndex={compIndexMap.get(comp.id)}
              isHovered={hoveredCompId === comp.id}
              onHoverEnter={() => setHoveredCompId(comp.id)}
              onHoverLeave={() => setHoveredCompId(null)}
              onToggle={() => onToggle(comp.id)}
              onDelete={() => onDelete(comp.id)}
            />
          ))
        )}
      </div>
    </div>
    );
  };

  const exportCsv = () => {
    const escape = (v: any) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const header = ['source', 'address', 'soldPrice', 'soldDate', 'sqft', 'pricePerSqft', 'bedrooms', 'bathrooms', 'distance', 'monthsAgo', 'correlation', 'yearBuilt'].join(',');
    const rows = [...reapiComps, ...batchComps].map((c) => {
      const monthsAgo = c.soldDate ? Math.round((Date.now() - new Date(c.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000)) : '';
      const ppsf = c.sqft && c.soldPrice ? Math.round(c.soldPrice / c.sqft) : '';
      return [c.source, c.address, c.soldPrice, c.soldDate ? new Date(c.soldDate).toISOString().slice(0, 10) : '', c.sqft, ppsf, c.bedrooms, c.bathrooms, c.distance, monthsAgo, c.correlation != null ? (c.correlation * 100).toFixed(0) + '%' : '', c.yearBuilt].map(escape).join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `comp-comparison-${lead?.propertyAddress?.replace(/[^a-z0-9]+/gi, '_') ?? 'lead'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-2 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-900 dark:text-gray-100">⇆ Provider Comparison</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            REAPI vs BatchData on the same property
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Download both providers' comps as CSV"
          >
            ⤓ Export CSV
          </button>
          <button onClick={onClose} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
            ✕ Exit comparison
          </button>
        </div>
      </div>

      {/* Two providers stacked vertically — full pane width keeps addresses readable.
          (Side-by-side at typical screen widths squeezed addresses to "1..."). */}
      <div className="space-y-6">
        {renderColumn(reapiComps, 'REAPI', 'emerald', reapiArv)}
        {renderColumn(batchComps, 'BatchData', 'orange', batchArv)}
      </div>

      {/* Comparison summary */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4 space-y-3">
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
          Comparison Summary
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-gray-500 dark:text-gray-400">Comp overlap</div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-0.5">
              {overlap} in both · {reapiOnly} REAPI-only · {batchOnly} BatchData-only
            </div>
          </div>
          <div>
            <div className="text-gray-500 dark:text-gray-400">ARV divergence</div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-0.5">
              {divergencePct == null
                ? '—'
                : divergencePct < 5
                  ? `${divergencePct}% — providers agree`
                  : divergencePct < 15
                    ? `${divergencePct}% — moderate divergence`
                    : `${divergencePct}% — significant divergence`}
            </div>
            {reapiArv > 0 && batchArv > 0 && (
              <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                REAPI ${reapiArv.toLocaleString()} vs BatchData ${batchArv.toLocaleString()}
              </div>
            )}
          </div>
          <div>
            <div className="text-gray-500 dark:text-gray-400">Make canonical</div>
            <div className="flex gap-1 mt-1">
              <button
                onClick={() => onUseProvider('reapi')}
                className="text-[10px] px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium hover:bg-emerald-200 dark:hover:bg-emerald-900/50"
              >
                Use REAPI
              </button>
              <button
                onClick={() => onUseProvider('batchdata')}
                className="text-[10px] px-2 py-1 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 font-medium hover:bg-orange-200 dark:hover:bg-orange-900/50"
              >
                Use BatchData
              </button>
              <button
                onClick={onClose}
                className="text-[10px] px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-medium hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Keep current
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-0.5">{value}</div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-950 rounded-lg p-3 text-center border border-gray-200 dark:border-gray-700">
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      <div className="text-sm font-bold text-gray-800 dark:text-gray-200">{value}</div>
    </div>
  );
}

function SourceBadge({ source }: { source?: string }) {
  if (!source || source === 'manual') return <span className="text-xs text-gray-400 dark:text-gray-500">Manual</span>;
  if (source === 'reapi') return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium">REAPI</span>
  );
  if (source === 'batchdata') return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 font-medium">BatchData</span>
  );
  if (source === 'chatarv') return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 font-medium">ChatARV</span>
  );
  return <span className="text-xs text-gray-400 dark:text-gray-500">{source}</span>;
}

function CompCard({
  comp,
  lead,
  compIndex,
  isHovered,
  onHoverEnter,
  onHoverLeave,
  onToggle,
  onDelete,
}: {
  comp: Comp;
  lead: Lead;
  compIndex?: number;
  isHovered?: boolean;
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const monthsAgo = Math.round(
    (Date.now() - new Date(comp.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000)
  );
  const sizeDiff = lead.sqft && comp.sqft
    ? Math.round(((comp.sqft - lead.sqft) / lead.sqft) * 100)
    : null;
  const pricePerSqft = comp.sqft ? Math.round(comp.soldPrice / comp.sqft) : null;

  return (
    <div
      className={`rounded-lg border-2 p-4 transition-all cursor-pointer ${
        isHovered
          ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-950 shadow-md ring-2 ring-yellow-300'
          : comp.selected
          ? 'border-primary-400 bg-white dark:bg-gray-900 shadow-sm'
          : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 opacity-60'
      }`}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
    >
      {/* Top row: number badge, badges, checkbox */}
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {compIndex != null && (
            <span className="w-6 h-6 bg-gray-700 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">
              {compIndex}
            </span>
          )}
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">
            {comp.distance.toFixed(1)} mi
          </span>
          <SourceBadge source={comp.source} />
          {(comp.features as any)?.method === 'mls' && (
            <span
              className="text-xs px-2 py-0.5 rounded-full bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 font-medium"
              title={`MLS data${(comp.features as any)?.mlsNumber ? ` · #${(comp.features as any).mlsNumber}` : ''}`}
            >
              MLS
            </span>
          )}
          {(comp.features as any)?.isDistressedSale && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-medium">
              {(comp.features as any)?.saleTransType || 'Distressed'}
            </span>
          )}
          {comp.correlation && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              comp.correlation >= 0.8 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
              comp.correlation >= 0.6 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
              'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
            }`}>
              {(comp.correlation * 100).toFixed(0)}% match
            </span>
          )}
        </div>
        <input
          type="checkbox"
          checked={comp.selected}
          onChange={onToggle}
          className="h-5 w-5 rounded border-gray-300 dark:border-gray-600 text-primary-600"
        />
      </div>

      {/* Price */}
      <div className="mb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-gray-900 dark:text-gray-100">${comp.soldPrice.toLocaleString()}</span>
          {pricePerSqft && (
            <span className="text-xs text-gray-500 dark:text-gray-400">${pricePerSqft}/sqft</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">
            Sold
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {new Date(comp.soldDate).toLocaleDateString()} ({monthsAgo}mo ago)
          </span>
        </div>
        {(comp.features as any)?.avmValue && (() => {
          const avmVal = (comp.features as any).avmValue;
          const ratio = (comp.features as any).soldPriceToAvmRatio;
          return (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              AVM: ${avmVal.toLocaleString()}
              {ratio && (
                <span className={ratio < 0.9 ? ' text-red-500 dark:text-red-400' : ratio > 1.1 ? ' text-green-600 dark:text-green-400' : ''}>
                  {' '}({(ratio * 100).toFixed(0)}% of AVM)
                </span>
              )}
            </div>
          );
        })()}
        {comp.adjustedPrice && comp.adjustedPrice !== comp.soldPrice && (
          <div className="mt-2 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">Adjusted Price</span>
              <span className={`text-sm font-bold ${(comp.adjustmentAmount || 0) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600'}`}>
                ${comp.adjustedPrice.toLocaleString()}
                <span className="text-xs ml-1 font-normal">
                  ({(comp.adjustmentAmount || 0) >= 0 ? '+' : ''}{(comp.adjustmentAmount || 0).toLocaleString()})
                </span>
              </span>
            </div>
            {comp.adjustmentNotes && (
              <div className="space-y-0.5">
                {comp.adjustmentNotes.split('\n').filter((l: string) => l.trim()).map((line: string, i: number) => (
                  <div key={i} className={`text-xs flex gap-1 ${line.startsWith('AI:') ? 'text-purple-600 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                    <span className="shrink-0">{line.startsWith('AI:') ? '✨' : '•'}</span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Address */}
      <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">{comp.address}</div>

      {/* Details Grid */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <div className="text-center bg-gray-50 dark:bg-gray-950 rounded p-1.5">
          <div className="text-xs text-gray-500 dark:text-gray-400">Beds</div>
          <div className="text-sm font-semibold">{comp.bedrooms || '—'}</div>
        </div>
        <div className="text-center bg-gray-50 dark:bg-gray-950 rounded p-1.5">
          <div className="text-xs text-gray-500 dark:text-gray-400">Baths</div>
          <div className="text-sm font-semibold">{comp.bathrooms || '—'}</div>
        </div>
        <div className="text-center bg-gray-50 dark:bg-gray-950 rounded p-1.5">
          <div className="text-xs text-gray-500 dark:text-gray-400">Sq Ft</div>
          <div className="text-sm font-semibold">{comp.sqft?.toLocaleString() || '—'}</div>
        </div>
      </div>

      {/* Extra Details */}
      <div className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
        {comp.yearBuilt && <span>Built {comp.yearBuilt}</span>}
        {comp.lotSize ? <span> | {comp.lotSize} acres</span> : null}
        {comp.daysOnMarket ? <span> | {comp.daysOnMarket} DOM</span> : null}
        {(comp.features as any)?.condition ? <span> | Cond: {(comp.features as any).condition}</span> : null}
        {(comp.features as any)?.quality ? <span> | Qlty: {(comp.features as any).quality}</span> : null}
      </div>

      {/* Feature Badges */}
      {(comp.hasPool || comp.hasGarage || comp.isRenovated) && (
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {comp.hasPool && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 font-medium">Pool</span>
          )}
          {comp.hasGarage && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 font-medium">Garage</span>
          )}
          {comp.isRenovated && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">Renovated</span>
          )}
        </div>
      )}

      {/* Comparison notes */}
      {(comp.notes || sizeDiff !== null) && (
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 italic border-t pt-2">
          {sizeDiff !== null && sizeDiff !== 0 && (
            <div>{Math.abs(sizeDiff)}% {sizeDiff > 0 ? 'larger' : 'smaller'} than subject</div>
          )}
          {comp.notes && <div>{comp.notes}</div>}
        </div>
      )}

      {/* Actions */}
      <div className="mt-2 flex justify-end">
        <button
          onClick={onDelete}
          className="text-xs text-red-500 hover:text-red-700 dark:text-red-400"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

// ─── DonutStat ────────────────────────────────────────────────────────────────
function DonutStat({
  value, max, label, color, size = 56,
}: { value: number; max: number; label: string; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(value / max, 1) * circ;
  const cx = size / 2;
  const textStyle = {
    transform: `rotate(90deg)`,
    transformOrigin: `${cx}px ${cx}px`,
    fontSize: size < 52 ? 11 : 13,
    fontWeight: 700,
    fill: color,
  } as React.CSSProperties;
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#e5e7eb" strokeWidth={6} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
        <text x={cx} y={cx} textAnchor="middle" dominantBaseline="central" style={textStyle}>
          {value}
        </text>
      </svg>
      <div className="text-xs text-gray-500 dark:text-gray-400 text-center leading-tight mt-0.5">{label}</div>
    </div>
  );
}
