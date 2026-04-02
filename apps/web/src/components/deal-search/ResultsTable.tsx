'use client';

interface DealSearchResult {
  attomId: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  propertyType: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  estimatedValue: number | null;
  equityPercent: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  ownerName: string | null;
  isAbsenteeOwner: boolean;
  isOwnerOccupied: boolean;
  ownerType: string;
  distressFlags: string[];
  latitude: number | null;
  longitude: number | null;
}

interface ResultsTableProps {
  results: DealSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
  onSelectProperty: (result: DealSearchResult) => void;
  onAddToPipeline: (result: DealSearchResult) => void;
  addedIds: Set<string>;
}

function fmt(val: number | null | undefined, prefix = '') {
  if (val == null) return '—';
  return prefix + val.toLocaleString();
}

function SortHeader({ label, sortKey, currentKey, currentDir, onSort }: {
  label: string; sortKey: string; currentKey: string; currentDir: string; onSort: (k: string) => void;
}) {
  const active = currentKey === sortKey;
  return (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none whitespace-nowrap"
      onClick={() => onSort(sortKey)}
    >
      {label} {active ? (currentDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );
}

const FLAG_COLORS: Record<string, string> = {
  'Pre-Foreclosure': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  'Foreclosure': 'bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  'Tax Lien': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  'Bankruptcy': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  'Absentee Owner': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  'High Equity': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'Vacant': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

export default function ResultsTable({
  results,
  total,
  page,
  pageSize,
  onPageChange,
  sortKey,
  sortDir,
  onSort,
  onSelectProperty,
  onAddToPipeline,
  addedIds,
}: ResultsTableProps) {
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <SortHeader label="Address" sortKey="address" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Type</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Bd/Ba</th>
              <SortHeader label="Sqft" sortKey="sqft" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
              <SortHeader label="AVM" sortKey="estimatedValue" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
              <SortHeader label="Equity %" sortKey="equityPercent" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Last Sale</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Owner</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Flags</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr
                key={r.attomId}
                className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                onClick={() => onSelectProperty(r)}
              >
                <td className="px-3 py-2.5">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[200px]">
                    {r.propertyAddress}
                  </div>
                  <div className="text-xs text-gray-400">
                    {r.propertyCity}, {r.propertyState} {r.propertyZip}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                    {r.propertyType || '—'}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                  {r.bedrooms ?? '—'}/{r.bathrooms ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300">
                  {fmt(r.sqft)}
                </td>
                <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-gray-100">
                  {fmt(r.estimatedValue, '$')}
                </td>
                <td className="px-3 py-2.5">
                  {r.equityPercent != null ? (
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                      r.equityPercent >= 50
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : r.equityPercent >= 20
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                      {r.equityPercent}%
                    </span>
                  ) : '—'}
                </td>
                <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {r.lastSaleDate ? new Date(r.lastSaleDate).toLocaleDateString() : '—'}
                  {r.lastSalePrice ? <div>{fmt(r.lastSalePrice, '$')}</div> : null}
                </td>
                <td className="px-3 py-2.5">
                  <div className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-[120px]">
                    {r.ownerName || '—'}
                  </div>
                  <div className="text-xs text-gray-400">
                    {r.isAbsenteeOwner ? 'Absentee' : 'Owner-Occ'}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1 max-w-[150px]">
                    {r.distressFlags.map((flag) => (
                      <span
                        key={flag}
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                          FLAG_COLORS[flag] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        }`}
                      >
                        {flag}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => onSelectProperty(r)}
                      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                      title="View details"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => onAddToPipeline(r)}
                      disabled={addedIds.has(r.attomId)}
                      className={`p-1 rounded ${
                        addedIds.has(r.attomId)
                          ? 'text-green-500 cursor-default'
                          : 'hover:bg-primary-50 dark:hover:bg-primary-900/20 text-primary-600'
                      }`}
                      title={addedIds.has(r.attomId) ? 'Added to pipeline' : 'Add to pipeline'}
                    >
                      {addedIds.has(r.attomId) ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500 dark:text-gray-400">
          <span>
            Showing {start}-{end} of {total.toLocaleString()} results
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="btn btn-sm disabled:opacity-50"
            >
              Previous
            </button>
            <span className="px-3 py-1 text-xs">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="btn btn-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
