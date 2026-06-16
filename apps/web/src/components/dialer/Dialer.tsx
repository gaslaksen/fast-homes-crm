'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDialer } from './DialerContext';
import { leadsAPI, callsAPI } from '@/lib/api';

type Tab = 'keypad' | 'contacts' | 'recents';

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
  const [tab, setTab] = useState<Tab>('keypad');
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

      {d.view === 'dialpad' && (
        <DialpadView tab={tab} setTab={setTab} typed={typed} setTyped={setTyped} />
      )}
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

function DialpadView({
  tab, setTab, typed, setTyped,
}: {
  tab: Tab; setTab: (t: Tab) => void; typed: string; setTyped: (s: string) => void;
}) {
  const d = useDialer();

  const placeTyped = () => {
    const digits = typed.replace(/[^\d+]/g, '');
    if (!digits) return;
    d.startCall({ phone: digits });
  };

  return (
    <div>
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

      <Tabs tab={tab} setTab={setTab} />
    </div>
  );
}

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: { id: Tab; label: string }[] = [
    { id: 'recents', label: 'Recents' },
    { id: 'contacts', label: 'Contacts' },
    { id: 'keypad', label: 'Keypad' },
  ];
  return (
    <div className="grid grid-cols-3 border-t border-gray-100 dark:border-gray-800">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => setTab(it.id)}
          className={`py-2.5 text-xs font-medium ${
            tab === it.id
              ? 'text-primary-600 dark:text-primary-400'
              : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
          }`}
        >
          {it.label}
        </button>
      ))}
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
  const c = d.contact;

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

      {phase === 'oncall' && !showKeypad && (
        <div className="grid grid-cols-4 gap-3 mt-5 w-full">
          <CtrlBtn label="Mute" active={d.muted} onClick={d.toggleMute} icon={<MuteIcon />} />
          <CtrlBtn label="Keypad" onClick={() => setShowKeypad(true)} icon={<GridIcon />} />
          <CtrlBtn label="Hold" disabled title="Coming soon" icon={<PauseIcon />} />
          <CtrlBtn label="Transfer" disabled title="Coming soon" icon={<TransferIcon />} />
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

      <button
        onClick={d.hangup}
        className="mt-6 w-full h-12 rounded-full bg-red-500 hover:bg-red-600 text-white font-medium flex items-center justify-center gap-2"
      >
        <PhoneIcon className="h-5 w-5 rotate-[135deg]" /> End Call
      </button>
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
