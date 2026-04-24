'use client';

import LeadRow, { LIST_GRID_COLS_CLASS, type ListLead } from './LeadRow';
import type { SortKey, SortDir } from './hooks/useListSortPref';

interface Props {
  leads: ListLead[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  renderTier: (lead: ListLead) => React.ReactNode;
  renderScore: (lead: ListLead) => React.ReactNode;
}

function Th({
  label,
  sortKey,
  current,
  dir,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const active = current === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wide cursor-pointer rounded hover:bg-white/60 dark:hover:bg-black/20 px-1 py-0.5 -mx-1 ${
        active
          ? 'text-primary-600 dark:text-primary-400'
          : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
      } ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}
      title={`Sort by ${label}`}
    >
      {label}
      <span className={`text-[10px] w-2 inline-block ${active ? 'opacity-100' : 'opacity-0'}`}>
        {dir === 'desc' ? '↓' : '↑'}
      </span>
    </button>
  );
}

export default function ListTable({
  leads,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  sortKey,
  sortDir,
  onSort,
  renderTier,
  renderScore,
}: Props) {
  const allSelected = leads.length > 0 && selectedIds.size >= leads.length;

  return (
    <div className="hidden md:block overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden min-w-[960px]">
        {/* Header */}
        <div
          className={`grid ${LIST_GRID_COLS_CLASS} gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-800/80 items-center`}
        >
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onSelectAll}
            className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600"
          />
          <div />
          <Th label="Property / Seller" sortKey="address" current={sortKey} dir={sortDir} onSort={onSort} />
          <Th label="Stage"             sortKey="stage"   current={sortKey} dir={sortDir} onSort={onSort} />
          <Th label="Tier"              sortKey="tier"    current={sortKey} dir={sortDir} onSort={onSort} align="center" />
          <Th label="Score"             sortKey="score"   current={sortKey} dir={sortDir} onSort={onSort} align="center" />
          <Th label="ARV"               sortKey="arv"     current={sortKey} dir={sortDir} onSort={onSort} align="right" />
          <Th label="MAO"               sortKey="mao"     current={sortKey} dir={sortDir} onSort={onSort} align="right" />
          <Th label="Asking"            sortKey="asking"  current={sortKey} dir={sortDir} onSort={onSort} align="right" />
          <Th label="Spread"            sortKey="spread"  current={sortKey} dir={sortDir} onSort={onSort} align="right" />
          <Th label="Touches"           sortKey="touches" current={sortKey} dir={sortDir} onSort={onSort} align="center" />
          <Th label="Last Touch"        sortKey="touched" current={sortKey} dir={sortDir} onSort={onSort} align="right" />
        </div>

        {/* Body */}
        <div className="divide-y divide-gray-50 dark:divide-gray-800">
          {leads.map((lead) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              selected={selectedIds.has(lead.id)}
              onToggleSelect={onToggleSelect}
              onRenderTier={renderTier}
              onRenderScore={renderScore}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
