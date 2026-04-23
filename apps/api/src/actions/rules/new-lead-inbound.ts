import type { ActionItem } from '../actions.types';
import { ACTION_PRIORITIES, NEW_LEAD_INBOUND_MS } from './priorities';
import { LeadForRules, sellerDisplayName, snapshotOf } from './types';

// Sources that represent real inbound leads (seller-initiated). Excludes
// MANUAL entry and DEAL_SEARCH (cold outbound discovery) where "first
// contact" isn't meaningful.
const INBOUND_SOURCES = new Set(['PROPERTY_LEADS', 'GOOGLE_ADS']);

/**
 * NEW_LEAD_INBOUND: created <24h ago via an inbound source, no outbound
 * contact yet. Suggested action: make first contact.
 */
export function evaluateNewLeadInbound(
  leads: LeadForRules[],
  now: Date,
): ActionItem[] {
  const out: ActionItem[] = [];

  for (const lead of leads) {
    if (!INBOUND_SOURCES.has(lead.source)) continue;

    const ageMs = now.getTime() - new Date(lead.createdAt).getTime();
    if (ageMs >= NEW_LEAD_INBOUND_MS) continue;

    // Skip if we've already sent outbound contact.
    const hasOutbound = lead.messages.some((m) => m.direction === 'OUTBOUND');
    if (hasOutbound) continue;

    out.push({
      actionKey: `NEW_LEAD_INBOUND:${lead.id}`,
      type: 'NEW_LEAD_INBOUND',
      priority: ACTION_PRIORITIES.NEW_LEAD_INBOUND,
      leadId: lead.id,
      lead: snapshotOf(lead),
      title: `Make first contact with ${sellerDisplayName(lead)}`,
      subtitle: `New lead via ${lead.source.toLowerCase().replace(/_/g, ' ')}`,
      suggestedAction: { verb: 'Reach out' },
      createdAt: new Date(lead.createdAt).toISOString(),
    });
  }

  return out;
}
