'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { dealMathAPI, compAnalysisAPI, photosAPI } from '@/lib/api';
import {
  DealMathStrategyKey,
  STRATEGY_CONFIGS,
  STRATEGY_KEYS,
  StrategyInputField,
  formatCurrency,
  formatOutput,
} from './strategy-config';
import { ConditionReportContent, ParsedConditionReport } from './condition-report-renderers';

type RepairMethod = 'PHOTO_ANALYSIS' | 'QUICK_SQFT' | 'MANUAL_BUILDER' | 'AI_TEXT' | 'MANUAL_OVERRIDE';

interface DealMathState {
  strategy: DealMathStrategyKey | null;
  arv: number | null;
  arvConfidence: number | null;
  askingPrice: number | null;
  repairEstimate: number | null;
  repairMethod: RepairMethod | null;
  repairMetadata: Record<string, any> | null;
  inputs: Record<string, any>;
  outputs: Record<string, number | null>;
  latestPhotoAnalysis: {
    id: string;
    resultJson: any;
    rangeLow: number | null;
    rangeHigh: number | null;
    midpoint: number | null;
    photosAnalyzed: number | null;
    analyzedAt: string;
  } | null;
}

interface Props {
  leadId: string;
  /** Required for the manual-builder + AI-text repair endpoints (which key off analysisId). */
  analysisId: string | null;
  /** Sqft used for quick-sqft chips (lead.sqftOverride || lead.sqft). */
  sqft: number | null;
  arvCalculationMode: 'ARV_RENOVATED' | 'AS_IS' | null;
  /** Photos already on the lead (MLS, seller portal, MMS, streetview). Selectable for AI analysis. */
  leadPhotos: Array<{ id: string; url?: string; thumbnailUrl?: string; source?: string }>;
}

const REPAIR_ITEMS = [
  'Full gut', 'Roof', 'Kitchen', 'Bathrooms', 'Windows', 'Landscaping',
  'Exterior Painting', 'Drywall', 'Interior painting', 'Flooring', 'Driveway', 'HVAC',
];

const BACKEND_PHOTO_LIMIT = 30;

interface PhotoThumbnail {
  file: File;
  url: string;
  status: 'ready' | 'uploading' | 'done';
}

export default function DealMathPanel({ leadId, analysisId, sqft, arvCalculationMode, leadPhotos }: Props) {
  const [state, setState] = useState<DealMathState | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [repairValueDraft, setRepairValueDraft] = useState<string>('');
  const [manualBuilderLevel, setManualBuilderLevel] = useState('flip');
  const [manualBuilderItems, setManualBuilderItems] = useState<string[]>([]);
  const [aiDescription, setAiDescription] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);

  // Photo analysis upload UI state. `expandUploadUI` lets the user re-analyze
  // even when a saved photo analysis already exists (Re-analyze button).
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);
  const [photoThumbnails, setPhotoThumbnails] = useState<PhotoThumbnail[]>([]);
  const [selectedLeadPhotoIds, setSelectedLeadPhotoIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [expandUploadUI, setExpandUploadUI] = useState(false);

  const refresh = useCallback(async () => {
    const res = await dealMathAPI.get(leadId);
    setState(res.data);
    setRepairValueDraft(res.data.repairEstimate != null ? String(res.data.repairEstimate) : '');
  }, [leadId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  if (loading) {
    return (
      <div className="card">
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading deal math…</div>
      </div>
    );
  }
  if (!state) return null;

  const config = state.strategy ? STRATEGY_CONFIGS[state.strategy] : null;

  const handleStrategyChange = async (next: DealMathStrategyKey | null) => {
    setSubmitting('strategy');
    try {
      const res = await dealMathAPI.setStrategy(leadId, next);
      setState(res.data);
    } finally {
      setSubmitting(null);
    }
  };

  const handleInputChange = async (key: string, value: number | string | null) => {
    if (!state.strategy) return;
    setSubmitting(`input-${key}`);
    try {
      const res = await dealMathAPI.setInputs(leadId, state.strategy, { [key]: value });
      setState(res.data);
    } finally {
      setSubmitting(null);
    }
  };

  const handleManualOverride = async () => {
    const val = repairValueDraft === '' ? null : Number(repairValueDraft);
    if (val != null && !isFinite(val)) return;
    setSubmitting('repair-override');
    try {
      const res = await dealMathAPI.setRepairEstimate(leadId, {
        value: val,
        method: 'MANUAL_OVERRIDE',
        metadata: { previousMethod: state.repairMethod ?? null },
      });
      setState(res.data);
      setPickerOpen(false);
    } finally {
      setSubmitting(null);
    }
  };

  const handleQuickSqft = async (rate: number, label: string) => {
    if (!sqft) return;
    const value = sqft * rate;
    setSubmitting('quick-sqft');
    try {
      const res = await dealMathAPI.setRepairEstimate(leadId, {
        value,
        method: 'QUICK_SQFT',
        metadata: { tier: label, rate, sqft },
      });
      setState(res.data);
      setPickerOpen(false);
    } finally {
      setSubmitting(null);
    }
  };

  const handleApplyPhotoLow = async () => {
    if (!state.latestPhotoAnalysis?.rangeLow) return;
    setSubmitting('photo-low');
    try {
      const res = await dealMathAPI.setRepairEstimate(leadId, {
        value: state.latestPhotoAnalysis.rangeLow,
        method: 'PHOTO_ANALYSIS',
        metadata: {
          ...(state.repairMetadata ?? {}),
          appliedBound: 'low',
          photoAnalysisResultId: state.latestPhotoAnalysis.id,
        },
      });
      setState(res.data);
    } finally {
      setSubmitting(null);
    }
  };

  const handleApplyPhotoHigh = async () => {
    if (!state.latestPhotoAnalysis?.rangeHigh) return;
    setSubmitting('photo-high');
    try {
      const res = await dealMathAPI.setRepairEstimate(leadId, {
        value: state.latestPhotoAnalysis.rangeHigh,
        method: 'PHOTO_ANALYSIS',
        metadata: {
          ...(state.repairMetadata ?? {}),
          appliedBound: 'high',
          photoAnalysisResultId: state.latestPhotoAnalysis.id,
        },
      });
      setState(res.data);
    } finally {
      setSubmitting(null);
    }
  };

  const handleApplyPhotoMidpoint = async () => {
    if (!state.latestPhotoAnalysis?.midpoint) return;
    setSubmitting('photo-mid');
    try {
      const res = await dealMathAPI.setRepairEstimate(leadId, {
        value: state.latestPhotoAnalysis.midpoint,
        method: 'PHOTO_ANALYSIS',
        metadata: {
          ...(state.repairMetadata ?? {}),
          appliedBound: 'midpoint',
          photoAnalysisResultId: state.latestPhotoAnalysis.id,
        },
      });
      setState(res.data);
    } finally {
      setSubmitting(null);
    }
  };

  const handleManualBuilder = async () => {
    if (!analysisId) return;
    setSubmitting('manual-builder');
    try {
      // The existing endpoint persists to CompAnalysis AND now mirrors to Lead
      // via DealMathService. Refresh after.
      await compAnalysisAPI.estimateRepairs(leadId, analysisId, {
        finishLevel: manualBuilderLevel,
        repairItems: manualBuilderItems,
        sqft: sqft ?? undefined,
      });
      await refresh();
      setPickerOpen(false);
    } finally {
      setSubmitting(null);
    }
  };

  const handleAiText = async () => {
    if (!analysisId || !aiDescription.trim()) return;
    setSubmitting('ai-text');
    try {
      await compAnalysisAPI.estimateRepairs(leadId, analysisId, {
        finishLevel: manualBuilderLevel,
        description: aiDescription,
        sqft: sqft ?? undefined,
      });
      await refresh();
      setPickerOpen(false);
    } finally {
      setSubmitting(null);
    }
  };

  // ── Photo upload + AI analysis ─────────────────────────────────────────
  // Compress to max 1200px wide, 85% JPEG quality. Raw phone photos are 2-5MB
  // each; this brings them to ~150-300KB to stay within Anthropic limits.
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

  const addPhotos = (files: File[]) => {
    const remainingSlots = Math.max(0, BACKEND_PHOTO_LIMIT - selectedPhotos.length);
    const newFiles = files.slice(0, remainingSlots);
    const newThumbs: PhotoThumbnail[] = newFiles.map((f) => ({
      file: f,
      url: URL.createObjectURL(f),
      status: 'ready',
    }));
    setSelectedPhotos((prev) => [...prev, ...newFiles]);
    setPhotoThumbnails((prev) => [...prev, ...newThumbs]);
  };

  const removeSelectedPhoto = (idx: number) => {
    setSelectedPhotos((prev) => prev.filter((_, i) => i !== idx));
    setPhotoThumbnails((prev) => {
      URL.revokeObjectURL(prev[idx]?.url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handlePhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addPhotos(Array.from(e.target.files || []));
    e.target.value = '';
  };

  const handlePhotoDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addPhotos(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/')));
  };

  const toggleLeadPhoto = (photoId: string) => {
    setSelectedLeadPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else if (next.size < BACKEND_PHOTO_LIMIT) next.add(photoId);
      return next;
    });
  };

  const selectAllLeadPhotos = () => {
    if (selectedLeadPhotoIds.size === leadPhotos.length) {
      setSelectedLeadPhotoIds(new Set());
    } else {
      setSelectedLeadPhotoIds(new Set(leadPhotos.slice(0, BACKEND_PHOTO_LIMIT).map((p) => p.id)));
    }
  };

  const handleAnalyzeUploaded = async () => {
    if (!analysisId || selectedPhotos.length === 0) return;
    setSubmitting('analyze-uploaded');
    setPhotoThumbnails((prev) => prev.map((t) => ({ ...t, status: 'uploading' })));
    try {
      const compressed = await Promise.all(selectedPhotos.map(compressPhoto));
      const toSend = compressed.slice(0, BACKEND_PHOTO_LIMIT);
      const formData = new FormData();
      toSend.forEach((photo) => formData.append('photos', photo));
      // Persist originals to lead gallery in parallel - non-blocking.
      photosAPI.uploadMultiple(leadId, selectedPhotos).catch(() => {});
      await compAnalysisAPI.analyzePhotos(leadId, analysisId, formData);
      // Backend mirrors midpoint to Lead via DealMathService; refresh to pick it up.
      await refresh();
      setSelectedPhotos([]);
      setPhotoThumbnails((prev) => {
        prev.forEach((t) => URL.revokeObjectURL(t.url));
        return [];
      });
      setExpandUploadUI(false);
      setPickerOpen(false);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Unknown error';
      alert(`Photo analysis failed: ${msg}\n\nTry reducing to 10-15 photos if the issue persists.`);
      setPhotoThumbnails((prev) => prev.map((t) => ({ ...t, status: 'ready' })));
    } finally {
      setSubmitting(null);
    }
  };

  const handleAnalyzeLeadPhotos = async () => {
    if (!analysisId || selectedLeadPhotoIds.size === 0) return;
    setSubmitting('analyze-lead-photos');
    try {
      await compAnalysisAPI.analyzeLeadPhotos(leadId, analysisId, Array.from(selectedLeadPhotoIds));
      await refresh();
      setSelectedLeadPhotoIds(new Set());
      setExpandUploadUI(false);
      setPickerOpen(false);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Unknown error';
      alert(`Photo analysis failed: ${msg}`);
    } finally {
      setSubmitting(null);
    }
  };

  const provenanceLine = (() => {
    switch (state.repairMethod) {
      case 'PHOTO_ANALYSIS': {
        const meta = state.repairMetadata ?? {};
        const range = meta.rangeLow != null && meta.rangeHigh != null
          ? ` · range ${formatCurrency(meta.rangeLow as number)}-${formatCurrency(meta.rangeHigh as number)}`
          : '';
        const photos = meta.photosAnalyzed ? ` · ${meta.photosAnalyzed} photos` : '';
        return `Photo analysis${range}${photos}`;
      }
      case 'QUICK_SQFT': {
        const meta = state.repairMetadata ?? {};
        return `Quick estimate · ${meta.tier ?? ''} ($${meta.rate ?? '?'}/sqft)`;
      }
      case 'MANUAL_BUILDER': {
        const meta = state.repairMetadata ?? {};
        const count = (meta.items as string[] | undefined)?.length ?? 0;
        return `Manual builder · ${meta.finishLevel ?? 'flip'} · ${count} categories`;
      }
      case 'AI_TEXT':
        return 'AI text estimate';
      case 'MANUAL_OVERRIDE':
        return 'Manual override';
      default:
        return 'No estimate yet - pick a method';
    }
  })();

  return (
    <div className="space-y-6">
      {/* ── Strategy Selector ───────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Strategy</div>
            <select
              value={state.strategy ?? ''}
              onChange={(e) => handleStrategyChange((e.target.value || null) as DealMathStrategyKey | null)}
              disabled={submitting === 'strategy'}
              className="input text-base font-semibold"
            >
              <option value="">Select a strategy…</option>
              {STRATEGY_KEYS.map((k) => (
                <option key={k} value={k}>{STRATEGY_CONFIGS[k].label}</option>
              ))}
            </select>
            {config && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{config.tagline}</p>
            )}
          </div>
        </div>
      </div>

      {!state.strategy && (
        <div className="card text-center py-10">
          <p className="text-sm text-gray-500 dark:text-gray-400">Select a strategy to see deal math.</p>
        </div>
      )}

      {state.strategy && config && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── Inputs ───────────────────────────────────────────────────── */}
          <div className="space-y-4">
            {/* ARV */}
            <div className="card">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">ARV</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {state.arv != null ? formatCurrency(state.arv) : '-'}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {state.arv != null ? (
                      <>
                        {arvCalculationMode === 'AS_IS' ? 'AS-IS' : 'AI calculated'}
                        {state.arvConfidence != null ? ` · ${Math.round(state.arvConfidence)}% confidence` : ''}
                      </>
                    ) : (
                      'ARV not yet calculated'
                    )}
                  </div>
                </div>
                <Link
                  href={`/leads/${leadId}/comps-analysis?tab=valuation`}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap"
                >
                  ↗ Valuation
                </Link>
              </div>
            </div>

            {/* Repair Estimate */}
            <div className="card">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Repair Estimate</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {state.repairEstimate != null ? formatCurrency(state.repairEstimate) : '-'}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{provenanceLine}</div>
                </div>
                <button
                  onClick={() => setPickerOpen((v) => !v)}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap"
                >
                  {pickerOpen ? 'Close ▲' : (state.repairEstimate != null ? 'Adjust ▼' : 'Estimate ▼')}
                </button>
              </div>

              {state.latestPhotoAnalysis && (
                <button
                  onClick={() => setDrawerOpen((v) => !v)}
                  className="mt-3 text-xs text-purple-600 dark:text-purple-400 hover:underline"
                >
                  {drawerOpen ? '▼' : '▶'} View condition report
                </button>
              )}

              {pickerOpen && (
                <RepairMethodPicker
                  state={state}
                  sqft={sqft}
                  analysisId={analysisId}
                  leadPhotos={leadPhotos}
                  selectedPhotos={selectedPhotos}
                  photoThumbnails={photoThumbnails}
                  selectedLeadPhotoIds={selectedLeadPhotoIds}
                  isDragging={isDragging}
                  setIsDragging={setIsDragging}
                  expandUploadUI={expandUploadUI}
                  setExpandUploadUI={setExpandUploadUI}
                  onPhotoFileChange={handlePhotoFileChange}
                  onPhotoDrop={handlePhotoDrop}
                  onRemoveSelectedPhoto={removeSelectedPhoto}
                  onToggleLeadPhoto={toggleLeadPhoto}
                  onSelectAllLeadPhotos={selectAllLeadPhotos}
                  onAnalyzeUploaded={handleAnalyzeUploaded}
                  onAnalyzeLeadPhotos={handleAnalyzeLeadPhotos}
                  manualBuilderLevel={manualBuilderLevel}
                  setManualBuilderLevel={setManualBuilderLevel}
                  manualBuilderItems={manualBuilderItems}
                  setManualBuilderItems={setManualBuilderItems}
                  aiDescription={aiDescription}
                  setAiDescription={setAiDescription}
                  repairValueDraft={repairValueDraft}
                  setRepairValueDraft={setRepairValueDraft}
                  submitting={submitting}
                  onApplyLow={handleApplyPhotoLow}
                  onApplyHigh={handleApplyPhotoHigh}
                  onApplyMidpoint={handleApplyPhotoMidpoint}
                  onQuickSqft={handleQuickSqft}
                  onManualBuilder={handleManualBuilder}
                  onAiText={handleAiText}
                  onManualOverride={handleManualOverride}
                />
              )}
            </div>

            {/* Strategy-specific inputs */}
            <div className="card space-y-4">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{config.label} Inputs</div>
              {config.inputs.map((field) => (
                <StrategyInput
                  key={field.key}
                  field={field}
                  value={state.inputs[field.key] ?? field.default ?? ''}
                  disabled={submitting === `input-${field.key}`}
                  onChange={(v) => handleInputChange(field.key, v)}
                />
              ))}
            </div>
          </div>

          {/* ── Outputs ──────────────────────────────────────────────────── */}
          <div className="space-y-4">
            <div className="card space-y-3">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{config.label} Outputs</div>
              {config.outputs.map((card) => {
                const value = state.outputs[card.key] ?? null;
                const tone = card.emphasis === 'primary'
                  ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-950'
                  : card.emphasis === 'secondary'
                    ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950'
                    : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950';
                const valueClass = card.emphasis === 'primary'
                  ? 'text-primary-700 dark:text-primary-400'
                  : card.emphasis === 'secondary'
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-gray-800 dark:text-gray-200';
                return (
                  <div key={card.key} className={`rounded-xl border p-4 flex items-center justify-between ${tone}`}>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{card.label}</div>
                    <div className={`text-2xl font-bold ${valueClass}`}>{formatOutput(value, card.format)}</div>
                  </div>
                );
              })}
            </div>

            <SpreadCallout state={state} />
          </div>
        </div>
      )}

      {/* ── Condition Report Drawer ───────────────────────────────────── */}
      {state.latestPhotoAnalysis && (
        <div className="card">
          <button
            onClick={() => setDrawerOpen((v) => !v)}
            className="w-full flex items-center justify-between text-left"
          >
            <div>
              <div className="text-sm font-bold text-gray-700 dark:text-gray-300">Condition Report</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Photo analysis from {new Date(state.latestPhotoAnalysis.analyzedAt).toLocaleDateString()}
                {state.latestPhotoAnalysis.photosAnalyzed != null
                  ? ` · ${state.latestPhotoAnalysis.photosAnalyzed} photos`
                  : ''}
              </div>
            </div>
            <span className="text-gray-400">{drawerOpen ? '▲' : '▼'}</span>
          </button>
          {drawerOpen && (
            <div className="mt-4">
              <ConditionReportContent report={normalizeReport(state.latestPhotoAnalysis.resultJson)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function normalizeReport(raw: any): ParsedConditionReport {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as ParsedConditionReport;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

// ── StrategyInput ────────────────────────────────────────────────────────
function StrategyInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: StrategyInputField;
  value: number | string;
  disabled?: boolean;
  onChange: (v: number | string | null) => void;
}) {
  if (field.type === 'chip-group' && field.chips) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{field.label}</label>
        <div className="flex flex-wrap gap-2">
          {field.chips.map((chip) => {
            const active = Number(value) === chip.value;
            return (
              <button
                key={chip.value}
                onClick={() => onChange(chip.value)}
                disabled={disabled}
                className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                  active
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{field.label}</label>
      <input
        type={field.type === 'text' ? 'text' : 'number'}
        value={value === null || value === undefined ? '' : String(value)}
        placeholder={field.placeholder}
        disabled={disabled}
        onBlur={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(null);
          } else {
            const n = Number(raw);
            onChange(isFinite(n) ? n : raw);
          }
        }}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      />
      {field.helperText && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{field.helperText}</p>
      )}
    </div>
  );
}

// ── RepairMethodPicker ───────────────────────────────────────────────────
function RepairMethodPicker(props: {
  state: DealMathState;
  sqft: number | null;
  analysisId: string | null;
  leadPhotos: Array<{ id: string; url?: string; thumbnailUrl?: string; source?: string }>;
  selectedPhotos: File[];
  photoThumbnails: PhotoThumbnail[];
  selectedLeadPhotoIds: Set<string>;
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  expandUploadUI: boolean;
  setExpandUploadUI: (v: boolean) => void;
  onPhotoFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPhotoDrop: (e: React.DragEvent) => void;
  onRemoveSelectedPhoto: (idx: number) => void;
  onToggleLeadPhoto: (id: string) => void;
  onSelectAllLeadPhotos: () => void;
  onAnalyzeUploaded: () => void;
  onAnalyzeLeadPhotos: () => void;
  manualBuilderLevel: string;
  setManualBuilderLevel: (v: string) => void;
  manualBuilderItems: string[];
  setManualBuilderItems: (v: string[]) => void;
  aiDescription: string;
  setAiDescription: (v: string) => void;
  repairValueDraft: string;
  setRepairValueDraft: (v: string) => void;
  submitting: string | null;
  onApplyLow: () => void;
  onApplyHigh: () => void;
  onApplyMidpoint: () => void;
  onQuickSqft: (rate: number, label: string) => void;
  onManualBuilder: () => void;
  onAiText: () => void;
  onManualOverride: () => void;
}) {
  const {
    state, sqft, analysisId, submitting,
    leadPhotos, selectedPhotos, photoThumbnails, selectedLeadPhotoIds,
    isDragging, setIsDragging, expandUploadUI, setExpandUploadUI,
  } = props;
  const photo = state.latestPhotoAnalysis;
  const showUploadUI = !photo || expandUploadUI;
  const toggleItem = (item: string) => {
    if (props.manualBuilderItems.includes(item)) {
      props.setManualBuilderItems(props.manualBuilderItems.filter((i) => i !== item));
    } else {
      props.setManualBuilderItems([...props.manualBuilderItems, item]);
    }
  };

  return (
    <div className="mt-4 space-y-4 border-t border-gray-200 dark:border-gray-700 pt-4">
      {/* Photo analysis */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">Photo analysis</div>
          {photo && expandUploadUI && (
            <button
              onClick={() => setExpandUploadUI(false)}
              className="text-xs text-gray-500 dark:text-gray-400 hover:underline"
            >
              Cancel re-analyze
            </button>
          )}
        </div>

        {photo && !expandUploadUI && (
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Analyzed {new Date(photo.analyzedAt).toLocaleDateString()}
              {photo.photosAnalyzed != null ? ` · ${photo.photosAnalyzed} photos` : ''}
              {photo.rangeLow != null && photo.rangeHigh != null
                ? ` · ${formatCurrency(photo.rangeLow)}-${formatCurrency(photo.rangeHigh)}`
                : ''}
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {photo.midpoint != null && (
                <button
                  onClick={props.onApplyMidpoint}
                  disabled={submitting === 'photo-mid'}
                  className="btn btn-sm bg-primary-600 hover:bg-primary-700 text-white"
                >
                  Apply midpoint ({formatCurrency(photo.midpoint)})
                </button>
              )}
              {photo.rangeLow != null && (
                <button
                  onClick={props.onApplyLow}
                  disabled={submitting === 'photo-low'}
                  className="btn btn-sm"
                >
                  Apply low ({formatCurrency(photo.rangeLow)})
                </button>
              )}
              {photo.rangeHigh != null && (
                <button
                  onClick={props.onApplyHigh}
                  disabled={submitting === 'photo-high'}
                  className="btn btn-sm"
                >
                  Apply high ({formatCurrency(photo.rangeHigh)})
                </button>
              )}
            </div>
            <button
              onClick={() => setExpandUploadUI(true)}
              className="text-xs text-purple-600 dark:text-purple-400 hover:underline"
            >
              Re-analyze with new photos
            </button>
          </div>
        )}

        {showUploadUI && (
          <div className="space-y-3">
            {!analysisId && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Need a comp analysis to use photo analysis. Open the Valuation tab and pull comps first.
              </p>
            )}

            {/* Drag-and-drop / file picker */}
            <label
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={props.onPhotoDrop}
              className={`block rounded-xl border-2 border-dashed p-5 text-center cursor-pointer transition-colors ${
                isDragging
                  ? 'border-purple-400 bg-purple-50 dark:bg-purple-950'
                  : 'border-gray-300 dark:border-gray-600 hover:border-purple-300'
              } ${!analysisId ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={props.onPhotoFileChange}
                disabled={!analysisId}
                className="hidden"
              />
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Drop photos here or click to choose. Up to {BACKEND_PHOTO_LIMIT} per analysis.
              </div>
              {selectedPhotos.length > 0 && (
                <div className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                  {selectedPhotos.length} selected
                </div>
              )}
            </label>

            {/* Selected upload thumbnails */}
            {photoThumbnails.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {photoThumbnails.map((t, i) => (
                  <div
                    key={t.url}
                    className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 group"
                  >
                    <img src={t.url} alt="" className="w-full h-full object-cover" />
                    {t.status === 'uploading' && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      </div>
                    )}
                    <button
                      onClick={(e) => { e.preventDefault(); props.onRemoveSelectedPhoto(i); }}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs items-center justify-center hidden group-hover:flex"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}

            {selectedPhotos.length > 0 && (
              <button
                onClick={props.onAnalyzeUploaded}
                disabled={!analysisId || submitting === 'analyze-uploaded'}
                className="btn btn-sm bg-purple-600 hover:bg-purple-700 text-white w-full"
              >
                {submitting === 'analyze-uploaded' ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    Analyzing {Math.min(selectedPhotos.length, BACKEND_PHOTO_LIMIT)} photo{Math.min(selectedPhotos.length, BACKEND_PHOTO_LIMIT) !== 1 ? 's' : ''} with AI...
                  </span>
                ) : (
                  `Analyze ${Math.min(selectedPhotos.length, BACKEND_PHOTO_LIMIT)} uploaded photo${Math.min(selectedPhotos.length, BACKEND_PHOTO_LIMIT) !== 1 ? 's' : ''} with AI`
                )}
              </button>
            )}

            {/* Existing lead photos (MLS, seller portal, MMS, streetview) */}
            {leadPhotos.length > 0 && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    Or select from property photos ({leadPhotos.length})
                  </div>
                  <button
                    onClick={props.onSelectAllLeadPhotos}
                    className="text-xs text-purple-600 hover:text-purple-800 font-medium"
                  >
                    {selectedLeadPhotoIds.size === leadPhotos.length ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {leadPhotos.map((p) => {
                    const isSelected = selectedLeadPhotoIds.has(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => props.onToggleLeadPhoto(p.id)}
                        className={`relative w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                          isSelected
                            ? 'border-purple-500 ring-2 ring-purple-300'
                            : 'border-gray-200 dark:border-gray-600 hover:border-purple-300'
                        }`}
                      >
                        <img
                          src={p.thumbnailUrl || p.url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                        {isSelected && (
                          <div className="absolute inset-0 bg-purple-500/20 flex items-center justify-center">
                            <span className="text-white text-xs font-bold bg-purple-600 rounded-full w-5 h-5 flex items-center justify-center">✓</span>
                          </div>
                        )}
                        {p.source && (
                          <span className="absolute bottom-0 left-0 right-0 text-[9px] text-center bg-black/50 text-white py-0.5 truncate">
                            {p.source === 'seller-portal' ? 'Seller'
                              : p.source === 'seller-mms' ? 'MMS'
                                : p.source === 'streetview' ? 'Street'
                                  : p.source}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {selectedLeadPhotoIds.size > 0 && (
                  <button
                    onClick={props.onAnalyzeLeadPhotos}
                    disabled={!analysisId || submitting === 'analyze-lead-photos'}
                    className="btn btn-sm bg-purple-600 hover:bg-purple-700 text-white w-full mt-3"
                  >
                    {submitting === 'analyze-lead-photos' ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        Analyzing {selectedLeadPhotoIds.size} property photo{selectedLeadPhotoIds.size !== 1 ? 's' : ''} with AI...
                      </span>
                    ) : (
                      `Analyze ${selectedLeadPhotoIds.size} property photo${selectedLeadPhotoIds.size !== 1 ? 's' : ''} with AI`
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick sqft */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Quick estimate by sqft</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          {sqft ? `${sqft.toLocaleString()} sqft` : 'No sqft on file'}
        </div>
        <div className="flex gap-2">
          {[
            { label: 'Light', rate: 20 },
            { label: 'Moderate', rate: 50 },
            { label: 'Heavy', rate: 100 },
          ].map((opt) => (
            <button
              key={opt.rate}
              onClick={() => props.onQuickSqft(opt.rate, opt.label.toUpperCase())}
              disabled={!sqft || submitting === 'quick-sqft'}
              className="btn btn-sm flex-1"
            >
              {opt.label} · ${opt.rate}/sqft
            </button>
          ))}
        </div>
      </div>

      {/* Manual builder */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Manual builder</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Finish Level</label>
            <select
              value={props.manualBuilderLevel}
              onChange={(e) => props.setManualBuilderLevel(e.target.value)}
              className="input"
            >
              <option value="budget">Budget Grade</option>
              <option value="flip">Flip Grade</option>
              <option value="high-end">High-End Grade</option>
            </select>
          </div>
        </div>
        <div className="mt-3">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Categories</label>
          <div className="flex flex-wrap gap-1.5">
            {REPAIR_ITEMS.map((item) => {
              const on = props.manualBuilderItems.includes(item);
              return (
                <button
                  key={item}
                  onClick={() => toggleItem(item)}
                  className={`px-2 py-1 rounded text-xs border ${
                    on
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </div>
        </div>
        <button
          onClick={props.onManualBuilder}
          disabled={!analysisId || submitting === 'manual-builder' || props.manualBuilderItems.length === 0}
          className="mt-3 btn btn-primary btn-sm"
        >
          {submitting === 'manual-builder' ? 'Estimating…' : 'Estimate'}
        </button>
        {!analysisId && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Need a comp analysis to use this method.</p>
        )}
      </div>

      {/* AI text */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Describe repairs (AI estimate)</div>
        <textarea
          value={props.aiDescription}
          onChange={(e) => props.setAiDescription(e.target.value)}
          placeholder="Describe what repairs are needed..."
          className="input w-full"
          rows={3}
        />
        <button
          onClick={props.onAiText}
          disabled={!analysisId || !props.aiDescription.trim() || submitting === 'ai-text'}
          className="mt-2 btn btn-primary btn-sm"
        >
          {submitting === 'ai-text' ? 'Estimating…' : 'Estimate from description'}
        </button>
      </div>

      {/* Manual override */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Manual override</div>
        <div className="flex gap-2">
          <input
            type="number"
            value={props.repairValueDraft}
            onChange={(e) => props.setRepairValueDraft(e.target.value)}
            placeholder="Enter dollar amount"
            className="input flex-1"
          />
          <button
            onClick={props.onManualOverride}
            disabled={submitting === 'repair-override'}
            className="btn btn-primary btn-sm whitespace-nowrap"
          >
            {submitting === 'repair-override' ? 'Saving…' : 'Set value'}
          </button>
        </div>
        {state.repairMethod === 'MANUAL_OVERRIDE' && photo && (
          <button
            onClick={props.onApplyMidpoint}
            className="mt-2 text-xs text-primary-600 hover:underline"
          >
            ↩ Revert to photo analysis ({photo.midpoint != null ? formatCurrency(photo.midpoint) : 'midpoint'})
          </button>
        )}
      </div>
    </div>
  );
}

// ── SpreadCallout ────────────────────────────────────────────────────────
function SpreadCallout({ state }: { state: DealMathState }) {
  if (!state.strategy) return null;

  // Strategy-aware sanity band. Mirrors the per-strategy spreadCallout in
  // strategy-config.ts on the backend so users see consistent guidance.
  const arv = state.arv;
  const asking = state.askingPrice;
  const mao = state.outputs.mao;
  const netToSeller = state.outputs.estimatedNetToSeller;
  const roi = state.outputs.roiPercent;
  const profit = state.outputs.estimatedProfit;
  const cap = state.outputs.capRate;

  let tone: 'good' | 'warn' | 'bad' | null = null;
  let message: string | null = null;

  switch (state.strategy) {
    case 'wholesale':
    case 'jv':
    case 'double_close': {
      if (mao != null && asking != null && arv != null) {
        const askingPctOfArv = ((asking / arv) * 100).toFixed(0);
        if (asking <= mao) {
          tone = 'good';
          message = `Asking is ${askingPctOfArv}% of ARV - Below MAO!`;
        } else {
          tone = 'bad';
          message = `Asking is ${askingPctOfArv}% of ARV - Above MAO by ${formatCurrency(asking - mao)}`;
        }
      }
      break;
    }
    case 'novation':
    case 'concierge_listing': {
      if (netToSeller != null && asking != null) {
        const delta = netToSeller - asking;
        tone = delta >= 0 ? 'good' : 'warn';
        message = delta >= 0
          ? `Net to seller ${formatCurrency(delta)} above asking`
          : `Net to seller ${formatCurrency(Math.abs(delta))} below asking`;
      }
      break;
    }
    case 'fix_flip': {
      const target = (state.inputs.targetProfitPercent as number) ?? 20;
      if (roi != null) {
        if (roi >= target) {
          tone = 'good';
          message = `ROI ${Math.round(roi)}% over hold meets target (${target}%)`;
        } else {
          tone = 'warn';
          message = `ROI ${Math.round(roi)}% - below ${target}% target`;
        }
      }
      break;
    }
    case 'sub_to':
    case 'other': {
      if (profit != null) {
        tone = profit > 0 ? 'good' : 'bad';
        message = profit > 0
          ? `Projected profit ${formatCurrency(profit)}`
          : 'Projects a loss - review costs and exit price';
      }
      break;
    }
    case 'hold_rental': {
      const target = (state.inputs.targetCapRate as number) ?? 7;
      if (cap != null) {
        if (cap >= target) {
          tone = 'good';
          message = `Cap rate ${cap.toFixed(1)}% meets ${target}% target`;
        } else {
          tone = 'warn';
          message = `Cap rate ${cap.toFixed(1)}% - below ${target}% target`;
        }
      }
      break;
    }
  }

  if (!message) return null;

  const toneClasses = tone === 'good'
    ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-800 dark:text-green-400'
    : tone === 'bad'
      ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-800 dark:text-red-400'
      : 'bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-400';

  return <div className={`card border ${toneClasses}`}>{message}</div>;
}
