'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import AppShell from '@/components/AppShell';
import ActionCard, { ActionItemProps, ActionCategory } from '@/components/ActionCard';
import ScheduleFollowUpModal from '@/components/ScheduleFollowUpModal';
import { actionsAPI, authAPI, dashboardAPI } from '@/lib/api';

type SortMode = 'priority' | 'oldest' | 'newest';

const FILTER_GROUPS: Array<{ label: string; categories: ActionCategory[] }> = [
  { label: 'All', categories: [] },
  { label: 'Replies', categories: ['NEEDS_REPLY', 'DRIP_REPLY_REVIEW'] },
  { label: 'Follow-ups', categories: ['FOLLOW_UP_DUE', 'STALE_HOT_LEAD'] },
  { label: 'Offers', categories: ['OFFER_READY', 'CONTRACT_PENDING'] },
  { label: 'Stale', categories: ['EXHAUSTED_LEAD', 'CAMP_INCOMPLETE'] },
  { label: 'Other', categories: ['NEW_LEAD_INBOUND'] },
];

function Greeting({ name }: { name: string | null }) {
  const today = new Date();
  const hour = today.getHours();
  const salutation = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {salutation}
        {name ? `, ${name}` : ''}
      </h1>
      <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
        {format(today, 'EEEE, MMMM d, yyyy')}
      </p>
    </div>
  );
}

function QuickStatsBar({ stats }: { stats: any }) {
  if (!stats) return null;
  const strikeZone = stats.leadsByBand?.STRIKE_ZONE || 0;
  const hot = (stats.leadsByBand?.HOT || 0) + (stats.leadsByBand?.WORKABLE || 0) + (stats.leadsByBand?.WARM || 0);
  const tiles = [
    { label: 'Active', value: stats.totalLeads || 0, href: '/leads' },
    { label: 'Need Action', value: stats.needsFollowUp || 0, href: '/leads?band=HOT', alert: stats.needsFollowUp > 0 },
    { label: 'Strike Zone', value: strikeZone, href: '/leads?band=STRIKE_ZONE' },
    { label: 'Hot + Workable', value: hot, href: '/leads?band=HOT' },
    { label: 'Under Contract', value: stats.underContract || 0, href: '/leads?status=UNDER_CONTRACT' },
    { label: 'Closed', value: stats.closedDeals || 0, href: '/leads?status=CLOSED_WON' },
  ];
  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
      {tiles.map((t) => (
        <Link
          key={t.label}
          href={t.href}
          className={`block rounded-lg border px-3 py-2 text-center transition-colors ${
            t.alert
              ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500">
            {t.label}
          </div>
          <div className={`text-xl font-bold mt-0.5 ${t.alert ? 'text-red-600' : 'text-gray-900 dark:text-gray-100'}`}>
            {t.value}
          </div>
        </Link>
      ))}
    </div>
  );
}

function TodayAtAGlance({ stats }: { stats: any }) {
  const tiles = [
    { label: 'New this week', value: stats?.newLeadsThisWeek ?? 0 },
    { label: 'Stale (3d+)', value: stats?.staleLeads ?? 0 },
    { label: 'Under Contract', value: stats?.underContract ?? 0 },
    { label: 'Closed', value: stats?.closedDeals ?? 0 },
  ];
  return (
    <div className="card p-4">
      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">Today at a Glance</h3>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <div key={t.label}>
            <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500">
              {t.label}
            </div>
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100 mt-0.5">
              {t.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickActions({ onScheduleFollowUp }: { onScheduleFollowUp: () => void }) {
  return (
    <div className="card p-4">
      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">Quick Actions</h3>
      <div className="grid grid-cols-2 gap-2">
        <Link href="/leads/new" className="btn btn-secondary btn-sm text-center">+ New Lead</Link>
        <Link href="/leads" className="btn btn-secondary btn-sm text-center">Search leads</Link>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onScheduleFollowUp}
        >
          Schedule follow-up
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled title="Coming soon">
          Compose message
        </button>
      </div>
    </div>
  );
}

function UpcomingFollowUps({ tasks }: { tasks: any[] }) {
  if (!tasks || tasks.length === 0) {
    return (
      <div className="card p-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">Upcoming Follow-Ups</h3>
        <div className="text-xs text-gray-400 dark:text-gray-500">
          No upcoming follow-ups.
        </div>
      </div>
    );
  }
  return (
    <div className="card p-4">
      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">Upcoming Follow-Ups</h3>
      <div className="space-y-2">
        {tasks.slice(0, 5).map((t: any) => (
          <Link
            key={t.id}
            href={`/leads/${t.leadId}`}
            className="block text-xs hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-2 py-1.5 -mx-2"
          >
            <div className="font-medium text-gray-800 dark:text-gray-200 truncate">
              {t.title}
            </div>
            <div className="text-gray-400 dark:text-gray-500 mt-0.5">
              {t.lead?.propertyAddress}
              {t.dueDate ? ` • ${format(new Date(t.dueDate), 'MMM d, h:mm a')}` : ''}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function ActionQueueDashboard() {
  const [items, setItems] = useState<ActionItemProps[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [activeFilter, setActiveFilter] = useState(0);
  const [sort, setSort] = useState<SortMode>('priority');
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const reloadTasks = useCallback(() => {
    dashboardAPI.tasks().then((res) => setTasks(res.data || [])).catch(() => {});
  }, []);

  const loadQueue = useCallback(async (sortMode: SortMode, filterIdx: number) => {
    const group = FILTER_GROUPS[filterIdx];
    try {
      const res = await actionsAPI.queue({
        sort: sortMode,
        category: group.categories.length > 0 ? group.categories : undefined,
      });
      setItems(res.data?.items || []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    Promise.allSettled([
      authAPI.getMe(),
      dashboardAPI.stats(),
      dashboardAPI.tasks(),
    ]).then(([me, s, t]) => {
      if (me.status === 'fulfilled') setCurrentUser(me.value.data);
      if (s.status === 'fulfilled') setStats(s.value.data);
      if (t.status === 'fulfilled') setTasks(t.value.data || []);
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    loadQueue(sort, activeFilter).finally(() => setLoading(false));
  }, [sort, activeFilter, loadQueue]);

  const handleResolved = useCallback((actionKey: string) => {
    setItems((prev) => prev.filter((i) => i.actionKey !== actionKey));
  }, []);

  const count = items.length;
  const nothingHere = !loading && count === 0;

  return (
    <AppShell>
      <main className="max-w-screen-2xl mx-auto px-6 py-8 pb-16 md:pb-8 space-y-6">
        <Greeting name={currentUser?.firstName || null} />
        <QuickStatsBar stats={stats} />

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6">
          {/* Left column — Action Queue */}
          <section className="space-y-4">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <div className="flex items-baseline gap-3">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  Your Action Queue
                </h2>
                <span className="text-sm text-gray-400 dark:text-gray-500">{count}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400 dark:text-gray-500">Sort</label>
                <select
                  className="input text-xs py-1"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortMode)}
                >
                  <option value="priority">Priority</option>
                  <option value="oldest">Oldest first</option>
                  <option value="newest">Newest first</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {FILTER_GROUPS.map((g, idx) => (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => setActiveFilter(idx)}
                  className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                    activeFilter === idx
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {loading && (
              <div className="text-sm text-gray-400 dark:text-gray-500 animate-pulse">
                Loading queue…
              </div>
            )}
            {!loading && nothingHere && (
              <div className="card p-8 text-center">
                <div className="text-lg font-bold text-gray-800 dark:text-gray-200 mb-1">
                  You're all caught up.
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  New actions will appear here as leads need attention.
                </div>
                <Link href="/leads" className="btn btn-secondary btn-sm">
                  Browse all leads
                </Link>
              </div>
            )}
            {!loading && !nothingHere && (
              <div className="space-y-3">
                {items.map((item) => (
                  <ActionCard
                    key={item.actionKey}
                    item={item}
                    onResolved={handleResolved}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Right column — glance, actions, follow-ups */}
          <aside className="space-y-4">
            <TodayAtAGlance stats={stats} />
            <QuickActions onScheduleFollowUp={() => setScheduleOpen(true)} />
            <UpcomingFollowUps tasks={tasks} />
          </aside>
        </div>
      </main>
      <ScheduleFollowUpModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onCreated={reloadTasks}
      />
    </AppShell>
  );
}
