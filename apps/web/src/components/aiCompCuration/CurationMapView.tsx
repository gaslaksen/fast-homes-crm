'use client';

import { useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { CurationRanking } from '@/lib/aiCompCuration/types';
import CuratedCompCard, {
  type CuratedCompCardComp,
  type CuratedCompCardSubject,
} from './CuratedCompCard';

// CompsMap renders Leaflet which requires window — must be client-only.
const CompsMap = dynamic(() => import('@/components/CompsMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
  ),
});

// 65/35 split (desktop): map left, scrollable comp card list right.
// Stacks vertically below `lg`. Pin click highlights the matching card
// and scrolls it into view; card click centers the map on its pin.
//
// Subject pin red (CompsMap default), included pins emerald-style
// inherited from CompsMap's `selected` color (the wrapper just feeds
// selection state through), unselected gray.

interface MapLead {
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface Props {
  lead: MapLead;
  // Always-present comp list — every comp shows on the map and in the
  // right panel regardless of AI state.
  comps: CuratedCompCardComp[];
  // Optional AI decoration. When provided, pins color by inclusion and
  // right-panel cards show AI footers.
  rankingByCompId?: Map<string, CurationRanking>;
  subject: CuratedCompCardSubject;
  cardSelections: Record<string, boolean>;
  onToggle: (id: string) => void;
  onAddressClick?: (id: string) => void;
}

export default function CurationMapView({
  lead,
  comps,
  rankingByCompId,
  subject,
  cardSelections,
  onToggle,
  onAddressClick,
}: Props) {
  const [hoveredCompId, setHoveredCompId] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Build the CompsMap-shape comp list. selected reflects the user's
  // per-card choice; inclusion (when AI ran) colors the pin via a
  // separate map prop.
  const mapComps = useMemo(() => {
    return comps.map((comp) => ({
      id: comp.id,
      address: comp.address,
      distance: comp.distance ?? 0,
      soldPrice: comp.soldPrice,
      soldDate: comp.soldDate,
      bedrooms: comp.bedrooms ?? undefined,
      bathrooms: comp.bathrooms ?? undefined,
      sqft: comp.sqft ?? undefined,
      selected: !!cardSelections[comp.id],
      latitude: (comp as any).latitude ?? undefined,
      longitude: (comp as any).longitude ?? undefined,
    }));
  }, [comps, cardSelections]);

  const inclusionByCompId = useMemo(() => {
    if (!rankingByCompId) return undefined;
    const m = new Map<string, 'recommend_include' | 'borderline' | 'recommend_exclude'>();
    for (const [id, r] of rankingByCompId) {
      m.set(id, r.inclusion);
    }
    return m;
  }, [rankingByCompId]);

  const handleHover = (id: string | null) => {
    setHoveredCompId(id);
    if (id && cardRefs.current[id]) {
      cardRefs.current[id]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  };

  const handleCardEnter = (id: string) => {
    setHoveredCompId(id);
  };

  // Order: when AI ran, by rank; otherwise by distance ascending so the
  // panel feels deterministic.
  const orderedComps = useMemo(() => {
    if (rankingByCompId) {
      return [...comps].sort((a, b) => {
        const ar = rankingByCompId.get(a.id)?.rank ?? 9999;
        const br = rankingByCompId.get(b.id)?.rank ?? 9999;
        return ar - br;
      });
    }
    return [...comps].sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  }, [comps, rankingByCompId]);

  const noCoords =
    !lead.latitude && !lead.longitude && mapComps.every((c) => !c.latitude);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col lg:flex-row h-[60vh] lg:h-[600px]">
      {/* Map */}
      <div className="lg:w-[65%] h-[300px] lg:h-full bg-gray-100 dark:bg-gray-800 flex-shrink-0 relative">
        {noCoords ? (
          <div className="w-full h-full flex items-center justify-center text-xs text-gray-500 dark:text-gray-400 p-4 text-center">
            Nothing to map yet — no coordinates available for the subject or
            comps.
          </div>
        ) : (
          <CompsMap
            lead={lead as any}
            comps={mapComps as any}
            hoveredCompId={hoveredCompId}
            onHoverComp={handleHover}
            onToggleComp={onToggle}
            inclusionByCompId={inclusionByCompId}
          />
        )}
      </div>

      {/* Right card list */}
      <div className="lg:w-[35%] flex-1 overflow-y-auto bg-white dark:bg-gray-900 border-t lg:border-t-0 lg:border-l border-gray-200 dark:border-gray-700">
        <div className="p-2 space-y-2">
          {orderedComps.map((comp, i) => {
            const r = rankingByCompId?.get(comp.id);
            return (
              <div
                key={comp.id}
                ref={(el) => {
                  cardRefs.current[comp.id] = el;
                }}
                onMouseEnter={() => handleCardEnter(comp.id)}
                onMouseLeave={() => setHoveredCompId(null)}
                className={`transition-shadow ${
                  hoveredCompId === comp.id
                    ? 'ring-2 ring-emerald-400 dark:ring-emerald-600 rounded-lg'
                    : ''
                }`}
              >
                <CuratedCompCard
                  comp={comp}
                  ranking={r}
                  subject={subject}
                  selected={!!cardSelections[comp.id]}
                  onToggle={() => onToggle(comp.id)}
                  onAddressClick={onAddressClick}
                  index={i}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
