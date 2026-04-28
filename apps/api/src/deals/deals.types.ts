import { LeadStatus } from '@fast-homes/shared';

export type ProfitBucket = 'potential' | 'expected' | 'realized';
export type DealsViewSortKey =
  | 'profit'
  | 'daysInStage'
  | 'acquiredDate'
  | 'soldDate'
  | 'propertyAddress';

// Statuses that appear on the Deals page. Anything earlier (NEW, QUALIFYING,
// QUALIFIED, ATTEMPTING_CONTACT, NURTURE, CLOSED_LOST, DEAD) is filtered out.
export const DEAL_STATUSES: LeadStatus[] = [
  LeadStatus.OFFER_SENT,
  LeadStatus.NEGOTIATING,
  LeadStatus.UNDER_CONTRACT,
  LeadStatus.CLOSING,
  LeadStatus.ACQUIRED,
  LeadStatus.SOLD,
  LeadStatus.SOLD_LOSS,
  LeadStatus.HELD_LONG_TERM,
  LeadStatus.CANCELLED,
];

export const POTENTIAL_STATUSES: LeadStatus[] = [
  LeadStatus.OFFER_SENT,
  LeadStatus.NEGOTIATING,
];

export const EXPECTED_STATUSES: LeadStatus[] = [
  LeadStatus.UNDER_CONTRACT,
  LeadStatus.CLOSING,
  LeadStatus.ACQUIRED,
];

export const REALIZED_STATUSES: LeadStatus[] = [
  LeadStatus.SOLD,
  LeadStatus.SOLD_LOSS,
  LeadStatus.HELD_LONG_TERM,
  LeadStatus.CANCELLED,
];

export interface DealsSummaryFilters {
  organizationId: string;
  realizedFrom?: Date;
  realizedTo?: Date;
}

export interface BucketSummary {
  sum: number;
  count: number;
}

export interface DealsSummaryResponse {
  potential: BucketSummary;
  expected: BucketSummary;
  realized: BucketSummary & {
    range: { from: string | null; to: string | null };
  };
}

export interface DealsListFilters {
  organizationId: string;
  status?: LeadStatus[];
  bucket?: ProfitBucket[];
  exitStrategy?: string[];
  hasJvPartner?: boolean;
  search?: string;
  sort?: DealsViewSortKey;
  dir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  acquiredFrom?: Date;
  acquiredTo?: Date;
  soldFrom?: Date;
  soldTo?: Date;
}

export interface DealRow {
  id: string;
  ownerName: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  status: string;
  bucket: ProfitBucket | null;
  exitStrategy: string | null;
  jvPartnerId: string | null;
  jvPartnerName: string | null;
  jvSplitMode: string | null;
  jvSplitPercent: number | null;
  ourShareProfit: number | null;
  grossProfit: number | null;
  daysInStage: number;
  stageChangedAt: string;
  acquiredDate: string | null;
  soldDate: string | null;
}

export interface DealsListCounts {
  byStage: Record<string, number>;
  byBucket: Record<string, number>;
  byExitStrategy: Record<string, number>;
  hasJvPartner: number;
}

export interface DealsListResponse {
  deals: DealRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: DealsListCounts;
}
