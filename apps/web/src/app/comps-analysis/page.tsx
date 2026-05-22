'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { propertyLookupsAPI } from '@/lib/api';

interface AnalysisSnapshot {
  id: string;
  arvEstimate: number | null;
  arvLow: number | null;
  arvHigh: number | null;
  confidenceScore: number | null;
  confidenceTier: string | null;
  repairCosts: number | null;
  createdAt: string;
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
  compAnalyses: AnalysisSnapshot[];
}

type ViewFilter = 'active' | 'archived' | 'all';

const numberOrNull = (v: string): number | null => {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmtMoney = (v: number | null | undefined) =>
  v == null ? '-' : `$${Math.round(v).toLocaleString()}`;

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function CompsAnalysisLandingPage() {
  const router = useRouter();
  const [lookups, setLookups] = useState<PropertyLookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewFilter, setViewFilter] = useState<ViewFilter>('active');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form fields
  const [fAddress, setFAddress] = useState('');
  const [fCity, setFCity] = useState('');
  const [fState, setFState] = useState('');
  const [fZip, setFZip] = useState('');
  const [fBeds, setFBeds] = useState('');
  const [fBaths, setFBaths] = useState('');
  const [fSqft, setFSqft] = useState('');
  const [fYearBuilt, setFYearBuilt] = useState('');
  const [fLotSize, setFLotSize] = useState('');
  const [fNotes, setFNotes] = useState('');
  const [fRunNow, setFRunNow] = useState(true);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewFilter]);

  async function load() {
    setLoading(true);
    try {
      const archived =
        viewFilter === 'archived' ? true : viewFilter === 'active' ? false : undefined;
      const res = await propertyLookupsAPI.list({ archived });
      setLookups(res.data || []);
    } catch (err) {
      console.error('Failed to load property lookups', err);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lookups;
    return lookups.filter((l) =>
      [l.address, l.city, l.state, l.zip, l.propertyType]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [lookups, search]);

  function resetForm() {
    setFAddress('');
    setFCity('');
    setFState('');
    setFZip('');
    setFBeds('');
    setFBaths('');
    setFSqft('');
    setFYearBuilt('');
    setFLotSize('');
    setFNotes('');
    setFRunNow(true);
    setFormError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!fAddress.trim()) {
      setFormError('Street address is required.');
      return;
    }
    if (fRunNow && (!fCity.trim() || !fState.trim() || !fZip.trim())) {
      setFormError('City, state, and zip are required to run comps now.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await propertyLookupsAPI.create({
        address: fAddress.trim(),
        city: fCity.trim() || null,
        state: fState.trim() || null,
        zip: fZip.trim() || null,
        bedrooms: numberOrNull(fBeds),
        bathrooms: numberOrNull(fBaths),
        sqft: numberOrNull(fSqft),
        yearBuilt: numberOrNull(fYearBuilt),
        lotSize: numberOrNull(fLotSize),
        notes: fNotes.trim() || null,
      });
      const newId = created.data.id as string;
      if (fRunNow) {
        // Fire-and-forget. Detail page polls until lastRunAt updates.
        propertyLookupsAPI.analyze(newId, { preferSource: 'reapi' }).catch((err) => {
          console.error('Background analyze failed', err);
        });
      }
      resetForm();
      setShowForm(false);
      router.push(`/comps-analysis/${newId}`);
    } catch (err: any) {
      console.error('Create lookup failed', err);
      setFormError(err?.response?.data?.message || 'Failed to create lookup.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchive(lookup: PropertyLookup) {
    try {
      if (lookup.archivedAt) {
        await propertyLookupsAPI.unarchive(lookup.id);
      } else {
        await propertyLookupsAPI.archive(lookup.id);
      }
      await load();
    } catch (err) {
      console.error('Archive toggle failed', err);
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalActive = lookups.filter((l) => !l.archivedAt).length;
  const totalRuns = lookups.reduce((n, l) => n + (l.lastRunAt ? 1 : 0), 0);
  const recentRun = lookups
    .map((l) => l.lastRunAt)
    .filter(Boolean)
    .sort()
    .reverse()[0];
  const avgConfidence = (() => {
    const scores = lookups
      .map((l) => l.compAnalyses?.[0]?.confidenceScore)
      .filter((s): s is number => s != null && s > 0);
    if (scores.length === 0) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  })();

  return (
    <AppShell>
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Comps &amp; Analysis
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Ad-hoc property comping for addresses you haven&apos;t turned into leads yet.
            </p>
          </div>
          <button
            onClick={() => {
              setShowForm((v) => !v);
              setFormError(null);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <span>+</span> {showForm ? 'Close' : 'New Lookup'}
          </button>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Active Lookups', value: totalActive },
            { label: 'Comps Pulled', value: totalRuns },
            { label: 'Last Run', value: recentRun ? fmtDate(recentRun) : '-' },
            {
              label: 'Avg Confidence',
              value: avgConfidence != null ? `${avgConfidence}/100` : '-',
            },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4"
            >
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* New Lookup form */}
        {showForm && (
          <form
            onSubmit={handleCreate}
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-8"
          >
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
              New Property Lookup
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
              <div className="sm:col-span-3">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Street Address *
                </label>
                <input
                  value={fAddress}
                  onChange={(e) => setFAddress(e.target.value)}
                  placeholder="123 Main St"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  City
                </label>
                <input
                  value={fCity}
                  onChange={(e) => setFCity(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  State
                </label>
                <input
                  value={fState}
                  onChange={(e) => setFState(e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="OH"
                  maxLength={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Zip
                </label>
                <input
                  value={fZip}
                  onChange={(e) => setFZip(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Beds
                </label>
                <input
                  value={fBeds}
                  onChange={(e) => setFBeds(e.target.value)}
                  inputMode="numeric"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Baths
                </label>
                <input
                  value={fBaths}
                  onChange={(e) => setFBaths(e.target.value)}
                  inputMode="decimal"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Sqft
                </label>
                <input
                  value={fSqft}
                  onChange={(e) => setFSqft(e.target.value)}
                  inputMode="numeric"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Year Built
                </label>
                <input
                  value={fYearBuilt}
                  onChange={(e) => setFYearBuilt(e.target.value)}
                  inputMode="numeric"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Lot (acres)
                </label>
                <input
                  value={fLotSize}
                  onChange={(e) => setFLotSize(e.target.value)}
                  inputMode="decimal"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="sm:col-span-6">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Notes
                </label>
                <textarea
                  value={fNotes}
                  onChange={(e) => setFNotes(e.target.value)}
                  rows={2}
                  placeholder="Why are you looking at this one?"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={fRunNow}
                  onChange={(e) => setFRunNow(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Run comps immediately (REAPI)
              </label>
              <div className="flex items-center gap-2">
                {formError && (
                  <span className="text-xs text-red-600 dark:text-red-400">{formError}</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setShowForm(false);
                  }}
                  className="text-xs px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="text-xs px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : fRunNow ? 'Create + Run' : 'Create'}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Filter bar */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            {(['active', 'archived', 'all'] as ViewFilter[]).map((v) => (
              <button
                key={v}
                onClick={() => setViewFilter(v)}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                  viewFilter === v
                    ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search address, city, zip..."
            className="w-full sm:w-72 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">
            Loading lookups...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🏚️</div>
            <div className="text-lg font-medium text-gray-900 dark:text-gray-100">
              {search ? 'No lookups match your search.' : 'No lookups yet.'}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Start by adding a property address and running comps.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                    Address
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                    Details
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                    ARV
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                    Repairs
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                    Confidence
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                    Last Run
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((lookup) => {
                  const snapshot = lookup.compAnalyses?.[0];
                  return (
                    <tr
                      key={lookup.id}
                      onClick={() => router.push(`/comps-analysis/${lookup.id}`)}
                      className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition cursor-pointer last:border-b-0"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 dark:text-white">
                          {lookup.address}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {[lookup.city, lookup.state, lookup.zip]
                            .filter(Boolean)
                            .join(', ') || 'No location set'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        <div className="text-xs">
                          {lookup.bedrooms ?? '?'}bd / {lookup.bathrooms ?? '?'}ba /{' '}
                          {lookup.sqft ? lookup.sqft.toLocaleString() + ' sqft' : '? sqft'}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {lookup.yearBuilt ? `Built ${lookup.yearBuilt}` : 'Year unknown'}
                          {lookup.lotSize ? ` · ${lookup.lotSize} ac` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-medium text-gray-900 dark:text-white">
                          {fmtMoney(snapshot?.arvEstimate)}
                        </div>
                        {snapshot?.arvLow != null && snapshot?.arvHigh != null && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {fmtMoney(snapshot.arvLow)} - {fmtMoney(snapshot.arvHigh)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">
                        {fmtMoney(snapshot?.repairCosts)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {snapshot?.confidenceScore != null ? (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              (snapshot.confidenceTier || 'Low') === 'High'
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                : (snapshot.confidenceTier || 'Low') === 'Medium'
                                ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                            }`}
                          >
                            {snapshot.confidenceScore}/100
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300 text-xs">
                        {fmtDate(lookup.lastRunAt) === '-'
                          ? 'Never run'
                          : fmtDate(lookup.lastRunAt)}
                      </td>
                      <td
                        className="px-4 py-3 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => handleArchive(lookup)}
                          className="text-xs px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                        >
                          {lookup.archivedAt ? 'Unarchive' : 'Archive'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
