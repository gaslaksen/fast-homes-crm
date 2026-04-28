'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import StagePill from '@/components/listViewV2/StagePill';
import {
  DEAL_STAGE_LABELS,
  EXIT_STRATEGY_SHORT_LABELS,
  exitStrategyGroup,
  type DealStageId,
} from '@/lib/dealStages';
import ProfitBadge from './ProfitBadge';
import DaysInPhaseCell from './DaysInPhaseCell';
import DealsContextMenu from './DealsContextMenu';
import type { DealRow } from './types';

interface Props {
  deals: DealRow[];
}

const COLUMN_GRID =
  'grid grid-cols-[minmax(220px,2.5fr)_minmax(140px,1fr)_minmax(140px,1.2fr)_minmax(160px,1.2fr)_minmax(80px,0.6fr)] gap-3 items-center';

export default function DealsTable({ deals }: Props) {
  const router = useRouter();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    dealId: string;
    status: DealStageId | string;
  } | null>(null);

  const goToDeal = (id: string) => router.push(`/leads/${id}?tab=disposition`);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="min-w-[760px]">
      {/* Header */}
      <div
        className={`${COLUMN_GRID} sticky top-0 z-10 border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-400`}
      >
        <div>Seller / Property</div>
        <div>Stage</div>
        <div>Exit Strategy</div>
        <div>Profit</div>
        <div className="text-right">Days</div>
      </div>

      {/* Rows */}
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {deals.map((d) => (
          <li
            key={d.id}
            onClick={() => goToDeal(d.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, dealId: d.id, status: d.status });
            }}
            className={`${COLUMN_GRID} cursor-pointer px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/60`}
            tabIndex={0}
            role="button"
            aria-label={`Open ${d.ownerName} — ${d.propertyAddress}`}
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                {d.ownerName}
              </div>
              <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                {d.propertyAddress}
                {d.propertyCity ? `, ${d.propertyCity}` : ''}
                {d.propertyState ? ` ${d.propertyState}` : ''}
              </div>
            </div>

            <div>
              <StagePill status={d.status} />
            </div>

            <div className="min-w-0 text-sm text-gray-700 dark:text-gray-300">
              {renderExit(d)}
            </div>

            <div>
              <ProfitBadge
                amount={d.ourShareProfit}
                bucket={d.bucket}
                jv={
                  d.jvSplitMode && d.jvSplitMode !== 'none'
                    ? {
                        gross: d.grossProfit,
                        splitMode: d.jvSplitMode,
                        splitPercent: d.jvSplitPercent,
                        partnerName: d.jvPartnerName,
                      }
                    : undefined
                }
                emptyHref={
                  d.ourShareProfit == null && d.exitStrategy == null
                    ? `/leads/${d.id}?tab=disposition`
                    : undefined
                }
              />
            </div>

            <div className="text-right">
              <DaysInPhaseCell
                daysInStage={d.daysInStage}
                status={d.status}
                stageChangedAt={d.stageChangedAt}
              />
            </div>
          </li>
        ))}
      </ul>

      </div>
      {menu ? (
        <DealsContextMenu
          x={menu.x}
          y={menu.y}
          dealId={menu.dealId}
          status={menu.status}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

function renderExit(d: DealRow): React.ReactNode {
  if (!d.exitStrategy) return <span className="text-gray-400">—</span>;
  const group = exitStrategyGroup(d.exitStrategy);
  const label = EXIT_STRATEGY_SHORT_LABELS[d.exitStrategy] ?? d.exitStrategy;
  if (group === 'jv' && d.jvPartnerName) {
    return (
      <div className="min-w-0">
        <div className="truncate">{label}</div>
        <div className="truncate text-xs text-gray-500 dark:text-gray-400">
          {d.jvPartnerName}
        </div>
      </div>
    );
  }
  return label;
}

export function dealStageLabel(s: DealStageId): string {
  return DEAL_STAGE_LABELS[s];
}
