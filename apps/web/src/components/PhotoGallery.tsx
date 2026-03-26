'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function resolveUrl(url: string) {
  return url.startsWith('http') || url.startsWith('data:') ? url : `${API_URL}${url}`;
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'streetview': return 'Street View';
    case 'serpapi': return 'Web Search';
    case 'upload': return 'Upload';
    default: return source;
  }
}

interface Photo {
  id: string;
  url: string;
  thumbnailUrl: string;
  source: string;
  uploadedAt: string;
  caption?: string;
}

interface PhotoGalleryProps {
  photos: Photo[];
  primaryPhotoUrl?: string | null;
  leadId: string;
  onUpload: (files: File[]) => Promise<void>;
  onFetchPhotos: () => Promise<void>;
  onDelete: (photoId: string) => Promise<void>;
  onSetPrimary: (photoId: string) => Promise<void>;
}

export default function PhotoGallery({
  photos,
  primaryPhotoUrl,
  leadId,
  onUpload,
  onFetchPhotos,
  onDelete,
  onSetPrimary,
}: PhotoGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    setUploading(true);
    try {
      await onUpload(imageFiles);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    handleFiles(files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleFetch = async () => {
    setFetching(true);
    try {
      await onFetchPhotos();
    } finally {
      setFetching(false);
    }
  };

  const handleDelete = async (photoId: string) => {
    if (!window.confirm('Delete this photo?')) return;
    await onDelete(photoId);
  };

  // Find the primary photo to show as hero
  const primaryPhoto = photos.find((p) => p.url === primaryPhotoUrl) || photos[0];

  // Lightbox keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (lightboxIndex === null) return;
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowRight') setLightboxIndex((i) => (i !== null && i < photos.length - 1 ? i + 1 : i));
      if (e.key === 'ArrowLeft') setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i));
    },
    [lightboxIndex, photos.length],
  );

  useEffect(() => {
    if (lightboxIndex !== null) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
      };
    }
  }, [lightboxIndex, handleKeyDown]);

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-xl font-bold">Photos</h2>
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn btn-secondary btn-sm"
          >
            {uploading ? 'Uploading...' : 'Upload Photos'}
          </button>
          <button
            onClick={handleFetch}
            disabled={fetching}
            className="btn btn-primary btn-sm"
          >
            {fetching ? 'Fetching...' : photos.length > 0 ? 'Refresh Photos' : 'Fetch Photos'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
            disabled={uploading}
          />
        </div>
      </div>

      {photos.length === 0 ? (
        /* Empty state with drop zone */
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition cursor-pointer ${
            dragOver ? 'border-primary-500 bg-primary-50' : 'border-gray-300 hover:border-primary-400'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <div className="text-primary-600">
              <svg className="w-10 h-10 mx-auto mb-2 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="font-medium">Uploading photos...</p>
            </div>
          ) : (
            <>
              <svg className="w-12 h-12 mx-auto mb-2 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 16v-8m-4 4l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M20 16.7V19a2 2 0 01-2 2H6a2 2 0 01-2-2v-2.3" strokeLinecap="round" />
              </svg>
              <p className="font-medium text-gray-700 mb-1">Drop photos here or click to upload</p>
              <p className="text-sm text-gray-400">JPG, PNG, WebP up to 10MB each</p>
              <p className="text-xs text-gray-300 mt-2">Click &quot;Fetch Photos&quot; to auto-search Street View + Google Images</p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Hero photo */}
          {primaryPhoto && (
            <div
              className="relative rounded-lg overflow-hidden cursor-pointer mb-3 bg-gray-100"
              style={{ maxHeight: '300px' }}
              onClick={() => setLightboxIndex(photos.indexOf(primaryPhoto))}
            >
              <img
                src={resolveUrl(primaryPhoto.url)}
                alt="Primary property photo"
                className="w-full object-cover"
                style={{ maxHeight: '300px' }}
              />
              {primaryPhoto.source && (
                <span className="absolute bottom-2 left-2 text-xs px-2 py-0.5 rounded bg-black/50 text-white">
                  {sourceLabel(primaryPhoto.source)}
                </span>
              )}
            </div>
          )}

          {/* Thumbnail strip */}
          {photos.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {photos.map((photo, idx) => (
                <div key={photo.id} className="relative group flex-shrink-0">
                  <div
                    className={`w-16 h-16 rounded-lg overflow-hidden cursor-pointer border-2 ${
                      photo.url === primaryPhotoUrl ? 'border-primary-500' : 'border-transparent'
                    }`}
                    onClick={() => setLightboxIndex(idx)}
                  >
                    <img
                      src={resolveUrl(photo.thumbnailUrl)}
                      alt={photo.caption || `Photo ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {/* Hover actions */}
                  <div className="absolute inset-0 bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                    {photo.url !== primaryPhotoUrl && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onSetPrimary(photo.id); }}
                        className="p-1 rounded bg-white/80 hover:bg-white text-yellow-600"
                        title="Set as primary"
                      >
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(photo.id); }}
                      className="p-1 rounded bg-white/80 hover:bg-white text-red-600"
                      title="Delete"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Drop zone below existing photos */}
          <div
            className={`mt-3 border-2 border-dashed rounded-lg p-4 text-center transition cursor-pointer ${
              dragOver ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <p className="text-sm text-primary-600 font-medium">Uploading photos...</p>
            ) : (
              <p className="text-sm text-gray-400">Drop photos here or click to add more</p>
            )}
          </div>
        </>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && photos[lightboxIndex] && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
          onClick={() => setLightboxIndex(null)}
        >
          {/* Close button */}
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white z-10"
            onClick={() => setLightboxIndex(null)}
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Counter + source */}
          <div className="absolute top-4 left-4 text-white/80 text-sm">
            {lightboxIndex + 1} of {photos.length}
            {photos[lightboxIndex].source && (
              <span className="ml-2 px-2 py-0.5 rounded bg-white/20 text-xs">
                {sourceLabel(photos[lightboxIndex].source)}
              </span>
            )}
          </div>

          {/* Previous */}
          {lightboxIndex > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1); }}
            >
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {/* Image */}
          <img
            src={resolveUrl(photos[lightboxIndex].url)}
            alt={photos[lightboxIndex].caption || `Photo ${lightboxIndex + 1}`}
            className="max-h-[85vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Next */}
          {lightboxIndex < photos.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1); }}
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
