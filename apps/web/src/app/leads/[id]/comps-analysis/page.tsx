'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { leadsAPI, compsAPI, compAnalysisAPI, photosAPI } from '@/lib/api';
import AppNav from '@/components/AppNav';
import PropertyPhoto from '@/components/PropertyPhoto';

const CompsMap = dynamic(() => import('@/components/CompsMap'), { ssr: false, loading: () => <div className="w-full h-64 bg-gray-100 rounded-lg animate-pulse" /> });

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
  adjustmentsEnabled: boolean;
  repairCosts?: number;
  repairFinishLevel?: string;
  repairNotes?: string;
  repairItems?: string[];
  dealType: string;
  assignmentFee: number;
  maoPercent: number;
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
  const leadId = params.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<string>('comps');
  const [fetchingComps, setFetchingComps] = useState(false);
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
  const [assignmentFee, setAssignmentFee] = useState(15000);
  const [maoPercent, setMaoPercent] = useState(70);

  // Repair estimator
  const [repairLevel, setRepairLevel] = useState('flip');
  const [selectedRepairs, setSelectedRepairs] = useState<string[]>([]);
  const [repairDescription, setRepairDescription] = useState('');

  // Processing states
  const [calculating, setCalculating] = useState(false);
  const [aiAdjusting, setAiAdjusting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [generatingAssessment, setGeneratingAssessment] = useState(false);
  const [analyzingPhotos, setAnalyzingPhotos] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);
  const [photoThumbnails, setPhotoThumbnails] = useState<{file: File; url: string; status: 'ready'|'uploading'|'done'}[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    loadData();
  }, [leadId]);

  const loadData = async () => {
    try {
      const leadRes = await leadsAPI.get(leadId);
      setLead(leadRes.data);
      if (leadRes.data?.aiAnalysis) { try { setAiAnalysis(JSON.parse(leadRes.data.aiAnalysis)); } catch {} }

      // Check for existing analyses
      const analyses = await compAnalysisAPI.list(leadId);
      if (analyses.data?.length > 0) {
        // Load most recent
        const latest = analyses.data[0];
        const full = await compAnalysisAPI.get(leadId, latest.id);
        setAnalysis(full.data);
        setDealArv(full.data.arvEstimate || full.data.lead?.arv || 0);
        setRepairCosts(full.data.repairCosts || 0);
        setAssignmentFee(full.data.assignmentFee || 15000);
        setMaoPercent(full.data.maoPercent || 70);
        setRepairLevel(full.data.repairFinishLevel || 'flip');
        setSelectedRepairs(full.data.repairItems || []);
      } else {
        // Auto-create analysis importing existing comps
        const existingComps = await compsAPI.list(leadId);
        if (existingComps.data?.length > 0) {
          const res = await compAnalysisAPI.create(leadId, {
            importExistingComps: true,
          });
          const full = await compAnalysisAPI.get(leadId, res.data.id);
          setAnalysis(full.data);
          setDealArv(full.data.arvEstimate || leadRes.data.arv || 0);
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
    setDealArv(res.data.arvEstimate || dealArv);
  }, [analysis, leadId, dealArv]);

  // ─── Find Comps (trigger RentCast) ─────────────────────────────────────────
  const handleFindComps = async (forceRefresh = false) => {
    setFetchingComps(true);
    try {
      // Trigger RentCast fetch
      const result = await compsAPI.fetch(leadId, forceRefresh);

      // Refresh lead data (ARV gets updated)
      const leadRes = await leadsAPI.get(leadId);
      setLead(leadRes.data);

      // Create new analysis with imported comps
      const res = await compAnalysisAPI.create(leadId, {
        importExistingComps: true,
      });
      const full = await compAnalysisAPI.get(leadId, res.data.id);
      setAnalysis(full.data);
      setDealArv(full.data.arvEstimate || leadRes.data.arv || result.data.arv || 0);
      setActiveSection('comps');
    } catch (error: any) {
      console.error('Failed to fetch comps:', error);
      alert(error.response?.data?.message || 'Failed to fetch comps from RentCast');
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
      setActiveSection('results');
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

  // ─── AI Adjustment Engine ───────────────────────────────────────────────────
  const handleAiAdjustComps = async () => {
    if (!analysis) return;
    setAiAdjusting(true);
    try {
      await compAnalysisAPI.aiAdjustComps(leadId, analysis.id);
      await refreshAnalysis();
      setActiveSection('results');
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-lg text-gray-500">Loading analysis...</div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-lg text-gray-500">Lead not found</div>
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
  const compsWithSource = allComps.filter(c => c.source === 'rentcast').length;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav />
      {/* Lead Sub-header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <PropertyPhoto
                src={lead.primaryPhoto}
                scoreBand={lead.scoreBand}
                address={lead.propertyAddress}
                size="md"
              />
              <div>
                <div className="flex items-center gap-1.5 mb-1 text-xs text-gray-400">
                  <Link href="/leads" className="hover:text-gray-700">Leads</Link>
                  <span>/</span>
                  <Link href={`/leads/${leadId}`} className="hover:text-gray-700">{lead.propertyAddress}</Link>
                  <span>/</span>
                  <span className="text-gray-600 font-medium">Comp Analysis</span>
                </div>
                <h1 className="text-xl font-bold text-gray-900">{lead.propertyAddress}</h1>
                <p className="text-gray-600 text-sm">{lead.propertyCity}, {lead.propertyState} {lead.propertyZip}</p>
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

      {/* Parent lead nav */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-6 text-sm">
            {[
              { label: 'Overview', href: `/leads/${leadId}` },
              { label: 'Comps', href: `/leads/${leadId}/comps-analysis`, active: true },
              { label: 'Analysis', href: `/leads/${leadId}` },
              { label: 'Messages', href: `/leads/${leadId}` },
              { label: 'Activity', href: `/leads/${leadId}` },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`py-3 px-1 border-b-2 font-medium whitespace-nowrap ${
                  item.active
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* Comp Analysis Sub-Nav */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {[
              { key: 'comps', label: `Comps (${allComps.length})` },
              { key: 'results', label: 'Results & ARV' },
              { key: 'deal', label: 'Deal Analysis' },
              { key: 'repairs', label: 'Repairs' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveSection(tab.key)}
                className={`py-3 px-1 border-b-2 font-medium text-sm ${
                  activeSection === tab.key
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* ═══════════════ COMPS SECTION ═══════════════ */}
        {activeSection === 'comps' && (
          <div className="space-y-6">
            {/* Map */}
            {allComps.some(c => c.latitude && c.longitude) || (lead?.latitude && lead?.longitude) ? (
              <div className="card">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-lg font-bold">Property Locations</h2>
                  <span className="text-xs text-gray-500">
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
              <h2 className="text-lg font-bold mb-3">Subject Property</h2>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <InfoItem label="Address" value={lead.propertyAddress} />
                <InfoItem label="Location" value={`${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}`} />
                <InfoItem label="Beds / Baths" value={`${lead.bedrooms || '?'} bd / ${lead.bathrooms || '?'} ba`} />
                <InfoItem label="Sq Ft" value={lead.sqft?.toLocaleString() || '—'} />
                <InfoItem label="Asking Price" value={lead.askingPrice ? `$${lead.askingPrice.toLocaleString()}` : '—'} />
                <InfoItem label="Condition" value={lead.conditionLevel || '—'} />
              </div>
            </div>

            {/* Toolbar */}
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-4">
                  <h2 className="text-lg font-bold">
                    Comparable Properties
                  </h2>
                  <span className="text-sm text-gray-500">
                    {selectedComps.length} selected of {allComps.length}
                  </span>
                  {compsWithSource > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                      {compsWithSource} from RentCast
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleFindComps(true)}
                    disabled={fetchingComps}
                    className="btn btn-primary btn-sm"
                  >
                    {fetchingComps ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                        Fetching...
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
                  <span className="text-gray-500 font-medium">Sort by:</span>
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
                          : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {s.label} {sortField === s.key && (sortDir === 'asc' ? '↑' : '↓')}
                    </button>
                  ))}
                </div>
              )}

              {/* Add Comp Form */}
              {showAddComp && (
                <div className="bg-gray-50 rounded-lg p-4 mb-6 border border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Add Comparable Property</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Address *</label>
                      <input
                        type="text"
                        value={compForm.address}
                        onChange={(e) => setCompForm({ ...compForm, address: e.target.value })}
                        placeholder="123 Main St, City, ST"
                        className="input text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Sold Price *</label>
                      <input
                        type="number"
                        value={compForm.soldPrice}
                        onChange={(e) => setCompForm({ ...compForm, soldPrice: e.target.value })}
                        placeholder="350000"
                        className="input text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Sold Date *</label>
                      <input
                        type="date"
                        value={compForm.soldDate}
                        onChange={(e) => setCompForm({ ...compForm, soldDate: e.target.value })}
                        className="input text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Distance (mi)</label>
                      <input type="number" step="0.1" value={compForm.distance}
                        onChange={(e) => setCompForm({ ...compForm, distance: e.target.value })}
                        placeholder="0.5" className="input text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Sq Ft</label>
                      <input type="number" value={compForm.sqft}
                        onChange={(e) => setCompForm({ ...compForm, sqft: e.target.value })}
                        placeholder="1800" className="input text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Beds</label>
                      <input type="number" value={compForm.bedrooms}
                        onChange={(e) => setCompForm({ ...compForm, bedrooms: e.target.value })}
                        placeholder="3" className="input text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Baths</label>
                      <input type="number" step="0.5" value={compForm.bathrooms}
                        onChange={(e) => setCompForm({ ...compForm, bathrooms: e.target.value })}
                        placeholder="2" className="input text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Year Built</label>
                      <input type="number" value={compForm.yearBuilt}
                        onChange={(e) => setCompForm({ ...compForm, yearBuilt: e.target.value })}
                        placeholder="1990" className="input text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Lot (acres)</label>
                      <input type="number" step="0.01" value={compForm.lotSize}
                        onChange={(e) => setCompForm({ ...compForm, lotSize: e.target.value })}
                        placeholder="0.25" className="input text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">DOM</label>
                      <input type="number" value={compForm.daysOnMarket}
                        onChange={(e) => setCompForm({ ...compForm, daysOnMarket: e.target.value })}
                        placeholder="30" className="input text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
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
                        className="rounded border-gray-300" /> Pool
                    </label>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={compForm.hasGarage}
                        onChange={(e) => setCompForm({ ...compForm, hasGarage: e.target.checked })}
                        className="rounded border-gray-300" /> Garage
                    </label>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={compForm.isRenovated}
                        onChange={(e) => setCompForm({ ...compForm, isRenovated: e.target.checked })}
                        className="rounded border-gray-300" /> Renovated
                    </label>
                  </div>
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
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
                <div className="text-center py-12 text-gray-500">
                  <div className="text-5xl mb-3">&#127968;</div>
                  <p className="font-medium text-lg">No comparables yet</p>
                  <p className="text-sm mt-1 mb-4">
                    Click &quot;Find Comps&quot; to fetch comparable properties from RentCast
                  </p>
                  <button
                    onClick={() => handleFindComps(false)}
                    disabled={fetchingComps}
                    className="btn btn-primary"
                  >
                    {fetchingComps ? 'Fetching from RentCast...' : 'Find Comps'}
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
                    onClick={handleCalculate}
                    disabled={calculating || aiAdjusting || selectedComps.length === 0}
                    className="btn btn-secondary"
                  >
                    {calculating ? 'Calculating...' : `Rule-Based ARV (${selectedComps.length} comps)`}
                  </button>
                  <button
                    onClick={handleAiAdjustComps}
                    disabled={aiAdjusting || calculating || selectedComps.length === 0}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    {aiAdjusting ? (
                      <>
                        <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        AI Adjusting Comps...
                      </>
                    ) : (
                      <>✨ AI Adjust &amp; Calculate ARV</>
                    )}
                  </button>
                  <button
                    onClick={handleAiSummary}
                    disabled={generatingAi || selectedComps.length === 0}
                    className="btn btn-secondary"
                  >
                    {generatingAi ? 'Generating...' : 'Generate AI Summary'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════ RESULTS SECTION ═══════════════ */}
        {activeSection === 'results' && (
          <div className="space-y-6">
            {/* AI Summary */}
            {analysis?.aiSummary && (
              <div className="card bg-blue-50 border border-blue-200">
                <div className="flex items-start gap-3">
                  <div className="text-2xl">&#129302;</div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-semibold text-blue-900">AI Analysis Summary</h3>
                      {analysis.confidenceScore > 0 && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          analysis.confidenceScore >= 80 ? 'bg-green-100 text-green-700' :
                          analysis.confidenceScore >= 60 ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {analysis.confidenceScore}% confidence
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-blue-800">{analysis.aiSummary}</p>
                  </div>
                </div>
              </div>
            )}

            {/* AI Property Assessment */}
            <div className="card border border-indigo-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🧠</span>
                  <h3 className="font-bold text-gray-900">AI Property Assessment</h3>
                  {(analysis as any)?.aiAssessment && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">Generated</span>
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
                    <p className="text-sm text-gray-500 italic">
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
                        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                          <div className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-1">💡 Wholesaler Take</div>
                          <p className="text-sm text-indigo-900 leading-relaxed">{parsed.wholesalerNote}</p>
                        </div>
                      )}
                      {/* Method */}
                      {parsed.method && (
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">📐 Valuation Method</div>
                          <p className="text-sm text-gray-700">{parsed.method}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Key Factors */}
                        {parsed.keyFactors?.length > 0 && (
                          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                            <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">🔑 Key Factors</div>
                            <ul className="space-y-1.5">
                              {parsed.keyFactors.map((f: string, i: number) => (
                                <li key={i} className="text-sm text-blue-900 flex gap-2">
                                  <span className="text-blue-400 shrink-0 mt-0.5">•</span>
                                  <span>{f}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {/* Risks */}
                        {parsed.risks?.length > 0 && (
                          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                            <div className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">⚠️ Risks</div>
                            <ul className="space-y-1.5">
                              {parsed.risks.map((r: string, i: number) => (
                                <li key={i} className="text-sm text-red-900 flex gap-2">
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
                  <div className="prose prose-sm max-w-none text-gray-800 bg-indigo-50 rounded-lg p-4 text-sm leading-relaxed">
                    {raw.split('\n').map((line: string, i: number) => {
                      if (line.startsWith('**') && line.endsWith('**')) {
                        return <p key={i} className="font-bold text-indigo-900 mt-3 mb-1">{line.replace(/\*\*/g, '')}</p>;
                      }
                      return <p key={i} className={line === '' ? 'mb-2' : 'mb-0.5'}>{line}</p>;
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Quick Stats if no full analysis calculated yet */}
            {!analysis?.arvEstimate && selectedComps.length > 0 && (
              <div className="card bg-yellow-50 border border-yellow-200">
                <div className="flex items-center gap-3">
                  <div className="text-xl">&#9888;&#65039;</div>
                  <div>
                    <p className="text-sm font-medium text-yellow-800">ARV not calculated yet</p>
                    <p className="text-xs text-yellow-700 mt-0.5">
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
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 capitalize">
                      {analysis.arvMethod === 'weighted' ? '✨ AI-weighted' : analysis.arvMethod} method
                    </span>
                  )}
                </div>

                {/* Primary ARV display with confidence interval */}
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-6 mb-5">
                  <div className="flex items-end justify-between flex-wrap gap-4">
                    <div>
                      <div className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">Estimated ARV</div>
                      <div className="text-5xl font-bold text-green-700">${(analysis.arvEstimate || 0).toLocaleString()}</div>
                      {(analysis.arvLow && analysis.arvHigh) ? (
                        <div className="mt-2">
                          <div className="text-sm text-green-600 font-medium mb-1">
                            Range: ${(analysis.arvLow).toLocaleString()} – ${(analysis.arvHigh).toLocaleString()}
                            <span className="text-green-500 ml-2">
                              (±${Math.round(((analysis.arvHigh - analysis.arvLow) / (analysis.arvEstimate || 1)) * 50).toLocaleString()}%)
                            </span>
                          </div>
                          {/* Confidence interval bar */}
                          <div className="relative h-3 bg-green-200 rounded-full w-64 mt-1">
                            {(() => {
                              const range = analysis.arvHigh - analysis.arvLow;
                              const span = range * 1.4;
                              const base = (analysis.arvEstimate || 0) - span / 2;
                              const lowPct = Math.max(0, ((analysis.arvLow - base) / span) * 100);
                              const highPct = Math.min(100, ((analysis.arvHigh - base) / span) * 100);
                              const midPct = (((analysis.arvEstimate ?? 0) - base) / span) * 100;
                              return (
                                <>
                                  <div className="absolute h-3 bg-green-400 rounded-full" style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }} />
                                  <div className="absolute h-5 w-1 bg-green-800 rounded-full top-[-4px]" style={{ left: `${midPct}%` }} />
                                </>
                              );
                            })()}
                          </div>
                          <div className="flex justify-between text-xs text-green-500 mt-1 w-64">
                            <span>Low</span><span>Point estimate</span><span>High</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-6">
                      <DonutStat
                        value={analysis.confidenceScore || 0}
                        max={100}
                        label="Confidence"
                        color={(analysis.confidenceScore || 0) >= 80 ? '#10b981' : (analysis.confidenceScore || 0) >= 60 ? '#f59e0b' : '#ef4444'}
                        size={80}
                      />
                      <div className="text-right">
                        <div className="text-xs text-gray-500 mb-1">$/sqft</div>
                        <div className="text-2xl font-bold text-gray-700">${analysis.pricePerSqft || avgPricePerSqft || 0}</div>
                        {analysis.avgAdjustment ? (
                          <div className={`text-xs font-medium ${(analysis.avgAdjustment || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {(analysis.avgAdjustment || 0) >= 0 ? '+' : ''}${(analysis.avgAdjustment || 0).toLocaleString()} avg adj
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

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
              </div>
            )}

            {/* Adjustments Detail */}
            {analysis && selectedComps.length > 0 && (
              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-bold">Adjustments</h2>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    analysis.adjustmentsEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {analysis.adjustmentsEnabled ? 'Applied' : 'Not applied'}
                  </span>
                </div>
                <div className="space-y-3">
                  {selectedComps.map((comp) => (
                    <div key={comp.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{comp.address}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {comp.adjustmentNotes?.split('\n').join(' | ') || 'No adjustments'}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <div className="text-xs text-gray-500">Original</div>
                          <div className="text-sm font-medium">${comp.soldPrice.toLocaleString()}</div>
                        </div>
                        <div className="text-lg text-gray-400">&rarr;</div>
                        <div>
                          <div className="text-xs text-gray-500">Adjusted</div>
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
                        <span className="text-gray-600">Average Adjustment: </span>
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
                      <th className="pb-2 pr-3 font-medium text-gray-600">Address</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600">Source</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600">Sale Price</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600">Adj. Price</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600">Sale Date</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600">Sq Ft</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600">$/SqFt</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600">Beds</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600">Baths</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600">Year</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600">Dist</th>
                      <th className="pb-2 font-medium text-gray-600">Corr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedComps.map((comp) => (
                      <tr key={comp.id} className="border-b border-gray-100">
                        <td className="py-2 pr-3 font-medium max-w-[200px] truncate">{comp.address}</td>
                        <td className="py-2 pr-3">
                          <SourceBadge source={comp.source} />
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
              {!analysis?.aiSummary && selectedComps.length > 0 && (
                <button
                  onClick={handleAiSummary}
                  disabled={generatingAi}
                  className="btn btn-secondary"
                >
                  {generatingAi ? 'Generating...' : 'Generate AI Summary'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════ DEAL ANALYSIS SECTION ═══════════════ */}
        {activeSection === 'deal' && (
          <div className="space-y-6">
            <div className="card">
              <div className="flex items-center gap-3 mb-6">
                <h2 className="text-lg font-bold">Deal Analysis</h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 font-medium">Wholesale</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Inputs */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">After Repair Value (ARV)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Repair Costs</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
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
                          className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Wholesale Assignment Fee</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                      <input
                        type="number"
                        value={assignmentFee || ''}
                        onChange={(e) => setAssignmentFee(parseFloat(e.target.value) || 0)}
                        className="input pl-7"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Maximum Allowable Offer %
                      {selectedComps.length > 0 && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 font-medium">
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
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Results */}
                <div className="space-y-4">
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <div className="text-xs text-gray-500 mb-1">Initial Offer to Seller</div>
                    <div className="text-2xl font-bold text-gray-900">
                      {dealArv > 0 ? `$${Math.max(initialOffer, 0).toLocaleString()}` : '$—'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">5% under max allowable offer</div>
                  </div>

                  <div className="bg-primary-50 rounded-lg p-4 border border-primary-200">
                    <div className="text-xs text-primary-700 mb-1">Maximum Allowable Offer</div>
                    <div className="text-2xl font-bold text-primary-800">
                      {dealArv > 0 ? `$${Math.max(mao, 0).toLocaleString()}` : '$—'}
                    </div>
                    <div className="text-xs text-primary-600 mt-1">
                      {maoPercent}% of ARV minus repairs & fee
                    </div>
                  </div>

                  <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                    <div className="text-xs text-green-700 mb-1">Your Sale Price to Buyer</div>
                    <div className="text-2xl font-bold text-green-800">
                      {dealArv > 0 ? `$${Math.max(salePrice, 0).toLocaleString()}` : '$—'}
                    </div>
                    <div className="text-xs text-green-600 mt-1">
                      {maoPercent}% of ARV minus repairs
                    </div>
                  </div>

                  {dealArv > 0 && (
                    <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200">
                      <div className="text-xs text-yellow-800">
                        <strong>Spread:</strong> ${assignmentFee.toLocaleString()} assignment fee
                        {lead?.askingPrice && mao > 0 ? (
                          <span> | Asking is {((lead.askingPrice / dealArv) * 100).toFixed(0)}% of ARV
                            {lead.askingPrice <= mao ? (
                              <span className="text-green-700 font-medium"> — Below MAO!</span>
                            ) : (
                              <span className="text-red-700 font-medium"> — Above MAO by ${(lead.askingPrice - mao).toLocaleString()}</span>
                            )}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════ REPAIRS SECTION ═══════════════ */}
        {activeSection === 'repairs' && (
          <div className="space-y-6">

            {/* ── Photo Upload & AI Analysis ── */}
            <div className="card border border-purple-200">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xl">📸</span>
                <h2 className="text-lg font-bold">Photo Analysis</h2>
                {(analysis as any)?.photoAnalysis && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">Analyzed</span>
                )}
              </div>

              {/* Drop Zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer mb-4 ${
                  isDragging ? 'border-purple-500 bg-purple-100' : 'border-purple-300 bg-purple-50 hover:bg-purple-100'
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
                    <p className="text-sm font-medium text-purple-700">Drag & drop photos here, or click to select</p>
                    <p className="text-xs text-gray-400 mt-1">
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
                          'border-gray-300'
                        }`}
                      />
                      {t.status === 'uploading' && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30">
                          <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        </div>
                      )}
                      {t.status === 'done' && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-green-500/20">
                          <span className="text-green-600 text-lg">✓</span>
                        </div>
                      )}
                      {t.status === 'ready' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); removePhoto(i); }}
                          className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs items-center justify-center hidden group-hover:flex"
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
                    <div className="flex items-center justify-center min-h-24 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                      <p className="text-sm text-gray-400 text-center px-4">
                        Upload photos and click Analyze to get a visual condition report and repair estimate
                      </p>
                    </div>
                  );
                }

                if (!parsed) {
                  // Legacy text fallback
                  return (
                    <div className="bg-purple-50 rounded-lg p-4 border border-purple-100 max-h-72 overflow-y-auto text-sm text-gray-700 whitespace-pre-wrap">
                      {(analysis as any).photoAnalysis}
                    </div>
                  );
                }

                const conditionColor = (c: string) =>
                  c === 'Good' ? 'bg-green-100 text-green-700' :
                  c === 'Fair' ? 'bg-yellow-100 text-yellow-800' :
                  c === 'Poor' ? 'bg-orange-100 text-orange-700' :
                  c === 'Gut'  ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-600';

                const urgencyIcon = (u: string) =>
                  u === 'critical' ? '🚨' : u === 'high' ? '⚠️' : u === 'medium' ? '🔶' : '✅';

                const systemIcon = (s: string) =>
                  ({ roof: '🏠', hvac: '❄️', electrical: '⚡', plumbing: '🚰', foundation: '🪨' })[s] || '🔧';

                return (
                  <div className="space-y-5">
                    {/* Overall summary bar */}
                    <div className="flex items-center gap-4 bg-gray-50 rounded-xl p-4 border border-gray-200">
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Overall Condition</div>
                        <span className={`inline-block text-sm font-bold px-3 py-1 rounded-full ${conditionColor(parsed.overallCondition || 'Fair')}`}>
                          {parsed.overallCondition || 'Fair'}
                        </span>
                      </div>
                      {(parsed.repairLow || parsed.repairHigh) ? (
                        <div className="text-right">
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Photo Repair Estimate</div>
                          <div className="text-xl font-bold text-purple-700">
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
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
                        <div className="font-semibold text-blue-900 mb-1">💡 Wholesaler Take</div>
                        {parsed.wholesalerNotes}
                      </div>
                    )}

                    {/* Red flags */}
                    {parsed.redFlags?.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                        <div className="font-semibold text-red-800 mb-2">🚨 Red Flags</div>
                        <ul className="space-y-1">
                          {parsed.redFlags.map((flag: string, i: number) => (
                            <li key={i} className="text-sm text-red-700 flex gap-2">
                              <span>•</span><span>{flag}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Rooms grid */}
                    {parsed.rooms?.length > 0 && (
                      <div>
                        <div className="text-sm font-bold text-gray-700 mb-3">Room-by-Room</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {parsed.rooms.map((room: any, i: number) => (
                            <div key={i} className={`rounded-xl border p-3 ${
                              room.condition === 'Gut' ? 'border-red-200 bg-red-50' :
                              room.condition === 'Poor' ? 'border-orange-200 bg-orange-50' :
                              room.condition === 'Fair' ? 'border-yellow-200 bg-yellow-50' :
                              'border-green-200 bg-green-50'
                            }`}>
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-semibold text-sm text-gray-800">{urgencyIcon(room.urgency)} {room.name}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${conditionColor(room.condition)}`}>
                                  {room.condition}
                                </span>
                              </div>
                              {room.issues?.length > 0 && (
                                <ul className="text-xs text-gray-600 space-y-0.5">
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
                        <div className="text-sm font-bold text-gray-700 mb-3">Systems</div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                          {Object.entries(parsed.systems).map(([key, sys]: [string, any]) => (
                            <div key={key} className={`rounded-xl border p-3 text-center ${
                              sys.condition === 'Poor' ? 'border-orange-200 bg-orange-50' :
                              sys.condition === 'Good' ? 'border-green-200 bg-green-50' :
                              'border-gray-200 bg-gray-50'
                            }`}>
                              <div className="text-2xl mb-1">{systemIcon(key)}</div>
                              <div className="text-xs font-semibold text-gray-700 capitalize">{key}</div>
                              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${conditionColor(sys.condition || 'Unknown')}`}>
                                {sys.condition || 'Unknown'}
                              </span>
                              {sys.notes && <div className="text-xs text-gray-500 mt-1 text-left leading-tight">{sys.notes}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Repair Items */}
                    {parsed.repairItems?.length > 0 && (
                      <div>
                        <div className="text-sm font-bold text-gray-700 mb-3">Repair Breakdown</div>
                        <div className="rounded-xl border border-gray-200 overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                              <tr>
                                <th className="text-left px-4 py-2">Item</th>
                                <th className="text-center px-3 py-2">Priority</th>
                                <th className="text-right px-4 py-2">Range</th>
                              </tr>
                            </thead>
                            <tbody>
                              {parsed.repairItems.map((item: any, i: number) => (
                                <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                                  <td className="px-4 py-2 text-gray-800">{item.item}</td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                                      item.priority === 'critical' ? 'bg-red-100 text-red-700' :
                                      item.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                                      item.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                      'bg-gray-100 text-gray-500'
                                    }`}>{item.priority}</span>
                                  </td>
                                  <td className="px-4 py-2 text-right text-gray-700">
                                    ${(item.estimateLow||0).toLocaleString()} – ${(item.estimateHigh||0).toLocaleString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="bg-gray-50 font-bold">
                              <tr className="border-t border-gray-200">
                                <td className="px-4 py-2 text-gray-800" colSpan={2}>Total Estimate</td>
                                <td className="px-4 py-2 text-right text-purple-700">
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Finish Level</label>
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">Quick Repair Options</label>
                    <div className="flex flex-wrap gap-2">
                      {REPAIR_ITEMS.map((item) => (
                        <button
                          key={item}
                          onClick={() => toggleRepairItem(item)}
                          className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                            selectedRepairs.includes(item)
                              ? 'bg-primary-600 text-white border-primary-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Describe Repairs Needed</label>
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
                    repairCosts > 0 ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-gray-50'
                  }`}>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Estimated Repair Costs</div>
                    <div className={`text-4xl font-bold mb-1 ${repairCosts > 0 ? 'text-orange-700' : 'text-gray-400'}`}>
                      ${repairCosts.toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-500">
                      {repairLevel.charAt(0).toUpperCase() + repairLevel.slice(1)} grade
                      {lead?.sqft && repairCosts > 0 ? ` · $${Math.round(repairCosts / lead.sqft)}/sqft` : ''}
                    </div>
                    {repairCosts > 0 && (
                      <div className="mt-3 text-xs text-orange-700 bg-orange-100 rounded-lg px-3 py-2">
                        ✓ Applied to deal calculator · ARV needed to break even: ${dealArv > 0 ? Math.round((repairCosts + assignmentFee) / (maoPercent / 100)).toLocaleString() : '—'}
                      </div>
                    )}
                  </div>

                  {analysis?.repairNotes && (
                    <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                      <div className="text-xs font-medium text-blue-800 mb-1">AI Breakdown</div>
                      <div className="text-sm text-blue-700">{analysis.repairNotes}</div>
                    </div>
                  )}

                  <div>
                    <div className="text-xs text-gray-500 mb-2 font-medium">Quick estimate by condition:</div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Light', sublabel: '$20/sqft', rate: 20, color: 'border-green-300 hover:bg-green-50' },
                        { label: 'Moderate', sublabel: '$30/sqft', rate: 30, color: 'border-yellow-300 hover:bg-yellow-50' },
                        { label: 'Heavy', sublabel: '$45/sqft', rate: 45, color: 'border-red-300 hover:bg-red-50' },
                      ].map((opt) => (
                        <button
                          key={opt.rate}
                          onClick={() => setRepairCosts((lead?.sqft || 1500) * opt.rate)}
                          className={`text-xs px-2 py-2 rounded-lg border text-center transition-colors bg-white ${opt.color}`}
                        >
                          <div className="font-semibold text-gray-700">{opt.label}</div>
                          <div className="text-gray-400">{opt.sublabel}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* RentCast attribution */}
      {compsWithSource > 0 && (
        <div className="text-center text-xs text-gray-400 pb-4">
          Comparable data powered by RentCast
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="text-sm font-medium text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center border border-gray-200">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-sm font-bold text-gray-800">{value}</div>
    </div>
  );
}

function SourceBadge({ source }: { source?: string }) {
  if (!source || source === 'manual') return <span className="text-xs text-gray-400">Manual</span>;
  if (source === 'rentcast') return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">RentCast</span>
  );
  if (source === 'chatarv') return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">ChatARV</span>
  );
  return <span className="text-xs text-gray-400">{source}</span>;
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
          ? 'border-yellow-400 bg-yellow-50 shadow-md ring-2 ring-yellow-300'
          : comp.selected
          ? 'border-primary-400 bg-white shadow-sm'
          : 'border-gray-200 bg-gray-50 opacity-60'
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
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
            {comp.distance.toFixed(1)} mi
          </span>
          <SourceBadge source={comp.source} />
          {comp.correlation && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              comp.correlation >= 0.8 ? 'bg-green-100 text-green-700' :
              comp.correlation >= 0.6 ? 'bg-yellow-100 text-yellow-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {(comp.correlation * 100).toFixed(0)}% match
            </span>
          )}
        </div>
        <input
          type="checkbox"
          checked={comp.selected}
          onChange={onToggle}
          className="h-5 w-5 rounded border-gray-300 text-primary-600"
        />
      </div>

      {/* Price */}
      <div className="mb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-gray-900">${comp.soldPrice.toLocaleString()}</span>
          {pricePerSqft && (
            <span className="text-xs text-gray-500">${pricePerSqft}/sqft</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium">
            Sold
          </span>
          <span className="text-xs text-gray-500">
            {new Date(comp.soldDate).toLocaleDateString()} ({monthsAgo}mo ago)
          </span>
        </div>
        {comp.adjustedPrice && comp.adjustedPrice !== comp.soldPrice && (
          <div className="mt-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">Adjusted Price</span>
              <span className={`text-sm font-bold ${(comp.adjustmentAmount || 0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                ${comp.adjustedPrice.toLocaleString()}
                <span className="text-xs ml-1 font-normal">
                  ({(comp.adjustmentAmount || 0) >= 0 ? '+' : ''}{(comp.adjustmentAmount || 0).toLocaleString()})
                </span>
              </span>
            </div>
            {comp.adjustmentNotes && (
              <div className="space-y-0.5">
                {comp.adjustmentNotes.split('\n').filter((l: string) => l.trim()).map((line: string, i: number) => (
                  <div key={i} className={`text-xs flex gap-1 ${line.startsWith('AI:') ? 'text-purple-600 font-medium' : 'text-gray-500'}`}>
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
      <div className="text-sm font-medium text-gray-800 mb-2">{comp.address}</div>

      {/* Details Grid */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <div className="text-center bg-gray-50 rounded p-1.5">
          <div className="text-xs text-gray-500">Beds</div>
          <div className="text-sm font-semibold">{comp.bedrooms || '—'}</div>
        </div>
        <div className="text-center bg-gray-50 rounded p-1.5">
          <div className="text-xs text-gray-500">Baths</div>
          <div className="text-sm font-semibold">{comp.bathrooms || '—'}</div>
        </div>
        <div className="text-center bg-gray-50 rounded p-1.5">
          <div className="text-xs text-gray-500">Sq Ft</div>
          <div className="text-sm font-semibold">{comp.sqft?.toLocaleString() || '—'}</div>
        </div>
      </div>

      {/* Extra Details */}
      <div className="text-xs text-gray-600 space-y-0.5">
        {comp.yearBuilt && <span>Built {comp.yearBuilt}</span>}
        {comp.lotSize ? <span> | {comp.lotSize} acres</span> : null}
        {comp.daysOnMarket ? <span> | {comp.daysOnMarket} DOM</span> : null}
      </div>

      {/* Feature Badges */}
      {(comp.hasPool || comp.hasGarage || comp.isRenovated) && (
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {comp.hasPool && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700 font-medium">Pool</span>
          )}
          {comp.hasGarage && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">Garage</span>
          )}
          {comp.isRenovated && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Renovated</span>
          )}
        </div>
      )}

      {/* Comparison notes */}
      {(comp.notes || sizeDiff !== null) && (
        <div className="mt-2 text-xs text-gray-500 italic border-t pt-2">
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
          className="text-xs text-red-500 hover:text-red-700"
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
      <div className="text-xs text-gray-500 text-center leading-tight mt-0.5">{label}</div>
    </div>
  );
}
