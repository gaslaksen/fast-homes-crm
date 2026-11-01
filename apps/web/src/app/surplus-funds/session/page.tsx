'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { surplusAPI } from '@/lib/api';
import { useDialer } from '@/components/dialer/DialerContext';
import '@/components/pipelines/pipeline-board.css';
import { fmtDate, money, phoneDisplay } from '@/components/pipelines/format';

/**
 * Work today: the call session.
 *
 * The course's day is a number of calls on a rifle list, worked in one
 * order (short window first, biggest surplus, nearest cutoff), one case at a
 * time, every number one click, the outcome recorded before the next case
 * appears. The dialer's summary screen already refuses to close without an
 * outcome; this screen refuses to move on while the dialer is mid-call or
 * on that summary, so the two rules meet.
 *
 * Keys: 1 to 9 dial that number on the card, N next case, P previous, S the
 * script. The progress bar is today's dialer calls on surplus leads against
 * the target picked at the top.
 */

interface SessionNumber {
  number: string;
  type: string | null;
}
interface SessionPerson {
  heirId: string | null;
  name: string;
  isClaimant: boolean;
  relationship: string | null;
  rankLabel: string;
  numbers: SessionNumber[];
}
interface SessionCase {
  id: string;
  claimant: string;
  county: string | null;
  caseNumber: string | null;
  address: string | null;
  grossSurplus: number;
  netToClaimant: number;
  shortWindow: boolean;
  daysToCutoff: number | null;
  daysLeft: number | null;
  stage: string | null;
  queue: string;
  queueLabel: string;
  queueReason: string;
  ownerName: string | null;
  tappedAt: string | null;
  isDeceased: boolean;
  lastTouchedAt: string | null;
  onRifle: boolean;
  people: SessionPerson[];
}
interface WorkSession {
  target: number;
  rifle: SessionCase[];
  candidates: SessionCase[];
  retired: { id: string; claimant: string }[];
  stats: { calls: number; connected: number; withOutcome: number; target: number };
  rifleMax: number;
}
interface Scripts {
  scripts: { phone: { body: string; versionLabel: string } | null; voicemail: { body: string; versionLabel: string } | null; relative: { body: string } | null };
}

const SIZES = [10, 25, 40];
const SIZE_KEY = 'surplus.session.size';

export default function WorkTodayPage() {
  const dialer = useDialer();
  const [size, setSize] = useState<number>(25);
  const [session, setSession] = useState<WorkSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [building, setBuilding] = useState(true);
  const [script, setScript] = useState<Scripts | null>(null);
  const [scriptOpen, setScriptOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(SIZE_KEY));
      if (SIZES.includes(saved)) setSize(saved);
    } catch {
      /* per-viewer convenience only */
    }
  }, []);

  const say = useCallback((t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 7000);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await surplusAPI.session(size);
      const s: WorkSession = r.data;
      setSession(s);
      setError(null);
      if (s.retired.length) say(`${s.retired.length} case${s.retired.length === 1 ? '' : 's'} left the rifle list on its own: ${s.retired.map((x) => x.claimant).join(', ')}.`);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'The session could not be loaded.');
    }
  }, [size, say]);

  useEffect(() => {
    load();
  }, [load]);

  const current = session?.rifle[index] || null;

  useEffect(() => {
    setScript(null);
    if (!current) return;
    let cancelled = false;
    surplusAPI
      .script(current.id)
      .then((r) => !cancelled && setScript(r.data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mid-call or on the dialer's outcome screen: nothing moves until the
  // outcome is saved. That is the course's "no call without a recorded
  // result", enforced by the only screen that can record it.
  const dialerBusy = dialer.view === 'connecting' || dialer.view === 'oncall' || dialer.view === 'summary';

  const refreshStats = useCallback(async () => {
    try {
      const r = await surplusAPI.session(size);
      setSession((s) => (s ? { ...s, stats: r.data.stats } : r.data));
    } catch {
      /* the next load catches up */
    }
  }, [size]);

  // When the dialer comes back to the dialpad after a call, the count moved.
  const [lastView, setLastView] = useState(dialer.view);
  useEffect(() => {
    if (lastView === 'summary' && dialer.view === 'dialpad') refreshStats();
    setLastView(dialer.view);
  }, [dialer.view, lastView, refreshStats]);

  const dial = useCallback(
    (c: SessionCase, p: SessionPerson, n: SessionNumber) => {
      if (dialerBusy) return;
      dialer.startCall({
        name: p.isClaimant ? c.claimant : `${p.name} (${c.claimant})`,
        phone: n.number,
        leadId: c.id,
        leadSource: 'SURPLUS',
      });
    },
    [dialer, dialerBusy],
  );

  const next = useCallback(() => {
    if (dialerBusy || !session) return;
    setIndex((i) => Math.min(session.rifle.length - 1, i + 1));
  }, [dialerBusy, session]);
  const prev = useCallback(() => {
    if (dialerBusy) return;
    setIndex((i) => Math.max(0, i - 1));
  }, [dialerBusy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (!current || building) return;
      if (e.key === 'n' || e.key === 'N') next();
      else if (e.key === 'p' || e.key === 'P') prev();
      else if (e.key === 's' || e.key === 'S') setScriptOpen((v) => !v);
      else if (/^[1-9]$/.test(e.key)) {
        const flat = current.people.flatMap((p) => p.numbers.map((n) => ({ p, n })));
        const pick = flat[Number(e.key) - 1];
        if (pick) dial(current, pick.p, pick.n);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, building, next, prev, dial]);

  const changeRifle = async (change: { add?: string[]; remove?: string[] }) => {
    if (busy) return;
    setBusy(true);
    try {
      await surplusAPI.setRifle(change);
      await load();
    } catch (e: any) {
      say(e?.response?.data?.message || 'The rifle list could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  const pickSize = (n: number) => {
    setSize(n);
    try {
      localStorage.setItem(SIZE_KEY, String(n));
    } catch {
      /* fine */
    }
  };

  const fillRifle = async () => {
    if (!session) return;
    const room = session.rifleMax - session.rifle.length;
    const add = session.candidates.slice(0, Math.max(0, Math.min(room, size - session.rifle.length))).map((c) => c.id);
    if (!add.length) return;
    await changeRifle({ add });
  };

  const stats = session?.stats;
  const pct = stats ? Math.min(100, Math.round((stats.calls / Math.max(1, stats.target)) * 100)) : 0;
  const flatNumbers = useMemo(() => (current ? current.people.flatMap((p) => p.numbers.map((n) => ({ p, n }))) : []), [current]);

  return (
    <AppShell>
      <div className="dc-board" style={{ background: 'var(--bg)', minHeight: '100vh', padding: 26 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="dc-h1" style={{ marginTop: 4 }}>
              Work today
            </h1>
            <div className="dc-sub">
              {session
                ? `${session.rifle.length} case${session.rifle.length === 1 ? '' : 's'} on the rifle list. Short window first, then the biggest surplus, then the nearest cutoff.`
                : error || 'Loading...'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, color: 'var(--dim)' }}>Target</span>
            {SIZES.map((n) => (
              <button key={n} type="button" className={`dc-or-btn${size === n ? ' on' : ''}`} onClick={() => pickSize(n)}>
                {n} calls
              </button>
            ))}
            <Link className="dc-or-btn" href="/surplus-funds">
              Back to the board
            </Link>
          </div>
        </div>

        {stats && (
          <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, flexWrap: 'wrap', gap: 8 }}>
              <span>
                <b>{stats.calls}</b> of {stats.target} calls today · {stats.connected} connected · {stats.withOutcome} with an outcome
                {stats.calls > stats.withOutcome && (
                  <span style={{ color: 'var(--amber)' }}> · {stats.calls - stats.withOutcome} without one</span>
                )}
              </span>
              <span style={{ color: 'var(--dim)' }}>{pct}%</span>
            </div>
            <div style={{ marginTop: 8, height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--mint)' : 'var(--teal, #0f766e)' }} />
            </div>
          </div>
        )}

        {toast && (
          <div role="status" style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', fontSize: 13 }}>
            {toast}
          </div>
        )}

        {session && (building || !session.rifle.length) ? (
          <RifleBuilder session={session} size={size} busy={busy} onAdd={(id) => changeRifle({ add: [id] })} onRemove={(id) => changeRifle({ remove: [id] })} onFill={fillRifle} onStart={() => { setBuilding(false); setIndex(0); }} />
        ) : session && current ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
              <button type="button" className="dc-or-btn" onClick={prev} disabled={dialerBusy || index === 0} title="P">
                Previous
              </button>
              <span style={{ fontSize: 13, color: 'var(--dim)' }}>
                Case {index + 1} of {session.rifle.length}
              </span>
              <button type="button" className="dc-or-btn on" onClick={next} disabled={dialerBusy || index >= session.rifle.length - 1} title="N">
                {dialerBusy ? 'Save the outcome first' : 'Next case'}
              </button>
              <button type="button" className="dc-or-btn" onClick={() => setBuilding(true)} style={{ marginLeft: 'auto' }}>
                Edit the rifle list
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 18, marginTop: 14 }}>
              <section style={{ padding: 18, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{current.claimant}</h2>
                  {current.shortWindow && (
                    <span className="dc-tag" style={{ background: 'var(--red-soft, #fee2e2)', color: 'var(--red)' }}>
                      Short window
                    </span>
                  )}
                  <span style={{ color: 'var(--dim)', fontSize: 13 }}>{current.queueLabel}</span>
                </div>
                <div style={{ color: 'var(--dim)', fontSize: 13, marginTop: 4 }}>
                  {current.county || ''}
                  {current.caseNumber ? ` ${current.caseNumber}` : ''}
                  {current.address ? ` · ${current.address}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 13, flexWrap: 'wrap' }}>
                  <Fact k="To the claimant" v={money(current.netToClaimant)} />
                  <Fact k="Surplus" v={money(current.grossSurplus)} />
                  <Fact k="Cutoff" v={current.daysToCutoff == null ? 'unknown' : current.daysToCutoff <= 0 ? 'past' : `${current.daysToCutoff} days`} />
                  <Fact k="Stage" v={current.stage || 'New'} />
                  <Fact k="Owner" v={current.ownerName || 'Nobody'} />
                  <Fact k="Last touched" v={current.lastTouchedAt ? fmtDate(current.lastTouchedAt) : 'never'} />
                  <Fact k="Replied" v={current.tappedAt ? fmtDate(current.tappedAt) : 'not yet'} />
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 8 }}>{current.queueReason}</div>

                <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--dim)', marginTop: 18, marginBottom: 6 }}>
                  Numbers, in the order to try
                </h3>
                {flatNumbers.length === 0 && <div style={{ fontSize: 13, color: 'var(--faint)' }}>No dialable number on this case.</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {flatNumbers.map(({ p, n }, i) => (
                    <div key={`${p.heirId || 'c'}-${n.number}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                      <kbd style={{ fontSize: 11, padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--dim)' }}>{i + 1}</kbd>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5 }}>
                          <b>{p.name}</b>
                          <span style={{ color: 'var(--dim)' }}> · {p.isClaimant ? 'claimant' : p.relationship || p.rankLabel}</span>
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>
                          {phoneDisplay(n.number)}
                          {n.type ? ` · ${n.type}` : ''}
                        </div>
                      </div>
                      <button type="button" className="dc-or-btn on" onClick={() => dial(current, p, n)} disabled={dialerBusy}>
                        Dial
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 14, fontSize: 12.5 }}>
                  <Link className="dc-or-btn" href={`/surplus-funds?lead=${current.id}`}>
                    Open the case
                  </Link>
                  <button type="button" className="dc-or-btn" style={{ marginLeft: 8 }} disabled={busy || dialerBusy} onClick={() => changeRifle({ remove: [current.id] })}>
                    Take off the rifle list
                  </button>
                </div>
              </section>

              <section style={{ padding: 18, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--dim)' }}>Script</h3>
                  <button type="button" className="dc-or-btn" onClick={() => setScriptOpen((v) => !v)} title="S">
                    {scriptOpen ? 'Hide' : 'Show'}
                  </button>
                </div>
                {scriptOpen && (
                  <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.55 }}>
                    {!script && <div style={{ color: 'var(--faint)' }}>Loading the script...</div>}
                    {script?.scripts.phone && (
                      <>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>If they answer <span style={{ color: 'var(--faint)', fontWeight: 400 }}>({script.scripts.phone.versionLabel})</span></div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{script.scripts.phone.body}</div>
                      </>
                    )}
                    {script?.scripts.voicemail && (
                      <>
                        <div style={{ fontWeight: 600, marginTop: 14, marginBottom: 4 }}>Voicemail <span style={{ color: 'var(--faint)', fontWeight: 400 }}>({script.scripts.voicemail.versionLabel})</span></div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{script.scripts.voicemail.body}</div>
                      </>
                    )}
                    {script?.scripts.relative && current.people.some((p) => !p.isClaimant) && (
                      <>
                        <div style={{ fontWeight: 600, marginTop: 14, marginBottom: 4 }}>If a relative answers</div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{script.scripts.relative.body}</div>
                      </>
                    )}
                  </div>
                )}
                <div style={{ marginTop: 14, fontSize: 12, color: 'var(--faint)' }}>Keys: 1 to 9 dial, N next, P previous, S script. The outcome screen must be saved before the next case.</div>
              </section>
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <span>
      <span style={{ color: 'var(--dim)' }}>{k}</span> <b>{v}</b>
    </span>
  );
}

/**
 * Building the list: what is committed, what is offered next, and one button
 * that fills the list to the day's target from the top of the course order.
 */
function RifleBuilder({
  session,
  size,
  busy,
  onAdd,
  onRemove,
  onFill,
  onStart,
}: {
  session: WorkSession;
  size: number;
  busy: boolean;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onFill: () => void;
  onStart: () => void;
}) {
  const row = (c: SessionCase, action: 'add' | 'remove') => (
    <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
      <td style={td}>
        <b>{c.claimant}</b>
        {c.shortWindow && (
          <span className="dc-tag" style={{ marginLeft: 6, background: 'var(--red-soft, #fee2e2)', color: 'var(--red)' }}>
            Short window
          </span>
        )}
        <div style={{ color: 'var(--faint)', fontSize: 11.5 }}>
          {c.county || ''}
          {c.caseNumber ? ` ${c.caseNumber}` : ''}
          {c.address ? ` · ${c.address}` : ''}
        </div>
      </td>
      <td style={td}>{money(c.netToClaimant)}</td>
      <td style={td}>{c.daysToCutoff == null ? '' : c.daysToCutoff <= 0 ? 'past' : `${c.daysToCutoff} days`}</td>
      <td style={td}>{c.people.reduce((n, p) => n + p.numbers.length, 0)}</td>
      <td style={td}>{c.ownerName || <span style={{ color: 'var(--faint)' }}>Nobody</span>}</td>
      <td style={td}>{c.lastTouchedAt ? fmtDate(c.lastTouchedAt) : <span style={{ color: 'var(--faint)' }}>never</span>}</td>
      <td style={td}>
        <button type="button" className={`dc-or-btn${action === 'add' ? ' on' : ''}`} disabled={busy} onClick={() => (action === 'add' ? onAdd(c.id) : onRemove(c.id))}>
          {action === 'add' ? 'Add' : 'Remove'}
        </button>
      </td>
    </tr>
  );
  const head = (
    <thead>
      <tr style={{ textAlign: 'left', color: 'var(--dim)' }}>
        <th style={th}>Case</th>
        <th style={th}>To the claimant</th>
        <th style={th}>Cutoff</th>
        <th style={th}>Numbers</th>
        <th style={th}>Owner</th>
        <th style={th}>Last touched</th>
        <th style={th}></th>
      </tr>
    </thead>
  );
  return (
    <>
      <section style={{ marginTop: 22 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Rifle list</h2>
          <span style={{ color: 'var(--dim)', fontSize: 13 }}>
            {session.rifle.length} of {session.rifleMax} at most. Worked until each is a yes, a no or a maybe.
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {session.rifle.length < size && session.candidates.length > 0 && (
              <button type="button" className="dc-or-btn" disabled={busy} onClick={onFill}>
                Fill to {Math.min(size, session.rifleMax)} from the top
              </button>
            )}
            <button type="button" className="dc-or-btn on" disabled={!session.rifle.length} onClick={onStart}>
              Start the session
            </button>
          </span>
        </div>
        {session.rifle.length === 0 ? (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--faint)' }}>Nothing committed yet. Add from the candidates below, or fill to the target.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 8 }}>
            {head}
            <tbody>{session.rifle.map((c) => row(c, 'remove'))}</tbody>
          </table>
        )}
      </section>
      <section style={{ marginTop: 26 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Next candidates</h2>
          <span style={{ color: 'var(--dim)', fontSize: 13 }}>Callable now, in the course order. A case enters the list only when one leaves.</span>
        </div>
        {session.candidates.length === 0 ? (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--faint)' }}>Nobody else is callable right now.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 8 }}>
            {head}
            <tbody>{session.candidates.map((c) => row(c, 'add'))}</tbody>
          </table>
        )}
      </section>
    </>
  );
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, fontSize: 11.5 };
const td: React.CSSProperties = { padding: '7px 8px', verticalAlign: 'top' };
