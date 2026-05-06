'use client';

export type CurationView = 'curated' | 'all';

interface Props {
  value: CurationView;
  onChange: (v: CurationView) => void;
  curatedCount: number;
  totalCount: number;
  selectedCount: number;
  selectedTotal: number;
}

export default function ViewToggle({
  value,
  onChange,
  curatedCount,
  totalCount,
  selectedCount,
  selectedTotal,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="tablist"
        aria-label="Curated comp view"
        className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden text-xs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={value === 'curated'}
          onClick={() => onChange('curated')}
          className={`px-3 py-1.5 ${
            value === 'curated'
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          Curated ({curatedCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={value === 'all'}
          onClick={() => onChange('all')}
          className={`px-3 py-1.5 border-l border-gray-300 dark:border-gray-600 ${
            value === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          All Ranked ({totalCount})
        </button>
      </div>
      <span className="ml-auto text-xs text-gray-600 dark:text-gray-400">
        {selectedCount} of {selectedTotal} selected
      </span>
    </div>
  );
}
