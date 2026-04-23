import type { ActionItem } from '../actions.types';
import {
  ACTION_PRIORITIES,
  CAMP_INCOMPLETE_MIN_TOUCHES,
} from './priorities';
import {
  LeadForRules,
  isHotTier,
  isWorkableTier,
  sellerDisplayName,
  snapshotOf,
} from './types';

// Ask-order for the missing CAMP question, matching the sendAutoResponse
// priority: Priority > Money > Challenge > Authority (per CLAUDE.md).
function nextCampQuestion(lead: LeadForRules): string | null {
  if (!lead.campPriorityComplete) return 'timeline';
  if (!lead.campMoneyComplete) return 'asking price';
  if (!lead.campChallengeComplete) return 'condition';
  if (!lead.campAuthorityComplete) return 'ownership';
  return null;
}

/**
 * CAMP_INCOMPLETE: tier 1/2 lead still missing CAMP data after 3+ touches.
 * Suggested action tells the user which field to ask about next.
 */
export function evaluateCampIncomplete(leads: LeadForRules[]): ActionItem[] {
  const out: ActionItem[] = [];

  for (const lead of leads) {
    if (!isHotTier(lead) && !isWorkableTier(lead)) continue;
    if (lead.touchCount < CAMP_INCOMPLETE_MIN_TOUCHES) continue;

    const missing = nextCampQuestion(lead);
    if (!missing) continue;

    out.push({
      actionKey: `CAMP_INCOMPLETE:${lead.id}`,
      type: 'CAMP_INCOMPLETE',
      priority: ACTION_PRIORITIES.CAMP_INCOMPLETE,
      leadId: lead.id,
      lead: snapshotOf(lead),
      title: `Ask ${sellerDisplayName(lead)} about ${missing}`,
      subtitle: `${lead.touchCount} touches and CAMP still missing ${missing}`,
      suggestedAction: { verb: 'Ask' },
      createdAt: new Date(lead.lastTouchedAt).toISOString(),
    });
  }

  return out;
}
