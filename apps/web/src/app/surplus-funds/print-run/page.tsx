'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { surplusAPI } from '@/lib/api';
import { todayLocal } from '@/lib/dates';

/**
 * The print run: every letter due, as one document.
 *
 * The course's letter cadence is the one touch that needs nobody's time,
 * and it was the touch nobody did, because each letter was its own page
 * and its own click. Here the run is built in one call (claimant first,
 * then the relatives, the claimant's text rotating by letter number), the
 * whole run prints with a page break per letter, and one "Mailed" click
 * records every envelope with the template version on the page and logs
 * the postage on each claim.
 *
 * Nothing is recorded until "Mailed". A letter can be dropped from the run
 * before printing, and a tracking number typed against any Priority or
 * FedEx envelope.
 */

type MailType = 'standard' | 'priority' | 'fedex';

interface RunLetter {
  leadId: string;
  heirId: string | null;
  claimant: string;
  recipientName: string;
  address: string;
  county: string | null;
  caseNumber: string | null;
  letterNumber: number;
  kind: string;
  mailType: MailType;
  why: string;
  label: string;
  version: number;
  versionLabel: string;
  hasText: boolean;
  body: string;
  unfilled: string[];
  sender: { companyName: string; phone: string; callerName: string; website: string | null };
  propertyAddress: string;
  today: string;
}

interface Run {
  generatedAt: string;
  county: string | null;
  total: number;
  cases: number;
  toClaimants: number;
  toRelatives: number;
  letters: RunLetter[];
  truncated: boolean;
  postage: Record<MailType, number | null>;
}

const MAIL_TYPES: [MailType, string][] = [
  ['standard', 'Standard'],
  ['priority', 'Priority Mail'],
  ['fedex', 'FedEx'],
];

const SIZES = [25, 60, 100, 200];

function key(l: RunLetter) {
  return `${l.leadId}:${l.heirId || ''}`;
}

function PrintRunPage() {
  const params = useSearchParams();
  const countyParam = params.get('county') || '';

  const [county, setCounty] = useState(countyParam);
  const [counties, setCounties] = useState<string[]>([]);
  const [max, setMax] = useState(60);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [mailTypes, setMailTypes] = useState<Record<string, MailType>>({});
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [postage, setPostage] = useState<Record<MailType, string>>({ standard: '', priority: '', fedex: '' });
  const [result, setResult] = useState<{ mailed: number; postageTotal: number; failed: { recipientName: string | null; error: string }[] } | null>(null);

  useEffect(() => {
    surplusAPI
      .counties()
      .then((r) => setCounties((r.data || []).map((c: any) => c.name)))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await surplusAPI.printRun(county || null, max);
      const data: Run = r.data;
      setRun(data);
      setDropped(new Set());
      setMailTypes(Object.fromEntries(data.letters.map((l) => [key(l), l.mailType])));
      setTracking({});
      setPostage({
        standard: data.postage.standard == null ? '' : String(data.postage.standard),
        priority: data.postage.priority == null ? '' : String(data.postage.priority),
        fedex: data.postage.fedex == null ? '' : String(data.postage.fedex),
      });
    } catch (e: any) {
      setError(e?.response?.data?.message || 'The run could not be built.');
    } finally {
      setLoading(false);
    }
  }, [county, max]);

  useEffect(() => {
    load();
  }, [load]);

  const kept = useMemo(() => (run ? run.letters.filter((l) => !dropped.has(key(l)) && l.hasText && l.unfilled.length === 0) : []), [run, dropped]);
  const unprintable = useMemo(() => (run ? run.letters.filter((l) => !l.hasText || l.unfilled.length > 0) : []), [run]);

  const toggleDrop = (l: RunLetter) =>
    setDropped((s) => {
      const next = new Set(s);
      const k = key(l);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const postageOf = (t: MailType): number | null => {
    const v = postage[t].trim();
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const estimate = useMemo(() => {
    let total = 0;
    let missing = 0;
    for (const l of kept) {
      const t = mailTypes[key(l)] || l.mailType;
      const p = postageOf(t);
      if (p == null) missing += 1;
      else total += p;
    }
    return { total: Math.round(total * 100) / 100, missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, mailTypes, postage]);

  const mailed = async () => {
    if (!run || busy || !kept.length) return;
    const n = kept.length;
    if (
      !window.confirm(
        `Record ${n} letter${n === 1 ? '' : 's'} as mailed today?\n\n` +
          `Each envelope is written to its claim with the template version on this page, a reply check is opened, and the postage ($${estimate.total.toFixed(2)}${
            estimate.missing ? `, ${estimate.missing} with no price set` : ''
          }) is logged as an expense on each claim.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const r = await surplusAPI.printRunMailed({
        mailedAt: todayLocal(),
        postage: { standard: postageOf('standard'), priority: postageOf('priority'), fedex: postageOf('fedex') },
        items: kept.map((l) => ({
          leadId: l.leadId,
          heirId: l.heirId,
          kind: l.kind,
          version: l.version,
          recipientName: l.recipientName,
          address: l.address,
          mailType: mailTypes[key(l)] || l.mailType,
          trackingNumber: (tracking[key(l)] || '').trim() || null,
          letterNumber: l.letterNumber,
        })),
      });
      setResult(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'The run could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; min-height: 0 !important; break-after: page; page-break-after: always; }
          .sheet:last-child { break-after: auto; page-break-after: auto; }
          @page { margin: 1in; }
        }
      `}</style>

      {/* The controls. Hidden on paper. */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm">
            <a href="/surplus-funds" className="text-gray-500 hover:text-gray-700">
              ← Surplus Funds
            </a>
            <span className="font-semibold text-gray-900 ml-3">Print run</span>
            {run && (
              <span className="text-gray-500">
                {' '}
                · {run.total} letter{run.total === 1 ? '' : 's'} due across {run.cases} case{run.cases === 1 ? '' : 's'} ({run.toClaimants} to claimants, {run.toRelatives} to
                relatives)
                {run.truncated ? `. This page holds the first ${run.letters.length}; mark them mailed and build the next run.` : ''}
              </span>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select value={county} onChange={(e) => setCounty(e.target.value)} className="h-9 rounded-lg border border-gray-300 text-sm px-2" aria-label="County">
              <option value="">Every county</option>
              {counties.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select value={max} onChange={(e) => setMax(Number(e.target.value))} className="h-9 rounded-lg border border-gray-300 text-sm px-2" aria-label="Letters per run">
              {SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} per run
                </option>
              ))}
            </select>
            <button
              onClick={() => window.print()}
              disabled={!kept.length || loading}
              className="h-9 px-4 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              Print {kept.length || ''}
            </button>
            {result ? (
              <span className="text-sm font-medium text-green-700">
                Recorded {result.mailed} as mailed, ${result.postageTotal.toFixed(2)} postage logged
                {result.failed.length ? `, ${result.failed.length} failed` : ''}.
              </span>
            ) : (
              <button
                onClick={mailed}
                disabled={busy || loading || !kept.length}
                title="Write every letter on this page to its claim as mailed today and log the postage"
                className="h-9 px-4 rounded-lg border border-primary-600 text-primary-700 text-sm font-medium hover:bg-primary-50 disabled:opacity-50"
              >
                {busy ? 'Recording...' : `Mailed, all ${kept.length}`}
              </button>
            )}
            {result && (
              <button onClick={load} className="h-9 px-4 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50">
                Build the next run
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-600">
          <span className="font-medium text-gray-700">Postage per envelope</span>
          {MAIL_TYPES.map(([t, l]) => (
            <label key={t} className="flex items-center gap-1">
              {l} $
              <input
                value={postage[t]}
                onChange={(e) => setPostage((p) => ({ ...p, [t]: e.target.value }))}
                className="h-7 w-16 rounded border border-gray-300 px-1 text-xs"
                inputMode="decimal"
                aria-label={`${l} postage`}
              />
            </label>
          ))}
          <span>
            {kept.length} to mail, ${estimate.total.toFixed(2)} postage{estimate.missing ? ` (${estimate.missing} with no price set, logged at $0)` : ''}
          </span>
          {unprintable.length > 0 && (
            <span className="text-amber-700">
              {unprintable.length} left out: no template text or a merge field could not be filled. Fix the file or the template, then rebuild.
            </span>
          )}
          {result?.failed.length ? (
            <span className="text-red-600">Failed: {result.failed.map((f) => `${f.recipientName || 'a letter'} (${f.error})`).join('; ')}</span>
          ) : null}
        </div>
      </div>

      {error && <p className="p-8 text-sm text-red-600">{error}</p>}
      {loading && !run && <p className="p-8 text-sm text-gray-500">Building the run...</p>}
      {run && !loading && run.letters.length === 0 && !error && (
        <p className="p-8 text-sm text-gray-500">No letters are due{county ? ` in ${county}` : ''}. Every address on file has been written to inside its cadence.</p>
      )}

      {run?.letters.map((l, i) => {
        const k = key(l);
        const off = dropped.has(k) || !l.hasText || l.unfilled.length > 0;
        const type = mailTypes[k] || l.mailType;
        return (
          <div key={k} className={off ? 'no-print' : undefined}>
            {/* The strip above each letter: who, which letter, how it goes. Hidden on paper. */}
            <div className={`no-print mx-auto w-[8.5in] mt-8 px-3 py-2 rounded-t-lg text-xs flex flex-wrap items-center gap-3 ${off ? 'bg-gray-200 text-gray-500' : 'bg-gray-800 text-gray-100'}`}>
              <span className="font-semibold">
                {i + 1} of {run.letters.length}
              </span>
              <span>
                {l.recipientName}
                {l.heirId ? ` (for ${l.claimant})` : ''} · {[l.county ? `${l.county} County` : null, l.caseNumber].filter(Boolean).join(' ')}
              </span>
              <span className="opacity-80">
                {l.why} · {l.label} {l.versionLabel}
              </span>
              {!l.hasText && <span className="text-amber-300">No template text for this kind yet. Write it in Settings, Surplus Scripts and Letters.</span>}
              {l.unfilled.length > 0 && <span className="text-amber-300">Could not fill: {l.unfilled.join(', ')}</span>}
              <span className="ml-auto flex items-center gap-2">
                <select
                  value={type}
                  onChange={(e) => setMailTypes((m) => ({ ...m, [k]: e.target.value as MailType }))}
                  className="h-7 rounded border border-gray-500 bg-gray-900 text-gray-100 text-xs px-1"
                  aria-label="Mail type"
                  disabled={off}
                >
                  {MAIL_TYPES.map(([t, lab]) => (
                    <option key={t} value={t}>
                      {lab}
                    </option>
                  ))}
                </select>
                {type !== 'standard' && (
                  <input
                    value={tracking[k] || ''}
                    onChange={(e) => setTracking((t) => ({ ...t, [k]: e.target.value }))}
                    placeholder="Tracking number"
                    className="h-7 w-36 rounded border border-gray-500 bg-gray-900 text-gray-100 text-xs px-1"
                    disabled={off}
                  />
                )}
                {l.hasText && l.unfilled.length === 0 && (
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={dropped.has(k)} onChange={() => toggleDrop(l)} />
                    Leave out
                  </label>
                )}
              </span>
            </div>

            {/* The letter itself, US Letter proportions on screen. */}
            <div className={`sheet mx-auto bg-white shadow-lg w-[8.5in] min-h-[11in] px-[1in] py-[1in] text-[12.5pt] leading-[1.5] text-gray-900 font-serif ${off ? 'opacity-50' : ''}`}>
              <div className="flex items-baseline justify-between border-b border-gray-300 pb-3 mb-8">
                <div>
                  <div className="text-[16pt] font-semibold tracking-tight">{l.sender.companyName}</div>
                  <div className="text-[10pt] text-gray-600">
                    {l.sender.phone}
                    {l.sender.website ? ` · ${l.sender.website}` : ''}
                  </div>
                </div>
                <div className="text-[10pt] text-gray-600">Re: {l.propertyAddress}</div>
              </div>
              <pre className="whitespace-pre-wrap font-serif text-[12.5pt] leading-[1.5]">{l.body}</pre>
            </div>
          </div>
        );
      })}
      <div className="h-8" />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-gray-500">Building the run...</p>}>
      <PrintRunPage />
    </Suspense>
  );
}
