'use client';

import React, { useState } from 'react';
import { dispositionAPI } from '@/lib/api';
import { DispoSummaryV2 } from '../types';
import { fmtCurrency, fmtDate, numOrNull } from '../utils';

interface Props {
  leadId: string;
  summary: DispoSummaryV2;
  onChanged: () => Promise<void> | void;
}

// Section D: record the actual closing sale. Visible only when the lead is
// at or beyond ACQUIRED — the deal must have reached the user's books for
// a sale to be meaningful.
export default function FinalSaleSection({ leadId, summary, onChanged }: Props) {
  const sale = summary.finalSale;
  const [buyerName, setBuyerName] = useState(sale?.buyerName ?? '');
  const [finalSalePrice, setFinalSalePrice] = useState(sale?.finalSalePrice != null ? String(sale.finalSalePrice) : '');
  const [saleClosingCosts, setSaleClosingCosts] = useState(sale?.saleClosingCosts != null ? String(sale.saleClosingCosts) : '');
  const [closedAt, setClosedAt] = useState(sale?.closedAt ? sale.closedAt.slice(0, 10) : '');
  const [notes, setNotes] = useState(sale?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [marking, setMarking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    const price = numOrNull(finalSalePrice);
    if (price == null || price < 0) {
      setErr('Sale price is required');
      return;
    }
    if (!closedAt) {
      setErr('Close date is required');
      return;
    }
    setSaving(true);
    try {
      await dispositionAPI.upsertFinalSale(leadId, {
        buyerName: buyerName || null,
        finalSalePrice: price,
        saleClosingCosts: numOrNull(saleClosingCosts),
        closedAt,
        notes: notes || null,
      });
      await onChanged();
    } catch (e: any) {
      setErr(e.response?.data?.message || 'Failed to save final sale');
    } finally {
      setSaving(false);
    }
  };

  const markSold = async () => {
    setMarking(true);
    try {
      await dispositionAPI.markSold(leadId);
      await onChanged();
    } catch (e: any) {
      setErr(e.response?.data?.message || 'Failed to mark sold');
    } finally {
      setMarking(false);
    }
  };

  const canMarkSold = !!sale && (
    summary.contract?.contractStatus === 'signed' ||
    summary.acquiredDate != null ||
    summary.dispositionPlan?.exitStrategy === 'wholesale'
  );

  return (
    <section className="mb-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white">Final Sale</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {sale ? `Closed ${fmtDate(sale.closedAt)}` : 'Not yet closed'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block text-sm">
          <span className="text-gray-600 dark:text-gray-400">Buyer Name</span>
          <input
            type="text"
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          />
        </label>

        <label className="block text-sm">
          <span className="text-gray-600 dark:text-gray-400">Final Sale Price *</span>
          <input
            type="number"
            value={finalSalePrice}
            onChange={(e) => setFinalSalePrice(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          />
        </label>

        <label className="block text-sm">
          <span className="text-gray-600 dark:text-gray-400">Sale Closing Costs</span>
          <input
            type="number"
            value={saleClosingCosts}
            onChange={(e) => setSaleClosingCosts(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          />
        </label>

        <label className="block text-sm">
          <span className="text-gray-600 dark:text-gray-400">Close Date *</span>
          <input
            type="date"
            value={closedAt}
            onChange={(e) => setClosedAt(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          />
        </label>
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

      {sale && (
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-500">
          Currently saved: <strong>{fmtCurrency(sale.finalSalePrice)}</strong>
          {sale.saleClosingCosts != null && <> · closing {fmtCurrency(sale.saleClosingCosts)}</>}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
        >
          {saving ? 'Saving…' : sale ? 'Update Sale' : 'Save Sale'}
        </button>
        {canMarkSold && summary.profit?.bucket !== 'realized' && (
          <button
            type="button"
            onClick={markSold}
            disabled={marking}
            className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50"
          >
            {marking ? 'Marking…' : 'Mark Sold'}
          </button>
        )}
      </div>
    </section>
  );
}
