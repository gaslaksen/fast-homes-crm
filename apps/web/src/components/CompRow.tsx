'use client';

import { useState, forwardRef } from 'react';

interface Comp {
  id: string;
  address: string;
  distance: number;
  soldPrice: number;
  soldDate: string;
  daysOnMarket?: number;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  lotSize?: number;
  yearBuilt?: number;
  hasPool: boolean;
  hasGarage: boolean;
  isRenovated: boolean;
  propertyType?: string;
  notes?: string;
  selected: boolean;
  adjustmentAmount?: number;
  adjustedPrice?: number;
  adjustmentNotes?: string;
  source?: string;
  correlation?: number;
  features?: any;
}

interface Lead {
  sqft?: number;
}

interface CompRowProps {
  comp: Comp;
  lead: Lead;
  compIndex?: number;
  isHovered: boolean;
  onHoverEnter: () => void;
  onHoverLeave: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

function SourceBadgeInline({ source }: { source?: string }) {
  if (!source || source === 'manual') return <span className="text-[10px] text-gray-400 dark:text-gray-500">Manual</span>;
  if (source === 'attom') return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">ATTOM</span>
  );
  if (source === 'rentcast') return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 font-medium">RentCast</span>
  );
  if (source === 'chatarv') return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 font-medium">ChatARV</span>
  );
  return <span className="text-[10px] text-gray-400 dark:text-gray-500">{source}</span>;
}

const CompRow = forwardRef<HTMLDivElement, CompRowProps>(function CompRow(
  { comp, lead, compIndex, isHovered, onHoverEnter, onHoverLeave, onToggle, onDelete },
  ref,
) {
  const [expanded, setExpanded] = useState(false);

  const monthsAgo = Math.round(
    (Date.now() - new Date(comp.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000)
  );
  const pricePerSqft = comp.sqft ? Math.round(comp.soldPrice / comp.sqft) : null;
  const sizeDiff = lead.sqft && comp.sqft
    ? Math.round(((comp.sqft - lead.sqft) / lead.sqft) * 100)
    : null;

  return (
    <div
      ref={ref}
      className={`rounded-lg border-2 transition-all ${
        isHovered
          ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-950 shadow-md ring-2 ring-yellow-300'
          : comp.selected
          ? 'border-primary-400 bg-white dark:bg-gray-900 shadow-sm'
          : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 opacity-60'
      }`}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
    >
      {/* Compact row */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Index badge */}
        {compIndex != null && (
          <span className="w-6 h-6 bg-gray-700 text-white rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">
            {compIndex}
          </span>
        )}

        {/* Price column */}
        <div className="w-20 shrink-0">
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
            ${comp.soldPrice >= 1000 ? `${Math.round(comp.soldPrice / 1000)}K` : comp.soldPrice.toLocaleString()}
          </div>
          {pricePerSqft && (
            <div className="text-[10px] text-gray-500 dark:text-gray-400">${pricePerSqft}/sq ft</div>
          )}
        </div>

        {/* Adjusted price (if different) */}
        {comp.adjustedPrice && comp.adjustedPrice !== comp.soldPrice && (
          <div className="w-20 shrink-0 hidden sm:block">
            <div className={`text-xs font-bold ${(comp.adjustmentAmount || 0) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              ${comp.adjustedPrice >= 1000 ? `${Math.round(comp.adjustedPrice / 1000)}K` : comp.adjustedPrice.toLocaleString()}
            </div>
            <div className="text-[10px] text-gray-400 dark:text-gray-500">adj.</div>
          </div>
        )}

        {/* Address + badges */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{comp.address}</div>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            <SourceBadgeInline source={comp.source} />
            {(comp.features as any)?.isDistressedSale && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium">
                Distressed
              </span>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="hidden md:flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400 shrink-0">
          <span>{comp.bedrooms || '?'}/{comp.bathrooms || '?'}</span>
          <span>{comp.sqft?.toLocaleString() || '—'} sq/ft</span>
          <span>{comp.distance.toFixed(1)}mi</span>
          <span>{monthsAgo}mo</span>
        </div>

        {/* Correlation */}
        {comp.correlation && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 hidden sm:inline ${
            comp.correlation >= 0.8 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
            comp.correlation >= 0.6 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
            'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
          }`}>
            {(comp.correlation * 100).toFixed(0)}%
          </span>
        )}

        {/* Checkbox */}
        <input
          type="checkbox"
          checked={comp.selected}
          onChange={(e) => { e.stopPropagation(); onToggle(); }}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 shrink-0"
        />

        {/* Expand chevron */}
        <svg
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-200 dark:border-gray-700 pt-2 space-y-2">
          {/* Mobile-only details */}
          <div className="md:hidden flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
            <span>{comp.bedrooms || '?'}bd / {comp.bathrooms || '?'}ba</span>
            <span>{comp.sqft?.toLocaleString() || '—'} sq/ft</span>
            <span>{comp.distance.toFixed(1)} mi</span>
            <span>{monthsAgo}mo ago</span>
          </div>

          {/* Price details */}
          <div className="flex items-center gap-2">
            <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">
              Sold
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {new Date(comp.soldDate).toLocaleDateString()} ({monthsAgo}mo ago)
            </span>
            <span className="text-xs text-gray-900 dark:text-gray-100 font-bold">
              ${comp.soldPrice.toLocaleString()}
            </span>
            {pricePerSqft && (
              <span className="text-xs text-gray-500 dark:text-gray-400">${pricePerSqft}/sq ft</span>
            )}
          </div>

          {/* AVM */}
          {(comp.features as any)?.avmValue && (() => {
            const avmVal = (comp.features as any).avmValue;
            const ratio = (comp.features as any).soldPriceToAvmRatio;
            return (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                AVM: ${avmVal.toLocaleString()}
                {ratio && (
                  <span className={ratio < 0.9 ? ' text-red-500 dark:text-red-400' : ratio > 1.1 ? ' text-green-600 dark:text-green-400' : ''}>
                    {' '}({(ratio * 100).toFixed(0)}% of AVM)
                  </span>
                )}
              </div>
            );
          })()}

          {/* Adjustment notes */}
          {comp.adjustedPrice && comp.adjustedPrice !== comp.soldPrice && (
            <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">Adjusted Price</span>
                <span className={`text-sm font-bold ${(comp.adjustmentAmount || 0) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600'}`}>
                  ${comp.adjustedPrice.toLocaleString()}
                  <span className="text-xs ml-1 font-normal">
                    ({(comp.adjustmentAmount || 0) >= 0 ? '+' : ''}{(comp.adjustmentAmount || 0).toLocaleString()})
                  </span>
                </span>
              </div>
              {comp.adjustmentNotes && (
                <div className="space-y-0.5">
                  {comp.adjustmentNotes.split('\n').filter((l: string) => l.trim()).map((line: string, i: number) => (
                    <div key={i} className={`text-xs flex gap-1 ${line.startsWith('AI:') ? 'text-purple-600 dark:text-purple-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                      <span className="shrink-0">{line.startsWith('AI:') ? '✨' : '•'}</span>
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Extra details */}
          <div className="text-xs text-gray-600 dark:text-gray-400">
            {comp.yearBuilt && <span>Built {comp.yearBuilt}</span>}
            {comp.lotSize ? <span> | {comp.lotSize} acres</span> : null}
            {comp.daysOnMarket ? <span> | {comp.daysOnMarket} DOM</span> : null}
            {(comp.features as any)?.condition ? <span> | Cond: {(comp.features as any).condition}</span> : null}
            {(comp.features as any)?.quality ? <span> | Qlty: {(comp.features as any).quality}</span> : null}
          </div>

          {/* Feature badges */}
          {(comp.hasPool || comp.hasGarage || comp.isRenovated) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {comp.hasPool && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 font-medium">Pool</span>
              )}
              {comp.hasGarage && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 font-medium">Garage</span>
              )}
              {comp.isRenovated && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">Renovated</span>
              )}
            </div>
          )}

          {/* Comparison notes */}
          {(comp.notes || sizeDiff !== null) && (
            <div className="text-xs text-gray-500 dark:text-gray-400 italic">
              {sizeDiff !== null && sizeDiff !== 0 && (
                <div>{Math.abs(sizeDiff)}% {sizeDiff > 0 ? 'larger' : 'smaller'} than subject</div>
              )}
              {comp.notes && <div>{comp.notes}</div>}
            </div>
          )}

          {/* Remove button */}
          <div className="flex justify-end">
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="text-xs text-red-500 hover:text-red-700 dark:text-red-400"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default CompRow;
