'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { surplusAPI } from '@/lib/api';
import { deadReasonLabel } from '@/lib/surplus-dead';
import '@/components/pipelines/pipeline-board.css';
import { fmtDate, money } from '@/components/pipelines/format';

/**
 * The weekly prune. The course says a list the team can finish is one that
 * is cut every week: sixty days of full effort gets paused for six months,
 * a case past the cutoff is closed, a case that fell below the floor is
 * closed, a case the docket has closed is closed. Each bucket here carries
 * its one action so Monday's prune is four decisions, not a hundred.
 *
 * The buckets come off the board's own rows (GET /surplus/prune) and the
 * actions go through the board's own bulk endpoints, so the gates and the
 * timeline are the same as if each case had been handled on its card.
 */

interface PruneRow {
  id: string;
  claimant: string;
  county: string | null;
  caseNumber: string | null;
  address: string | null;
  grossSurplus: number;
  stage: string | null;
  queueLabel: string;
  ownerName: string | null;
  lastTouchedAt: string | null;
  daysToCutoff: number | null;
  effortDays: number | null;
  claimStatus: string | null;
}

interface PruneBucket {
  key: 'fullEffort' | 'pastCutoff' | 'belowFloor' | 'docketClosed';
  label: string;
  why: string;
  action: { kind: 'pause'; until: string } | { kind: 'close'; deadReason: string; note: string };
  rows: PruneRow[];
}

interface PruneList {
  floor: number;
  cutoffDay: number;
  buckets: PruneBucket[];
  total: number;
}

const PAUSE_REASON = 'Sixty days of full effort and nobody reached. Paused per the course; back in six months.';

export default function SurplusPrunePage() {
  const [list, setList] = useState<PruneList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Chosen ids per bucket. Everything starts chosen: the prune is opt-out. */
  const [picked, setPicked] = useState<Record<string, Set<string>>>({});

  const say = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 7000);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await surplusAPI.prune();
      const data: PruneList = r.data;
      setList(data);
      setPicked(Object.fromEntries(data.buckets.map((b) => [b.key, new Set(b.rows.map((x) => x.id))])));
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'The prune list could not be loaded.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (bucket: string, id: string) =>
    setPicked((p) => {
      const next = new Set(p[bucket] || []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...p, [bucket]: next };
    });

  const toggleAll = (b: PruneBucket) =>
    setPicked((p) => {
      const cur = p[b.key] || new Set<string>();
      const all = cur.size === b.rows.length;
      return { ...p, [b.key]: all ? new Set<string>() : new Set(b.rows.map((x) => x.id)) };
    });

  return (
    <AppShell>
      <div className="dc-board" style={{ background: 'var(--bg)', minHeight: '100vh', padding: 26 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="dc-h1" style={{ marginTop: 4 }}>
              Weekly prune
            </h1>
            <div className="dc-sub">
              {list
                ? list.total
                  ? `${list.total} case${list.total === 1 ? '' : 's'} the course says to stop working. Untick what you want to keep, then take each bucket's action.`
                  : 'Nothing to prune. The list is as lean as the rules allow.'
                : error || 'Loading...'}
            </div>
          </div>
          <Link className="dc-or-btn" href="/surplus-funds">
            Back to the board
          </Link>
        </div>

        {toast && (
          <div
            role="status"
            style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', fontSize: 13 }}
          >
            {toast}
          </div>
        )}

        {list?.buckets.map((b) => (
          <Bucket
            key={b.key}
            bucket={b}
            picked={picked[b.key] || new Set()}
            busy={busy === b.key}
            disabled={!!busy}
            onToggle={(id) => toggle(b.key, id)}
            onToggleAll={() => toggleAll(b)}
            onDone={async (ids, act) => {
              setBusy(b.key);
              try {
                if (act.kind === 'pause') {
                  const r = await surplusAPI.bulkHold(ids, act.reason, act.until);
                  const failed = r.data?.failed?.length || 0;
                  say(`Paused ${r.data?.updated ?? ids.length} case${ids.length === 1 ? '' : 's'} until ${fmtDate(act.until)}.${failed ? ` ${failed} could not be paused.` : ''}`);
                } else {
                  const r = await surplusAPI.bulkStage(ids, 'Dead', { deadReason: act.deadReason, deadNote: act.note });
                  say(`Closed ${r.data?.updated ?? ids.length} case${ids.length === 1 ? '' : 's'} as ${deadReasonLabel(act.deadReason)?.toLowerCase()}.`);
                }
                await load();
              } catch (e: any) {
                say(e?.response?.data?.message || 'That did not go through.');
              } finally {
                setBusy(null);
              }
            }}
          />
        ))}
      </div>
    </AppShell>
  );
}

type Act = { kind: 'pause'; reason: string; until: string } | { kind: 'close'; deadReason: string; note: string };

function Bucket({
  bucket,
  picked,
  busy,
  disabled,
  onToggle,
  onToggleAll,
  onDone,
}: {
  bucket: PruneBucket;
  picked: Set<string>;
  busy: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onDone: (ids: string[], act: Act) => Promise<void>;
}) {
  const isPause = bucket.action.kind === 'pause';
  const [until, setUntil] = useState(() => (bucket.action.kind === 'pause' ? bucket.action.until.slice(0, 10) : ''));
  const [reason, setReason] = useState(() => (bucket.action.kind === 'pause' ? PAUSE_REASON : bucket.action.note));
  const ids = useMemo(() => bucket.rows.filter((r) => picked.has(r.id)).map((r) => r.id), [bucket.rows, picked]);
  const total = useMemo(() => bucket.rows.filter((r) => picked.has(r.id)).reduce((s, r) => s + (r.grossSurplus || 0), 0), [bucket.rows, picked]);

  const go = () => {
    if (!ids.length || disabled) return;
    const what = isPause ? `Pause ${ids.length} case${ids.length === 1 ? '' : 's'} until ${fmtDate(until)}?` : `Close ${ids.length} case${ids.length === 1 ? '' : 's'} as ${bucket.label.toLowerCase()}?`;
    if (!window.confirm(`${what}\n\n${money(total)} of surplus between them. Each case keeps its research and is matched on import, so it is never re-added.`)) return;
    onDone(
      ids,
      isPause
        ? { kind: 'pause', reason: reason.trim() || PAUSE_REASON, until }
        : { kind: 'close', deadReason: (bucket.action as any).deadReason, note: reason.trim() || (bucket.action as any).note },
    );
  };

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{bucket.label}</h2>
        <span style={{ color: 'var(--dim)', fontSize: 13 }}>
          {bucket.rows.length} case{bucket.rows.length === 1 ? '' : 's'}
        </span>
      </div>
      <div style={{ color: 'var(--dim)', fontSize: 13, marginTop: 4, maxWidth: 760 }}>{bucket.why}</div>

      {bucket.rows.length === 0 ? (
        <div style={{ marginTop: 10, fontSize: 13, color: 'var(--faint)' }}>None this week.</div>
      ) : (
        <>
          <div
            style={{
              marginTop: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              padding: '10px 12px',
              borderRadius: 8,
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
            }}
          >
            {isPause ? (
              <>
                <label style={{ fontSize: 12.5 }}>
                  Until{' '}
                  <input type="date" className="dc-input" value={until} onChange={(e) => setUntil(e.target.value)} style={{ width: 150 }} />
                </label>
                <input
                  className="dc-input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why these are paused"
                  style={{ flex: 1, minWidth: 220 }}
                />
                <button type="button" className="dc-or-btn on" disabled={!ids.length || disabled || !until} onClick={go}>
                  {busy ? 'Pausing...' : `Pause ${ids.length} until ${until ? fmtDate(until) : '...'}`}
                </button>
              </>
            ) : (
              <>
                <span style={{ fontSize: 12.5 }}>
                  Close as <b>{deadReasonLabel((bucket.action as any).deadReason)}</b>
                </span>
                <input
                  className="dc-input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Note on each case"
                  style={{ flex: 1, minWidth: 220 }}
                />
                <button type="button" className="dc-or-btn on" disabled={!ids.length || disabled} onClick={go}>
                  {busy ? 'Closing...' : `Close ${ids.length}`}
                </button>
              </>
            )}
            <span style={{ fontSize: 12, color: 'var(--dim)', marginLeft: 'auto' }}>{money(total)} selected</span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--dim)' }}>
                <th style={th}>
                  <input type="checkbox" checked={picked.size === bucket.rows.length} onChange={onToggleAll} aria-label="All in this bucket" />
                </th>
                <th style={th}>Claimant</th>
                <th style={th}>Case</th>
                <th style={th}>Surplus</th>
                <th style={th}>Stage</th>
                <th style={th}>Queue</th>
                <th style={th}>Owner</th>
                <th style={th}>Last touched</th>
                <th style={th}>{isPause ? 'Effort' : bucket.key === 'docketClosed' ? 'Docket' : 'Cutoff'}</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {bucket.rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)', opacity: picked.has(r.id) ? 1 : 0.55 }}>
                  <td style={td}>
                    <input type="checkbox" checked={picked.has(r.id)} onChange={() => onToggle(r.id)} aria-label={r.claimant} />
                  </td>
                  <td style={td}>
                    <b>{r.claimant}</b>
                    {r.address && <div style={{ color: 'var(--faint)', fontSize: 11.5 }}>{r.address}</div>}
                  </td>
                  <td style={td}>
                    {r.county || ''}
                    {r.caseNumber ? ` ${r.caseNumber}` : ''}
                  </td>
                  <td style={td}>{money(r.grossSurplus)}</td>
                  <td style={td}>{r.stage || 'New'}</td>
                  <td style={td}>{r.queueLabel}</td>
                  <td style={td}>{r.ownerName || <span style={{ color: 'var(--faint)' }}>Nobody</span>}</td>
                  <td style={td}>{r.lastTouchedAt ? fmtDate(r.lastTouchedAt) : <span style={{ color: 'var(--faint)' }}>never</span>}</td>
                  <td style={td}>
                    {isPause
                      ? r.effortDays != null
                        ? `${r.effortDays} days`
                        : ''
                      : bucket.key === 'docketClosed'
                        ? r.claimStatus || ''
                        : r.daysToCutoff != null
                          ? `${Math.abs(r.daysToCutoff)} days past`
                          : ''}
                  </td>
                  <td style={td}>
                    <Link className="dc-or-btn" href={`/surplus-funds?lead=${r.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, fontSize: 11.5 };
const td: React.CSSProperties = { padding: '7px 8px', verticalAlign: 'top' };
