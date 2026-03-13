'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { dashboardAPI } from '@/lib/api';
import { formatDistanceToNow, format } from 'date-fns';
import PropertyPhoto from '@/components/PropertyPhoto';
import AppNav from '@/components/AppNav';

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
    gray:   'text-gray-900',
    green:  'text-green-600',
    red:    'text-red-600',
    blue:   'text-blue-600',
    yellow: 'text-amber-600',
    purple: 'text-purple-600',
  };
  const content = (
    <div className={`bg-white rounded-xl border ${alert ? 'border-red-300 bg-red-50' : 'border-gray-200'} p-5 flex flex-col gap-1 h-full`}>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-3xl font-bold leading-none mt-1 ${colorMap[color]}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:scale-[1.01] transition-transform">{content}</Link> : <div>{content}</div>;
}

function ScoreBadge({ band }: { band: string }) {
  const map: Record<string, string> = {
    STRIKE_ZONE: 'bg-red-100 text-red-700',
    HOT:         'bg-orange-100 text-orange-700',
    WARM:        'bg-yellow-100 text-yellow-700',
    COOL:        'bg-blue-100 text-blue-700',
    COLD:        'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${map[band] || 'bg-gray-100 text-gray-500'}`}>
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
      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors rounded-lg group overflow-hidden"
    >
      <PropertyPhoto src={lead.primaryPhoto} scoreBand={lead.scoreBand} address={lead.propertyAddress} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <ScoreBadge band={lead.scoreBand} />
          <span className="font-semibold text-sm text-gray-900 truncate">
            {lead.propertyAddress}, {lead.propertyCity}
          </span>
        </div>
        <div className="text-xs text-gray-500">
          {lead.sellerFirstName} {lead.sellerLastName}
          {showLastTouched && hoursStale !== null && (
            <span className="text-amber-600 ml-2">· no contact {hoursStale}h</span>
          )}
        </div>
      </div>
      <div className="text-right flex-shrink-0 space-y-0.5">
        {lead.arv ? (
          <div className="text-xs font-semibold text-gray-700">ARV ${(lead.arv / 1000).toFixed(0)}k</div>
        ) : null}
        {spread !== null ? (
          <div className={`text-xs font-bold ${spread >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {spread >= 0 ? '+' : ''}${(spread / 1000).toFixed(0)}k spread
          </div>
        ) : lead.askingPrice ? (
          <div className="text-xs text-gray-400">ask ${(lead.askingPrice / 1000).toFixed(0)}k</div>
        ) : null}
      </div>
      <div className="text-xl font-bold text-gray-300 group-hover:text-blue-400 transition-colors ml-1">›</div>
    </Link>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [hotLeads, setHotLeads] = useState<any[]>([]);
  const [staleLeads, setStaleLeads] = useState<any[]>([]);
  const [newLeads, setNewLeads] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date();

  useEffect(() => {
    Promise.allSettled([
      dashboardAPI.stats(),
      dashboardAPI.hotLeads(8),
      dashboardAPI.staleLeads(5),
      dashboardAPI.tasks(),
      dashboardAPI.newLeads(10),
    ]).then(([s, h, stale, t, nl]) => {
      if (s.status === 'fulfilled') setStats(s.value.data);
      if (h.status === 'fulfilled') setHotLeads(h.value.data);
      if (stale.status === 'fulfilled') setStaleLeads(stale.value.data);
      if (t.status === 'fulfilled') setTasks(t.value.data);
      if (nl.status === 'fulfilled') setNewLeads(nl.value.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm animate-pulse">Loading dashboard...</div>
      </div>
    );
  }

  const strikeZone = stats?.leadsByBand?.STRIKE_ZONE || 0;
  const hot = stats?.leadsByBand?.HOT || 0;
  const warm = stats?.leadsByBand?.WARM || 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav />

      <main className="max-w-screen-2xl mx-auto px-6 py-8 space-y-8">

        {/* Greeting + date */}
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{(() => { const h = today.getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })()}, Geoff</h1>
            <p className="text-sm text-gray-400 mt-0.5">{format(today, 'EEEE, MMMM d, yyyy')}</p>
          </div>
          <Link href="/leads/new" className="btn btn-primary btn-sm">+ New Lead</Link>
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

        {/* Pipeline value banner */}
        {stats?.pipelineArvTotal > 0 && (
          <div className="bg-blue-600 text-white rounded-xl px-6 py-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-200">Total Pipeline ARV</div>
              <div className="text-3xl font-bold">${stats.pipelineArvTotal.toLocaleString()}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-blue-200 uppercase tracking-wide">Pencils at Mod. Repairs</div>
              <div className="text-2xl font-bold">{stats.potentialAssignmentFees} deal{stats.potentialAssignmentFees !== 1 ? 's' : ''}</div>
            </div>
            <div className="hidden md:block text-right">
              <div className="text-xs text-blue-200 uppercase tracking-wide">Conversion Rate</div>
              <div className="text-2xl font-bold">{stats.conversionRate}%</div>
            </div>
          </div>
        )}

        {/* Main 2-col grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Hot Leads */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">🔥 Hot Leads</h2>
              <Link href="/leads?scoreBand=HOT,STRIKE_ZONE" className="text-xs text-blue-600 hover:underline font-medium">
                View all →
              </Link>
            </div>
            {hotLeads.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">
                No hot leads yet.<br/>
                <Link href="/leads" className="text-blue-500 hover:underline mt-1 inline-block">View all leads</Link>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 py-1">
                {hotLeads.map((lead) => <LeadRow key={lead.id} lead={lead} />)}
              </div>
            )}
          </div>

          {/* Right column: Needs Follow-up + Tasks */}
          <div className="space-y-6">

            {/* Needs Follow-Up */}
            <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-amber-100 bg-amber-50">
                <h2 className="font-bold text-amber-900">⏰ Follow-Up Needed</h2>
                <span className="text-xs text-amber-600 font-medium">Hot/Warm · stale 3d+</span>
              </div>
              {staleLeads.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">All caught up! ✅</div>
              ) : (
                <div className="divide-y divide-gray-50 py-1">
                  {staleLeads.map((lead) => <LeadRow key={lead.id} lead={lead} showLastTouched />)}
                </div>
              )}
            </div>

            {/* New Leads */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h2 className="font-bold text-gray-900">🆕 New Leads</h2>
                <Link href="/leads?sort=created" className="text-xs text-blue-600 hover:underline font-medium">
                  View all →
                </Link>
              </div>
              {newLeads.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">No leads yet.</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {newLeads.map((lead) => {
                    const statusColors: Record<string, string> = {
                      NEW: 'bg-blue-100 text-blue-700',
                      ATTEMPTING_CONTACT: 'bg-yellow-100 text-yellow-700',
                      QUALIFYING: 'bg-purple-100 text-purple-700',
                      OFFER_SENT: 'bg-orange-100 text-orange-700',
                      UNDER_CONTRACT: 'bg-teal-100 text-teal-700',
                      CLOSED_WON: 'bg-green-100 text-green-700',
                      DEAD: 'bg-gray-100 text-gray-400',
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
                        className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-900 truncate">{lead.propertyAddress}</div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {lead.propertyCity}, {lead.propertyState}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors[lead.status] || 'bg-gray-100 text-gray-500'}`}>
                            {statusLabel[lead.status] || lead.status.replace(/_/g, ' ')}
                          </span>
                          <span className="text-xs text-gray-300">
                            {formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Upcoming Tasks */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h2 className="font-bold text-gray-900">📋 Tasks</h2>
                <span className="text-xs text-gray-400">{tasks.length} pending</span>
              </div>
              {tasks.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">No upcoming tasks.</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {tasks.slice(0, 5).map((task) => (
                    <Link key={task.id} href={`/leads/${task.lead.id}`} className="flex items-start justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{task.title}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {task.lead.propertyAddress} · {task.lead.sellerFirstName} {task.lead.sellerLastName}
                        </div>
                      </div>
                      {task.dueDate && (
                        <div className={`text-xs font-medium flex-shrink-0 ml-4 mt-0.5 ${new Date(task.dueDate) < new Date() ? 'text-red-500' : 'text-gray-400'}`}>
                          {format(new Date(task.dueDate), 'MMM d')}
                        </div>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Pipeline Stage Breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-bold text-gray-900 mb-4">Pipeline Breakdown</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Attempting Contact', key: 'ATTEMPTING_CONTACT', color: 'bg-gray-200' },
              { label: 'In Qualification',   key: 'IN_QUALIFICATION',   color: 'bg-blue-200' },
              { label: 'In Negotiation',     key: 'IN_NEGOTIATION',     color: 'bg-yellow-200' },
              { label: 'Under Contract',     key: 'UNDER_CONTRACT',     color: 'bg-purple-200' },
              { label: 'Closed Won',         key: 'CLOSED_WON',         color: 'bg-green-200' },
            ].map(({ label, key, color }) => {
              const count = stats?.leadsByStatus?.[key] || 0;
              const total = Object.values(stats?.leadsByStatus || {}).reduce((a: number, b) => a + (b as number), 0) as number;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <Link key={key} href={`/leads?status=${key}`} className="group">
                  <div className="text-2xl font-bold text-gray-900">{count}</div>
                  <div className="text-xs text-gray-500 mb-2">{label}</div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-xs text-gray-400 mt-1">{pct}%</div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Lead Source Breakdown */}
        {stats?.leadsBySource && Object.keys(stats.leadsBySource).length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-bold text-gray-900 mb-4">Lead Sources</h2>
            <div className="flex flex-wrap gap-4">
              {Object.entries(stats.leadsBySource).map(([source, count]) => (
                <div key={source} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-400" />
                  <span className="text-sm font-medium text-gray-700">{source.replace(/_/g, ' ')}</span>
                  <span className="text-sm text-gray-400">{count as number}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
