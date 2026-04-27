'use client';

import React, { useState } from 'react';
import { DispoSummaryV2 } from '../types';
import { fmtSignedCurrency, profitBucketBadge, profitBucketLabel } from '../utils';

interface Props {
  summary: DispoSummaryV2;
}

// Always-visible profit banner. Sticky at the top of the Disposition tab
// content so it stays in view while the user scrolls between sections.
export default function ProfitSummarySticky({ summary }: Props) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const { profit } = summary;
  const badgeCls = profitBucketBadge(profit?.bucket, profit?.ourShare ?? null);
  const isJv = !!summary.dispositionPlan?.jvSplitMode && summary.dispositionPlan.jvSplitMode !== 'none';

  return (
    <div className="sticky top-0 z-20 -mx-4 px-4 py-3 mb-4 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${badgeCls}`}>
            {profitBucketLabel(profit?.bucket)}
          </span>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Your profit</div>
            <div className="text-xl font-bold text-gray-900 dark:text-white">
              {fmtSignedCurrency(profit?.ourShare ?? null)}
            </div>
          </div>
          {isJv && (
            <div className="border-l border-gray-200 dark:border-gray-800 pl-3">
              <div className="text-xs text-gray-500 dark:text-gray-400">JV partner share</div>
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {fmtSignedCurrency(profit?.jvShare ?? null)}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowBreakdown((v) => !v)}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          {showBreakdown ? 'Hide breakdown' : 'Show breakdown'}
        </button>
      </div>
      {showBreakdown && (
        <div className="mt-3 text-xs text-gray-600 dark:text-gray-400 space-y-1">
          <div><span className="font-mono">{profit?.formulaUsed || '—'}</span></div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Gross: <strong className="text-gray-900 dark:text-white">{fmtSignedCurrency(profit?.gross ?? null)}</strong></span>
            <span>Acquisition: <strong className="text-gray-900 dark:text-white">{fmtSignedCurrency(summary.offerAmount)}</strong></span>
            <span>Costs total: <strong className="text-gray-900 dark:text-white">{fmtSignedCurrency(summary.costsTotal)}</strong></span>
            {summary.targetSalePrice != null && (
              <span>Target sale: <strong className="text-gray-900 dark:text-white">{fmtSignedCurrency(summary.targetSalePrice)}</strong></span>
            )}
            {summary.finalSale && (
              <span>Final sale: <strong className="text-gray-900 dark:text-white">{fmtSignedCurrency(summary.finalSale.finalSalePrice)}</strong></span>
            )}
          </div>
          {profit?.warnings?.length > 0 && (
            <div className="text-amber-700 dark:text-amber-400">
              {profit.warnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
