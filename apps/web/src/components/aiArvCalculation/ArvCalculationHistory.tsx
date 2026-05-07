'use client';

import { useState } from 'react';
import type { AIArvCalculationResult } from '@/lib/aiArvCalculation/types';

interface Props {
  history: AIArvCalculationResult[];
  loading?: boolean;
}

export default function ArvCalculationHistory({ history, loading }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading) {
    return <p className="text-sm text-gray-500">Loading history…</p>;
  }
  if (history.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No prior calculations for this lead.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-gray-200 dark:divide-gray-700">
      {history.map((row) => {
        const isOpen = expanded === row.inputHash;
        return (
          <li key={row.inputHash + row.computedAt} className="py-2">
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : row.inputHash)}
              className="w-full flex items-center justify-between gap-3 text-left"
            >
              <div className="text-sm">
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  ${Math.round(row.arv).toLocaleString()}
                </span>
                <span className="ml-2 text-[11px] text-gray-500">
                  {row.confidence}% ({row.confidenceLabel.toLowerCase()}) ·{' '}
                  {row.mode === 'AS_IS' ? 'As-is' : 'ARV'} · {row.stats.compsUsed}{' '}
                  comps
                </span>
              </div>
              <div className="text-[11px] text-gray-500">
                {formatDate(row.computedAt)} · {isOpen ? '▾' : '▸'}
              </div>
            </button>
            {isOpen && (
              <div className="mt-2 pl-3 border-l-2 border-gray-200 dark:border-gray-700 text-[12px] text-gray-700 dark:text-gray-300 space-y-1">
                <div>
                  Range: ${Math.round(row.arvLow).toLocaleString()} – $
                  {Math.round(row.arvHigh).toLocaleString()} | $
                  {Math.round(row.pricePerSqft).toLocaleString()}/sqft
                </div>
                <div>{row.valuationMethod}</div>
                <div className="text-[11px] text-gray-500">
                  Model: {row.modelUsed} · prompt {row.promptVersion} · hash{' '}
                  {row.inputHash.slice(0, 8)}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
