'use client';

import { useState } from 'react';
import Link from 'next/link';
import PropertyPhoto from '@/components/PropertyPhoto';
import { actionsAPI, messagesAPI } from '@/lib/api';
import { intentFromActionCategory } from '@/components/leadDetailV2/actionMap';

export type ActionCategory =
  | 'NEEDS_REPLY'
  | 'STALE_HOT_LEAD'
  | 'OFFER_READY'
  | 'CAMP_INCOMPLETE'
  | 'FOLLOW_UP_DUE'
  | 'CONTRACT_PENDING'
  | 'DRIP_REPLY_REVIEW'
  | 'EXHAUSTED_LEAD'
  | 'NEW_LEAD_INBOUND';

export interface ActionItemProps {
  actionKey: string;
  type: ActionCategory;
  priority: number;
  leadId: string;
  lead: {
    id: string;
    propertyAddress: string;
    propertyCity: string;
    propertyState: string;
    sellerFirstName: string;
    sellerLastName: string;
    tier: number | null;
    scoreBand: string;
    status: string;
    primaryPhoto: string | null;
  };
  title: string;
  subtitle: string;
  suggestedAction: { verb: string; target?: string };
  aiDraft?: string;
  createdAt: string;
}

function BandPill({ band }: { band: string }) {
  const map: Record<string, string> = {
    STRIKE_ZONE: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    HOT: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
    WARM: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
    WORKABLE: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
    COOL: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    COLD: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
    DEAD_COLD: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  };
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${map[band] || map.COLD}`}>
      {band.replace('_', ' ')}
    </span>
  );
}

function snoozeOptions(): { label: string; until: Date }[] {
  const now = new Date();
  const plus = (ms: number) => new Date(now.getTime() + ms);
  const tomorrow9 = new Date(now);
  tomorrow9.setDate(tomorrow9.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);
  return [
    { label: '1h', until: plus(60 * 60 * 1000) },
    { label: '4h', until: plus(4 * 60 * 60 * 1000) },
    { label: 'Tomorrow', until: tomorrow9 },
  ];
}

export default function ActionCard({
  item,
  onResolved,
}: {
  item: ActionItemProps;
  onResolved: (actionKey: string) => void;
}) {
  const [draft, setDraft] = useState<string | undefined>(item.aiDraft);
  const [draftOpen, setDraftOpen] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [draftEdit, setDraftEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const urgent = item.priority >= 90;

  const fetchDraft = async () => {
    if (draft) return;
    setLoadingDraft(true);
    try {
      const res = await messagesAPI.draft(item.leadId);
      const message = (res.data as any)?.message;
      if (typeof message === 'string') setDraft(message);
    } catch {
      // surface silently; user can still click "Open lead"
    } finally {
      setLoadingDraft(false);
    }
  };

  const toggleDraft = async () => {
    const next = !draftOpen;
    setDraftOpen(next);
    if (next && !draft) await fetchDraft();
  };

  const regenerate = async () => {
    setDraft(undefined);
    await fetchDraft();
  };

  const resolve = async (action: 'complete' | 'dismiss') => {
    setBusy(true);
    setDismissing(true);
    try {
      if (action === 'complete') {
        await actionsAPI.complete(item.actionKey);
      } else {
        await actionsAPI.dismiss(item.actionKey);
      }
      // Short animation delay before removal.
      setTimeout(() => onResolved(item.actionKey), 180);
    } catch (err) {
      setBusy(false);
      setDismissing(false);
      alert(`Failed to ${action}: ${(err as Error).message}`);
    }
  };

  const snooze = async (until: Date) => {
    setBusy(true);
    setDismissing(true);
    try {
      await actionsAPI.snooze(item.actionKey, until.toISOString());
      setTimeout(() => onResolved(item.actionKey), 180);
    } catch (err) {
      setBusy(false);
      setDismissing(false);
      alert(`Failed to snooze: ${(err as Error).message}`);
    }
  };

  const sendReply = async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      await messagesAPI.send(item.leadId, draft);
      await actionsAPI.complete(item.actionKey);
      setDismissing(true);
      setTimeout(() => onResolved(item.actionKey), 180);
    } catch (err) {
      setBusy(false);
      alert(`Failed to send: ${(err as Error).message}`);
    }
  };

  const primaryLabel = item.suggestedAction.verb;

  return (
    <div
      className={`card p-4 transition-all duration-150 ${
        dismissing ? 'opacity-0 -translate-x-4' : 'opacity-100'
      } ${urgent ? 'border-l-4 border-l-red-500 dark:border-l-red-500' : ''}`}
    >
      <div className="flex items-start gap-3">
        {/* thumbnail */}
        <div className="flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
          <PropertyPhoto
            src={item.lead.primaryPhoto}
            address={item.lead.propertyAddress}
            scoreBand={item.lead.scoreBand}
            size="sm"
          />
        </div>

        {/* body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
              {item.title}
            </h3>
            <BandPill band={item.lead.scoreBand} />
            {urgent && (
              <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase">
                Urgent
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
            {item.lead.propertyAddress}
            {item.lead.propertyCity ? `, ${item.lead.propertyCity}` : ''}
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300 mt-1.5 line-clamp-2">
            {item.subtitle}
          </div>

          {/* AI draft expander */}
          {item.type === 'NEEDS_REPLY' && (
            <div className="mt-2">
              <button
                type="button"
                onClick={toggleDraft}
                className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline"
              >
                {draftOpen ? '▾' : '▸'} ✨ AI suggested reply
              </button>
              {draftOpen && (
                <div className="mt-2 border rounded-lg border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900/50">
                  {loadingDraft && (
                    <div className="text-xs text-gray-400 animate-pulse">Generating…</div>
                  )}
                  {!loadingDraft && draft && (
                    <>
                      {draftEdit ? (
                        <textarea
                          className="input w-full text-sm"
                          rows={3}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                        />
                      ) : (
                        <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                          {draft}
                        </p>
                      )}
                      <div className="flex gap-2 mt-2">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busy}
                          onClick={sendReply}
                        >
                          Send
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busy}
                          onClick={() => setDraftEdit((v) => !v)}
                        >
                          {draftEdit ? 'Done' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busy}
                          onClick={regenerate}
                        >
                          Regenerate
                        </button>
                      </div>
                    </>
                  )}
                  {!loadingDraft && !draft && (
                    <div className="text-xs text-gray-400">No draft available. Open lead to reply manually.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* right-side actions */}
        <div className="flex-shrink-0 flex flex-col items-end gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => {
              if (item.type === 'NEEDS_REPLY') {
                toggleDraft();
              } else {
                resolve('complete');
              }
            }}
          >
            {primaryLabel}
          </button>
          <div className="relative">
            <button
              type="button"
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="More actions"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[160px] z-10">
                <div className="px-3 py-2 text-[10px] uppercase font-semibold text-gray-400">
                  Snooze
                </div>
                {snoozeOptions().map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                    onClick={() => {
                      setMenuOpen(false);
                      snooze(s.until);
                    }}
                  >
                    {s.label}
                  </button>
                ))}
                <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                <button
                  type="button"
                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => {
                    setMenuOpen(false);
                    resolve('dismiss');
                  }}
                >
                  Dismiss
                </button>
                <Link
                  href={`/leads/${item.leadId}?action=${intentFromActionCategory(item.type)}${
                    item.type === 'NEEDS_REPLY' || item.type === 'DRIP_REPLY_REVIEW' || item.type === 'NEW_LEAD_INBOUND' ? '&tab=communications' : ''
                  }${item.type === 'OFFER_READY' ? '&tab=disposition' : ''}`}
                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Open lead
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
