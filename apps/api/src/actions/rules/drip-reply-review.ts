import type { ActionItem } from '../actions.types';
import { ACTION_PRIORITIES } from './priorities';
import {
  LeadForRules,
  formatAge,
  sellerDisplayName,
  snapshotOf,
  truncate,
} from './types';

/**
 * DRIP_REPLY_REVIEW: lead is enrolled in a drip, the seller replied and the
 * sequence auto-paused. Surface it so the user reviews before continuing.
 * Skipped if NEEDS_REPLY already covers it (prevents dupes) — handled at
 * the service level by dedup-on-actionKey, but also guarded here by only
 * firing when the reply is within the last 24h and stale enough to sit in
 * the queue without being redundant.
 */
export function evaluateDripReplyReview(
  leads: LeadForRules[],
  now: Date,
): ActionItem[] {
  const out: ActionItem[] = [];

  for (const lead of leads) {
    const drip = lead.dripSequence;
    if (!drip) continue;
    if (drip.status !== 'PAUSED') continue;
    if (!drip.lastReplyAt) continue;

    // Grab the most recent inbound body for context (best effort).
    const latest = lead.messages.find((m) => m.direction === 'INBOUND');
    const replyAgeMs = now.getTime() - new Date(drip.lastReplyAt).getTime();

    out.push({
      actionKey: `DRIP_REPLY_REVIEW:${lead.id}`,
      type: 'DRIP_REPLY_REVIEW',
      priority: ACTION_PRIORITIES.DRIP_REPLY_REVIEW,
      leadId: lead.id,
      lead: snapshotOf(lead),
      title: `Review ${sellerDisplayName(lead)}'s drip reply`,
      subtitle: latest
        ? `Drip paused ${formatAge(replyAgeMs)} ago: "${truncate(latest.body, 70)}"`
        : `Drip paused ${formatAge(replyAgeMs)} ago — seller replied`,
      suggestedAction: { verb: 'Review' },
      createdAt: new Date(drip.lastReplyAt).toISOString(),
    });
  }

  return out;
}
