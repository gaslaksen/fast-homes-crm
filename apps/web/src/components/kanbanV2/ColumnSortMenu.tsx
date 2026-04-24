'use client';

import { useEffect, useRef, useState } from 'react';
import type { ColumnSortKey } from './types';

const OPTIONS: { key: ColumnSortKey; label: string }[] = [
  { key: 'tierScore', label: 'Tier / Score (default)' },
  { key: 'lastTouchOldest', label: 'Last touch — oldest first' },
  { key: 'mostTouches', label: 'Most touches' },
  { key: 'fewestTouches', label: 'Fewest touches' },
  { key: 'alphabetical', label: 'Address A–Z' },
  { key: 'newest', label: 'Newest leads' },
];

interface Props {
  value: ColumnSortKey;
  onChange: (k: ColumnSortKey) => void;
}

export default function ColumnSortMenu({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="Sort column"
        className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-1 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        ⇅
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-30 min-w-[200px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl py-1 text-xs">
          {OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(opt.key);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                value === opt.key ? 'font-semibold text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
