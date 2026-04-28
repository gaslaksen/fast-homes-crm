// Deal-row + summary shapes returned by GET /deals and GET /deals/summary.
// Mirrors the backend DTOs in apps/api/src/deals/deals.types.ts.

import type { DealBucket, DealStageId } from '@/lib/dealStages';

export interface DealRow {
  id: string;
  ownerName: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  status: DealStageId;
  bucket: DealBucket | null;
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

export interface BucketSummary {
  sum: number;
  count: number;
}

export interface DealsSummaryResponse {
  potential: BucketSummary;
  expected: BucketSummary;
  realized: BucketSummary & { range: { from: string | null; to: string | null } };
}

export type DealsViewMode = 'table' | 'kanban';
export type DealsSortKey =
  | 'profit'
  | 'daysInStage'
  | 'acquiredDate'
  | 'soldDate'
  | 'propertyAddress';
