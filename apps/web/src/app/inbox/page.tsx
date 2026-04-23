'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { format, formatDistanceToNowStrict } from 'date-fns';
import AppShell from '@/components/AppShell';
import PropertyPhoto from '@/components/PropertyPhoto';
import { actionsAPI, messagesAPI } from '@/lib/api';
import type { ActionItemProps } from '@/components/ActionCard';

interface MessageRow {
  id: string;
  direction: string;
  body: string;
  createdAt: string;
}

function bandPillClass(band: string): string {
  const map: Record<string, string> = {
    STRIKE_ZONE: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    HOT: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
    WARM: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
    WORKABLE: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
    COOL: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    COLD: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
    DEAD_COLD: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  };
  return map[band] || map.COLD;
}

function sellerName(item: ActionItemProps): string {
  const first = (item.lead.sellerFirstName || '').trim();
  const last = (item.lead.sellerLastName || '').trim();
  return [first, last].filter(Boolean).join(' ') || item.lead.propertyAddress;
}

export default function InboxPage() {
  const [items, setItems] = useState<ActionItemProps[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const threadRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => items.find((i) => i.actionKey === selectedKey) || null,
    [items, selectedKey],
  );

  const loadQueue = useCallback(async () => {
    try {
      const res = await actionsAPI.queue({
        category: ['NEEDS_REPLY', 'DRIP_REPLY_REVIEW'],
        sort: 'priority',
        limit: 50,
      });
      const next: ActionItemProps[] = res.data?.items || [];
      setItems(next);
      setSelectedKey((prev) => {
        if (prev && next.some((i) => i.actionKey === prev)) return prev;
        return next[0]?.actionKey || null;
      });
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Load thread + AI draft whenever selection changes.
  useEffect(() => {
    if (!selected) {
      setMessages([]);
      setDraft('');
      return;
    }
    setMessagesLoading(true);
    setDraft(selected.aiDraft || '');
    setError(null);
    messagesAPI
      .list(selected.leadId)
      .then((res) => setMessages(res.data || []))
      .catch(() => setMessages([]))
      .finally(() => setMessagesLoading(false));

    if (!selected.aiDraft) {
      setDraftLoading(true);
      messagesAPI
        .draft(selected.leadId)
        .then((res) => {
          const msg = (res.data as any)?.message;
          if (typeof msg === 'string') setDraft(msg);
        })
        .catch(() => {})
        .finally(() => setDraftLoading(false));
    }
  }, [selected]);

  // Keep thread scrolled to bottom when messages load.
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages]);

  const regenerate = async () => {
    if (!selected) return;
    setDraftLoading(true);
    setDraft('');
    try {
      const res = await messagesAPI.draft(selected.leadId);
      const msg = (res.data as any)?.message;
      if (typeof msg === 'string') setDraft(msg);
    } catch {
      // leave draft empty; user can type manually
    } finally {
      setDraftLoading(false);
    }
  };

  const handleSend = async () => {
    if (!selected || !draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await messagesAPI.send(selected.leadId, draft);
      await actionsAPI.complete(selected.actionKey);
      // Remove current item, auto-advance to next one.
      setItems((prev) => {
        const remaining = prev.filter((i) => i.actionKey !== selected.actionKey);
        setSelectedKey(remaining[0]?.actionKey || null);
        return remaining;
      });
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <AppShell>
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Inbox</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Conversations waiting on your reply.
          </p>
        </div>

        {loading && (
          <div className="text-sm text-gray-400 dark:text-gray-500 animate-pulse">
            Loading inbox…
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="card p-12 text-center">
            <div className="text-lg font-bold text-gray-800 dark:text-gray-200 mb-1">
              Inbox zero.
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              No conversations currently need a reply.
            </div>
            <Link href="/leads" className="btn btn-secondary btn-sm">
              Browse all leads
            </Link>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-4 h-[calc(100vh-12rem)]">
            {/* Conversation list */}
            <aside className="card overflow-hidden flex flex-col">
              <div className="border-b border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                {items.length} conversation{items.length === 1 ? '' : 's'}
              </div>
              <ul className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((item) => {
                  const isSelected = item.actionKey === selectedKey;
                  const age = formatDistanceToNowStrict(new Date(item.createdAt), { addSuffix: false });
                  return (
                    <li key={item.actionKey}>
                      <button
                        type="button"
                        onClick={() => setSelectedKey(item.actionKey)}
                        className={`w-full text-left px-3 py-3 transition-colors ${
                          isSelected
                            ? 'bg-teal-50 dark:bg-teal-900/20'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
                            <PropertyPhoto
                              src={item.lead.primaryPhoto}
                              address={item.lead.propertyAddress}
                              scoreBand={item.lead.scoreBand}
                              size="sm"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                                {sellerName(item)}
                              </div>
                              <div className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">
                                {age}
                              </div>
                            </div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                              {item.lead.propertyAddress}
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 mt-1">
                              {item.subtitle}
                            </div>
                            <div className="flex items-center gap-1 mt-1.5">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${bandPillClass(item.lead.scoreBand)}`}>
                                {item.lead.scoreBand.replace('_', ' ')}
                              </span>
                              {item.priority >= 90 && (
                                <span className="text-[9px] font-bold text-red-600 dark:text-red-400 uppercase">
                                  Urgent
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            {/* Conversation pane */}
            <section className="card flex flex-col overflow-hidden">
              {selected ? (
                <>
                  <header className="border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                        {sellerName(selected)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {selected.lead.propertyAddress}
                        {selected.lead.propertyCity ? `, ${selected.lead.propertyCity}` : ''}
                        {selected.lead.propertyState ? ` ${selected.lead.propertyState}` : ''}
                      </div>
                    </div>
                    <Link
                      href={`/leads/${selected.leadId}`}
                      className="btn btn-secondary btn-sm flex-shrink-0"
                    >
                      Open lead
                    </Link>
                  </header>

                  {/* Thread */}
                  <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    {messagesLoading && (
                      <div className="text-xs text-gray-400 animate-pulse">Loading messages…</div>
                    )}
                    {!messagesLoading && messages.length === 0 && (
                      <div className="text-xs text-gray-400">No messages in this thread.</div>
                    )}
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`p-3 rounded-lg max-w-[80%] ${
                          msg.direction === 'OUTBOUND'
                            ? 'bg-primary-50 dark:bg-primary-900/30 ml-auto'
                            : 'bg-gray-100 dark:bg-gray-800 mr-auto'
                        }`}
                      >
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">
                          {msg.direction === 'OUTBOUND' ? 'You' : 'Seller'} •{' '}
                          {format(new Date(msg.createdAt), 'MMM d, h:mm a')}
                        </div>
                        <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                          {msg.body}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Composer */}
                  <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="font-semibold text-teal-700 dark:text-teal-400">
                        ✨ AI suggested reply
                      </div>
                      <button
                        type="button"
                        onClick={regenerate}
                        className="text-teal-700 dark:text-teal-400 hover:underline"
                        disabled={draftLoading || sending}
                      >
                        Regenerate
                      </button>
                    </div>
                    <textarea
                      className="input w-full text-sm"
                      rows={3}
                      placeholder={draftLoading ? 'Generating draft…' : 'Type a reply or edit the AI draft…'}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      disabled={sending}
                    />
                    {error && (
                      <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] text-gray-400 dark:text-gray-500">
                        Review before sending — AI drafts can miss context.
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleSend}
                        disabled={sending || !draft.trim()}
                      >
                        {sending ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
                  Select a conversation to reply.
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </AppShell>
  );
}
