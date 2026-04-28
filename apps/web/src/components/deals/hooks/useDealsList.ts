'use client';

// Fetches the paginated, filtered, sorted Deals list.
// Filters come straight from URL state (the page owns search params); this
// hook just turns them into an API call. Debounce on search is the page's
// responsibility (mirror Leads page pattern).

import { useEffect, useState } from 'react';
import { dealsAPI } from '@/lib/api';
import type { DealsListResponse, DealsSortKey } from '../types';
import type { DealBucket, DealStageId } from '@/lib/dealStages';

export interface DealsListParams {
  status?: DealStageId[];
  bucket?: DealBucket[];
  exitStrategy?: string[];
  hasJvPartner?: boolean;
  search?: string;
  sort?: DealsSortKey;
  dir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export function useDealsList(params: DealsListParams) {
  const [data, setData] = useState<DealsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Build a stable key from all filter params for the effect dep.
  const key = JSON.stringify({
    status: params.status?.slice().sort(),
    bucket: params.bucket?.slice().sort(),
    exitStrategy: params.exitStrategy?.slice().sort(),
    hasJvPartner: params.hasJvPartner,
    search: params.search,
    sort: params.sort,
    dir: params.dir,
    page: params.page,
    limit: params.limit,
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const query: Record<string, string> = {};
    if (params.status?.length) query.status = params.status.join(',');
    if (params.bucket?.length) query.bucket = params.bucket.join(',');
    if (params.exitStrategy?.length) query.exitStrategy = params.exitStrategy.join(',');
    if (params.hasJvPartner) query.hasJvPartner = 'true';
    if (params.search) query.search = params.search;
    if (params.sort) query.sort = params.sort;
    if (params.dir) query.dir = params.dir;
    if (params.page) query.page = String(params.page);
    if (params.limit) query.limit = String(params.limit);

    dealsAPI
      .list(query)
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error('Failed to load deals'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, loading, error };
}
