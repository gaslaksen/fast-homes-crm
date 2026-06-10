'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readLeadQueue, type LeadQueue } from '@/lib/leadQueue';

// "3/10 ‹ ›" control: cycle through the filtered lead list captured on /leads.
// Renders nothing when the current lead isn't part of the stored queue.
export default function LeadQueueNav({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [queue, setQueue] = useState<LeadQueue | null>(null);

  useEffect(() => {
    setQueue(readLeadQueue());
  }, [leadId]);

  const idx = queue ? queue.ids.indexOf(leadId) : -1;
  const prevId = queue && idx > 0 ? queue.ids[idx - 1] : null;
  const nextId = queue && idx >= 0 && idx < queue.ids.length - 1 ? queue.ids[idx + 1] : null;

  // Warm the next lead in the queue so the arrow feels instant.
  useEffect(() => {
    if (nextId) router.prefetch(`/leads/${nextId}`);
    if (prevId) router.prefetch(`/leads/${prevId}`);
  }, [nextId, prevId, router]);

  // Gmail-style j / k shortcuts, ignored while typing.
  useEffect(() => {
    if (idx === -1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      if (e.key === 'j' && nextId) {
        e.preventDefault();
        router.push(`/leads/${nextId}`);
      } else if (e.key === 'k' && prevId) {
        e.preventDefault();
        router.push(`/leads/${prevId}`);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [idx, nextId, prevId, router]);

  if (!queue || idx === -1) return null;

  const arrowClass =
    'p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed';

  return (
    <div className="flex items-center gap-1.5" title={queue.label}>
      <button
        type="button"
        disabled={!prevId}
        onClick={() => prevId && router.push(`/leads/${prevId}`)}
        aria-label="Previous lead"
        title="Previous lead (k)"
        className={arrowClass}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
        {idx + 1}/{queue.ids.length}
      </span>
      <button
        type="button"
        disabled={!nextId}
        onClick={() => nextId && router.push(`/leads/${nextId}`)}
        aria-label="Next lead"
        title="Next lead (j)"
        className={arrowClass}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
