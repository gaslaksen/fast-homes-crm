import type { ActionItem } from '../actions.types';
import { ACTION_PRIORITIES, CONTRACT_PENDING_MS } from './priorities';
import { LeadForRules, formatAge, sellerDisplayName, snapshotOf } from './types';

const SIGNED_STATUSES = new Set([
  'signed',
  'inspection',
  'past-inspection',
  'at-title',
  'closed',
]);

/**
 * CONTRACT_PENDING: a BoldSign contract was sent 24h+ ago and is still
 * awaiting signature. Fires until `contractStatus` moves past "draft".
 */
export function evaluateContractPending(
  leads: LeadForRules[],
  now: Date,
): ActionItem[] {
  const out: ActionItem[] = [];

  for (const lead of leads) {
    const c = lead.contract;
    if (!c || !c.boldsignSentAt) continue;
    if (SIGNED_STATUSES.has(c.contractStatus)) continue;
    if (c.boldsignStatus === 'completed' || c.boldsignStatus === 'declined') continue;

    const ageMs = now.getTime() - new Date(c.boldsignSentAt).getTime();
    if (ageMs < CONTRACT_PENDING_MS) continue;

    out.push({
      actionKey: `CONTRACT_PENDING:${lead.id}`,
      type: 'CONTRACT_PENDING',
      priority: ACTION_PRIORITIES.CONTRACT_PENDING,
      leadId: lead.id,
      lead: snapshotOf(lead),
      title: `Nudge ${sellerDisplayName(lead)} about contract`,
      subtitle: `Contract sent ${formatAge(ageMs)} ago, still unsigned`,
      suggestedAction: { verb: 'Send nudge' },
      createdAt: new Date(c.boldsignSentAt).toISOString(),
    });
  }

  return out;
}
