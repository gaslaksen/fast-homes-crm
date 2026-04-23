import type { ActionItem } from '../actions.types';
import {
  ACTION_PRIORITIES,
  REPLY_WINDOW_MS,
} from './priorities';
import {
  LeadForRules,
  formatAge,
  isHotTier,
  isWorkableTier,
  sellerDisplayName,
  snapshotOf,
  truncate,
} from './types';

function windowFor(lead: LeadForRules): number {
  if (isHotTier(lead)) return REPLY_WINDOW_MS.HOT;
  if (isWorkableTier(lead)) return REPLY_WINDOW_MS.WORKABLE;
  return REPLY_WINDOW_MS.OTHER;
}

function priorityFor(lead: LeadForRules): number {
  if (isHotTier(lead)) return ACTION_PRIORITIES.NEEDS_REPLY_HOT;
  if (isWorkableTier(lead)) return ACTION_PRIORITIES.NEEDS_REPLY_WORKABLE;
  return ACTION_PRIORITIES.NEEDS_REPLY_OTHER;
}

/**
 * NEEDS_REPLY: lead's most recent message is inbound and older than the
 * tier-tuned reply window.
 */
export function evaluateNeedsReply(
  leads: LeadForRules[],
  now: Date,
): ActionItem[] {
  const out: ActionItem[] = [];

  for (const lead of leads) {
    const latest = lead.messages[0];
    if (!latest || latest.direction !== 'INBOUND') continue;

    const ageMs = now.getTime() - new Date(latest.createdAt).getTime();
    if (ageMs < windowFor(lead)) continue;

    out.push({
      actionKey: `NEEDS_REPLY:${lead.id}`,
      type: 'NEEDS_REPLY',
      priority: priorityFor(lead),
      leadId: lead.id,
      lead: snapshotOf(lead),
      title: `Reply to ${sellerDisplayName(lead)}`,
      subtitle: `Replied ${formatAge(ageMs)} ago: "${truncate(latest.body, 80)}"`,
      suggestedAction: { verb: 'Send reply' },
      createdAt: new Date(latest.createdAt).toISOString(),
    });
  }

  return out;
}
