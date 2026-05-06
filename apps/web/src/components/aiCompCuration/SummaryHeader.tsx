'use client';

import type { CurationResult } from '@/lib/aiCompCuration/types';

interface Props {
  result: CurationResult;
  cachedAtMs: number | null;
  onRerun: () => void;
  onOpenFilters?: () => void;
}

export default function SummaryHeader({
  result,
  cachedAtMs,
  onRerun,
  onOpenFilters,
}: Props) {
  const isArv = result.valuationMode === 'ARV_RENOVATED';
  const totalScore = clampScore(averageRelevance(result));

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              isArv
                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
            }`}
          >
            ✨ {isArv ? 'ARV Mode' : 'As-Is Mode'}
          </span>
          {cachedAtMs && (
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              AI Curation completed {humanAge(cachedAtMs)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {onOpenFilters && (
            <button
              type="button"
              onClick={onOpenFilters}
              className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 inline-flex items-center gap-1"
              title="Filters &amp; settings"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"
                />
              </svg>
              Filters
            </button>
          )}
          <button
            type="button"
            onClick={onRerun}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Re-run
          </button>
        </div>
      </div>

      <p className="mt-2.5 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
        {result.summary}
      </p>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-gray-500 dark:text-gray-500">
          Recommended top {result.recommendedTopCount} ·{' '}
          {result.modelMetadata.model} ·{' '}
          {Math.round(result.modelMetadata.latencyMs / 1000)}s
        </span>
        <ConfidenceRing score={totalScore} />
      </div>
    </div>
  );
}

function ConfidenceRing({ score }: { score: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - score / 100);
  return (
    <div
      className="relative flex items-center justify-center"
      title={`Avg relevance score: ${score}/100`}
    >
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
        <circle
          cx="18"
          cy="18"
          r={r}
          stroke="currentColor"
          className="text-gray-200 dark:text-gray-700"
          strokeWidth="3"
          fill="none"
        />
        <circle
          cx="18"
          cy="18"
          r={r}
          stroke="currentColor"
          className="text-emerald-500"
          strokeWidth="3"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 18 18)"
        />
      </svg>
      <span className="absolute text-[9px] font-semibold text-gray-700 dark:text-gray-300">
        {score}
      </span>
    </div>
  );
}

function averageRelevance(result: CurationResult): number {
  const includedRanks = result.rankings.filter(
    (r) => r.inclusion === 'recommend_include',
  );
  if (includedRanks.length === 0) return 0;
  const sum = includedRanks.reduce((s, r) => s + r.relevanceScore, 0);
  return Math.round(sum / includedRanks.length);
}

function clampScore(s: number): number {
  return Math.max(0, Math.min(100, Math.round(s)));
}

function humanAge(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
