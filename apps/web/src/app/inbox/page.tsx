'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatDistanceToNowStrict } from 'date-fns';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import CommunicationsTimeline from '@/components/communications/CommunicationsTimeline';
import MessageComposer from '@/components/communications/MessageComposer';
import LeadSidePanel from '@/components/leadDetailV2/LeadSidePanel';
import type { TimelineItem, NoteItem } from '@/components/communications/types';
import { inboxAPI, leadsAPI, authAPI, type InboxFilter } from '@/lib/api';
import { getLeadAddressLine, getLeadDisplayName } from '@/lib/format';

const POLL_MS = 60_000;
// Faster cadence for the open conversation so inbound texts appear without a
// manual refresh. Only the active thread is polled at this rate.
const CONV_POLL_MS = 8_000;
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

// Thread row fields that should mirror edits made in the contact pane.
const THREAD_SYNC_FIELDS = [
  'sellerFirstName',
  'sellerLastName',
  'sellerPhone',
  'propertyAddress',
  'propertyCity',
  'propertyState',
] as const;

function threadName(t: ThreadRow): string {
  const name = [t.sellerFirstName, t.sellerLastName].filter(Boolean).join(' ').trim();
  return name || t.propertyAddress;
}

function InboxWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();

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

  // Deep-linkable selection: /inbox?lead=<id> restores the open conversation.
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('lead'));
  const [lead, setLead] = useState<any>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [commLoading, setCommLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  // Email now always available via Mailgun (no per-user Gmail connection).
  const gmailConnected = true;
  const [resumingAi, setResumingAi] = useState(false);

  const threadRef = useRef<HTMLDivElement | null>(null);
  const pausePollRef = useRef(false);
  // Signature of the currently displayed conversation, so silent polls only
  // re-render (and re-scroll) when something actually changed.
  const commSigRef = useRef('');

  useEffect(() => {
    authAPI.getMe().then((res) => setCurrentUser(res.data)).catch(() => {});
    authAPI.getTeam().then((res) => setTeamMembers(res.data || [])).catch(() => {});
  }, []);

  // Desktop: the workspace panes scroll internally; suppress the page-level
  // scrollbar (a 1px calc rounding artifact otherwise keeps it visible).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => {
      document.documentElement.style.overflowY = mq.matches ? 'hidden' : '';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => {
      document.documentElement.style.overflowY = '';
      mq.removeEventListener('change', apply);
    };
  }, []);

  const selectThread = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      router.replace(id ? `/inbox?lead=${id}` : '/inbox', { scroll: false });
    },
    [router],
  );

  // Apply a communications payload, but only touch state when the content
  // changed — keeps silent polls from re-rendering and yanking the scroll.
  // Returns true when new timeline items arrived.
  const applyComms = useCallback((data: any): boolean => {
    const nextTimeline: TimelineItem[] = data?.timeline || [];
    const nextNotes: NoteItem[] = data?.notes || [];
    const prevSig = commSigRef.current;
    const sig =
      `${nextTimeline.length}:${nextTimeline[nextTimeline.length - 1]?.id ?? ''}` +
      `|${nextNotes.length}:${nextNotes[nextNotes.length - 1]?.id ?? ''}`;
    if (sig === prevSig) return false;
    const prevLen = Number(prevSig.split(':')[0]) || 0;
    commSigRef.current = sig;
    setTimeline(nextTimeline);
    setNotes(nextNotes);
    return nextTimeline.length > prevLen;
  }, []);

  const loadCommunications = useCallback(
    (leadId: string) => {
      setCommLoading(true);
      return leadsAPI
        .communications(leadId)
        .then((res) => {
          applyComms(res.data);
        })
        .catch(() => {
          commSigRef.current = '';
          setTimeline([]);
          setNotes([]);
        })
        .finally(() => setCommLoading(false));
    },
    [applyComms],
  );

  const selected = threads.find((t) => t.leadId === selectedId) || null;

  const refreshCounts = useCallback(() => {
    inboxAPI
      .counts()
      .then((res) => setCounts(res.data))
      .catch(() => {});
  }, []);

  // Silent background refresh of the open conversation (no spinner, no reset
  // on transient error). Marks the thread read when a new message lands so the
  // active conversation doesn't flap to unread.
  const pollTimeline = useCallback(
    (leadId: string) => {
      return leadsAPI
        .communications(leadId)
        .then((res) => {
          const grew = applyComms(res.data);
          if (grew) {
            inboxAPI
              .markRead(leadId)
              .then(() => {
                setThreads((prev) =>
                  prev.map((t) => (t.leadId === leadId ? { ...t, threadUnread: false } : t)),
                );
                refreshCounts();
              })
              .catch(() => {});
          }
        })
        .catch(() => {});
    },
    [applyComms, refreshCounts],
  );

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
          // Keep the open conversation across reloads and tab switches (it can
          // live outside the current page or filter); only auto-pick when
          // nothing is open yet.
          setSelectedId((prev) => prev || items[0]?.leadId || null);
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

  // Load the thread + full lead, and mark it read, when selection changes.
  useEffect(() => {
    if (!selectedId) {
      commSigRef.current = '';
      setTimeline([]);
      setNotes([]);
      setLead(null);
      return;
    }
    let cancelled = false;
    loadCommunications(selectedId);
    leadsAPI
      .get(selectedId)
      .then((res) => {
        if (!cancelled) setLead(res.data);
      })
      .catch(() => {
        if (!cancelled) setLead(null);
      });

    inboxAPI
      .markRead(selectedId)
      .then(() => {
        setThreads((prev) =>
          prev.map((t) => (t.leadId === selectedId ? { ...t, threadUnread: false } : t)),
        );
        refreshCounts();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId, refreshCounts, loadCommunications]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [timeline]);

  // Poll the OPEN conversation on a fast cadence so inbound texts appear
  // without a manual refresh. Pauses when the tab is hidden.
  useEffect(() => {
    if (!selectedId) return;
    const interval = setInterval(() => {
      if (!document.hidden) pollTimeline(selectedId);
    }, CONV_POLL_MS);
    const onVisibility = () => {
      if (!document.hidden) pollTimeline(selectedId);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [selectedId, pollTimeline]);

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

  // Contact-pane edits flow back into the lead and the thread list row.
  const patchLead = useCallback(
    (patch: any) => {
      setLead((prev: any) => (prev ? { ...prev, ...patch } : prev));
      const threadPatch: any = {};
      for (const key of THREAD_SYNC_FIELDS) {
        if (key in patch) threadPatch[key] = patch[key];
      }
      if (Object.keys(threadPatch).length > 0) {
        setThreads((prev) =>
          prev.map((t) => (t.leadId === selectedId ? { ...t, ...threadPatch } : t)),
        );
      }
    },
    [selectedId],
  );

  // Triage flow: mark dead from the contact pane, then advance to the next
  // conversation. The reason is saved as a note, mirroring the lead page.
  const handleMarkDead = async () => {
    if (!selectedId) return;
    const reason = window.prompt('Reason for marking this lead dead? (saved as a note)');
    if (reason === null) return;
    try {
      if (reason.trim() && currentUser) {
        await leadsAPI.addNote(selectedId, `[Dead] ${reason.trim()}`, currentUser.id);
      }
      await leadsAPI.update(selectedId, { status: 'DEAD' });
      patchLead({ status: 'DEAD' });
      const idx = threads.findIndex((t) => t.leadId === selectedId);
      const next = threads.find((t, i) => i > idx) || threads.find((t) => t.leadId !== selectedId);
      if (next) selectThread(next.leadId);
      refreshCounts();
    } catch (err) {
      console.error('Failed to mark lead dead', err);
      alert('Failed to mark lead dead');
    }
  };

  const handleResumeAi = async () => {
    if (!selectedId || !lead) return;
    setResumingAi(true);
    try {
      await leadsAPI.toggleAutoRespond(selectedId, true);
      patchLead({ autoRespond: true });
    } catch (err) {
      console.error('Failed to resume AI', err);
      alert('Failed to resume AI');
    } finally {
      setResumingAi(false);
    }
  };

  const countFor = (key: InboxFilter): number | null => {
    if (key === 'all') return counts.all;
    if (key === 'unread') return counts.unread;
    if (key === 'starred') return counts.starred;
    return null;
  };

  const headerName = lead ? getLeadDisplayName(lead) : selected ? threadName(selected) : '';
  const headerAddress = lead
    ? getLeadAddressLine(lead)
    : selected
      ? [selected.propertyAddress, selected.propertyCity, selected.propertyState]
          .filter(Boolean)
          .join(', ')
      : '';

  return (
    <AppShell>
      {/* Full-height workspace on desktop; panes scroll internally */}
      <div className="flex flex-col lg:h-[calc(100dvh-3.5rem)] lg:overflow-hidden">
        <div className="flex-1 lg:min-h-0 flex flex-col lg:flex-row">
          {/* Thread list */}
          <aside className="lg:w-[340px] lg:shrink-0 flex flex-col max-h-[45vh] lg:max-h-none lg:min-h-0 border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <div className="shrink-0 flex border-b border-gray-200 dark:border-gray-700">
              {TABS.map((tab) => {
                const active = filter === tab.key;
                const c = countFor(tab.key);
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilter(tab.key)}
                    className={`flex-1 px-2 py-2.5 text-xs font-semibold transition-colors ${
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
                      onClick={() => selectThread(t.leadId)}
                      className={`w-full text-left px-3 py-3 transition-colors ${
                        isSelected
                          ? 'bg-teal-50 dark:bg-teal-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <Avatar name={threadName(t)} size="md" />
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
          <section className="flex-1 min-w-0 flex flex-col lg:min-h-0 min-h-[55vh] bg-white dark:bg-gray-900">
            {selectedId ? (
              <>
                <header className="shrink-0 flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                      {headerName || 'Conversation'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {headerAddress}
                    </div>
                  </div>
                  <Link
                    href={`/leads/${selectedId}`}
                    title="Open full lead workspace"
                    className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Open lead
                  </Link>
                </header>

                {/* AI paused banner - shown when a human has stepped in */}
                {lead && !lead.autoRespond && !lead.doNotContact && lead.status !== 'DEAD' && (
                  <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-b border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950">
                    <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400 text-xs">
                      <span>🤚</span>
                      <span><strong>AI paused</strong> - you stepped in manually. The AI will not auto-respond until you resume it.</span>
                    </div>
                    <button
                      onClick={handleResumeAi}
                      disabled={resumingAi}
                      className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      {resumingAi ? 'Resuming...' : '▶ Resume AI'}
                    </button>
                  </div>
                )}

                <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-3">
                  {commLoading ? (
                    <div className="text-xs text-gray-400 animate-pulse">Loading…</div>
                  ) : (
                    <CommunicationsTimeline items={timeline} />
                  )}
                </div>

                <div className="shrink-0 border-t border-gray-200 dark:border-gray-700">
                  <MessageComposer
                    leadId={selectedId}
                    sellerPhone={lead?.sellerPhone ?? selected?.sellerPhone ?? null}
                    sellerEmail={lead?.sellerEmail ?? null}
                    gmailConnected={gmailConnected}
                    currentUser={currentUser}
                    teamMembers={teamMembers}
                    doNotContact={lead?.doNotContact}
                    onSent={() => loadCommunications(selectedId)}
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
                {loading ? 'Loading…' : 'Select a conversation.'}
              </div>
            )}
          </section>

          {/* Right pane: Contact (full lead rail) / Notes / Activity */}
          <LeadSidePanel
            modes={['contact', 'notes', 'activity']}
            storagePrefix="dealcore:inboxPane"
            collapsedLabel="Details"
            lead={lead}
            notes={notes}
            currentUser={currentUser}
            onAddNote={async (text) => {
              if (!currentUser || !selectedId) return;
              await leadsAPI.addNote(selectedId, text, currentUser.id);
              await loadCommunications(selectedId);
            }}
            onLeadPatch={patchLead}
            onMarkDead={handleMarkDead}
            hideRailNav
          />
        </div>
      </div>
    </AppShell>
  );
}

// useSearchParams requires a Suspense boundary for static prerendering.
export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxWorkspace />
    </Suspense>
  );
}
