'use client';

import PhotoGallery from '@/components/PhotoGallery';

interface Props {
  lead: any;
  leadId: string;
  onUpload: (files: File[]) => void;
  onFetchPhotos: () => void;
  onDelete: (id: string) => void;
  onSetPrimary: (id: string) => void;
}

export default function PhotosCard({ lead, leadId, onUpload, onFetchPhotos, onDelete, onSetPrimary }: Props) {
  const photos = (lead.photos || []) as any[];

  // When no photos yet, render a compact "add photos" tile rather than a full gallery
  if (photos.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">Photos</div>
        <PhotoGallery
          photos={[]}
          primaryPhotoUrl={null}
          leadId={leadId}
          onUpload={async (f) => onUpload(f)}
          onFetchPhotos={async () => onFetchPhotos()}
          onDelete={async (id) => onDelete(id)}
          onSetPrimary={async (id) => onSetPrimary(id)}
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 lead-photos-demoted">
      <PhotoGallery
        photos={photos}
        primaryPhotoUrl={lead.primaryPhoto}
        leadId={leadId}
        onUpload={async (f) => onUpload(f)}
        onFetchPhotos={async () => onFetchPhotos()}
        onDelete={async (id) => onDelete(id)}
        onSetPrimary={async (id) => onSetPrimary(id)}
      />
    </div>
  );
}
