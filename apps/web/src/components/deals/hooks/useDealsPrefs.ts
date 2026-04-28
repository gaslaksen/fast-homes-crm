'use client';

// Per-user prefs for the Deals view. Persists Realized period + view toggle
// to localStorage, scoped by userId. Same shape as useKanbanPrefs and
// useListSortPref. URL state still wins for bookmarking — these prefs are
// only the starting point when the URL is empty.

import { useCallback, useEffect, useState } from 'react';
import type { DealsViewMode } from '../types';
import type { RealizedPeriodId } from '../lib/timeRanges';

const KEY = (userId: string, part: string) => `dealsView.${part}.${userId}`;

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or disabled — silent */
  }
}

export interface DealsPrefs {
  hydrated: boolean;
  view: DealsViewMode;
  setView: (v: DealsViewMode) => void;
  period: RealizedPeriodId;
  setPeriod: (p: RealizedPeriodId) => void;
  customRange: { from: string | null; to: string | null };
  setCustomRange: (r: { from: string | null; to: string | null }) => void;
}

const DEFAULT_VIEW: DealsViewMode = 'table';
const DEFAULT_PERIOD: RealizedPeriodId = 'ytd';
const DEFAULT_CUSTOM = { from: null, to: null };

export function useDealsPrefs(userId: string | undefined): DealsPrefs {
  const [view, setViewState] = useState<DealsViewMode>(DEFAULT_VIEW);
  const [period, setPeriodState] = useState<RealizedPeriodId>(DEFAULT_PERIOD);
  const [customRange, setCustomRangeState] = useState<{ from: string | null; to: string | null }>(
    DEFAULT_CUSTOM,
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setViewState(readJson<DealsViewMode>(KEY(userId, 'view'), DEFAULT_VIEW));
    setPeriodState(readJson<RealizedPeriodId>(KEY(userId, 'period'), DEFAULT_PERIOD));
    setCustomRangeState(
      readJson<{ from: string | null; to: string | null }>(KEY(userId, 'customRange'), DEFAULT_CUSTOM),
    );
    setHydrated(true);
  }, [userId]);

  const setView = useCallback(
    (v: DealsViewMode) => {
      setViewState(v);
      if (userId) writeJson(KEY(userId, 'view'), v);
    },
    [userId],
  );

  const setPeriod = useCallback(
    (p: RealizedPeriodId) => {
      setPeriodState(p);
      if (userId) writeJson(KEY(userId, 'period'), p);
    },
    [userId],
  );

  const setCustomRange = useCallback(
    (r: { from: string | null; to: string | null }) => {
      setCustomRangeState(r);
      if (userId) writeJson(KEY(userId, 'customRange'), r);
    },
    [userId],
  );

  return { hydrated, view, setView, period, setPeriod, customRange, setCustomRange };
}
