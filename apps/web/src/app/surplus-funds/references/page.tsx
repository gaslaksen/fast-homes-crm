'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { surplusAPI } from '@/lib/api';
import { usd } from '@/lib/surplus-money';

/**
 * The reference library: paid claimants, whether they agreed to be named,
 * and their story, searchable by county. The course names references as
 * the strongest answer to "can I trust you", and this is where the right
 * one is found in seconds during a call. The recoveries counter at the top
 * is the milestone the credibility packet quotes.
 */

interface Reference {
  id: string;
  leadId: string;
  claimantName: string;
  county: string | null;
  state: string;
  consented: boolean;
  consentedAt: string | null;
  story: string | null;
  quote: string | null;
  amountRecovered: number | null;
  paidAt: string | null;
}

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

export default function ReferencesPage() {
  const [rows, setRows] = useState<Reference[]>([]);
  const [recoveries, setRecoveries] = useState(0);
  const [consented, setConsented] = useState(0);
  const [county, setCounty] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const say = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    try {
      const r = await surplusAPI.references(county.trim() || null);
      setRows(r.data?.references || []);
      setRecoveries(r.data?.recoveries || 0);
      setConsented(r.data?.consented || 0);
    } catch {
      say('The references could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [county]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const copy = async (r: Reference) => {
    const text = `${r.claimantName}${r.county ? ` in ${r.county} County` : ''} let us share their story${r.quote ? `: "${r.quote}"` : '.'}`;
    try {
      await navigator.clipboard.writeText(text);
      say('Copied, ready to paste into a text');
    } catch {
      say('Copy blocked by the browser');
    }
  };

  return (
    <AppShell>
      <main className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <Link href="/surplus-funds" className="text-sm text-primary-600 hover:underline">
              &larr; Surplus Funds
            </Link>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-2">References</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">
              Paid claimants who agreed to be named to the next one. Only consented references are ever shared.
            </p>
          </div>
          <div className="flex gap-6">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Recoveries</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{recoveries}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Consented references</div>
              <div className="text-2xl font-bold text-green-700 dark:text-green-400">{consented}</div>
            </div>
          </div>
        </div>

        {toast && (
          <div className="mb-4 max-w-2xl rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-800 dark:text-primary-200 text-sm px-4 py-2">
            {toast}
          </div>
        )}

        <input
          className="input max-w-xs mb-4"
          value={county}
          onChange={(e) => setCounty(e.target.value)}
          placeholder="Search by county"
        />

        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500">
            No references yet. They are recorded from a paid claim's work panel, in the After the payout section.
          </p>
        ) : (
          <div className="grid gap-3">
            {rows.map((r) => (
              <div key={r.id} className="card flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-[240px]">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{r.claimantName}</span>
                    {r.county && <span className="text-sm text-gray-500">{r.county} County</span>}
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        r.consented
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {r.consented ? `Consented ${fmt(r.consentedAt)}` : 'Not consented'}
                    </span>
                  </div>
                  {r.quote && <div className="text-sm text-gray-800 dark:text-gray-200 mt-1">"{r.quote}"</div>}
                  {r.story && <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">{r.story}</div>}
                  <div className="text-xs text-gray-500 mt-1">
                    {r.amountRecovered != null ? `${usd(r.amountRecovered)} recovered` : ''}
                    {r.paidAt ? ` · paid ${fmt(r.paidAt)}` : ''}
                  </div>
                </div>
                <div className="flex flex-col gap-2 text-sm">
                  {r.consented && (
                    <button onClick={() => copy(r)} className="text-primary-600 hover:underline text-left">
                      Copy for a text
                    </button>
                  )}
                  <Link href={`/leads/${r.leadId}`} className="text-gray-500 hover:underline">
                    Open the claim
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
