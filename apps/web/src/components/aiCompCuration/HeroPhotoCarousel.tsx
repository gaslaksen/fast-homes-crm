'use client';

import { useEffect, useState } from 'react';
import { photosAPI } from '@/lib/api';
import LightboxOverlay from '@/components/LightboxOverlay';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function resolveUrl(url: string): string {
  return url.startsWith('http') || url.startsWith('data:') ? url : `${API_URL}${url}`;
}

// Same shape as the unified Lead.photos array (per enrichLead in
// reapi.service.ts). MLS photos already get promoted into this array
// so we don't need a separate fallback chain at the component level.
export interface HeroPhoto {
  id: string;
  url: string;
  thumbnailUrl?: string;
  source?: string;
  caption?: string;
}

interface Props {
  leadId: string;
  photos: HeroPhoto[];
  primaryPhotoUrl?: string | null;
  // When photos is empty, optionally trigger a Street View fetch on
  // mount. Page reloads the lead afterward to pick up the new photo.
  onStreetViewFetched?: () => void;
}

export default function HeroPhotoCarousel({
  leadId,
  photos,
  primaryPhotoUrl,
  onStreetViewFetched,
}: Props) {
  const [heroIndex, setHeroIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [streetViewFetching, setStreetViewFetching] = useState(false);

  // Sync the hero to the primary photo whenever the photo list reshapes.
  useEffect(() => {
    if (photos.length === 0) {
      setHeroIndex(0);
      return;
    }
    const primaryIdx = primaryPhotoUrl
      ? photos.findIndex((p) => p.url === primaryPhotoUrl)
      : -1;
    setHeroIndex(primaryIdx >= 0 ? primaryIdx : 0);
  }, [primaryPhotoUrl, photos.length]);

  // Lazy Street View fetch when the lead has zero photos. One-shot.
  useEffect(() => {
    let cancelled = false;
    if (photos.length > 0 || streetViewFetching) return;
    setStreetViewFetching(true);
    photosAPI
      .fetchStreetView(leadId)
      .then(() => {
        if (cancelled) return;
        onStreetViewFetched?.();
      })
      .catch(() => {
        // Silent — placeholder will keep rendering until something lands.
      })
      .finally(() => {
        if (!cancelled) setStreetViewFetching(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, photos.length]);

  const heroPhoto = photos[heroIndex];

  const hasMultiple = photos.length > 1;

  return (
    <div className="space-y-2">
      {/* Hero + vertical thumbnail strip on the right when multiple
          photos. Single-photo case: hero takes full width. */}
      <div className={`flex gap-2 ${hasMultiple ? 'items-start' : ''}`}>
        <div
          className={`relative aspect-[4/3] bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden shadow-sm cursor-zoom-in ${
            hasMultiple ? 'flex-1 min-w-0' : 'w-full'
          }`}
          onClick={() => heroPhoto && setLightboxIndex(heroIndex)}
        >
          {heroPhoto ? (
            <img
              src={resolveUrl(heroPhoto.url)}
              alt={heroPhoto.caption || 'Subject property'}
              className="w-full h-full object-cover"
              loading="eager"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 dark:text-gray-600 gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-16 h-16"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 12 12 3l9.75 9M4.5 9.75v10.5h15V9.75"
                />
              </svg>
              <span className="text-xs text-gray-400">
                {streetViewFetching ? 'Loading photo…' : 'No photos available'}
              </span>
            </div>
          )}
        </div>

        {hasMultiple && (
          <div className="flex flex-col gap-1.5 max-h-[400px] overflow-y-auto pr-1 flex-shrink-0">
            {photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setHeroIndex(i)}
                className={`w-[72px] h-[54px] rounded overflow-hidden border-2 transition flex-shrink-0 ${
                  i === heroIndex
                    ? 'border-emerald-500'
                    : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                }`}
                aria-label={`Show photo ${i + 1}`}
              >
                <img
                  src={resolveUrl(p.thumbnailUrl || p.url)}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {hasMultiple && (
        <div className="text-xs text-gray-500 dark:text-gray-400 text-right">
          {heroIndex + 1} / {photos.length}
        </div>
      )}

      <LightboxOverlay
        photos={photos}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onIndexChange={setLightboxIndex}
      />
    </div>
  );
}
