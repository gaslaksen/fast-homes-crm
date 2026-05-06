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
  rankings: CurationRanking[];
  compById: Map<string, CuratedCompCardComp>;
  subject: CuratedCompCardSubject;
  cardSelections: Record<string, boolean>;
  onToggle: (id: string) => void;
  onAddressClick?: (id: string) => void;
}

export default function CurationMapView({
  lead,
  rankings,
  compById,
  subject,
  cardSelections,
  onToggle,
  onAddressClick,
}: Props) {
  const [hoveredCompId, setHoveredCompId] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Build the CompsMap-shape comp list from the rankings + compById.
  // selected reflects the user's per-card choice in the curation panel.
  const mapComps = useMemo(() => {
    return rankings
      .map((r) => {
        const comp = compById.get(r.candidateId);
        if (!comp) return null;
        return {
          id: comp.id,
          address: comp.address,
          distance: comp.distance ?? 0,
          soldPrice: comp.soldPrice,
          soldDate: comp.soldDate,
          bedrooms: comp.bedrooms ?? undefined,
          bathrooms: comp.bathrooms ?? undefined,
          sqft: comp.sqft ?? undefined,
          selected: !!cardSelections[r.candidateId],
          latitude: (comp as any).latitude ?? undefined,
          longitude: (comp as any).longitude ?? undefined,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
  }, [rankings, compById, cardSelections]);

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

  const orderedRankings = useMemo(
    () => [...rankings].sort((a, b) => a.rank - b.rank),
    [rankings],
  );

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
          />
        )}
      </div>

      {/* Right card list */}
      <div className="lg:w-[35%] flex-1 overflow-y-auto bg-white dark:bg-gray-900 border-t lg:border-t-0 lg:border-l border-gray-200 dark:border-gray-700">
        <div className="p-2 space-y-2">
          {orderedRankings.map((r, i) => {
            const comp = compById.get(r.candidateId);
            if (!comp) return null;
            return (
              <div
                key={r.candidateId}
                ref={(el) => {
                  cardRefs.current[r.candidateId] = el;
                }}
                onMouseEnter={() => handleCardEnter(r.candidateId)}
                onMouseLeave={() => setHoveredCompId(null)}
                className={`transition-shadow ${
                  hoveredCompId === r.candidateId
                    ? 'ring-2 ring-emerald-400 dark:ring-emerald-600 rounded-lg'
                    : ''
                }`}
              >
                <CuratedCompCard
                  comp={comp}
                  ranking={r}
                  subject={subject}
                  selected={!!cardSelections[r.candidateId]}
                  onToggle={() => onToggle(r.candidateId)}
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
