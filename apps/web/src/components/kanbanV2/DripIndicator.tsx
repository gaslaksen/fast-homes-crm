'use client';

import { useState } from 'react';
import type { DripEnrollment, DripSequenceLite } from './types';

interface Props {
  enrollments: DripEnrollment[];
  sequence: DripSequenceLite | null;
  density: 'comfortable' | 'compact' | 'ultra';
  onPause?: (leadId: string, enrollmentId: string | null) => void | Promise<void>;
  leadId: string;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function DripIndicator({
  enrollments,
  sequence,
  density,
  onPause,
  leadId,
}: Props) {
  const [open, setOpen] = useState(false);

  const activeEnrollment = enrollments[0] ?? null;
  const hasLegacyDrip = sequence?.status === 'ACTIVE';
  if (!activeEnrollment && !hasLegacyDrip) return null;

  const campaignName =
    activeEnrollment?.campaign.name ?? 'Legacy CAMP drip';
  const step = activeEnrollment
    ? `Step ${activeEnrollment.currentStepOrder + 1}`
    : `Step ${(sequence?.currentStep ?? 0) + 1}`;
  const nextSend = activeEnrollment?.nextSendAt
    ? fmtTime(activeEnrollment.nextSendAt)
    : null;

  const tooltip = `${campaignName} · ${step}${nextSend ? ` · next ${nextSend}` : ''}`;

  const pauseHandler = async () => {
    if (!onPause) return;
    await onPause(leadId, activeEnrollment?.id ?? null);
    setOpen(false);
  };

  // Ultra: tiny dot on right side
  if (density === 'ultra') {
    return (
      <span
        title={tooltip}
        className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500"
        aria-label="In active drip"
      />
    );
  }

  // Comfortable / Compact: envelope icon in top-right
  return (
    <div className="relative">
      <button
        type="button"
        title={tooltip}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60 transition"
        aria-label="Drip campaign details"
      >
        <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor" aria-hidden>
          <path d="M1.5 3.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v.217l-6.5 4.062L1.5 3.717V3.5Zm0 1.934V12a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V5.434L8.283 9.28a.5.5 0 0 1-.566 0L1.5 5.434Z" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute right-0 top-6 z-30 min-w-[220px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-3 text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">
            {campaignName}
          </div>
          <div className="mt-1 text-gray-600 dark:text-gray-300">{step}</div>
          {nextSend && (
            <div className="text-gray-600 dark:text-gray-300">
              Next send: {nextSend}
            </div>
          )}
          {onPause && (
            <button
              type="button"
              onClick={pauseHandler}
              className="mt-2 w-full px-2 py-1 rounded bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50 text-[11px] font-medium"
            >
              Pause drip
            </button>
          )}
        </div>
      )}
    </div>
  );
}
