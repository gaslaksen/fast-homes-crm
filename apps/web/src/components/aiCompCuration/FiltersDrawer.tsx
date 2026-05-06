'use client';

import { useEffect } from 'react';
import type { CompsSource } from '@/components/CompsToolbar';

// Slide-from-right drawer that owns the toolbar controls (data source,
// age, distance, sort, bulk actions, refresh, manual). Auto-applies on
// change — same behavior as the inline chips today.
//
// Standalone fixed positioning + backdrop; no library dep. Closes on
// Escape, outside click, or the X button.

const AGE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 6, label: '6 months' },
  { value: 12, label: '12 months' },
  { value: 24, label: '24 months' },
];

const DISTANCE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: '≤1 mi' },
  { value: 2, label: '≤2 mi' },
  { value: 3, label: '≤3 mi' },
  { value: 5, label: '≤5 mi' },
];

const SORT_OPTIONS = [
  { key: 'distance', label: 'Distance' },
  { key: 'soldPrice', label: 'Price' },
  { key: 'sqft', label: 'Sq Ft' },
  { key: 'soldDate', label: 'Sale Date' },
  { key: 'correlation', label: 'Correlation' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  // Data source
  compsSource: CompsSource;
  batchDataEnabled?: boolean;
  onSetCompsSource: (source: CompsSource) => void;
  onCompareProviders: () => void;
  // Filters
  filterMonths: number;
  filterDistance: number;
  onSetFilterMonths: (m: number) => void;
  onSetFilterDistance: (mi: number) => void;
  // Sort
  sortField: string;
  sortDir: 'asc' | 'desc';
  onSort: (field: string) => void;
  // Bulk actions
  onSelectAll: (selected: boolean) => void;
  // Bottom actions
  onRefreshComps: () => void;
  onAddManual: () => void;
  fetchingComps?: boolean;
}

export default function FiltersDrawer({
  open,
  onClose,
  compsSource,
  batchDataEnabled = false,
  onSetCompsSource,
  onCompareProviders,
  filterMonths,
  filterDistance,
  onSetFilterMonths,
  onSetFilterDistance,
  sortField,
  sortDir,
  onSort,
  onSelectAll,
  onRefreshComps,
  onAddManual,
  fetchingComps = false,
}: Props) {
  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Filters and settings"
      className="fixed inset-0 z-40"
    >
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="absolute top-0 right-0 h-full w-full sm:w-[380px] bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700 flex flex-col"
        style={{ animation: 'curationDrawerSlideIn 250ms ease-out' }}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Filters &amp; Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="p-1 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 rounded"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 text-sm">
          {/* Data sources */}
          <Section title="Data Sources">
            <RadioRow
              label="REAPI MLS"
              checked={compsSource === 'reapi'}
              onSelect={() => onSetCompsSource('reapi')}
            />
            {batchDataEnabled && (
              <RadioRow
                label="BatchData"
                checked={compsSource === 'batchdata'}
                onSelect={() => onSetCompsSource('batchdata')}
              />
            )}
            <button
              type="button"
              onClick={onCompareProviders}
              className="mt-2 text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-1.5"
            >
              ⇄ Compare Providers
            </button>
          </Section>

          {/* Comp age */}
          <Section title="Comp Age">
            {AGE_OPTIONS.map((o) => (
              <RadioRow
                key={o.value}
                label={o.label}
                checked={filterMonths === o.value}
                onSelect={() => onSetFilterMonths(o.value)}
              />
            ))}
          </Section>

          {/* Distance */}
          <Section title="Distance Filter">
            {DISTANCE_OPTIONS.map((o) => (
              <RadioRow
                key={o.value}
                label={o.label}
                checked={filterDistance === o.value}
                onSelect={() => onSetFilterDistance(o.value)}
              />
            ))}
          </Section>

          {/* Sort */}
          <Section title="Sort Order">
            <div className="flex flex-wrap gap-1">
              {SORT_OPTIONS.map((o) => {
                const active = sortField === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => onSort(o.key)}
                    className={`text-xs px-2.5 py-1 rounded-full border ${
                      active
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    {o.label}
                    {active && (
                      <span className="ml-1 text-[10px] opacity-80">
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </Section>

          {/* Bulk actions */}
          <Section title="Bulk Actions">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onSelectAll(true)}
                className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => onSelectAll(false)}
                className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Deselect All
              </button>
            </div>
          </Section>
        </div>

        <footer className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
          <button
            type="button"
            onClick={onRefreshComps}
            disabled={fetchingComps}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {fetchingComps ? 'Refreshing…' : 'Refresh comps'}
          </button>
          <button
            type="button"
            onClick={onAddManual}
            className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            + Manual comp
          </button>
        </footer>
      </aside>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function RadioRow({
  label,
  checked,
  onSelect,
}: {
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100">
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        className="accent-blue-600"
      />
      {label}
    </label>
  );
}
