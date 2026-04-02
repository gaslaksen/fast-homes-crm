'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { leadsAPI, compsAPI, compAnalysisAPI, photosAPI } from '@/lib/api';
import AppNav from '@/components/AppNav';
import LeadTabNav, { COMPS_TABS, DETAIL_TABS } from '@/components/LeadTabNav';
import AnalysisTab from '@/components/AnalysisTab';
import PropertyPhoto from '@/components/PropertyPhoto';

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
  // Phase 1: Three-model valuation
  costApproachValue?: number;
  costApproachLandValue?: number;
  costApproachBuildCost?: number;
  incomeApproachValue?: number;
  marketRent?: number;
  grossRentMultiplier?: number;
  triangulatedArv?: number;
  triangulatedArvLow?: number;
  triangulatedArvHigh?: number;
  methodsUsed?: { method: string; value: number; weight: number }[];
  methodDivergence?: number;
  neighborhoodCeiling?: number;
  neighborhoodCeilingBreached?: boolean;
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

const REPAIR_ITEMS = [
  'Full gut', 'Roof', 'Kitchen', 'Bathrooms', 'Windows', 'Landscaping',
  'Exterior Painting', 'Drywall', 'Interior painting', 'Flooring', 'Driveway', 'HVAC',
];

const MAO_OPTIONS = [60, 65, 70, 75, 80, 85, 90];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CompsAnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadId = params.id as string;

  // Derive active tab from URL; redirect detail-page tabs back
  const rawTab = searchParams.get('tab') || 'comps';
  const activeSection = COMPS_TABS.includes(rawTab as any) ? rawTab : 'comps';

  useEffect(() => {
    if (rawTab && DETAIL_TABS.includes(rawTab as any)) {
      router.replace(`/leads/${leadId}?tab=${rawTab}`);
    }
  }, [rawTab, leadId, router]);

  const [lead, setLead] = useState<Lead | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchingComps, setFetchingComps] = useState(false);
  const [compsSource, setCompsSource] = useState<'auto' | 'rentcast'>('auto');
  const [sortField, setSortField] = useState<string>('distance');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [hoveredCompId, setHoveredCompId] = useState<string | null>(null);

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

  // Deal calculator state
  const [dealArv, setDealArv] = useState(0);
  const [repairCosts, setRepairCosts] = useState(0);
  const [assignmentFee, setAssignmentFee] = useState(0);
  const [maoPercent, setMaoPercent] = useState(70);
  const [dealType, setDealType] = useState<string>('wholesale');

  // Repair estimator
  const [repairLevel, setRepairLevel] = useState('flip');
  const [selectedRepairs, setSelectedRepairs] = useState<string[]>([]);
  const [repairDescription, setRepairDescription] = useState('');

  // Processing states
  const [calculating, setCalculating] = useState(false);
  const [aiAdjusting, setAiAdjusting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingDealNumbers, setSavingDealNumbers] = useState(false);
  const [dealNumbersSaved, setDealNumbersSaved] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [generatingAssessment, setGeneratingAssessment] = useState(false);
  const [generatingDealIntel, setGeneratingDealIntel] = useState(false);
  const [analyzingPhotos, setAnalyzingPhotos] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);
  const [photoThumbnails, setPhotoThumbnails] = useState<{file: File; url: string; status: 'ready'|'uploading'|'done'}[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // ATTOM enrichment
  const [attomData, setAttomData] = useState<any>(null);
  const [attomLoading, setAttomLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [leadId]);

  const loadData = async () => {
    try {
      const leadRes = await leadsAPI.get(leadId);
      setLead(leadRes.data);
      if (leadRes.data?.aiAnalysis) { try { setAiAnalysis(JSON.parse(leadRes.data.aiAnalysis)); } catch {} }

      // Load ATTOM data (non-blocking)
      compsAPI.getAttomData(leadId).then(r => setAttomData(r.data)).catch(() => {});

      // Check for existing analyses
      const analyses = await compAnalysisAPI.list(leadId);
      if (analyses.data?.length > 0) {
        // Load most recent
        const latest = analyses.data[0];
        const full = await compAnalysisAPI.get(leadId, latest.id);
        setAnalysis(full.data);
        // Lead-level saved values take priority over CompAnalysis values
        const savedArv = (leadRes.data as any).arv;
        const savedRepairs = (leadRes.data as any).repairCosts;
        const savedFee = (leadRes.data as any).assignmentFee;
        const savedMao = (leadRes.data as any).maoPercent;
        setDealArv(savedArv || full.data.arvEstimate || full.data.lead?.arv || 0);
        setRepairCosts(savedRepairs ?? full.data.repairCosts ?? 0);
        // Use lead-level fee if saved; never pull CompAnalysis default (it's always 15000)
        setAssignmentFee(savedFee ?? 0);
        // Use saved MAO% if present; otherwise default to 70 (ignore sellerMotivationMaoPercent — that's AI-inferred, not user-set)
        setMaoPercent(savedMao ?? 70);
        setRepairLevel(full.data.repairFinishLevel || 'flip');
        setSelectedRepairs(full.data.repairItems || []);
        // Set deal type from contract exitStrategy or comp analysis dealType
        const contractExitStrategy = (leadRes.data as any).contract?.exitStrategy;
        setDealType(contractExitStrategy ?? full.data.dealType ?? 'wholesale');
      } else {
        // Auto-create analysis importing existing comps
        const existingComps = await compsAPI.list(leadId);
        if (existingComps.data?.length > 0) {
          const res = await compAnalysisAPI.create(leadId, {
            importExistingComps: true,
          });
          const full = await compAnalysisAPI.get(leadId, res.data.id);
          setAnalysis(full.data);
          setDealArv((leadRes.data as any).arv || full.data.arvEstimate || leadRes.data.arv || 0);
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
    // Prefer lead-level saved ARV; only fall back to comp analysis estimate
    setDealArv((lead as any)?.arv || res.data.arvEstimate || dealArv);
  }, [analysis, leadId, dealArv, lead]);

  // ─── Find Comps (ATTOM primary, RentCast fallback) ──────────────────────────
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
        sourceFilter: forceRefresh ? (compsSource === 'rentcast' ? 'rentcast' : 'attom') : undefined,
      });
      const full = await compAnalysisAPI.get(leadId, res.data.id);
      setAnalysis(full.data);
      // Preserve any user-saved ARV; only update if the lead has no saved ARV yet
      const savedLeadArv = (leadRes.data as any).arv;
      setDealArv(savedLeadArv || full.data.arvEstimate || result.data.arv || 0);
      router.replace(`/leads/${leadId}/comps-analysis?tab=comps`, { scroll: false });
    } catch (error: any) {
      console.error('Failed to fetch comps:', error);
      alert(error.response?.data?.message || 'Failed to fetch comps');
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

  // ─── Calculate ────────────────────────────────────────────────────────────
  const handleCalculate = async () => {
    if (!analysis) return;
    setCalculating(true);
    try {
      await compAnalysisAPI.calculateAdjustments(leadId, analysis.id);
      const arvRes = await compAnalysisAPI.calculateArv(leadId, analysis.id, 'weighted');
      setDealArv(arvRes.data.arv || 0);
      await refreshAnalysis();
      router.replace(`/leads/${leadId}/comps-analysis?tab=arv`, { scroll: false });
    } catch (error) {
      console.error('Calculation failed:', error);
      alert('Calculation failed');
    } finally {
      setCalculating(false);
    }
  };

  // ─── AI Summary ───────────────────────────────────────────────────────────
  const handleAiSummary = async () => {
    if (!analysis) return;
    setGeneratingAi(true);
    try {
      await compAnalysisAPI.aiSummary(leadId, analysis.id);
      await refreshAnalysis();
    } catch (error) {
      console.error('AI summary failed:', error);
    } finally {
      setGeneratingAi(false);
    }
  };

  // ─── AI Adjust & Calculate ARV (full pipeline) ───────────────────────────
  const handleAiAdjustComps = async () => {
    if (!analysis) return;
    setAiAdjusting(true);
    try {
      // Step 1: AI adjusts comps — this also saves arvEstimate/arvLow/arvHigh from the AI recommendation
      const aiRes = await compAnalysisAPI.aiAdjustComps(leadId, analysis.id);
      // Step 2: Re-calculate supporting metrics (cost/income/triangulate/risk) WITHOUT overwriting
      // the AI's ARV — pass aiArv flag so the backend skips overwriting arvEstimate
      await compAnalysisAPI.calculateArv(leadId, analysis.id, 'weighted', true);
      const aiArv = aiRes.data?.arvRecommendation?.point;
      if (aiArv) setDealArv(aiArv);
      await refreshAnalysis();
      router.replace(`/leads/${leadId}/comps-analysis?tab=arv`, { scroll: false });
    } catch (error) {
      console.error('AI adjustment failed:', error);
      alert('AI adjustment failed — please try again');
    } finally {
      setAiAdjusting(false);
    }
  };

  // ─── AI Assessment ────────────────────────────────────────────────────────
  const handleGenerateAssessment = async () => {
    if (!analysis) return;
    setGeneratingAssessment(true);
    try {
      await compAnalysisAPI.generateAssessment(leadId, analysis.id);
      await refreshAnalysis();
    } catch (error) {
      console.error('Assessment generation failed:', error);
      alert('Failed to generate assessment');
    } finally {
      setGeneratingAssessment(false);
    }
  };

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

  // ─── Photo Analysis ───────────────────────────────────────────────────────
  const addPhotos = (files: File[]) => {
    const newFiles = files.slice(0, Math.max(0, 30 - selectedPhotos.length));
    const newThumbs = newFiles.map(f => ({
      file: f,
      url: URL.createObjectURL(f),
      status: 'ready' as const,
    }));
    setSelectedPhotos(prev => [...prev, ...newFiles]);
    setPhotoThumbnails(prev => [...prev, ...newThumbs]);
  };

  const removePhoto = (idx: number) => {
    setSelectedPhotos(prev => prev.filter((_, i) => i !== idx));
    setPhotoThumbnails(prev => {
      URL.revokeObjectURL(prev[idx]?.url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addPhotos(Array.from(e.target.files || []));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addPhotos(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
  };

  /** Compress a photo to max 1200px wide and 85% JPEG quality before sending to the API.
   *  Raw phone photos are 2–5MB each; this brings them to ~150–300KB, well within Anthropic limits. */
  const compressPhoto = (file: File): Promise<File> =>
    new Promise((resolve) => {
      const img = new window.Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX_DIM = 1200;
        const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => resolve(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file),
          'image/jpeg',
          0.85,
        );
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });

  const handleAnalyzePhotos = async () => {
    if (!analysis || selectedPhotos.length === 0) return;
    setAnalyzingPhotos(true);
    setPhotoThumbnails(prev => prev.map(t => ({ ...t, status: 'uploading' as const })));
    try {
      // Compress all photos — keeps each under ~300KB
      const compressed = await Promise.all(selectedPhotos.map(compressPhoto));

      // Backend Multer limit is now 30.
      const BACKEND_LIMIT = 30;
      const toSend = compressed.slice(0, BACKEND_LIMIT);

      const formData = new FormData();
      toSend.forEach((photo) => formData.append('photos', photo));

      // Persist originals to lead gallery in parallel
      photosAPI.uploadMultiple(leadId, selectedPhotos).catch(() => {});

      const res = await compAnalysisAPI.analyzePhotos(leadId, analysis.id, formData);
      if (res.data.repairLow) setRepairCosts(Math.round((res.data.repairLow + res.data.repairHigh) / 2));
      setPhotoThumbnails(prev => prev.map(t => ({ ...t, status: 'done' as const })));
      await refreshAnalysis();
    } catch (error: any) {
      console.error('Photo analysis failed:', error);
      const msg = error?.response?.data?.message || error?.message || 'Unknown error';
      alert(`Photo analysis failed: ${msg}\n\nTry reducing to 10–15 photos if the issue persists.`);
      setPhotoThumbnails(prev => prev.map(t => ({ ...t, status: 'ready' as const })));
    } finally {
      setAnalyzingPhotos(false);
    }
  };

  // ─── Deal Calculator ─────────────────────────────────────────────────────
  const mao = Math.round((dealArv * maoPercent / 100) - repairCosts - assignmentFee);
  const initialOffer = Math.round(mao * 0.95);
  const salePrice = Math.round(mao + assignmentFee);

  // ─── Repair Estimator ────────────────────────────────────────────────────
  const handleEstimateRepairs = async () => {
    if (!analysis) return;
    setCalculating(true);
    try {
      const res = await compAnalysisAPI.estimateRepairs(leadId, analysis.id, {
        finishLevel: repairLevel,
        description: repairDescription || undefined,
        repairItems: selectedRepairs.length > 0 ? selectedRepairs : undefined,
        sqft: lead?.sqft,
      });
      setRepairCosts(res.data.totalCost || 0);
      await refreshAnalysis();
    } catch (error) {
      console.error('Repair estimate failed:', error);
    } finally {
      setCalculating(false);
    }
  };

  const toggleRepairItem = (item: string) => {
    setSelectedRepairs((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  };

  // ─── Save to Lead ────────────────────────────────────────────────────────
  const handleSaveToLead = async () => {
    if (!analysis) return;
    setSaving(true);
    try {
      await compAnalysisAPI.saveToLead(leadId, analysis.id);
      alert('Analysis saved to lead! ARV and confidence updated.');
      router.push(`/leads/${leadId}`);
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save to lead');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDealNumbers = async () => {
    setSavingDealNumbers(true);
    setDealNumbersSaved(false);
    try {
      await leadsAPI.update(leadId, {
        arv: dealArv || undefined,
        repairCosts: repairCosts || undefined,
        assignmentFee: assignmentFee || undefined,
        maoPercent: maoPercent || undefined,
      });

      // exitStrategy lives on Contract, not Lead — save separately
      // Use dispoAPI to upsert the contract with the new exitStrategy
      try {
        const { dispoAPI } = await import('@/lib/api');
        await dispoAPI.upsertContract(leadId, { exitStrategy: dealType });
      } catch {
        // Non-fatal: contract might not exist yet; ignore
      }

      const lr = await leadsAPI.get(leadId);
      setLead(lr.data);
      setDealNumbersSaved(true);
      setTimeout(() => setDealNumbersSaved(false), 4000);
    } catch (error) {
      console.error('Failed to save deal numbers:', error);
      alert('Failed to save deal numbers');
    } finally {
      setSavingDealNumbers(false);
    }
  };

  // ─── Sorting ──────────────────────────────────────────────────────────────
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

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
  const compsFromAttom = allComps.filter(c => c.source === 'attom').length;
  const compsFromRentcast = allComps.filter(c => c.source === 'rentcast').length;
  const compsWithSource = compsFromAttom + compsFromRentcast;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AppNav />
      {/* Lead Sub-header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <PropertyPhoto
                src={lead.primaryPhoto}
                scoreBand={lead.scoreBand}
                address={lead.propertyAddress}
                size="md"
              />
              <div>
                <div className="flex items-center gap-1.5 mb-1 text-xs text-gray-400 dark:text-gray-500">
                  <Link href="/leads" className="hover:text-gray-700 dark:hover:text-gray-300">Leads</Link>
                  <span>/</span>
                  <span className="text-gray-600 dark:text-gray-400 font-medium">{lead.propertyAddress}</span>
                </div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{lead.propertyAddress}</h1>
                <p className="text-gray-600 dark:text-gray-400 text-sm">{lead.propertyCity}, {lead.propertyState} {lead.propertyZip}</p>
              </div>
            </div>
            <div className="flex items-center gap-5">
              {/* Lead score donut */}
              <DonutStat
                value={lead.totalScore ?? 0}
                max={12}
                label={({ STRIKE_ZONE: 'Strike Zone', HOT: 'Hot', WORKABLE: 'Workable', DEAD_COLD: 'Cold' } as Record<string,string>)[lead.scoreBand ?? 'DEAD_COLD'] ?? (lead.scoreBand ?? 'Cold').replace('_', ' ')}
                color={lead.scoreBand === 'HOT' ? '#ef4444' : lead.scoreBand === 'WARM' ? '#f97316' : '#6b7280'}
                size={60}
              />
              {/* AI score donut */}
              {aiAnalysis?.dealRating != null ? (
                <DonutStat
                  value={aiAnalysis.dealRating}
                  max={10}
                  label="AI Score"
                  color={aiAnalysis.dealRating >= 7 ? '#10b981' : aiAnalysis.dealRating >= 4 ? '#f59e0b' : '#ef4444'}
                  size={60}
                />
              ) : null}
              <Link href={`/leads/${leadId}/edit`} className="btn btn-primary">
                Edit Lead
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Unified Tab Nav */}
      <LeadTabNav leadId={leadId} activeTab={activeSection} />

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* ═══════════════ COMPS SECTION ═══════════════ */}
        {activeSection === 'comps' && (
          <div className="space-y-6">
            {/* Map */}
            {allComps.some(c => c.latitude && c.longitude) || (lead?.latitude && lead?.longitude) ? (
              <div className="card">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-lg font-bold">Property Locations</h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {allComps.filter(c => c.latitude && c.longitude).length} of {allComps.length} comps mapped
                  </span>
                </div>
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
            ) : null}

            {/* Subject Property Summary */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold">Subject Property</h2>
                <div className="flex items-center gap-2">
                  {attomData?.attomId && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium">
                      ✓ ATTOM Verified
                    </span>
                  )}
                  {!attomData?.attomId && (
                    <button
                      onClick={async () => {
                        setAttomLoading(true);
                        try {
                          const r = await compsAPI.attomEnrich(leadId);
                          setAttomData(r.data);
                          const lr = await leadsAPI.get(leadId);
                          setLead(lr.data);
                        } catch {}
                        setAttomLoading(false);
                      }}
                      disabled={attomLoading}
                      className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 font-medium"
                    >
                      {attomLoading ? '⏳' : '📡 Enrich with ATTOM'}
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <InfoItem label="Address" value={lead.propertyAddress} />
                <InfoItem label="Location" value={`${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}`} />
                <InfoItem label="Beds / Baths" value={`${lead.bedrooms || '?'} bd / ${lead.bathrooms || '?'} ba`} />
                <InfoItem
                  label="Sq Ft"
                  value={(lead as any).sqftOverride
                    ? `${(lead as any).sqftOverride.toLocaleString()} (override)`
                    : lead.sqft?.toLocaleString() || '—'}
                />
                <InfoItem label="Asking Price" value={lead.askingPrice ? `$${lead.askingPrice.toLocaleString()}` : '—'} />
                <InfoItem label="Condition" value={(attomData?.propertyCondition && attomData.propertyCondition !== lead.conditionLevel) ? `${lead.conditionLevel || '—'} (ATTOM: ${attomData.propertyCondition})` : (lead.conditionLevel || '—')} />
              </div>

              {/* ATTOM discrepancy warnings */}
              {attomData?.attomId && (() => {
                const warnings: string[] = [];
                if (attomData.sqft && lead.sqft && Math.abs(attomData.sqft - lead.sqft) / lead.sqft > 0.1)
                  warnings.push(`Sqft mismatch: lead shows ${lead.sqft.toLocaleString()}, ATTOM records ${attomData.sqft.toLocaleString()}`);
                if (attomData.bedrooms && lead.bedrooms && attomData.bedrooms !== lead.bedrooms)
                  warnings.push(`Bed count mismatch: lead shows ${lead.bedrooms}, ATTOM records ${attomData.bedrooms}`);
                if (attomData.bathrooms && lead.bathrooms && Math.abs(attomData.bathrooms - lead.bathrooms) >= 1)
                  warnings.push(`Bath count mismatch: lead shows ${lead.bathrooms}, ATTOM records ${attomData.bathrooms}`);
                if (warnings.length === 0) return null;
                return (
                  <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2 space-y-1">
                    {warnings.map((w, i) => (
                      <div key={i} className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        <span>⚠️</span> {w} — <span className="font-medium">verify before calculating ARV</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ATTOM building detail strip */}
              {attomData?.attomId && (attomData.yearBuilt || attomData.effectiveYearBuilt || attomData.stories || attomData.wallType || attomData.propertyQuality || attomData.subdivision) && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400 border-t dark:border-gray-700 pt-3">
                  {attomData.yearBuilt && <span>Built {attomData.yearBuilt}{attomData.effectiveYearBuilt && attomData.effectiveYearBuilt !== attomData.yearBuilt ? ` · Reno'd ${attomData.effectiveYearBuilt}` : ''}</span>}
                  {attomData.stories && <span>{attomData.stories} {attomData.stories === 1 ? 'story' : 'stories'}</span>}
                  {attomData.wallType && <span>{attomData.wallType}</span>}
                  {attomData.propertyQuality && <span>Quality: {attomData.propertyQuality}</span>}
                  {attomData.subdivision && <span>Subdivision: {attomData.subdivision}</span>}
                  {attomData.annualTaxAmount && <span>Taxes: ${Math.round(attomData.annualTaxAmount).toLocaleString()}/yr</span>}
                </div>
              )}
            </div>

            {/* Toolbar */}
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-4">
                  <h2 className="text-lg font-bold">
                    Comparable Properties
                  </h2>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {selectedComps.length} selected of {allComps.length}
                  </span>
                  {compsFromAttom > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">
                      {compsFromAttom} ATTOM verified
                    </span>
                  )}
                  {compsFromRentcast > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 font-medium">
                      {compsFromRentcast} RentCast
                    </span>
                  )}
                  {/* Select / Deselect All */}
                  {analysis && allComps.length > 0 && (
                    <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-xs">
                      <button
                        onClick={async () => {
                          await compAnalysisAPI.selectAll(leadId, analysis.id, true);
                          await refreshAnalysis();
                        }}
                        className="px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium border-r border-gray-200 dark:border-gray-700"
                      >
                        Select All
                      </button>
                      <button
                        onClick={async () => {
                          await compAnalysisAPI.selectAll(leadId, analysis.id, false);
                          await refreshAnalysis();
                        }}
                        className="px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
                      >
                        Deselect All
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {/* Source toggle */}
                  <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-xs">
                    <button
                      onClick={() => setCompsSource('auto')}
                      className={`px-3 py-1.5 font-medium transition-colors ${
                        compsSource === 'auto'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      ATTOM
                    </button>
                    <button
                      onClick={() => setCompsSource('rentcast')}
                      className={`px-3 py-1.5 font-medium transition-colors ${
                        compsSource === 'rentcast'
                          ? 'bg-purple-600 text-white'
                          : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      RentCast
                    </button>
                  </div>
                  <button
                    onClick={() => handleFindComps(true)}
                    disabled={fetchingComps}
                    className="btn btn-primary btn-sm"
                  >
                    {fetchingComps ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                        Fetching from {compsSource === 'rentcast' ? 'RentCast' : 'ATTOM'}...
                      </span>
                    ) : 'Refresh Comps'}
                  </button>
                  <button
                    onClick={() => setShowAddComp(!showAddComp)}
                    className="btn btn-secondary btn-sm"
                  >
                    {showAddComp ? 'Hide Form' : '+ Add Manual'}
                  </button>
                </div>
              </div>

              {/* Sort controls */}
              {allComps.length > 0 && (
                <div className="flex items-center gap-2 mb-4 text-xs">
                  <span className="text-gray-500 dark:text-gray-400 font-medium">Sort by:</span>
                  {[
                    { key: 'distance', label: 'Distance' },
                    { key: 'soldPrice', label: 'Price' },
                    { key: 'sqft', label: 'Sq Ft' },
                    { key: 'soldDate', label: 'Sale Date' },
                    { key: 'correlation', label: 'Correlation' },
                  ].map((s) => (
                    <button
                      key={s.key}
                      onClick={() => handleSort(s.key)}
                      className={`px-2 py-1 rounded border transition-colors ${
                        sortField === s.key
                          ? 'bg-primary-100 border-primary-300 text-primary-700 font-medium'
                          : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {s.label} {sortField === s.key && (sortDir === 'asc' ? '↑' : '↓')}
                    </button>
                  ))}
                </div>
              )}

              {/* Add Comp Form */}
              {showAddComp && (
                <div className="bg-gray-50 dark:bg-gray-950 rounded-lg p-4 mb-6 border border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Add Comparable Property</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Address *</label>
                      <input
                        type="text"
                        value={compForm.address}
                        onChange={(e) => setCompForm({ ...compForm, address: e.target.value })}
                        placeholder="123 Main St, City, ST"
                        className="input text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Sold Price *</label>
                      <input
                        type="number"
                        value={compForm.soldPrice}
                        onChange={(e) => setCompForm({ ...compForm, soldPrice: e.target.value })}
                        placeholder="350000"
                        className="input text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Sold Date *</label>
                      <input
                        type="date"
                        value={compForm.soldDate}
                        onChange={(e) => setCompForm({ ...compForm, soldDate: e.target.value })}
                        className="input text-sm"
                      />
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
                        <option value="">—</option>
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
                  <button onClick={handleAddComp} className="btn btn-primary btn-sm mt-3">
                    Add Comparable
                  </button>
                </div>
              )}

              {/* Comp Cards Grid */}
              {allComps.length === 0 ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  <div className="text-5xl mb-3">&#127968;</div>
                  <p className="font-medium text-lg">No comparables yet</p>
                  <p className="text-sm mt-1 mb-4">
                    Click &quot;Find Comps&quot; to fetch deed-verified comparable sales from ATTOM (or switch to RentCast)
                  </p>
                  <div className="flex items-center justify-center gap-3 mb-3">
                    <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-xs">
                      <button
                        onClick={() => setCompsSource('auto')}
                        className={`px-3 py-1.5 font-medium transition-colors ${
                          compsSource === 'auto'
                            ? 'bg-blue-600 text-white'
                            : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        ATTOM
                      </button>
                      <button
                        onClick={() => setCompsSource('rentcast')}
                        className={`px-3 py-1.5 font-medium transition-colors ${
                          compsSource === 'rentcast'
                            ? 'bg-purple-600 text-white'
                            : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        RentCast
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => handleFindComps(false)}
                    disabled={fetchingComps}
                    className="btn btn-primary"
                  >
                    {fetchingComps ? `Fetching from ${compsSource === 'rentcast' ? 'RentCast' : 'ATTOM'}...` : 'Find Comps'}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {sortedComps.map((comp) => (
                    <CompCard
                      key={comp.id}
                      comp={comp}
                      lead={lead}
                      compIndex={compIndexMap.get(comp.id)}
                      isHovered={hoveredCompId === comp.id}
                      onHoverEnter={() => setHoveredCompId(comp.id)}
                      onHoverLeave={() => setHoveredCompId(null)}
                      onToggle={() => handleToggleComp(comp.id)}
                      onDelete={() => handleDeleteComp(comp.id)}
                    />
                  ))}
                </div>
              )}

              {/* Calculate Button */}
              {allComps.length >= 1 && (
                <div className="mt-6 flex items-center gap-3">
                  <button
                    onClick={handleAiAdjustComps}
                    disabled={aiAdjusting || selectedComps.length === 0}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    {aiAdjusting ? (
                      <>
                        <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        Calculating ARV...
                      </>
                    ) : (
                      <>✨ AI Adjust &amp; Calculate ARV</>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════ ARV SECTION ═══════════════ */}
        {activeSection === 'arv' && (
          <div className="space-y-6">
            {/* AI Summary */}
            {analysis?.aiSummary && (
              <div className="card bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-3">
                  <div className="text-2xl">&#129302;</div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300">AI Analysis Summary</h3>
                      {analysis.confidenceScore > 0 && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          analysis.confidenceScore >= 80 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                          analysis.confidenceScore >= 60 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                          'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                        }`}>
                          {analysis.confidenceScore}% confidence
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-blue-800 dark:text-blue-400">{analysis.aiSummary}</p>
                  </div>
                </div>
              </div>
            )}

            {/* AI Property Assessment */}
            <div className="card border border-indigo-200 dark:border-indigo-800">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🧠</span>
                  <h3 className="font-bold text-gray-900 dark:text-gray-100">AI Property Assessment</h3>
                  {(analysis as any)?.aiAssessment && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium">Generated</span>
                  )}
                </div>
                <button
                  onClick={handleGenerateAssessment}
                  disabled={generatingAssessment || !analysis || allComps.length === 0}
                  className="btn btn-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {generatingAssessment ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                      Generating...
                    </span>
                  ) : (analysis as any)?.aiAssessment ? 'Regenerate' : 'Generate Assessment'}
                </button>
              </div>
              {(() => {
                const raw = (analysis as any)?.aiAssessment;
                if (!raw) {
                  return (
                    <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                      {allComps.length === 0
                        ? 'Fetch comps first, then generate a detailed wholesaler assessment.'
                        : 'Click Generate Assessment for a detailed analysis of ARV confidence, market conditions, red flags, and deal viability.'}
                    </p>
                  );
                }
                // Try to parse as structured JSON (from aiAdjustComps)
                let parsed: any = null;
                try {
                  const stripped = raw.replace(/^```[\w]*\s*/m, '').replace(/\s*```$/m, '').trim();
                  const m = stripped.match(/\{[\s\S]*/);
                  if (m) {
                    // Repair truncated JSON
                    let j = m[0];
                    let opens = 0, arrOpens = 0, inStr = false, esc = false;
                    for (const ch of j) {
                      if (esc) { esc = false; continue; }
                      if (ch === '\\') { esc = true; continue; }
                      if (ch === '"' && !inStr) { inStr = true; continue; }
                      if (ch === '"' && inStr) { inStr = false; continue; }
                      if (!inStr) {
                        if (ch === '{') opens++;
                        else if (ch === '}') opens--;
                        else if (ch === '[') arrOpens++;
                        else if (ch === ']') arrOpens--;
                      }
                    }
                    if (inStr) j += '"';
                    j += ']'.repeat(Math.max(0, arrOpens)) + '}'.repeat(Math.max(0, opens));
                    parsed = JSON.parse(j);
                  }
                } catch {}

                if (parsed) {
                  // Structured visual render
                  return (
                    <div className="space-y-4">
                      {/* Wholesaler note */}
                      {parsed.wholesalerNote && (
                        <div className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4">
                          <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wide mb-1">💡 Wholesaler Take</div>
                          <p className="text-sm text-indigo-900 dark:text-indigo-200 leading-relaxed">{parsed.wholesalerNote}</p>
                        </div>
                      )}
                      {/* Method */}
                      {parsed.method && (
                        <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-xl p-3">
                          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">📐 Valuation Method</div>
                          <p className="text-sm text-gray-700 dark:text-gray-300">{parsed.method}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Key Factors */}
                        {parsed.keyFactors?.length > 0 && (
                          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                            <div className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide mb-2">🔑 Key Factors</div>
                            <ul className="space-y-1.5">
                              {parsed.keyFactors.map((f: string, i: number) => (
                                <li key={i} className="text-sm text-blue-900 dark:text-blue-200 flex gap-2">
                                  <span className="text-blue-400 shrink-0 mt-0.5">•</span>
                                  <span>{f}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {/* Risks */}
                        {parsed.risks?.length > 0 && (
                          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl p-4">
                            <div className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide mb-2">⚠️ Risks</div>
                            <ul className="space-y-1.5">
                              {parsed.risks.map((r: string, i: number) => (
                                <li key={i} className="text-sm text-red-900 dark:text-red-200 flex gap-2">
                                  <span className="text-red-400 shrink-0 mt-0.5">•</span>
                                  <span>{r}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                // Fallback: prose text render
                return (
                  <div className="prose prose-sm max-w-none text-gray-800 dark:text-gray-200 bg-indigo-50 dark:bg-indigo-950 rounded-lg p-4 text-sm leading-relaxed">
                    {raw.split('\n').map((line: string, i: number) => {
                      if (line.startsWith('**') && line.endsWith('**')) {
                        return <p key={i} className="font-bold text-indigo-900 dark:text-indigo-200 mt-3 mb-1">{line.replace(/\*\*/g, '')}</p>;
                      }
                      return <p key={i} className={line === '' ? 'mb-2' : 'mb-0.5'}>{line}</p>;
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Quick Stats if no full analysis calculated yet */}
            {!analysis?.arvEstimate && selectedComps.length > 0 && (
              <div className="card bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800">
                <div className="flex items-center gap-3">
                  <div className="text-xl">&#9888;&#65039;</div>
                  <div>
                    <p className="text-sm font-medium text-yellow-800 dark:text-yellow-400">ARV not calculated yet</p>
                    <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">
                      Go to the Comps tab and click &quot;Calculate ARV&quot; to run adjustments and generate the ARV.
                      Quick estimate from {selectedComps.length} comps: <strong>${avgPrice.toLocaleString()}</strong> avg sale price
                      {avgPricePerSqft > 0 && <span> (${avgPricePerSqft}/sqft)</span>}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ARV Report */}
            {analysis && (
              <div className="card">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-bold">ARV Report</h2>
                  {analysis.arvMethod && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 capitalize">
                      {analysis.arvMethod === 'weighted' ? '✨ AI-weighted' : analysis.arvMethod} method
                    </span>
                  )}
                </div>

                {/* ── PRIMARY: AI Estimated ARV hero card ── */}
                {analysis.arvEstimate && (
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950 border-2 border-green-300 dark:border-green-800 rounded-2xl p-6 mb-5">
                    <div className="flex items-end justify-between flex-wrap gap-4">
                      <div>
                        <div className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide mb-1">AI Estimated ARV</div>
                        <div className="text-5xl font-bold text-green-700 dark:text-green-400">${analysis.arvEstimate.toLocaleString()}</div>
                        <div className="text-sm text-green-600 dark:text-green-400 mt-2">
                          Weighted average of {selectedComps.length} AI-adjusted comp{selectedComps.length !== 1 ? 's' : ''}
                          {analysis.arvLow && analysis.arvHigh && (
                            <span className="ml-2 text-green-500 dark:text-green-400">
                              Range: ${analysis.arvLow.toLocaleString()} – ${analysis.arvHigh.toLocaleString()}
                            </span>
                          )}
                        </div>
                        {analysis.avgAdjustment ? (
                          <div className={`text-xs mt-1 ${(analysis.avgAdjustment || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {(analysis.avgAdjustment || 0) >= 0 ? '+' : ''}${(analysis.avgAdjustment || 0).toLocaleString()} avg AI adjustment per comp
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <DonutStat
                          value={analysis.confidenceScore || 0}
                          max={100}
                          label="Confidence"
                          color={(analysis.confidenceScore || 0) >= 80 ? '#10b981' : (analysis.confidenceScore || 0) >= 60 ? '#f59e0b' : '#ef4444'}
                          size={80}
                        />
                        {analysis.confidenceTier && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            analysis.confidenceTier === 'High' ? 'bg-green-200 dark:bg-green-900/30 text-green-800 dark:text-green-400' :
                            analysis.confidenceTier === 'Medium' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400' :
                            'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          }`}>
                            {analysis.confidenceTier} Confidence
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Valuation Breakdown — three methods + triangulated ── */}
                {(() => {
                  const methodLabels: Record<string, string> = {
                    comps: 'Comparable Sales ($/sqft)',
                    cost: 'Cost Approach',
                    income: 'Income Approach',
                  };
                  const methodOrder = ['comps', 'cost', 'income'];
                  const baseWeights: Record<string, number> = { comps: 0.50, cost: 0.25, income: 0.15 };

                  const methodMap = new Map<string, { value: number; weight: number }>();
                  if (analysis.methodsUsed && Array.isArray(analysis.methodsUsed)) {
                    for (const m of analysis.methodsUsed) {
                      if (m.method !== 'attom') methodMap.set(m.method, { value: m.value, weight: m.weight });
                    }
                  }

                  if (methodMap.size === 0 && !analysis.triangulatedArv) return null;

                  const availableKeys = methodOrder.filter(k => methodMap.has(k));
                  const totalBase = availableKeys.reduce((s, k) => s + baseWeights[k], 0);
                  const renormalized: Record<string, number> = {};
                  for (const k of availableKeys) {
                    renormalized[k] = totalBase > 0 ? baseWeights[k] / totalBase : 0;
                  }

                  return (
                    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950 dark:to-indigo-950 border border-purple-200 dark:border-purple-800 rounded-2xl p-5 mb-5">
                      <h3 className="text-sm font-bold text-purple-900 dark:text-purple-200 uppercase tracking-wide mb-4">Valuation Breakdown</h3>

                      <div className="border-t border-purple-200 dark:border-purple-800">
                        <div className="grid grid-cols-12 gap-2 py-2 text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide border-b border-purple-100 dark:border-purple-800">
                          <div className="col-span-6">Method</div>
                          <div className="col-span-4 text-right">Value</div>
                          <div className="col-span-2 text-right">Weight</div>
                        </div>

                        {methodOrder.map((key) => {
                          const entry = methodMap.get(key);
                          const weight = renormalized[key];
                          return (
                            <div key={key}>
                              <div className="grid grid-cols-12 gap-2 py-2.5 border-b border-purple-50 dark:border-purple-900 items-center">
                                <div className="col-span-6 text-sm text-purple-900 dark:text-purple-200 font-medium">{methodLabels[key]}</div>
                                <div className="col-span-4 text-right text-sm font-semibold text-purple-800 dark:text-purple-400">
                                  {entry ? `$${Math.round(entry.value).toLocaleString()}` : <span className="text-purple-400 font-normal">— Not calculated</span>}
                                </div>
                                <div className="col-span-2 text-right text-xs text-purple-500 dark:text-purple-400">
                                  {entry ? `${Math.round(weight * 100)}%` : ''}
                                </div>
                              </div>
                              {key === 'comps' && entry && (
                                <div className="pb-2 border-b border-purple-50 dark:border-purple-900 pl-4 text-xs text-purple-500 dark:text-purple-400 space-y-0.5">
                                  <div>
                                    avg $/sqft: <span className="font-semibold text-purple-700 dark:text-purple-400">${analysis.pricePerSqft || '—'}</span>
                                    {' · '}median: <span className="font-semibold text-purple-700 dark:text-purple-400">${(analysis as any).medianPricePerSqft || '—'}</span>
                                    {' · '}sqft: <span className="font-semibold text-purple-700 dark:text-purple-400">
                                      {(lead as any)?.sqftOverride
                                        ? `${(lead as any).sqftOverride.toLocaleString()} (override)`
                                        : (lead?.sqft?.toLocaleString() || '—')}
                                    </span>
                                  </div>
                                </div>
                              )}
                              {key === 'income' && entry && analysis.marketRent && (
                                <div className="pb-2 border-b border-purple-50 dark:border-purple-900 pl-4 text-xs text-purple-500 dark:text-purple-400">
                                  ${(analysis.marketRent).toLocaleString()}/mo × 12 × GRM {analysis.grossRentMultiplier || 10}
                                  {(analysis as any).marketRentEstimated && (
                                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">estimated</span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Triangulated total */}
                      {analysis.triangulatedArv && (
                        <div className="mt-3 pt-3 border-t border-purple-200 dark:border-purple-800 flex items-center justify-between">
                          <div>
                            <div className="text-xs text-purple-500 dark:text-purple-400 uppercase tracking-wide mb-0.5">Weighted Total</div>
                            <div className="text-xl font-bold text-purple-700 dark:text-purple-400">${analysis.triangulatedArv.toLocaleString()}</div>
                          </div>
                          {analysis.riskAdjustedArv && analysis.riskAdjustedArv !== analysis.triangulatedArv && (
                            <div className="text-right text-xs text-purple-400">
                              <div>After risk adj</div>
                              <div className="font-semibold text-green-600 dark:text-green-400">${analysis.riskAdjustedArv.toLocaleString()}</div>
                            </div>
                          )}
                        </div>
                      )}

                      {analysis.methodDivergence != null && analysis.methodDivergence > 10 && (
                        <div className="mt-3 flex items-center gap-2 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 rounded-lg px-3 py-2 text-xs">
                          <span>⚠️</span>
                          <span>Methods diverge by {analysis.methodDivergence.toFixed(0)}% — review data before making an offer</span>
                        </div>
                      )}
                      {analysis.neighborhoodCeilingBreached && analysis.neighborhoodCeiling && (
                        <div className="mt-2 flex items-center gap-2 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950 rounded-lg px-3 py-2 text-xs">
                          <span>🚫</span>
                          <span>ARV exceeds neighborhood ceiling of ${analysis.neighborhoodCeiling.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ATTOM independent validation strip */}
                {attomData?.attomAvm && (
                  <div className="mb-5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950 px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wide">ATTOM Independent Valuation</span>
                      {attomData.attomAvmConfidence && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">{attomData.attomAvmConfidence}% confidence</span>
                      )}
                      {attomData.avmExcellentHigh && analysis?.arvEstimate && (() => {
                        const delta = Math.abs(attomData.avmExcellentHigh - analysis.arvEstimate) / analysis.arvEstimate;
                        if (delta > 0.15) return <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">⚠️ {Math.round(delta * 100)}% divergence from comps</span>;
                        if (delta <= 0.05) return <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">✓ Confirms comps ARV</span>;
                        return <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">{Math.round(delta * 100)}% difference</span>;
                      })()}
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="bg-red-50 dark:bg-red-950 rounded-lg p-2 border border-red-200 dark:border-red-800">
                        <div className="text-xs text-red-600 dark:text-red-400 font-medium mb-0.5">AS-IS / Distressed</div>
                        <div className="text-base font-bold text-red-700 dark:text-red-400">{attomData.avmPoorHigh ? `$${Math.round(attomData.avmPoorHigh).toLocaleString()}` : '—'}</div>
                      </div>
                      <div className="bg-yellow-50 dark:bg-yellow-950 rounded-lg p-2 border border-yellow-200 dark:border-yellow-800">
                        <div className="text-xs text-yellow-700 dark:text-yellow-400 font-medium mb-0.5">Good Condition</div>
                        <div className="text-base font-bold text-yellow-700 dark:text-yellow-400">{attomData.avmGoodHigh ? `$${Math.round(attomData.avmGoodHigh).toLocaleString()}` : '—'}</div>
                      </div>
                      <div className="bg-green-50 dark:bg-green-950 rounded-lg p-2 border border-green-300 dark:border-green-800 ring-1 ring-green-400">
                        <div className="text-xs text-green-700 dark:text-green-400 font-medium mb-0.5">After Repair (ARV)</div>
                        <div className="text-base font-bold text-green-700 dark:text-green-400">{attomData.avmExcellentHigh ? `$${Math.round(attomData.avmExcellentHigh).toLocaleString()}` : '—'}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Stats Grid */}
                <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
                  <StatBox label="Comps Used" value={selectedComps.length.toString()} />
                  <StatBox label="Avg Sq Ft" value={
                    selectedComps.length > 0
                      ? Math.round(selectedComps.reduce((s, c) => s + (c.sqft || 0), 0) / selectedComps.length).toLocaleString()
                      : '—'
                  } />
                  <StatBox label="Avg Distance" value={
                    selectedComps.length > 0
                      ? (selectedComps.reduce((s, c) => s + c.distance, 0) / selectedComps.length).toFixed(1) + ' mi'
                      : '—'
                  } />
                  <StatBox label="Avg DOM" value={
                    selectedComps.filter((c) => c.daysOnMarket).length > 0
                      ? Math.round(selectedComps.reduce((s, c) => s + (c.daysOnMarket || 0), 0) / selectedComps.filter((c) => c.daysOnMarket).length).toString()
                      : '—'
                  } />
                  <StatBox label="Avg $/Sqft" value={avgPricePerSqft > 0 ? `$${avgPricePerSqft}` : '—'} />
                  <StatBox label="Avg Months Ago" value={
                    selectedComps.length > 0
                      ? (selectedComps.reduce((s, c) => {
                          return s + (Date.now() - new Date(c.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000);
                        }, 0) / selectedComps.length).toFixed(1)
                      : '—'
                  } />
                </div>

                {/* Valuation Method Breakdown */}
                {(analysis.costApproachValue || analysis.incomeApproachValue) && (
                  <div className="mt-4">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Valuation Methods</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {analysis.arvEstimate && (
                        <div className="bg-blue-50 dark:bg-blue-950 rounded-xl p-3 text-center border border-blue-100 dark:border-blue-800">
                          <div className="text-xs text-blue-500 dark:text-blue-400 font-medium uppercase tracking-wide">Comps</div>
                          <div className="text-lg font-bold text-blue-700 dark:text-blue-400 mt-1">${analysis.arvEstimate.toLocaleString()}</div>
                          <div className="text-xs text-blue-400">Weight: 50%</div>
                        </div>
                      )}
                      {analysis.costApproachValue && (
                        <div className="bg-purple-50 dark:bg-purple-950 rounded-xl p-3 text-center border border-purple-100 dark:border-purple-800">
                          <div className="text-xs text-purple-500 dark:text-purple-400 font-medium uppercase tracking-wide">Cost Approach</div>
                          <div className="text-lg font-bold text-purple-700 dark:text-purple-400 mt-1">${analysis.costApproachValue.toLocaleString()}</div>
                          {analysis.costApproachLandValue && (
                            <div className="text-xs text-purple-400">Land: ${analysis.costApproachLandValue.toLocaleString()}</div>
                          )}
                        </div>
                      )}
                      {analysis.incomeApproachValue && (
                        <div className="bg-green-50 dark:bg-green-950 rounded-xl p-3 text-center border border-green-100 dark:border-green-800">
                          <div className="text-xs text-green-500 dark:text-green-400 font-medium uppercase tracking-wide">Income</div>
                          <div className="text-lg font-bold text-green-700 dark:text-green-400 mt-1">${analysis.incomeApproachValue.toLocaleString()}</div>
                          {analysis.marketRent && (
                            <div className="text-xs text-green-400">${analysis.marketRent.toLocaleString()}/mo × {analysis.grossRentMultiplier} GRM</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Adjustments Detail */}
            {analysis && selectedComps.length > 0 && (
              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-bold">Adjustments</h2>
                  <div className="flex items-center gap-3">
                    {/* Exclude distressed comps toggle */}
                    {allComps.some(c => (c.features as any)?.isDistressedSale) && (
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={(analysis.adjustmentConfig as any)?.excludeDistressedComps || false}
                          onChange={async (e) => {
                            const exclude = e.target.checked;
                            try {
                              const currentConfig = (analysis.adjustmentConfig || {}) as Record<string, any>;
                              await compAnalysisAPI.update(leadId, analysis.id, {
                                adjustmentConfig: { ...currentConfig, excludeDistressedComps: exclude },
                              });
                              await compAnalysisAPI.calculateArv(leadId, analysis.id, 'weighted');
                              await refreshAnalysis();
                            } catch (err) {
                              console.error('Failed to toggle distress exclusion:', err);
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-red-600"
                        />
                        <span className="text-xs text-red-600 dark:text-red-400 font-medium">Exclude distressed</span>
                      </label>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      analysis.adjustmentsEnabled ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                    }`}>
                      {analysis.adjustmentsEnabled ? 'Applied' : 'Not applied'}
                    </span>
                  </div>
                </div>
                <div className="space-y-3">
                  {selectedComps.map((comp) => (
                    <div key={comp.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-950 rounded-lg">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{comp.address}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {comp.adjustmentNotes?.split('\n').join(' | ') || 'No adjustments'}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">Original</div>
                          <div className="text-sm font-medium">${comp.soldPrice.toLocaleString()}</div>
                        </div>
                        <div className="text-lg text-gray-400 dark:text-gray-500">&rarr;</div>
                        <div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">Adjusted</div>
                          <div className="text-sm font-bold">
                            ${(comp.adjustedPrice || comp.soldPrice).toLocaleString()}
                          </div>
                        </div>
                        <div className={`text-sm font-medium min-w-[80px] text-right ${
                          (comp.adjustmentAmount || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {(comp.adjustmentAmount || 0) >= 0 ? '+' : ''}${(comp.adjustmentAmount || 0).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                  {selectedComps.length > 0 && (
                    <div className="flex justify-end p-3 bg-primary-50 rounded-lg border border-primary-200">
                      <div className="text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Average Adjustment: </span>
                        <span className={`font-bold ${
                          (analysis.avgAdjustment || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {(analysis.avgAdjustment || 0) >= 0 ? '+' : ''}${(analysis.avgAdjustment || 0).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Comparable Properties Table */}
            {selectedComps.length > 0 && (
              <div className="card overflow-x-auto">
                <h2 className="text-lg font-bold mb-4">Comparable Properties Table</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 pr-3 font-medium text-gray-600 dark:text-gray-400">Address</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600 dark:text-gray-400">Source</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600 dark:text-gray-400">Sale Type</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600 dark:text-gray-400">Sale Price</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600 dark:text-gray-400">Adj. Price</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600 dark:text-gray-400">Sale Date</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600 dark:text-gray-400">Sq Ft</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600 dark:text-gray-400">$/SqFt</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600 dark:text-gray-400">Beds</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600 dark:text-gray-400">Baths</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600 dark:text-gray-400">Year</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600 dark:text-gray-400">Dist</th>
                      <th className="pb-2 font-medium text-gray-600 dark:text-gray-400">Corr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedComps.map((comp) => (
                      <tr key={comp.id} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-2 pr-3 font-medium max-w-[200px] truncate">{comp.address}</td>
                        <td className="py-2 pr-3">
                          <SourceBadge source={comp.source} />
                        </td>
                        <td className="py-2 pr-3">
                          {(comp.features as any)?.isDistressedSale ? (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-medium">
                              {(comp.features as any)?.saleTransType || 'Distressed'}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-500">Arms-length</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">${comp.soldPrice.toLocaleString()}</td>
                        <td className="py-2 pr-3 font-medium">${(comp.adjustedPrice || comp.soldPrice).toLocaleString()}</td>
                        <td className="py-2 pr-3">{new Date(comp.soldDate).toLocaleDateString()}</td>
                        <td className="py-2 pr-3">{comp.sqft?.toLocaleString() || '—'}</td>
                        <td className="py-2 pr-3">{comp.sqft ? `$${Math.round((comp.adjustedPrice || comp.soldPrice) / comp.sqft)}` : '—'}</td>
                        <td className="py-2 pr-3">{comp.bedrooms || '—'}</td>
                        <td className="py-2 pr-3">{comp.bathrooms || '—'}</td>
                        <td className="py-2 pr-3">{comp.yearBuilt || '—'}</td>
                        <td className="py-2 pr-3">{comp.distance.toFixed(1)} mi</td>
                        <td className="py-2">
                          {comp.correlation ? `${(comp.correlation * 100).toFixed(0)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Save Button */}
            <div className="flex gap-3">
              <button
                onClick={handleSaveToLead}
                disabled={saving || (!analysis?.arvEstimate && !lead.arv)}
                className="btn btn-primary"
              >
                {saving ? 'Saving...' : 'Save ARV to Lead'}
              </button>

            </div>
          </div>
        )}

        {/* ═══════════════ DEAL ANALYSIS SECTION ═══════════════ */}
        {activeSection === 'deal-analysis' && (
          <>
          <div className="space-y-6">
            <div className="card">
              <div className="flex items-center gap-3 mb-6">
                <h2 className="text-lg font-bold">Deal Analysis</h2>
                <select
                  value={dealType}
                  onChange={(e) => setDealType(e.target.value)}
                  className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 dark:bg-gray-800 dark:text-gray-200"
                >
                  <option value="wholesale">Wholesale</option>
                  <option value="novation">Novation</option>
                  <option value="flip">Fix &amp; Flip</option>
                  <option value="wholetail">Wholetail</option>
                  <option value="subject_to">Subject-To</option>
                  <option value="creative">Creative Finance</option>
                  <option value="joint_venture">Joint Venture</option>
                  <option value="concierge_listing">Concierge Listing</option>
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Inputs */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">After Repair Value (ARV)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">$</span>
                      <input
                        type="number"
                        value={dealArv || ''}
                        onChange={(e) => setDealArv(parseFloat(e.target.value) || 0)}
                        className="input pl-7"
                      />
                    </div>
                    {analysis?.arvEstimate && dealArv !== analysis.arvEstimate && (
                      <button
                        onClick={() => setDealArv(analysis.arvEstimate || 0)}
                        className="text-xs text-primary-600 mt-1 hover:underline"
                      >
                        Reset to calculated ARV (${analysis.arvEstimate.toLocaleString()})
                      </button>
                    )}
                    {!analysis?.arvEstimate && lead.arv && dealArv !== lead.arv && (
                      <button
                        onClick={() => setDealArv(lead.arv || 0)}
                        className="text-xs text-primary-600 mt-1 hover:underline"
                      >
                        Use lead ARV (${lead.arv.toLocaleString()})
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Estimated Repair Costs</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">$</span>
                      <input
                        type="number"
                        value={repairCosts || ''}
                        onChange={(e) => setRepairCosts(parseFloat(e.target.value) || 0)}
                        className="input pl-7"
                      />
                    </div>
                    <div className="flex gap-2 mt-2">
                      {[
                        { label: '$20/sqft', rate: 20 },
                        { label: '$30/sqft', rate: 30 },
                        { label: '$45/sqft', rate: 45 },
                      ].map((opt) => (
                        <button
                          key={opt.rate}
                          onClick={() => setRepairCosts((lead?.sqft || 1500) * opt.rate)}
                          className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {(analysis?.repairCostLow != null || analysis?.repairCostHigh != null) && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        Range: ${(analysis?.repairCostLow || 0).toLocaleString()} – ${(analysis?.repairCostHigh || 0).toLocaleString()}
                      </div>
                    )}
                  </div>

                  {/* Assignment Fee — only for wholesale / joint_venture */}
                  {(dealType === 'wholesale' || dealType === 'joint_venture') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {dealType === 'joint_venture' ? 'JV Assignment Fee' : 'Wholesale Assignment Fee'}
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">$</span>
                        <input
                          type="number"
                          value={assignmentFee || ''}
                          onChange={(e) => setAssignmentFee(parseFloat(e.target.value) || 0)}
                          className="input pl-7"
                        />
                      </div>
                    </div>
                  )}

                  {/* MAO % — only for wholesale / joint_venture */}
                  {(dealType === 'wholesale' || dealType === 'joint_venture') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Maximum Allowable Offer %
                        {selectedComps.length > 0 && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 font-medium">
                            Suggested: {avgPricePerSqft > 100 ? '70' : '65'}%
                          </span>
                        )}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {MAO_OPTIONS.map((pct) => (
                          <button
                            key={pct}
                            onClick={() => setMaoPercent(pct)}
                            className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                              maoPercent === pct
                                ? 'bg-primary-600 text-white border-primary-600'
                                : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                            }`}
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Results — right column */}
                <div className="space-y-4">
                  {/* Initial Offer to Seller — always shown */}
                  <div className="bg-gray-50 dark:bg-gray-950 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Initial Offer to Seller</div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {dealArv > 0 ? `$${Math.max(initialOffer, 0).toLocaleString()}` : '$—'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">5% under max allowable offer</div>
                  </div>

                  {/* MAO — only for wholesale / joint_venture */}
                  {(dealType === 'wholesale' || dealType === 'joint_venture') && (
                    <div className="bg-primary-50 rounded-lg p-4 border border-primary-200">
                      <div className="text-xs text-primary-700 mb-1">Maximum Allowable Offer</div>
                      <div className="text-2xl font-bold text-primary-800">
                        {dealArv > 0 ? `$${Math.max(mao, 0).toLocaleString()}` : '$—'}
                      </div>
                      <div className="text-xs text-primary-600 mt-1">
                        {maoPercent}% of ARV minus repairs &amp; fee
                      </div>
                    </div>
                  )}

                  {/* Sale Price / Projected Profit card — changes by deal type */}
                  {(dealType === 'wholesale' || dealType === 'joint_venture') ? (
                    <div className="bg-green-50 dark:bg-green-950 rounded-lg p-4 border border-green-200 dark:border-green-800">
                      <div className="text-xs text-green-700 dark:text-green-400 mb-1">Your Sale Price to Buyer</div>
                      <div className="text-2xl font-bold text-green-800 dark:text-green-400">
                        {dealArv > 0 ? `$${Math.max(salePrice, 0).toLocaleString()}` : '$—'}
                      </div>
                      <div className="text-xs text-green-600 mt-1">
                        MAO + assignment fee
                      </div>
                    </div>
                  ) : (
                    <div className="bg-green-50 dark:bg-green-950 rounded-lg p-4 border border-green-200 dark:border-green-800">
                      <div className="text-xs text-green-700 dark:text-green-400 mb-1">Estimated Net Profit</div>
                      <div className="text-2xl font-bold text-green-800 dark:text-green-400">
                        {dealArv > 0
                          ? `$${Math.max(Math.round(dealArv - repairCosts - dealArv * 0.10), 0).toLocaleString()}`
                          : '$—'}
                      </div>
                      <div className="text-xs text-green-600 mt-1">
                        ARV − repairs − ~10% transaction costs (estimate)
                      </div>
                    </div>
                  )}

                  {dealArv > 0 && (dealType === 'wholesale' || dealType === 'joint_venture') && (
                    <div className="bg-yellow-50 dark:bg-yellow-950 rounded-lg p-3 border border-yellow-200 dark:border-yellow-800">
                      <div className="text-xs text-yellow-800 dark:text-yellow-400">
                        <strong>Spread:</strong> ${assignmentFee.toLocaleString()} assignment fee
                        {lead?.askingPrice && mao > 0 ? (
                          <span> | Asking is {((lead.askingPrice / dealArv) * 100).toFixed(0)}% of ARV
                            {lead.askingPrice <= mao ? (
                              <span className="text-green-700 dark:text-green-400 font-medium"> — Below MAO!</span>
                            ) : (
                              <span className="text-red-700 dark:text-red-400 font-medium"> — Above MAO by ${(lead.askingPrice - mao).toLocaleString()}</span>
                            )}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {/* Negotiation Range */}
                  {(analysis?.negotiationRangeLow || analysis?.negotiationRangeHigh) && (
                    <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400 font-medium">Negotiation Range</span>
                        <span className="font-bold text-blue-700 dark:text-blue-400">
                          ${(analysis.negotiationRangeLow || 0).toLocaleString()} – ${(analysis.negotiationRangeHigh || 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">90% to 102% of MAO — your offer window</div>
                    </div>
                  )}

                  {/* Seller Motivation Tier */}
                  {analysis?.sellerMotivationTier && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Seller Motivation</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        analysis.sellerMotivationTier === 'foreclosure' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                        analysis.sellerMotivationTier === 'severe_distress' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' :
                        analysis.sellerMotivationTier === 'distressed' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                        analysis.sellerMotivationTier === 'minor_distress' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                        'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                      }`}>
                        {analysis.sellerMotivationTier.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </span>
                    </div>
                  )}
                </div>

                {/* Save Deal Numbers — full width below both columns */}
                <div className="md:col-span-2 flex items-center gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <button
                    onClick={handleSaveDealNumbers}
                    disabled={savingDealNumbers}
                    className="btn btn-primary btn-sm"
                  >
                    {savingDealNumbers ? 'Saving...' : 'Save Deal Numbers'}
                  </button>
                  {dealNumbersSaved ? (
                    <span className="text-sm text-green-600 font-medium">✓ Saved — reflected on overview &amp; disposition pages</span>
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500">Save to persist these numbers to the lead, overview, and disposition page</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* AI Insights (merged from lead detail) */}
          <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-6">
            <h2 className="text-lg font-bold mb-4">AI Insights</h2>
            <AnalysisTab
              leadId={leadId}
              lead={lead}
              aiAnalysis={aiAnalysis}
              setAiAnalysis={setAiAnalysis}
              analysisLoading={analysisLoading}
              setAnalysisLoading={setAnalysisLoading}
              onLeadRefresh={async () => {
                const lr = await leadsAPI.get(leadId);
                setLead(lr.data);
              }}
            />
          </div>

          <div className="mt-6 text-center">
            <Link href={`/leads/${leadId}/comps-analysis?tab=deal-intel`} className="btn btn-primary">View Deal Intelligence</Link>
          </div>
          </>
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

        {/* ═══════════════ REPAIRS SECTION ═══════════════ */}
        {activeSection === 'repairs' && (
          <div className="space-y-6">

            {/* ── Photo Upload & AI Analysis ── */}
            <div className="card border border-purple-200 dark:border-purple-800">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xl">📸</span>
                <h2 className="text-lg font-bold">Photo Analysis</h2>
                {(analysis as any)?.photoAnalysis && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 font-medium">Analyzed</span>
                )}
              </div>

              {/* Drop Zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer mb-4 ${
                  isDragging ? 'border-purple-500 bg-purple-100 dark:bg-purple-900/30' : 'border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950 hover:bg-purple-100 dark:bg-purple-900/30'
                }`}
                onClick={() => document.getElementById('photo-upload-input')?.click()}
              >
                <input
                  id="photo-upload-input"
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/*"
                  onChange={handlePhotoChange}
                />
                {isDragging ? (
                  <div className="text-purple-600 font-medium">Drop photos here!</div>
                ) : (
                  <>
                    <div className="text-3xl mb-2">📷</div>
                    <p className="text-sm font-medium text-purple-700 dark:text-purple-400">Drag & drop photos here, or click to select</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {selectedPhotos.length > 0
                        ? `${selectedPhotos.length}/30 photos added`
                        : 'Up to 30 photos — JPG, PNG, HEIC'}
                    </p>
                  </>
                )}
              </div>

              {/* Thumbnails */}
              {photoThumbnails.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {photoThumbnails.map((t, i) => (
                    <div key={i} className="relative group">
                      <img
                        src={t.url}
                        alt={`Photo ${i + 1}`}
                        className={`w-16 h-16 object-cover rounded-lg border-2 transition-all ${
                          t.status === 'done' ? 'border-green-400 opacity-90' :
                          t.status === 'uploading' ? 'border-purple-400 opacity-60' :
                          'border-gray-300 dark:border-gray-600'
                        }`}
                      />
                      {t.status === 'uploading' && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30">
                          <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        </div>
                      )}
                      {t.status === 'done' && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-green-50 dark:bg-green-9500/20">
                          <span className="text-green-600 text-lg">✓</span>
                        </div>
                      )}
                      {t.status === 'ready' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); removePhoto(i); }}
                          className="absolute -top-1 -right-1 w-4 h-4 bg-red-50 dark:bg-red-9500 rounded-full text-white text-xs items-center justify-center hidden group-hover:flex"
                        >×</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleAnalyzePhotos}
                disabled={analyzingPhotos || selectedPhotos.length === 0 || !analysis}
                className="btn btn-primary w-full mb-6"
              >
                {analyzingPhotos ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    Analyzing {Math.min(selectedPhotos.length, 30)} photo{Math.min(selectedPhotos.length, 30) !== 1 ? 's' : ''} with AI...
                  </span>
                ) : selectedPhotos.length > 30 ? (
                  `Analyze Top 30 of ${selectedPhotos.length} Photos with AI`
                ) : (
                  `Analyze ${selectedPhotos.length > 0 ? selectedPhotos.length + ' Photo' + (selectedPhotos.length !== 1 ? 's' : '') : 'Photos'} with AI`
                )}
              </button>

              {/* ── AI Analysis Results (visual) ── */}
              {(() => {
                let parsed: any = null;
                try {
                  const raw = (analysis as any)?.photoAnalysis;
                  if (raw) {
                    // Strip markdown code fences if present
                    const stripped = raw.replace(/^```[\w]*\s*/m, '').replace(/\s*```$/m, '').trim();
                    const jsonMatch = stripped.match(/\{[\s\S]*/);
                    if (jsonMatch) {
                      let jsonStr = jsonMatch[0];
                      // Repair truncated JSON: track string state to properly close
                      let opens = 0, arrOpens = 0, inStr = false, esc = false;
                      for (const ch of jsonStr) {
                        if (esc) { esc = false; continue; }
                        if (ch === '\\') { esc = true; continue; }
                        if (ch === '"' && !inStr) { inStr = true; continue; }
                        if (ch === '"' && inStr) { inStr = false; continue; }
                        if (!inStr) {
                          if (ch === '{') opens++;
                          else if (ch === '}') opens--;
                          else if (ch === '[') arrOpens++;
                          else if (ch === ']') arrOpens--;
                        }
                      }
                      if (inStr) jsonStr += '"'; // close open string
                      jsonStr += ']'.repeat(Math.max(0, arrOpens)) + '}'.repeat(Math.max(0, opens));
                      parsed = JSON.parse(jsonStr);
                    }
                  }
                } catch {}

                if (!parsed && !(analysis as any)?.photoAnalysis) {
                  return (
                    <div className="flex items-center justify-center min-h-24 bg-gray-50 dark:bg-gray-950 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
                      <p className="text-sm text-gray-400 dark:text-gray-500 text-center px-4">
                        Upload photos and click Analyze to get a visual condition report and repair estimate
                      </p>
                    </div>
                  );
                }

                if (!parsed) {
                  // Legacy text fallback
                  return (
                    <div className="bg-purple-50 dark:bg-purple-950 rounded-lg p-4 border border-purple-100 max-h-72 overflow-y-auto text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                      {(analysis as any).photoAnalysis}
                    </div>
                  );
                }

                const conditionColor = (c: string) =>
                  c === 'Good' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                  c === 'Fair' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400' :
                  c === 'Poor' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' :
                  c === 'Gut'  ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                  'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';

                const urgencyIcon = (u: string) =>
                  u === 'critical' ? '🚨' : u === 'high' ? '⚠️' : u === 'medium' ? '🔶' : '✅';

                const systemIcon = (s: string) =>
                  ({ roof: '🏠', hvac: '❄️', electrical: '⚡', plumbing: '🚰', foundation: '🪨' })[s] || '🔧';

                return (
                  <div className="space-y-5">
                    {/* Overall summary bar */}
                    <div className="flex items-center gap-4 bg-gray-50 dark:bg-gray-950 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Overall Condition</div>
                        <span className={`inline-block text-sm font-bold px-3 py-1 rounded-full ${conditionColor(parsed.overallCondition || 'Fair')}`}>
                          {parsed.overallCondition || 'Fair'}
                        </span>
                      </div>
                      {(parsed.repairLow || parsed.repairHigh) ? (
                        <div className="text-right">
                          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Photo Repair Estimate</div>
                          <div className="text-xl font-bold text-purple-700 dark:text-purple-400">
                            ${(parsed.repairLow || 0).toLocaleString()} – ${(parsed.repairHigh || 0).toLocaleString()}
                          </div>
                          <button
                            onClick={() => { setRepairCosts(Math.round(((parsed.repairLow || 0) + (parsed.repairHigh || 0)) / 2)); }}
                            className="text-xs text-purple-600 hover:underline mt-0.5 block"
                          >
                            Apply midpoint (${Math.round(((parsed.repairLow||0) + (parsed.repairHigh||0)) / 2).toLocaleString()}) →
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {/* Wholesaler notes */}
                    {parsed.wholesalerNotes && (
                      <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm text-blue-800 dark:text-blue-400">
                        <div className="font-semibold text-blue-900 mb-1">💡 Wholesaler Take</div>
                        {parsed.wholesalerNotes}
                      </div>
                    )}

                    {/* Red flags */}
                    {parsed.redFlags?.length > 0 && (
                      <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl p-4">
                        <div className="font-semibold text-red-800 dark:text-red-400 mb-2">🚨 Red Flags</div>
                        <ul className="space-y-1">
                          {parsed.redFlags.map((flag: string, i: number) => (
                            <li key={i} className="text-sm text-red-700 dark:text-red-400 flex gap-2">
                              <span>•</span><span>{flag}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Rooms grid */}
                    {parsed.rooms?.length > 0 && (
                      <div>
                        <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Room-by-Room</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {parsed.rooms.map((room: any, i: number) => (
                            <div key={i} className={`rounded-xl border p-3 ${
                              room.condition === 'Gut' ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950' :
                              room.condition === 'Poor' ? 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950' :
                              room.condition === 'Fair' ? 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950' :
                              'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950'
                            }`}>
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">{urgencyIcon(room.urgency)} {room.name}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${conditionColor(room.condition)}`}>
                                  {room.condition}
                                </span>
                              </div>
                              {room.issues?.length > 0 && (
                                <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                                  {room.issues.map((issue: string, j: number) => (
                                    <li key={j} className="flex gap-1.5"><span className="text-orange-400 mt-0.5">•</span>{issue}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Systems */}
                    {parsed.systems && (
                      <div>
                        <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Systems</div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                          {Object.entries(parsed.systems).map(([key, sys]: [string, any]) => (
                            <div key={key} className={`rounded-xl border p-3 text-center ${
                              sys.condition === 'Poor' ? 'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950' :
                              sys.condition === 'Good' ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950' :
                              'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950'
                            }`}>
                              <div className="text-2xl mb-1">{systemIcon(key)}</div>
                              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 capitalize">{key}</div>
                              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${conditionColor(sys.condition || 'Unknown')}`}>
                                {sys.condition || 'Unknown'}
                              </span>
                              {sys.notes && <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-left leading-tight">{sys.notes}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Repair Items */}
                    {parsed.repairItems?.length > 0 && (
                      <div>
                        <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Repair Breakdown</div>
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-950 text-xs text-gray-500 dark:text-gray-400 uppercase">
                              <tr>
                                <th className="text-left px-4 py-2">Item</th>
                                <th className="text-center px-3 py-2">Priority</th>
                                <th className="text-right px-4 py-2">Range</th>
                              </tr>
                            </thead>
                            <tbody>
                              {parsed.repairItems.map((item: any, i: number) => (
                                <tr key={i} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                                  <td className="px-4 py-2 text-gray-800 dark:text-gray-200">{item.item}</td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                                      item.priority === 'critical' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                                      item.priority === 'high' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' :
                                      item.priority === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                                      'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                                    }`}>{item.priority}</span>
                                  </td>
                                  <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">
                                    ${(item.estimateLow||0).toLocaleString()} – ${(item.estimateHigh||0).toLocaleString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="bg-gray-50 dark:bg-gray-950 font-bold">
                              <tr className="border-t border-gray-200 dark:border-gray-700">
                                <td className="px-4 py-2 text-gray-800 dark:text-gray-200" colSpan={2}>Total Estimate</td>
                                <td className="px-4 py-2 text-right text-purple-700 dark:text-purple-400">
                                  ${(parsed.repairLow||0).toLocaleString()} – ${(parsed.repairHigh||0).toLocaleString()}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* ── Repair Cost Estimator ── */}
            <div className="card">
              <h2 className="text-lg font-bold mb-4">Repair Cost Estimator</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Finish Level</label>
                    <select
                      value={repairLevel}
                      onChange={(e) => setRepairLevel(e.target.value)}
                      className="input"
                    >
                      <option value="budget">Budget Grade</option>
                      <option value="flip">Flip Grade</option>
                      <option value="high-end">High-End Grade</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Quick Repair Options</label>
                    <div className="flex flex-wrap gap-2">
                      {REPAIR_ITEMS.map((item) => (
                        <button
                          key={item}
                          onClick={() => toggleRepairItem(item)}
                          className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                            selectedRepairs.includes(item)
                              ? 'bg-primary-600 text-white border-primary-600'
                              : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                          }`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Describe Repairs Needed</label>
                    <textarea
                      value={repairDescription}
                      onChange={(e) => setRepairDescription(e.target.value)}
                      placeholder={`Describe what repairs are needed at ${lead?.propertyAddress || 'this property'} and AI will estimate costs...`}
                      className="input w-full"
                      rows={4}
                    />
                  </div>

                  <button
                    onClick={handleEstimateRepairs}
                    disabled={calculating}
                    className="btn btn-primary"
                  >
                    {calculating ? 'Estimating...' : 'Estimate Repair Costs'}
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Cost card */}
                  <div className={`rounded-xl border-2 p-6 text-center transition-all ${
                    repairCosts > 0 ? 'border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950'
                  }`}>
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Estimated Repair Costs</div>
                    <div className={`text-4xl font-bold mb-1 ${repairCosts > 0 ? 'text-orange-700 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}`}>
                      ${repairCosts.toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {repairLevel.charAt(0).toUpperCase() + repairLevel.slice(1)} grade
                      {lead?.sqft && repairCosts > 0 ? ` · $${Math.round(repairCosts / lead.sqft)}/sqft` : ''}
                    </div>
                    {repairCosts > 0 && (
                      <div className="mt-3 text-xs text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 rounded-lg px-3 py-2">
                        ✓ Applied to deal calculator · ARV needed to break even: ${dealArv > 0 ? Math.round((repairCosts + assignmentFee) / (maoPercent / 100)).toLocaleString() : '—'}
                      </div>
                    )}
                  </div>

                  {analysis?.repairNotes && (
                    <div className="bg-blue-50 dark:bg-blue-950 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                      <div className="text-xs font-medium text-blue-800 dark:text-blue-400 mb-1">AI Breakdown</div>
                      <div className="text-sm text-blue-700 dark:text-blue-400">{analysis.repairNotes}</div>
                    </div>
                  )}

                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-medium">Quick estimate by condition:</div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Light', sublabel: '$20/sqft', rate: 20, color: 'border-green-300 dark:border-green-800 hover:bg-green-50 dark:bg-green-950' },
                        { label: 'Moderate', sublabel: '$30/sqft', rate: 30, color: 'border-yellow-300 dark:border-yellow-800 hover:bg-yellow-50 dark:bg-yellow-950' },
                        { label: 'Heavy', sublabel: '$45/sqft', rate: 45, color: 'border-red-300 dark:border-red-800 hover:bg-red-50 dark:bg-red-950' },
                      ].map((opt) => (
                        <button
                          key={opt.rate}
                          onClick={() => setRepairCosts((lead?.sqft || 1500) * opt.rate)}
                          className={`text-xs px-2 py-2 rounded-lg border text-center transition-colors bg-white dark:bg-gray-900 ${opt.color}`}
                        >
                          <div className="font-semibold text-gray-700 dark:text-gray-300">{opt.label}</div>
                          <div className="text-gray-400 dark:text-gray-500">{opt.sublabel}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════ PROPERTY INTEL (ATTOM) — kept for reference, not shown as tab ═══════════════ */}
        {false && activeSection === 'property-intel' && (
          <div className="space-y-6">

            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">🏠 Property Intelligence</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Deep property data & valuation ranges from ATTOM — the industry standard for real estate data.
                </p>
              </div>
              <button
                onClick={async () => {
                  setAttomLoading(true);
                  try {
                    const r = await compsAPI.attomEnrich(leadId, true);
                    setAttomData(r.data);
                    // Reload lead to pick up newly filled fields
                    const lr = await leadsAPI.get(leadId);
                    setLead(lr.data);
                  } catch {}
                  setAttomLoading(false);
                }}
                disabled={attomLoading}
                className="btn btn-secondary btn-sm"
              >
                {attomLoading ? '⏳ Fetching…' : '🔄 Refresh ATTOM Data'}
              </button>
            </div>

            {!attomData?.attomId ? (
              <div className="card border-dashed border-2 border-gray-200 dark:border-gray-700 text-center py-12">
                <div className="text-4xl mb-3">🏘️</div>
                <div className="text-gray-600 dark:text-gray-400 font-medium">No ATTOM data loaded yet</div>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 mb-4">
                  Fetch to enrich this property with deep data: AVM, tax records, building details, condition-adjusted value ranges.
                </p>
                <button
                  onClick={async () => {
                    setAttomLoading(true);
                    try {
                      const r = await compsAPI.attomEnrich(leadId);
                      setAttomData(r.data);
                      const lr = await leadsAPI.get(leadId);
                      setLead(lr.data);
                    } catch {}
                    setAttomLoading(false);
                  }}
                  disabled={attomLoading}
                  className="btn btn-primary"
                >
                  {attomLoading ? '⏳ Fetching ATTOM data…' : '📡 Fetch Property Intelligence'}
                </button>
              </div>
            ) : (
              <>
                {/* ── Condition-Adjusted AVM (investor's crown jewel) ── */}
                <div className="card border border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50 to-white">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-2xl">💎</span>
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-gray-100">Condition-Adjusted Valuation</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">ATTOM AVM ranges based on property condition — critical for investor ARV</p>
                    </div>
                    {attomData.attomAvmConfidence && (
                      <span className="ml-auto text-xs px-2 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 rounded-full font-medium">
                        {attomData.attomAvmConfidence}% confidence
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Distressed / AS-IS */}
                    <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4 text-center">
                      <div className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">😰 Distressed / AS-IS</div>
                      <div className="text-2xl font-bold text-red-700 dark:text-red-400">
                        {attomData.avmPoorHigh ? `$${Math.round(attomData.avmPoorHigh).toLocaleString()}` : '—'}
                      </div>
                      {attomData.avmPoorLow && attomData.avmPoorHigh && (
                        <div className="text-xs text-red-500 mt-1">
                          ${Math.round(attomData.avmPoorLow).toLocaleString()} – ${Math.round(attomData.avmPoorHigh).toLocaleString()}
                        </div>
                      )}
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">Poor condition, needs major work</div>
                    </div>

                    {/* Good condition */}
                    <div className="rounded-xl border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950 p-4 text-center">
                      <div className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 uppercase tracking-wide mb-1">👍 Good Condition</div>
                      <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">
                        {attomData.avmGoodHigh ? `$${Math.round(attomData.avmGoodHigh).toLocaleString()}` : '—'}
                      </div>
                      {attomData.avmGoodLow && attomData.avmGoodHigh && (
                        <div className="text-xs text-yellow-600 mt-1">
                          ${Math.round(attomData.avmGoodLow).toLocaleString()} – ${Math.round(attomData.avmGoodHigh).toLocaleString()}
                        </div>
                      )}
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">Average condition, minor repairs needed</div>
                    </div>

                    {/* After-Repair / Excellent = TRUE ARV */}
                    <div className="rounded-xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950 p-4 text-center ring-2 ring-green-400">
                      <div className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide mb-1">✨ After Repair (ARV)</div>
                      <div className="text-3xl font-bold text-green-700 dark:text-green-400">
                        {attomData.avmExcellentHigh ? `$${Math.round(attomData.avmExcellentHigh).toLocaleString()}` : '—'}
                      </div>
                      {attomData.avmExcellentLow && attomData.avmExcellentHigh && (
                        <div className="text-xs text-green-600 mt-1">
                          ${Math.round(attomData.avmExcellentLow).toLocaleString()} – ${Math.round(attomData.avmExcellentHigh).toLocaleString()}
                        </div>
                      )}
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">Fully renovated / excellent condition</div>
                    </div>
                  </div>

                  {/* ATTOM AVM baseline */}
                  {attomData.attomAvm && (
                    <div className="mt-4 flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-900 rounded-lg px-4 py-3 border border-gray-200 dark:border-gray-700">
                      <span className="font-medium">ATTOM AVM Baseline:</span>
                      <span className="font-bold text-gray-900 dark:text-gray-100">${Math.round(attomData.attomAvm).toLocaleString()}</span>
                      {attomData.attomAvmLow && attomData.attomAvmHigh && (
                        <span className="text-gray-400 dark:text-gray-500 text-xs">
                          (range: ${Math.round(attomData.attomAvmLow).toLocaleString()} – ${Math.round(attomData.attomAvmHigh).toLocaleString()})
                        </span>
                      )}
                      {attomData.attomAvmConfidence && (
                        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">Updated {attomData.attomEnrichedAt ? new Date(attomData.attomEnrichedAt).toLocaleDateString() : '—'}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Property Details ── */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                  {/* Building Details */}
                  <div className="card">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                      <span>🏗️</span> Building Details
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Beds', value: attomData.bedrooms ? `${attomData.bedrooms} bed` : '—' },
                        { label: 'Baths', value: attomData.bathrooms ? `${attomData.bathrooms} bath` : '—' },
                        { label: 'Sq Ft (Living)', value: attomData.sqft ? `${attomData.sqft.toLocaleString()} sqft` : '—' },
                        { label: 'Lot Size', value: attomData.lotSize ? `${attomData.lotSize.toFixed(3)} acres` : '—' },
                        { label: 'Year Built', value: attomData.yearBuilt ? String(attomData.yearBuilt) : '—' },
                        { label: 'Effective Year', value: attomData.effectiveYearBuilt ? String(attomData.effectiveYearBuilt) : '—' },
                        { label: 'Stories', value: attomData.stories ? String(attomData.stories) : '—' },
                        { label: 'Basement', value: attomData.basementSqft ? `${attomData.basementSqft.toLocaleString()} sqft` : '—' },
                        { label: 'Wall Type', value: attomData.wallType || '—' },
                        { label: 'Condition', value: attomData.propertyCondition || '—' },
                        { label: 'Quality', value: attomData.propertyQuality || '—' },
                        { label: 'Subdivision', value: attomData.subdivision || '—' },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-gray-50 dark:bg-gray-950 rounded-lg p-3">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{label}</div>
                          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Tax & Assessment */}
                  <div className="space-y-4">
                    <div className="card">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                        <span>🏦</span> Tax & Assessment
                      </h3>
                      <div className="space-y-3">
                        {[
                          { label: 'Annual Tax', value: attomData.annualTaxAmount ? `$${Math.round(attomData.annualTaxAmount).toLocaleString()}/yr` : '—', highlight: true },
                          { label: 'Assessed Value', value: attomData.taxAssessedValue ? `$${Math.round(attomData.taxAssessedValue).toLocaleString()}` : '—' },
                          { label: 'Market Assessed', value: attomData.marketAssessedValue ? `$${Math.round(attomData.marketAssessedValue).toLocaleString()}` : '—' },
                          { label: 'Last Sale Price', value: attomData.lastSalePrice ? `$${Math.round(attomData.lastSalePrice).toLocaleString()}` : '—' },
                          { label: 'Last Sale Date', value: attomData.lastSaleDate ? new Date(attomData.lastSaleDate).toLocaleDateString() : '—' },
                        ].map(({ label, value, highlight }) => (
                          <div key={label} className={`flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-800 last:border-0 ${highlight ? 'text-gray-900 dark:text-gray-100 font-semibold' : ''}`}>
                            <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
                            <span className={`text-sm ${highlight ? 'text-gray-900 dark:text-gray-100 font-bold' : 'text-gray-900 dark:text-gray-100'}`}>{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Quick investor math using ATTOM data */}
                    {attomData.avmExcellentHigh && attomData.avmPoorHigh && (
                      <div className="card border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950">
                        <h3 className="font-semibold text-purple-900 mb-3 flex items-center gap-2">
                          <span>🎯</span> ATTOM Investor Snapshot
                        </h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-purple-700 dark:text-purple-400">ARV (after repair)</span>
                            <span className="font-bold text-green-700 dark:text-green-400">${Math.round(attomData.avmExcellentHigh).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-purple-700 dark:text-purple-400">AS-IS value</span>
                            <span className="font-semibold text-red-600">${Math.round(attomData.avmPoorHigh).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between border-t border-purple-200 dark:border-purple-800 pt-2 mt-2">
                            <span className="text-purple-700 dark:text-purple-400 font-medium">Upside potential</span>
                            <span className="font-bold text-purple-800 dark:text-purple-400">
                              ${Math.round(attomData.avmExcellentHigh - attomData.avmPoorHigh).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-purple-700 dark:text-purple-400">70% MAO (of ARV)</span>
                            <span className="font-semibold text-blue-700 dark:text-blue-400">
                              ${Math.round(attomData.avmExcellentHigh * 0.7).toLocaleString()}
                            </span>
                          </div>
                          {attomData.annualTaxAmount && (
                            <div className="flex justify-between text-xs text-purple-600 mt-1">
                              <span>Monthly tax hold cost</span>
                              <span>${Math.round(attomData.annualTaxAmount / 12).toLocaleString()}/mo</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                  Property intelligence powered by ATTOM Data Solutions · Last updated: {attomData.attomEnrichedAt ? new Date(attomData.attomEnrichedAt).toLocaleString() : '—'}
                </p>
              </>
            )}
          </div>
        )}

      </main>

      {/* Attribution */}
      {compsWithSource > 0 && (
        <div className="text-center text-xs text-gray-400 dark:text-gray-500 pb-4">
          {compsFromAttom > 0 ? 'Deed-verified comparables powered by ATTOM' : 'Comparable data powered by RentCast'}
          {compsFromAttom > 0 && compsFromRentcast > 0 ? ' · Additional comps from RentCast' : ''}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

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
  if (source === 'attom') return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">ATTOM Verified</span>
  );
  if (source === 'rentcast') return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 font-medium">RentCast</span>
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
