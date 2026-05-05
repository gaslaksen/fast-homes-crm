'use client';

import type { SearchExpansion } from '@/lib/aiCompCuration/types';

interface Props {
  expansion: SearchExpansion;
}

export default function CurationExpansionNarrative({ expansion }: Props) {
  const expanded = expansion.expansionPath.length > 1;
  if (!expanded) return null;
  return (
    <div
      className="rounded-lg border border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 p-3 text-xs text-yellow-900 dark:text-yellow-200"
      role="note"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden>📍</span>
        <div className="flex-1">
          <div className="font-semibold mb-1">
            Expanded search to {expansion.finalRadius}mi
          </div>
          <p className="leading-relaxed">{expansion.expansionReason}</p>
          {expansion.expansionPath.length > 1 && (
            <p className="mt-1 text-yellow-700 dark:text-yellow-400">
              Tiers tried: {expansion.expansionPath.join('mi → ')}mi
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
