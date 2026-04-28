// Days-in-Phase warning thresholds for the Deals view.
//
// The brief specifies three operational signals: an Acquired deal sitting
// >60 days suggests stalled repairs/listing; an Under Contract / Closing
// deal sitting >45 days suggests a slow close. Anything past 90 days is
// deeply stalled. Configurable in Workspace Settings later — kept as
// constants here so the rule is loud and one-place-to-edit.

import type { DealStageId } from '@/lib/dealStages';

export interface StageThreshold {
  yellow: number;
  red: number;
}

export const DAYS_IN_PHASE_THRESHOLDS: Partial<Record<DealStageId, StageThreshold>> = {
  OFFER_SENT: { yellow: 21, red: 60 },
  NEGOTIATING: { yellow: 21, red: 60 },
  UNDER_CONTRACT: { yellow: 45, red: 90 },
  CLOSING: { yellow: 45, red: 90 },
  ACQUIRED: { yellow: 60, red: 90 },
};

// Terminal stages don't get a warning — once a deal is closed/cancelled/held,
// time-in-phase is informational only.
export const TERMINAL_NO_WARNING: DealStageId[] = [
  'SOLD',
  'SOLD_LOSS',
  'HELD_LONG_TERM',
  'CANCELLED',
];

export type DaysWarningLevel = 'none' | 'yellow' | 'red';

export function warningLevel(stage: string, days: number): DaysWarningLevel {
  if (TERMINAL_NO_WARNING.includes(stage as DealStageId)) return 'none';
  const t = DAYS_IN_PHASE_THRESHOLDS[stage as DealStageId];
  if (!t) return 'none';
  if (days >= t.red) return 'red';
  if (days >= t.yellow) return 'yellow';
  return 'none';
}
