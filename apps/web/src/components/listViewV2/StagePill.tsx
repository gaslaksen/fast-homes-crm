'use client';

import { getStage } from '@/lib/pipelineStages';

const CLOSED_VARIANTS: Record<string, { label: string; cls: string }> = {
  CLOSED_WON: {
    label: 'Closed ✓',
    cls:
      'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800',
  },
  CLOSED_LOST: {
    label: 'Lost',
    cls:
      'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-700',
  },
  DEAD: {
    label: '💀 Dead',
    cls:
      'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-700',
  },
};

/**
 * Canonical per-stage pill driven by PIPELINE_STAGES
 * (apps/web/src/lib/pipelineStages.ts) so List + Kanban render identical
 * colors for the same stage. Falls back to a neutral variant for
 * closed/dead statuses that aren't in the active pipeline.
 */
export default function StagePill({ status }: { status: string }) {
  const closed = CLOSED_VARIANTS[status];
  if (closed) {
    return (
      <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${closed.cls}`}>
        {closed.label}
      </span>
    );
  }
  const stage = getStage(status);
  if (!stage) {
    return (
      <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-700">
        {status.replace(/_/g, ' ')}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap border ${stage.color}`}>
      {stage.name}
    </span>
  );
}
