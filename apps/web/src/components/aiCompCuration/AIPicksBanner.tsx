'use client';

import { useState } from 'react';
import type { CurationResult } from '@/lib/aiCompCuration/types';
import CurationExpansionNarrative from './CurationExpansionNarrative';

interface Props {
  result: CurationResult;
  pickedCount: number;
  totalCount: number;
  cachedAtMs: number | null;
  onRePick: () => void;
  picking: boolean;
}

// The single AI status surface in the new layout — replaces the older
// separate SummaryHeader + MarketObservations + ExpansionNarrative
// stack. Brief summary always visible; "Show details" expands to the
// full narrative + observations + expansion path.
export default function AIPicksBanner({
  result,
  pickedCount,
  totalCount,
  cachedAtMs,
  onRePick,
  picking,
}: Props) {
  const [open, setOpen] = useState(false);
  const isArv = result.valuationMode === 'ARV_RENOVATED';
  const expanded = result.searchExpansion.expansionPath.length > 1;

  return (
    <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-900/15 px-3.5 py-2.5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="text-emerald-600 dark:text-emerald-400">
              ✨
            </span>
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
              AI picked {pickedCount} of {totalCount} comps
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                isArv
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                  : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
              }`}
            >
              {isArv ? 'ARV' : 'As-Is'}
            </span>
            {cachedAtMs && (
              <span className="text-[10px] text-gray-500 dark:text-gray-500">
                · {humanAge(cachedAtMs)}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-700 dark:text-gray-300 leading-snug">
            {summaryPreview(result.summary, open)}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={onRePick}
            disabled={picking}
            className="text-xs px-2.5 py-1 rounded bg-white dark:bg-gray-900 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 disabled:opacity-50"
          >
            {picking ? 'Picking…' : 'Re-pick'}
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 inline-flex items-center gap-1"
            aria-expanded={open}
          >
            {open ? 'Hide details' : 'Show details'}
            <span
              aria-hidden
              className="inline-block transition-transform"
              style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              ▾
            </span>
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-900/60 space-y-3">
          {/* Full summary if it was truncated */}
          {result.summary.length > 200 && (
            <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
              {result.summary}
            </p>
          )}

          {expanded && <CurationExpansionNarrative expansion={result.searchExpansion} />}

          {result.marketObservations.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 mb-1">
                Market observations
              </div>
              <ul className="text-xs text-gray-700 dark:text-gray-300 list-disc pl-5 space-y-0.5">
                {result.marketObservations.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          )}

          {(result.excludedDueToTypeMismatch.length > 0 ||
            result.excludedDueToConstraints.length > 0) && (
            <div className="text-[11px] text-gray-600 dark:text-gray-400">
              <span className="font-medium">Pre-AI exclusions:</span>{' '}
              {result.excludedDueToTypeMismatch.length} type-mismatch ·{' '}
              {result.excludedDueToConstraints.length} constraint
            </div>
          )}

          <div className="text-[10px] text-gray-500 dark:text-gray-500">
            {result.modelMetadata.model} ·{' '}
            {Math.round(result.modelMetadata.latencyMs / 1000)}s ·{' '}
            {result.modelMetadata.tokensUsed.input.toLocaleString()} in /{' '}
            {result.modelMetadata.tokensUsed.output.toLocaleString()} out tokens
          </div>
        </div>
      )}
    </div>
  );
}

function summaryPreview(text: string, expanded: boolean): string {
  if (expanded) return '';
  if (text.length <= 200) return text;
  return `${text.slice(0, 200).trimEnd()}…`;
}

function humanAge(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
