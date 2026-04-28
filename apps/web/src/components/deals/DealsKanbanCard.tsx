'use client';

import { useRouter } from 'next/navigation';
import {
  EXIT_STRATEGY_SHORT_LABELS,
  type DealStageId,
} from '@/lib/dealStages';
import ProfitBadge from './ProfitBadge';
import DaysInPhaseCell from './DaysInPhaseCell';
import type { DealRow } from './types';

interface Props {
  deal: DealRow;
  onContextMenu?: (e: React.MouseEvent, dealId: string, status: DealStageId | string) => void;
}

export default function DealsKanbanCard({ deal, onContextMenu }: Props) {
  const router = useRouter();
  const exitLabel = deal.exitStrategy
    ? EXIT_STRATEGY_SHORT_LABELS[deal.exitStrategy] ?? deal.exitStrategy
    : null;

  return (
    <div
      onClick={() => router.push(`/leads/${deal.id}?tab=disposition`)}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(e, deal.id, deal.status);
        }
      }}
      className="cursor-pointer rounded-md border border-gray-200 bg-white p-2.5 shadow-sm transition hover:border-primary-300 hover:shadow dark:border-gray-700 dark:bg-gray-800 dark:hover:border-primary-700"
      role="button"
      tabIndex={0}
    >
      <div className="mb-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
        {deal.propertyAddress}
      </div>
      <div className="mb-2 truncate text-xs text-gray-500 dark:text-gray-400">
        {deal.ownerName}
      </div>
      <div className="flex items-center justify-between gap-2">
        <ProfitBadge
          amount={deal.ourShareProfit}
          bucket={deal.bucket}
          jv={
            deal.jvSplitMode && deal.jvSplitMode !== 'none'
              ? {
                  gross: deal.grossProfit,
                  splitMode: deal.jvSplitMode,
                  splitPercent: deal.jvSplitPercent,
                  partnerName: deal.jvPartnerName,
                }
              : undefined
          }
        />
        <DaysInPhaseCell
          daysInStage={deal.daysInStage}
          status={deal.status}
          stageChangedAt={deal.stageChangedAt}
          compact
        />
      </div>
      {exitLabel ? (
        <div className="mt-1.5 inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {exitLabel}
        </div>
      ) : null}
    </div>
  );
}
