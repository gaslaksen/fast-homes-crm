'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  runCuration,
  getLatestCuration,
  bulkSelectComps,
} from '@/lib/aiCompCuration/client';
import {
  readCurationView,
  writeCurationView,
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
import CurationExpansionNarrative from './CurationExpansionNarrative';
import CurationEmptyState from './CurationEmptyState';
import CuratedCompCard, {
  type CuratedCompCardComp,
} from './CuratedCompCard';
import SummaryHeader from './SummaryHeader';
import ViewToggle, { type CurationView } from './ViewToggle';
import StaleBanner from './StaleBanner';
import ShowLessRelevantToggle from './ShowLessRelevantToggle';
import MarketObservations from './MarketObservations';
import ActionBar from './ActionBar';
import DisplayModeToggle, { type DisplayMode } from './DisplayModeToggle';
import FiltersDrawer from './FiltersDrawer';
import CuratedCompsTable from './CuratedCompsTable';
import CurationMapView from './CurationMapView';

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
  // Optional — if provided, enables the Map display mode.
  mapLead?: MapLeadShape;
  // Optional — if provided, enables the Filters & Settings drawer.
  filters?: FiltersBundle;
  onCurationApplied?: () => void;
  onResultChange?: (result: CurationResult | null) => void;
  onAddManualComp?: () => void;
  onScrollToComp?: (compId: string) => void;
}

export default function CurationPanel({
  leadId,
  analysisId,
  comps,
  subject,
  mapLead,
  filters,
  onCurationApplied,
  onResultChange,
  onAddManualComp,
  onScrollToComp,
}: Props) {
  const [mode, setMode] = useState<ValuationMode>('ARV_RENOVATED');
  const [maxDistance, setMaxDistance] = useState<'auto' | number>('auto');
  const [constraints, setConstraints] = useState<HardConstraints>({});
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

  const [view, setView] = useState<CurationView>('curated');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('cards');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedLessRelevant, setExpandedLessRelevant] = useState(false);
  const [cardSelections, setCardSelections] = useState<Record<string, boolean>>(
    {},
  );

  // Load persisted view + display-mode preferences once on mount.
  useEffect(() => {
    setView(readCurationView());
    setDisplayMode(readDisplayMode());
  }, []);

  const persistView = (v: CurationView) => {
    setView(v);
    writeCurationView(v);
  };
  const persistDisplayMode = (m: DisplayMode) => {
    setDisplayMode(m);
    writeDisplayMode(m);
  };

  const input: RunCurationInput = {
    valuationMode: mode,
    hardConstraints: constraints,
    maxDistance,
  };

  // On mount and whenever inputs change, see if there's a cached curation
  // for this exact configuration.
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
  }, [leadId, mode, maxDistance, JSON.stringify(constraints)]);

  // Reset card selections to match AI recommendations whenever a new
  // result lands. User can override per-card before Pick for me.
  useEffect(() => {
    if (!result) {
      setCardSelections({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const r of result.rankings) {
      next[r.candidateId] = r.inclusion === 'recommend_include';
    }
    setCardSelections(next);
  }, [result]);

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

  const pickForMe = async () => {
    if (!result || !analysisId) return;
    setPicking(true);
    try {
      // Use the user's per-card selections (defaulted from AI recommendations
      // but overridable via card checkbox).
      const include = Object.entries(cardSelections)
        .filter(([, v]) => v)
        .map(([id]) => id);
      await bulkSelectComps(analysisId, include);
      onCurationApplied?.();
    } finally {
      setPicking(false);
    }
  };

  const compById = useMemo(
    () => new Map(comps.map((c) => [c.id, c])),
    [comps],
  );
  const orderedRankings = useMemo(
    () =>
      result
        ? [...result.rankings].sort((a, b) => a.rank - b.rank)
        : [],
    [result],
  );
  const includedRankings = orderedRankings.filter(
    (r) => r.inclusion === 'recommend_include',
  );
  const borderlineRankings = orderedRankings.filter(
    (r) => r.inclusion === 'borderline',
  );
  const excludedRankings = orderedRankings.filter(
    (r) => r.inclusion === 'recommend_exclude',
  );
  const lessRelevantRankings = [...borderlineRankings, ...excludedRankings];

  // "Stale" detection: when the current comp pool no longer matches what
  // the AI ranked. Compare sorted IDs. The cache key already invalidates
  // the saved row when the pool changes, so this only matters mid-session
  // (provider toggle, manual add) before the cache effect re-fires.
  const isStale = useMemo(() => {
    if (!result) return false;
    const ranked = orderedRankings.map((r) => r.candidateId).sort();
    const current = comps.map((c) => c.id).sort();
    if (ranked.length !== current.length) return true;
    for (let i = 0; i < ranked.length; i++) {
      if (ranked[i] !== current[i]) return true;
    }
    return false;
  }, [result, orderedRankings, comps]);

  const selectedCount = Object.values(cardSelections).filter(Boolean).length;

  return (
    <div className="space-y-3">
      {/* Input controls */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-semibold text-gray-700 dark:text-gray-300">
            AI Curation
          </span>
          <ModeToggle value={mode} onChange={setMode} />
          <DistancePicker value={maxDistance} onChange={setMaxDistance} />
          <ConstraintChips
            value={constraints}
            mode={mode}
            onChange={setConstraints}
          />
          <button
            type="button"
            disabled={running}
            onClick={() => start(false)}
            className="ml-auto text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run Curation'}
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
        </div>
        <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-500">
          AI will rank these comps by relevance and explain its reasoning. You
          stay in control of the final selection.
        </p>
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

      {/* Idle states */}
      {!running && !result && !error && comps.length === 0 && (
        <CurationEmptyState variant="zero_candidates" />
      )}
      {!running && !result && !error && comps.length > 0 && (
        <CurationEmptyState variant="idle" />
      )}

      {/* Results */}
      {!running && result && (
        <div className="space-y-3 pb-20">
          <SummaryHeader
            result={result}
            cachedAtMs={cachedFromMs}
            onRerun={() => start(true)}
            onOpenFilters={filters ? () => setFiltersOpen(true) : undefined}
          />

          <CurationExpansionNarrative expansion={result.searchExpansion} />

          {isStale && <StaleBanner onRerun={() => start(true)} />}

          {includedRankings.length === 0 ? (
            <CurationEmptyState
              variant="no_curated"
              message={result.summary}
              onRetry={() => start(true)}
              onShowAll={() => persistView('all')}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ViewToggle
                  value={view}
                  onChange={persistView}
                  curatedCount={includedRankings.length}
                  totalCount={orderedRankings.length}
                  selectedCount={
                    view === 'curated'
                      ? includedRankings.filter(
                          (r) => cardSelections[r.candidateId],
                        ).length
                      : selectedCount
                  }
                  selectedTotal={
                    view === 'curated'
                      ? includedRankings.length
                      : orderedRankings.length
                  }
                />
                <DisplayModeToggle
                  value={displayMode}
                  onChange={persistDisplayMode}
                />
              </div>

              {/* Display mode-driven content */}
              {(() => {
                // The "main" rankings respect Curated vs All-Ranked view.
                // Cards mode keeps the historical split: curated grid
                // above, less-relevant expansion below. Table and Map
                // append less-relevant inline when expanded.
                const mainRankings =
                  view === 'curated' ? includedRankings : orderedRankings;
                const expandedLess =
                  view === 'curated' && expandedLessRelevant
                    ? lessRelevantRankings
                    : [];
                const onToggle = (id: string) =>
                  setCardSelections((prev) => ({ ...prev, [id]: !prev[id] }));

                if (displayMode === 'table') {
                  const tableRankings =
                    view === 'curated'
                      ? expandedLessRelevant
                        ? [...includedRankings, ...lessRelevantRankings]
                        : includedRankings
                      : orderedRankings;
                  return (
                    <CuratedCompsTable
                      rankings={tableRankings}
                      compById={compById}
                      subject={subject}
                      cardSelections={cardSelections}
                      onToggle={onToggle}
                      onAddressClick={onScrollToComp}
                    />
                  );
                }

                if (displayMode === 'map' && mapLead) {
                  const mapRankings =
                    view === 'curated'
                      ? expandedLessRelevant
                        ? [...includedRankings, ...lessRelevantRankings]
                        : includedRankings
                      : orderedRankings;
                  return (
                    <CurationMapView
                      lead={mapLead}
                      rankings={mapRankings}
                      compById={compById}
                      subject={subject}
                      cardSelections={cardSelections}
                      onToggle={onToggle}
                      onAddressClick={onScrollToComp}
                    />
                  );
                }

                // Cards mode (default) — curated grid + optional less-
                // relevant grid below.
                return (
                  <>
                    <CompGrid
                      rankings={mainRankings}
                      compById={compById}
                      subject={subject}
                      cardSelections={cardSelections}
                      onToggle={onToggle}
                      onAddressClick={onScrollToComp}
                    />
                    {expandedLess.length > 0 && (
                      <CompGrid
                        rankings={expandedLess}
                        compById={compById}
                        subject={subject}
                        cardSelections={cardSelections}
                        onToggle={onToggle}
                        onAddressClick={onScrollToComp}
                      />
                    )}
                  </>
                );
              })()}

              {/* "Show less relevant" toggle — applies in curated view across all display modes */}
              {view === 'curated' && (
                <ShowLessRelevantToggle
                  borderlineCount={borderlineRankings.length}
                  excludedCount={excludedRankings.length}
                  expanded={expandedLessRelevant}
                  onToggle={() => setExpandedLessRelevant((v) => !v)}
                />
              )}

              {selectedCount === 0 && (
                <div className="rounded-md border border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 p-2.5 text-xs text-yellow-900 dark:text-yellow-200">
                  No comps selected. Use &quot;Pick for me&quot; to restore the
                  AI&apos;s recommendations.
                </div>
              )}
            </>
          )}

          <MarketObservations observations={result.marketObservations} />

          <ExclusionsCollapsible result={result} compById={compById} />
        </div>
      )}

      {/* Sticky action bar — pinned to viewport bottom. Only visible
          while a curation result is loaded so the bar doesn't appear
          before the user has anything to act on. The page content
          gets pb-20 above to avoid being covered. */}
      {!running && result && includedRankings.length > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur"
          role="region"
          aria-label="Curation actions"
        >
          <div className="max-w-screen-2xl mx-auto px-3 sm:px-4 py-2">
            <ActionBar
              canPick={!!analysisId && includedRankings.length > 0}
              picking={picking}
              onPickForMe={pickForMe}
              onAddManual={onAddManualComp}
              onRerunWithDifferentSettings={() => {
                // Collapse results and let the user adjust input controls.
                setResult(null);
                onResultChange?.(null);
                setCachedFromMs(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Filters & Settings drawer */}
      {filters && (
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
      )}
    </div>
  );
}

// ── Local subcomponents ─────────────────────────────────────────────────

function CompGrid({
  rankings,
  compById,
  subject,
  cardSelections,
  onToggle,
  onAddressClick,
}: {
  rankings: ReturnType<
    NonNullable<CurationResult>['rankings']['filter']
  > extends infer T
    ? T
    : never;
  compById: Map<string, CuratedCompCardComp>;
  subject: Props['subject'];
  cardSelections: Record<string, boolean>;
  onToggle: (id: string) => void;
  onAddressClick?: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {(rankings as any[]).map((r: any, i: number) => {
        const comp = compById.get(r.candidateId);
        if (!comp) return null;
        return (
          <CuratedCompCard
            key={r.candidateId}
            comp={comp}
            ranking={r}
            subject={subject}
            selected={!!cardSelections[r.candidateId]}
            onToggle={() => onToggle(r.candidateId)}
            onAddressClick={onAddressClick}
            index={i}
          />
        );
      })}
    </div>
  );
}

function ExclusionsCollapsible({
  result,
  compById,
}: {
  result: CurationResult;
  compById: Map<string, CuratedCompCardComp>;
}) {
  const total =
    result.excludedDueToTypeMismatch.length +
    result.excludedDueToConstraints.length;
  if (total === 0) return null;
  return (
    <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <summary className="cursor-pointer p-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
        Pre-AI exclusions ({total})
      </summary>
      <div className="p-3 pt-0 space-y-2 text-xs">
        {result.excludedDueToTypeMismatch.length > 0 && (
          <div>
            <div className="font-medium text-gray-600 dark:text-gray-400 mb-1">
              Type mismatches
            </div>
            <ul className="list-disc pl-4 text-gray-600 dark:text-gray-400">
              {result.excludedDueToTypeMismatch.map((e) => (
                <li key={e.candidateId}>
                  {compById.get(e.candidateId)?.address ?? e.candidateId}
                  <span className="text-gray-400"> — {e.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.excludedDueToConstraints.length > 0 && (
          <div>
            <div className="font-medium text-gray-600 dark:text-gray-400 mb-1">
              Constraint exclusions
            </div>
            <ul className="list-disc pl-4 text-gray-600 dark:text-gray-400">
              {result.excludedDueToConstraints.map((e) => (
                <li key={e.candidateId}>
                  {compById.get(e.candidateId)?.address ?? e.candidateId}
                  <span className="text-gray-400"> — {e.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

function ModeToggle({
  value,
  onChange,
}: {
  value: ValuationMode;
  onChange: (v: ValuationMode) => void;
}) {
  return (
    <div className="inline-flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden text-[11px]">
      {(['ARV_RENOVATED', 'AS_IS'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`px-2 py-1 ${
            value === m
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
          title={
            m === 'ARV_RENOVATED'
              ? 'Renovated comps for fix-and-flip / retail value'
              : 'Condition-matched comps for current state value'
          }
        >
          {m === 'ARV_RENOVATED' ? 'ARV' : 'As-Is'}
        </button>
      ))}
    </div>
  );
}

function DistancePicker({
  value,
  onChange,
}: {
  value: 'auto' | number;
  onChange: (v: 'auto' | number) => void;
}) {
  const options: Array<'auto' | number> = ['auto', 0.5, 1, 2, 3, 5, 10];
  return (
    <select
      className="text-[11px] rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 px-2 py-1"
      value={typeof value === 'number' ? String(value) : 'auto'}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === 'auto' ? 'auto' : Number(v));
      }}
      title="AI determines optimal radius based on market density and inventory; expands automatically when needed"
    >
      {options.map((o) => (
        <option
          key={String(o)}
          value={typeof o === 'number' ? String(o) : 'auto'}
        >
          {o === 'auto' ? 'Auto distance' : `${o} mi`}
        </option>
      ))}
    </select>
  );
}

function ConstraintChips({
  value,
  mode,
  onChange,
}: {
  value: HardConstraints;
  mode: ValuationMode;
  onChange: (v: HardConstraints) => void;
}) {
  const toggle = <K extends keyof HardConstraints>(key: K) => {
    onChange({ ...value, [key]: !value[key] });
  };
  const chip = (
    label: string,
    key: keyof HardConstraints,
    show = true,
  ) => {
    if (!show) return null;
    const active = !!value[key];
    return (
      <button
        key={key as string}
        type="button"
        onClick={() => toggle(key)}
        className={`text-[10px] px-2 py-0.5 rounded-full border ${
          active
            ? 'bg-blue-600 border-blue-600 text-white'
            : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="flex flex-wrap gap-1">
      {chip('Beds/baths exact', 'matchBedsBathsExact')}
      {chip('Same school', 'sameSchoolDistrict')}
      {chip('Same subdivision', 'sameSubdivision')}
      {chip('Renovated only', 'renovatedOnly', mode === 'ARV_RENOVATED')}
      {chip('Distressed only', 'distressedOnly', mode === 'AS_IS')}
      {chip('Has garage', 'hasGarage')}
      {chip('Has pool', 'hasPool')}
    </div>
  );
}
