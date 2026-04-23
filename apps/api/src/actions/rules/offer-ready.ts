import type { ActionItem } from '../actions.types';
import { ACTION_PRIORITIES } from './priorities';
import { LeadForRules, sellerDisplayName, snapshotOf } from './types';

// Stages where we expect an offer to exist. Aligned to pipeline.service
// stage strings.
const OFFER_STAGES = new Set(['QUALIFIED', 'NEGOTIATING', 'OFFER_SENT']);

function calculateMao(arv: number, askingPrice: number | null): number {
  // Match the MAO formula used elsewhere in the UI (apps/web uses
  // arv * 0.70 - 40000 - 15000). Cap at asking price if lower.
  const rawMao = Math.round(arv * 0.7 - 40000 - 15000);
  if (askingPrice && askingPrice < rawMao) return askingPrice;
  return rawMao;
}

/**
 * OFFER_READY: Deal Analysis has run (aiDealWorthiness set), we have an ARV
 * and MAO to recommend, stage is Qualified/Negotiating/Offer Sent, but no
 * Offer row exists yet.
 */
export function evaluateOfferReady(leads: LeadForRules[]): ActionItem[] {
  const out: ActionItem[] = [];

  for (const lead of leads) {
    if (!OFFER_STAGES.has(lead.status)) continue;
    if (!lead.arv || lead.arv <= 0) continue;
    if (!lead.aiDealWorthiness || lead.aiDealWorthiness === 'NEED_MORE_DATA') continue;
    if (lead.aiDealWorthiness === 'NO') continue;
    if (lead.offers.length > 0) continue;

    const mao = calculateMao(lead.arv, lead.askingPrice);
    if (mao <= 0) continue;

    const formatted = `$${Math.round(mao / 1000)}k`;

    out.push({
      actionKey: `OFFER_READY:${lead.id}`,
      type: 'OFFER_READY',
      priority: ACTION_PRIORITIES.OFFER_READY,
      leadId: lead.id,
      lead: snapshotOf(lead),
      title: `Send offer to ${sellerDisplayName(lead)}`,
      subtitle: `Deal analysis done — suggested MAO ${formatted}`,
      suggestedAction: { verb: 'Send offer', target: formatted },
      createdAt: lead.aiLastUpdated
        ? new Date(lead.aiLastUpdated).toISOString()
        : new Date(lead.lastTouchedAt).toISOString(),
    });
  }

  return out;
}
