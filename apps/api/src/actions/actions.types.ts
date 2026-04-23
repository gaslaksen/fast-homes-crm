export type ActionCategory =
  | 'NEEDS_REPLY'
  | 'STALE_HOT_LEAD'
  | 'OFFER_READY'
  | 'CAMP_INCOMPLETE'
  | 'FOLLOW_UP_DUE'
  | 'CONTRACT_PENDING'
  | 'DRIP_REPLY_REVIEW'
  | 'EXHAUSTED_LEAD'
  | 'NEW_LEAD_INBOUND';

export interface ActionLeadSnapshot {
  id: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  sellerFirstName: string;
  sellerLastName: string;
  tier: number | null;
  scoreBand: string;
  status: string;
  primaryPhoto: string | null;
}

export interface ActionItem {
  /** Stable key so snoozes/dismissals survive across evaluations. */
  actionKey: string;
  type: ActionCategory;
  priority: number;
  leadId: string;
  lead: ActionLeadSnapshot;
  title: string;
  subtitle: string;
  suggestedAction: { verb: string; target?: string };
  /** Pre-computed AI draft (NEEDS_REPLY top N only); other cards lazy-load. */
  aiDraft?: string;
  createdAt: string;
  expiresAt?: string;
}

export interface ActionQueueFilters {
  category?: ActionCategory | ActionCategory[];
  sort?: 'priority' | 'oldest' | 'newest';
  limit?: number;
}
