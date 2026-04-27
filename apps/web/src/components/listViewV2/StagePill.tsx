'use client';

import { getStage } from '@/lib/pipelineStages';

const CLOSED_VARIANTS: Record<string, { label: string; cls: string }> = {
  // SOLD is a kanban column (handled via PIPELINE_STAGES); the variants below
  // are *terminal outcomes* that aren't surfaced as columns.
  SOLD_LOSS: {
    label: 'Sold (Loss)',
    cls:
      'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800',
  },
  HELD_LONG_TERM: {
    label: 'Held',
    cls:
      'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
  },
  CANCELLED: {
    label: 'Cancelled',
    cls:
      'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-700',
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
