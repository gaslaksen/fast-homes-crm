'use client';

// Fetches portfolio summary for the three hero cards. Realized range comes
// from the caller (browser-tz computed). Refetches when range changes.

import { useEffect, useState } from 'react';
import { dealsAPI } from '@/lib/api';
import type { DealsSummaryResponse } from '../types';
import { rangeToParams, type DateRange } from '../lib/timeRanges';

export function useDealsSummary(realizedRange: DateRange) {
  const [data, setData] = useState<DealsSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Stringify range for stable dep — Date objects are reference-unstable.
  const fromKey = realizedRange.from?.toISOString() ?? '';
  const toKey = realizedRange.to?.toISOString() ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    dealsAPI
      .summary(rangeToParams(realizedRange))
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error('Failed to load summary'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromKey, toKey]);

  return { data, loading, error };
}
