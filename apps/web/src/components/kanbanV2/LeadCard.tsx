'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { getStage } from '@/lib/pipelineStages';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function photoSrc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith('http') || raw.startsWith('data:')) return raw;
  return `${API_URL}${raw}`;
}
import { isStale, touchColor, wasRecentlyMoved } from '@/lib/kanbanThresholds';
import type { Density, KanbanLead } from './types';
import DripIndicator from './DripIndicator';

interface Props {
  lead: KanbanLead;
  density: Density;
  selected: boolean;
  onToggleSelect: (id: string, e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent, lead: KanbanLead) => void;
  onPauseDrip?: (leadId: string, enrollmentId: string | null) => void | Promise<void>;
  anyCardSelectedInBoard: boolean;
  seenRecentMoveRef: React.MutableRefObject<Set<string>>;
}

function fmtCurrency(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

function timeAgo(iso: string): string {
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const TOUCH_CLASS: Record<ReturnType<typeof touchColor>, string> = {
  green: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30',
  neutral: 'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800',
  yellow: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30',
  red: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30',
};

function SpreadText({ arv, asking }: { arv: number | null; asking: number | null }) {
  if (arv == null || asking == null) {
    return <span className="text-gray-400">—</span>;
  }
  const spread = arv - asking;
  const cls =
    spread > 0
      ? 'text-emerald-700 dark:text-emerald-400'
      : spread < 0
      ? 'text-red-700 dark:text-red-400'
      : 'text-gray-500';
  return <span className={cls}>{fmtCurrency(spread)}</span>;
}

function TierDot({ tier }: { tier: number | null }) {
  const color =
    tier === 1
      ? 'bg-green-500'
      : tier === 2
      ? 'bg-amber-400'
      : 'bg-gray-400';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function StageChangeIcon({ lead }: { lead: KanbanLead }) {
  const activity = lead.activities[0];
  const reason = (activity?.metadata?.reason as string | undefined) ?? 'manual';
  const isAuto = reason.startsWith('auto');
  const by = activity?.user
    ? `${activity.user.firstName ?? ''} ${activity.user.lastName ?? ''}`.trim() || 'someone'
    : isAuto
    ? 'system'
    : 'manually set';
  const when = activity ? timeAgo(activity.createdAt) : timeAgo(lead.stageChangedAt);
  const stageName = getStage(lead.status)?.name ?? lead.status;
  const tip = isAuto
    ? `Auto-moved to ${stageName} (${when} ago)`
    : `Moved to ${stageName} by ${by} (${when} ago)`;
  return (
    <span title={tip} className="text-[10px] text-gray-400 dark:text-gray-500">
      {isAuto ? '↻' : '✋'}
    </span>
  );
}

export default function LeadCard({
  lead,
  density,
  selected,
  onToggleSelect,
  onContextMenu,
  onPauseDrip,
  anyCardSelectedInBoard,
  seenRecentMoveRef,
}: Props) {
  const stage = getStage(lead.status);
  const stale = isStale(lead.lastTouchedAt);
  const tClass = TOUCH_CLASS[touchColor(lead.touchCount)];

  const shouldPulse = useMemo(() => {
    if (!wasRecentlyMoved(lead.stageChangedAt)) return false;
    if (seenRecentMoveRef.current.has(lead.id)) return false;
    seenRecentMoveRef.current.add(lead.id);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.stageChangedAt]);

  const selectable = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggleSelect(lead.id, e);
      }}
      aria-label={selected ? 'Deselect lead' : 'Select lead'}
      className={`shrink-0 w-4 h-4 rounded border ${
        selected
          ? 'bg-primary-600 border-primary-600 text-white'
          : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600'
      } ${anyCardSelectedInBoard || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity flex items-center justify-center text-[10px] leading-none`}
    >
      {selected ? '✓' : ''}
    </button>
  );

  const dripEl = (
    <DripIndicator
      enrollments={lead.campaignEnrollments}
      sequence={lead.dripSequence}
      density={density}
      onPause={onPauseDrip}
      leadId={lead.id}
    />
  );

  const baseShell = `group relative block rounded-md border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-primary-400 dark:hover:border-primary-500 transition-colors ${
    selected ? 'ring-2 ring-primary-500' : ''
  } ${shouldPulse ? 'animate-pulse-once' : ''}`;

  const addressLine = `${lead.propertyAddress}${
    lead.propertyCity ? ` · ${lead.propertyCity}, ${lead.propertyState}` : ''
  }`;

  if (density === 'ultra') {
    return (
      <div
        onContextMenu={(e) => onContextMenu?.(e, lead)}
        className={`${baseShell} px-2 py-1 flex items-center gap-2 text-xs`}
      >
        <span className={`absolute left-0 top-0 bottom-0 w-1 ${stage?.accent ?? 'bg-gray-300'}`} />
        {selectable}
        <TierDot tier={lead.tier} />
        <Link
          href={`/leads/${lead.id}`}
          className="flex-1 truncate text-gray-900 dark:text-gray-100 hover:underline"
          title={addressLine}
        >
          {lead.propertyAddress}
        </Link>
        <span className="text-gray-500 dark:text-gray-400 text-[11px]">
          <SpreadText arv={lead.arv} asking={lead.askingPrice} />
        </span>
        {dripEl}
      </div>
    );
  }

  if (density === 'compact') {
    return (
      <div
        onContextMenu={(e) => onContextMenu?.(e, lead)}
        className={`${baseShell} px-2.5 py-1.5`}
      >
        <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-l ${stage?.accent ?? 'bg-gray-300'}`} />
        <div className="flex items-start gap-2">
          {selectable}
          <div className="flex-1 min-w-0">
            <Link
              href={`/leads/${lead.id}`}
              className="block text-[13px] font-medium text-gray-900 dark:text-gray-100 truncate hover:underline"
              title={addressLine}
            >
              {lead.propertyAddress}
            </Link>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
              {lead.propertyCity}, {lead.propertyState}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px]">
              <TierDot tier={lead.tier} />
              <span className="text-gray-500 dark:text-gray-400">
                {fmtCurrency(lead.askingPrice)}
              </span>
              <span className="text-gray-400">·</span>
              <SpreadText arv={lead.arv} asking={lead.askingPrice} />
              <span className={`ml-auto px-1.5 py-0.5 rounded ${tClass} text-[10px] font-semibold`} title={`${lead.touchCount} touches`}>
                {lead.touchCount}
              </span>
              {stale && (
                <span title="No outbound contact in 5+ days" className="text-amber-500">
                  ⚠
                </span>
              )}
              <StageChangeIcon lead={lead} />
            </div>
          </div>
          <div className="absolute top-1.5 right-1.5">{dripEl}</div>
        </div>
      </div>
    );
  }

  // Comfortable
  return (
    <div
      onContextMenu={(e) => onContextMenu?.(e, lead)}
      className={`${baseShell} p-2.5`}
    >
      <span className={`absolute left-0 right-0 top-0 h-[3px] rounded-t ${stage?.accent ?? 'bg-gray-300'}`} />
      <div className="absolute top-2 right-2 z-10">{dripEl}</div>
      <div className="absolute top-2 left-2 z-10">{selectable}</div>

      {photoSrc(lead.primaryPhoto) && (
        <div className="mb-2 mt-1 overflow-hidden rounded">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoSrc(lead.primaryPhoto)!}
            alt={lead.propertyAddress}
            className="w-full h-20 object-cover"
          />
        </div>
      )}

      <Link
        href={`/leads/${lead.id}`}
        className="block text-sm font-semibold text-gray-900 dark:text-gray-100 truncate hover:underline"
        title={addressLine}
      >
        {lead.propertyAddress}
      </Link>
      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
        {lead.propertyCity}, {lead.propertyState}
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-[11px]">
        <TierDot tier={lead.tier} />
        <span className="text-gray-700 dark:text-gray-300 font-medium">
          {fmtCurrency(lead.askingPrice)}
        </span>
        <span className="text-gray-400">·</span>
        <SpreadText arv={lead.arv} asking={lead.askingPrice} />
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
        <span className={`px-1.5 py-0.5 rounded ${tClass} font-semibold`} title={`${lead.touchCount} touches`}>
          {lead.touchCount} touches
        </span>
        <span className="flex items-center gap-1">
          {stale && (
            <span title="No outbound contact in 5+ days" className="text-amber-500">
              ⚠
            </span>
          )}
          <StageChangeIcon lead={lead} />
          <span>{timeAgo(lead.lastTouchedAt)} ago</span>
        </span>
      </div>
    </div>
  );
}
