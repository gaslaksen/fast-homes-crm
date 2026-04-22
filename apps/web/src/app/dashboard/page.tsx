'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { dashboardAPI, authAPI, tasksAPI } from '@/lib/api';
import { formatDistanceToNow, format } from 'date-fns';
import PropertyPhoto from '@/components/PropertyPhoto';
import AppShell from '@/components/AppShell';

function KpiCard({
  label,
  value,
  sub,
  color = 'gray',
  href,
  alert,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: 'gray' | 'green' | 'red' | 'blue' | 'yellow' | 'purple';
  href?: string;
  alert?: boolean;
}) {
  const colorMap = {
    gray:   'text-gray-900 dark:text-gray-100',
    green:  'text-green-600',
    red:    'text-red-600',
    blue:   'text-blue-600',
    yellow: 'text-amber-600',
    purple: 'text-purple-600',
  };
  const content = (
    <div className={`bg-white dark:bg-gray-900 rounded-xl border ${alert ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950' : 'border-gray-200 dark:border-gray-700'} p-5 flex flex-col gap-1 h-full`}>
      <div className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-3xl font-bold leading-none mt-1 ${colorMap[color]}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:scale-[1.01] transition-transform">{content}</Link> : <div>{content}</div>;
}

function ScoreBadge({ band }: { band: string }) {
  const map: Record<string, string> = {
    STRIKE_ZONE: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    HOT:         'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
    WARM:        'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
    COOL:        'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    COLD:        'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  };
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${map[band] || 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
      {band.replace('_', ' ')}
    </span>
  );
}

function LeadRow({ lead, showLastTouched = false }: { lead: any; showLastTouched?: boolean }) {
  const mao = lead.arv ? Math.round(lead.arv * 0.70 - 40000 - 15000) : null;
  const spread = (mao && lead.askingPrice) ? mao - lead.askingPrice : null;
  const hoursStale = lead.lastTouchedAt
    ? Math.round((Date.now() - new Date(lead.lastTouchedAt).getTime()) / (1000 * 60 * 60))
    : null;

  return (
    <Link
      href={`/leads/${lead.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors rounded-lg group overflow-hidden"
    >
      <PropertyPhoto src={lead.primaryPhoto} scoreBand={lead.scoreBand} address={lead.propertyAddress} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <ScoreBadge band={lead.scoreBand} />
          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
            {lead.propertyAddress}, {lead.propertyCity}
          </span>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {lead.sellerFirstName} {lead.sellerLastName}
          {showLastTouched && hoursStale !== null && (
            <span className="text-amber-600 ml-2">· no contact {hoursStale}h</span>
          )}
        </div>
      </div>
      <div className="text-right flex-shrink-0 space-y-0.5">
        {lead.arv ? (
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">ARV ${(lead.arv / 1000).toFixed(0)}k</div>
        ) : null}
        {spread !== null ? (
          <div className={`text-xs font-bold ${spread >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {spread >= 0 ? '+' : ''}${(spread / 1000).toFixed(0)}k spread
          </div>
        ) : lead.askingPrice ? (
          <div className="text-xs text-gray-400 dark:text-gray-500">ask ${(lead.askingPrice / 1000).toFixed(0)}k</div>
        ) : null}
      </div>
      <div className="text-xl font-bold text-gray-300 dark:text-gray-600 group-hover:text-blue-400 transition-colors ml-1">›</div>
    </Link>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null);
  const [hotLeads, setHotLeads] = useState<any[]>([]);
  const [staleLeads, setStaleLeads] = useState<any[]>([]);
  const [newLeads, setNewLeads] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const today = new Date();

  const loadTasks = (userId?: string) => {
    dashboardAPI.tasks(userId).then((res) => setTasks(res.data || [])).catch(() => {});
  };

  useEffect(() => {
    Promise.allSettled([
      dashboardAPI.stats(),
      dashboardAPI.hotLeads(8),
      dashboardAPI.staleLeads(5),
      dashboardAPI.newLeads(10),
      authAPI.getMe(),
    ]).then(([s, h, stale, nl, me]) => {
      if (s.status === 'fulfilled') setStats(s.value.data);
      if (h.status === 'fulfilled') setHotLeads(h.value.data);
      if (stale.status === 'fulfilled') setStaleLeads(stale.value.data);
      if (nl.status === 'fulfilled') setNewLeads(nl.value.data);
      if (me.status === 'fulfilled') {
        setCurrentUser(me.value.data);
        loadTasks(me.value.data?.id);
      } else {
        loadTasks();
      }
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading dashboard...</div>
      </div>
    );
  }

  const strikeZone = stats?.leadsByBand?.STRIKE_ZONE || 0;
  const hot = stats?.leadsByBand?.HOT || 0;
  const warm = stats?.leadsByBand?.WARM || 0;

  return (
    <AppShell>
      <main className="max-w-screen-2xl mx-auto px-6 py-8 pb-16 md:pb-8 space-y-8">

        {/* Greeting + date */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{(() => { const h = today.getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })()}{currentUser?.firstName ? `, ${currentUser.firstName}` : ''}</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">{format(today, 'EEEE, MMMM d, yyyy')}</p>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <KpiCard
            label="Active Leads"
            value={stats?.totalLeads || 0}
            sub={`${stats?.newLeadsThisWeek || 0} new this week`}
            color="blue"
            href="/leads"
          />
          <KpiCard
            label="Need Action Now"
            value={stats?.needsFollowUp || 0}
            sub="Hot/Strike untouched 24h+"
            color={stats?.needsFollowUp > 0 ? 'red' : 'green'}
            alert={stats?.needsFollowUp > 0}
            href="/leads?band=HOT"
          />
          <KpiCard
            label="Strike Zone"
            value={strikeZone}
            sub="Highest priority"
            color="red"
            href="/leads?band=STRIKE_ZONE"
          />
          <KpiCard
            label="Hot + Workable"
            value={hot + warm}
            sub={`${hot} hot · ${warm} workable`}
            color="yellow"
            href="/leads?band=WORKABLE"
          />
          <KpiCard
            label="Under Contract"
            value={stats?.underContract || 0}
            sub="In progress"
            color="purple"
            href="/leads?status=UNDER_CONTRACT"
          />
          <KpiCard
            label="Deals Closed"
            value={stats?.closedDeals || 0}
            sub={stats?.totalRevenue > 0 ? `$${(stats.totalRevenue / 1000).toFixed(0)}k earned` : 'All time'}
            color="green"
            href="/leads?status=CLOSED_WON"
          />
        </div>

        {/* Pipeline Stage Breakdown */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-4">Pipeline Breakdown</h2>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
            {[
              { label: 'Attempting Contact', keys: ['ATTEMPTING_CONTACT'],        color: 'bg-gray-200 dark:bg-gray-700' },
              { label: 'Qualifying',         keys: ['QUALIFYING', 'QUALIFIED'],   color: 'bg-blue-200 dark:bg-blue-800' },
              { label: 'Offer Made',         keys: ['OFFER_SENT'],                color: 'bg-orange-200 dark:bg-orange-800' },
              { label: 'Negotiating',        keys: ['NEGOTIATING'],               color: 'bg-yellow-200 dark:bg-yellow-800' },
              { label: 'Under Contract',     keys: ['UNDER_CONTRACT', 'CLOSING'], color: 'bg-purple-200 dark:bg-purple-800' },
              { label: 'Closed Won',         keys: ['CLOSED_WON'],                color: 'bg-green-200 dark:bg-green-800' },
            ].map(({ label, keys, color }) => {
              const count = keys.reduce((sum, k) => sum + (stats?.leadsByStatus?.[k] || 0), 0);
              const activeTotal = Object.entries(stats?.leadsByStatus || {})
                .filter(([k]) => !['DEAD', 'CLOSED_LOST', 'NURTURE'].includes(k))
                .reduce((a, [, b]) => a + (b as number), 0);
              const pct = activeTotal > 0 ? Math.round((count / activeTotal) * 100) : 0;
              return (
                <Link key={keys[0]} href={`/leads?status=${keys[0]}`} className="group">
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{count}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{label}</div>
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">{pct}%</div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Main 2-col grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Left column: Hot Leads + New Leads */}
          <div className="space-y-6">

            {/* Hot Leads */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                <h2 className="font-bold text-gray-900 dark:text-gray-100">🔥 Hot Leads</h2>
                <Link href="/leads?scoreBand=HOT,STRIKE_ZONE" className="text-xs text-blue-600 hover:underline font-medium">
                  View all →
                </Link>
              </div>
              {hotLeads.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
                  No hot leads yet.<br/>
                  <Link href="/leads" className="text-blue-500 hover:underline mt-1 inline-block">View all leads</Link>
                </div>
              ) : (
                <div className="divide-y divide-gray-50 dark:divide-gray-800 py-1">
                  {hotLeads.map((lead) => <LeadRow key={lead.id} lead={lead} />)}
                </div>
              )}
            </div>

            {/* New Leads */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                <h2 className="font-bold text-gray-900 dark:text-gray-100">🆕 New Leads</h2>
                <Link href="/leads?sort=created" className="text-xs text-blue-600 hover:underline font-medium">
                  View all →
                </Link>
              </div>
              {newLeads.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400 dark:text-gray-500">No leads yet.</div>
              ) : (
                <div className="divide-y divide-gray-50 dark:divide-gray-800">
                  {newLeads.map((lead) => {
                    const statusColors: Record<string, string> = {
                      NEW: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
                      ATTEMPTING_CONTACT: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
                      QUALIFYING: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
                      OFFER_SENT: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
                      UNDER_CONTRACT: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400',
                      CLOSED_WON: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
                      DEAD: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500',
                    };
                    const statusLabel: Record<string, string> = {
                      NEW: 'New', ATTEMPTING_CONTACT: 'Contacting', QUALIFYING: 'Qualifying',
                      OFFER_SENT: 'Offer Made', UNDER_CONTRACT: 'Under Contract',
                      CLOSED_WON: 'Closed', DEAD: 'Dead',
                    };
                    return (
                      <Link
                        key={lead.id}
                        href={`/leads/${lead.id}`}
                        className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          {(lead.sellerFirstName || lead.sellerLastName) && (
                            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">
                              {[lead.sellerFirstName, lead.sellerLastName].filter(Boolean).join(' ')}
                            </div>
                          )}
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{lead.propertyAddress}</div>
                          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            {lead.propertyCity}, {lead.propertyState}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors[lead.status] || 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
                            {statusLabel[lead.status] || lead.status.replace(/_/g, ' ')}
                          </span>
                          <span className="text-xs text-gray-300 dark:text-gray-600">
                            {formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

          {/* Right column: Follow-Up Needed + Tasks */}
          <div className="space-y-6">

            {/* Needs Follow-Up */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-amber-200 dark:border-amber-800 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-amber-100 dark:border-amber-800 bg-amber-50 dark:bg-amber-950">
                <h2 className="font-bold text-amber-900 dark:text-amber-400">⏰ Follow-Up Needed</h2>
                <span className="text-xs text-amber-600 font-medium">Hot/Warm · stale 3d+</span>
              </div>
              {staleLeads.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400 dark:text-gray-500">All caught up! ✅</div>
              ) : (
                <div className="divide-y divide-gray-50 dark:divide-gray-800 py-1">
                  {staleLeads.map((lead) => <LeadRow key={lead.id} lead={lead} showLastTouched />)}
                </div>
              )}
            </div>

            {/* Follow-Up Reminders */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                <h2 className="font-bold text-gray-900 dark:text-gray-100">📋 Follow-Ups</h2>
                <span className="text-xs text-gray-400 dark:text-gray-500">{tasks.length} pending</span>
              </div>
              {tasks.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400 dark:text-gray-500">No upcoming follow-ups. Schedule one from a lead page.</div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {tasks.slice(0, 10).map((task) => (
                    <div key={task.id} className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <button
                        onClick={() => {
                          tasksAPI.complete(task.id, currentUser?.id).then(() => loadTasks(currentUser?.id));
                        }}
                        className="mt-1 w-4 h-4 rounded border-2 border-gray-300 dark:border-gray-600 hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/30 flex-shrink-0 transition-colors"
                        title="Mark complete"
                      />
                      <Link href={`/leads/${task.lead.id}`} className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{task.title}</div>
                        {task.description && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{task.description}</div>
                        )}
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {task.lead.propertyAddress} · {task.lead.sellerFirstName} {task.lead.sellerLastName}
                        </div>
                      </Link>
                      {task.dueDate && (
                        <div className={`text-xs font-medium flex-shrink-0 ml-2 mt-1 ${new Date(task.dueDate) < new Date() ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'}`}>
                          {format(new Date(task.dueDate), 'MMM d · h:mm a')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Lead Source Breakdown */}
        {stats?.leadsBySource && Object.keys(stats.leadsBySource).length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-4">Lead Sources</h2>
            <div className="flex flex-wrap gap-4">
              {Object.entries(stats.leadsBySource).map(([source, count]) => (
                <div key={source} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-400" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{source.replace(/_/g, ' ')}</span>
                  <span className="text-sm text-gray-400 dark:text-gray-500">{count as number}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </AppShell>
  );
}
