'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const BAND_COLORS: Record<string, { bg: string; icon: string }> = {
  STRIKE_ZONE: { bg: 'bg-red-100', icon: 'text-red-400' },
  HOT: { bg: 'bg-orange-100', icon: 'text-orange-400' },
  WORKABLE: { bg: 'bg-yellow-100', icon: 'text-yellow-400' },
  DEAD_COLD: { bg: 'bg-gray-100', icon: 'text-gray-400' },
};

const SIZES = {
  sm: 'w-12 h-12',
  md: 'w-24 h-24',
  lg: 'w-48 h-48',
};

function HouseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10" />
    </svg>
  );
}

export default function PropertyPhoto({
  src,
  scoreBand,
  address,
  size = 'md',
  onClick,
}: {
  src?: string | null;
  scoreBand?: string;
  address?: string;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const band = scoreBand || 'DEAD_COLD';
  const colors = BAND_COLORS[band] || BAND_COLORS.DEAD_COLD;

  const fullSrc = src && !imgError
    ? (src.startsWith('http') || src.startsWith('data:') ? src : `${API_URL}${src}`)
    : null;

  const sizeClass = SIZES[size];
  const iconSize = size === 'sm' ? 'w-5 h-5' : size === 'md' ? 'w-8 h-8' : 'w-12 h-12';

  return (
    <div
      className={`${sizeClass} rounded-lg overflow-hidden flex-shrink-0 ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      {fullSrc ? (
        <img
          src={fullSrc}
          alt={address || 'Property photo'}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className={`w-full h-full ${colors.bg} flex items-center justify-center`}>
          <HouseIcon className={`${iconSize} ${colors.icon}`} />
        </div>
      )}
    </div>
  );
}
