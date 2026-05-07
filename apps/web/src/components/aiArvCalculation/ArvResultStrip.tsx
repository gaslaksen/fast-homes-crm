'use client';

import { useMemo } from 'react';
import type {
  AIArvCalculationResult,
  ConfidenceLabel,
  ValuationMode,
} from '@/lib/aiArvCalculation/types';

export type StripState = 'pre-calc' | 'post-calc' | 'stale' | 'calculating';

interface Props {
  state: StripState;
  result: AIArvCalculationResult | null;
  reapiAvm: number | null;
  mode: ValuationMode;
  onCalculate: () => void;
  selectedCount: number;
  errorMessage?: string | null;
}

export default function ArvResultStrip({
  state,
  result,
  reapiAvm,
  mode,
  onCalculate,
  selectedCount,
  errorMessage,
}: Props) {
  const arv = result?.arv ?? null;
  const ppsf = result?.pricePerSqft ?? null;
  const lo = result?.arvLow ?? null;
  const hi = result?.arvHigh ?? null;
  const conf = result?.confidence ?? null;
  const confLabel = result?.confidenceLabel ?? null;

  const reapiDelta = useMemo(() => {
    if (!arv || !reapiAvm || reapiAvm <= 0) return null;
    const delta = (arv - reapiAvm) / reapiAvm;
    return Number(delta.toFixed(3));
  }, [arv, reapiAvm]);

  const deltaSeverity =
    reapiDelta == null
      ? 'none'
      : Math.abs(reapiDelta) > 0.25
        ? 'high'
        : Math.abs(reapiDelta) > 0.15
          ? 'medium'
          : 'none';

  const stale = state === 'stale';
  const empty = state === 'pre-calc';
  const calculating = state === 'calculating';

  return (
    <div
      className={`rounded-md border px-3 py-3 transition-colors ${
        empty
          ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
          : stale
            ? 'border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/15'
            : 'border-primary-300 dark:border-primary-800 bg-primary-50/70 dark:bg-primary-900/20'
      }`}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
        <Cell label="Dealcore ARV" emphasis>
          <span className={stale ? 'text-gray-400 dark:text-gray-500' : ''}>
            {empty ? '—' : arv != null ? formatMoney(arv) : '—'}
          </span>
          {!empty && conf != null && confLabel && (
            <div
              className={`mt-0.5 text-[11px] font-medium ${
                stale
                  ? 'text-gray-400'
                  : confLabel === 'HIGH'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : confLabel === 'MEDIUM'
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {conf}% confidence ({confLabel.toLowerCase()})
            </div>
          )}
        </Cell>
        <Cell label="$/sqft">
          <span className={stale ? 'text-gray-400 dark:text-gray-500' : ''}>
            {empty || ppsf == null ? '—' : `$${Math.round(ppsf).toLocaleString()}`}
          </span>
        </Cell>
        <Cell label="Range">
          <span className={stale ? 'text-gray-400 dark:text-gray-500' : ''}>
            {empty || lo == null || hi == null
              ? '—'
              : `${formatShort(lo)} – ${formatShort(hi)}`}
          </span>
        </Cell>
        <Cell label="REAPI ARV (reference)">
          {reapiAvm != null ? (
            <div>
              <div>{formatMoney(reapiAvm)}</div>
              {reapiDelta != null && deltaSeverity !== 'none' && !stale && (
                <div
                  className={`mt-0.5 text-[11px] font-medium ${
                    deltaSeverity === 'high'
                      ? 'text-rose-700 dark:text-rose-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  ⚠ {reapiDelta > 0 ? '+' : ''}
                  {Math.round(reapiDelta * 100)}% vs Dealcore
                </div>
              )}
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-0.5">
                External estimate
              </div>
            </div>
          ) : (
            <span className="text-gray-400">REAPI estimate unavailable</span>
          )}
        </Cell>
      </div>

      {/* Action row */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {empty && (
          <button
            type="button"
            onClick={onCalculate}
            disabled={selectedCount < 2 || calculating}
            className="btn btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {calculating && <Spinner />}
            {calculating
              ? 'Calculating ARV (this can take 20–40s)…'
              : `Calculate ARV from ${selectedCount} selected comps →`}
          </button>
        )}
        {stale && (
          <>
            <span className="text-sm text-amber-800 dark:text-amber-300">
              Comp selection changed — recalculate to refresh ARV.
            </span>
            <button
              type="button"
              onClick={onCalculate}
              disabled={selectedCount < 2 || calculating}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-500 disabled:bg-gray-300 text-white text-sm font-medium"
            >
              {calculating && <Spinner />}
              {calculating ? 'Recalculating…' : 'Recalculate'}
            </button>
          </>
        )}
        {state === 'post-calc' && (
          <>
            <span className="text-[11px] text-gray-500 dark:text-gray-500">
              {result?.cached ? 'Cached result — inputs unchanged. ' : ''}
              Mode: {mode === 'AS_IS' ? 'As-is' : 'ARV (renovated)'}
            </span>
            <button
              type="button"
              onClick={onCalculate}
              disabled={calculating}
              className="ml-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {calculating && <Spinner />}
              {calculating ? 'Recalculating…' : 'Recalculate'}
            </button>
          </>
        )}
        {calculating && (
          <span className="text-[12px] text-gray-600 dark:text-gray-400">
            Running Opus 4.7 — usually 20–40s.
          </span>
        )}
        {errorMessage && (
          <div className="text-sm text-rose-700 dark:text-rose-400">
            {errorMessage}
          </div>
        )}
      </div>

      {result?.avmDivergenceNote && state === 'post-calc' && (
        <div className="mt-2 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-2 py-1.5 text-[12px] text-amber-900 dark:text-amber-200">
          <span className="font-medium">AVM divergence:</span>{' '}
          {result.avmDivergenceNote}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"
      aria-label="Loading"
    />
  );
}

function Cell({
  label,
  children,
  emphasis,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-500">
        {label}
      </div>
      <div
        className={`truncate ${
          emphasis
            ? 'text-xl font-semibold text-primary-700 dark:text-primary-300'
            : 'text-sm font-medium text-gray-800 dark:text-gray-200'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function formatShort(n: number): string {
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n)}`;
}
