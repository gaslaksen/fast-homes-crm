'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { propertyLookupsAPI } from '@/lib/api';

interface Comp {
  id: string;
  address: string;
  distance: number;
  soldPrice: number;
  soldDate: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  source: string;
  selected: boolean;
  correlation: number | null;
  adjustedPrice: number | null;
  adjustmentAmount: number | null;
  notes: string | null;
}

interface Analysis {
  id: string;
  arvEstimate: number | null;
  arvLow: number | null;
  arvHigh: number | null;
  confidenceScore: number | null;
  confidenceTier: string | null;
  repairCosts: number | null;
  maoPercent: number;
  assignmentFee: number;
  dealType: string;
  aiSummary: string | null;
  comps: Comp[];
  maxDistance: number;
  timeFrameMonths: number;
  createdAt: string;
  updatedAt: string;
  // Subject is synthesized server-side from the PropertyLookup so the AI
  // prompts share a shape with the lead-side path.
  lead: {
    propertyAddress: string;
    propertyCity: string | null;
    propertyState: string | null;
    propertyZip: string | null;
    bedrooms: number | null;
    bathrooms: number | null;
    sqft: number | null;
    yearBuilt: number | null;
    lotSize: number | null;
    propertyType: string | null;
  } | null;
}

interface PropertyLookup {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  lotSize: number | null;
  notes: string | null;
  archivedAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  compAnalyses: Array<{ id: string; createdAt: string }>;
}

const fmtMoney = (v: number | null | undefined) =>
  v == null ? '-' : `$${Math.round(v).toLocaleString()}`;

const fmtMoneyShort = (v: number | null | undefined) => {
  if (v == null) return '-';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const monthsAgo = (iso: string) => {
  const d = new Date(iso).getTime();
  const months = (Date.now() - d) / (30 * 24 * 60 * 60 * 1000);
  return Math.round(months);
};

export default function CompsAnalysisDetailPage() {
  const router = useRouter();
  const params = useParams<{ lookupId: string }>();
  const lookupId = params?.lookupId as string;

  const [lookup, setLookup] = useState<PropertyLookup | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runningKind, setRunningKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLookup = useCallback(async () => {
    try {
      const res = await propertyLookupsAPI.get(lookupId);
      setLookup(res.data);
      return res.data as PropertyLookup;
    } catch (err) {
      console.error('Failed to load lookup', err);
      setError('Could not load this property lookup.');
      return null;
    }
  }, [lookupId]);

  const loadLatestAnalysis = useCallback(
    async (lookupRow: PropertyLookup) => {
      const latest = lookupRow.compAnalyses?.[0];
      if (!latest) {
        setAnalysis(null);
        return;
      }
      try {
        const res = await propertyLookupsAPI.getAnalysis(lookupId, latest.id);
        setAnalysis(res.data);
      } catch (err) {
        console.error('Failed to load analysis', err);
      }
    },
    [lookupId],
  );

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setLoading(true);
      const lookupRow = await loadLookup();
      if (lookupRow && !cancelled) await loadLatestAnalysis(lookupRow);
      if (!cancelled) setLoading(false);
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [loadLookup, loadLatestAnalysis]);

  // Poll while a run is in-flight. Background analyses kicked off from the
  // landing page finish out-of-band, so when there are no comps yet we keep
  // checking until lastRunAt advances or we time out.
  useEffect(() => {
    if (!lookup) return;
    const hasComps = (analysis?.comps?.length ?? 0) > 0;
    if (hasComps) return;
    if (!lookup.lastRunAt && !running) return;
    const id = setInterval(async () => {
      const row = await loadLookup();
      if (row?.lastRunAt && (!lookup.lastRunAt || row.lastRunAt !== lookup.lastRunAt)) {
        await loadLatestAnalysis(row);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [lookup, analysis, running, loadLookup, loadLatestAnalysis]);

  // ── Actions ───────────────────────────────────────────────────────────────
  async function runAnalysis(opts?: { preferSource?: 'reapi' | 'batchdata'; force?: boolean }) {
    setRunning(true);
    setRunningKind('comps');
    setError(null);
    try {
      const res = await propertyLookupsAPI.analyze(lookupId, {
        preferSource: opts?.preferSource ?? 'reapi',
        forceRefresh: opts?.force ?? false,
      });
      const row = await loadLookup();
      if (row) await loadLatestAnalysis(row);
      if (res.data?.fetchResult?.compsCount === 0) {
        setError(
          `No comps returned from ${res.data.fetchResult.source}. Try widening filters or another provider.`,
        );
      }
    } catch (err: any) {
      console.error('Run analysis failed', err);
      setError(err?.response?.data?.message || 'Failed to run analysis.');
    } finally {
      setRunning(false);
      setRunningKind(null);
    }
  }

  async function refreshAdjustments() {
    if (!analysis) return;
    setRunning(true);
    setRunningKind('adjust');
    try {
      await propertyLookupsAPI.calculateAdjustments(lookupId, analysis.id);
      const row = await loadLookup();
      if (row) await loadLatestAnalysis(row);
    } catch (err) {
      console.error('Adjust failed', err);
    } finally {
      setRunning(false);
      setRunningKind(null);
    }
  }

  async function runAiSummary() {
    if (!analysis) return;
    setRunning(true);
    setRunningKind('summary');
    try {
      await propertyLookupsAPI.aiSummary(lookupId, analysis.id);
      const row = await loadLookup();
      if (row) await loadLatestAnalysis(row);
    } catch (err) {
      console.error('AI summary failed', err);
    } finally {
      setRunning(false);
      setRunningKind(null);
    }
  }

  async function toggleComp(compId: string) {
    if (!analysis) return;
    try {
      await propertyLookupsAPI.toggleComp(lookupId, analysis.id, compId);
      setAnalysis({
        ...analysis,
        comps: analysis.comps.map((c) =>
          c.id === compId ? { ...c, selected: !c.selected } : c,
        ),
      });
    } catch (err) {
      console.error('Toggle comp failed', err);
    }
  }

  async function applyFilters(maxDistance: number, timeFrameMonths: number) {
    if (!analysis) return;
    setRunning(true);
    setRunningKind('filter');
    try {
      await propertyLookupsAPI.applyFilters(lookupId, analysis.id, {
        maxDistance,
        timeFrameMonths,
      });
      const row = await loadLookup();
      if (row) await loadLatestAnalysis(row);
    } catch (err) {
      console.error('Apply filters failed', err);
    } finally {
      setRunning(false);
      setRunningKind(null);
    }
  }

  const selectedComps = useMemo(
    () => analysis?.comps.filter((c) => c.selected) ?? [],
    [analysis],
  );

  const compsAvg = useMemo(() => {
    if (selectedComps.length === 0) return null;
    const total = selectedComps.reduce((s, c) => s + (c.adjustedPrice ?? c.soldPrice), 0);
    return Math.round(total / selectedComps.length);
  }, [selectedComps]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AppShell>
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-8">
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">Loading...</div>
        </div>
      </AppShell>
    );
  }
  if (!lookup) {
    return (
      <AppShell>
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-8">
          <Link href="/comps-analysis" className="text-sm text-blue-600 hover:underline">
            &larr; Back to lookups
          </Link>
          <div className="text-center py-16 text-gray-500">{error || 'Lookup not found.'}</div>
        </div>
      </AppShell>
    );
  }

  const subject = analysis?.lead ?? {
    propertyAddress: lookup.address,
    propertyCity: lookup.city,
    propertyState: lookup.state,
    propertyZip: lookup.zip,
    bedrooms: lookup.bedrooms,
    bathrooms: lookup.bathrooms,
    sqft: lookup.sqft,
    yearBuilt: lookup.yearBuilt,
    lotSize: lookup.lotSize,
    propertyType: lookup.propertyType,
  };

  return (
    <AppShell>
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-8">
        {/* Back nav */}
        <Link
          href="/comps-analysis"
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 transition-colors inline-flex items-center gap-1 mb-4"
        >
          &larr; All lookups
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {lookup.address}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {[lookup.city, lookup.state, lookup.zip].filter(Boolean).join(', ') ||
                'No location set'}
              {lookup.lastRunAt && (
                <span className="ml-2 text-gray-400">· Last run {fmtDate(lookup.lastRunAt)}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => runAnalysis({ preferSource: 'reapi', force: false })}
              disabled={running}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {running && runningKind === 'comps' ? 'Running...' : 'Run / Refresh Comps'}
            </button>
            <button
              onClick={() => runAnalysis({ preferSource: 'reapi', force: true })}
              disabled={running}
              className="text-xs px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium disabled:opacity-50"
            >
              Force Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-lg text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Subject card */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Subject Property
            </h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">Ad-hoc lookup</span>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-6 gap-4">
            <SubjectField label="Beds" value={subject.bedrooms ?? '-'} />
            <SubjectField label="Baths" value={subject.bathrooms ?? '-'} />
            <SubjectField
              label="Sqft"
              value={subject.sqft ? subject.sqft.toLocaleString() : '-'}
            />
            <SubjectField label="Year" value={subject.yearBuilt ?? '-'} />
            <SubjectField
              label="Lot"
              value={subject.lotSize != null ? `${subject.lotSize} ac` : '-'}
            />
            <SubjectField label="Type" value={subject.propertyType || '-'} />
          </dl>
          {lookup.notes && (
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Notes
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {lookup.notes}
              </p>
            </div>
          )}
        </div>

        {/* ARV / Deal summary */}
        {analysis ? (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
            <SummaryCard
              label="ARV Estimate"
              value={fmtMoney(analysis.arvEstimate)}
              detail={
                analysis.arvLow != null && analysis.arvHigh != null
                  ? `${fmtMoneyShort(analysis.arvLow)} - ${fmtMoneyShort(analysis.arvHigh)}`
                  : undefined
              }
            />
            <SummaryCard
              label="Confidence"
              value={
                analysis.confidenceScore != null
                  ? `${analysis.confidenceScore}/100`
                  : '-'
              }
              detail={analysis.confidenceTier ?? undefined}
              tier={analysis.confidenceTier}
            />
            <SummaryCard
              label="Repairs"
              value={fmtMoney(analysis.repairCosts)}
              detail={`MAO ${analysis.maoPercent}%`}
            />
            <SummaryCard
              label="Comps"
              value={`${selectedComps.length}/${analysis.comps.length}`}
              detail={compsAvg != null ? `avg ${fmtMoneyShort(compsAvg)}` : 'No selection'}
            />
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-8 mb-6 text-center">
            <div className="text-5xl mb-3">🔎</div>
            <div className="text-lg font-medium text-gray-900 dark:text-gray-100">
              No analysis yet
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">
              Click <strong>Run / Refresh Comps</strong> above to pull comps for this address.
            </p>
          </div>
        )}

        {/* AI summary */}
        {analysis && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Wholesaler Summary
              </h2>
              <button
                onClick={runAiSummary}
                disabled={running || selectedComps.length === 0}
                className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium disabled:opacity-50"
                title={selectedComps.length === 0 ? 'Select at least one comp first' : undefined}
              >
                {running && runningKind === 'summary'
                  ? 'Generating...'
                  : analysis.aiSummary
                  ? 'Regenerate'
                  : 'Generate'}
              </button>
            </div>
            {analysis.aiSummary ? (
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {analysis.aiSummary}
              </p>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                No summary yet. Generate one once you have selected comps.
              </p>
            )}
          </div>
        )}

        {/* Filters + comps table */}
        {analysis && analysis.comps.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-6">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Comparable Sales
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {selectedComps.length} of {analysis.comps.length} selected
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <FilterChip
                  label="Distance"
                  options={[1, 2, 3, 5]}
                  unit="mi"
                  current={analysis.maxDistance}
                  onPick={(v) => applyFilters(v, analysis.timeFrameMonths)}
                />
                <FilterChip
                  label="Age"
                  options={[6, 12, 24]}
                  unit="mo"
                  current={analysis.timeFrameMonths}
                  onPick={(v) => applyFilters(analysis.maxDistance, v)}
                />
                <button
                  onClick={refreshAdjustments}
                  disabled={running}
                  className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium disabled:opacity-50"
                >
                  {running && runningKind === 'adjust' ? 'Calculating...' : 'Recalculate Adjustments'}
                </button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="px-4 py-3 text-left w-8" />
                  <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                    Address
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                    Sold
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                    Adjusted
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                    Details
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-500 dark:text-gray-400">
                    Distance
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-500 dark:text-gray-400">
                    Correlation
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                    Sold Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {analysis.comps.map((comp) => (
                  <tr
                    key={comp.id}
                    className={`border-b border-gray-50 dark:border-gray-800/50 transition last:border-b-0 ${
                      comp.selected ? '' : 'opacity-50'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={comp.selected}
                        onChange={() => toggleComp(comp.id)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-white text-sm">
                        {comp.address}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Source: {comp.source}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                      {fmtMoney(comp.soldPrice)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                      {comp.adjustedPrice != null ? (
                        <>
                          <div>{fmtMoney(comp.adjustedPrice)}</div>
                          {comp.adjustmentAmount != null && (
                            <div
                              className={`text-xs ${
                                comp.adjustmentAmount >= 0
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-red-600 dark:text-red-400'
                              }`}
                            >
                              {comp.adjustmentAmount >= 0 ? '+' : ''}
                              {fmtMoneyShort(comp.adjustmentAmount)}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 text-xs">
                      {comp.bedrooms ?? '?'}bd / {comp.bathrooms ?? '?'}ba /{' '}
                      {comp.sqft ? comp.sqft.toLocaleString() + ' sqft' : '?'}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-300 text-xs">
                      {comp.distance != null ? `${comp.distance.toFixed(2)} mi` : '-'}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-300 text-xs">
                      {comp.correlation != null
                        ? `${Math.round(comp.correlation * 100)}%`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 text-xs">
                      {fmtDate(comp.soldDate)}
                      <div className="text-gray-400 dark:text-gray-500">
                        {monthsAgo(comp.soldDate)} mo ago
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function SubjectField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-900 dark:text-gray-100 font-medium mt-0.5">{value}</dd>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  tier,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  tier?: string | null;
}) {
  const tierColor =
    tier === 'High'
      ? 'text-green-600 dark:text-green-400'
      : tier === 'Medium'
      ? 'text-yellow-600 dark:text-yellow-400'
      : tier === 'Low'
      ? 'text-gray-500 dark:text-gray-400'
      : undefined;
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{value}</div>
      {detail && (
        <div className={`text-xs mt-1 ${tierColor || 'text-gray-500 dark:text-gray-400'}`}>
          {detail}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  options,
  unit,
  current,
  onPick,
}: {
  label: string;
  options: number[];
  unit: string;
  current: number;
  onPick: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-gray-500 dark:text-gray-400 font-medium">{label}:</span>
      <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onPick(opt)}
            className={`px-2 py-1 rounded-md font-medium transition-colors ${
              current === opt
                ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {opt}
            {unit}
          </button>
        ))}
      </div>
    </div>
  );
}
