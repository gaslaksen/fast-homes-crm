'use client';

import { useEffect, useRef, useState } from 'react';
import {
  REALIZED_PERIOD_LABELS,
  type RealizedPeriodId,
} from './lib/timeRanges';

interface Props {
  period: RealizedPeriodId;
  onChange: (p: RealizedPeriodId) => void;
  customRange: { from: string | null; to: string | null };
  onCustomRangeChange: (r: { from: string | null; to: string | null }) => void;
}

const ORDER: RealizedPeriodId[] = [
  'thisMonth',
  'thisQuarter',
  'ytd',
  'lastYear',
  'allTime',
  'custom',
];

export default function RealizedPeriodSelector({
  period,
  onChange,
  customRange,
  onCustomRangeChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Click-outside to dismiss.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        {REALIZED_PERIOD_LABELS[period]}
        <svg className="h-3 w-3 opacity-60" viewBox="0 0 20 20" fill="currentColor">
          <path d="M5.5 7.5L10 12l4.5-4.5h-9z" />
        </svg>
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <ul className="py-1 text-sm">
            {ORDER.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(p);
                    if (p !== 'custom') setOpen(false);
                  }}
                  className={`w-full px-3 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800 ${
                    p === period
                      ? 'bg-primary-50 font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                      : 'text-gray-700 dark:text-gray-200'
                  }`}
                >
                  {REALIZED_PERIOD_LABELS[p]}
                </button>
              </li>
            ))}
          </ul>
          {period === 'custom' ? (
            <div className="border-t border-gray-100 p-2 dark:border-gray-800">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">
                From
              </label>
              <input
                type="date"
                value={customRange.from?.slice(0, 10) ?? ''}
                onChange={(e) =>
                  onCustomRangeChange({
                    ...customRange,
                    from: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  })
                }
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
              />
              <label className="mb-1 mt-2 block text-[11px] uppercase tracking-wide text-gray-500">
                To
              </label>
              <input
                type="date"
                value={customRange.to?.slice(0, 10) ?? ''}
                onChange={(e) =>
                  onCustomRangeChange({
                    ...customRange,
                    to: e.target.value
                      ? new Date(`${e.target.value}T23:59:59.999Z`).toISOString()
                      : null,
                  })
                }
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
