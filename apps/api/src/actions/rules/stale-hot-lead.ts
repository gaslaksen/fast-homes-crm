import type { ActionItem } from '../actions.types';
import { ACTION_PRIORITIES, STALE_HOT_LEAD_MS } from './priorities';
import {
  LeadForRules,
  formatAge,
  isHotTier,
  sellerDisplayName,
  snapshotOf,
} from './types';

/**
 * STALE_HOT_LEAD: tier-1/hot lead with no contact in 48h+.
 * Skipped if there's a NEEDS_REPLY pending — reply supersedes a nudge.
 */
export function evaluateStaleHotLead(
  leads: LeadForRules[],
  now: Date,
): ActionItem[] {
  const out: ActionItem[] = [];

  for (const lead of leads) {
    if (!isHotTier(lead)) continue;

    // Already need a reply? Let NEEDS_REPLY handle it.
    const latest = lead.messages[0];
    if (latest && latest.direction === 'INBOUND') continue;

    const ageMs = now.getTime() - new Date(lead.lastTouchedAt).getTime();
    if (ageMs < STALE_HOT_LEAD_MS) continue;

    out.push({
      actionKey: `STALE_HOT_LEAD:${lead.id}`,
      type: 'STALE_HOT_LEAD',
      priority: ACTION_PRIORITIES.STALE_HOT_LEAD,
      leadId: lead.id,
      lead: snapshotOf(lead),
      title: `Follow up with ${sellerDisplayName(lead)}`,
      subtitle: `Hot lead, no contact in ${formatAge(ageMs)}`,
      suggestedAction: { verb: 'Send follow-up' },
      createdAt: new Date(lead.lastTouchedAt).toISOString(),
    });
  }

  return out;
}
