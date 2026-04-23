import type { ActionLeadSnapshot } from '../actions.types';

// Shape the service hydrates per lead and hands to every rule evaluator.
// Keep fields minimal — rules that need a specialized query should still
// receive the data here rather than hitting Prisma themselves.
export interface LeadForRules extends ActionLeadSnapshot {
  source: string;
  createdAt: Date;
  lastTouchedAt: Date;
  touchCount: number;
  campPriorityComplete: boolean;
  campMoneyComplete: boolean;
  campChallengeComplete: boolean;
  campAuthorityComplete: boolean;
  aiDealWorthiness: string | null;
  aiLastUpdated: Date | null;
  arv: number | null;
  askingPrice: number | null;
  messages: Array<{
    id: string;
    direction: string;
    body: string;
    createdAt: Date;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    dueDate: Date | null;
    completed: boolean;
  }>;
  offers: Array<{
    id: string;
    status: string;
    createdAt: Date;
  }>;
  contract: {
    id: string;
    contractStatus: string;
    boldsignSentAt: Date | null;
    boldsignStatus: string | null;
  } | null;
  dripSequence: {
    status: string;
    pausedReason: string | null;
    lastReplyAt: Date | null;
  } | null;
}

export function sellerDisplayName(lead: LeadForRules): string {
  const first = (lead.sellerFirstName || '').trim();
  const last = (lead.sellerLastName || '').trim();
  if (first && last) return `${first} ${last.charAt(0)}.`;
  return first || last || 'this seller';
}

export function snapshotOf(lead: LeadForRules): ActionLeadSnapshot {
  return {
    id: lead.id,
    propertyAddress: lead.propertyAddress,
    propertyCity: lead.propertyCity,
    propertyState: lead.propertyState,
    sellerFirstName: lead.sellerFirstName,
    sellerLastName: lead.sellerLastName,
    tier: lead.tier,
    scoreBand: lead.scoreBand,
    status: lead.status,
    primaryPhoto: lead.primaryPhoto,
  };
}

export function formatAge(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

export function isHotTier(lead: LeadForRules): boolean {
  return (
    lead.tier === 1 ||
    lead.scoreBand === 'HOT' ||
    lead.scoreBand === 'STRIKE_ZONE'
  );
}

export function isWorkableTier(lead: LeadForRules): boolean {
  return (
    lead.tier === 2 ||
    lead.scoreBand === 'WORKABLE' ||
    lead.scoreBand === 'WARM'
  );
}
