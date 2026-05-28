'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { format, formatDistanceToNowStrict } from 'date-fns';
import AppShell from '@/components/AppShell';
import PropertyPhoto from '@/components/PropertyPhoto';
import { inboxAPI, messagesAPI, type InboxFilter } from '@/lib/api';

const POLL_MS = 60_000;
const PAGE_SIZE = 20;

interface MessageRow {
  id: string;
  direction: string;
  body: string;
  createdAt: string;
}

interface ThreadRow {
  leadId: string;
  sellerFirstName: string | null;
  sellerLastName: string | null;
  sellerPhone: string | null;
  propertyAddress: string;
  propertyCity: string | null;
  propertyState: string | null;
  primaryPhoto: string | null;
  scoreBand: string;
  tags: unknown;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  lastMessageDirection: string | null;
  threadUnread: boolean;
  threadStarred: boolean;
}

const TABS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'recent', label: 'Recent' },
  { key: 'starred', label: 'Starred' },
];

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

function threadName(t: ThreadRow): string {
  const name = [t.sellerFirstName, t.sellerLastName].filter(Boolean).join(' ').trim();
  return name || t.propertyAddress;
}

function tagList(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.filter((x): x is string => typeof x === 'string');
  return [];
}

export default function InboxPage() {
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [counts, setCounts] = useState<{ all: number; unread: number; starred: number }>({
    all: 0,
    unread: 0,
    starred: 0,
  });

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const threadRef = useRef<HTMLDivElement | null>(null);
  const pausePollRef = useRef(false);

  const selected = threads.find((t) => t.leadId === selectedId) || null;

  const refreshCounts = useCallback(() => {
    inboxAPI
      .counts()
      .then((res) => setCounts(res.data))
      .catch(() => {});
  }, []);

  const loadThreads = useCallback(
    async (opts: { filter: InboxFilter; page: number; append: boolean }) => {
      if (opts.append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await inboxAPI.threads({
          filter: opts.filter,
          page: opts.page,
          limit: PAGE_SIZE,
        });
        const items: ThreadRow[] = res.data?.items || [];
        setHasMore(!!res.data?.hasMore);
        setThreads((prev) => (opts.append ? [...prev, ...items] : items));
        if (!opts.append) {
          setSelectedId((prev) => {
            if (prev && items.some((i) => i.leadId === prev)) return prev;
            return items[0]?.leadId || null;
          });
        }
      } catch {
        if (!opts.append) setThreads([]);
      } finally {
        if (opts.append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    pausePollRef.current = sending;
  }, [sending]);

  // Reload list + counts whenever the active tab changes.
  useEffect(() => {
    setPage(1);
    loadThreads({ filter, page: 1, append: false });
    refreshCounts();
  }, [filter, loadThreads, refreshCounts]);

  // Poll the active tab + counts.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (pausePollRef.current) return;
      loadThreads({ filter, page: 1, append: false });
      refreshCounts();
    };
    const start = () => {
      if (!interval) interval = setInterval(tick, POLL_MS);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        tick();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [filter, loadThreads, refreshCounts]);

  // Load the thread + mark it read when selection changes.
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setDraft('');
      return;
    }
    setMessagesLoading(true);
    setDraft('');
    setError(null);
    messagesAPI
      .list(selectedId)
      .then((res) => setMessages(res.data || []))
      .catch(() => setMessages([]))
      .finally(() => setMessagesLoading(false));

    inboxAPI
      .markRead(selectedId)
      .then(() => {
        setThreads((prev) =>
          prev.map((t) => (t.leadId === selectedId ? { ...t, threadUnread: false } : t)),
        );
        refreshCounts();
      })
      .catch(() => {});
  }, [selectedId, refreshCounts]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    loadThreads({ filter, page: next, append: true });
  };

  const generateDraft = async () => {
    if (!selectedId) return;
    setDraftLoading(true);
    try {
      const res = await messagesAPI.draft(selectedId);
      const msg = (res.data as any)?.message;
      if (typeof msg === 'string') setDraft(msg);
    } catch {
      // leave draft empty
    } finally {
      setDraftLoading(false);
    }
  };

  const toggleStar = async (t: ThreadRow, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const next = !t.threadStarred;
    setThreads((prev) =>
      prev
        .map((x) => (x.leadId === t.leadId ? { ...x, threadStarred: next } : x))
        // If we're on the Starred tab and just unstarred, drop it from view.
        .filter((x) => !(filter === 'starred' && x.leadId === t.leadId && !next)),
    );
    try {
      await inboxAPI.star(t.leadId, next);
      refreshCounts();
    } catch {
      // revert on failure
      setThreads((prev) =>
        prev.map((x) => (x.leadId === t.leadId ? { ...x, threadStarred: !next } : x)),
      );
    }
  };

  const handleSend = async () => {
    if (!selectedId || !draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await messagesAPI.send(selectedId, draft);
      const res = await messagesAPI.list(selectedId);
      setMessages(res.data || []);
      setDraft('');
      // Reflect the new outbound preview in the list.
      setThreads((prev) =>
        prev.map((t) =>
          t.leadId === selectedId
            ? {
                ...t,
                lastMessagePreview: draft.slice(0, 160),
                lastMessageDirection: 'OUTBOUND',
                lastMessageAt: new Date().toISOString(),
                threadUnread: false,
              }
            : t,
        ),
      );
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const countFor = (key: InboxFilter): number | null => {
    if (key === 'all') return counts.all;
    if (key === 'unread') return counts.unread;
    if (key === 'starred') return counts.starred;
    return null;
  };

  return (
    <AppShell>
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Inbox</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            All conversations across your leads.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)_minmax(0,300px)] gap-4 h-[calc(100vh-12rem)]">
          {/* Thread list */}
          <aside className="card overflow-hidden flex flex-col">
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              {TABS.map((tab) => {
                const active = filter === tab.key;
                const c = countFor(tab.key);
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilter(tab.key)}
                    className={`flex-1 px-2 py-2 text-xs font-semibold transition-colors ${
                      active
                        ? 'text-teal-700 dark:text-teal-400 border-b-2 border-teal-600'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    {tab.label}
                    {c != null && c > 0 && (
                      <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">{c}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <ul className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
              {loading && (
                <li className="px-3 py-4 text-xs text-gray-400 animate-pulse">Loading…</li>
              )}
              {!loading && threads.length === 0 && (
                <li className="px-3 py-8 text-center text-xs text-gray-400 dark:text-gray-500">
                  {filter === 'unread'
                    ? 'No unread conversations.'
                    : filter === 'starred'
                      ? 'No starred conversations.'
                      : filter === 'recent'
                        ? 'No recently viewed conversations.'
                        : 'No conversations yet.'}
                </li>
              )}
              {threads.map((t) => {
                const isSelected = t.leadId === selectedId;
                const age = t.lastMessageAt
                  ? formatDistanceToNowStrict(new Date(t.lastMessageAt), { addSuffix: false })
                  : '';
                return (
                  <li key={t.leadId}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.leadId)}
                      className={`w-full text-left px-3 py-3 transition-colors ${
                        isSelected
                          ? 'bg-teal-50 dark:bg-teal-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
                          <PropertyPhoto
                            src={t.primaryPhoto}
                            address={t.propertyAddress}
                            scoreBand={t.scoreBand}
                            size="sm"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div
                              className={`text-sm truncate ${
                                t.threadUnread
                                  ? 'font-bold text-gray-900 dark:text-gray-100'
                                  : 'font-semibold text-gray-800 dark:text-gray-200'
                              }`}
                            >
                              {threadName(t)}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {t.threadUnread && (
                                <span className="w-2 h-2 rounded-full bg-teal-500" />
                              )}
                              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                {age}
                              </span>
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => toggleStar(t, e)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') toggleStar(t);
                                }}
                                title={t.threadStarred ? 'Unstar' : 'Star'}
                                className={`text-sm leading-none ${
                                  t.threadStarred
                                    ? 'text-yellow-500'
                                    : 'text-gray-300 dark:text-gray-600 hover:text-yellow-500'
                                }`}
                              >
                                {t.threadStarred ? '★' : '☆'}
                              </span>
                            </div>
                          </div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                            {t.propertyAddress}
                          </div>
                          <div
                            className={`text-xs truncate mt-0.5 ${
                              t.threadUnread
                                ? 'text-gray-800 dark:text-gray-200 font-medium'
                                : 'text-gray-500 dark:text-gray-400'
                            }`}
                          >
                            {t.lastMessageDirection === 'OUTBOUND' && (
                              <span className="text-gray-400">You: </span>
                            )}
                            {t.lastMessagePreview || '(no message)'}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}

              {!loading && hasMore && (
                <li className="p-3">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="btn btn-secondary btn-sm w-full disabled:opacity-50"
                  >
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </li>
              )}
            </ul>
          </aside>

          {/* Conversation pane */}
          <section className="card flex flex-col overflow-hidden">
            {selected ? (
              <>
                <header className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
                  <div className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                    {threadName(selected)}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {selected.propertyAddress}
                    {selected.propertyCity ? `, ${selected.propertyCity}` : ''}
                    {selected.propertyState ? ` ${selected.propertyState}` : ''}
                  </div>
                </header>

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

                <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="text-gray-400 dark:text-gray-500">
                      Reply to {selected.sellerFirstName || 'seller'}
                    </div>
                    {draft.trim() ? (
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-teal-700 dark:text-teal-400 font-semibold">
                          ✨ AI draft
                        </span>
                        <button
                          type="button"
                          onClick={generateDraft}
                          disabled={draftLoading || sending}
                          className="text-gray-500 dark:text-gray-400 hover:underline disabled:opacity-50"
                        >
                          Regenerate
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraft('')}
                          disabled={draftLoading || sending}
                          className="text-gray-500 dark:text-gray-400 hover:underline disabled:opacity-50"
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={generateDraft}
                        disabled={draftLoading || sending}
                        className="text-teal-700 dark:text-teal-400 hover:underline disabled:opacity-50"
                      >
                        {draftLoading ? 'Generating…' : '✨ Generate AI draft'}
                      </button>
                    )}
                  </div>
                  <textarea
                    className="input w-full text-sm"
                    rows={3}
                    placeholder={draftLoading ? 'Generating draft…' : 'Type a reply…'}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={sending}
                  />
                  {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
                  <div className="flex items-center justify-end">
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
                {loading ? 'Loading…' : 'Select a conversation.'}
              </div>
            )}
          </section>

          {/* Lightweight detail column */}
          <aside className="card overflow-y-auto hidden lg:block">
            {selected ? (
              <div className="p-4 space-y-4">
                <div>
                  <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    {threadName(selected)}
                  </div>
                  <span
                    className={`inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded ${bandPillClass(
                      selected.scoreBand,
                    )}`}
                  >
                    {selected.scoreBand.replace('_', ' ')}
                  </span>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                    Property
                  </div>
                  <div className="text-sm text-gray-800 dark:text-gray-200">
                    {selected.propertyAddress}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {[selected.propertyCity, selected.propertyState].filter(Boolean).join(', ')}
                  </div>
                </div>

                {selected.sellerPhone && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                      Phone
                    </div>
                    <a
                      href={`tel:${selected.sellerPhone}`}
                      className="text-sm text-teal-700 dark:text-teal-400 hover:underline"
                    >
                      {selected.sellerPhone}
                    </a>
                  </div>
                )}

                {tagList(selected.tags).length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                      Tags
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {tagList(selected.tags).map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <Link
                  href={`/leads/${selected.leadId}`}
                  className="btn btn-secondary btn-sm w-full text-center"
                >
                  Open lead
                </Link>
              </div>
            ) : (
              <div className="p-4 text-xs text-gray-400 dark:text-gray-500">
                Contact details appear here.
              </div>
            )}
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
