import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface DealRow {
  id: string;
  ownerName: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  status: string;
  bucket: 'potential' | 'expected' | 'realized' | null;
  exitStrategy: string | null;
  jvPartnerName: string | null;
  ourShareProfit: number | null;
  grossProfit: number | null;
  daysInStage: number;
  acquiredDate: string | null;
  soldDate: string | null;
}

export interface BucketSummary {
  sum: number;
  count: number;
}

export interface DealsSummary {
  potential: BucketSummary;
  expected: BucketSummary;
  realized: BucketSummary & { range?: { from: string | null; to: string | null } };
}

export interface DealsListResponse {
  deals: DealRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: {
    byStage: Record<string, number>;
    byBucket: Record<string, number>;
    byExitStrategy: Record<string, number>;
    hasJvPartner: number;
  };
}

export function useDealsSummary() {
  return useQuery({
    queryKey: ['deals', 'summary'],
    queryFn: async () => (await api.get<DealsSummary>('/deals/summary')).data,
    staleTime: 60_000,
  });
}

export function useDeals(params: {
  bucket?: string;
  status?: string;
  sort?: string;
  dir?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['deals', 'list', params],
    queryFn: async () => (await api.get<DealsListResponse>('/deals', { params })).data,
    staleTime: 30_000,
  });
}

export type Bucket = 'potential' | 'expected' | 'realized';

export const BUCKETS: { key: Bucket; label: string; subtitle: string; color: string; soft: string }[] = [
  { key: 'potential', label: 'Potential', subtitle: 'Pending offers', color: '#1D4ED8', soft: '#DBEAFE' },
  { key: 'expected', label: 'Expected', subtitle: 'Under contract', color: '#A16207', soft: '#FEF9C3' },
  { key: 'realized', label: 'Realized', subtitle: 'Closed (YTD)', color: '#15803D', soft: '#DCFCE7' },
];

export function bucketStyle(bucket?: string | null) {
  return (
    BUCKETS.find((b) => b.key === bucket) || {
      key: 'potential' as Bucket,
      label: '—',
      subtitle: '',
      color: '#6B7280',
      soft: '#F3F4F6',
    }
  );
}
