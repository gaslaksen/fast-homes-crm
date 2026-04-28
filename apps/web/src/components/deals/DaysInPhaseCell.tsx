'use client';

import { warningLevel } from './lib/dealsThresholds';
import { DEAL_STAGE_LABELS, type DealStageId } from '@/lib/dealStages';

interface Props {
  daysInStage: number;
  status: DealStageId | string;
  stageChangedAt: string;
  compact?: boolean;
}

export default function DaysInPhaseCell({
  daysInStage,
  status,
  stageChangedAt,
  compact,
}: Props) {
  const level = warningLevel(status, daysInStage);
  const tooltip = `Entered ${
    DEAL_STAGE_LABELS[status as DealStageId] ?? status
  } on ${new Date(stageChangedAt).toLocaleDateString()}`;

  const colorClass =
    level === 'red'
      ? 'text-red-700 dark:text-red-400 font-semibold'
      : level === 'yellow'
      ? 'text-amber-700 dark:text-amber-400 font-medium'
      : 'text-gray-600 dark:text-gray-400';

  return (
    <span className={`tabular-nums ${compact ? 'text-xs' : 'text-sm'} ${colorClass}`} title={tooltip}>
      {daysInStage}d
    </span>
  );
}
