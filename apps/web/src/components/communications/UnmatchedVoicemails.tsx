'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { inboxAPI, leadsAPI } from '@/lib/api';
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
}

/**
 * Voicemails from numbers that matched no lead. A voicemail from a known
 * number already sits on that lead's thread; these have nowhere to go until
 * someone attaches them to the right lead or dismisses them.
 *
 * `refreshKey` is the open-voicemail count from the inbox's own poll, so the
 * list reloads when a new one arrives without a second poller.
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
      alert('Could not dismiss that voicemail.');
    } finally {
      setBusyId(null);
    }
  };

  const attach = async (vm: Voicemail, leadId: string) => {
    setBusyId(vm.id);
    try {
      await inboxAPI.attachVoicemail(vm.id, leadId);
      setItems((prev) => prev.filter((x) => x.id !== vm.id));
      setAttachingId(null);
      onChanged();
      onAttached(leadId);
    } catch {
      alert('Could not attach that voicemail.');
    } finally {
      setBusyId(null);
    }
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
          Voicemails from unknown callers{' '}
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
                  {formatDistanceToNowStrict(new Date(vm.createdAt), { addSuffix: true })}
                  {vm.duration != null ? ` · ${vm.duration}s` : ''}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {vm.transcript || <span className="text-gray-400">No transcript</span>}
              </p>
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
                <LeadPicker disabled={busyId === vm.id} onPick={(leadId) => attach(vm, leadId)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Search box over every lead, pipelines included: these are mostly surplus claimants. */
function LeadPicker({ onPick, disabled }: { onPick: (leadId: string) => void; disabled: boolean }) {
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
        const res = await leadsAPI.list({
          search: q.trim(),
          limit: 8,
          includePipelines: 'true',
          showInactive: 'true',
        });
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
    <div className="mt-2">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, address or phone"
        className="w-full px-2.5 py-1.5 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
      />
      {loading && <p className="text-[11px] text-gray-400 mt-1">Searching…</p>}
      {!loading && q.trim().length >= 2 && results.length === 0 && (
        <p className="text-[11px] text-gray-400 mt-1">No matches</p>
      )}
      <ul className="mt-1">
        {results.map((lead) => {
          const name = `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim();
          return (
            <li key={lead.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(lead.id)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-white dark:hover:bg-gray-800 disabled:opacity-50"
              >
                <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                  {name || lead.propertyAddress}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                  {lead.propertyAddress}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
