'use client';

import { useEffect, useState, useMemo, Suspense, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { leadsAPI, authAPI, pipelineAPI } from '@/lib/api';
import PropertyPhoto from '@/components/PropertyPhoto';
import Avatar from '@/components/Avatar';
import AppNav from '@/components/AppNav';

// ─── Types ────────────────────────────────────────────────────────────────────

type SortKey = 'score' | 'arv' | 'asking' | 'created' | 'touched' | 'touches' | 'address' | 'tier';
type SortDir = 'asc' | 'desc';
type ViewMode = 'table' | 'cards';

// ─── Constants ────────────────────────────────────────────────────────────────

const INACTIVE_STATUSES = ['DEAD', 'CLOSED_WON', 'CLOSED_LOST'];

const PIPELINE_STAGES = [
  { id: 'NEW',                name: 'New Leads',          color: 'bg-blue-100    border-blue-300    text-blue-800'    },
  { id: 'ATTEMPTING_CONTACT', name: 'Attempting Contact', color: 'bg-yellow-100  border-yellow-300  text-yellow-800'  },
  { id: 'QUALIFYING',         name: 'Qualifying',         color: 'bg-purple-100  border-purple-300  text-purple-800'  },
  { id: 'QUALIFIED',          name: 'Qualified',          color: 'bg-violet-100  border-violet-300  text-violet-800'  },
  { id: 'OFFER_SENT',         name: 'Offer Made',         color: 'bg-orange-100  border-orange-300  text-orange-800'  },
  { id: 'NEGOTIATING',        name: 'Negotiating',        color: 'bg-amber-100   border-amber-300   text-amber-800'   },
  { id: 'UNDER_CONTRACT',     name: 'Under Contract',     color: 'bg-teal-100    border-teal-300    text-teal-800'    },
  { id: 'CLOSING',            name: 'Closing',            color: 'bg-emerald-100 border-emerald-300 text-emerald-800' },
  { id: 'NURTURE',            name: 'Nurture',            color: 'bg-sky-100     border-sky-300     text-sky-700'     },
];

function pipelineTimeAgo(date: string) {
  const hours = Math.round((Date.now() - new Date(date).getTime()) / 3_600_000);
  if (hours < 1)  return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}


const TIER_CONFIG: Record<number, { label: string; short: string; emoji: string; desc: string; pill: string; dot: string; chipActive: string }> = {
  1: {
    label: 'Tier 1', short: 'T1', emoji: '🔥', desc: 'Send contract now',
    pill: 'bg-green-100 text-green-800 border-green-300',
    dot: 'bg-green-500',
    chipActive: 'bg-green-600 text-white border-green-600',
  },
  2: {
    label: 'Tier 2', short: 'T2', emoji: '⚡', desc: 'Opportunity — working it',
    pill: 'bg-amber-100 text-amber-800 border-amber-300',
    dot: 'bg-amber-400',
    chipActive: 'bg-amber-500 text-white border-amber-500',
  },
  3: {
    label: 'Tier 3', short: 'T3', emoji: '❄️', desc: 'Cold / dead / unlikely',
    pill: 'bg-gray-100 text-gray-500 border-gray-300',
    dot: 'bg-gray-400',
    chipActive: 'bg-gray-600 text-white border-gray-600',
  },
};

const BAND_STYLES: Record<string, { pill: string; dot: string }> = {
  STRIKE_ZONE: { pill: 'bg-red-100 text-red-700 border-red-200',         dot: 'bg-red-500' },
  HOT:         { pill: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  WORKABLE:    { pill: 'bg-amber-100 text-amber-700 border-amber-200',    dot: 'bg-amber-400' },
  DEAD_COLD:   { pill: 'bg-gray-100 text-gray-400 border-gray-200',       dot: 'bg-gray-300' },
  WARM:        { pill: 'bg-amber-100 text-amber-700 border-amber-200',    dot: 'bg-amber-400' },
  COOL:        { pill: 'bg-blue-100 text-blue-700 border-blue-200',       dot: 'bg-blue-400' },
  COLD:        { pill: 'bg-gray-100 text-gray-500 border-gray-200',       dot: 'bg-gray-300' },
};

const BAND_LABELS: Record<string, string> = {
  STRIKE_ZONE: 'Strike Zone', HOT: 'Hot', WORKABLE: 'Workable', DEAD_COLD: 'Cold',
  WARM: 'Warm', COOL: 'Cool', COLD: 'Cold',
};

const STATUS_LABELS: Record<string, string> = {
  NEW: 'New',
  ATTEMPTING_CONTACT: 'Contacting',

  QUALIFYING: 'Qualifying',
  IN_QUALIFICATION: 'Qualifying',
  QUALIFIED: 'Qualified',
  OFFER_SENT: 'Offer Made',
  NEGOTIATING: 'Negotiating',
  IN_NEGOTIATION: 'Negotiating',
  UNDER_CONTRACT: 'Under Contract',
  CLOSING: 'Closing',
  CLOSED_WON: 'Closed ✓',
  CLOSED_LOST: 'Lost',
  NURTURE: 'Nurture',
  DEAD: '💀 Dead',
};

const SOURCE_LABELS: Record<string, string> = {
  PROPERTY_LEADS: 'PPL',
  GOOGLE_ADS: 'PPC',
  MANUAL: 'Manual',
  OTHER: 'Other',
};

// ─── Tier computation (client-side, no DB field needed) ───────────────────────

function computeTier(lead: any): 1 | 2 | 3 {
  // Explicitly dead or closed lost → Tier 3
  if (['DEAD', 'CLOSED_LOST'].includes(lead.status)) return 3;
  // Deal math: MAO = ARV * 0.70 - repairs - assignment fee
  const maoVal = lead.arv ? Math.round(lead.arv * 0.7 - 40000 - 15000) : null;
  const pencils = maoVal !== null && lead.askingPrice != null && maoVal >= lead.askingPrice;
  // Tier 1: hot score band AND deal pencils → send contract now
  if ((lead.scoreBand === 'STRIKE_ZONE' || lead.scoreBand === 'HOT') && pencils) return 1;
  // Tier 3: dead-cold score, low score, deal doesn't pencil
  if (lead.scoreBand === 'DEAD_COLD' && lead.totalScore <= 2 && !pencils) return 3;
  // Everything else in the middle
  return 2;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: 1 | 2 | 3 }) {
  const t = TIER_CONFIG[tier];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${t.pill}`}
      title={t.desc}
    >
      {t.emoji} {t.short}
    </span>
  );
}

function ScorePill({ band, score }: { band: string; score: number }) {
  const s = BAND_STYLES[band] || BAND_STYLES.COLD;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${s.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {score}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const closed = status === 'CLOSED_WON';
  const dead   = status === 'CLOSED_LOST' || status === 'DEAD';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
      closed ? 'bg-green-100 text-green-700' :
      dead   ? 'bg-gray-100 text-gray-400'   :
               'bg-blue-50  text-blue-600'
    }`}>
      {STATUS_LABELS[status] || status.replace(/_/g, ' ')}
    </span>
  );
}

function FilterSelect({
  label, value, onChange, children,
}: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs text-gray-500 font-medium whitespace-nowrap">{label}:</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`text-xs border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
          value ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200'
        }`}
      >
        {children}
      </select>
    </div>
  );
}

function FilterChip({
  label, active, onClick, activeClass,
}: { label: string; active: boolean; onClick: () => void; activeClass?: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
        active
          ? (activeClass || 'bg-blue-600 text-white border-blue-600')
          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
      }`}
    >
      {label}
    </button>
  );
}

function SortHeader({
  label, sortKey, current, dir, onClick,
}: { label: string; sortKey: SortKey; current: SortKey; dir: SortDir; onClick: (k: SortKey) => void }) {
  const active = current === sortKey;
  return (
    <button
      onClick={() => onClick(sortKey)}
      className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wide ${
        active ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
      }`}
    >
      {label}
      {active && <span className="text-[10px]">{dir === 'desc' ? '↓' : '↑'}</span>}
    </button>
  );
}

function MobileLeadCard({ lead, spread: s }: { lead: any; spread: number | null }) {
  const tier = lead._tier as 1 | 2 | 3;
  const hoursAgo = lead.lastTouchedAt
    ? Math.round((Date.now() - new Date(lead.lastTouchedAt).getTime()) / 3600000)
    : null;
  const stale = hoursAgo !== null && hoursAgo > 72 && !INACTIVE_STATUSES.includes(lead.status);

  return (
    <Link
      href={`/leads/${lead.id}`}
      className={`bg-white rounded-xl border border-gray-200 p-3 flex flex-col gap-2 active:bg-gray-50 ${
        lead.status === 'DEAD' ? 'opacity-60' : ''
      }`}
    >
      {/* Row 1: Photo + address */}
      <div className="flex items-start gap-3">
        <PropertyPhoto
          src={lead.primaryPhoto}
          scoreBand={lead.scoreBand}
          address={lead.propertyAddress}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm text-gray-900 truncate">{lead.propertyAddress}</div>
          <div className="text-xs text-gray-400 truncate">
            {lead.propertyCity}, {lead.propertyState} · {lead.sellerFirstName} {lead.sellerLastName}
          </div>
        </div>
      </div>
      {/* Row 2: Badges + ARV */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <TierBadge tier={tier} />
          <StatusBadge status={lead.status} />
        </div>
        {lead.arv ? (
          <span className="text-xs font-semibold text-green-600">ARV ${(lead.arv / 1000).toFixed(0)}k</span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </div>
      {/* Row 3: Score + touches */}
      <div className="flex items-center justify-between">
        <ScorePill band={lead.scoreBand} score={lead.totalScore} />
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-gray-600 bg-gray-100 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
            {lead.touchCount ?? 0}
          </span>
          {hoursAgo !== null ? (
            <span className={`text-xs ${stale ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}>
              {hoursAgo < 24 ? `${hoursAgo}h` : `${Math.round(hoursAgo / 24)}d`}
              {stale ? ' ⚠' : ''}
            </span>
          ) : (
            <span className="text-xs text-gray-300">—</span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function LeadsPageInner() {
  const searchParams = useSearchParams();

  const [allLeads,      setAllLeads]      = useState<any[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [search,        setSearch]        = useState('');
  const [bandFilter,    setBandFilter]    = useState('');
  const [statusFilter,  setStatusFilter]  = useState('');
  const [sourceFilter,  setSourceFilter]  = useState('');
  const [dateFilter,    setDateFilter]    = useState('');
  const [staleFilter,   setStaleFilter]   = useState('');
  const [arvFilter,     setArvFilter]     = useState('');
  const [dealFilter,    setDealFilter]    = useState('');
  const [stateFilter,   setStateFilter]   = useState('');
  const [assigneeFilter,setAssigneeFilter]= useState('');
  const [tierFilter,    setTierFilter]    = useState<number>(0); // 0 = all
  const [showInactive,  setShowInactive]  = useState(false);     // default: hide dead/closed
  const [teamMembers,   setTeamMembers]   = useState<any[]>([]);
  const [sortKey,       setSortKey]       = useState<SortKey>('tier');
  const [sortDir,       setSortDir]       = useState<SortDir>('asc');
  const [viewMode,      setViewMode]      = useState<ViewMode>('table');

  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [bulkStatus,    setBulkStatus]    = useState('');
  const [showFilters,   setShowFilters]   = useState(false);

  // URL param initial filters
  useEffect(() => {
    const band   = searchParams.get('band');
    const status = searchParams.get('status');
    if (band)   setBandFilter(band);
    if (status) setStatusFilter(status);
    if (band || status) setShowFilters(true);
  }, [searchParams]);

  // Load all leads once; filter/sort client-side for instant feedback
  useEffect(() => {
    leadsAPI.list({})
      .then(r => setAllLeads(r.data.leads || []))
      .catch(console.error)
      .finally(() => setLoading(false));
    authAPI.getTeam()
      .then(r => setTeamMembers(r.data || []))
      .catch(() => {});
  }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  // Attach computed tier to every lead, then filter + sort
  const filtered = useMemo(() => {
    const now = Date.now();
    const q   = search.toLowerCase();

    const leadsWithTier = allLeads.map(l => ({ ...l, _tier: computeTier(l) }));

    return leadsWithTier
      .filter(l => {
        // Default: hide DEAD / CLOSED unless user opted in or status filter shows them
        if (!showInactive && !statusFilter && tierFilter !== 3 && INACTIVE_STATUSES.includes(l.status)) return false;

        if (tierFilter   && l._tier !== tierFilter)                                       return false;
        if (bandFilter   && l.scoreBand !== bandFilter)                                   return false;
        if (statusFilter && l.status !== statusFilter)                                    return false;
        if (sourceFilter && l.source !== sourceFilter)                                    return false;
        if (stateFilter  && (l.propertyState || '').toUpperCase() !== stateFilter.toUpperCase()) return false;
        if (assigneeFilter === 'unassigned' && l.assignedToUserId)                        return false;
        if (assigneeFilter && assigneeFilter !== 'unassigned' && l.assignedToUserId !== assigneeFilter) return false;

        if (q && ![l.propertyAddress, l.propertyCity, l.propertyState, l.sellerFirstName, l.sellerLastName, l.sellerPhone]
          .filter(Boolean).join(' ').toLowerCase().includes(q)) return false;

        if (dateFilter) {
          const age = (now - new Date(l.createdAt).getTime()) / 86400000;
          if (dateFilter === 'today'  && age > 1)   return false;
          if (dateFilter === 'week'   && age > 7)   return false;
          if (dateFilter === 'month'  && age > 30)  return false;
          if (dateFilter === 'older'  && age <= 30) return false;
        }
        if (staleFilter) {
          const days       = parseInt(staleFilter);
          const hoursStale = l.lastTouchedAt
            ? (now - new Date(l.lastTouchedAt).getTime()) / 3600000
            : Infinity;
          if (hoursStale < days * 24) return false;
        }
        if (arvFilter === 'has'  && !(l.arv > 0)) return false;
        if (arvFilter === 'none' && l.arv > 0)    return false;

        if (dealFilter === 'pencils') {
          const m = l.arv ? l.arv * 0.7 - 55000 : null;
          if (!m || !l.askingPrice || m < l.askingPrice) return false;
        }
        if (dealFilter === 'no') {
          const m = l.arv ? l.arv * 0.7 - 55000 : null;
          if (m && l.askingPrice && m >= l.askingPrice) return false;
        }

        return true;
      })
      .sort((a, b) => {
        let av: any, bv: any;
        if (sortKey === 'tier')    { av = a._tier;                                    bv = b._tier; }
        if (sortKey === 'score')   { av = a.totalScore;                               bv = b.totalScore; }
        if (sortKey === 'arv')     { av = a.arv || 0;                                 bv = b.arv || 0; }
        if (sortKey === 'asking')  { av = a.askingPrice || 0;                         bv = b.askingPrice || 0; }
        if (sortKey === 'created') { av = new Date(a.createdAt).getTime();            bv = new Date(b.createdAt).getTime(); }
        if (sortKey === 'touched') { av = new Date(a.lastTouchedAt || 0).getTime();   bv = new Date(b.lastTouchedAt || 0).getTime(); }
        if (sortKey === 'touches') { av = a.touchCount || 0;                         bv = b.touchCount || 0; }
        if (sortKey === 'address') { av = a.propertyAddress;                          bv = b.propertyAddress; }
        if (av < bv) return sortDir === 'desc' ? 1 : -1;
        if (av > bv) return sortDir === 'desc' ? -1 : 1;
        return 0;
      });
  }, [allLeads, search, bandFilter, statusFilter, sourceFilter, dateFilter, staleFilter,
      arvFilter, dealFilter, stateFilter, assigneeFilter, tierFilter, showInactive, sortKey, sortDir]);

  // Counts
  const tierCounts = useMemo(() => {
    const c: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    allLeads.forEach(l => {
      if (!INACTIVE_STATUSES.includes(l.status) || showInactive) {
        const t = computeTier(l);
        c[t] = (c[t] || 0) + 1;
      }
    });
    return c;
  }, [allLeads, showInactive]);

  const bandCounts = useMemo(() => {
    const c: Record<string, number> = {};
    allLeads.forEach(l => { c[l.scoreBand] = (c[l.scoreBand] || 0) + 1; });
    return c;
  }, [allLeads]);

  const hiddenInactiveCount = useMemo(
    () => showInactive || statusFilter ? 0 : allLeads.filter(l => INACTIVE_STATUSES.includes(l.status)).length,
    [allLeads, showInactive, statusFilter],
  );

  const availableStates = useMemo(() => {
    const s = new Set(allLeads.map(l => l.propertyState).filter(Boolean));
    return Array.from(s).sort();
  }, [allLeads]);

  const maoFn  = (l: any) => l.arv ? Math.round(l.arv * 0.7 - 55000) : null;
  const spread = (l: any) => { const m = maoFn(l); return m && l.askingPrice ? m - l.askingPrice : null; };

  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedIds.size} lead(s)?`)) return;
    await leadsAPI.bulkDelete(Array.from(selectedIds));
    setAllLeads(p => p.filter(l => !selectedIds.has(l.id)));
    setSelectedIds(new Set());
  };

  const handleBulkStatus = async () => {
    if (!bulkStatus) return;
    await leadsAPI.bulkUpdateStatus(Array.from(selectedIds), bulkStatus);
    setAllLeads(p => p.map(l => selectedIds.has(l.id) ? { ...l, status: bulkStatus } : l));
    setBulkStatus(''); setSelectedIds(new Set());
  };

  const handleExport = async () => {
    const res = await leadsAPI.exportCsv({});
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
    const a   = document.createElement('a');
    a.href = url;
    a.download = `leads-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setSearch(''); setBandFilter(''); setStatusFilter(''); setSourceFilter('');
    setDateFilter(''); setStaleFilter(''); setArvFilter(''); setDealFilter('');
    setStateFilter(''); setAssigneeFilter(''); setTierFilter(0); setShowInactive(false);
  };

  const hasFilters = !!(search || bandFilter || statusFilter || sourceFilter || dateFilter ||
    staleFilter || arvFilter || dealFilter || stateFilter || assigneeFilter || tierFilter || showInactive);

  // ─── Pipeline (Grid view) drag-and-drop ─────────────────────────────────────
  const onDragEnd = useCallback(async (result: DropResult) => {
    if (!result.destination) return;
    const { draggableId: leadId, source, destination } = result;
    if (source.droppableId === destination.droppableId) return;
    setAllLeads(prev => prev.map(l =>
      l.id === leadId ? { ...l, status: destination.droppableId } : l,
    ));
    try {
      await pipelineAPI.updateStage(leadId, destination.droppableId);
    } catch {
      setAllLeads(prev => prev.map(l =>
        l.id === leadId ? { ...l, status: source.droppableId } : l,
      ));
    }
  }, []);

  const pipelineByStage = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const s of PIPELINE_STAGES) map[s.id] = [];
    for (const lead of filtered) {
      if (!INACTIVE_STATUSES.includes(lead.status) && map[lead.status] !== undefined) {
        map[lead.status].push(lead);
      }
    }
    return map;
  }, [filtered]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav />
      <main className="max-w-screen-2xl mx-auto px-3 py-4 sm:px-6 sm:py-6 pb-16 md:pb-0 space-y-4">

        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Leads</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {filtered.length} active lead{filtered.length !== 1 ? 's' : ''}
              {hiddenInactiveCount > 0 && (
                <button
                  onClick={() => setShowInactive(true)}
                  className="ml-2 text-gray-400 hover:text-gray-600 underline underline-offset-2 decoration-dashed"
                >
                  +{hiddenInactiveCount} dead/closed hidden
                </button>
              )}
              {hasFilters && (
                <button onClick={clearFilters} className="ml-2 text-blue-500 hover:underline">
                  Clear filters
                </button>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleExport} className="btn btn-secondary btn-sm text-xs">Export CSV</button>
            <Link href="/leads/new" className="btn btn-primary btn-sm">+ New Lead</Link>
          </div>
        </div>

        {/* Search + Filter Bar */}
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 space-y-3">

          {/* Top row: search + view mode + filter toggle */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
              <input
                type="text"
                placeholder="Search name, address, phone..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden ml-auto">
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'table' ? 'bg-gray-100 text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
              >
                ☰ List
              </button>
              <button
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'cards' ? 'bg-gray-100 text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
              >
                ⊞ Grid
              </button>
            </div>

            <button
              onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                showFilters || hasFilters
                  ? 'border-blue-400 text-blue-600 bg-blue-50'
                  : 'border-gray-200 text-gray-500 hover:border-gray-400'
              }`}
            >
              ⚙ Filters {hasFilters ? '•' : ''}
            </button>
          </div>

          {/* Tier quick filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400 font-medium">Tier:</span>
              <FilterChip
                label="All active"
                active={tierFilter === 0}
                onClick={() => { setTierFilter(0); setShowInactive(false); }}
              />
              {([1, 2, 3] as const).map(t => {
                const cfg = TIER_CONFIG[t];
                return (
                  <FilterChip
                    key={t}
                    label={`${cfg.emoji} ${cfg.label}${tierCounts[t] ? ` (${tierCounts[t]})` : ''}`}
                    active={tierFilter === t}
                    activeClass={cfg.chipActive}
                    onClick={() => {
                      setTierFilter(tierFilter === t ? 0 : t);
                      if (t === 3) setShowInactive(true); // Tier 3 = show dead
                    }}
                  />
                );
              })}
            </div>

            <span className="text-gray-200 select-none hidden sm:inline">|</span>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400 font-medium">Score:</span>
              <FilterChip label="All" active={!bandFilter} onClick={() => setBandFilter('')} />
              {['STRIKE_ZONE', 'HOT', 'WORKABLE', 'DEAD_COLD'].map(band => (
                <FilterChip
                  key={band}
                  label={`${BAND_LABELS[band]}${bandCounts[band] ? ` (${bandCounts[band]})` : ''}`}
                  active={bandFilter === band}
                  onClick={() => setBandFilter(bandFilter === band ? '' : band)}
                />
              ))}
            </div>

            <span className="text-gray-200 select-none hidden sm:inline">|</span>
            <button
              onClick={() => setShowInactive(v => !v)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                showInactive
                  ? 'bg-gray-600 text-white border-gray-600'
                  : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'
              }`}
            >
              {showInactive ? '👁 Showing dead/closed' : 'Show dead/closed'}
            </button>
          </div>

          {/* Advanced Filters (collapsed by default) */}
          {showFilters && (
            <div className="pt-3 border-t border-gray-100">
              <div className="flex items-center gap-3 flex-wrap">
                <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter}>
                  <option value="">All statuses</option>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </FilterSelect>

                <FilterSelect label="Source" value={sourceFilter} onChange={setSourceFilter}>
                  <option value="">All sources</option>
                  {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </FilterSelect>

                <FilterSelect label="Date added" value={dateFilter} onChange={setDateFilter}>
                  <option value="">Any time</option>
                  <option value="today">Today</option>
                  <option value="week">Last 7 days</option>
                  <option value="month">Last 30 days</option>
                  <option value="older">Older than 30 days</option>
                </FilterSelect>

                <FilterSelect label="No contact" value={staleFilter} onChange={setStaleFilter}>
                  <option value="">Any</option>
                  <option value="1">1+ day</option>
                  <option value="3">3+ days</option>
                  <option value="7">7+ days</option>
                  <option value="14">14+ days</option>
                </FilterSelect>

                <FilterSelect label="ARV" value={arvFilter} onChange={setArvFilter}>
                  <option value="">Any</option>
                  <option value="has">Has ARV</option>
                  <option value="none">No ARV</option>
                </FilterSelect>

                <FilterSelect label="Deal math" value={dealFilter} onChange={setDealFilter}>
                  <option value="">Any</option>
                  <option value="pencils">Pencils ✓</option>
                  <option value="no">Doesn't pencil</option>
                </FilterSelect>

                <FilterSelect label="Assigned" value={assigneeFilter} onChange={setAssigneeFilter}>
                  <option value="">All leads</option>
                  <option value="unassigned">Unassigned</option>
                  {teamMembers.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                  ))}
                </FilterSelect>

                {availableStates.length > 1 && (
                  <FilterSelect label="State" value={stateFilter} onChange={setStateFilter}>
                    <option value="">All states</option>
                    {availableStates.map(s => <option key={s} value={s}>{s}</option>)}
                  </FilterSelect>
                )}

                {hasFilters && (
                  <button onClick={clearFilters} className="text-xs text-red-500 hover:underline ml-auto">
                    Clear all
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Tier legend */}
        <div className="flex items-center gap-4 px-1">
          {([1, 2, 3] as const).map(t => (
            <div key={t} className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className={`w-2 h-2 rounded-full ${TIER_CONFIG[t].dot}`} />
              <strong>{TIER_CONFIG[t].emoji} {TIER_CONFIG[t].label}:</strong> {TIER_CONFIG[t].desc}
            </div>
          ))}
        </div>

        {/* Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 flex items-center gap-4 flex-wrap">
            <span className="text-sm font-semibold text-blue-800">{selectedIds.size} selected</span>
            <button onClick={handleBulkDelete} className="text-xs px-3 py-1 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600">
              Delete
            </button>
            <div className="flex items-center gap-2">
              <select
                value={bulkStatus}
                onChange={e => setBulkStatus(e.target.value)}
                className="text-xs border border-gray-200 rounded-md px-2 py-1"
              >
                <option value="">Move to stage...</option>
                {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {bulkStatus && (
                <button onClick={handleBulkStatus} className="text-xs px-3 py-1 bg-blue-600 text-white rounded-lg font-medium">
                  Apply
                </button>
              )}
            </div>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-blue-500 hover:underline ml-auto">
              Deselect
            </button>
          </div>
        )}

        {/* Main Content */}
        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm animate-pulse">Loading leads...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">🔍</div>
            <div className="text-sm">No leads match your filters.</div>
            {hasFilters && (
              <button onClick={clearFilters} className="text-blue-500 hover:underline text-sm mt-2">
                Clear filters
              </button>
            )}
          </div>
        ) : viewMode === 'table' ? (

          /* ─── TABLE VIEW ─── */
          <>
          {/* Mobile card list */}
          <div className="block md:hidden space-y-2">
            {filtered.map(lead => (
              <MobileLeadCard key={lead.id} lead={lead} spread={spread(lead)} />
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden min-w-[900px]">
            <div className="grid grid-cols-[auto_44px_2fr_110px_68px_72px_72px_72px_80px_60px_72px] gap-3 px-4 py-2.5 border-b border-gray-100 bg-gray-50/80">
              <input
                type="checkbox"
                checked={selectedIds.size === filtered.length && filtered.length > 0}
                onChange={() =>
                  selectedIds.size === filtered.length
                    ? setSelectedIds(new Set())
                    : setSelectedIds(new Set(filtered.map(l => l.id)))
                }
                className="h-3.5 w-3.5 rounded border-gray-300"
              />
              <div />
              <SortHeader label="Property / Seller" sortKey="address" current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Stage"             sortKey="score"   current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Tier"              sortKey="tier"    current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Score"             sortKey="score"   current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="ARV"               sortKey="arv"     current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Asking"            sortKey="asking"  current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Spread"            sortKey="arv"     current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Touches"           sortKey="touches" current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Last Touch"        sortKey="touched" current={sortKey} dir={sortDir} onClick={handleSort} />
            </div>

            <div className="divide-y divide-gray-50">
              {filtered.map(lead => {
                const s       = spread(lead);
                const hoursAgo = lead.lastTouchedAt
                  ? Math.round((Date.now() - new Date(lead.lastTouchedAt).getTime()) / 3600000)
                  : null;
                const stale = hoursAgo !== null && hoursAgo > 72 && !INACTIVE_STATUSES.includes(lead.status);
                const tier  = lead._tier as 1 | 2 | 3;

                return (
                  <div
                    key={lead.id}
                    className={`grid grid-cols-[auto_44px_2fr_110px_68px_72px_72px_72px_80px_60px_72px] gap-3 items-center px-4 py-2.5 hover:bg-gray-50 transition-colors group ${
                      selectedIds.has(lead.id) ? 'bg-blue-50/40' : ''
                    } ${lead.status === 'DEAD' ? 'opacity-60' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(lead.id)}
                      onChange={() => toggleSelect(lead.id)}
                      onClick={e => e.stopPropagation()}
                      className="h-3.5 w-3.5 rounded border-gray-300"
                    />
                    <PropertyPhoto
                      src={lead.primaryPhoto}
                      scoreBand={lead.scoreBand}
                      address={lead.propertyAddress}
                      size="sm"
                    />
                    <Link href={`/leads/${lead.id}`} className="min-w-0">
                      <div className="font-semibold text-sm text-gray-900 truncate group-hover:text-blue-700">
                        {lead.propertyAddress}
                      </div>
                      <div className="text-xs text-gray-400 truncate">
                        {lead.propertyCity}, {lead.propertyState} · {lead.sellerFirstName} {lead.sellerLastName}
                        {lead.source && (
                          <span className="ml-1 text-gray-300">· {SOURCE_LABELS[lead.source] || lead.source}</span>
                        )}
                      </div>
                    </Link>
                    <Link href={`/leads/${lead.id}`} className="flex items-center gap-1">
                      <StatusBadge status={lead.status} />
                      {lead.assignedTo && (
                        <Avatar
                          name={`${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`}
                          avatarUrl={lead.assignedTo.avatarUrl}
                          size="sm"
                        />
                      )}
                    </Link>
                    <Link href={`/leads/${lead.id}`}>
                      <TierBadge tier={tier} />
                    </Link>
                    <Link href={`/leads/${lead.id}`}>
                      <ScorePill band={lead.scoreBand} score={lead.totalScore} />
                    </Link>
                    <Link href={`/leads/${lead.id}`}>
                      {lead.arv
                        ? <span className="text-xs font-semibold text-gray-700">${(lead.arv / 1000).toFixed(0)}k</span>
                        : <span className="text-xs text-gray-300">—</span>}
                    </Link>
                    <Link href={`/leads/${lead.id}`}>
                      {lead.askingPrice
                        ? <span className="text-xs text-gray-600">${(lead.askingPrice / 1000).toFixed(0)}k</span>
                        : <span className="text-xs text-gray-300">—</span>}
                    </Link>
                    <Link href={`/leads/${lead.id}`}>
                      {s !== null
                        ? <span className={`text-xs font-bold ${s >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {s >= 0 ? '+' : ''}${(s / 1000).toFixed(0)}k
                          </span>
                        : <span className="text-xs text-gray-300">—</span>}
                    </Link>
                    <Link href={`/leads/${lead.id}`}>
                      <span className="text-xs font-semibold text-gray-600 bg-gray-100 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                        {lead.touchCount ?? 0}
                      </span>
                    </Link>
                    <Link href={`/leads/${lead.id}`}>
                      {hoursAgo !== null
                        ? <span className={`text-[11px] ${stale ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}>
                            {hoursAgo < 24 ? `${hoursAgo}h` : `${Math.round(hoursAgo / 24)}d`}
                            {stale ? ' ⚠' : ''}
                          </span>
                        : <span className="text-[11px] text-gray-300">—</span>}
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
          </div>
          </>

        ) : (

          /* ─── GRID / PIPELINE VIEW ─── */
          <div className="overflow-x-auto pb-2">
            <DragDropContext onDragEnd={onDragEnd}>
              <div className="flex gap-3 pb-4" style={{ minHeight: 520, minWidth: 'max-content' }}>
                {PIPELINE_STAGES.map(stage => {
                  const stageLeads = pipelineByStage[stage.id] || [];
                  return (
                    <div key={stage.id} className="flex-shrink-0 flex flex-col" style={{ width: 260 }}>

                      {/* Column header */}
                      <div className={`${stage.color} border rounded-lg px-3 py-2 mb-2 flex items-center justify-between flex-shrink-0`}>
                        <span className="font-bold text-xs uppercase tracking-wide">{stage.name}</span>
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-white/60">
                          {stageLeads.length}
                        </span>
                      </div>

                      {/* Droppable column */}
                      <Droppable droppableId={stage.id}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`flex-1 space-y-2 p-1 rounded-lg min-h-[100px] transition-colors ${
                              snapshot.isDraggingOver
                                ? 'bg-blue-50 border-2 border-blue-300 border-dashed'
                                : 'border-2 border-transparent'
                            }`}
                          >
                            {stageLeads.map((lead, index) => {
                              const tier = lead._tier as 1 | 2 | 3;
                              const hoursAgo = lead.lastTouchedAt
                                ? Math.round((Date.now() - new Date(lead.lastTouchedAt).getTime()) / 3_600_000)
                                : null;
                              const stale = hoursAgo !== null && hoursAgo > 72;
                              const s = spread(lead);
                              return (
                                <Draggable key={lead.id} draggableId={lead.id} index={index}>
                                  {(provided, snapshot) => (
                                    <div
                                      ref={provided.innerRef}
                                      {...provided.draggableProps}
                                      {...provided.dragHandleProps}
                                    >
                                      <Link
                                        href={`/leads/${lead.id}`}
                                        className={`block bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md hover:border-blue-200 transition-all ${
                                          snapshot.isDragging ? 'shadow-xl ring-2 ring-blue-400 rotate-1' : ''
                                        }`}
                                        onClick={e => { if (snapshot.isDragging) e.preventDefault(); }}
                                      >
                                        {/* Tier stripe */}
                                        <div className={`h-1 w-full ${TIER_CONFIG[tier].dot}`} />

                                        <div className="p-2.5 space-y-2">
                                          {/* Address + photo */}
                                          <div className="flex items-start gap-2">
                                            <PropertyPhoto
                                              src={lead.primaryPhoto}
                                              scoreBand={lead.scoreBand}
                                              address={lead.propertyAddress}
                                              size="sm"
                                            />
                                            <div className="flex-1 min-w-0">
                                              <p className="font-semibold text-xs text-gray-900 truncate leading-snug">
                                                {lead.propertyAddress}
                                              </p>
                                              <p className="text-[11px] text-gray-400 truncate">
                                                {lead.propertyCity}, {lead.propertyState}
                                              </p>
                                            </div>
                                            <ScorePill band={lead.scoreBand} score={lead.totalScore} />
                                          </div>

                                          {/* Seller + assignee */}
                                          <div className="flex items-center justify-between">
                                            <span className="text-[11px] text-gray-500 truncate">
                                              {lead.sellerFirstName} {lead.sellerLastName}
                                            </span>
                                            {lead.assignedTo && (
                                              <Avatar
                                                name={`${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`}
                                                avatarUrl={lead.assignedTo.avatarUrl}
                                                size="sm"
                                              />
                                            )}
                                          </div>

                                          {/* Stats */}
                                          <div className="flex items-center justify-between text-[11px] border-t border-gray-100 pt-1.5">
                                            <div className="flex items-center gap-1.5 text-gray-400">
                                              {lead.arv && (
                                                <span className="text-green-600 font-semibold">${(lead.arv / 1000).toFixed(0)}k</span>
                                              )}
                                              {s !== null && (
                                                <span className={`font-bold ${s >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                                  {s >= 0 ? '+' : ''}${(s / 1000).toFixed(0)}k
                                                </span>
                                              )}
                                            </div>
                                            <div className="flex items-center gap-1">
                                              <span className="font-semibold text-gray-500 bg-gray-100 rounded-full px-1 min-w-[16px] text-center text-[10px]">
                                                {lead.touchCount ?? 0}
                                              </span>
                                              <span className={`${stale ? 'text-amber-500 font-semibold' : 'text-gray-300'}`}>
                                                {hoursAgo !== null ? pipelineTimeAgo(lead.lastTouchedAt) : '—'}
                                                {stale ? ' ⚠' : ''}
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                      </Link>
                                    </div>
                                  )}
                                </Draggable>
                              );
                            })}
                            {provided.placeholder}
                            {stageLeads.length === 0 && !snapshot.isDraggingOver && (
                              <p className="text-[11px] text-gray-300 text-center pt-6 select-none">Empty</p>
                            )}
                          </div>
                        )}
                      </Droppable>
                    </div>
                  );
                })}
              </div>
            </DragDropContext>
          </div>

        )}

      </main>
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">Loading...</div>}>
      <LeadsPageInner />
    </Suspense>
  );
}
