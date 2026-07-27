'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDialer, DialerTab } from './DialerContext';
import { leadsAPI, callsAPI, authAPI } from '@/lib/api';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const KEY_SUB: Record<string, string> = {
  '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL', '6': 'MNO',
  '7': 'PQRS', '8': 'TUV', '9': 'WXYZ', '0': '+',
};

const DISPOSITIONS = [
  'No Answer', 'Voicemail', 'Follow Up',
  'Requested Appointment', 'Not Interested', 'Incorrect Number',
];

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function prettyPhone(raw?: string) {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '').replace(/^1/, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

function initials(name?: string, phone?: string) {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }
  return phone ? phone.replace(/\D/g, '').slice(-2) : '#';
}

export default function Dialer() {
  const d = useDialer();
  const [typed, setTyped] = useState('');

  if (!d.open) {
    return (
      <button
        onClick={d.openDialer}
        aria-label="Open dialer"
        className="fixed bottom-5 right-5 z-[60] h-12 w-12 rounded-full bg-primary-600 text-white shadow-lg hover:bg-primary-700 flex items-center justify-center"
      >
        <PhoneIcon className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-[60] w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden">
      <Header />
      {d.error && d.view === 'dialpad' && (
        <div className="px-4 py-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20">{d.error}</div>
      )}

      {d.view === 'dialpad' && <DialpadView typed={typed} setTyped={setTyped} />}
      {d.view === 'incoming' && <IncomingView />}
      {d.view === 'connecting' && <CallingView phase="connecting" />}
      {d.view === 'oncall' && <CallingView phase="oncall" />}
      {d.view === 'summary' && <SummaryView />}
    </div>
  );
}

function Header() {
  const d = useDialer();
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-2">
        <span className="h-7 w-7 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 flex items-center justify-center">
          <PhoneIcon className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Dialer</span>
        {!d.ready && d.view === 'dialpad' && (
          <span className="text-[10px] text-gray-400">offline</span>
        )}
      </div>
      <button
        onClick={d.closeDialer}
        aria-label="Minimize dialer"
        className="p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" d="M5 12h14" />
        </svg>
      </button>
    </div>
  );
}

/**
 * "Calling From" selector. Mirrors the phone-system UIs agents are used to:
 * the current outbound number is always visible, and clicking it opens a
 * searchable list. Today there is one number, but the list is driven by
 * TWILIO_CALLER_IDS so adding more is config, not code.
 */
function CallerIdBar() {
  const d = useDialer();
  const [openList, setOpenList] = useState(false);
  const [q, setQ] = useState('');

  if (d.callerIds.length === 0) return null;

  const filtered = d.callerIds.filter((c) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      c.label.toLowerCase().includes(needle) ||
      c.number.replace(/\D/g, '').includes(needle.replace(/\D/g, ''))
    );
  });

  if (openList) {
    return (
      <div className="border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-start justify-between px-4 pt-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">
              Selected
            </p>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {d.callerId?.label || 'Main'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {prettyPhone(d.callerId?.number)}
            </p>
          </div>
          <button
            onClick={() => { setOpenList(false); setQ(''); }}
            aria-label="Close number list"
            className="p-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search numbers"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:border-primary-400"
          />
        </div>

        <div className="max-h-52 overflow-y-auto pb-2">
          {filtered.length === 0 && (
            <p className="px-4 py-3 text-xs text-gray-400">No numbers match.</p>
          )}
          {filtered.map((c) => (
            <button
              key={c.number}
              onClick={() => { d.setCallerId(c); setOpenList(false); setQ(''); }}
              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {c.label}
                </span>
                <span className="block text-xs text-gray-400">{prettyPhone(c.number)}</span>
              </span>
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                Local
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setOpenList(true)}
      className="w-full flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 text-left"
    >
      <span className="min-w-0">
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          Calling From
        </span>
        <span className="block text-sm text-gray-900 dark:text-gray-100 truncate">
          {d.callerId?.label || 'Main'}
          <span className="text-gray-400"> · {prettyPhone(d.callerId?.number)}</span>
        </span>
      </span>
      <svg className="h-4 w-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

function DialpadView({
  typed, setTyped,
}: {
  typed: string; setTyped: (s: string) => void;
}) {
  const d = useDialer();
  const tab = d.tab;

  const placeTyped = () => {
    const digits = typed.replace(/[^\d+]/g, '');
    if (!digits) return;
    d.startCall({ phone: digits });
  };

  return (
    <div>
      <CallerIdBar />

      {tab === 'keypad' && (
        <div className="px-5 pt-4 pb-3">
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Enter a number"
            className="w-full text-center text-2xl tracking-wide bg-transparent outline-none text-gray-900 dark:text-gray-100 mb-3"
          />
          <div className="grid grid-cols-3 gap-2">
            {KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setTyped(typed + k)}
                className="h-14 rounded-xl bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 flex flex-col items-center justify-center"
              >
                <span className="text-xl font-medium text-gray-900 dark:text-gray-100">{k}</span>
                {KEY_SUB[k] && <span className="text-[9px] text-gray-400">{KEY_SUB[k]}</span>}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-center gap-6 mt-4">
            <span className="w-12" />
            <button
              onClick={placeTyped}
              aria-label="Call"
              className="h-14 w-14 rounded-full bg-green-500 hover:bg-green-600 text-white flex items-center justify-center shadow"
            >
              <PhoneIcon className="h-6 w-6" />
            </button>
            <button
              onClick={() => setTyped(typed.slice(0, -1))}
              aria-label="Delete"
              className="w-12 text-gray-400 hover:text-gray-600"
            >
              <svg className="h-6 w-6 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10l4 4m0-4l-4 4M3 12l5.4-6.4A2 2 0 0110 5h9a2 2 0 012 2v10a2 2 0 01-2 2h-9a2 2 0 01-1.6-.8L3 12z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {tab === 'contacts' && <ContactsTab />}
      {tab === 'recents' && <RecentsTab />}
      {tab === 'voicemail' && <VoicemailTab />}
      {tab === 'queue' && <QueueTab />}

      <Tabs />
    </div>
  );
}

function Tabs() {
  const d = useDialer();
  const items: { id: DialerTab; label: string; icon: JSX.Element }[] = [
    { id: 'recents', label: 'Recents', icon: <ClockIcon /> },
    { id: 'contacts', label: 'Contacts', icon: <ContactCardIcon /> },
    { id: 'keypad', label: 'Keypad', icon: <GridIcon /> },
    { id: 'voicemail', label: 'Voicemail', icon: <VoicemailIcon /> },
    { id: 'queue', label: 'Queue', icon: <QueueIcon /> },
  ];
  return (
    <div className="grid grid-cols-5 border-t border-gray-100 dark:border-gray-800">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => d.setTab(it.id)}
          title={it.label}
          className={`flex flex-col items-center gap-1 py-2 ${
            d.tab === it.id
              ? 'text-primary-600 dark:text-primary-400'
              : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
          }`}
        >
          <span className={`flex items-center justify-center h-6 w-8 rounded-md ${
            d.tab === it.id ? 'bg-primary-50 dark:bg-primary-900/30' : ''
          }`}>
            {it.icon}
          </span>
          <span className="text-[9px] font-medium leading-none">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Voicemail and Queue are placeholders. Neither exists on the backend yet:
 * there is no <Record> fallback on unanswered inbound calls and no
 * <Enqueue>/TaskRouter, so there is nothing real to list. The tabs are here so
 * the dialer matches the layout agents expect, and each says plainly that it is
 * not wired up rather than showing a misleading empty list.
 */
function VoicemailTab() {
  return (
    <EmptyTab
      icon={<VoicemailIcon />}
      title="Voicemail is not set up yet"
      body="Unanswered calls are not recorded to a voicemail box. Once inbound voicemail is enabled, messages will show up here with playback and one-tap callback."
    />
  );
}

function QueueTab() {
  return (
    <EmptyTab
      icon={<QueueIcon />}
      title="No call queue"
      body="Inbound calls currently ring every signed-in agent at once. A queue with hold music and wait times would show waiting callers here."
    />
  );
}

function EmptyTab({ icon, title, body }: { icon: JSX.Element; title: string; body: string }) {
  return (
    <div className="px-6 py-10 flex flex-col items-center text-center min-h-[268px] justify-center">
      <span className="h-11 w-11 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 flex items-center justify-center mb-3">
        {icon}
      </span>
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</p>
      <p className="mt-1.5 text-xs text-gray-400 leading-relaxed max-w-[260px]">{body}</p>
    </div>
  );
}

function ContactsTab() {
  const d = useDialer();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await leadsAPI.list({ search: q, limit: 15 });
        const leads = res.data?.leads || res.data || [];
        if (!cancelled) setResults(Array.isArray(leads) ? leads : []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="px-3 pt-3 pb-1 h-[320px] flex flex-col">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search leads…"
        className="w-full px-3 py-2 text-sm rounded-lg bg-gray-50 dark:bg-gray-800 outline-none text-gray-900 dark:text-gray-100 mb-2"
      />
      <div className="flex-1 overflow-y-auto -mx-1">
        {loading && <p className="text-xs text-gray-400 px-3 py-2">Searching…</p>}
        {!loading && q.length >= 2 && results.length === 0 && (
          <p className="text-xs text-gray-400 px-3 py-2">No matches</p>
        )}
        {results.map((lead) => {
          const name = `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim();
          return (
            <ContactRow
              key={lead.id}
              name={name || 'Unknown'}
              phone={lead.sellerPhone}
              disabled={!lead.sellerPhone || lead.doNotContact}
              onCall={() =>
                d.startCall({ name, phone: lead.sellerPhone, leadId: lead.id })
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function RecentsTab() {
  const d = useDialer();
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    callsAPI
      .twilioRecents(25)
      .then((res) => {
        if (!cancelled) setCalls(res.data?.calls || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="px-3 pt-3 pb-1 h-[320px] overflow-y-auto">
      {loading && <p className="text-xs text-gray-400 px-3 py-2">Loading…</p>}
      {!loading && calls.length === 0 && (
        <p className="text-xs text-gray-400 px-3 py-2">No recent calls</p>
      )}
      {calls.map((c) => {
        const name =
          `${c.lead?.sellerFirstName || ''} ${c.lead?.sellerLastName || ''}`.trim();
        const phone = c.toNumber || c.lead?.sellerPhone || '';
        return (
          <ContactRow
            key={c.id}
            name={name || prettyPhone(phone) || 'Unknown'}
            phone={phone}
            sub={c.disposition || c.status}
            disabled={!phone}
            onCall={() =>
              d.startCall({ name, phone, leadId: c.lead?.id })
            }
          />
        );
      })}
    </div>
  );
}

function ContactRow({
  name, phone, sub, disabled, onCall,
}: {
  name: string; phone?: string; sub?: string; disabled?: boolean; onCall: () => void;
}) {
  return (
    <button
      onClick={onCall}
      disabled={disabled}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 text-left"
    >
      <span className="h-9 w-9 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-xs font-semibold flex items-center justify-center">
        {initials(name, phone)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-gray-900 dark:text-gray-100 truncate">{name}</span>
        <span className="block text-xs text-gray-400 truncate">
          {prettyPhone(phone)}{sub ? ` · ${sub}` : ''}
        </span>
      </span>
      <PhoneIcon className="h-4 w-4 text-green-500" />
    </button>
  );
}

function CallingView({ phase }: { phase: 'connecting' | 'oncall' }) {
  const d = useDialer();
  const [showKeypad, setShowKeypad] = useState(false);
  const [transferMode, setTransferMode] = useState<'blind' | 'warm' | null>(null);
  const c = d.contact;
  const consulting = d.transferState === 'consulting';

  // While consulting, the transfer form is replaced by the complete/cancel
  // controls, so any half-open form should close.
  useEffect(() => {
    if (consulting) setTransferMode(null);
  }, [consulting]);

  return (
    <div className="px-5 py-6 flex flex-col items-center">
      <span className="h-20 w-20 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-2xl font-semibold flex items-center justify-center mb-3">
        {initials(c?.name, c?.phone)}
      </span>
      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {c?.name || prettyPhone(c?.phone) || 'Calling…'}
      </p>
      <p className="text-sm text-gray-400">{prettyPhone(c?.phone)}</p>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {phase === 'connecting' ? 'Connecting…' : fmtDuration(d.durationSec)}
      </p>

      {consulting && (
        <div className="mt-3 w-full rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
            Consulting {prettyPhone(d.transferTo || '')}
          </p>
          <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
            {c?.name || 'The seller'} is on hold and cannot hear this.
          </p>
        </div>
      )}

      {!consulting && d.onHold && phase === 'oncall' && (
        <p className="mt-3 text-xs font-medium text-amber-600 dark:text-amber-400">On hold</p>
      )}

      {phase === 'oncall' && showKeypad && (
        <div className="grid grid-cols-3 gap-2 mt-4 w-full">
          {KEYS.map((k) => (
            <button
              key={k}
              onClick={() => d.sendDigit(k)}
              className="h-11 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              {k}
            </button>
          ))}
        </div>
      )}

      {/* Warm transfer in progress: hand off or come back */}
      {phase === 'oncall' && consulting && (
        <div className="grid grid-cols-2 gap-3 mt-4 w-full">
          <button
            onClick={() => d.completeWarmTransfer()}
            className="h-11 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-medium"
          >
            Complete transfer
          </button>
          <button
            onClick={() => d.cancelWarmTransfer()}
            className="h-11 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium"
          >
            Cancel
          </button>
        </div>
      )}

      {phase === 'oncall' && !consulting && transferMode && (
        <TransferForm mode={transferMode} onClose={() => setTransferMode(null)} />
      )}

      {phase === 'oncall' && !showKeypad && !consulting && !transferMode && (
        <div className="grid grid-cols-4 gap-3 mt-5 w-full">
          <CtrlBtn label="Mute" active={d.muted} onClick={d.toggleMute} icon={<MuteIcon />} />
          <CtrlBtn label="Keypad" onClick={() => setShowKeypad(true)} icon={<GridIcon />} />
          <CtrlBtn
            label="Hold"
            active={d.onHold}
            onClick={() => d.toggleHold()}
            icon={<PauseIcon />}
          />
          <CtrlBtn
            label="Transfer"
            onClick={() => setTransferMode('warm')}
            icon={<TransferIcon />}
          />
        </div>
      )}

      {phase === 'oncall' && showKeypad && (
        <button
          onClick={() => setShowKeypad(false)}
          className="mt-3 text-xs text-gray-400 hover:text-gray-600"
        >
          Hide keypad
        </button>
      )}

      {d.error && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400 text-center">{d.error}</p>
      )}

      <button
        onClick={d.hangup}
        className="mt-6 w-full h-12 rounded-full bg-red-500 hover:bg-red-600 text-white font-medium flex items-center justify-center gap-2"
      >
        <PhoneIcon className="h-5 w-5 rotate-[135deg]" /> End Call
      </button>
    </div>
  );
}

/**
 * Pick a destination and hand the call over.
 *
 * Warm puts the seller on hold and dials the target so you can brief them
 * before dropping out. Blind pushes the seller straight to the target and
 * leaves immediately. Warm is the default because the common case here is
 * handing a live seller to Ian with context.
 */
function TransferForm({ mode, onClose }: { mode: 'blind' | 'warm'; onClose: () => void }) {
  const d = useDialer();
  const [kind, setKind] = useState<'blind' | 'warm'>(mode);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  // Reuse team members as transfer targets so you can pick a teammate by name
  // instead of typing their number every handoff.
  useEffect(() => {
    authAPI
      .getTeam()
      .then((res: any) => setResults(res.data || []))
      .catch(() => setResults([]));
  }, []);

  const submit = async (dest: string) => {
    const digits = dest.replace(/[^\d+]/g, '');
    if (!digits) return;
    setBusy(true);
    try {
      if (kind === 'warm') await d.startWarmTransfer(digits);
      else await d.blindTransfer(digits);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 w-full">
      <div className="flex items-center gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-800 mb-3">
        {(['warm', 'blind'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md ${
              kind === k
                ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {k === 'warm' ? 'Warm' : 'Blind'}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
        {kind === 'warm'
          ? 'Puts the seller on hold and dials the target so you can brief them first.'
          : 'Sends the seller straight to the target and drops you off the call.'}
      </p>

      {results.length > 0 && (
        <div className="max-h-28 overflow-y-auto mb-2 -mx-1">
          {results
            .filter((m: any) => m.phone)
            .map((m: any) => (
              <button
                key={m.id}
                disabled={busy}
                onClick={() => submit(m.phone)}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 text-left"
              >
                <span className="text-xs text-gray-900 dark:text-gray-100 truncate">
                  {[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}
                </span>
                <span className="text-[11px] text-gray-400 shrink-0">{prettyPhone(m.phone)}</span>
              </button>
            ))}
        </div>
      )}

      <input
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="Or enter a number"
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:border-primary-400"
      />

      <div className="flex gap-2 mt-2">
        <button
          disabled={busy || !to.replace(/[^\d+]/g, '')}
          onClick={() => submit(to)}
          className="flex-1 h-10 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium disabled:opacity-40"
        >
          {busy ? 'Transferring…' : kind === 'warm' ? 'Call target' : 'Transfer'}
        </button>
        <button
          onClick={onClose}
          className="px-4 h-10 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm"
        >
          Back
        </button>
      </div>
    </div>
  );
}

function IncomingView() {
  const d = useDialer();
  const c = d.contact;
  return (
    <div className="px-5 py-6 flex flex-col items-center">
      <p className="text-xs uppercase tracking-wide text-gray-400 mb-3">Incoming call</p>
      <span className="h-20 w-20 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-2xl font-semibold flex items-center justify-center mb-3 animate-pulse">
        {initials(c?.name, c?.phone)}
      </span>
      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {c?.name || prettyPhone(c?.phone) || 'Unknown caller'}
      </p>
      <p className="text-sm text-gray-400">{prettyPhone(c?.phone)}</p>

      <div className="flex items-center justify-center gap-10 mt-7">
        <button
          onClick={d.declineIncoming}
          aria-label="Decline"
          className="flex flex-col items-center gap-1"
        >
          <span className="h-14 w-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center">
            <PhoneIcon className="h-6 w-6 rotate-[135deg]" />
          </span>
          <span className="text-[11px] text-gray-500">Decline</span>
        </button>
        <button
          onClick={d.acceptIncoming}
          aria-label="Accept"
          className="flex flex-col items-center gap-1"
        >
          <span className="h-14 w-14 rounded-full bg-green-500 hover:bg-green-600 text-white flex items-center justify-center">
            <PhoneIcon className="h-6 w-6" />
          </span>
          <span className="text-[11px] text-gray-500">Accept</span>
        </button>
      </div>
    </div>
  );
}

function SummaryView() {
  const d = useDialer();
  const [selected, setSelected] = useState<string | null>(null);
  const c = d.contact;

  return (
    <div className="px-5 py-5">
      <div className="text-center mb-4">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {c?.name || prettyPhone(c?.phone)}
        </p>
        <p className="text-xs text-red-500 mt-0.5">Call Ended · {fmtDuration(d.durationSec)}</p>
      </div>
      <p className="text-xs font-medium text-gray-500 mb-2">Disposition</p>
      <div className="grid grid-cols-2 gap-2">
        {DISPOSITIONS.map((disp) => (
          <button
            key={disp}
            onClick={() => setSelected(disp)}
            className={`px-3 py-2 text-xs rounded-lg border text-left ${
              selected === disp
                ? 'border-primary-500 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
            }`}
          >
            {disp}
          </button>
        ))}
      </div>
      <button
        onClick={() => d.saveDisposition(selected || 'Completed')}
        className="mt-4 w-full h-11 rounded-full border border-primary-500 text-primary-600 dark:text-primary-400 font-medium hover:bg-primary-50 dark:hover:bg-primary-900/20"
      >
        Done
      </button>
    </div>
  );
}

function CtrlBtn({
  label, icon, onClick, active, disabled, title,
}: {
  label: string; icon: ReactNodeIcon; onClick?: () => void; active?: boolean; disabled?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex flex-col items-center gap-1 disabled:opacity-40"
    >
      <span
        className={`h-12 w-12 rounded-full flex items-center justify-center border ${
          active
            ? 'bg-primary-600 border-primary-600 text-white'
            : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
        }`}
      >
        {icon}
      </span>
      <span className="text-[10px] text-gray-500 dark:text-gray-400">{label}</span>
    </button>
  );
}

type ReactNodeIcon = JSX.Element;

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}
function MuteIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z M17 9l4 4m0-4l-4 4" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h.01M4 12h.01M4 18h.01M8 6h12M8 12h12M8 18h12" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6" />
    </svg>
  );
}
function TransferIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
    </svg>
  );
}
function ContactCardIcon() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 16c.6-1.3 1.7-2 3-2s2.4.7 3 2M15 10h3M15 13.5h3" />
    </svg>
  );
}
function VoicemailIcon() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="6.5" cy="13" r="3.5" />
      <circle cx="17.5" cy="13" r="3.5" />
      <path strokeLinecap="round" d="M6.5 16.5h11" />
    </svg>
  );
}
function QueueIcon() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h10M4 12h10M4 17h6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 10l3 3-3 3" />
    </svg>
  );
}
