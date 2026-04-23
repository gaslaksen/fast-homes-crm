'use client';

export type CompsSource = 'reapi' | 'attom' | 'rentcast';

interface CompsToolbarProps {
  allCompsCount: number;
  selectedCompsCount: number;
  compsFromReapi?: number;
  compsFromAttom: number;
  compsFromRentcast: number;
  compsSource: CompsSource;
  sortField: string;
  sortDir: 'asc' | 'desc';
  fetchingComps: boolean;
  hasAnalysis: boolean;
  // Filter state + callbacks (age in months, distance in miles)
  filterMonths?: number;
  filterDistance?: number;
  onSetFilterMonths?: (months: number) => void;
  onSetFilterDistance?: (miles: number) => void;
  onSetCompsSource: (source: CompsSource) => void;
  onSort: (field: string) => void;
  onSelectAll: (selected: boolean) => void;
  onRefreshComps: () => void;
  onAddManual: () => void;
}

const AGE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 6,  label: '6mo' },
  { value: 12, label: '12mo' },
  { value: 24, label: '24mo' },
];

// Capped at 5 miles — anything beyond that is rarely a useful comp and
// drowns out local matches when REAPI is asked for a wider radius.
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

export default function CompsToolbar({
  allCompsCount,
  selectedCompsCount,
  compsFromReapi = 0,
  compsFromAttom,
  compsFromRentcast,
  compsSource,
  sortField,
  sortDir,
  fetchingComps,
  hasAnalysis,
  filterMonths,
  filterDistance,
  onSetFilterMonths,
  onSetFilterDistance,
  onSetCompsSource,
  onSort,
  onSelectAll,
  onRefreshComps,
  onAddManual,
}: CompsToolbarProps) {
  return (
    <div className="bg-white dark:bg-gray-900 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
      {/* Top row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {/* Left: title + counts */}
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">Comps</h2>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {selectedCompsCount}/{allCompsCount} selected
          </span>
          {compsFromReapi > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium">
              {compsFromReapi} REAPI
            </span>
          )}
          {compsFromAttom > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">
              {compsFromAttom} ATTOM
            </span>
          )}
          {compsFromRentcast > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 font-medium">
              {compsFromRentcast} RentCast
            </span>
          )}
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Source toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-[10px]">
            <button
              onClick={() => onSetCompsSource('reapi')}
              className={`px-2 py-1 font-medium transition-colors ${
                compsSource === 'reapi'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              REAPI
            </button>
            <button
              onClick={() => onSetCompsSource('attom')}
              className={`px-2 py-1 font-medium transition-colors ${
                compsSource === 'attom'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              ATTOM
            </button>
            <button
              onClick={() => onSetCompsSource('rentcast')}
              className={`px-2 py-1 font-medium transition-colors ${
                compsSource === 'rentcast'
                  ? 'bg-purple-600 text-white'
                  : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              RentCast
            </button>
          </div>

          {/* Select All / Deselect All */}
          {hasAnalysis && allCompsCount > 0 && (
            <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-[10px]">
              <button
                onClick={() => onSelectAll(true)}
                className="px-2 py-1 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium border-r border-gray-200 dark:border-gray-700"
              >
                All
              </button>
              <button
                onClick={() => onSelectAll(false)}
                className="px-2 py-1 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
              >
                None
              </button>
            </div>
          )}

          {/* Refresh */}
          <button
            onClick={onRefreshComps}
            disabled={fetchingComps}
            className="btn btn-primary text-xs px-2.5 py-1"
          >
            {fetchingComps ? (
              <span className="flex items-center gap-1.5">
                <span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                Fetching...
              </span>
            ) : 'Refresh'}
          </button>

          {/* Add Manual */}
          <button onClick={onAddManual} className="btn btn-secondary text-xs px-2.5 py-1">
            + Manual
          </button>
        </div>
      </div>

      {/* Filter row — age + distance. Changes auto-select on each comp. */}
      {hasAnalysis && onSetFilterMonths && onSetFilterDistance && (
        <div className="flex items-center gap-3 mt-2 text-[10px] flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400 font-medium">Age:</span>
            {AGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onSetFilterMonths(opt.value)}
                className={`px-1.5 py-0.5 rounded border transition-colors ${
                  filterMonths === opt.value
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 font-medium'
                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400 font-medium">Distance:</span>
            {DISTANCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onSetFilterDistance(opt.value)}
                className={`px-1.5 py-0.5 rounded border transition-colors ${
                  filterDistance === opt.value
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 font-medium'
                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sort row */}
      {allCompsCount > 0 && (
        <div className="flex items-center gap-2 mt-2 text-[10px]">
          <span className="text-gray-500 dark:text-gray-400 font-medium">Sort:</span>
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => onSort(s.key)}
              className={`px-1.5 py-0.5 rounded border transition-colors ${
                sortField === s.key
                  ? 'bg-primary-100 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-400 font-medium'
                  : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {s.label} {sortField === s.key && (sortDir === 'asc' ? '↑' : '↓')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
