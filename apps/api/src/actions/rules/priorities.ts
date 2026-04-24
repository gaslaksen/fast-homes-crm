// Central tuning knob for Action Queue priorities and rule windows.
// Edit here rather than scattering magic numbers across rule files.

export const ACTION_PRIORITIES = {
  CONTRACT_PENDING: 95,
  FOLLOW_UP_DUE: 80,
  FOLLOW_UP_OVERDUE_BUMP: 15, // added on top for overdue items
  NEEDS_REPLY_HOT: 95,        // tier 1
  NEEDS_REPLY_WORKABLE: 90,   // tier 2
  NEEDS_REPLY_OTHER: 85,
  OFFER_READY: 80,
  STALE_HOT_LEAD: 75,
  DRIP_REPLY_REVIEW: 75,
  NEW_LEAD_INBOUND: 65,
  CAMP_INCOMPLETE: 55,
  EXHAUSTED_LEAD: 35,
} as const;

export const REPLY_WINDOW_MS = {
  HOT: 15 * 60 * 1000,
  WORKABLE: 60 * 60 * 1000,
  OTHER: 4 * 60 * 60 * 1000,
} as const;

export const STALE_HOT_LEAD_MS = 48 * 60 * 60 * 1000;
export const CONTRACT_PENDING_MS = 24 * 60 * 60 * 1000;
export const NEW_LEAD_INBOUND_MS = 24 * 60 * 60 * 1000;
export const EXHAUSTED_TOUCH_COUNT = 15;
export const EXHAUSTED_SILENCE_MS = 7 * 24 * 60 * 60 * 1000;
export const CAMP_INCOMPLETE_MIN_TOUCHES = 3;

export const ACTION_QUEUE_MAX = 50;
// Cache TTL for computed queues. The sidebar badge poll fires every 60s
// (apps/web/src/hooks/useActionBadges.ts:12); a 60s TTL races that poll
// and hits the miss path every time — each miss triggers a 2-3s rule
// compute. 120s means every other poll serves from cache. Freshness is
// preserved because dismiss/snooze/complete explicitly invalidate.
export const CACHE_TTL_MS = 120 * 1000;
