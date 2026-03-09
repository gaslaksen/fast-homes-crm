'use client';

import { useEffect, useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { leadsAPI, authAPI } from '@/lib/api';
import PropertyPhoto from '@/components/PropertyPhoto';
import AppNav from '@/components/AppNav';
import { formatDistanceToNow } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

type SortKey = 'score' | 'arv' | 'asking' | 'created' | 'touched' | 'address';
type SortDir = 'asc' | 'desc';
type ViewMode = 'table' | 'cards';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INACTIVE_STATUSES = ['DEAD', 'CLOSED_WON', 'CLOSED_LOST'];

const TIER_CONFIG: Record<number, { label: string; short: string; pill: string; dot: string }> = {
  1: { label: 'Tier 1 · Contract Now', short: 'T1', pill: 'bg-green-100 text-green-800 border-green-300',   dot: 'bg-green-500' },
  2: { label: 'Tier 2 · Opportunity',  short: 'T2', pill: 'bg-yellow-100 text-yellow-800 border-yellow-300', dot: 'bg-yellow-400' },
  3: { label: 'Tier 3 · Dead',         short: 'T3', pill: 'bg-gray-100 text-gray-500 border-gray-300',       dot: 'bg-gray-400' },
};

function TierBadge({ tier }: { tier?: number | null }) {
  if (!tier) return null;
  const cfg = TIER_CONFIG[tier];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${cfg.pill}`}>
      {cfg.short}
    </span>
  );
}

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
  WARM: 'Warm', COOL: 'Cool', COLD: 'Cold', // legacy
};
const STATUS_LABELS: Record<string, string> = {
  NEW: 'New',
  ATTEMPTING_CONTACT: 'Contacting',
  IN_QUALIFICATION: 'Qualifying',
  QUALIFIED: 'Qualified',
  IN_NEGOTIATION: 'Negotiating',
  OFFER_SENT: 'Offer Sent',
  UNDER_CONTRACT: 'Under Contract',
  CLOSING: 'Closing',
  CLOSED_WON: 'Closed ✓',
  CLOSED_LOST: 'Lost',
  DEAD: 'Dead',
};
const SOURCE_LABELS: Record<string, string> = {
  PROPERTY_LEADS: 'PPL',
  GOOGLE_ADS: 'PPC',
  MANUAL: 'Manual',
  OTHER: 'Other',
};

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
  const lost = status === 'CLOSED_LOST' || status === 'DEAD';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
      closed ? 'bg-green-100 text-green-700' :
      lost   ? 'bg-gray-100 text-gray-400' :
               'bg-blue-50 text-blue-600'
    }`}>
      {STATUS_LABELS[status] || status.replace(/_/g, ' ')}
    </span>
  );
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs text-gray-500 font-medium whitespace-nowrap">{label}:</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`text-xs border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 ${value ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200'}`}
      >
        {children}
      </select>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
        active
          ? 'bg-blue-600 text-white border-blue-600'
          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
      }`}
    >
      {label}
    </button>
  );
}

function SortHeader({ label, sortKey, current, dir, onClick }: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir; onClick: (k: SortKey) => void;
}) {
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

// ─── Main Component ───────────────────────────────────────────────────────────

function LeadsPageInner() {
  const searchParams = useSearchParams();
  const [allLeads, setAllLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [bandFilter, setBandFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');       // 'today' | 'week' | 'month' | 'older'
  const [staleFilter, setStaleFilter] = useState('');     // '1' | '3' | '7' | '14'
  const [arvFilter, setArvFilter] = useState('');         // 'has' | 'none'
  const [dealFilter, setDealFilter] = useState('');       // 'pencils' | 'no'
  const [stateFilter, setStateFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');       // '1' | '2' | '3'
  const [showInactive, setShowInactive] = useState(false);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Apply URL query params as initial filters
  useEffect(() => {
    const band = searchParams.get('band');
    const status = searchParams.get('status');
    if (band) setBandFilter(band);
    if (status) setStatusFilter(status);
    if (band || status) setShowFilters(true);
  }, [searchParams]);

  // Load all leads once; filter/sort client-side for instant feedback
  useEffect(() => {
    leadsAPI.list({}).then(r => {
      setAllLeads(r.data.leads || []);
    }).catch(console.error).finally(() => setLoading(false));
    authAPI.getTeam().then(r => setTeamMembers(r.data || [])).catch(() => {});
  }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const filtered = useMemo(() => {
    const now = Date.now();
    const q = search.toLowerCase();
    return allLeads.filter(l => {
      // Default: hide dead/closed unless a specific status is chosen or showInactive is on
      if (!showInactive && !statusFilter && INACTIVE_STATUSES.includes(l.status)) return false;
      if (bandFilter && l.scoreBand !== bandFilter) return false;
      if (statusFilter && l.status !== statusFilter) return false;
      if (sourceFilter && l.source !== sourceFilter) return false;
      if (stateFilter && (l.propertyState || '').toUpperCase() !== stateFilter.toUpperCase()) return false;
      if (assigneeFilter === 'unassigned' && l.assignedToUserId) return false;
      if (assigneeFilter && assigneeFilter !== 'unassigned' && l.assignedToUserId !== assigneeFilter) return false;
      if (tierFilter && String(l.tier) !== tierFilter) return false;
      if (q && ![l.propertyAddress, l.propertyCity, l.propertyState, l.sellerFirstName, l.sellerLastName, l.sellerPhone]
        .filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
      // Date added filter
      if (dateFilter) {
        const age = (now - new Date(l.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (dateFilter === 'today'  && age > 1)   return false;
        if (dateFilter === 'week'   && age > 7)   return false;
        if (dateFilter === 'month'  && age > 30)  return false;
        if (dateFilter === 'older'  && age <= 30) return false;
      }
      // Stale filter (no contact in N days)
      if (staleFilter) {
        const days = parseInt(staleFilter);
        const hoursStale = l.lastTouchedAt
          ? (now - new Date(l.lastTouchedAt).getTime()) / (1000 * 60 * 60)
          : Infinity;
        if (hoursStale < days * 24) return false;
      }
      // ARV filter
      if (arvFilter === 'has'  && !(l.arv > 0)) return false;
      if (arvFilter === 'none' && l.arv > 0)    return false;
      // Deal pencils filter (ARV * 0.7 - 40k - 15k > askingPrice)
      if (dealFilter === 'pencils') {
        const mao = l.arv ? l.arv * 0.7 - 40000 - 15000 : null;
        if (!mao || !l.askingPrice || mao < l.askingPrice) return false;
      }
      if (dealFilter === 'no') {
        const mao = l.arv ? l.arv * 0.7 - 40000 - 15000 : null;
        if (mao && l.askingPrice && mao >= l.askingPrice) return false;
      }
      return true;
    }).sort((a, b) => {
      let av: any, bv: any;
      if (sortKey === 'score')   { av = a.totalScore; bv = b.totalScore; }
      if (sortKey === 'arv')     { av = a.arv || 0; bv = b.arv || 0; }
      if (sortKey === 'asking')  { av = a.askingPrice || 0; bv = b.askingPrice || 0; }
      if (sortKey === 'created') { av = new Date(a.createdAt).getTime(); bv = new Date(b.createdAt).getTime(); }
      if (sortKey === 'touched') { av = new Date(a.lastTouchedAt || 0).getTime(); bv = new Date(b.lastTouchedAt || 0).getTime(); }
      if (sortKey === 'address') { av = a.propertyAddress; bv = b.propertyAddress; }
      if (av < bv) return sortDir === 'desc' ? 1 : -1;
      if (av > bv) return sortDir === 'desc' ? -1 : 1;
      return 0;
    });
  }, [allLeads, search, bandFilter, statusFilter, sourceFilter, dateFilter, staleFilter, arvFilter, dealFilter, stateFilter, assigneeFilter, tierFilter, showInactive, sortKey, sortDir]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

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
    const a = document.createElement('a'); a.href = url;
    a.download = `leads-${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setSearch(''); setBandFilter(''); setStatusFilter(''); setSourceFilter('');
    setDateFilter(''); setStaleFilter(''); setArvFilter(''); setDealFilter(''); setStateFilter('');
    setAssigneeFilter(''); setTierFilter(''); setShowInactive(false);
  };
  const hasFilters = !!(search || bandFilter || statusFilter || sourceFilter || dateFilter || staleFilter || arvFilter || dealFilter || stateFilter || assigneeFilter || tierFilter || showInactive);

  // Count of hidden inactive leads
  const hiddenInactiveCount = useMemo(() => {
    if (showInactive || statusFilter) return 0;
    return allLeads.filter(l => INACTIVE_STATUSES.includes(l.status)).length;
  }, [allLeads, showInactive, statusFilter]);

  // Unique states from loaded leads
  const availableStates = useMemo(() => {
    const s = new Set(allLeads.map(l => l.propertyState).filter(Boolean));
    return Array.from(s).sort();
  }, [allLeads]);

  const mao = (lead: any) => lead.arv ? Math.round(lead.arv * 0.7 - 40000 - 15000) : null;
  const spread = (lead: any) => {
    const m = mao(lead);
    return m && lead.askingPrice ? m - lead.askingPrice : null;
  };

  // Band counts for pills
  const bandCounts = useMemo(() => {
    const c: Record<string, number> = {};
    allLeads.forEach(l => { c[l.scoreBand] = (c[l.scoreBand] || 0) + 1; });
    return c;
  }, [allLeads]);

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav />
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-4">

        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Leads</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {filtered.length} active leads
              {hiddenInactiveCount > 0 && (
                <button onClick={() => setShowInactive(true)} className="ml-2 text-gray-400 hover:text-gray-600 underline underline-offset-2 decoration-dashed">
                  +{hiddenInactiveCount} dead/closed hidden
                </button>
              )}
              {hasFilters && <button onClick={clearFilters} className="ml-2 text-blue-500 hover:underline">Clear filters</button>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleExport} className="btn btn-secondary btn-sm text-xs">Export CSV</button>
            <Link href="/leads/new" className="btn btn-primary btn-sm">+ New Lead</Link>
          </div>
        </div>

        {/* Search + Filter Bar */}
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 space-y-3">
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
              <input
                type="text"
                placeholder="Search name, address, phone..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* View toggle */}
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden ml-auto">
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'table' ? 'bg-gray-100 text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
              >
                ☰ Table
              </button>
              <button
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'cards' ? 'bg-gray-100 text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
              >
                ⊞ Cards
              </button>
            </div>

            <button
              onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${showFilters || hasFilters ? 'border-blue-400 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}
            >
              ⚙ Filters {hasFilters ? '•' : ''}
            </button>
          </div>

          {/* Score Band + Tier Quick Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 font-medium">Score:</span>
            <FilterChip label="All" active={!bandFilter} onClick={() => setBandFilter('')} />
            {['STRIKE_ZONE', 'HOT', 'WORKABLE', 'DEAD_COLD'].map(band => (
              <FilterChip
                key={band}
                label={`${BAND_LABELS[band]} ${bandCounts[band] ? `(${bandCounts[band]})` : ''}`}
                active={bandFilter === band}
                onClick={() => setBandFilter(bandFilter === band ? '' : band)}
              />
            ))}
            <span className="text-gray-200">|</span>
            <span className="text-xs text-gray-400 font-medium">Tier:</span>
            {[1, 2, 3].map(t => (
              <FilterChip
                key={t}
                label={TIER_CONFIG[t].label}
                active={tierFilter === String(t)}
                onClick={() => setTierFilter(tierFilter === String(t) ? '' : String(t))}
              />
            ))}
            <span className="text-gray-200">|</span>
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

          {/* Advanced Filters */}
          {showFilters && (
            <div className="pt-3 border-t border-gray-100 space-y-2">
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
                <FilterSelect label="Assigned to" value={assigneeFilter} onChange={setAssigneeFilter}>
                  <option value="">All leads</option>
                  <option value="unassigned">Unassigned</option>
                  {teamMembers.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                  ))}
                </FilterSelect>
                <FilterSelect label="Tier" value={tierFilter} onChange={setTierFilter}>
                  <option value="">All tiers</option>
                  <option value="1">Tier 1 · Contract Now</option>
                  <option value="2">Tier 2 · Opportunity</option>
                  <option value="3">Tier 3 · Dead</option>
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

        {/* Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 flex items-center gap-4 flex-wrap">
            <span className="text-sm font-semibold text-blue-800">{selectedIds.size} selected</span>
            <button onClick={handleBulkDelete} className="text-xs px-3 py-1 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600">Delete</button>
            <div className="flex items-center gap-2">
              <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
                className="text-xs border border-gray-200 rounded-md px-2 py-1">
                <option value="">Move to stage...</option>
                {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {bulkStatus && <button onClick={handleBulkStatus} className="text-xs px-3 py-1 bg-blue-600 text-white rounded-lg font-medium">Apply</button>}
            </div>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-blue-500 hover:underline ml-auto">Deselect</button>
          </div>
        )}

        {/* Main Content */}
        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm animate-pulse">Loading leads...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">🔍</div>
            <div className="text-sm">No leads match your filters.</div>
            {hasFilters && <button onClick={clearFilters} className="text-blue-500 hover:underline text-sm mt-2">Clear filters</button>}
          </div>
        ) : viewMode === 'table' ? (

          /* ─── TABLE VIEW ─── */
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-[auto_48px_2fr_1fr_56px_80px_80px_80px_72px_80px] gap-3 px-4 py-2.5 border-b border-gray-100 bg-gray-50/80">
              <input
                type="checkbox"
                checked={selectedIds.size === filtered.length && filtered.length > 0}
                onChange={() => selectedIds.size === filtered.length ? setSelectedIds(new Set()) : setSelectedIds(new Set(filtered.map(l => l.id)))}
                className="h-3.5 w-3.5 rounded border-gray-300"
              />
              <div />
              <SortHeader label="Property / Seller" sortKey="address" current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Stage" sortKey="score" current={sortKey} dir={sortDir} onClick={handleSort} />
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Tier</div>
              <SortHeader label="Score" sortKey="score" current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="ARV" sortKey="arv" current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Asking" sortKey="asking" current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Spread" sortKey="arv" current={sortKey} dir={sortDir} onClick={handleSort} />
              <SortHeader label="Last Touch" sortKey="touched" current={sortKey} dir={sortDir} onClick={handleSort} />
            </div>

            {/* Rows */}
            <div className="divide-y divide-gray-50">
              {filtered.map(lead => {
                const s = spread(lead);
                const hoursAgo = lead.lastTouchedAt
                  ? Math.round((Date.now() - new Date(lead.lastTouchedAt).getTime()) / (1000 * 60 * 60))
                  : null;
                const stale = hoursAgo !== null && hoursAgo > 72 && !['CLOSED_WON','CLOSED_LOST','DEAD'].includes(lead.status);

                return (
                  <div key={lead.id} className={`grid grid-cols-[auto_48px_2fr_1fr_56px_80px_80px_80px_72px_80px] gap-3 items-center px-4 py-2.5 hover:bg-gray-50 transition-colors group ${selectedIds.has(lead.id) ? 'bg-blue-50/40' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(lead.id)}
                      onChange={() => toggleSelect(lead.id)}
                      onClick={e => e.stopPropagation()}
                      className="h-3.5 w-3.5 rounded border-gray-300"
                    />
                    <PropertyPhoto src={lead.primaryPhoto} scoreBand={lead.scoreBand} address={lead.propertyAddress} size="sm" />
                    <Link href={`/leads/${lead.id}`} className="min-w-0">
                      <div className="font-semibold text-sm text-gray-900 truncate group-hover:text-blue-700">{lead.propertyAddress}</div>
                      <div className="text-xs text-gray-400 truncate">
                        {lead.propertyCity}, {lead.propertyState} · {lead.sellerFirstName} {lead.sellerLastName}
                        {lead.source && <span className="ml-1 text-gray-300">· {SOURCE_LABELS[lead.source] || lead.source}</span>}
                      </div>
                    </Link>
                    <Link href={`/leads/${lead.id}`} className="flex items-center gap-1.5">
                      <StatusBadge status={lead.status} />
                      {lead.assignedTo && (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-[10px] font-bold flex-shrink-0" title={`${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`}>
                          {lead.assignedTo.firstName?.[0]}{lead.assignedTo.lastName?.[0]}
                        </span>
                      )}
                    </Link>
                    <Link href={`/leads/${lead.id}`} className="flex justify-start">
                      <TierBadge tier={lead.tier} />
                    </Link>
                    <Link href={`/leads/${lead.id}`} className="flex justify-center">
                      <ScorePill band={lead.scoreBand} score={lead.totalScore} />
                    </Link>
                    <Link href={`/leads/${lead.id}`} className="text-right">
                      {lead.arv ? <span className="text-xs font-semibold text-gray-700">${(lead.arv/1000).toFixed(0)}k</span> : <span className="text-xs text-gray-300">—</span>}
                    </Link>
                    <Link href={`/leads/${lead.id}`} className="text-right">
                      {lead.askingPrice ? <span className="text-xs text-gray-600">${(lead.askingPrice/1000).toFixed(0)}k</span> : <span className="text-xs text-gray-300">—</span>}
                    </Link>
                    <Link href={`/leads/${lead.id}`} className="text-right">
                      {s !== null ? (
                        <span className={`text-xs font-bold ${s >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {s >= 0 ? '+' : ''}${(s/1000).toFixed(0)}k
                        </span>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </Link>
                    <Link href={`/leads/${lead.id}`} className="text-right">
                      {hoursAgo !== null ? (
                        <span className={`text-xs ${stale ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}>
                          {hoursAgo < 24 ? `${hoursAgo}h` : `${Math.round(hoursAgo/24)}d`}
                          {stale ? ' ⚠' : ''}
                        </span>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>

        ) : (

          /* ─── CARDS VIEW ─── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(lead => {
              const s = spread(lead);
              const hoursAgo = lead.lastTouchedAt
                ? Math.round((Date.now() - new Date(lead.lastTouchedAt).getTime()) / (1000 * 60 * 60))
                : null;
              const stale = hoursAgo !== null && hoursAgo > 72 && !['CLOSED_WON','CLOSED_LOST','DEAD'].includes(lead.status);
              const bs = BAND_STYLES[lead.scoreBand] || BAND_STYLES.COLD;

              return (
                <Link key={lead.id} href={`/leads/${lead.id}`}
                  className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md hover:border-blue-200 transition-all group"
                >
                  {/* Card top bar */}
                  <div className={`h-1 w-full ${bs.dot}`} />
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <PropertyPhoto src={lead.primaryPhoto} scoreBand={lead.scoreBand} address={lead.propertyAddress} size="sm" />
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-gray-900 truncate group-hover:text-blue-700">{lead.propertyAddress}</div>
                          <div className="text-xs text-gray-400 truncate">{lead.propertyCity}, {lead.propertyState}</div>
                        </div>
                      </div>
                      <ScorePill band={lead.scoreBand} score={lead.totalScore} />
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500 flex items-center gap-1.5">
                        {lead.sellerFirstName} {lead.sellerLastName}
                        {lead.assignedTo && (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary-100 text-primary-700 text-[9px] font-bold" title={`Assigned: ${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`}>
                            {lead.assignedTo.firstName?.[0]}{lead.assignedTo.lastName?.[0]}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <TierBadge tier={lead.tier} />
                        <StatusBadge status={lead.status} />
                      </div>
                    </div>

                    {(lead.arv || lead.askingPrice) && (
                      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                        <div className="text-xs text-gray-500">
                          {lead.arv && <span>ARV <strong className="text-gray-700">${(lead.arv/1000).toFixed(0)}k</strong></span>}
                          {lead.askingPrice && <span className="ml-2">Ask <strong className="text-gray-700">${(lead.askingPrice/1000).toFixed(0)}k</strong></span>}
                        </div>
                        {s !== null && (
                          <span className={`text-xs font-bold ${s >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {s >= 0 ? '+' : ''}${(s/1000).toFixed(0)}k
                          </span>
                        )}
                      </div>
                    )}

                    {stale && (
                      <div className="text-xs text-amber-600 font-medium">
                        ⚠ No contact {Math.round(hoursAgo! / 24)}d
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
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
