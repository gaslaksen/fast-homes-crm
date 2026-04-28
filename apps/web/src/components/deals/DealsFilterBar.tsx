'use client';

// Filter bar: stage chips, exit-strategy chips, JV toggle, search, sort,
// view toggle. All controlled — page owns URL state.

import {
  DEAL_STAGE_IDS,
  DEAL_STAGE_LABELS,
  EXIT_GROUP_LABELS,
  type DealStageId,
  type ExitStrategyGroup,
} from '@/lib/dealStages';
import type { DealsListCounts, DealsSortKey, DealsViewMode } from './types';

interface Props {
  // Filters
  selectedStages: DealStageId[];
  onStagesChange: (s: DealStageId[]) => void;
  selectedExitGroups: ExitStrategyGroup[];
  onExitGroupsChange: (g: ExitStrategyGroup[]) => void;
  hasJvPartner: boolean;
  onHasJvPartnerChange: (v: boolean) => void;
  search: string;
  onSearchChange: (s: string) => void;

  // Sort + view
  sort: DealsSortKey;
  onSortChange: (s: DealsSortKey) => void;
  dir: 'asc' | 'desc';
  onDirChange: (d: 'asc' | 'desc') => void;
  view: DealsViewMode;
  onViewChange: (v: DealsViewMode) => void;

  // Counts (chip badges)
  counts: DealsListCounts | null;
}

const SORT_OPTIONS: { value: DealsSortKey; label: string }[] = [
  { value: 'profit', label: 'Profit' },
  { value: 'daysInStage', label: 'Days in Phase' },
  { value: 'acquiredDate', label: 'Acquired Date' },
  { value: 'soldDate', label: 'Sale Date' },
  { value: 'propertyAddress', label: 'Property Address' },
];

const EXIT_GROUPS: ExitStrategyGroup[] = ['concierge', 'jv', 'wholesale', 'hold', 'other'];

export default function DealsFilterBar({
  selectedStages,
  onStagesChange,
  selectedExitGroups,
  onExitGroupsChange,
  hasJvPartner,
  onHasJvPartnerChange,
  search,
  onSearchChange,
  sort,
  onSortChange,
  dir,
  onDirChange,
  view,
  onViewChange,
  counts,
}: Props) {
  const toggleStage = (s: DealStageId) => {
    onStagesChange(
      selectedStages.includes(s)
        ? selectedStages.filter((x) => x !== s)
        : [...selectedStages, s],
    );
  };

  const toggleExitGroup = (g: ExitStrategyGroup) => {
    onExitGroupsChange(
      selectedExitGroups.includes(g)
        ? selectedExitGroups.filter((x) => x !== g)
        : [...selectedExitGroups, g],
    );
  };

  return (
    <div className="flex flex-col gap-3 border-b border-gray-200 bg-white py-3 dark:border-gray-800 dark:bg-gray-900">
      {/* Stage chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip
          label="All Stages"
          active={selectedStages.length === 0}
          onClick={() => onStagesChange([])}
          count={null}
        />
        {DEAL_STAGE_IDS.map((s) => (
          <Chip
            key={s}
            label={DEAL_STAGE_LABELS[s]}
            active={selectedStages.includes(s)}
            onClick={() => toggleStage(s)}
            count={counts?.byStage?.[s] ?? 0}
          />
        ))}
      </div>

      {/* Exit strategy + JV + Search + Sort + View */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Exit
          </span>
          <Chip
            label="All"
            active={selectedExitGroups.length === 0}
            onClick={() => onExitGroupsChange([])}
            count={null}
          />
          {EXIT_GROUPS.map((g) => (
            <Chip
              key={g}
              label={EXIT_GROUP_LABELS[g]}
              active={selectedExitGroups.includes(g)}
              onClick={() => toggleExitGroup(g)}
              count={null}
            />
          ))}
        </div>

        <label className="ml-2 inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={hasJvPartner}
            onChange={(e) => onHasJvPartnerChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          Has JV Partner
          {counts?.hasJvPartner != null ? (
            <span className="text-gray-500">({counts.hasJvPartner})</span>
          ) : null}
        </label>

        <div className="ml-auto flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search address or seller…"
            className="w-56 rounded border border-gray-200 px-2.5 py-1.5 text-sm placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />

          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as DealsSortKey)}
            className="rounded border border-gray-200 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            aria-label="Sort by"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => onDirChange(dir === 'desc' ? 'asc' : 'desc')}
            className="rounded border border-gray-200 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            aria-label={`Sort ${dir === 'desc' ? 'descending' : 'ascending'}`}
            title={dir === 'desc' ? 'Descending' : 'Ascending'}
          >
            {dir === 'desc' ? '↓' : '↑'}
          </button>

          <div className="ml-1 inline-flex rounded border border-gray-200 dark:border-gray-700">
            <ViewToggleButton
              active={view === 'table'}
              onClick={() => onViewChange('table')}
              label="Table"
            />
            <ViewToggleButton
              active={view === 'kanban'}
              onClick={() => onViewChange('kanban')}
              label="Kanban"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count: number | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${
        active
          ? 'bg-primary-600 text-white shadow-sm'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
      }`}
    >
      <span>{label}</span>
      {count != null ? (
        <span className={active ? 'text-primary-100' : 'text-gray-500 dark:text-gray-400'}>
          ({count})
        </span>
      ) : null}
    </button>
  );
}

function ViewToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 text-sm transition ${
        active
          ? 'bg-primary-600 text-white'
          : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
      } first:rounded-l last:rounded-r`}
    >
      {label}
    </button>
  );
}
