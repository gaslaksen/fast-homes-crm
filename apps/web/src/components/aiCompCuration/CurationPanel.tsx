'use client';

import { useEffect, useState } from 'react';
import {
  runCuration,
  getLatestCuration,
  bulkSelectComps,
} from '@/lib/aiCompCuration/client';
import type {
  CurationResult,
  HardConstraints,
  RunCurationInput,
  StepEvent,
  ValuationMode,
} from '@/lib/aiCompCuration/types';
import CurationProgressDrawer from './CurationProgressDrawer';
import CurationExpansionNarrative from './CurationExpansionNarrative';
import CurationReasoningCard from './CurationReasoningCard';
import CurationEmptyState from './CurationEmptyState';

interface Props {
  leadId: string;
  analysisId: string | null;
  comps: Array<{ id: string; address: string }>;
  onCurationApplied?: () => void;
  onResultChange?: (result: CurationResult | null) => void;
}

export default function CurationPanel({
  leadId,
  analysisId,
  comps,
  onCurationApplied,
  onResultChange,
}: Props) {
  const [mode, setMode] = useState<ValuationMode>('ARV_RENOVATED');
  const [maxDistance, setMaxDistance] = useState<'auto' | number>('auto');
  const [constraints, setConstraints] = useState<HardConstraints>({});
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<CurationResult | null>(null);
  const [error, setError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [cancelHandle, setCancelHandle] = useState<{ cancel: () => void } | null>(null);
  const [cachedFromMs, setCachedFromMs] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);

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
        if (code === 'TYPE_REQUIRED') {
          setError({ code, message: err.message });
        } else if (code === 'AI_PARSE_FAILED') {
          setError({ code, message: err.message });
        } else if (err.message !== 'cancelled') {
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
      const include = result.rankings
        .filter((r) => r.inclusion === 'recommend_include')
        .map((r) => r.candidateId);
      await bulkSelectComps(analysisId, include);
      onCurationApplied?.();
    } finally {
      setPicking(false);
    }
  };

  const compById = new Map(comps.map((c) => [c.id, c]));
  const orderedRankings = result
    ? [...result.rankings].sort((a, b) => a.rank - b.rank)
    : [];

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
          AI will rank these comps by relevance and explain its reasoning. You stay in control of the final selection.
        </p>
      </div>

      {/* Progress drawer while running */}
      {running && <CurationProgressDrawer events={events} isRunning={running} />}

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

      {/* Idle empty state when no result + no error */}
      {!running && !result && !error && comps.length === 0 && (
        <CurationEmptyState variant="zero_candidates" />
      )}

      {/* Results */}
      {!running && result && (
        <div className="space-y-3">
          <CurationExpansionNarrative expansion={result.searchExpansion} />

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      result.valuationMode === 'ARV_RENOVATED'
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                        : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                    }`}
                  >
                    {result.valuationMode === 'ARV_RENOVATED' ? 'ARV Mode' : 'As-Is Mode'}
                  </span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    Recommended top {result.recommendedTopCount}
                  </span>
                  {cachedFromMs && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                      from cache · {humanAge(cachedFromMs)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                  {result.summary}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  disabled={!analysisId || picking}
                  onClick={pickForMe}
                  className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  title="Auto-check the AI's recommended-include comps in the list below"
                >
                  {picking ? 'Applying…' : 'Pick for me'}
                </button>
                <button
                  type="button"
                  onClick={() => start(true)}
                  className="text-xs px-3 py-1.5 rounded text-gray-600 dark:text-gray-400 hover:underline"
                >
                  Re-run
                </button>
              </div>
            </div>
          </div>

          {result.marketObservations.length > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900/50">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Market observations
              </div>
              <ul className="text-xs text-gray-600 dark:text-gray-400 list-disc pl-4 space-y-0.5">
                {result.marketObservations.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          )}

          {(result.excludedDueToTypeMismatch.length > 0 ||
            result.excludedDueToConstraints.length > 0) && (
            <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <summary className="cursor-pointer p-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
                Excluded ({result.excludedDueToTypeMismatch.length +
                  result.excludedDueToConstraints.length})
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
          )}

          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              Ranked comps ({orderedRankings.length})
            </div>
            {orderedRankings.map((r) => (
              <CurationReasoningCard
                key={r.candidateId}
                ranking={r}
                address={compById.get(r.candidateId)?.address}
              />
            ))}
          </div>
        </div>
      )}
    </div>
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
        <option key={String(o)} value={typeof o === 'number' ? String(o) : 'auto'}>
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

function humanAge(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
