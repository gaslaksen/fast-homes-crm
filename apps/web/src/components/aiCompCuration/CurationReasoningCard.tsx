'use client';

import type { CurationRanking } from '@/lib/aiCompCuration/types';

interface Props {
  ranking: CurationRanking;
  address?: string;
  onScrollToComp?: (candidateId: string) => void;
}

const INCLUSION_PILL: Record<CurationRanking['inclusion'], string> = {
  recommend_include:
    'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
  borderline:
    'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400',
  recommend_exclude:
    'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
};

const INCLUSION_LABEL: Record<CurationRanking['inclusion'], string> = {
  recommend_include: 'Include',
  borderline: 'Borderline',
  recommend_exclude: 'Exclude',
};

export default function CurationReasoningCard({
  ranking,
  address,
  onScrollToComp,
}: Props) {
  return (
    <div className="rounded border border-gray-200 dark:border-gray-700 p-2.5 bg-white dark:bg-gray-900 text-xs">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
          #{ranking.rank}
        </span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${INCLUSION_PILL[ranking.inclusion]}`}
        >
          {INCLUSION_LABEL[ranking.inclusion]}
        </span>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">
          score {ranking.relevanceScore}
        </span>
        {address && (
          <button
            type="button"
            className="ml-auto text-[10px] text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[200px]"
            onClick={() => onScrollToComp?.(ranking.candidateId)}
            title={address}
          >
            {address}
          </button>
        )}
      </div>
      <p className="text-gray-700 dark:text-gray-300 leading-snug">
        {ranking.reasoning}
      </p>
      {ranking.flags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {ranking.flags.map((f) => (
            <span
              key={f}
              className="text-[9px] px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-mono"
            >
              {f}
            </span>
          ))}
        </div>
      )}
      {ranking.adjustmentNotes && (
        <p className="mt-1.5 text-[10px] text-gray-500 dark:text-gray-400 italic">
          Adjustment notes: {ranking.adjustmentNotes}
        </p>
      )}
      <div className="flex gap-2 mt-1.5 text-[10px]">
        {ranking.externalLinks.zillow && (
          <a
            href={ranking.externalLinks.zillow}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Zillow
          </a>
        )}
        {ranking.externalLinks.realtor && (
          <a
            href={ranking.externalLinks.realtor}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Realtor
          </a>
        )}
        {ranking.externalLinks.googleMaps && (
          <a
            href={ranking.externalLinks.googleMaps}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Maps
          </a>
        )}
      </div>
    </div>
  );
}
