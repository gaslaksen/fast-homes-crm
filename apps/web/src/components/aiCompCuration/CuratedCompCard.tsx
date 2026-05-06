'use client';

import { useMemo, useState } from 'react';
import type { CurationRanking } from '@/lib/aiCompCuration/types';

// Comp shape this card needs. Loosely typed so it composes with both
// the existing Comp interface in CompRow and the slightly different
// shapes coming back from the comps API.
export interface CuratedCompCardComp {
  id: string;
  address: string;
  distance?: number;
  soldPrice: number;
  soldDate: string;
  daysOnMarket?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  lotSize?: number | null;
  yearBuilt?: number | null;
  schoolDistrict?: string | null;
  isRenovated?: boolean | null;
  source?: string | null;
  photoUrl?: string | null;
  features?: any;
}

export interface CuratedCompCardSubject {
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
}

interface Props {
  comp: CuratedCompCardComp;
  // Ranking is optional — when absent (no AI run yet) the card renders
  // the same photo + facts + checkbox without the AI footer or the
  // colored inclusion border. One component for both states.
  ranking?: CurationRanking;
  subject: CuratedCompCardSubject;
  selected: boolean;
  onToggle: () => void;
  onAddressClick?: (compId: string) => void;
  // For staggered fade-in. Pass the index in the visible-cards list.
  index?: number;
}

const INCLUSION_FOOTER: Record<
  CurationRanking['inclusion'],
  { tint: string; label: string; iconColor: string }
> = {
  recommend_include: {
    tint: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-900',
    label: 'Include',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  borderline: {
    tint: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-900',
    label: 'Borderline',
    iconColor: 'text-yellow-600 dark:text-yellow-400',
  },
  recommend_exclude: {
    tint: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-900',
    label: 'Exclude',
    iconColor: 'text-red-600 dark:text-red-400',
  },
};

export default function CuratedCompCard({
  comp,
  ranking,
  subject,
  selected,
  onToggle,
  onAddressClick,
  index = 0,
}: Props) {
  const isExcluded = ranking?.inclusion === 'recommend_exclude';
  const photo = pickPrimaryPhoto(comp);
  const status = pickStatusPill(comp, ranking);
  const sourcePill = pickSourcePill(comp);
  const bedsBathsMatch = bedsBathsExactMatch(comp, subject);
  const pricePerSqft = comp.sqft ? Math.round(comp.soldPrice / comp.sqft) : null;
  const footer = ranking ? INCLUSION_FOOTER[ranking.inclusion] : null;

  const animationDelay = `${Math.min(index * 50, 600)}ms`;

  return (
    <div
      className={`group rounded-lg border overflow-hidden bg-white dark:bg-gray-900 transition-all hover:shadow-md ${
        selected
          ? 'border-emerald-400 dark:border-emerald-600 ring-1 ring-emerald-200 dark:ring-emerald-900/50'
          : 'border-gray-200 dark:border-gray-700'
      } ${isExcluded ? 'opacity-70' : ''}`}
      style={{
        animation: 'curationCardFadeIn 250ms ease-out both',
        animationDelay,
      }}
    >
      {/* Photo header (4:3) */}
      <div className="relative aspect-[4/3] bg-gray-100 dark:bg-gray-800 overflow-hidden">
        {photo ? (
          <img
            src={photo}
            alt={comp.address}
            loading="lazy"
            className={`w-full h-full object-cover ${isExcluded ? 'opacity-60' : ''}`}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 dark:text-gray-600">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-12 h-12"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12 12 3l9.75 9M4.5 9.75v10.5h15V9.75"
              />
            </svg>
          </div>
        )}

        {/* Top-left overlay: distance + status pills */}
        <div className="absolute top-2 left-2 flex flex-wrap gap-1">
          {typeof comp.distance === 'number' && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-black/60 text-white backdrop-blur-sm">
              {comp.distance.toFixed(2)}mi
            </span>
          )}
          {status && (
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded backdrop-blur-sm ${status.cls}`}
            >
              {status.label}
            </span>
          )}
        </div>

        {/* Top-right: selection checkbox */}
        <label
          className="absolute top-2 right-2 cursor-pointer select-none"
          aria-label={`${selected ? 'Deselect' : 'Select'} ${comp.address}`}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="w-5 h-5 rounded border-2 border-white shadow accent-emerald-600 cursor-pointer"
          />
        </label>

        {/* Bottom: price + source pill */}
        <div className="absolute bottom-0 left-0 right-0 px-2.5 py-2 bg-gradient-to-t from-black/70 via-black/40 to-transparent">
          <div className="flex items-end justify-between gap-2">
            <span className="text-white text-lg font-bold leading-none drop-shadow">
              ${comp.soldPrice.toLocaleString()}
            </span>
            {sourcePill && (
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${sourcePill.cls}`}
              >
                {sourcePill.label}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Address + facts */}
      <div className="p-3 space-y-1.5">
        <button
          type="button"
          onClick={() => onAddressClick?.(comp.id)}
          className="block w-full text-left text-sm font-semibold text-gray-800 dark:text-gray-200 truncate hover:text-blue-600 dark:hover:text-blue-400"
          title={comp.address}
        >
          {comp.address}
        </button>

        <div className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
          <FactRow icon="🏠">
            {factBeds(comp)}
            {bedsBathsMatch && (
              <span className="ml-1.5 text-[10px] px-1 py-0 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 font-medium">
                Match
              </span>
            )}
          </FactRow>
          <FactRow icon="📐" hidden={!factSqft(comp)}>
            {factSqft(comp)}
          </FactRow>
          <FactRow icon="💲" hidden={pricePerSqft == null}>
            ${pricePerSqft}/sq ft
          </FactRow>
          <FactRow icon="🏫" hidden={!comp.schoolDistrict}>
            {comp.schoolDistrict}
          </FactRow>
          <FactRow icon="📅">
            Sold {formatSaleDate(comp.soldDate)} ({relativeTime(comp.soldDate)})
          </FactRow>
          <FactRow icon="⏱" hidden={comp.daysOnMarket == null}>
            {comp.daysOnMarket} days on market
          </FactRow>
        </div>

        {/* AI brief reasoning footer — only when AI has run */}
        {ranking && footer && (
          <div
            className={`mt-2 -mx-3 -mb-3 px-3 py-2 border-t ${footer.tint}`}
            role="note"
          >
            <div className="flex items-start gap-1.5 text-xs">
              <span className={`${footer.iconColor} flex-shrink-0`} aria-hidden>
                ✨
              </span>
              <span className="text-gray-700 dark:text-gray-300 leading-snug">
                <span className={`font-semibold ${footer.iconColor}`}>
                  AI:
                </span>{' '}
                {ranking.briefReasoning}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────

function FactRow({
  icon,
  children,
  hidden,
}: {
  icon: string;
  children: React.ReactNode;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-4 text-center" aria-hidden>
        {icon}
      </span>
      <span className="flex-1 truncate">{children}</span>
    </div>
  );
}

function pickPrimaryPhoto(comp: CuratedCompCardComp): string | null {
  const list = (comp.features as any)?.photoUrls;
  if (Array.isArray(list) && list.length > 0 && typeof list[0] === 'string') {
    return list[0];
  }
  return comp.photoUrl ?? null;
}

function pickStatusPill(
  comp: CuratedCompCardComp,
  ranking: CurationRanking | undefined,
): { label: string; cls: string } | null {
  if (ranking?.flags.includes('distressed_sale_likely')) {
    return {
      label: 'Distressed',
      cls: 'bg-amber-500/90 text-white',
    };
  }
  if (comp.isRenovated) {
    return {
      label: 'Renovated',
      cls: 'bg-emerald-500/90 text-white',
    };
  }
  return null;
}

function pickSourcePill(
  comp: CuratedCompCardComp,
): { label: string; cls: string } | null {
  if (comp.source === 'reapi')
    return {
      label: 'MLS Sold',
      cls: 'bg-emerald-100 text-emerald-800',
    };
  if (comp.source === 'batchdata')
    return {
      label: 'Public Record',
      cls: 'bg-orange-100 text-orange-800',
    };
  return null;
}

function bedsBathsExactMatch(
  comp: CuratedCompCardComp,
  subject: CuratedCompCardSubject,
): boolean {
  if (
    typeof comp.bedrooms !== 'number' ||
    typeof comp.bathrooms !== 'number' ||
    typeof subject.bedrooms !== 'number' ||
    typeof subject.bathrooms !== 'number'
  ) {
    return false;
  }
  return (
    comp.bedrooms === subject.bedrooms && comp.bathrooms === subject.bathrooms
  );
}

function factBeds(comp: CuratedCompCardComp): string {
  const b = comp.bedrooms ?? '?';
  const ba = comp.bathrooms ?? '?';
  return `${b} beds, ${ba} baths`;
}

function factSqft(comp: CuratedCompCardComp): string {
  const parts: string[] = [];
  if (typeof comp.sqft === 'number') parts.push(`${comp.sqft.toLocaleString()} sqft`);
  if (typeof comp.lotSize === 'number')
    parts.push(`${comp.lotSize.toFixed(2)} acres`);
  if (typeof comp.yearBuilt === 'number') parts.push(`built ${comp.yearBuilt}`);
  return parts.join('; ');
}

function formatSaleDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (Number.isNaN(diff)) return '';
  const days = Math.round(diff / 86400000);
  if (days < 31) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} months ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
