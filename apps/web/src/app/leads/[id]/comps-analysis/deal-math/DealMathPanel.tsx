'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { dealMathAPI, compAnalysisAPI } from '@/lib/api';
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
}

const REPAIR_ITEMS = [
  'Full gut', 'Roof', 'Kitchen', 'Bathrooms', 'Windows', 'Landscaping',
  'Exterior Painting', 'Drywall', 'Interior painting', 'Flooring', 'Driveway', 'HVAC',
];

export default function DealMathPanel({ leadId, analysisId, sqft, arvCalculationMode }: Props) {
  const [state, setState] = useState<DealMathState | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [repairValueDraft, setRepairValueDraft] = useState<string>('');
  const [manualBuilderLevel, setManualBuilderLevel] = useState('flip');
  const [manualBuilderItems, setManualBuilderItems] = useState<string[]>([]);
  const [aiDescription, setAiDescription] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);

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

  const provenanceLine = (() => {
    switch (state.repairMethod) {
      case 'PHOTO_ANALYSIS': {
        const meta = state.repairMetadata ?? {};
        const range = meta.rangeLow != null && meta.rangeHigh != null
          ? ` · range ${formatCurrency(meta.rangeLow as number)}–${formatCurrency(meta.rangeHigh as number)}`
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
        return 'No estimate yet — pick a method';
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
                    {state.arv != null ? formatCurrency(state.arv) : '—'}
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
                    {state.repairEstimate != null ? formatCurrency(state.repairEstimate) : '—'}
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
  const { state, sqft, analysisId, submitting } = props;
  const photo = state.latestPhotoAnalysis;
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
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Photo analysis</div>
        {photo ? (
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Analyzed {new Date(photo.analyzedAt).toLocaleDateString()}
              {photo.photosAnalyzed != null ? ` · ${photo.photosAnalyzed} photos` : ''}
              {photo.rangeLow != null && photo.rangeHigh != null
                ? ` · ${formatCurrency(photo.rangeLow)}–${formatCurrency(photo.rangeHigh)}`
                : ''}
            </div>
            <div className="flex flex-wrap gap-2">
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
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            No photo analysis yet. Run one on the Valuation tab to generate a condition-based estimate.
          </p>
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
          message = `Asking is ${askingPctOfArv}% of ARV — Below MAO!`;
        } else {
          tone = 'bad';
          message = `Asking is ${askingPctOfArv}% of ARV — Above MAO by ${formatCurrency(asking - mao)}`;
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
          message = `ROI ${Math.round(roi)}% — below ${target}% target`;
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
          : 'Projects a loss — review costs and exit price';
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
          message = `Cap rate ${cap.toFixed(1)}% — below ${target}% target`;
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
