'use client';

import React, { useEffect, useState } from 'react';
import { dispositionAPI, partnersAPI } from '@/lib/api';
import { DispoSummaryV2, EXIT_STRATEGY_LABELS, ExitStrategy, JvSplitMode } from '../types';
import { fmtCurrency, numOrNull } from '../utils';

interface Props {
  leadId: string;
  summary: DispoSummaryV2;
  onChanged: () => Promise<void> | void;
}

interface PartnerOption {
  id: string;
  name: string;
  type: string;
}

// Section B: intended/actual exit strategy + target sale price + JV setup.
// Always visible. Updates target sale price (the source of truth for
// sale-side profit math, replacing the old "ARV doubles as sale price"
// behavior that drove bug #3).
export default function DispositionPlanSection({ leadId, summary, onChanged }: Props) {
  const plan = summary.dispositionPlan;
  const [exitStrategy, setExitStrategy] = useState<ExitStrategy>((plan?.exitStrategy as ExitStrategy) ?? 'wholesale');
  const [targetSalePrice, setTargetSalePrice] = useState(plan?.targetSalePrice != null ? String(plan.targetSalePrice) : '');
  const [targetCloseDate, setTargetCloseDate] = useState(plan?.targetCloseDate ? plan.targetCloseDate.slice(0, 10) : '');
  const [jvPartnerId, setJvPartnerId] = useState<string>(plan?.jvPartnerId ?? '');
  const [jvSplitMode, setJvSplitMode] = useState<JvSplitMode>((plan?.jvSplitMode as JvSplitMode) ?? 'none');
  const [jvSplitPercent, setJvSplitPercent] = useState(plan?.jvSplitPercent != null ? String(plan.jvSplitPercent) : '50');
  const [notes, setNotes] = useState(plan?.notes ?? '');
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load JV-eligible partners once for the picker. Filtered to type='jv';
  // user can also pick from buyer/other if they expand the filter.
  useEffect(() => {
    let alive = true;
    partnersAPI.list({ type: 'jv' }).then(({ data }) => {
      if (alive) setPartners((data?.partners ?? []).map((p: any) => ({ id: p.id, name: p.name, type: p.type })));
    }).catch(() => { /* non-fatal */ });
    return () => { alive = false; };
  }, []);

  // When the user toggles JV split mode, default the percent to 50 the
  // first time they switch to 'custom' so the field isn't blank.
  useEffect(() => {
    if (jvSplitMode === 'custom' && !jvSplitPercent) setJvSplitPercent('50');
    if (jvSplitMode === 'none') {
      setJvPartnerId('');
    }
  }, [jvSplitMode]);

  const save = async () => {
    setErr(null);
    setSaving(true);
    try {
      const percent = jvSplitMode === 'custom' ? numOrNull(jvSplitPercent) : null;
      if (jvSplitMode === 'custom' && (percent == null || percent < 0 || percent > 100)) {
        throw new Error('Custom JV split needs a percent between 0 and 100');
      }
      if (jvSplitMode !== 'none' && !jvPartnerId) {
        throw new Error('Select a JV partner');
      }
      await dispositionAPI.upsertPlan(leadId, {
        exitStrategy,
        targetSalePrice: numOrNull(targetSalePrice),
        targetCloseDate: targetCloseDate || null,
        jvPartnerId: jvSplitMode === 'none' ? null : (jvPartnerId || null),
        jvSplitMode,
        jvSplitPercent: percent,
        notes: notes || null,
      });
      await onChanged();
    } catch (e: any) {
      setErr(e.response?.data?.message || e.message || 'Failed to save plan');
    } finally {
      setSaving(false);
    }
  };

  const targetDiffersFromArv =
    summary.arv != null && targetSalePrice !== '' &&
    Math.abs(numOrNull(targetSalePrice)! - summary.arv) > 1;

  return (
    <section className="mb-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white">Disposition Plan</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {plan ? 'Saved' : 'Not yet set'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block text-sm">
          <span className="text-gray-600 dark:text-gray-400">Exit Strategy</span>
          <select
            value={exitStrategy}
            onChange={(e) => setExitStrategy(e.target.value as ExitStrategy)}
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          >
            {Object.entries(EXIT_STRATEGY_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </label>

        <div>
          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              Target Sale Price <span className="text-gray-400">(profit math uses this — not ARV)</span>
            </span>
            <input
              type="number"
              value={targetSalePrice}
              onChange={(e) => setTargetSalePrice(e.target.value)}
              placeholder={summary.arv != null ? String(summary.arv) : ''}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </label>
          <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            ARV reference: <strong>{fmtCurrency(summary.arv)}</strong>
            {targetDiffersFromArv && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">⚠ Differs from ARV</span>
            )}
          </div>
        </div>

        <label className="block text-sm">
          <span className="text-gray-600 dark:text-gray-400">Target Close Date</span>
          <input
            type="date"
            value={targetCloseDate}
            onChange={(e) => setTargetCloseDate(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          />
        </label>

        <label className="block text-sm">
          <span className="text-gray-600 dark:text-gray-400">JV Split Mode</span>
          <select
            value={jvSplitMode}
            onChange={(e) => setJvSplitMode(e.target.value as JvSplitMode)}
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          >
            <option value="none">No JV</option>
            <option value="fifty_fifty">50 / 50</option>
            <option value="custom">Custom %</option>
          </select>
        </label>

        {jvSplitMode !== 'none' && (
          <>
            <label className="block text-sm">
              <span className="text-gray-600 dark:text-gray-400">JV Partner</span>
              <select
                value={jvPartnerId}
                onChange={(e) => setJvPartnerId(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="">Select partner…</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>

            {jvSplitMode === 'custom' && (
              <label className="block text-sm">
                <span className="text-gray-600 dark:text-gray-400">Your share (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={jvSplitPercent}
                  onChange={(e) => setJvSplitPercent(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </label>
            )}
          </>
        )}
      </div>

      <label className="block text-sm mt-4">
        <span className="text-gray-600 dark:text-gray-400">Notes</span>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
        />
      </label>

      {err && <div className="mt-3 text-sm text-red-600 dark:text-red-400">{err}</div>}

      <div className="mt-4">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
        >
          {saving ? 'Saving…' : plan ? 'Update Plan' : 'Save Plan'}
        </button>
      </div>
    </section>
  );
}

