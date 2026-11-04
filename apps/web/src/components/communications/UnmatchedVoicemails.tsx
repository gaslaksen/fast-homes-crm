'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { inboxAPI, leadsAPI, surplusAPI } from '@/lib/api';
import { formatPhoneDisplay } from '@/lib/format';
import { recordingSrc } from './CommunicationsTimeline';

interface Voicemail {
  id: string;
  fromNumber: string | null;
  toNumber: string | null;
  createdAt: string;
  duration: number | null;
  recordingUrl: string | null;
  transcript: string | null;
  /** How the call went. Older API builds send only voicemails, with no kind. */
  kind?: 'voicemail' | 'missed' | 'answered' | 'ringing';
  /** People holding a number a few digits off this one, nearest first. */
  suggestions?: AttachOption[];
}

/** A lead, or a person on its case, that a call can be filed under. */
interface AttachOption {
  kind?: 'lead' | 'person';
  leadId: string;
  heirId: string | null;
  name: string;
  /** "Other relative", "Claimant", "Lead". */
  label: string;
  leadName: string;
  propertyAddress: string | null;
  source: string | null;
  /** Suggestions only: the near number we hold for them. */
  numberOnFile?: string;
}

const KIND_LABEL: Record<string, string> = {
  voicemail: 'Voicemail',
  missed: 'Missed call',
  answered: 'Answered',
  ringing: 'Ringing now',
};

/**
 * Calls from numbers that matched no lead: voicemails, missed calls and calls
 * someone answered. A call from a known number already sits on that lead's
 * thread; these have nowhere to go until someone attaches them to the right
 * lead (and person on the case) or dismisses them.
 *
 * `refreshKey` is the open count from the inbox's own poll, so the list
 * reloads when a new one arrives without a second poller.
 */
export default function UnmatchedVoicemails({
  refreshKey,
  onChanged,
  onAttached,
}: {
  refreshKey: number;
  onChanged: () => void;
  onAttached: (leadId: string) => void;
}) {
  const [items, setItems] = useState<Voicemail[]>([]);
  const [open, setOpen] = useState(true);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    inboxAPI
      .voicemails()
      .then((res) => setItems(res.data?.items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const dismiss = async (vm: Voicemail) => {
    setBusyId(vm.id);
    try {
      await inboxAPI.dismissVoicemail(vm.id);
      setItems((prev) => prev.filter((x) => x.id !== vm.id));
      onChanged();
    } catch {
      alert('Could not dismiss that call.');
    } finally {
      setBusyId(null);
    }
  };

  const attach = async (vm: Voicemail, target: AttachTarget) => {
    setBusyId(vm.id);
    try {
      await inboxAPI.attachVoicemail(vm.id, target.leadId, target.heirId);
    } catch {
      alert('Could not attach that call.');
      setBusyId(null);
      return;
    }
    // The call is filed either way; a number that cannot be saved is said so
    // plainly rather than undoing the attach.
    if (target.saveNumber && vm.fromNumber) {
      const problem = await saveNumber(target, vm.fromNumber);
      if (problem) alert(`The call is attached, but the number was not saved: ${problem}`);
    }
    setItems((prev) => prev.filter((x) => x.id !== vm.id));
    setAttachingId(null);
    setBusyId(null);
    onChanged();
    onAttached(target.leadId);
  };

  if (items.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 max-h-[50%] overflow-y-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-400"
      >
        <span>
          Calls from numbers not on file{' '}
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900 text-[10px]">
            {items.length}
          </span>
        </span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <ul className="divide-y divide-amber-100 dark:divide-amber-900/60">
          {items.map((vm) => (
            <li key={vm.id} className="px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {vm.fromNumber ? formatPhoneDisplay(vm.fromNumber) : 'Unknown number'}
                </span>
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  <span className={vm.kind === 'missed' ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                    {KIND_LABEL[vm.kind || 'voicemail'] || 'Call'}
                  </span>
                  {' · '}
                  {formatDistanceToNowStrict(new Date(vm.createdAt), { addSuffix: true })}
                  {vm.duration != null && vm.kind !== 'missed' ? ` · ${vm.duration}s` : ''}
                </span>
              </div>
              {vm.kind === 'missed' ? (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Rang and hung up without leaving a message.
                </p>
              ) : (
                <Transcript text={vm.transcript} answered={vm.kind === 'answered'} />
              )}
              {(vm.suggestions || []).map((sg) => (
                <div
                  key={`${sg.leadId}:${sg.heirId || ''}`}
                  className="mt-2 rounded-md border border-amber-200 dark:border-amber-800 bg-white/70 dark:bg-gray-900/60 px-2.5 py-2"
                >
                  <p className="text-xs text-gray-700 dark:text-gray-300">
                    Possibly <span className="font-semibold text-gray-900 dark:text-gray-100">{sg.name}</span>
                    {sg.heirId ? ` · ${sg.label} on ${sg.leadName}` : ` · ${sg.label}`}. We have{' '}
                    <span className="font-medium">{sg.numberOnFile}</span> for them, a few digits off this number.
                  </p>
                  <button
                    type="button"
                    disabled={busyId === vm.id}
                    onClick={() => attach(vm, { leadId: sg.leadId, heirId: sg.heirId, saveNumber: true })}
                    className="mt-1.5 px-2.5 py-1 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium disabled:opacity-50"
                  >
                    Attach and save number
                  </button>
                </div>
              ))}
              {vm.recordingUrl && (
                <audio
                  controls
                  preload="none"
                  src={recordingSrc(vm.recordingUrl)}
                  className="w-full h-8 mt-1.5"
                />
              )}
              <div className="mt-1.5 flex items-center gap-3 text-xs">
                <button
                  type="button"
                  disabled={busyId === vm.id}
                  onClick={() => setAttachingId(attachingId === vm.id ? null : vm.id)}
                  className="font-medium text-teal-700 dark:text-teal-400 hover:underline disabled:opacity-50"
                >
                  Attach to lead
                </button>
                <button
                  type="button"
                  disabled={busyId === vm.id}
                  onClick={() => dismiss(vm)}
                  className="text-gray-500 dark:text-gray-400 hover:underline disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
              {attachingId === vm.id && (
                <AttachPicker
                  number={vm.fromNumber}
                  disabled={busyId === vm.id}
                  onPick={(target) => attach(vm, target)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface AttachTarget {
  leadId: string;
  /** The person on a surplus case, or null for the claimant / the lead itself. */
  heirId: string | null;
  saveNumber: boolean;
}

/**
 * Add the caller's number to whoever the call turned out to be from. Returns
 * a sentence saying why it was not saved, or null when it was (or was already
 * there). The whole list is sent, primary first, because the slots are
 * positional; a full set of slots is refused rather than silently dropping
 * the new number.
 */
async function saveNumber(target: AttachTarget, number: string): Promise<string | null> {
  const key = number.replace(/\D/g, '').slice(-10);
  try {
    if (target.heirId) {
      const res = await surplusAPI.heirs(target.leadId);
      const heir = (res.data?.heirs || []).find((h: any) => h.id === target.heirId);
      if (!heir) return 'that person is no longer on the case.';
      const phones: { number: string; type?: string | null }[] = (heir.phones || []).map((p: any) => ({
        number: p.number,
        type: p.type ?? null,
      }));
      if (phones.some((p) => String(p.number).replace(/\D/g, '').slice(-10) === key)) return null;
      if (phones.length >= 4) return `${heir.name} already has four numbers. Remove one first.`;
      await surplusAPI.updateHeir(target.heirId, { phones: [...phones, { number: key, type: null }] });
      return null;
    }
    const res = await leadsAPI.contacts(target.leadId);
    // The list includes the heirs' numbers too; only the lead's own go back.
    const own = (res.data?.numbers || []).filter((n: any) => !n.heirId);
    if (own.some((n: any) => String(n.number).replace(/\D/g, '').slice(-10) === key)) return null;
    await leadsAPI.setContacts(target.leadId, {
      phones: [...own.map((n: any) => ({ number: n.number, type: n.type ?? null })), { number: key, type: null }],
    });
    return null;
  } catch (err: any) {
    return err?.response?.data?.message || 'the save failed.';
  }
}

/** What was said on the call, three lines until opened. */
function Transcript({ text, answered }: { text: string | null; answered: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text) {
    return (
      <p className="mt-1 text-xs text-gray-400">
        {answered ? 'Someone took this call. No transcript.' : 'No transcript'}
      </p>
    );
  }
  const long = text.length > 220;
  return (
    <div className="mt-1">
      {answered && <p className="text-[11px] text-gray-500 dark:text-gray-400">Someone took this call. What was said:</p>}
      <p
        className={`text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap ${
          long && !open ? 'line-clamp-3' : ''
        }`}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline"
        >
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  );
}

/**
 * Find who the call was from, then attach. Searches claimants and the people
 * on their cases by name, address or any number on file, so typing a
 * relative's name finds the case they belong to. Picking a person fills in
 * both the lead and who called.
 */
function AttachPicker({
  number,
  onPick,
  disabled,
}: {
  number: string | null;
  onPick: (target: AttachTarget) => void;
  disabled: boolean;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AttachOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<AttachOption | null>(null);
  const [people, setPeople] = useState<any[] | null>(null);
  const [heirId, setHeirId] = useState<string>('');
  const [save, setSave] = useState(true);

  useEffect(() => {
    if (picked || q.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await inboxAPI.attachSearch(q.trim());
        if (!cancelled) setResults(res.data?.results || []);
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
  }, [q, picked]);

  // On a surplus case the caller is often a relative, not the claimant.
  useEffect(() => {
    setPeople(null);
    if (!picked || picked.source !== 'SURPLUS') return;
    let cancelled = false;
    surplusAPI
      .heirs(picked.leadId)
      .then((res) => {
        if (!cancelled) setPeople(res.data?.heirs || []);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [picked]);

  const choose = (r: AttachOption) => {
    setPicked(r);
    setHeirId(r.heirId || '');
  };

  const inputCls =
    'w-full px-2.5 py-1.5 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none';

  if (picked) {
    const leadName = picked.leadName || picked.propertyAddress || 'this lead';
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{leadName}</span>
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="text-gray-500 dark:text-gray-400 hover:underline shrink-0"
          >
            Change
          </button>
        </div>
        {picked.source === 'SURPLUS' && (
          <label className="block text-[11px] text-gray-600 dark:text-gray-300">
            Who called
            <select
              value={heirId}
              onChange={(e) => setHeirId(e.target.value)}
              disabled={people === null}
              className={`${inputCls} mt-0.5`}
            >
              <option value="">{leadName} (claimant)</option>
              {/* The picked person stays listed while the case's people load. */}
              {people === null && picked.heirId && <option value={picked.heirId}>{picked.name}</option>}
              {(people || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.relationship ? ` · ${p.relationship}` : p.roleLabel ? ` · ${p.roleLabel}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {number && (
          <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
            Save {formatPhoneDisplay(number)} on them, so their next call shows their name
          </label>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPick({ leadId: picked.leadId, heirId: heirId || null, saveNumber: save && !!number })}
          className="px-2.5 py-1 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium disabled:opacity-50"
        >
          Attach
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a name, relative, address or phone"
        className={inputCls}
      />
      {loading && <p className="text-[11px] text-gray-400 mt-1">Searching…</p>}
      {!loading && q.trim().length >= 2 && results.length === 0 && (
        <p className="text-[11px] text-gray-400 mt-1">No matches</p>
      )}
      <ul className="mt-1">
        {results.map((r) => (
          <li key={`${r.leadId}:${r.heirId || ''}`}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => choose(r)}
              className="w-full text-left px-2 py-1.5 rounded hover:bg-white dark:hover:bg-gray-800 disabled:opacity-50"
            >
              <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                {r.name || r.propertyAddress}
                <span className="font-normal text-gray-500 dark:text-gray-400"> · {r.label}</span>
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                {r.kind === 'person' ? `on ${r.leadName}${r.propertyAddress ? `, ${r.propertyAddress}` : ''}` : r.propertyAddress}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
