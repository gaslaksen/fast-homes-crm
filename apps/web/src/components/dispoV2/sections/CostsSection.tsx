'use client';

import React, { useState } from 'react';
import { dispositionAPI } from '@/lib/api';
import { COST_CATEGORY_LABELS, DispoSummaryV2, DispositionCost, DispositionCostCategory } from '../types';
import { fmtCurrency, fmtDate, numOrNull } from '../utils';

interface Props {
  leadId: string;
  summary: DispoSummaryV2;
  onChanged: () => Promise<void> | void;
}

const TODAY = () => new Date().toISOString().slice(0, 10);

// Section C: line-item disposition costs. Visible only after the lead is
// under contract — costs incurred before acquisition are tracked separately
// (acquisition closing costs live on Section A's Contract block).
export default function CostsSection({ leadId, summary, onChanged }: Props) {
  const [showAdd, setShowAdd] = useState(summary.costs.length === 0);
  const [category, setCategory] = useState<DispositionCostCategory>('holding');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [incurredAt, setIncurredAt] = useState<string>(TODAY());
  const [paidTo, setPaidTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const resetForm = () => {
    setCategory('holding');
    setDescription('');
    setAmount('');
    setIncurredAt(TODAY());
    setPaidTo('');
    setErr(null);
  };

  const add = async () => {
    setErr(null);
    const amt = numOrNull(amount);
    if (amt == null || amt <= 0) {
      setErr('Amount must be greater than zero');
      return;
    }
    setSaving(true);
    try {
      await dispositionAPI.createCost(leadId, {
        category,
        description: description || null,
        amount: amt,
        incurredAt: incurredAt || null,
        paidTo: paidTo || null,
      });
      resetForm();
      setShowAdd(false);
      await onChanged();
    } catch (e: any) {
      setErr(e.response?.data?.message || 'Failed to add cost');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Remove this cost?')) return;
    try {
      await dispositionAPI.deleteCost(leadId, id);
      await onChanged();
    } catch {
      // ignore
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white">
          Disposition Costs
          {summary.costs.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-500">
              ({summary.costs.length} item{summary.costs.length === 1 ? '' : 's'})
            </span>
          )}
        </h3>
        <div className="text-right">
          <div className="text-xs text-gray-500 dark:text-gray-400">Total</div>
          <div className="text-lg font-bold text-gray-900 dark:text-white">{fmtCurrency(summary.costsTotal)}</div>
        </div>
      </div>

      {summary.costs.length > 0 && (
        <table className="w-full text-sm mb-3">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 text-left">
              <th className="px-2 py-2 font-medium text-gray-500 dark:text-gray-400 text-xs uppercase">Category</th>
              <th className="px-2 py-2 font-medium text-gray-500 dark:text-gray-400 text-xs uppercase">Description</th>
              <th className="px-2 py-2 font-medium text-gray-500 dark:text-gray-400 text-xs uppercase text-right">Amount</th>
              <th className="px-2 py-2 font-medium text-gray-500 dark:text-gray-400 text-xs uppercase">Date</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {summary.costs.map((c: DispositionCost) => (
              <tr key={c.id} className="border-b border-gray-50 dark:border-gray-800/50">
                <td className="px-2 py-2 text-gray-700 dark:text-gray-300">
                  {COST_CATEGORY_LABELS[c.category] ?? c.category}
                </td>
                <td className="px-2 py-2 text-gray-600 dark:text-gray-400">{c.description || '—'}</td>
                <td className="px-2 py-2 text-right font-mono text-gray-900 dark:text-white">{fmtCurrency(c.amount)}</td>
                <td className="px-2 py-2 text-gray-500 dark:text-gray-500 text-xs">{fmtDate(c.incurredAt)}</td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-3 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as DispositionCostCategory)}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              {Object.entries(COST_CATEGORY_LABELS).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
            <input
              type="number"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
            <input
              type="date"
              value={incurredAt}
              onChange={(e) => setIncurredAt(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </div>
          <input
            type="text"
            placeholder="Paid to (optional)"
            value={paidTo}
            onChange={(e) => setPaidTo(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          />
          {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={add}
              disabled={saving}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add Cost'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAdd(false); resetForm(); }}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          + Add cost
        </button>
      )}
    </section>
  );
}
