// Stage taxonomy for the Deals view. Late-stage scope = nine statuses,
// from Offer Made through the four terminal outcomes. Anything earlier
// (NEW, QUALIFYING, etc.) never appears on /deals.
//
// UI labels reuse the canonical mapping in pipelineStages.ts where possible
// (OFFER_SENT → "Offer Made"). Terminal statuses get added here since
// pipelineStages.ts treats them as out-of-pipeline.

export type DealStageId =
  | 'OFFER_SENT'
  | 'NEGOTIATING'
  | 'UNDER_CONTRACT'
  | 'CLOSING'
  | 'ACQUIRED'
  | 'SOLD'
  | 'SOLD_LOSS'
  | 'HELD_LONG_TERM'
  | 'CANCELLED';

export const DEAL_STAGE_IDS: DealStageId[] = [
  'OFFER_SENT',
  'NEGOTIATING',
  'UNDER_CONTRACT',
  'CLOSING',
  'ACQUIRED',
  'SOLD',
  'SOLD_LOSS',
  'HELD_LONG_TERM',
  'CANCELLED',
];

export const TERMINAL_DEAL_STAGES: DealStageId[] = [
  'SOLD',
  'SOLD_LOSS',
  'HELD_LONG_TERM',
  'CANCELLED',
];

export const DEAL_STAGE_LABELS: Record<DealStageId, string> = {
  OFFER_SENT: 'Offer Made',
  NEGOTIATING: 'Negotiating',
  UNDER_CONTRACT: 'Under Contract',
  CLOSING: 'Closing',
  ACQUIRED: 'Acquired',
  SOLD: 'Sold',
  SOLD_LOSS: 'Sold (Loss)',
  HELD_LONG_TERM: 'Held',
  CANCELLED: 'Cancelled',
};

// Bucket → stages mapping (mirrors backend POTENTIAL/EXPECTED/REALIZED
// status groupings).
export const BUCKET_STAGES: Record<DealBucket, DealStageId[]> = {
  potential: ['OFFER_SENT', 'NEGOTIATING'],
  expected: ['UNDER_CONTRACT', 'CLOSING', 'ACQUIRED'],
  realized: ['SOLD', 'SOLD_LOSS', 'HELD_LONG_TERM', 'CANCELLED'],
};

export type DealBucket = 'potential' | 'expected' | 'realized';

export const BUCKET_LABELS: Record<DealBucket, string> = {
  potential: 'Potential',
  expected: 'Expected',
  realized: 'Realized',
};

export const BUCKET_DESCRIPTIONS: Record<DealBucket, string> = {
  potential:
    'Pending offers and active negotiations. Money you might make if these convert.',
  expected:
    'Under contract through acquired. Committed deals — money you should make once they close.',
  realized:
    'Closed deals: sold, held as rentals, or cancelled. Profit (or loss) on the books.',
};

// Exit strategy display mapping. Backend stores the canonical values
// (wholesale, novation, double_close, fix_flip, hold_rental, jv, sub_to,
// other). We collapse them into UX-friendly buckets per the brief.
export type ExitStrategyGroup =
  | 'concierge'
  | 'jv'
  | 'wholesale'
  | 'hold'
  | 'other';

export const EXIT_GROUP_LABELS: Record<ExitStrategyGroup, string> = {
  concierge: 'Concierge',
  jv: 'JV',
  wholesale: 'Wholesale',
  hold: 'Hold',
  other: 'Other',
};

export function exitStrategyGroup(strategy: string | null | undefined): ExitStrategyGroup | null {
  if (!strategy) return null;
  switch (strategy) {
    case 'wholesale':
    case 'novation':
    case 'double_close':
      return 'wholesale';
    case 'fix_flip':
      return 'concierge';
    case 'jv':
      return 'jv';
    case 'hold_rental':
      return 'hold';
    case 'sub_to':
    case 'other':
      return 'other';
    default:
      return 'other';
  }
}

export function exitStrategiesInGroup(group: ExitStrategyGroup): string[] {
  switch (group) {
    case 'concierge':
      return ['fix_flip'];
    case 'jv':
      return ['jv'];
    case 'wholesale':
      return ['wholesale', 'novation', 'double_close'];
    case 'hold':
      return ['hold_rental'];
    case 'other':
      return ['sub_to', 'other'];
  }
}
