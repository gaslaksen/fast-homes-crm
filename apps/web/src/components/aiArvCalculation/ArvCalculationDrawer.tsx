'use client';

import { useEffect, useState } from 'react';
import type { AIArvCalculationResult } from '@/lib/aiArvCalculation/types';
import ArvAdjustmentsTable from './ArvAdjustmentsTable';
import ArvCalculationHistory from './ArvCalculationHistory';

interface Props {
  result: AIArvCalculationResult | null;
  history: AIArvCalculationResult[];
  historyLoading?: boolean;
}

type Tab = 'adjustments' | 'method' | 'stats' | 'history';

export default function ArvCalculationDrawer({
  result,
  history,
  historyLoading,
}: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('adjustments');

  // Auto-expand the first time a result lands (or when an existing
  // result is replaced with a new computation). The user manually
  // toggles after that — we don't override their close.
  const [lastComputedAt, setLastComputedAt] = useState<string | null>(null);
  useEffect(() => {
    if (result && result.computedAt !== lastComputedAt) {
      setOpen(true);
      setLastComputedAt(result.computedAt);
    }
  }, [result, lastComputedAt]);

  return (
    <section className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
            ARV Calculation Details
          </span>
          {result == null && (
            <span className="text-[11px] text-gray-500">
              No calculation yet
            </span>
          )}
        </div>
        <span className="text-gray-500 text-sm">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 space-y-4">
          <nav className="flex gap-1 text-sm border-b border-gray-200 dark:border-gray-700">
            <TabButton current={tab} value="adjustments" set={setTab}>
              Adjustments
            </TabButton>
            <TabButton current={tab} value="method" set={setTab}>
              Method &amp; factors
            </TabButton>
            <TabButton current={tab} value="stats" set={setTab}>
              Stats
            </TabButton>
            <TabButton current={tab} value="history" set={setTab}>
              History
            </TabButton>
          </nav>

          {tab === 'adjustments' && (
            <div>
              {result ? (
                <ArvAdjustmentsTable adjustments={result.compAdjustments} />
              ) : (
                <p className="text-sm text-gray-500">
                  Run Calculate ARV to see per-comp adjustments.
                </p>
              )}
            </div>
          )}

          {tab === 'method' && (
            <div className="space-y-3 text-sm">
              {result ? (
                <>
                  <div>
                    <h4 className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                      Valuation method
                    </h4>
                    <p className="text-gray-800 dark:text-gray-200">
                      {result.valuationMethod}
                    </p>
                  </div>
                  <div>
                    <h4 className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                      Key factors
                    </h4>
                    <ul className="list-disc list-inside text-gray-800 dark:text-gray-200">
                      {result.keyFactors.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                      Risks
                    </h4>
                    <ul className="list-disc list-inside text-gray-800 dark:text-gray-200">
                      {result.risks.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                  {result.avmDivergenceNote && (
                    <div>
                      <h4 className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
                        AVM divergence note
                      </h4>
                      <p className="text-gray-800 dark:text-gray-200">
                        {result.avmDivergenceNote}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-500">
                  Run Calculate ARV to see method, key factors, and risks.
                </p>
              )}
            </div>
          )}

          {tab === 'stats' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              {result ? (
                <>
                  <Stat label="Comps used" value={result.stats.compsUsed} />
                  <Stat label="Avg sqft" value={result.stats.avgSqft.toLocaleString()} />
                  <Stat
                    label="Avg distance"
                    value={`${result.stats.avgDistanceMiles.toFixed(2)} mi`}
                  />
                  <Stat label="Avg DOM" value={`${result.stats.avgDom} d`} />
                  <Stat
                    label="Avg $/sqft"
                    value={`$${result.stats.avgPricePerSqft.toFixed(0)}`}
                  />
                  <Stat
                    label="Median $/sqft"
                    value={`$${result.stats.medianPricePerSqft.toFixed(0)}`}
                  />
                  <Stat
                    label="Avg months ago"
                    value={result.stats.avgMonthsAgo.toFixed(1)}
                  />
                  <Stat
                    label="Variance coeff"
                    value={result.stats.compVarianceCoeff.toFixed(3)}
                  />
                </>
              ) : (
                <p className="text-sm text-gray-500 col-span-full">
                  Run Calculate ARV to see comp stats.
                </p>
              )}
            </div>
          )}

          {tab === 'history' && (
            <ArvCalculationHistory history={history} loading={historyLoading} />
          )}
        </div>
      )}
    </section>
  );
}

function TabButton({
  current,
  value,
  set,
  children,
}: {
  current: Tab;
  value: Tab;
  set: (t: Tab) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => set(value)}
      className={`px-3 py-2 -mb-px border-b-2 ${
        active
          ? 'border-blue-500 text-blue-700 dark:text-blue-300 font-medium'
          : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="font-medium text-gray-900 dark:text-gray-100">
        {value}
      </div>
    </div>
  );
}
