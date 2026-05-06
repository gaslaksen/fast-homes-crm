'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  runCuration,
  getLatestCuration,
  bulkSelectComps,
} from '@/lib/aiCompCuration/client';
import {
  readDisplayMode,
  writeDisplayMode,
} from '@/lib/aiCompCuration/persistence';
import type {
  CurationResult,
  HardConstraints,
  RunCurationInput,
  StepEvent,
  ValuationMode,
} from '@/lib/aiCompCuration/types';
import type { CompsSource } from '@/components/CompsToolbar';
import CurationProgressDrawer from './CurationProgressDrawer';
import CurationEmptyState from './CurationEmptyState';
import CuratedCompCard, {
  type CuratedCompCardComp,
} from './CuratedCompCard';
import StaleBanner from './StaleBanner';
import ShowLessRelevantToggle from './ShowLessRelevantToggle';
import DisplayModeToggle, { type DisplayMode } from './DisplayModeToggle';
import FiltersDrawer from './FiltersDrawer';
import CuratedCompsTable from './CuratedCompsTable';
import CurationMapView from './CurationMapView';
import AIPicksBanner from './AIPicksBanner';

// Defaults for the simplified "Pick for me" entry point. The legacy
// input controls (mode/distance/constraints) are removed in this layout
// per the spec — defaults are: ARV mode, auto distance, no constraints.
// Future iteration could expose mode toggle in the AIPicksBanner.
const DEFAULT_VALUATION_MODE: ValuationMode = 'ARV_RENOVATED';
const DEFAULT_MAX_DISTANCE: 'auto' | number = 'auto';
const DEFAULT_HARD_CONSTRAINTS: HardConstraints = {};

interface FiltersBundle {
  compsSource: CompsSource;
  batchDataEnabled?: boolean;
  filterMonths: number;
  filterDistance: number;
  sortField: string;
  sortDir: 'asc' | 'desc';
  fetchingComps?: boolean;
  onSetCompsSource: (source: CompsSource) => void;
  onCompareProviders: () => void;
  onSetFilterMonths: (m: number) => void;
  onSetFilterDistance: (mi: number) => void;
  onSort: (field: string) => void;
  onSelectAll: (selected: boolean) => void;
  onRefreshComps: () => void;
}

interface MapLeadShape {
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface Props {
  leadId: string;
  analysisId: string | null;
  comps: CuratedCompCardComp[];
  subject: { bedrooms?: number | null; bathrooms?: number | null; sqft?: number | null };
  mapLead: MapLeadShape;
  filters: FiltersBundle;
  // Per-comp selection toggle (writes to Comp.selected via the existing
  // toggleCompSelection endpoint immediately; ARV recomputes live).
  onToggleCompSelection: (compId: string) => Promise<void> | void;
  selectedCompIds: Set<string>;
  // Refresh hooks — called after AI bulk-select or other side-effecting ops.
  onCurationApplied?: () => void;
  onResultChange?: (result: CurationResult | null) => void;
  onAddManualComp?: () => void;
  onScrollToComp?: (compId: string) => void;
}

export default function ComparablePropertiesSection({
  leadId,
  analysisId,
  comps,
  subject,
  mapLead,
  filters,
  onToggleCompSelection,
  selectedCompIds,
  onCurationApplied,
  onResultChange,
  onAddManualComp,
  onScrollToComp,
}: Props) {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<CurationResult | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [cancelHandle, setCancelHandle] = useState<{
    cancel: () => void;
  } | null>(null);
  const [cachedFromMs, setCachedFromMs] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);

  const [displayMode, setDisplayMode] = useState<DisplayMode>('cards');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedLessRelevant, setExpandedLessRelevant] = useState(false);

  // Load persisted display mode preference once.
  useEffect(() => {
    setDisplayMode(readDisplayMode());
  }, []);
  const persistDisplayMode = (m: DisplayMode) => {
    setDisplayMode(m);
    writeDisplayMode(m);
  };

  const input: RunCurationInput = {
    valuationMode: DEFAULT_VALUATION_MODE,
    hardConstraints: DEFAULT_HARD_CONSTRAINTS,
    maxDistance: DEFAULT_MAX_DISTANCE,
  };

  // Hydrate the latest curation for this lead on mount + whenever the
  // candidate pool reshapes (provider toggle, refresh). Cache key
  // includes the candidate IDs so a pool change naturally misses.
  useEffect(() => {
    let aborted = false;
    if (running) return;
    getLatestCuration(leadId, input)
      .then((res) => {
        if (aborted) return;
        if (res.result) {
          setResult(res.result);
          setCachedFromMs(res.createdAt ? Date.parse(res.createdAt) : null);
          onResultChange?.(res.result);
        } else {
          setResult(null);
          setCachedFromMs(null);
          onResultChange?.(null);
        }
      })
      .catch(() => {});
    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, comps.length]);

  const start = (force: boolean) => {
    setRunning(true);
    setError(null);
    setEvents([]);
    setResult(null);
    setCachedFromMs(null);
    const handle = runCuration({
      leadId,
      ...input,
      force,
      onStep: (e) => setEvents((prev) => [...prev, e]),
      onCacheHit: (r) => {
        setResult(r);
        onResultChange?.(r);
      },
    });
    setCancelHandle(handle);
    handle.promise
      .then((r) => {
        setResult(r);
        onResultChange?.(r);
      })
      .catch((err) => {
        const code = (err as any)?.code ?? 'NETWORK';
        if (err.message !== 'cancelled') {
          setError({ code, message: err.message });
        }
      })
      .finally(() => {
        setRunning(false);
        setCancelHandle(null);
      });
  };

  const cancel = () => {
    cancelHandle?.cancel();
    setRunning(false);
  };

  // "Pick for me" applies the AI's recommended-include set to the comp
  // pool via the existing bulk-select endpoint. Then the page refreshes
  // to pick up the new Comp.selected state and the recomputed ARV.
  const pickForMe = async () => {
    if (!result || !analysisId) return;
    setPicking(true);
    try {
      const include = result.rankings
        .filter((r) => r.inclusion === 'recommend_include')
        .map((r) => r.candidateId);
      await bulkSelectComps(analysisId, include);
      onCurationApplied?.();
    } finally {
      setPicking(false);
    }
  };

  const rankingByCompId = useMemo(() => {
    if (!result) return undefined;
    const m = new Map<string, NonNullable<typeof result>['rankings'][number]>();
    for (const r of result.rankings) m.set(r.candidateId, r);
    return m;
  }, [result]);

  const includedCount = useMemo(
    () =>
      result
        ? result.rankings.filter((r) => r.inclusion === 'recommend_include').length
        : 0,
    [result],
  );
  const borderlineCount = useMemo(
    () =>
      result ? result.rankings.filter((r) => r.inclusion === 'borderline').length : 0,
    [result],
  );
  const excludedCount = useMemo(
    () =>
      result
        ? result.rankings.filter((r) => r.inclusion === 'recommend_exclude').length
        : 0,
    [result],
  );

  // Stale detection removed in Phase A.7.1 — comparing rankings.length
  // against comps.length false-fired immediately after every curation
  // because the AI ranks the deduped survivor set (smaller) while the
  // page's comps array still includes dedup losers. The cache key
  // includes sorted candidate IDs + subject fingerprint, so a real pool
  // change naturally invalidates the cache on next hydration — the
  // separate banner was redundant and noisy.
  const isStale = false;

  // Visible comp set per the spec:
  //   - No AI: all comps show
  //   - AI ran, less-relevant collapsed: only included
  //   - AI ran, less-relevant expanded: included + borderline + excluded
  //   - Table mode: always show all comps (table is for exhaustive review)
  const visibleComps = useMemo(() => {
    if (displayMode === 'table' || !rankingByCompId) return comps;
    if (expandedLessRelevant) return comps;
    return comps.filter((c) => {
      const r = rankingByCompId.get(c.id);
      return r ? r.inclusion === 'recommend_include' : false;
    });
  }, [comps, rankingByCompId, displayMode, expandedLessRelevant]);

  const visibleSelectedCount = useMemo(
    () => visibleComps.filter((c) => selectedCompIds.has(c.id)).length,
    [visibleComps, selectedCompIds],
  );

  const handleToggle = (compId: string) => {
    void onToggleCompSelection(compId);
  };

  return (
    <section
      aria-label="Comparable properties"
      className="bg-white dark:bg-gray-900"
    >
      <div className="max-w-screen-2xl mx-auto px-3 sm:px-4 lg:px-6 py-5 space-y-3">
        {/* Section header */}
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Comparable Properties ({comps.length})
          </h2>

          <button
            type="button"
            disabled={running || comps.length === 0}
            onClick={() => start(false)}
            className="text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {running ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Picking…
              </>
            ) : result ? (
              <>✨ Re-pick</>
            ) : (
              <>✨ Pick for me</>
            )}
          </button>
          {running && (
            <button
              type="button"
              onClick={cancel}
              className="text-xs px-2 py-1.5 text-gray-600 dark:text-gray-400 hover:underline"
            >
              Cancel
            </button>
          )}

          <span className="text-xs text-gray-600 dark:text-gray-400">
            {visibleSelectedCount} of {visibleComps.length} selected
          </span>

          <div className="ml-auto flex items-center gap-2">
            <DisplayModeToggle value={displayMode} onChange={persistDisplayMode} />
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="text-xs px-2.5 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 inline-flex items-center gap-1"
              title="Filters & settings"
              aria-label="Open filters and settings"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
              </svg>
            </button>
          </div>
        </div>

        {/* Progress drawer while running */}
        {running && (
          <CurationProgressDrawer events={events} isRunning={running} />
        )}

        {/* Error states */}
        {!running && error && (
          <CurationEmptyState
            variant={
              error.code === 'TYPE_REQUIRED'
                ? 'type_required'
                : error.code === 'AI_PARSE_FAILED'
                  ? 'parse_error'
                  : 'network_error'
            }
            message={error.message}
            onRetry={() => start(true)}
          />
        )}

        {/* Stale banner */}
        {!running && result && isStale && (
          <StaleBanner onRerun={() => start(true)} />
        )}

        {/* AI Picks banner — only when AI has run and not stale */}
        {!running && result && !isStale && includedCount > 0 && (
          <AIPicksBanner
            result={result}
            pickedCount={includedCount}
            totalCount={comps.length}
            cachedAtMs={cachedFromMs}
            onRePick={() => start(true)}
            picking={picking || running}
          />
        )}

        {/* No-curated empty state */}
        {!running && result && !isStale && includedCount === 0 && (
          <CurationEmptyState
            variant="no_curated"
            message={result.summary}
            onRetry={() => start(true)}
          />
        )}

        {/* "Apply AI selection" CTA — only meaningful when AI has run */}
        {!running && result && includedCount > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!analysisId || picking}
              onClick={pickForMe}
              className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              title="Replace your current selection with the AI's recommended-include set"
            >
              {picking ? 'Applying…' : `Apply AI's ${includedCount} picks to selection`}
            </button>
            {onAddManualComp && (
              <button
                type="button"
                onClick={onAddManualComp}
                className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                + Add manual comp
              </button>
            )}
          </div>
        )}

        {/* Comp display switching on display mode */}
        {comps.length > 0 && (
          <>
            {displayMode === 'cards' && (
              <CardsGrid
                comps={visibleComps}
                rankingByCompId={rankingByCompId}
                subject={subject}
                selectedCompIds={selectedCompIds}
                onToggle={handleToggle}
                onAddressClick={onScrollToComp}
              />
            )}
            {displayMode === 'table' && (
              <CuratedCompsTable
                comps={visibleComps}
                rankingByCompId={rankingByCompId}
                subject={subject}
                cardSelections={Object.fromEntries(
                  visibleComps.map((c) => [c.id, selectedCompIds.has(c.id)]),
                )}
                onToggle={handleToggle}
                onAddressClick={onScrollToComp}
              />
            )}
            {displayMode === 'map' && (
              <CurationMapView
                lead={mapLead}
                comps={visibleComps}
                rankingByCompId={rankingByCompId}
                subject={subject}
                cardSelections={Object.fromEntries(
                  visibleComps.map((c) => [c.id, selectedCompIds.has(c.id)]),
                )}
                onToggle={handleToggle}
                onAddressClick={onScrollToComp}
              />
            )}

            {/* Less-relevant toggle: only meaningful in cards/map after AI ran */}
            {result && displayMode !== 'table' && (borderlineCount + excludedCount) > 0 && (
              <ShowLessRelevantToggle
                borderlineCount={borderlineCount}
                excludedCount={excludedCount}
                expanded={expandedLessRelevant}
                onToggle={() => setExpandedLessRelevant((v) => !v)}
              />
            )}
          </>
        )}

        {/* Filters drawer */}
        <FiltersDrawer
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          compsSource={filters.compsSource}
          batchDataEnabled={filters.batchDataEnabled}
          onSetCompsSource={filters.onSetCompsSource}
          onCompareProviders={() => {
            setFiltersOpen(false);
            filters.onCompareProviders();
          }}
          filterMonths={filters.filterMonths}
          filterDistance={filters.filterDistance}
          onSetFilterMonths={filters.onSetFilterMonths}
          onSetFilterDistance={filters.onSetFilterDistance}
          sortField={filters.sortField}
          sortDir={filters.sortDir}
          onSort={filters.onSort}
          onSelectAll={filters.onSelectAll}
          onRefreshComps={filters.onRefreshComps}
          onAddManual={() => {
            setFiltersOpen(false);
            onAddManualComp?.();
          }}
          fetchingComps={filters.fetchingComps}
        />
      </div>
    </section>
  );
}

// ── Cards grid ──────────────────────────────────────────────────────────

function CardsGrid({
  comps,
  rankingByCompId,
  subject,
  selectedCompIds,
  onToggle,
  onAddressClick,
}: {
  comps: CuratedCompCardComp[];
  rankingByCompId: Map<string, any> | undefined;
  subject: { bedrooms?: number | null; bathrooms?: number | null; sqft?: number | null };
  selectedCompIds: Set<string>;
  onToggle: (id: string) => void;
  onAddressClick?: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {comps.map((comp, i) => {
        const ranking = rankingByCompId?.get(comp.id);
        return (
          <CuratedCompCard
            key={comp.id}
            comp={comp}
            ranking={ranking}
            subject={subject}
            selected={selectedCompIds.has(comp.id)}
            onToggle={() => onToggle(comp.id)}
            onAddressClick={onAddressClick}
            index={i}
          />
        );
      })}
    </div>
  );
}
