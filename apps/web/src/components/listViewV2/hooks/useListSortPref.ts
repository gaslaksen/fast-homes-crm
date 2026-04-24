'use client';

import { useCallback, useEffect, useState } from 'react';

export type SortKey =
  | 'stage'
  | 'tier'
  | 'score'
  | 'arv'
  | 'mao'
  | 'asking'
  | 'spread'
  | 'touches'
  | 'touched'
  | 'address'
  | 'created';
export type SortDir = 'asc' | 'desc';

export interface SortPref {
  sort: SortKey;
  dir: SortDir;
}

export const DEFAULT_LIST_SORT: SortPref = {
  sort: 'touched',
  dir: 'asc', // oldest first = most-neglected first
};

const KEY = (userId: string) => `listViewV2.sort.${userId}`;

function read(userId: string | undefined): SortPref | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SortPref;
    if (parsed?.sort && (parsed.dir === 'asc' || parsed.dir === 'desc')) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function write(userId: string | undefined, pref: SortPref) {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY(userId), JSON.stringify(pref));
  } catch {
    /* quota or disabled — silent */
  }
}

/**
 * Returns the sort pref to apply on mount when the URL doesn't specify one.
 *
 * Precedence: URL > localStorage > DEFAULT_LIST_SORT. The URL state is owned
 * by the caller (page.tsx syncs sort/dir to URL today); this hook just
 * provides the starting point when the URL is empty, and persists changes.
 */
export function useListSortPref(
  userId: string | undefined,
  urlSort: string | null,
  urlDir: string | null,
) {
  const [hydrated, setHydrated] = useState(false);
  const [initialPref, setInitialPref] = useState<SortPref>(DEFAULT_LIST_SORT);

  useEffect(() => {
    if (!userId) return;
    const stored = read(userId);
    if (stored) setInitialPref(stored);
    setHydrated(true);
  }, [userId]);

  const persist = useCallback(
    (pref: SortPref) => {
      write(userId, pref);
    },
    [userId],
  );

  // If URL already specifies a sort, that wins and we don't override.
  const urlHasSort = !!urlSort;

  return {
    hydrated,
    initialPref, // for caller to seed state when URL is empty
    urlHasSort,
    persist,
  };
}
