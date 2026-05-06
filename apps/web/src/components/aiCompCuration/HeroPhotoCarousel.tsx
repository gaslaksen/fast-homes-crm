'use client';

import { useCallback, useEffect, useState } from 'react';
import { photosAPI } from '@/lib/api';

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

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (lightboxIndex === null) return;
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowLeft' && lightboxIndex > 0) setLightboxIndex(lightboxIndex - 1);
      if (e.key === 'ArrowRight' && lightboxIndex < photos.length - 1) setLightboxIndex(lightboxIndex + 1);
    },
    [lightboxIndex, photos.length],
  );

  useEffect(() => {
    if (lightboxIndex !== null) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [lightboxIndex, handleKeyDown]);

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

      {/* Lightbox */}
      {lightboxIndex !== null && photos[lightboxIndex] && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Photo lightbox"
          onClick={() => setLightboxIndex(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white/80 hover:text-white z-10"
            onClick={() => setLightboxIndex(null)}
            aria-label="Close lightbox"
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="absolute top-4 left-4 text-white/80 text-sm">
            {lightboxIndex + 1} of {photos.length}
          </div>
          {lightboxIndex > 0 && (
            <button
              type="button"
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white z-10"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(lightboxIndex - 1);
              }}
              aria-label="Previous photo"
            >
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <img
            src={resolveUrl(photos[lightboxIndex].url)}
            alt={photos[lightboxIndex].caption || `Photo ${lightboxIndex + 1}`}
            className="max-h-[85vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          {lightboxIndex < photos.length - 1 && (
            <button
              type="button"
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white z-10"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(lightboxIndex + 1);
              }}
              aria-label="Next photo"
            >
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
