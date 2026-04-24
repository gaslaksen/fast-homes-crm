'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ColumnSortKey, Density } from '../types';
import type { PipelineStageId } from '@/lib/pipelineStages';

const KEY = (userId: string, part: string) => `kanbanV2.${part}.${userId}`;

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

export interface KanbanPrefs {
  density: Density;
  setDensity: (d: Density) => void;
  collapsed: Set<string>;
  toggleCollapsed: (stage: string) => void;
  setCollapsed: (next: Set<string>) => void;
  columnSort: Record<string, ColumnSortKey>;
  setColumnSort: (stage: PipelineStageId | string, key: ColumnSortKey) => void;
  hydrated: boolean;
}

const DEFAULT_DENSITY: Density = 'comfortable';
const DEFAULT_SORT: ColumnSortKey = 'tierScore';

export function useKanbanPrefs(userId: string | undefined): KanbanPrefs {
  const [density, setDensityState] = useState<Density>(DEFAULT_DENSITY);
  const [collapsed, setCollapsedState] = useState<Set<string>>(new Set());
  const [columnSort, setColumnSortState] = useState<Record<string, ColumnSortKey>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setDensityState(readJson<Density>(KEY(userId, 'density'), DEFAULT_DENSITY));
    setCollapsedState(new Set(readJson<string[]>(KEY(userId, 'collapsed'), [])));
    setColumnSortState(
      readJson<Record<string, ColumnSortKey>>(KEY(userId, 'columnSort'), {}),
    );
    setHydrated(true);
  }, [userId]);

  const setDensity = useCallback(
    (d: Density) => {
      setDensityState(d);
      if (userId) writeJson(KEY(userId, 'density'), d);
    },
    [userId],
  );

  const toggleCollapsed = useCallback(
    (stage: string) => {
      setCollapsedState((prev) => {
        const next = new Set(prev);
        if (next.has(stage)) next.delete(stage);
        else next.add(stage);
        if (userId) writeJson(KEY(userId, 'collapsed'), Array.from(next));
        return next;
      });
    },
    [userId],
  );

  const setCollapsed = useCallback(
    (next: Set<string>) => {
      setCollapsedState(new Set(next));
      if (userId) writeJson(KEY(userId, 'collapsed'), Array.from(next));
    },
    [userId],
  );

  const setColumnSort = useCallback(
    (stage: string, key: ColumnSortKey) => {
      setColumnSortState((prev) => {
        const next = { ...prev, [stage]: key };
        if (userId) writeJson(KEY(userId, 'columnSort'), next);
        return next;
      });
    },
    [userId],
  );

  return {
    density,
    setDensity,
    collapsed,
    toggleCollapsed,
    setCollapsed,
    columnSort,
    setColumnSort,
    hydrated,
  };
}

export { DEFAULT_DENSITY, DEFAULT_SORT };
