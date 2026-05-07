'use client';

import { useCallback, useEffect } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function resolveUrl(url: string): string {
  return url.startsWith('http') || url.startsWith('data:') ? url : `${API_URL}${url}`;
}

export interface LightboxPhoto {
  url: string;
  caption?: string;
  source?: string;
}

interface Props {
  photos: LightboxPhoto[];
  // Open state and handlers. The parent owns `index` so the lightbox
  // can be opened to a specific photo (e.g. clicking thumbnail #5
  // opens at index 4).
  index: number | null;
  onClose: () => void;
  onIndexChange: (i: number) => void;
  // Optional source-label resolver for the small badge in the corner
  // ("Upload" / "Street View" / "MLS"). When omitted, source string is
  // shown as-is.
  formatSource?: (s: string) => string;
}

// Shared full-screen photo viewer used by:
//   - SubjectPropertySection (HeroPhotoCarousel hero click)
//   - PhotoGallery (gallery thumbnail click)
//   - CompDrillInModal (Phase B comp drill-in hero click)
//
// Keyboard: ←/→ navigates, Escape closes. Click backdrop to close.
// Pure overlay — does not manage its own open state, just renders
// when index is non-null.
export default function LightboxOverlay({
  photos,
  index,
  onClose,
  onIndexChange,
  formatSource,
}: Props) {
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (index === null) return;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
      if (e.key === 'ArrowRight' && index < photos.length - 1)
        onIndexChange(index + 1);
    },
    [index, photos.length, onClose, onIndexChange],
  );

  useEffect(() => {
    if (index === null) return;
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [index, handleKey]);

  if (index === null || !photos[index]) return null;

  const photo = photos[index];
  const sourceLabel = photo.source && formatSource
    ? formatSource(photo.source)
    : photo.source;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Photo lightbox"
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute top-4 right-4 text-white/80 hover:text-white z-10"
        onClick={onClose}
        aria-label="Close lightbox"
      >
        <svg
          className="w-8 h-8"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <div className="absolute top-4 left-4 text-white/80 text-sm">
        {index + 1} of {photos.length}
        {sourceLabel && (
          <span className="ml-2 px-2 py-0.5 rounded bg-white/20 text-xs">
            {sourceLabel}
          </span>
        )}
      </div>
      {index > 0 && (
        <button
          type="button"
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white z-10"
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(index - 1);
          }}
          aria-label="Previous photo"
        >
          <svg
            className="w-10 h-10"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      <img
        src={resolveUrl(photo.url)}
        alt={photo.caption || `Photo ${index + 1}`}
        className="max-h-[85vh] max-w-[90vw] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      {index < photos.length - 1 && (
        <button
          type="button"
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white z-10"
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(index + 1);
          }}
          aria-label="Next photo"
        >
          <svg
            className="w-10 h-10"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}
