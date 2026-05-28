'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNowStrict } from 'date-fns';
import AppShell from '@/components/AppShell';
import PropertyPhoto from '@/components/PropertyPhoto';
import CommunicationsTimeline from '@/components/communications/CommunicationsTimeline';
import NotesPanel from '@/components/communications/NotesPanel';
import MessageComposer from '@/components/communications/MessageComposer';
import type { TimelineItem, NoteItem } from '@/components/communications/types';
import { inboxAPI, leadsAPI, authAPI, gmailAPI, type InboxFilter } from '@/lib/api';

const POLL_MS = 60_000;
const PAGE_SIZE = 20;

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
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [commLoading, setCommLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [gmailConnected, setGmailConnected] = useState(false);

  const threadRef = useRef<HTMLDivElement | null>(null);
  const pausePollRef = useRef(false);

  useEffect(() => {
    authAPI.getMe().then((res) => setCurrentUser(res.data)).catch(() => {});
    authAPI.getTeam().then((res) => setTeamMembers(res.data || [])).catch(() => {});
    gmailAPI.status().then((res) => setGmailConnected(!!res.data?.connected)).catch(() => {});
  }, []);

  const loadCommunications = useCallback((leadId: string) => {
    setCommLoading(true);
    return leadsAPI
      .communications(leadId)
      .then((res) => {
        setTimeline(res.data?.timeline || []);
        setNotes(res.data?.notes || []);
      })
      .catch(() => {
        setTimeline([]);
        setNotes([]);
      })
      .finally(() => setCommLoading(false));
  }, []);

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
      setTimeline([]);
      setNotes([]);
      return;
    }
    loadCommunications(selectedId);

    inboxAPI
      .markRead(selectedId)
      .then(() => {
        setThreads((prev) =>
          prev.map((t) => (t.leadId === selectedId ? { ...t, threadUnread: false } : t)),
        );
        refreshCounts();
      })
      .catch(() => {});
  }, [selectedId, refreshCounts, loadCommunications]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [timeline]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    loadThreads({ filter, page: next, append: true });
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

                <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-3">
                  {commLoading ? (
                    <div className="text-xs text-gray-400 animate-pulse">Loading…</div>
                  ) : (
                    <CommunicationsTimeline items={timeline} />
                  )}
                </div>

                <MessageComposer
                  leadId={selected.leadId}
                  sellerPhone={selected.sellerPhone}
                  sellerEmail={null}
                  gmailConnected={gmailConnected}
                  currentUser={currentUser}
                  teamMembers={teamMembers}
                  onSent={() => loadCommunications(selected.leadId)}
                />
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

                <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                  <NotesPanel
                    notes={notes}
                    canAdd={!!currentUser}
                    onAddNote={async (text) => {
                      if (!currentUser) return;
                      await leadsAPI.addNote(selected.leadId, text, currentUser.id);
                      await loadCommunications(selected.leadId);
                    }}
                  />
                </div>
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
