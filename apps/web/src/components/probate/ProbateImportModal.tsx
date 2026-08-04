'use client';

import { useCallback, useRef, useState } from 'react';
import { probateAPI } from '@/lib/api';

interface ParseResult {
  sheetName: string;
  headers: string[];
  recognized: string[];
  unrecognized: string[];
  totalRows: number;
  tierCounts: Record<string, number>;
}

interface ImportResult {
  created: number;
  duplicates: number;
  filteredOut: number;
  primaryContacts: number;
  errors: { row: number; reason: string }[];
  phoneConflicts: { leadId: string; phone: string; otherSources: string[] }[];
}

/** Tier number out of "Tier 1 - Attack First". */
function tierNumber(label: string): number | null {
  const m = /tier\s*(\d+)/i.exec(label);
  return m ? Number(m[1]) : null;
}

export default function ProbateImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [tier, setTier] = useState<string>('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setParsed(null);
    setResult(null);
    setError('');
    setBusy(true);
    try {
      const res = await probateAPI.importParse(f);
      setParsed(res.data);
      // Default to the highest-priority tier the sheet actually contains.
      const tiers = Object.keys(res.data.tierCounts)
        .map(tierNumber)
        .filter((n): n is number => n != null)
        .sort((a, b) => a - b);
      if (tiers.length) setTier(String(tiers[0]));
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not read that file');
    } finally {
      setBusy(false);
    }
  }, []);

  const selectedCount = (() => {
    if (!parsed) return 0;
    if (tier === 'all') return parsed.totalRows;
    return Object.entries(parsed.tierCounts)
      .filter(([label]) => String(tierNumber(label)) === tier)
      .reduce((sum, [, n]) => sum + n, 0);
  })();

  const runImport = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const res = await probateAPI.importExecute(file, {
        tier: tier === 'all' ? null : Number(tier),
      });
      setResult(res.data);
      onImported();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Import probate list</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Leads load on hold. No text or email goes out until you enroll them in a campaign.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none px-2">
            &times;
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* ── Step 1: the file ── */}
          {!result && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-lg px-4 py-8 text-center cursor-pointer transition-colors ${
                dragging
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-950'
                  : 'border-gray-200 dark:border-gray-700 hover:border-primary-400'
              }`}
            >
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {file ? file.name : 'Drop the workbook here, or click to choose'}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">.xlsx, .xls or .csv</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = '';
                }}
              />
            </div>
          )}

          {busy && !result && (
            <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse text-center">
              {parsed ? 'Importing...' : 'Reading the file...'}
            </p>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 px-3 py-2">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* ── Step 2: what we found, and which tier to take ── */}
          {parsed && !result && (
            <>
              <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-4 py-3 space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs uppercase tracking-wide text-gray-400">Sheet</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                    {parsed.sheetName}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs uppercase tracking-wide text-gray-400">Rows</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {parsed.totalRows.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs uppercase tracking-wide text-gray-400">Columns mapped</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {parsed.recognized.length} of {parsed.headers.length}
                  </span>
                </div>
                {parsed.unrecognized.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-500 pt-1">
                    Ignored: {parsed.unrecognized.join(', ')}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                  Which tier to load
                </label>
                <div className="space-y-1.5">
                  {Object.entries(parsed.tierCounts)
                    .sort(([a], [b]) => (tierNumber(a) ?? 99) - (tierNumber(b) ?? 99))
                    .map(([label, count]) => {
                      const n = tierNumber(label);
                      if (n == null) return null;
                      return (
                        <label
                          key={label}
                          className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          <input
                            type="radio"
                            name="tier"
                            value={String(n)}
                            checked={tier === String(n)}
                            onChange={(e) => setTier(e.target.value)}
                          />
                          <span className="text-sm text-gray-800 dark:text-gray-200 flex-1">{label}</span>
                          <span className="text-xs text-gray-400">{count.toLocaleString()} rows</span>
                        </label>
                      );
                    })}
                  <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                    <input
                      type="radio"
                      name="tier"
                      value="all"
                      checked={tier === 'all'}
                      onChange={(e) => setTier(e.target.value)}
                    />
                    <span className="text-sm text-gray-800 dark:text-gray-200 flex-1">Every tier</span>
                    <span className="text-xs text-gray-400">{parsed.totalRows.toLocaleString()} rows</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button onClick={onClose} className="btn btn-secondary btn-sm">Cancel</button>
                <button
                  onClick={runImport}
                  disabled={busy || selectedCount === 0}
                  className="btn btn-primary btn-sm disabled:opacity-50"
                >
                  Import {selectedCount.toLocaleString()} row{selectedCount === 1 ? '' : 's'}
                </button>
              </div>
            </>
          )}

          {/* ── Step 3: what happened ── */}
          {result && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Leads added" value={result.created} accent />
                <Stat label="People to contact" value={result.primaryContacts} accent />
                <Stat label="Already had" value={result.duplicates} />
                <Stat label="Other tiers, skipped" value={result.filteredOut} />
              </div>

              {result.created > result.primaryContacts && (
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  {result.created - result.primaryContacts} of these properties belong to an heir who
                  already has another property in the list. Each is its own lead, but only the{' '}
                  {result.primaryContacts} marked contacts should go into a drip, or one person gets
                  texted once per house they inherited.
                </p>
              )}

              {result.phoneConflicts.length > 0 && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 px-3 py-2">
                  <p className="text-xs text-amber-800 dark:text-amber-400">
                    {result.phoneConflicts.length} of these phone numbers already belong to a lead from
                    another source ({Array.from(new Set(result.phoneConflicts.flatMap((c) => c.otherSources))).join(', ')}).
                    Worth checking before both lists start messaging them.
                  </p>
                </div>
              )}

              {result.errors.length > 0 && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 px-3 py-2 max-h-40 overflow-y-auto">
                  <p className="text-xs font-semibold text-red-800 dark:text-red-400 mb-1">
                    {result.errors.length} row{result.errors.length === 1 ? '' : 's'} could not load
                  </p>
                  <ul className="text-xs text-red-700 dark:text-red-400 space-y-0.5">
                    {result.errors.slice(0, 15).map((e, i) => (
                      <li key={i}>Row {e.row}: {e.reason}</li>
                    ))}
                    {result.errors.length > 15 && <li>...and {result.errors.length - 15} more</li>}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => { setFile(null); setParsed(null); setResult(null); }}
                  className="btn btn-secondary btn-sm"
                >
                  Import another
                </button>
                <button onClick={onClose} className="btn btn-primary btn-sm">Done</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2.5">
      <p className={`text-xl font-bold ${accent ? 'text-primary-600 dark:text-primary-400' : 'text-gray-800 dark:text-gray-200'}`}>
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}
