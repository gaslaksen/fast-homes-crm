'use client';

import { useState } from 'react';

interface Props {
  observations: string[];
}

// Collapsed by default — observations are reference material in this
// redesign, not the headline. The AI's per-comp reasoning carries
// the primary signal.
export default function MarketObservations({ observations }: Props) {
  const [open, setOpen] = useState(false);
  if (!observations || observations.length === 0) return null;
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/50 rounded-lg"
        aria-expanded={open}
      >
        <span
          className="inline-block transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          aria-hidden
        >
          ▸
        </span>
        Market observations ({observations.length})
      </button>
      {open && (
        <ul className="px-3 pb-3 pt-1 list-disc pl-7 text-xs text-gray-600 dark:text-gray-400 space-y-1">
          {observations.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
