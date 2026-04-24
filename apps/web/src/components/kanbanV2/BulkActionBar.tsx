'use client';

import { useEffect, useState } from 'react';
import { PIPELINE_STAGES } from '@/lib/pipelineStages';
import type { KanbanLead } from './types';

interface Props {
  selectedLeads: KanbanLead[];
  onClear: () => void;
  onBulkMoveStage: (ids: string[], stage: string) => Promise<void>;
  onBulkMarkDead: (ids: string[]) => Promise<void>;
  onBulkEnrollDrip: (ids: string[], campaignId: string) => Promise<void>;
  onBulkPauseDrip: (ids: string[]) => Promise<void>;
  campaigns: { id: string; name: string }[];
}

export default function BulkActionBar({
  selectedLeads,
  onClear,
  onBulkMoveStage,
  onBulkMarkDead,
  onBulkEnrollDrip,
  onBulkPauseDrip,
  campaigns,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClear();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClear]);

  if (selectedLeads.length === 0) return null;

  const ids = selectedLeads.map((l) => l.id);

  const runStage = async (stage: string) => {
    if (!stage) return;
    setBusy('stage');
    try {
      await onBulkMoveStage(ids, stage);
      onClear();
    } finally {
      setBusy(null);
    }
  };

  const runEnroll = async (campaignId: string) => {
    if (!campaignId) return;
    setBusy('enroll');
    try {
      await onBulkEnrollDrip(ids, campaignId);
      onClear();
    } finally {
      setBusy(null);
    }
  };

  const runPause = async () => {
    setBusy('pause');
    try {
      await onBulkPauseDrip(ids);
      onClear();
    } finally {
      setBusy(null);
    }
  };

  const runDead = async () => {
    if (!confirm(`Mark ${ids.length} lead(s) as dead?`)) return;
    setBusy('dead');
    try {
      await onBulkMarkDead(ids);
      onClear();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-gray-900 dark:bg-gray-800 text-white rounded-xl shadow-2xl border border-gray-700 px-4 py-2.5 flex items-center gap-3 max-w-[96vw] overflow-x-auto">
      <span className="text-sm font-semibold whitespace-nowrap">
        {selectedLeads.length} selected
      </span>
      <div className="h-5 w-px bg-gray-600" />

      <select
        disabled={!!busy}
        defaultValue=""
        onChange={(e) => runStage(e.target.value)}
        className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1"
      >
        <option value="" disabled>
          Move to stage…
        </option>
        {PIPELINE_STAGES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <select
        disabled={!!busy || campaigns.length === 0}
        defaultValue=""
        onChange={(e) => runEnroll(e.target.value)}
        className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1"
      >
        <option value="" disabled>
          {campaigns.length === 0 ? 'No campaigns' : 'Enroll in drip…'}
        </option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        disabled={!!busy}
        onClick={runPause}
        className="text-xs px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
      >
        {busy === 'pause' ? 'Pausing…' : 'Pause drip'}
      </button>

      <button
        type="button"
        disabled={!!busy}
        onClick={runDead}
        className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50"
      >
        {busy === 'dead' ? 'Marking…' : 'Mark dead'}
      </button>

      <div className="h-5 w-px bg-gray-600" />

      <button
        type="button"
        onClick={onClear}
        className="text-xs px-2 py-1 rounded hover:bg-gray-700"
      >
        Clear
      </button>
    </div>
  );
}
