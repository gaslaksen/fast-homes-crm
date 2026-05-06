'use client';

import { useMemo, useState } from 'react';
import type { CurationRanking } from '@/lib/aiCompCuration/types';
import type {
  CuratedCompCardComp,
  CuratedCompCardSubject,
} from './CuratedCompCard';

// Dense tabular alternative to the card grid. Same data fields, same
// per-row selection semantics. Sortable headers; row click is reserved
// for selection toggle (matches the card pattern).

type SortKey =
  | 'rank'
  | 'address'
  | 'distance'
  | 'sqft'
  | 'beds'
  | 'year'
  | 'salePrice'
  | 'pricePerSqft'
  | 'soldDate';

interface Props {
  rankings: CurationRanking[];
  compById: Map<string, CuratedCompCardComp>;
  subject: CuratedCompCardSubject;
  cardSelections: Record<string, boolean>;
  onToggle: (id: string) => void;
  onAddressClick?: (id: string) => void;
}

const INCLUSION_PILL: Record<
  CurationRanking['inclusion'],
  { label: string; cls: string }
> = {
  recommend_include: {
    label: 'Include',
    cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  borderline: {
    label: 'Borderline',
    cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  },
  recommend_exclude: {
    label: 'Exclude',
    cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  },
};

export default function CuratedCompsTable({
  rankings,
  compById,
  subject,
  cardSelections,
  onToggle,
  onAddressClick,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const rows = useMemo(() => {
    return rankings
      .map((r) => {
        const comp = compById.get(r.candidateId);
        if (!comp) return null;
        const pricePerSqft =
          comp.sqft && comp.soldPrice ? comp.soldPrice / comp.sqft : null;
        return { r, comp, pricePerSqft };
      })
      .filter(
        (row): row is NonNullable<typeof row> => row !== null,
      )
      .sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1;
        const av = sortValue(a, sortKey);
        const bv = sortValue(b, sortKey);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') {
          return (av - bv) * dir;
        }
        return String(av).localeCompare(String(bv)) * dir;
      });
  }, [rankings, compById, sortKey, sortDir]);

  const headerClick = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir('asc');
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-600 dark:text-gray-400">
          <tr>
            <Th width="w-8" />
            <Th
              label="#"
              sortKey="rank"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => headerClick('rank')}
              align="right"
            />
            <Th width="w-12" />
            <Th
              label="Address"
              sortKey="address"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => headerClick('address')}
            />
            <Th
              label="Dist"
              sortKey="distance"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => headerClick('distance')}
              align="right"
            />
            <Th
              label="SqFt"
              sortKey="sqft"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => headerClick('sqft')}
              align="right"
            />
            <Th
              label="Bd/Ba"
              sortKey="beds"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => headerClick('beds')}
              align="right"
            />
            <Th
              label="Yr"
              sortKey="year"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => headerClick('year')}
              align="right"
            />
            <Th
              label="Sale"
              sortKey="salePrice"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => headerClick('salePrice')}
              align="right"
            />
            <Th
              label="$/sf"
              sortKey="pricePerSqft"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => headerClick('pricePerSqft')}
              align="right"
            />
            <Th
              label="Sold"
              sortKey="soldDate"
              activeKey={sortKey}
              dir={sortDir}
              onClick={() => headerClick('soldDate')}
            />
            <Th label="AI" />
            <Th label="Reasoning" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {rows.map(({ r, comp, pricePerSqft }) => {
            const isSelected = !!cardSelections[r.candidateId];
            const isExcluded = r.inclusion === 'recommend_exclude';
            const pill = INCLUSION_PILL[r.inclusion];
            return (
              <tr
                key={r.candidateId}
                className={`bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                  isExcluded ? 'opacity-70' : ''
                } ${isSelected ? 'ring-1 ring-emerald-300 dark:ring-emerald-800' : ''}`}
              >
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(r.candidateId)}
                    className="accent-emerald-600 cursor-pointer"
                    aria-label={`Toggle ${comp.address}`}
                  />
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">
                  {r.rank}
                </td>
                <td className="px-1 py-1 w-12">
                  {comp.photoUrl ? (
                    <img
                      src={comp.photoUrl}
                      alt=""
                      className="w-12 h-9 object-cover rounded"
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display =
                          'none';
                      }}
                    />
                  ) : (
                    <div className="w-12 h-9 bg-gray-100 dark:bg-gray-800 rounded" />
                  )}
                </td>
                <td className="px-2 py-2 max-w-[200px]">
                  <button
                    type="button"
                    onClick={() => onAddressClick?.(r.candidateId)}
                    className="text-left text-gray-800 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 truncate w-full"
                    title={comp.address}
                  >
                    {comp.address}
                  </button>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {comp.distance != null ? `${comp.distance.toFixed(2)}mi` : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {comp.sqft ? comp.sqft.toLocaleString() : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {comp.bedrooms ?? '—'}/{comp.bathrooms ?? '—'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {comp.yearBuilt ?? '—'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  ${comp.soldPrice.toLocaleString()}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {pricePerSqft ? `$${Math.round(pricePerSqft)}` : '—'}
                </td>
                <td className="px-2 py-2 text-gray-600 dark:text-gray-400">
                  {formatDate(comp.soldDate)}
                </td>
                <td className="px-2 py-2">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${pill.cls}`}
                  >
                    {pill.label}
                  </span>
                </td>
                <td className="px-2 py-2 text-gray-600 dark:text-gray-400 max-w-[280px]">
                  <span className="line-clamp-2" title={r.reasoning}>
                    {r.briefReasoning}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="p-6 text-center text-xs text-gray-500 dark:text-gray-400">
          No comps to display.
        </div>
      )}
    </div>
  );
}

function Th({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
  align,
  width,
}: {
  label?: string;
  sortKey?: SortKey;
  activeKey?: SortKey;
  dir?: 'asc' | 'desc';
  onClick?: () => void;
  align?: 'left' | 'right';
  width?: string;
}) {
  const alignCls = align === 'right' ? 'text-right' : 'text-left';
  if (!label) {
    return <th className={`${width || ''} px-2 py-2`} />;
  }
  if (!sortKey || !onClick) {
    return (
      <th
        scope="col"
        className={`${alignCls} px-2 py-2 text-[10px] uppercase tracking-wide font-semibold`}
      >
        {label}
      </th>
    );
  }
  const active = activeKey === sortKey;
  return (
    <th
      scope="col"
      className={`${alignCls} px-2 py-2 text-[10px] uppercase tracking-wide font-semibold`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-100 ${
          active ? 'text-gray-900 dark:text-gray-100' : ''
        }`}
      >
        {label}
        {active && (
          <span className="text-[9px]" aria-hidden>
            {dir === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </button>
    </th>
  );
}

function sortValue(
  row: { r: CurationRanking; comp: CuratedCompCardComp; pricePerSqft: number | null },
  key: SortKey,
): number | string | null {
  switch (key) {
    case 'rank':
      return row.r.rank;
    case 'address':
      return row.comp.address;
    case 'distance':
      return row.comp.distance ?? null;
    case 'sqft':
      return row.comp.sqft ?? null;
    case 'beds':
      return row.comp.bedrooms ?? null;
    case 'year':
      return row.comp.yearBuilt ?? null;
    case 'salePrice':
      return row.comp.soldPrice;
    case 'pricePerSqft':
      return row.pricePerSqft;
    case 'soldDate':
      return new Date(row.comp.soldDate).getTime() || null;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}
