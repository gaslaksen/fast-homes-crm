'use client';

import { useEffect, useState, useMemo, useRef, Suspense, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { leadsAPI, authAPI, pipelineAPI } from '@/lib/api';
import PropertyPhoto from '@/components/PropertyPhoto';
import Avatar from '@/components/Avatar';
import AppShell from '@/components/AppShell';
import { isKanbanV2 } from '@/lib/flags';
import KanbanV2Board from '@/components/kanbanV2/KanbanV2Board';

// ─── Types ────────────────────────────────────────────────────────────────────

type SortKey = 'score' | 'arv' | 'asking' | 'created' | 'touched' | 'touches' | 'address' | 'tier';
type SortDir = 'asc' | 'desc';
type ViewMode = 'table' | 'cards';

// ─── Constants ────────────────────────────────────────────────────────────────

const INACTIVE_STATUSES = ['DEAD', 'CLOSED_WON', 'CLOSED_LOST'];

const PIPELINE_STAGES = [
  { id: 'NEW',                name: 'New Leads',          color: 'bg-primary-100 dark:bg-primary-900/30 border-primary-300 dark:border-primary-800 text-primary-800 dark:text-primary-400' },
  { id: 'ATTEMPTING_CONTACT', name: 'Attempting Contact', color: 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-800 text-yellow-800 dark:text-yellow-400' },
  { id: 'QUALIFYING',         name: 'Qualifying',         color: 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-800 text-purple-800 dark:text-purple-400' },
  { id: 'QUALIFIED',          name: 'Qualified',          color: 'bg-violet-100 dark:bg-violet-900/30 border-violet-300 dark:border-violet-800 text-violet-800 dark:text-violet-400' },
  { id: 'OFFER_SENT',         name: 'Offer Made',         color: 'bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-800 text-orange-800 dark:text-orange-400' },
  { id: 'NEGOTIATING',        name: 'Negotiating',        color: 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-400' },
  { id: 'UNDER_CONTRACT',     name: 'Under Contract',     color: 'bg-teal-100 dark:bg-teal-900/30 border-teal-300 dark:border-teal-800 text-teal-800 dark:text-teal-400' },
  { id: 'CLOSING',            name: 'Closing',            color: 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-400' },
  { id: 'NURTURE',            name: 'Nurture',            color: 'bg-sky-100 dark:bg-sky-900/30 border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-400' },
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
    pill: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 border-green-300 dark:border-green-800',
    dot: 'bg-green-500',
    chipActive: 'bg-green-600 text-white border-green-600',
  },
  2: {
    label: 'Tier 2', short: 'T2', emoji: '⚡', desc: 'Opportunity — working it',
    pill: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400 border-amber-300 dark:border-amber-800',
    dot: 'bg-amber-400',
    chipActive: 'bg-amber-500 text-white border-amber-500',
  },
  3: {
    label: 'Tier 3', short: 'T3', emoji: '❄️', desc: 'Cold / dead / unlikely',
    pill: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600',
    dot: 'bg-gray-400 dark:bg-gray-500',
    chipActive: 'bg-gray-600 text-white border-gray-600',
  },
};

const BAND_STYLES: Record<string, { pill: string; dot: string }> = {
  STRIKE_ZONE: { pill: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',         dot: 'bg-red-500' },
  HOT:         { pill: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800', dot: 'bg-orange-500' },
  WORKABLE:    { pill: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',    dot: 'bg-amber-400' },
  DEAD_COLD:   { pill: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700',       dot: 'bg-gray-300' },
  WARM:        { pill: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',    dot: 'bg-amber-400' },
  COOL:        { pill: 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 border-primary-200 dark:border-primary-800',       dot: 'bg-primary-400' },
  COLD:        { pill: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700',       dot: 'bg-gray-300' },
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
  DEAL_SEARCH: 'Deal Search',
  OTHER: 'Other',
};

// ─── Tier computation (client-side, no DB field needed) ───────────────────────

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
      closed ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
      dead   ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'   :
               'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800'
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
      <label className="text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">{label}:</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`text-xs border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:bg-gray-800 dark:text-gray-200 ${
          value ? 'border-primary-400 bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-400 font-medium' : 'border-gray-200 dark:border-gray-700'
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
          ? (activeClass || 'bg-primary-600 text-white border-primary-600')
          : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
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
        active ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
      }`}
    >
      {label}
      {active && <span className="text-[10px]">{dir === 'desc' ? '↓' : '↑'}</span>}
    </button>
  );
}

function MobileLeadCard({ lead, spread: s }: { lead: any; spread: number | null }) {
  const tier = (lead.tier || 2) as 1 | 2 | 3;
  const hoursAgo = lead.lastTouchedAt
    ? Math.round((Date.now() - new Date(lead.lastTouchedAt).getTime()) / 3600000)
    : null;
  const stale = hoursAgo !== null && hoursAgo > 72 && !INACTIVE_STATUSES.includes(lead.status);

  return (
    <Link
      href={`/leads/${lead.id}`}
      className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-3 flex flex-col gap-2 active:bg-gray-50 dark:active:bg-gray-800 ${
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
          <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{lead.propertyAddress}</div>
          <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
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
          <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
        )}
      </div>
      {/* Row 3: Score + touches */}
      <div className="flex items-center justify-between">
        <ScorePill band={lead.scoreBand} score={lead.totalScore} />
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
            {lead.touchCount ?? 0}
          </span>
          {hoursAgo !== null ? (
            <span className={`text-xs ${stale ? 'text-amber-600 font-semibold' : 'text-gray-400 dark:text-gray-500'}`}>
              {hoursAgo < 24 ? `${hoursAgo}h` : `${Math.round(hoursAgo / 24)}d`}
              {stale ? ' ⚠' : ''}
            </span>
          ) : (
            <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function LeadsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Initialize filter/sort state from URL params so back-navigation restores the view
  const [leads,         setLeads]         = useState<any[]>([]);
  const [pagination,    setPagination]    = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [counts,        setCounts]        = useState<{ tiers: Record<number, number>; bands: Record<string, number>; dripActive: number; hiddenInactive: number }>({ tiers: { 1: 0, 2: 0, 3: 0 }, bands: {}, dripActive: 0, hiddenInactive: 0 });
  const [availableStates, setAvailableStates] = useState<string[]>([]);
  const [pipelineData,  setPipelineData]  = useState<Record<string, { leads: any[]; total: number }>>({});
  const [loading,       setLoading]       = useState(true);
  const [search,        setSearch]        = useState(searchParams.get('q') || '');
  const [bandFilter,    setBandFilter]    = useState(searchParams.get('band') || '');
  const [statusFilter,  setStatusFilter]  = useState(searchParams.get('status') || '');
  const [sourceFilter,  setSourceFilter]  = useState(searchParams.get('source') || '');
  const [dateFilter,    setDateFilter]    = useState(searchParams.get('date') || '');
  const [staleFilter,   setStaleFilter]   = useState(searchParams.get('stale') || '');
  const [arvFilter,     setArvFilter]     = useState(searchParams.get('arv') || '');
  const [dealFilter,    setDealFilter]    = useState(searchParams.get('deal') || '');
  const [stateFilter,   setStateFilter]   = useState(searchParams.get('state') || '');
  const [assigneeFilter,setAssigneeFilter]= useState(searchParams.get('assignee') || '');
  const [tierFilter,    setTierFilter]    = useState<number>(Number(searchParams.get('tier')) || 0); // 0 = all
  const [showInactive,  setShowInactive]  = useState(searchParams.get('inactive') === 'true');     // default: hide dead/closed
  const [inDripFilter,  setInDripFilter]  = useState(searchParams.get('inDrip') === 'active');     // "In Drip (N)" chip
  const [teamMembers,   setTeamMembers]   = useState<any[]>([]);
  const [sortKey,       setSortKey]       = useState<SortKey>((searchParams.get('sort') as SortKey) || 'tier');
  const [sortDir,       setSortDir]       = useState<SortDir>((searchParams.get('dir') as SortDir) || 'asc');
  const [viewMode,      setViewMode]      = useState<ViewMode>((searchParams.get('view') as ViewMode) || 'table');
  const [page,          setPage]          = useState(Number(searchParams.get('page')) || 1);

  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [bulkStatus,    setBulkStatus]    = useState('');
  const [bulkSource,    setBulkSource]    = useState('');
  const [showFilters,   setShowFilters]   = useState(() => {
    // Auto-show filters panel if any filter param is present in URL
    return !!(searchParams.get('band') || searchParams.get('status') || searchParams.get('source') ||
      searchParams.get('date') || searchParams.get('stale') || searchParams.get('arv') ||
      searchParams.get('deal') || searchParams.get('state') || searchParams.get('assignee') ||
      searchParams.get('tier') || searchParams.get('inactive'));
  });
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx'>('csv');
  const [exportFields, setExportFields] = useState<Set<string>>(new Set([
    'sellerFirstName', 'sellerLastName', 'sellerPhone', 'sellerEmail',
    'propertyAddress', 'propertyCity', 'propertyState', 'propertyZip',
    'status', 'totalScore', 'scoreBand', 'source', 'askingPrice', 'arv', 'createdAt',
  ]));
  const [exporting, setExporting] = useState(false);

  // Sync filter/sort state to URL params so browser back-navigation restores the view
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const isInitialMount = useRef(true);
  useEffect(() => {
    // Skip the initial mount to avoid replacing the URL we just read from
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const syncUrl = () => {
      const params = new URLSearchParams();
      if (search)                   params.set('q', search);
      if (bandFilter)               params.set('band', bandFilter);
      if (statusFilter)             params.set('status', statusFilter);
      if (sourceFilter)             params.set('source', sourceFilter);
      if (dateFilter)               params.set('date', dateFilter);
      if (staleFilter)              params.set('stale', staleFilter);
      if (arvFilter)                params.set('arv', arvFilter);
      if (dealFilter)               params.set('deal', dealFilter);
      if (stateFilter)              params.set('state', stateFilter);
      if (assigneeFilter)           params.set('assignee', assigneeFilter);
      if (tierFilter)               params.set('tier', String(tierFilter));
      if (showInactive)             params.set('inactive', 'true');
      if (inDripFilter)             params.set('inDrip', 'active');
      if (sortKey !== 'tier')       params.set('sort', sortKey);
      if (sortDir !== 'asc')        params.set('dir', sortDir);
      if (viewMode !== 'table')     params.set('view', viewMode);
      if (page > 1)                 params.set('page', String(page));

      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    };

    // Debounce when the search text changes (keystrokes), sync immediately for everything else
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(syncUrl, 300);

    return () => clearTimeout(searchDebounceRef.current);
  }, [search, bandFilter, statusFilter, sourceFilter, dateFilter, staleFilter, arvFilter,
      dealFilter, stateFilter, assigneeFilter, tierFilter, showInactive, inDripFilter, sortKey, sortDir,
      viewMode, page, pathname, router]);

  // Abort controller for cancelling in-flight requests when filters change
  const abortRef = useRef<AbortController>();

  // Build query params and fetch leads from server
  const fetchLeads = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    const params: Record<string, string> = { page: String(page), limit: '50' };
    if (search)          params.search = search;
    if (bandFilter)      params.scoreBand = bandFilter;
    if (statusFilter)    params.status = statusFilter;
    if (sourceFilter)    params.source = sourceFilter;
    if (tierFilter)      params.tier = String(tierFilter);
    if (stateFilter)     params.propertyState = stateFilter;
    if (staleFilter)     params.staleMinDays = staleFilter;
    if (arvFilter)       params.arvFilter = arvFilter;
    if (showInactive)    params.showInactive = 'true';
    if (inDripFilter)    params.inDrip = 'active';
    if (sortKey)         params.sort = sortKey;
    if (sortDir)         params.dir = sortDir;
    if (assigneeFilter === 'unassigned') params.assignedToUserId = 'none';
    else if (assigneeFilter)             params.assignedToUserId = assigneeFilter;

    // Map date filter to createdAfter/createdBefore
    if (dateFilter === 'today') {
      params.createdAfter = new Date(Date.now() - 86400000).toISOString();
    } else if (dateFilter === 'week') {
      params.createdAfter = new Date(Date.now() - 7 * 86400000).toISOString();
    } else if (dateFilter === 'month') {
      params.createdAfter = new Date(Date.now() - 30 * 86400000).toISOString();
    } else if (dateFilter === 'older') {
      params.createdBefore = new Date(Date.now() - 30 * 86400000).toISOString();
    }

    try {
      const res = await leadsAPI.list(params);
      if (controller.signal.aborted) return;
      setLeads(res.data.leads || []);
      setPagination(res.data.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 });
      if (res.data.counts) setCounts(res.data.counts);
      if (res.data.availableStates) setAvailableStates(res.data.availableStates);
    } catch (err: any) {
      if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') console.error(err);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [page, search, bandFilter, statusFilter, sourceFilter, dateFilter, staleFilter,
      arvFilter, dealFilter, stateFilter, assigneeFilter, tierFilter, showInactive, inDripFilter, sortKey, sortDir]);

  // Fetch pipeline data when in grid view
  const fetchPipeline = useCallback(async () => {
    const params: Record<string, string> = {};
    if (search)     params.search = search;
    if (tierFilter) params.tier = String(tierFilter);
    if (bandFilter) params.scoreBand = bandFilter;
    if (assigneeFilter === 'unassigned') params.assignedToUserId = 'none';
    else if (assigneeFilter)             params.assignedToUserId = assigneeFilter;

    try {
      const res = await leadsAPI.pipeline(params);
      setPipelineData(res.data.stages || {});
    } catch (err) {
      console.error(err);
    }
  }, [search, tierFilter, bandFilter, assigneeFilter]);

  // Fetch data on filter/sort/page changes
  const searchDebounceRef2 = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    // Debounce search typing, fetch immediately for other filter changes
    clearTimeout(searchDebounceRef2.current);
    const delay = search ? 300 : 0;
    searchDebounceRef2.current = setTimeout(() => {
      if (viewMode === 'cards') {
        fetchPipeline();
      } else {
        fetchLeads();
      }
    }, delay);
    return () => clearTimeout(searchDebounceRef2.current);
  }, [fetchLeads, fetchPipeline, viewMode, search]);

  // Also fetch when switching view modes
  useEffect(() => {
    if (viewMode === 'cards') fetchPipeline();
    else fetchLeads();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // Load team members once
  useEffect(() => {
    authAPI.getTeam()
      .then(r => setTeamMembers(r.data || []))
      .catch(() => {});
  }, []);

  // Reset to page 1 when any filter changes (not page itself)
  const prevFiltersRef = useRef('');
  useEffect(() => {
    const key = [search, bandFilter, statusFilter, sourceFilter, dateFilter, staleFilter,
                 arvFilter, dealFilter, stateFilter, assigneeFilter, tierFilter, showInactive, inDripFilter, sortKey, sortDir].join('|');
    if (prevFiltersRef.current && prevFiltersRef.current !== key) {
      setPage(1);
    }
    prevFiltersRef.current = key;
  }, [search, bandFilter, statusFilter, sourceFilter, dateFilter, staleFilter,
      arvFilter, dealFilter, stateFilter, assigneeFilter, tierFilter, showInactive, inDripFilter, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  // Server provides filtered/sorted leads, counts, and available states
  const tierCounts = counts.tiers;
  const bandCounts = counts.bands;
  const dripActiveCount = counts.dripActive || 0;

  const maoFn  = (l: any) => l.arv ? Math.round(l.arv * 0.7 - 55000) : null;
  const spread = (l: any) => { const m = maoFn(l); return m && l.askingPrice ? m - l.askingPrice : null; };

  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedIds.size} lead(s)?`)) return;
    await leadsAPI.bulkDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
    fetchLeads();
  };

  const handleBulkStatus = async () => {
    if (!bulkStatus) return;
    await leadsAPI.bulkUpdateStatus(Array.from(selectedIds), bulkStatus);
    setBulkStatus(''); setSelectedIds(new Set());
    fetchLeads();
  };

  const handleBulkSource = async () => {
    if (!bulkSource) return;
    await leadsAPI.bulkUpdateSource(Array.from(selectedIds), bulkSource);
    setBulkSource(''); setSelectedIds(new Set());
    fetchLeads();
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const fields = Array.from(exportFields);
      const mime = exportFormat === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv';
      const exportFilters: Record<string, string> = {};
      if (search)          exportFilters.search = search;
      if (bandFilter)      exportFilters.scoreBand = bandFilter;
      if (statusFilter)    exportFilters.status = statusFilter;
      if (sourceFilter)    exportFilters.source = sourceFilter;
      if (tierFilter)      exportFilters.tier = String(tierFilter);
      if (stateFilter)     exportFilters.propertyState = stateFilter;
      if (showInactive)    exportFilters.showInactive = 'true';
      const res = await leadsAPI.exportLeads(exportFilters, fields, exportFormat);
      const url = URL.createObjectURL(new Blob([res.data], { type: mime }));
      const a   = document.createElement('a');
      a.href = url;
      a.download = `leads-${new Date().toISOString().split('T')[0]}.${exportFormat}`;
      a.click();
      URL.revokeObjectURL(url);
      setShowExportModal(false);
    } finally {
      setExporting(false);
    }
  };

  const EXPORT_FIELD_OPTIONS = [
    { key: 'sellerFirstName', label: 'First Name' }, { key: 'sellerLastName', label: 'Last Name' },
    { key: 'sellerPhone', label: 'Phone' }, { key: 'sellerEmail', label: 'Email' },
    { key: 'propertyAddress', label: 'Address' }, { key: 'propertyCity', label: 'City' },
    { key: 'propertyState', label: 'State' }, { key: 'propertyZip', label: 'Zip' },
    { key: 'propertyType', label: 'Property Type' }, { key: 'bedrooms', label: 'Beds' },
    { key: 'bathrooms', label: 'Baths' }, { key: 'sqft', label: 'Sqft' },
    { key: 'lotSize', label: 'Lot Size' }, { key: 'yearBuilt', label: 'Year Built' },
    { key: 'subdivision', label: 'Subdivision' }, { key: 'status', label: 'Status' },
    { key: 'source', label: 'Source' }, { key: 'totalScore', label: 'Score' },
    { key: 'scoreBand', label: 'Score Band' }, { key: 'tier', label: 'Tier' },
    { key: 'askingPrice', label: 'Asking Price' }, { key: 'arv', label: 'ARV' },
    { key: 'timeline', label: 'Timeline' }, { key: 'conditionLevel', label: 'Condition' },
    { key: 'ownershipStatus', label: 'Ownership' }, { key: 'sellerMotivation', label: 'Motivation' },
    { key: 'touchCount', label: 'Touches' }, { key: 'lastTouchedAt', label: 'Last Touched' },
    { key: 'createdAt', label: 'Created' }, { key: 'latitude', label: 'Latitude' },
    { key: 'longitude', label: 'Longitude' }, { key: 'repairCosts', label: 'Repair Costs' },
    { key: 'assignmentFee', label: 'Assignment Fee' }, { key: 'maoPercent', label: 'MAO %' },
  ];

  const toggleExportField = (key: string) => {
    setExportFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const clearFilters = () => {
    setSearch(''); setBandFilter(''); setStatusFilter(''); setSourceFilter('');
    setDateFilter(''); setStaleFilter(''); setArvFilter(''); setDealFilter('');
    setStateFilter(''); setAssigneeFilter(''); setTierFilter(0); setShowInactive(false);
    setInDripFilter(false);
  };

  const hasFilters = !!(search || bandFilter || statusFilter || sourceFilter || dateFilter ||
    staleFilter || arvFilter || dealFilter || stateFilter || assigneeFilter || tierFilter || showInactive || inDripFilter);

  // ─── Pipeline (Grid view) drag-and-drop ─────────────────────────────────────
  const onDragEnd = useCallback(async (result: DropResult) => {
    if (!result.destination) return;
    const { draggableId: leadId, source, destination } = result;
    if (source.droppableId === destination.droppableId) return;
    // Optimistic update on pipeline data
    setPipelineData(prev => {
      const next = { ...prev };
      const srcStage = next[source.droppableId];
      const dstStage = next[destination.droppableId];
      if (srcStage && dstStage) {
        const lead = srcStage.leads.find((l: any) => l.id === leadId);
        if (lead) {
          next[source.droppableId] = { ...srcStage, leads: srcStage.leads.filter((l: any) => l.id !== leadId), total: srcStage.total - 1 };
          next[destination.droppableId] = { ...dstStage, leads: [...dstStage.leads, { ...lead, status: destination.droppableId }], total: dstStage.total + 1 };
        }
      }
      return next;
    });
    try {
      await pipelineAPI.updateStage(leadId, destination.droppableId);
    } catch {
      fetchPipeline(); // Revert on error
    }
  }, [fetchPipeline]);

  const pipelineByStage = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const s of PIPELINE_STAGES) map[s.id] = pipelineData[s.id]?.leads || [];
    return map;
  }, [pipelineData]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <main className="max-w-screen-2xl mx-auto px-3 py-4 sm:px-6 sm:py-6 pb-16 md:pb-0 space-y-4">

        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Leads</h1>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
              {pagination.total} active lead{pagination.total !== 1 ? 's' : ''}
              {hasFilters && (
                <button onClick={clearFilters} className="ml-2 text-primary-500 hover:underline">
                  Clear filters
                </button>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/leads/import" className="btn btn-secondary btn-sm text-xs">Import</Link>
            <button onClick={() => setShowExportModal(true)} className="btn btn-secondary btn-sm text-xs">Export</button>
            <Link href="/leads/new" className="btn btn-primary btn-sm">+ New Lead</Link>
          </div>
        </div>

        {/* Search + Filter Bar */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3 space-y-3">

          {/* Top row: search + view mode + filter toggle */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">🔍</span>
              <input
                type="text"
                placeholder="Search name, address, phone..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-500"
              />
            </div>

            <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden ml-auto">
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'table' ? 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
              >
                ☰ List
              </button>
              <button
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === 'cards' ? 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
              >
                ⊞ Grid
              </button>
            </div>

            <button
              onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                showFilters || hasFilters
                  ? 'border-primary-400 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-950'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              ⚙ Filters {hasFilters ? '•' : ''}
            </button>
          </div>

          {/* Tier quick filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">Tier:</span>
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

            <span className="text-gray-200 dark:text-gray-700 select-none hidden sm:inline">|</span>

            {/* DEPRECATED: Score system being phased out. Do not extend. Replacement strategy TBD — likely a derived freshness/momentum metric. See docs/build-prompts/README.md. */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">Score:</span>
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

            <span className="text-gray-200 dark:text-gray-700 select-none hidden sm:inline">|</span>
            <FilterChip
              label={`✉ In Drip${dripActiveCount ? ` (${dripActiveCount})` : ''}`}
              active={inDripFilter}
              onClick={() => setInDripFilter(v => !v)}
            />

            <span className="text-gray-200 dark:text-gray-700 select-none hidden sm:inline">|</span>
            <button
              onClick={() => setShowInactive(v => !v)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                showInactive
                  ? 'bg-gray-600 text-white border-gray-600'
                  : 'bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              {showInactive ? '👁 Showing dead/closed' : 'Show dead/closed'}
            </button>
          </div>

          {/* Advanced Filters (collapsed by default) */}
          {showFilters && (
            <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
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
                  <button onClick={clearFilters} className="text-xs text-red-500 dark:text-red-400 hover:underline ml-auto">
                    Clear all
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div className="bg-primary-50 dark:bg-primary-950 border border-primary-200 dark:border-primary-800 rounded-xl px-4 py-2.5 flex items-center gap-4 flex-wrap">
            <span className="text-sm font-semibold text-primary-800 dark:text-primary-400">{selectedIds.size} selected</span>
            <button onClick={handleBulkDelete} className="text-xs px-3 py-1 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600">
              Delete
            </button>
            <div className="flex items-center gap-2">
              <select
                value={bulkStatus}
                onChange={e => setBulkStatus(e.target.value)}
                className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 dark:bg-gray-800 dark:text-gray-200"
              >
                <option value="">Move to stage...</option>
                {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {bulkStatus && (
                <button onClick={handleBulkStatus} className="text-xs px-3 py-1 bg-primary-600 text-white rounded-lg font-medium">
                  Apply
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={bulkSource}
                onChange={e => setBulkSource(e.target.value)}
                className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 dark:bg-gray-800 dark:text-gray-200"
              >
                <option value="">Change source...</option>
                {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {bulkSource && (
                <button onClick={handleBulkSource} className="text-xs px-3 py-1 bg-primary-600 text-white rounded-lg font-medium">
                  Apply
                </button>
              )}
            </div>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-primary-500 hover:underline ml-auto">
              Deselect
            </button>
          </div>
        )}

        {/* Main Content */}
        {loading ? (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading leads...</div>
        ) : leads.length === 0 ? (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">
            <div className="text-4xl mb-3">🔍</div>
            <div className="text-sm">No leads match your filters.</div>
            {hasFilters && (
              <button onClick={clearFilters} className="text-primary-500 hover:underline text-sm mt-2">
                Clear filters
              </button>
            )}
          </div>
        ) : viewMode === 'table' ? (

          /* ─── TABLE VIEW ─── */
          <>
          {/* Mobile card list */}
          <div className="block md:hidden space-y-2">
            {leads.map(lead => (
              <MobileLeadCard key={lead.id} lead={lead} spread={spread(lead)} />
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden min-w-[900px]">
            <div className="grid grid-cols-[auto_44px_2fr_110px_68px_72px_72px_72px_80px_60px_72px] gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-800/80">
              <input
                type="checkbox"
                checked={selectedIds.size === leads.length && leads.length > 0}
                onChange={() =>
                  selectedIds.size === leads.length
                    ? setSelectedIds(new Set())
                    : setSelectedIds(new Set(leads.map(l => l.id)))
                }
                className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600"
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

            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {leads.map(lead => {
                const s       = spread(lead);
                const hoursAgo = lead.lastTouchedAt
                  ? Math.round((Date.now() - new Date(lead.lastTouchedAt).getTime()) / 3600000)
                  : null;
                const stale = hoursAgo !== null && hoursAgo > 72 && !INACTIVE_STATUSES.includes(lead.status);
                const tier  = (lead.tier || 2) as 1 | 2 | 3;

                return (
                  <div
                    key={lead.id}
                    className={`grid grid-cols-[auto_44px_2fr_110px_68px_72px_72px_72px_80px_60px_72px] gap-3 items-center px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group ${
                      selectedIds.has(lead.id) ? 'bg-primary-50/40 dark:bg-primary-950/40' : ''
                    } ${lead.status === 'DEAD' ? 'opacity-60' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(lead.id)}
                      onChange={() => toggleSelect(lead.id)}
                      onClick={e => e.stopPropagation()}
                      className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600"
                    />
                    <PropertyPhoto
                      src={lead.primaryPhoto}
                      scoreBand={lead.scoreBand}
                      address={lead.propertyAddress}
                      size="sm"
                    />
                    <Link href={`/leads/${lead.id}`} className="min-w-0">
                      <div className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate group-hover:text-primary-700 dark:group-hover:text-primary-400">
                        {lead.propertyAddress}
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        {lead.propertyCity}, {lead.propertyState} · {lead.sellerFirstName} {lead.sellerLastName}
                        {lead.source && (
                          <span className="ml-1 text-gray-300 dark:text-gray-600">· {SOURCE_LABELS[lead.source] || lead.source}</span>
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
                    <Link href={lead.arv ? `/leads/${lead.id}` : `/leads/${lead.id}/comps-analysis`}>
                      {lead.arv
                        ? <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">${(lead.arv / 1000).toFixed(0)}k</span>
                        : <span className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline">+ ARV</span>}
                    </Link>
                    <Link href={`/leads/${lead.id}`}>
                      {lead.askingPrice
                        ? <span className="text-xs text-gray-600 dark:text-gray-400">${(lead.askingPrice / 1000).toFixed(0)}k</span>
                        : <span className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline">+ Ask</span>}
                    </Link>
                    <Link href={`/leads/${lead.id}`}>
                      {s !== null
                        ? <span className={`text-xs font-bold ${s >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {s >= 0 ? '+' : ''}${(s / 1000).toFixed(0)}k
                          </span>
                        : <span className="text-xs text-gray-300 dark:text-gray-600">—</span>}
                    </Link>
                    <Link href={`/leads/${lead.id}`}>
                      <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                        {lead.touchCount ?? 0}
                      </span>
                    </Link>
                    <Link href={`/leads/${lead.id}`}>
                      {hoursAgo !== null
                        ? <span className={`text-[11px] ${stale ? 'text-amber-600 font-semibold' : 'text-gray-400 dark:text-gray-500'}`}>
                            {hoursAgo < 24 ? `${hoursAgo}h` : `${Math.round(hoursAgo / 24)}d`}
                            {stale ? ' ⚠' : ''}
                          </span>
                        : <span className="text-[11px] text-gray-300 dark:text-gray-600">—</span>}
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-2 py-3">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                {(() => {
                  const pages: (number | '...')[] = [];
                  const tp = pagination.totalPages;
                  const cp = page;
                  if (tp <= 7) {
                    for (let i = 1; i <= tp; i++) pages.push(i);
                  } else {
                    pages.push(1);
                    if (cp > 3) pages.push('...');
                    for (let i = Math.max(2, cp - 1); i <= Math.min(tp - 1, cp + 1); i++) pages.push(i);
                    if (cp < tp - 2) pages.push('...');
                    pages.push(tp);
                  }
                  return pages.map((p, i) =>
                    p === '...' ? (
                      <span key={`e${i}`} className="px-1 text-xs text-gray-400 dark:text-gray-500">...</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p as number)}
                        className={`px-2.5 py-1 text-xs rounded border ${
                          p === cp
                            ? 'bg-primary-600 text-white border-primary-600'
                            : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  );
                })()}
                <button
                  onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages}
                  className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
          </>

        ) : isKanbanV2() ? (

          /* ─── GRID / PIPELINE VIEW (v2, behind NEXT_PUBLIC_KANBAN_V2) ─── */
          <KanbanV2Board />

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
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-white/60 dark:bg-black/30">
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
                                ? 'bg-primary-50 dark:bg-primary-950 border-2 border-primary-300 dark:border-primary-700 border-dashed'
                                : 'border-2 border-transparent'
                            }`}
                          >
                            {stageLeads.map((lead, index) => {
                              const tier = (lead.tier || 2) as 1 | 2 | 3;
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
                                        className={`block bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md hover:border-primary-200 dark:hover:border-primary-800 transition-all ${
                                          snapshot.isDragging ? 'shadow-xl ring-2 ring-primary-400 rotate-1' : ''
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
                                              <p className="font-semibold text-xs text-gray-900 dark:text-gray-100 truncate leading-snug">
                                                {lead.propertyAddress}
                                              </p>
                                              <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                                                {lead.propertyCity}, {lead.propertyState}
                                              </p>
                                            </div>
                                            <ScorePill band={lead.scoreBand} score={lead.totalScore} />
                                          </div>

                                          {/* Seller + assignee */}
                                          <div className="flex items-center justify-between">
                                            <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
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
                                          <div className="flex items-center justify-between text-[11px] border-t border-gray-100 dark:border-gray-800 pt-1.5">
                                            <div className="flex items-center gap-1.5 text-gray-400 dark:text-gray-500">
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
                                              <span className="font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full px-1 min-w-[16px] text-center text-[10px]">
                                                {lead.touchCount ?? 0}
                                              </span>
                                              <span className={`${stale ? 'text-amber-500 font-semibold' : 'text-gray-300 dark:text-gray-600'}`}>
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
                              <p className="text-[11px] text-gray-300 dark:text-gray-600 text-center pt-6 select-none">Empty</p>
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

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowExportModal(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Export Leads</h2>
              <button onClick={() => setShowExportModal(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl">&times;</button>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
              {/* Format */}
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">Format</label>
                <div className="flex gap-2">
                  {(['csv', 'xlsx'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setExportFormat(fmt)}
                      className={`px-4 py-1.5 text-sm rounded-lg border font-medium ${
                        exportFormat === fmt
                          ? 'bg-primary-50 dark:bg-primary-950 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-400'
                          : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              {/* Fields */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Fields</label>
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => setExportFields(new Set(EXPORT_FIELD_OPTIONS.map(f => f.key)))} className="text-primary-600 dark:text-primary-400 hover:underline">All</button>
                    <button onClick={() => setExportFields(new Set())} className="text-primary-600 dark:text-primary-400 hover:underline">None</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {EXPORT_FIELD_OPTIONS.map((f) => (
                    <label key={f.key} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={exportFields.has(f.key)}
                        onChange={() => toggleExportField(f.key)}
                        className="rounded text-primary-600"
                      />
                      <span className="text-gray-700 dark:text-gray-300">{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button onClick={() => setShowExportModal(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Cancel</button>
              <button
                onClick={handleExport}
                disabled={exportFields.size === 0 || exporting}
                className="px-5 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                {exporting ? 'Exporting...' : `Export ${exportFormat.toUpperCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center text-gray-400 dark:text-gray-500">Loading...</div>}>
      <LeadsPageInner />
    </Suspense>
  );
}
