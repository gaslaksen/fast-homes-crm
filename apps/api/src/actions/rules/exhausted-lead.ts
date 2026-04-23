import type { ActionItem } from '../actions.types';
import {
  ACTION_PRIORITIES,
  EXHAUSTED_SILENCE_MS,
  EXHAUSTED_TOUCH_COUNT,
} from './priorities';
import { LeadForRules, formatAge, sellerDisplayName, snapshotOf } from './types';

/**
 * EXHAUSTED_LEAD: 15+ touches, no inbound reply ever, and 7+ days silent.
 * Action is user-initiated (mark dead / long-term nurture) — we don't
 * auto-advance tier per product decision.
 */
export function evaluateExhaustedLead(
  leads: LeadForRules[],
  now: Date,
): ActionItem[] {
  const out: ActionItem[] = [];

  for (const lead of leads) {
    if (lead.touchCount < EXHAUSTED_TOUCH_COUNT) continue;

    const silenceMs = now.getTime() - new Date(lead.lastTouchedAt).getTime();
    if (silenceMs < EXHAUSTED_SILENCE_MS) continue;

    // If they've ever replied, they're not "exhausted" in the dead-lead sense.
    const hasInbound = lead.messages.some((m) => m.direction === 'INBOUND');
    if (hasInbound) continue;

    out.push({
      actionKey: `EXHAUSTED_LEAD:${lead.id}`,
      type: 'EXHAUSTED_LEAD',
      priority: ACTION_PRIORITIES.EXHAUSTED_LEAD,
      leadId: lead.id,
      lead: snapshotOf(lead),
      title: `Decide on ${sellerDisplayName(lead)}`,
      subtitle: `${lead.touchCount} touches, silent ${formatAge(silenceMs)}`,
      suggestedAction: { verb: 'Mark dead' },
      createdAt: new Date(lead.lastTouchedAt).toISOString(),
    });
  }

  return out;
}
