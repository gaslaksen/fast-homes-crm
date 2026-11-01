'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { surplusAPI } from '@/lib/api';
import '@/components/pipelines/pipeline-board.css';
import { downloadCsv, fmtDate, money, phoneDisplay } from '@/components/pipelines/format';

/**
 * The outreach list: every person on a batch or a work queue, one row each,
 * best first, with what has been tried on them.
 *
 * This is the checklist Ian was keeping outside Dealcore. Texts, calls,
 * emails and letters Dealcore sent tick themselves; anything done from a
 * personal phone is logged here with one click, and "Done" takes a person off
 * the list for now without touching the case.
 */

type Channel = 'called' | 'texted' | 'emailed' | 'letter';

interface Tick {
  at: string;
  via: 'dealcore' | 'logged';
}

interface Person {
  heirId: string | null;
  name: string;
  isClaimant: boolean;
  rank: number;
  rankLabel: string;
  relationship: string | null;
  deceased: boolean;
  doNotCall: boolean;
  phones: { number: string; type: string | null; dnc: string | null; bad?: boolean }[];
  emails: string[];
  address: string | null;
  mailReturned: boolean;
  statusLabel: string;
  /** The person's own note, kept on their row. Null for the claimant. */
  callNotes: string | null;
  reachable: boolean;
  ticks: Record<Channel, Tick | null>;
  done: { at: string; by: string | null } | null;
  notes: { at: string; kind: string; note: string; by: string | null }[];
  /** Can be tried and nothing has been tried in a week, or ever. */
  dueToday?: boolean;
  lastTouchAt?: string | null;
}

interface OutreachCase {
  leadId: string;
  claimant: string;
  address: string;
  county: string | null;
  caseNumber: string | null;
  queueLabel: string;
  queueReason: string;
  holdReason: string | null;
  holdUntil?: string | null;
  netToClaimant: number;
  daysLeft: number | null;
  /** Under two months to the day-340 cutoff. */
  shortWindow?: boolean;
  daysToCutoff?: number | null;
  dueCount?: number;
  letterDue: boolean;
  people: Person[];
  openCount: number;
  untriedCount: number;
}

interface OutreachList {
  label: string;
  caseCount: number;
  peopleCount: number;
  openCount: number;
  dueCount?: number;
  touchEveryDays?: number;
  truncated: boolean;
  groups: { key: string; label: string; cases: OutreachCase[] }[];
}

interface BatchOption {
  id: string;
  code: string;
  createdAt: string;
  rowCount: number;
}

const QUEUES: [string, string][] = [
  ['call', 'Call now'],
  ['likely', 'Likely match'],
  ['heirs', 'Find the heirs'],
  ['trace', 'Send to IDI'],
  ['name_search', 'Research by name'],
  ['entity', 'Entity'],
  ['mailed', 'Letter sent'],
  ['hold', 'On hold'],
  ['closed', 'Closed'],
];

const CHANNELS: [Channel, string][] = [
  ['called', 'Called'],
  ['texted', 'Texted'],
  ['emailed', 'Emailed'],
  ['letter', 'Letter'],
];

const GROUP_HELP: Record<string, string> = {
  soon: 'A year off the notice in 30 days or less. These first.',
  past: 'Past a year off the notice: only an attorney can ask for the money now.',
  no_path: 'Nobody on these cases has a working number, an email or an address yet. Find someone first.',
  hold: 'Put on hold on purpose. Nothing goes out until somebody releases them.',
};

const cell: React.CSSProperties = { padding: '8px 8px', verticalAlign: 'top', fontSize: 12.5 };
const head: React.CSSProperties = { ...cell, color: 'var(--faint)', fontWeight: 700, fontSize: 10.5, letterSpacing: 0.6, textTransform: 'uppercase', textAlign: 'left' };

function letterKind(p: Person) {
  if (p.isClaimant) return 'letter_claimant';
  return p.rank <= 5 ? 'letter_family' : 'letter_associate';
}

function daysLeftLabel(n: number | null) {
  if (n === null) return 'No notice date';
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} past a year`;
  return `${n} day${n === 1 ? '' : 's'} left`;
}

function OutreachPage() {
  const params = useSearchParams();
  const router = useRouter();
  const batch = params.get('batch');
  const letters = params.get('letters') === '1';
  const queue = batch || letters ? null : params.get('queue') || 'call';
  const scopeValue = batch ? `batch:${batch}` : letters ? 'letters' : `queue:${queue}`;

  const [list, setList] = useState<OutreachList | null>(null);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);
  /**
   * Only the people due a touch, as one list with the biggest surplus first
   * and then the nearest deadline. The Daily Brief links here with ?due=1.
   */
  const [dueOnly, setDueOnly] = useState(params.get('due') === '1');
  const [busy, setBusy] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  /** The relative row whose own note is being edited, and its draft. */
  const [aboutFor, setAboutFor] = useState<string | null>(null);
  const [aboutText, setAboutText] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    surplusAPI
      .outreach({ batch, queue, letters })
      .then((res) => setList(res.data))
      .catch((err: any) => setError(err?.response?.data?.message || 'The list could not be loaded.'));
  }, [batch, queue, letters]);

  useEffect(() => {
    setList(null);
    load();
  }, [load]);

  useEffect(() => {
    surplusAPI
      .batches()
      .then((res) => setBatches(res.data || []))
      .catch(() => setBatches([]));
  }, []);

  const say = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2500);
  };

  const pick = (v: string) => {
    const [kind, id] = v.split(':');
    const q = new URLSearchParams();
    if (kind === 'batch') q.set('batch', id);
    else if (kind === 'letters') q.set('letters', '1');
    else q.set('queue', id);
    router.replace(`/surplus-funds/outreach?${q.toString()}`);
  };

  const key = (c: OutreachCase, p: Person) => `${c.leadId}:${p.heirId || ''}`;

  const mark = async (c: OutreachCase, p: Person, kind: string, note?: string) => {
    const k = `${key(c, p)}:${kind}`;
    if (busy) return;
    setBusy(k);
    try {
      if (kind === 'undone') await surplusAPI.clearDone(c.leadId, p.heirId);
      else await surplusAPI.addTouch(c.leadId, { heirId: p.heirId, kind, note });
      say(
        kind === 'done'
          ? `${p.name} marked done`
          : kind === 'undone'
            ? `${p.name} is back on the list`
            : kind === 'note'
              ? 'Note saved'
              : `Logged: ${kind} ${p.name}`,
      );
      setNoteFor(null);
      setNoteText('');
      load();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  /**
   * The relative's own note, on the heir row itself, so "Son (in Texas, call
   * after 5)" stops being typed into the relationship field.
   */
  const saveAbout = async (c: OutreachCase, p: Person) => {
    if (busy || !p.heirId) return;
    setBusy(`${key(c, p)}:about`);
    try {
      await surplusAPI.updateHeir(p.heirId, { callNotes: aboutText.trim() });
      say(aboutText.trim() ? `Note on ${p.name} saved` : `Note on ${p.name} cleared`);
      setAboutFor(null);
      setAboutText('');
      load();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const markDeceased = async (c: OutreachCase, p: Person) => {
    if (busy || !p.heirId) return;
    if (!window.confirm(`Mark ${p.name} deceased?\n\nTheir drips stop and they are never dialled again.`)) return;
    setBusy(`${key(c, p)}:deceased`);
    try {
      await surplusAPI.updateHeir(p.heirId, { deceased: true });
      say(`${p.name} marked deceased`);
      load();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const groups = useMemo(() => {
    if (!list) return [];
    if (dueOnly) {
      const cases = list.groups
        .flatMap((g) => g.cases)
        .filter((c) => (c.dueCount || 0) > 0)
        .map((c) => ({ ...c, people: c.people.filter((p) => p.dueToday) }))
        .sort((a, b) => b.netToClaimant - a.netToClaimant || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
      return cases.length ? [{ key: 'due', label: 'Due a touch today', cases }] : [];
    }
    if (!hideDone) return list.groups;
    return list.groups
      .map((g) => ({ ...g, cases: g.cases.filter((c) => c.openCount > 0) }))
      .filter((g) => g.cases.length);
  }, [list, hideDone, dueOnly]);

  const exportCsv = () => {
    if (!list) return;
    const rows: (string | number | null)[][] = [];
    for (const g of list.groups) {
      for (const c of g.cases) {
        for (const p of c.people) {
          rows.push([
            g.label,
            c.claimant,
            c.county,
            c.caseNumber,
            c.daysLeft,
            c.netToClaimant,
            p.name,
            p.rankLabel,
            p.relationship,
            p.phones.filter((x) => !x.bad && !x.dnc).map((x) => phoneDisplay(x.number)).join('; '),
            p.emails.join('; '),
            p.address,
            ...CHANNELS.map(([ch]) => (p.ticks[ch] ? fmtDate(p.ticks[ch]!.at) : '')),
            p.done ? fmtDate(p.done.at) : '',
          ]);
        }
      }
    }
    downloadCsv(
      `outreach_${list.label.replace(/[^A-Za-z0-9]+/g, '_')}.csv`,
      ['Group', 'Claimant', 'County', 'Case', 'Days left', 'Net to claimant', 'Person', 'Who', 'Relationship', 'Phones', 'Emails', 'Mail address', 'Called', 'Texted', 'Emailed', 'Letter', 'Done'],
      rows,
    );
  };

  const renderTick = (c: OutreachCase, p: Person, ch: Channel) => {
    const t = p.ticks[ch];
    if (t) {
      return (
        <div>
          <div style={{ color: 'var(--mint)', fontWeight: 700 }}>✓ {fmtDate(t.at)}</div>
          <div style={{ color: 'var(--faint)', fontSize: 11 }}>{t.via === 'dealcore' ? 'in Dealcore' : 'logged'}</div>
        </div>
      );
    }
    if (!p.reachable) return <span style={{ color: 'var(--faint)' }}>-</span>;
    if (ch === 'letter') {
      if (!p.address || p.mailReturned) return <span style={{ color: 'var(--faint)' }}>{p.mailReturned ? 'Came back' : 'No address'}</span>;
      const q = new URLSearchParams({ lead: c.leadId, kind: letterKind(p) });
      if (p.heirId) q.set('heir', p.heirId);
      return (
        <a className="dc-or-btn" href={`/surplus-funds/letter?${q.toString()}`} target="_blank" rel="noopener noreferrer">
          Write
        </a>
      );
    }
    const usable = ch === 'emailed' ? p.emails.length > 0 : p.phones.some((x) => !x.dnc && !x.bad);
    if (!usable) return <span style={{ color: 'var(--faint)' }}>{ch === 'emailed' ? 'No email' : 'No number'}</span>;
    return (
      <button
        type="button"
        className="dc-or-btn"
        disabled={!!busy}
        title="Log one made outside Dealcore"
        onClick={() => mark(c, p, ch)}
      >
        Log
      </button>
    );
  };

  const renderPerson = (c: OutreachCase, p: Person) => {
    const k = key(c, p);
    const dim = !!p.done || !p.reachable;
    return (
      <tr key={k} style={{ borderTop: '1px solid var(--border)', opacity: dim ? 0.55 : 1 }}>
        <td style={cell}>
          <div style={{ fontWeight: 700 }}>{p.name}</div>
          <div style={{ color: 'var(--dim)' }}>
            {/* "Spouse (widowed)" already says Spouse; "Son" does not say Child. */}
            {p.relationship && p.relationship.toLowerCase().includes(p.rankLabel.toLowerCase())
              ? p.relationship
              : `${p.rankLabel}${p.relationship ? ` · ${p.relationship}` : ''}`}
          </div>
          <div style={{ color: 'var(--faint)', fontSize: 11.5 }}>{p.statusLabel}</div>
          {/* A relative's own row: a note about them, and a deceased mark,
              without opening the case. */}
          {!p.isClaimant && p.heirId && (
            aboutFor === k ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveAbout(c, p);
                }}
                style={{ display: 'flex', gap: 4, marginTop: 4 }}
              >
                <input
                  className="dc-input"
                  autoFocus
                  value={aboutText}
                  onChange={(e) => setAboutText(e.target.value)}
                  placeholder="About this person"
                  aria-label={`About ${p.name}`}
                  style={{ minWidth: 0, flex: 1 }}
                />
                <button type="submit" className="dc-or-btn" disabled={!!busy}>
                  Save
                </button>
                <button type="button" className="dc-or-btn ghost" onClick={() => setAboutFor(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <div style={{ marginTop: 3 }}>
                {p.callNotes && (
                  <div style={{ fontSize: 11.5, fontStyle: 'italic', color: 'var(--dim)', overflowWrap: 'anywhere' }}>{p.callNotes}</div>
                )}
                <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="dc-or-btn ghost"
                    disabled={!!busy}
                    title="A note about this person, kept on their row"
                    onClick={() => {
                      setAboutFor(k);
                      setAboutText(p.callNotes || '');
                    }}
                  >
                    {p.callNotes ? 'Edit note' : '+ About'}
                  </button>
                  {!p.deceased && (
                    <button
                      type="button"
                      className="dc-or-btn ghost"
                      disabled={!!busy}
                      title="Mark this person deceased. Their drips stop and they are never dialled."
                      onClick={() => markDeceased(c, p)}
                    >
                      Deceased
                    </button>
                  )}
                </span>
              </div>
            )
          )}
          {p.dueToday && (
            <div style={{ color: 'var(--amber)', fontSize: 11.5, fontWeight: 600 }}>
              {p.lastTouchAt ? `Due: last tried ${fmtDate(p.lastTouchAt)}` : 'Due: never tried'}
            </div>
          )}
        </td>
        <td style={cell}>
          {p.phones.length === 0 && <span style={{ color: 'var(--faint)' }}>None</span>}
          {p.phones.map((x) => (
            <div key={x.number} style={{ whiteSpace: 'nowrap' }}>
              <span style={{ textDecoration: x.bad ? 'line-through' : undefined, color: x.bad || x.dnc ? 'var(--faint)' : undefined }}>
                {phoneDisplay(x.number)}
              </span>
              {x.bad && <span style={{ color: 'var(--red)', fontSize: 11 }}> wrong</span>}
              {!x.bad && x.dnc && <span style={{ color: 'var(--red)', fontSize: 11 }}> DNC</span>}
            </div>
          ))}
        </td>
        <td style={{ ...cell, wordBreak: 'break-all' }}>
          {p.emails.length ? p.emails.map((e) => <div key={e}>{e}</div>) : <span style={{ color: 'var(--faint)' }}>None</span>}
        </td>
        <td style={cell}>
          {p.address ? (
            <span style={{ textDecoration: p.mailReturned ? 'line-through' : undefined }}>{p.address}</span>
          ) : (
            <span style={{ color: 'var(--faint)' }}>None</span>
          )}
        </td>
        {CHANNELS.map(([ch]) => (
          <td key={ch} style={cell}>
            {renderTick(c, p, ch)}
          </td>
        ))}
        <td style={cell}>
          {p.done ? (
            <button type="button" className="dc-or-btn on" disabled={!!busy} onClick={() => mark(c, p, 'undone')} title="Put back on the list">
              ✓ Done
            </button>
          ) : p.reachable ? (
            <button type="button" className="dc-or-btn" disabled={!!busy} onClick={() => mark(c, p, 'done')}>
              Done
            </button>
          ) : null}
          {p.done && (
            <div style={{ color: 'var(--faint)', fontSize: 11, marginTop: 3 }}>
              {fmtDate(p.done.at)}
              {p.done.by ? ` · ${p.done.by}` : ''}
            </div>
          )}
        </td>
        <td style={{ ...cell, minWidth: 170 }}>
          {p.notes.slice(0, 2).map((n, i) => (
            <div key={i} style={{ fontSize: 11.5, marginBottom: 3 }}>
              <span style={{ color: 'var(--faint)' }}>{fmtDate(n.at)}</span> {n.note}
            </div>
          ))}
          {noteFor === k ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (noteText.trim()) mark(c, p, 'note', noteText.trim());
              }}
              style={{ display: 'flex', gap: 4, marginTop: 4 }}
            >
              <input
                className="dc-input"
                autoFocus
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="What happened"
                aria-label={`Note on ${p.name}`}
                style={{ minWidth: 0, flex: 1 }}
              />
              <button type="submit" className="dc-or-btn" disabled={!!busy || !noteText.trim()}>
                Save
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="dc-or-btn ghost"
              onClick={() => {
                setNoteFor(k);
                setNoteText('');
              }}
            >
              + Note
            </button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <AppShell>
      <div className="dc-board" style={{ background: 'var(--bg)', minHeight: '100vh', padding: 26 }}>
        <div style={{ maxWidth: 1600, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <Link href="/surplus-funds" style={{ color: 'var(--dim)', fontSize: 12.5 }}>
                ← Surplus Funds
              </Link>
              <h1 className="dc-h1" style={{ marginTop: 4 }}>
                Outreach list
              </h1>
              <div className="dc-sub">
                {list
                  ? `${list.label} · ${list.caseCount} case${list.caseCount === 1 ? '' : 's'} · ${list.peopleCount} people · ${list.openCount} still to work`
                  : 'Loading...'}
                {letters && (
                  <>
                    {' · '}
                    <Link href="/surplus-funds/print-run" style={{ color: 'var(--teal, var(--dim))', fontWeight: 600 }}>
                      Print the run
                    </Link>
                  </>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="dc-input" value={scopeValue} onChange={(e) => pick(e.target.value)} aria-label="Which list">
                <optgroup label="Work queues">
                  {QUEUES.map(([k, l]) => (
                    <option key={k} value={`queue:${k}`}>
                      {l}
                    </option>
                  ))}
                  <option value="letters">Letters due</option>
                </optgroup>
                {batches.length > 0 && (
                  <optgroup label="IDI batches">
                    {batches.map((b) => (
                      <option key={b.id} value={`batch:${b.id}`}>
                        {b.code} · {fmtDate(b.createdAt)} · {b.rowCount}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--dim)' }}
                title={`People who can be tried and have had nothing tried in ${list?.touchEveryDays ?? 7} days, or ever.`}
              >
                <input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} />
                Due today{list?.dueCount != null ? ` (${list.dueCount})` : ''}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--dim)' }}>
                <input type="checkbox" checked={hideDone} disabled={dueOnly} onChange={(e) => setHideDone(e.target.checked)} />
                Hide worked-through cases
              </label>
              <button type="button" className="dc-or-btn" onClick={exportCsv} disabled={!list}>
                Export CSV
              </button>
            </div>
          </div>

          {flash && (
            <div role="status" style={{ position: 'fixed', bottom: 20, right: 20, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, zIndex: 50 }}>
              {flash}
            </div>
          )}
          {error && (
            <div role="alert" style={{ color: 'var(--red)', marginBottom: 12 }}>
              {error}
            </div>
          )}
          {list?.truncated && (
            <div style={{ color: 'var(--dim)', fontSize: 12.5, marginBottom: 12 }}>
              Showing the first {list.caseCount} cases. Narrow the list to see the rest.
            </div>
          )}
          {list && !groups.length && (
            <div style={{ color: 'var(--dim)', fontSize: 13.5, padding: '30px 0' }}>
              {list.caseCount ? 'Every case here is worked through for now.' : 'Nothing in this list.'}
            </div>
          )}

          {groups.map((g) => (
            <section key={g.key} style={{ marginBottom: 26 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700 }}>{g.label}</h2>
                <span style={{ color: 'var(--faint)', fontSize: 12.5 }}>
                  {g.cases.length} case{g.cases.length === 1 ? '' : 's'}
                </span>
              </div>
              {GROUP_HELP[g.key] && <div style={{ color: 'var(--dim)', fontSize: 12.5, marginBottom: 8 }}>{GROUP_HELP[g.key]}</div>}
              {g.cases.map((c) => (
                <div
                  key={c.leadId}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 10, overflow: 'hidden' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', background: 'var(--surface2)' }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{c.claimant}</div>
                    <div style={{ color: 'var(--dim)', fontSize: 12.5 }}>
                      {[c.address, c.county, c.caseNumber].filter(Boolean).join(' · ')}
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{money(c.netToClaimant)}</div>
                    <div style={{ fontSize: 12.5, color: c.daysLeft !== null && c.daysLeft <= 30 ? 'var(--red)' : 'var(--dim)' }}>
                      {daysLeftLabel(c.daysLeft)}
                    </div>
                    {c.shortWindow && (
                      <div
                        style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600 }}
                        title="Under two months to the team's day-340 cutoff. Day 365 is the legal end."
                      >
                        {c.daysToCutoff != null && c.daysToCutoff >= 0 ? `Short window, ${c.daysToCutoff}d to day 340` : 'Past day 340'}
                      </div>
                    )}
                    <div style={{ color: 'var(--faint)', fontSize: 12 }}>
                      {c.holdUntil ? c.queueReason : c.holdReason ? `On hold: ${c.holdReason}` : c.queueReason}
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ color: 'var(--faint)', fontSize: 12 }}>
                        {c.openCount ? `${c.openCount} to work${c.untriedCount ? `, ${c.untriedCount} untried` : ''}` : 'Worked through'}
                      </span>
                      <Link className="dc-or-btn" href={`/surplus-funds?lead=${c.leadId}`}>
                        Open case
                      </Link>
                    </div>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={head}>Person</th>
                          <th style={head}>Phones</th>
                          <th style={head}>Email</th>
                          <th style={head}>Mail to</th>
                          {CHANNELS.map(([ch, l]) => (
                            <th key={ch} style={head}>
                              {l}
                            </th>
                          ))}
                          <th style={head}>Done</th>
                          <th style={head}>Notes</th>
                        </tr>
                      </thead>
                      <tbody>{c.people.map((p) => renderPerson(c, p))}</tbody>
                    </table>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

export default function OutreachPageRoute() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-gray-500">Loading...</p>}>
      <OutreachPage />
    </Suspense>
  );
}
