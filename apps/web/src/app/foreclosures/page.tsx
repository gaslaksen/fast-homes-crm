'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { foreclosuresAPI } from '@/lib/api';
import { formatPhoneDisplay } from '@/lib/format';
import { useDialer } from '@/components/dialer/DialerContext';
import AppShell from '@/components/AppShell';

// ─── Types ──────────────────────────────────────────────────────────────────
interface FclLead {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  ownerNames: string;
  countyOwner: string | null;
  email: string | null;
  email2: string | null;
  phone1: string | null;
  phone2: string | null;
  phone3: string | null;
  phone4: string | null;
  phone1Type: string | null;
  phone2Type: string | null;
  phone3Type: string | null;
  phone4Type: string | null;
  noticeType: string | null;
  noticeUrl: string | null;
  caseNumber: string | null;
  county: string | null;
  saleDate: string | null;
  hearingDate: string | null;
  loanDate: string | null;
  loanAmount: number | null;
  assessedValue: number | null;
  priority: string;
  score: number;
  equityPct: number | null;
  equitySpread: number | null;
  workStatus: string;
  doNotCall: boolean;
  callNotes: string;
  touchDays: Record<string, boolean>;
  totalTouches: number;
  ownerOccupied: string | null;
  mailingAddress: string | null;
  mailCity: string | null;
  mailState: string | null;
  mailZip: string | null;
  skipStatus: string | null;
  parcelId: string | null;
  parcelUrl: string | null;
  parcelType: string | null;
  parcelLabel: string | null;
  zillowUrl: string | null;
  realtorQuery: string | null;
  realtorZip: string | null;
  daysToSale: number | null;
  // Rules-engine verdict. debtFigureReliable=false means the equity fields
  // above are deliberately blank, not merely unknown.
  loanType: string | null;
  lenderName: string | null;
  debtFigureReliable: boolean;
  signals: FclSignal[];
}

interface FclSignal {
  id: string;
  signalCode: string;
  severity: 'critical' | 'notable' | 'info';
  headline: string;
  evidence: string[];
  recommendedActions: string[];
  completedActions: string[];
}

const WORK_STATUSES = [
  { value: 'NOT_CONTACTED', label: 'Not Contacted' },
  { value: 'IN_CONVERSATION', label: 'In Conversation' },
  { value: 'APPOINTMENT_SET', label: 'Appointment Set' },
  { value: 'UNDER_CONTRACT', label: 'Under Contract' },
  { value: 'DEAD', label: 'Dead' },
];

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F'];

// ─── Helpers ────────────────────────────────────────────────────────────────
function money(n: number | null): string {
  return n == null ? '-' : `$${Math.round(n).toLocaleString()}`;
}
function signedMoney(n: number | null): string {
  if (n == null) return '-';
  return `${n >= 0 ? '+$' : '-$'}${Math.abs(Math.round(n)).toLocaleString()}`;
}
function fmtDateUS(iso: string | null): string {
  if (!iso) return '-';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${+m[2]}/${+m[3]}/${m[1]}` : iso;
}
function noticeLabel(t: string | null): string {
  return (t || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace('Com ', '');
}
function scoreClass(s: number): string {
  if (s >= 65) return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700';
  if (s >= 40) return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700';
  return 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700';
}
function priorityClass(p: string): string {
  if (p === 'HIGH') return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300';
  if (p === 'MEDIUM') return 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300';
  return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300';
}
// Timing badge, ported from the tracker's daysBadge().
function daysBadge(d: number | null): { text: string; cls: string } {
  if (d == null) return { text: '-', cls: '' };
  if (d < 0) return { text: 'Passed', cls: 'text-red-600 dark:text-red-400' };
  if (d === 0) return { text: 'TODAY', cls: 'text-red-600 dark:text-red-400' };
  if (d <= 14) return { text: `${d}d to sale`, cls: 'text-red-600 dark:text-red-400' };
  if (d <= 30) return { text: `${d}d to sale`, cls: 'text-amber-600 dark:text-amber-400' };
  return { text: `${d}d to sale`, cls: '' };
}
// Short chip label per signal code. The full headline is up to 80 characters,
// far too long for a chip, so the chip names the kind of thing and the modal
// carries the sentence.
const SIGNAL_LABELS: Record<string, string> = {
  LOAN_TYPE_REVERSE: 'Reverse mortgage',
  LOAN_TYPE_HOA: 'HOA lien',
  LOAN_TYPE_TAX: 'Tax foreclosure',
  LOAN_TYPE_PRIVATE: 'Private lender',
  HEIR_ESTATE_PATH: 'Estate path?',
  OCCUPANCY_RISK: 'Occupancy risk',
  DEBT_FIGURE_UNRELIABLE: 'Debt figure unreliable',
  TITLE_COMPLEXITY: 'Title complexity',
  TIMELINE_URGENT: 'Urgent timeline',
  TIMELINE_UPSET_BID_OPEN: 'Upset bid open',
  CONTACT_TARGET_NOT_OWNER: 'Contact may not be owner',
  SKIP_TRACE_LOW_YIELD_EXPECTED: 'Skip trace may be thin',
  DATA_QUALITY_DEGRADED: 'Check extraction',
};
function signalLabel(code: string): string {
  return SIGNAL_LABELS[code] || code.replace(/_/g, ' ').toLowerCase();
}
function severityClass(sev: string): string {
  if (sev === 'critical') return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60';
  if (sev === 'notable') return 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60';
  return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700';
}
// Human label for an action enum, for the modal checklist.
const ACTION_LABELS: Record<string, string> = {
  CHECK_ESTATE_FILE: 'Check the county estate file',
  TRACE_RELATIVES_NOT_OWNER: 'Trace relatives, not the record owner',
  PULL_DOT_FROM_ROD: 'Pull the Deed of Trust from the Register of Deeds',
  CONTACT_TRUSTEE_ATTORNEY: 'Contact the trustee attorney',
  VERIFY_OCCUPANCY: 'Verify occupancy',
  PRIORITIZE_DIRECT_MAIL: 'Prioritise direct mail over phone',
  SKIP_PHONE_FIRST_TOUCH: 'Skip phone for the first touch',
  MANUAL_FIELD_REVIEW: 'Review the extracted fields by hand',
  STANDARD_OUTREACH: 'Standard outreach',
};
function actionLabel(a: string): string {
  return ACTION_LABELS[a] || a.replace(/_/g, ' ').toLowerCase();
}
// Field names cited as evidence, rendered readably: camelCase to a sentence,
// with a trailing "At" reading as "date" (hearingAt -> "Hearing date"). Only a
// TRAILING one, so borrowerAgeFloorAtOrigination keeps its middle "at".
function evidenceLabel(f: string): string {
  const words = f.replace(/([A-Z])/g, ' $1').trim().toLowerCase().replace(/ at$/, ' date');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function csvEsc(v: any): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}
/** Parcel link: exact PID uses the stored deep link; everything else gets a
 *  Google parcel-records search (county GIS homepages cannot deep link). */
function parcelHref(l: FclLead): string {
  if (l.parcelType === 'exact' && l.parcelUrl) return l.parcelUrl;
  return `https://www.google.com/search?q=${encodeURIComponent(`${l.address} ${l.city || ''} parcel property records`)}`;
}
// Realtor.com live resolver (exact property via the rdc geo suggest API),
// ported from the tracker's openRealtor(). Falls back to a zip search.
function openRealtor(lead: FclLead) {
  const w = window.open('about:blank', '_blank'); // keep user gesture
  const fallback = `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(String(lead.realtorZip || lead.zip || '').replace(/\s+/g, '-'))}`;
  let cache: Record<string, string> = {};
  try { cache = JSON.parse(localStorage.getItem('rdc_mpr') || '{}'); } catch { /* ignore */ }
  if (cache[lead.id]) { if (w) w.location.href = `https://www.realtor.com/realestateandhomes-detail/M${cache[lead.id]}`; return; }
  if (!lead.realtorQuery) { if (w) w.location.href = fallback; return; }
  const api = `https://parser-external.geo.moveaws.com/suggest?input=${encodeURIComponent(lead.realtorQuery)}&client_id=rdc&limit=1`;
  fetch(api).then((r) => r.json()).then((j) => {
    const a = j?.autocomplete?.[0];
    if (a?.mpr_id && a.area_type === 'address') {
      cache[lead.id] = a.mpr_id;
      try { localStorage.setItem('rdc_mpr', JSON.stringify(cache)); } catch { /* ignore */ }
      if (w) w.location.href = `https://www.realtor.com/realestateandhomes-detail/M${a.mpr_id}`;
    } else if (w) { w.location.href = fallback; }
  }).catch(() => { if (w) w.location.href = fallback; });
}

const CSV_HEADERS = ['First Name', 'Last Name', 'Owner Name', 'Property Address', 'Property City', 'Property State', 'Property Zip', 'County', 'Mailing Address', 'Mailing City', 'Mailing State', 'Mailing Zip', 'Phone 1', 'Phone 1 Type', 'Phone 2', 'Phone 2 Type', 'Phone 3', 'Phone 3 Type', 'Phone 4', 'Phone 4 Type', 'Email', 'Email 2', 'Priority', 'Notice Type', 'Case Number', 'Sale Date', 'Days To Sale', 'Loan Date', 'Loan Amount', 'Assessed Value', 'Equity %', 'Equity Spread', 'Owner Occupied', 'Lead Score', 'Status', 'Do Not Call', 'Notes', 'Zillow URL', 'Property Record URL', 'Notice URL'];

function leadCsvRow(l: FclLead): string[] {
  const owner = (l.ownerNames || l.countyOwner || '').split(';')[0].trim();
  const parts = owner.split(/\s+/);
  return [
    parts[0] || '', parts.slice(1).join(' '), l.ownerNames || l.countyOwner || '',
    l.address, l.city, l.state, l.zip, l.county || '',
    l.mailingAddress || '', l.mailCity || '', l.mailState || '', l.mailZip || '',
    l.phone1 || '', l.phone1Type || '', l.phone2 || '', l.phone2Type || '',
    l.phone3 || '', l.phone3Type || '', l.phone4 || '', l.phone4Type || '',
    l.email || '', l.email2 || '',
    l.priority, noticeLabel(l.noticeType), l.caseNumber || '', l.saleDate || '',
    l.daysToSale == null ? '' : String(l.daysToSale), l.loanDate || '',
    l.loanAmount == null ? '' : String(l.loanAmount), l.assessedValue == null ? '' : String(l.assessedValue),
    l.equityPct == null ? '' : String(l.equityPct), l.equitySpread == null ? '' : String(l.equitySpread),
    l.ownerOccupied || '', String(l.score),
    WORK_STATUSES.find((s) => s.value === l.workStatus)?.label || l.workStatus,
    l.doNotCall ? 'Y' : '', l.callNotes || '', l.zillowUrl || '', parcelHref(l), l.noticeUrl || '',
  ];
}

function downloadCsv(leads: FclLead[]) {
  const rows = [CSV_HEADERS, ...leads.map(leadCsvRow)];
  const csv = rows.map((r) => r.map(csvEsc).join(',')).join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `foreclosure-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Small UI atoms ───────────────────────────────────────────────────────────
function StatCard({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-1">
      <div className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-3xl font-bold leading-none mt-1 ${accent || 'text-gray-900 dark:text-gray-100'}`}>{value}</div>
    </div>
  );
}

function Chip({ active, onClick, children, activeClass }: { active: boolean; onClick: () => void; children: React.ReactNode; activeClass?: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
        active
          ? activeClass || 'bg-primary-600 text-white border-primary-600'
          : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
      }`}
    >
      {children}
    </button>
  );
}

function Tag({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`text-[11px] px-2 py-0.5 rounded font-semibold ${cls}`}>{children}</span>;
}

/** A signal as a chip in the tag row. Clicking opens the detail modal. */
function SignalChip({ signal, onOpen }: { signal: FclSignal; onOpen: () => void }) {
  const done = signal.recommendedActions.length > 0 &&
    signal.completedActions.length >= signal.recommendedActions.length;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      title={signal.headline}
      className={`text-[11px] px-2 py-0.5 rounded font-semibold transition-colors ${severityClass(signal.severity)}`}
    >
      {done && '\u2713 '}{signalLabel(signal.signalCode)}
    </button>
  );
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); copyToClipboard(text); setCopied(true); setTimeout(() => setCopied(false), 1100); }}
      title={`Copy ${label}`}
      className={`ml-1.5 flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md border text-sm transition-colors ${
        copied
          ? 'text-green-500 border-green-400 bg-green-50 dark:bg-green-900/20'
          : 'text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-400 dark:hover:border-gray-500'}`}
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-[10px] uppercase tracking-wider font-semibold text-gray-400 dark:text-gray-500 ${className || ''}`}>{children}</div>;
}

// Persist the filter bar so a page refresh keeps the same county/filters for
// this browser (per the user's session), instead of resetting to the default
// unfiltered view.
const FILTERS_KEY = 'fcl_filters_v1';
interface SavedFilters {
  search?: string;
  priorities?: string[];
  workStatuses?: string[];
  noticeTypes?: string[];
  city?: string;
  county?: string;
  equityBand?: string;
  ownedYearsMin?: string;
  saleWindow?: string;
  occupancy?: string;
  valueMin?: string;
  hideDead?: boolean;
  hideDnc?: boolean;
  sort?: string;
  collapseAll?: boolean;
}
function loadSavedFilters(): SavedFilters {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function saveFilters(f: SavedFilters) {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    /* storage blocked; filters just won't persist */
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ForeclosuresPage() {
  const [leads, setLeads] = useState<FclLead[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [counties, setCounties] = useState<string[]>([]);
  const [collapseAll, setCollapseAll] = useState(false);
  const [stats, setStats] = useState({ total: 0, high: 0, soon: 0, highEquity: 0 });
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 60, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Filters (mirroring the offline tracker's filter bar). Chip groups are
  // multi-select: any combination within a group ORs together.
  const [search, setSearch] = useState('');
  const [priorities, setPriorities] = useState<Set<string>>(new Set());
  const [workStatuses, setWorkStatuses] = useState<Set<string>>(new Set());
  const [noticeTypes, setNoticeTypes] = useState<Set<string>>(new Set());
  const [city, setCity] = useState('');
  const [county, setCounty] = useState('');
  const [equityBand, setEquityBand] = useState('');
  const [ownedYearsMin, setOwnedYearsMin] = useState('');
  const [saleWindow, setSaleWindow] = useState('');
  const [occupancy, setOccupancy] = useState('');
  const [valueMin, setValueMin] = useState('');
  const [hideDead, setHideDead] = useState(false);
  const [hideDnc, setHideDnc] = useState(false);
  const [sort, setSort] = useState('sale');
  const [page, setPage] = useState(1);
  // Gate data fetching until saved filters are restored, so we never flash the
  // default (unfiltered) list before the user's persisted county/filters load.
  const [hydrated, setHydrated] = useState(false);

  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const showToast = (msg: string, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchLeads = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const params: Record<string, string> = { sort, page: String(page), pageSize: '60' };
      if (search) params.search = search;
      if (priorities.size) params.priority = Array.from(priorities).join(',');
      if (workStatuses.size) params.workStatus = Array.from(workStatuses).join(',');
      if (noticeTypes.size) params.noticeType = Array.from(noticeTypes).join(',');
      if (city) params.city = city;
      if (county) params.county = county;
      if (equityBand) params.equityBand = equityBand;
      if (ownedYearsMin) params.ownedYearsMin = ownedYearsMin;
      if (saleWindow) params.saleWindow = saleWindow;
      if (occupancy) params.occupancy = occupancy;
      if (valueMin) params.valueMin = valueMin;
      if (hideDead) params.hideDead = 'true';
      if (hideDnc) params.hideDnc = 'true';
      const res = await foreclosuresAPI.list(params);
      setLeads(res.data.leads || []);
      setCities(res.data.cities || []);
      setCounties(res.data.counties || []);
      setPagination(res.data.pagination || { page: 1, pageSize: 60, total: 0, totalPages: 1 });
    } catch (e: any) {
      if (e.name !== 'CanceledError') showToast('Failed to load foreclosures', true);
    } finally {
      setLoading(false);
    }
  }, [search, priorities, workStatuses, noticeTypes, city, county, equityBand, ownedYearsMin, saleWindow, occupancy, valueMin, hideDead, hideDnc, sort, page]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await foreclosuresAPI.stats();
      setStats(res.data);
    } catch {
      /* non-fatal */
    }
  }, []);

  // Restore saved filters once, on mount, before the first fetch.
  useEffect(() => {
    const s = loadSavedFilters();
    if (s.search) setSearch(s.search);
    if (s.priorities?.length) setPriorities(new Set(s.priorities));
    if (s.workStatuses?.length) setWorkStatuses(new Set(s.workStatuses));
    if (s.noticeTypes?.length) setNoticeTypes(new Set(s.noticeTypes));
    if (s.city) setCity(s.city);
    if (s.county) setCounty(s.county);
    if (s.equityBand) setEquityBand(s.equityBand);
    if (s.ownedYearsMin) setOwnedYearsMin(s.ownedYearsMin);
    if (s.saleWindow) setSaleWindow(s.saleWindow);
    if (s.occupancy) setOccupancy(s.occupancy);
    if (s.valueMin) setValueMin(s.valueMin);
    if (s.hideDead) setHideDead(true);
    if (s.hideDnc) setHideDnc(true);
    if (s.sort) setSort(s.sort);
    if (s.collapseAll) setCollapseAll(true);
    setHydrated(true);
  }, []);

  // Persist the filter bar whenever it changes (after hydration).
  useEffect(() => {
    if (!hydrated) return;
    saveFilters({
      search,
      priorities: Array.from(priorities),
      workStatuses: Array.from(workStatuses),
      noticeTypes: Array.from(noticeTypes),
      city,
      county,
      equityBand,
      ownedYearsMin,
      saleWindow,
      occupancy,
      valueMin,
      hideDead,
      hideDnc,
      sort,
      collapseAll,
    });
  }, [hydrated, search, priorities, workStatuses, noticeTypes, city, county, equityBand, ownedYearsMin, saleWindow, occupancy, valueMin, hideDead, hideDnc, sort, collapseAll]);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(fetchLeads, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [hydrated, fetchLeads, search]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    setPage(1);
  }, [search, priorities, workStatuses, noticeTypes, city, county, equityBand, ownedYearsMin, saleWindow, occupancy, valueMin, hideDead, hideDnc, sort]);

  /** Toggle a value inside a multi-select chip group. */
  const toggleIn = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const updateLead = async (id: string, patch: any, localPatch?: any) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...(localPatch || patch) } : l)));
    try {
      await foreclosuresAPI.update(id, patch);
    } catch {
      showToast('Update failed', true);
      fetchLeads();
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllShown = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = leads.every((l) => next.has(l.id));
      if (allSelected) leads.forEach((l) => next.delete(l.id));
      else leads.forEach((l) => next.add(l.id));
      return next;
    });
  };

  const handleCsv = async (file: File) => {
    setBusy(true);
    showToast(`Importing ${file.name}...`);
    try {
      const res = await foreclosuresAPI.importExecute(file);
      const { created, skipped, errors } = res.data;
      showToast(`Imported ${created} lead${created === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}${errors?.length ? `, ${errors.length} errors` : ''}.`);
      fetchLeads();
      fetchStats();
    } catch (e: any) {
      showToast(e.response?.data?.message || 'Import failed', true);
    } finally {
      setBusy(false);
    }
  };

  const handlePdf = async (file: File) => {
    setBusy(true);
    showToast(`Reading ${file.name}...`);
    try {
      const res = await foreclosuresAPI.uploadPdf(file);
      if (res.data.created) {
        showToast(`Added lead: ${res.data.extracted?.propertyAddress || 'notice parsed'}.`);
        fetchLeads();
        fetchStats();
      } else {
        showToast(res.data.reason || 'No new lead from that PDF.', true);
      }
    } catch (e: any) {
      showToast(e.response?.data?.message || 'PDF upload failed', true);
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async () => {
    setBusy(true);
    showToast('Pulling latest notices from Mecklenburg Times...');
    try {
      const res = await foreclosuresAPI.refresh();
      const { created, skipped, pastDated } = res.data;
      showToast(`Feed pull: ${created} new, ${skipped} existing, ${pastDated} past-dated.`);
      fetchLeads();
      fetchStats();
    } catch (e: any) {
      showToast(e.response?.data?.message || 'Feed refresh failed', true);
    } finally {
      setBusy(false);
    }
  };

  const resetFilters = () => {
    setSearch('');
    setPriorities(new Set());
    setWorkStatuses(new Set());
    setNoticeTypes(new Set());
    setCity('');
    setCounty('');
    setEquityBand('');
    setOwnedYearsMin('');
    setSaleWindow('');
    setOccupancy('');
    setValueMin('');
    setHideDead(false);
    setHideDnc(false);
  };

  /**
   * Tick or untick a suggested next step. Optimistic so the checkbox responds
   * immediately; on failure the list refetch puts it back.
   */
  const toggleSignalAction = async (signalId: string, action: string, completed: boolean) => {
    setLeads((prev) => prev.map((l) => ({
      ...l,
      signals: (l.signals || []).map((sg) => sg.id !== signalId ? sg : {
        ...sg,
        completedActions: completed
          ? Array.from(new Set([...sg.completedActions, action]))
          : sg.completedActions.filter((a) => a !== action),
      }),
    })));
    try {
      await foreclosuresAPI.setSignalAction(signalId, action, completed);
    } catch {
      showToast('Could not save that step', true);
      fetchLeads();
    }
  };

  /** Re-run skip trace for one lead, then refresh that card in place. */
  const runSkiptraceOne = async (id: string) => {
    await foreclosuresAPI.skiptrace(id);
    const res = await foreclosuresAPI.get(id);
    setLeads((prev) => prev.map((l) => (l.id === id ? res.data : l)));
  };

  /** Queue skip trace for every checked lead; results land as they finish. */
  const handleSkiptraceSelected = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setBusy(true);
    try {
      const res = await foreclosuresAPI.bulkSkiptrace(ids);
      showToast(`Skip trace started for ${res.data.queued} lead${res.data.queued === 1 ? '' : 's'} - results appear as they finish.`);
      // Each lead takes a couple of seconds server-side; refresh in waves.
      setTimeout(fetchLeads, 6000);
      setTimeout(fetchLeads, 20000);
    } catch (e: any) {
      showToast(e.response?.data?.message || 'Skip trace failed to start', true);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} lead${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await foreclosuresAPI.bulkDelete(ids);
      showToast(`Deleted ${res.data.deleted} lead${res.data.deleted === 1 ? '' : 's'}.`);
      setSelected(new Set());
      fetchLeads();
      fetchStats();
    } catch (e: any) {
      showToast(e.response?.data?.message || 'Delete failed', true);
    } finally {
      setBusy(false);
    }
  };

  const anyFilter = search || priorities.size || workStatuses.size || noticeTypes.size || city || county || equityBand || ownedYearsMin || saleWindow || occupancy || valueMin || hideDead || hideDnc;
  const selectedLeads = leads.filter((l) => selected.has(l.id));

  return (
    <AppShell>
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Foreclosures</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Pre-foreclosure leads. No automatic outreach - AI replies stay off until campaigns are enabled.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={handleRefresh} disabled={busy} className="btn btn-secondary btn-sm disabled:opacity-50">
              Refresh feed
            </button>
            <button onClick={() => pdfRef.current?.click()} disabled={busy} className="btn btn-secondary btn-sm disabled:opacity-50">
              Upload PDF
            </button>
            <button onClick={() => csvRef.current?.click()} disabled={busy} className="btn btn-primary btn-sm disabled:opacity-50">
              Import sheet
            </button>
            <input ref={csvRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsv(f); e.target.value = ''; }} />
            <input ref={pdfRef} type="file" accept=".pdf" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePdf(f); e.target.value = ''; }} />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          <StatCard label="Total leads" value={stats.total} />
          <StatCard label="High priority" value={stats.high} accent="text-red-600 dark:text-red-400" />
          <StatCard label="Sale within 14d" value={stats.soon} accent="text-amber-600 dark:text-amber-400" />
          <StatCard label="40%+ equity" value={stats.highEquity} accent="text-green-600 dark:text-green-400" />
        </div>

        {/* Search + sort */}
        <div className="flex gap-2 flex-wrap items-center mb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search address, owner, case number, email..."
            className="input flex-1 min-w-[220px]"
          />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="input w-auto">
            <option value="sale">Sort: Sale date</option>
            <option value="score">Sort: Lead score</option>
            <option value="equity">Sort: Equity %</option>
            <option value="added">Sort: Recently added</option>
          </select>
        </div>

        {/* Quick filter chips (priority / status / notice type) */}
        <div className="flex gap-2 flex-wrap items-center mb-2">
          <span className="text-[11px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Quick filters</span>
          {['HIGH', 'MEDIUM', 'LOW'].map((p) => (
            <Chip key={p} active={priorities.has(p)} onClick={() => toggleIn(priorities, p, setPriorities)}
              activeClass={p === 'HIGH' ? 'bg-red-600 text-white border-red-600' : p === 'MEDIUM' ? 'bg-amber-500 text-white border-amber-500' : 'bg-blue-600 text-white border-blue-600'}>
              {p.charAt(0) + p.slice(1).toLowerCase()}
            </Chip>
          ))}
          <span className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
          {[['IN_CONVERSATION', 'In Conversation'], ['APPOINTMENT_SET', 'Appointment Set'], ['UNDER_CONTRACT', 'Under Contract']].map(([v, label]) => (
            <Chip key={v} active={workStatuses.has(v)} onClick={() => toggleIn(workStatuses, v, setWorkStatuses)}>{label}</Chip>
          ))}
          <span className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
          {[['pre_foreclosure_hearing', 'Pre-Foreclosure'], ['mortgage_foreclosure', 'Mortgage FC'], ['auction_com_foreclosure', 'Auction FC']].map(([v, label]) => (
            <Chip key={v} active={noticeTypes.has(v)} onClick={() => toggleIn(noticeTypes, v, setNoticeTypes)}>{label}</Chip>
          ))}
        </div>

        {/* Filter selects (city / equity / owned / sale / occupancy / value / flags) */}
        <div className="flex gap-2 flex-wrap items-center mb-4">
          <span className="text-[11px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Filters</span>
          <select value={county} onChange={(e) => setCounty(e.target.value)} className="input w-auto py-1.5 text-sm">
            <option value="">All counties</option>
            {counties.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={city} onChange={(e) => setCity(e.target.value)} className="input w-auto py-1.5 text-sm">
            <option value="">All cities</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={equityBand} onChange={(e) => setEquityBand(e.target.value)} className="input w-auto py-1.5 text-sm">
            <option value="">Any equity</option>
            <option value="50">Equity 50%+</option>
            <option value="30">Equity 30-50%</option>
            <option value="0">Equity 0-30%</option>
            <option value="neg">Negative equity</option>
          </select>
          <select value={ownedYearsMin} onChange={(e) => setOwnedYearsMin(e.target.value)} className="input w-auto py-1.5 text-sm">
            <option value="">Any ownership length</option>
            <option value="5">Owned 5+ yrs</option>
            <option value="10">Owned 10+ yrs</option>
            <option value="15">Owned 15+ yrs</option>
            <option value="20">Owned 20+ yrs</option>
          </select>
          <select value={saleWindow} onChange={(e) => setSaleWindow(e.target.value)} className="input w-auto py-1.5 text-sm">
            <option value="">Any sale date</option>
            <option value="over">Sale overdue</option>
            <option value="7">Sale in 7 days</option>
            <option value="14">Sale in 14 days</option>
            <option value="30">Sale in 30 days</option>
          </select>
          <select value={occupancy} onChange={(e) => setOccupancy(e.target.value)} className="input w-auto py-1.5 text-sm">
            <option value="">Any occupancy</option>
            <option value="absentee">Absentee owner</option>
            <option value="owner">Owner-occupied</option>
          </select>
          <select value={valueMin} onChange={(e) => setValueMin(e.target.value)} className="input w-auto py-1.5 text-sm">
            <option value="">Any value</option>
            <option value="100000">Value $100k+</option>
            <option value="200000">Value $200k+</option>
            <option value="300000">Value $300k+</option>
            <option value="500000">Value $500k+</option>
          </select>
          <Chip active={hideDead} onClick={() => setHideDead(!hideDead)} activeClass="bg-red-600 text-white border-red-600">Hide dead</Chip>
          <Chip active={hideDnc} onClick={() => setHideDnc(!hideDnc)} activeClass="bg-red-600 text-white border-red-600">Hide Do-Not-Call</Chip>
          {anyFilter && (
            <button onClick={resetFilters} className="btn btn-secondary btn-sm ml-auto">Reset filters</button>
          )}
        </div>

        {/* Count + bulk tools */}
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3 flex items-center justify-between flex-wrap gap-2">
          <span>{loading ? 'Loading...' : `${pagination.total} lead${pagination.total === 1 ? '' : 's'} · click a card to select it for CSV export`}</span>
          {leads.length > 0 && (
            <span className="flex items-center gap-3">
              <button onClick={() => setCollapseAll((v) => !v)} className="text-primary-600 dark:text-primary-400 hover:underline">
                {collapseAll ? 'Expand cards' : 'Collapse cards'}
              </button>
              <button onClick={selectAllShown} className="text-primary-600 dark:text-primary-400 hover:underline">
                Select all shown
              </button>
              <button onClick={() => downloadCsv(leads)} className="text-primary-600 dark:text-primary-400 hover:underline">
                Download shown as CSV
              </button>
            </span>
          )}
        </div>

        {/* Grid */}
        {!loading && leads.length === 0 ? (
          <div className="text-center py-16 text-gray-500 dark:text-gray-400">
            <p className="text-lg font-medium">No foreclosure leads found</p>
            <p className="text-sm mt-1">Import the tracker sheet, upload an eCourts PDF, refresh the feed, or clear filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start">
            {leads.map((l) => (
              <LeadCard key={l.id} lead={l} onUpdate={updateLead} onSkiptrace={runSkiptraceOne}
                onToggleAction={toggleSignalAction}
                collapseDefault={collapseAll}
                selected={selected.has(l.id)} onToggleSelect={() => toggleSelect(l.id)} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              className="btn btn-secondary btn-sm disabled:opacity-40">Prev</button>
            <span className="text-sm text-gray-500 dark:text-gray-400">Page {pagination.page} of {pagination.totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))} disabled={page >= pagination.totalPages}
              className="btn btn-secondary btn-sm disabled:opacity-40">Next</button>
          </div>
        )}
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white dark:bg-gray-900 border border-primary-500 shadow-lg text-sm">
          <span className="text-gray-700 dark:text-gray-200"><b className="text-primary-600 dark:text-primary-400">{selected.size}</b> selected</span>
          <button onClick={() => downloadCsv(selectedLeads)} className="btn btn-primary btn-sm">Download CSV</button>
          <button onClick={handleSkiptraceSelected} disabled={busy} className="btn btn-secondary btn-sm disabled:opacity-50">Skip trace</button>
          <button onClick={() => setSelected(new Set())} className="btn btn-secondary btn-sm">Clear</button>
          <button onClick={handleDeleteSelected} disabled={busy}
            className="btn btn-sm bg-red-600 hover:bg-red-700 text-white border border-red-600 disabled:opacity-50">
            Delete
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl text-sm shadow-lg border ${
          toast.err ? 'bg-white dark:bg-gray-900 border-red-400 text-red-600 dark:text-red-400'
                    : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100'}`}>
          {toast.msg}
        </div>
      )}
    </AppShell>
  );
}

// ─── Lead card (modeled on the offline tracker card) ─────────────────────────
function LeadCard({ lead: l, onUpdate, onSkiptrace, onToggleAction, collapseDefault, selected, onToggleSelect }: {
  lead: FclLead;
  onUpdate: (id: string, patch: any, localPatch?: any) => void;
  onSkiptrace: (id: string) => Promise<void>;
  onToggleAction: (signalId: string, action: string, completed: boolean) => void;
  collapseDefault: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const db = daysBadge(l.daysToSale);
  const priBar = l.priority === 'HIGH' ? 'bg-red-500' : l.priority === 'MEDIUM' ? 'bg-amber-500' : 'bg-blue-500';
  const dialer = useDialer();
  const [notes, setNotes] = useState(l.callNotes || '');
  const [tracing, setTracing] = useState(false);
  const [collapsed, setCollapsed] = useState(collapseDefault);
  const [editing, setEditing] = useState(false);
  const [showSignals, setShowSignals] = useState(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Place the call through the in-app Twilio dialer (not the native handler).
  const dial = (num: string) => {
    dialer.startCall({ name: l.ownerNames || l.countyOwner || undefined, phone: num, leadId: l.id });
  };

  // Follow the global Collapse/Expand toggle when it changes.
  useEffect(() => { setCollapsed(collapseDefault); }, [collapseDefault]);

  const phones = [
    { num: l.phone1, type: l.phone1Type },
    { num: l.phone2, type: l.phone2Type },
    { num: l.phone3, type: l.phone3Type },
    { num: l.phone4, type: l.phone4Type },
  ].filter((p) => p.num);
  const emails = [l.email, l.email2].filter(Boolean) as string[];

  const runTrace = async () => {
    if (tracing) return;
    setTracing(true);
    try {
      await onSkiptrace(l.id);
    } catch {
      /* toast handled upstream via refetch failure; keep the card usable */
    } finally {
      setTracing(false);
    }
  };

  const saveNotes = (val: string) => {
    setNotes(val);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      onUpdate(l.id, { callNotes: val }, { callNotes: val });
    }, 600);
  };

  const toggleDay = (day: string) => {
    const next = { ...(l.touchDays || {}), [day]: !l.touchDays?.[day] };
    const delta = next[day] ? 1 : -1;
    onUpdate(l.id, { touchDays: next }, { touchDays: next, totalTouches: Math.max(0, l.totalTouches + delta) });
  };

  // Whole-card click selects (like the tracker); ignore interactive elements.
  const onCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a,button,select,textarea,input,label')) return;
    onToggleSelect();
  };

  const parcelSub = l.parcelType === 'exact' ? `PID ${l.parcelId}` : 'search';

  // Signals: chip the ones worth seeing at a glance, count the rest.
  const signals = l.signals || [];
  const chipSignals = signals.filter((sg) => sg.severity !== 'info');
  const infoSignalCount = signals.length - chipSignals.length;
  // Equity is blank on purpose when the debt figure cannot be trusted; say so
  // rather than letting it read as missing data.
  const suppressedEquity = !l.debtFigureReliable && l.equityPct == null;
  const equityBlankReason = suppressedEquity
    ? 'Blank on purpose: the recorded principal on a reverse mortgage overstates the debt, so equity cannot be computed from it.'
    : undefined;

  const linkBtn = 'flex-1 min-w-[80px] flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 hover:border-primary-400 dark:hover:border-primary-500 transition-colors text-sm font-semibold text-gray-800 dark:text-gray-200';
  const linkSub = 'text-[10px] font-normal text-gray-400 dark:text-gray-500';

  return (
    <div
      onClick={onCardClick}
      className={`h-full bg-white dark:bg-gray-900 rounded-xl border overflow-hidden flex flex-col transition-shadow hover:shadow-md cursor-pointer ${
        l.doNotCall ? 'border-red-400 dark:border-red-500 ring-1 ring-red-400' : selected ? 'border-primary-500 ring-1 ring-primary-500' : 'border-gray-200 dark:border-gray-700'}`}
    >
      <div className={`h-1 flex-shrink-0 ${priBar}`} />
      <div className="p-4 flex flex-col gap-3 flex-1">

        {/* Header */}
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-start gap-2.5 min-w-0">
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
              className={`flex-shrink-0 w-[18px] h-[18px] mt-0.5 rounded border-[1.5px] flex items-center justify-center text-[11px] font-bold transition-colors ${
                selected ? 'bg-primary-600 border-primary-600 text-white' : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-transparent hover:border-primary-400'}`}
              title="Select"
            >✓</button>
            <div className="min-w-0">
              <div className="flex items-center min-w-0">
                <Link href={`/leads/${l.id}`} onClick={(e) => e.stopPropagation()} className="font-bold text-gray-900 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400 leading-tight truncate">
                  {l.address}
                </Link>
                <CopyBtn text={[l.address, l.city, l.zip].filter(Boolean).join(', ')} label="address" />
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {[l.city, l.zip].filter(Boolean).join(', ') || '-'}
              </div>
            </div>
          </div>
          <div className={`flex-shrink-0 w-11 h-11 rounded-lg border flex flex-col items-center justify-center font-bold ${scoreClass(l.score)}`}>
            <span className="text-base leading-none">{l.score}</span>
            <span className="text-[8px] uppercase tracking-wide opacity-70">score</span>
          </div>
        </div>

        {/* Tags */}
        <div className="flex gap-1.5 flex-wrap">
          <Tag cls={priorityClass(l.priority)}>{l.priority}</Tag>
          {l.noticeType && <Tag cls="bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">{noticeLabel(l.noticeType)}</Tag>}
          {l.equityPct != null && (
            <Tag cls={l.equityPct >= 0 ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'}>
              {l.equityPct >= 0 ? '▲' : '▼'} {l.equityPct}% equity
            </Tag>
          )}
          {l.ownerOccupied === 'N' && <Tag cls="bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">Absentee owner</Tag>}
          {l.ownerOccupied === 'Y' && <Tag cls="bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">Owner-occupied</Tag>}
          {/* Signals ride the existing tag row. critical/notable get their own
              chip; info-level collapse into a count so the row cannot crowd. */}
          {chipSignals.map((sig) => (
            <SignalChip key={sig.id} signal={sig} onOpen={() => setShowSignals(true)} />
          ))}
          {infoSignalCount > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowSignals(true); }}
              title="More signals"
              className="text-[11px] px-2 py-0.5 rounded font-semibold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              +{infoSignalCount}
            </button>
          )}
        </div>

        {/* Owner */}
        <div>
          <SectionLabel>Owner</SectionLabel>
          <div className="text-sm text-gray-800 dark:text-gray-200 mt-0.5 flex items-start">
            <span className="min-w-0">{l.ownerNames || l.countyOwner || '-'}</span>
            {(l.ownerNames || l.countyOwner) && <CopyBtn text={l.ownerNames || l.countyOwner || ''} label="name" />}
          </div>
        </div>

        {/* Contact */}
        <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 px-3 py-2 flex flex-col gap-1.5 justify-center">
          {(phones.length || emails.length) ? (
            <>
              {phones.map((p, i) => (
                <div key={i} className="flex items-center text-sm">
                  <span className="w-5 text-gray-400 dark:text-gray-500">☎</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); dial(p.num!); }}
                    disabled={l.doNotCall}
                    title={l.doNotCall ? 'Do Not Call is on for this lead' : 'Call with the Dealcore dialer'}
                    className="text-gray-800 dark:text-gray-200 hover:text-primary-600 dark:hover:text-primary-400 disabled:text-gray-400 disabled:cursor-not-allowed disabled:hover:text-gray-400"
                  >
                    {formatPhoneDisplay(p.num!)}
                  </button>
                  <CopyBtn text={p.num!} label="number" />
                  {p.type && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">{p.type}</span>}
                </div>
              ))}
              {emails.map((em, i) => (
                <div key={i} className="flex items-center text-sm min-w-0">
                  <span className="w-5 text-gray-400 dark:text-gray-500">✉</span>
                  <a href={`mailto:${em}`} onClick={(e) => e.stopPropagation()} className="text-gray-800 dark:text-gray-200 hover:text-primary-600 dark:hover:text-primary-400 truncate">{em}</a>
                  <CopyBtn text={em} label="email" />
                </div>
              ))}
            </>
          ) : (
            <div className="text-sm text-gray-400 dark:text-gray-500 italic">No phone or email on file</div>
          )}
          <div className="flex justify-end gap-2 pt-0.5">
            <button
              onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              title="Edit owner name, phones, and emails"
              className="text-[11px] px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:border-primary-400 transition-colors"
            >
              ✎ Edit
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); runTrace(); }}
              disabled={tracing}
              title="Look up owner, parcel, and phones again (NC OneMap + BatchData)"
              className="text-[11px] px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:border-primary-400 transition-colors disabled:opacity-60"
            >
              {tracing ? 'Tracing...' : '↻ Skip trace'}
            </button>
          </div>
        </div>

        {/* Links */}
        <div className="flex gap-2">
          {l.zillowUrl && (
            <a href={l.zillowUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={linkBtn}>
              <span>🏠 Zillow</span><span className={linkSub}>listing</span>
            </a>
          )}
          {l.realtorQuery && (
            <button onClick={(e) => { e.stopPropagation(); openRealtor(l); }} className={linkBtn}>
              <span>🔑 Realtor</span><span className={linkSub}>listing</span>
            </button>
          )}
          <a href={parcelHref(l)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={linkBtn}>
            <span>📍 Property</span><span className={linkSub}>{parcelSub}</span>
          </a>
        </div>

        {/* Tracking */}
        <div className="border-t border-gray-100 dark:border-gray-800 pt-3 flex flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <SectionLabel className="mb-1">Status</SectionLabel>
              <select
                value={l.workStatus}
                onChange={(e) => onUpdate(l.id, { workStatus: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                className="input py-1.5 text-sm w-full"
              >
                {WORK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none mt-4">
              <input
                type="checkbox"
                checked={l.doNotCall}
                onChange={() => onUpdate(l.id, { doNotCall: !l.doNotCall })}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500"
              />
              Do Not Call
            </label>
          </div>

          {!collapsed && (
            <>
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <SectionLabel className="mb-1">Contacted this week</SectionLabel>
                  <div className="flex gap-1.5">
                    {DAYS.map((d, i) => (
                      <button key={d} onClick={() => toggleDay(d)} className="flex flex-col items-center gap-0.5 group">
                        <span className={`w-6 h-6 rounded border flex items-center justify-center text-[11px] font-bold transition-colors ${
                          l.touchDays?.[d]
                            ? 'bg-primary-600 border-primary-600 text-white'
                            : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-transparent group-hover:border-primary-400'}`}>✓</span>
                        <span className="text-[9px] text-gray-400 dark:text-gray-500">{DAY_LABELS[i]}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ml-auto text-xs text-gray-500 dark:text-gray-400 pb-1">
                  Total touches: <b className="text-gray-800 dark:text-gray-200">{l.totalTouches}</b>
                </div>
              </div>

              <textarea
                value={notes}
                onChange={(e) => saveNotes(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Call notes, reminders..."
                rows={2}
                className="input text-sm resize-none h-[52px]"
              />
            </>
          )}

          {/* Collapse / expand the details below the status row */}
          <button
            onClick={(e) => { e.stopPropagation(); setCollapsed((v) => !v); }}
            className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-primary-600 dark:hover:text-primary-400 self-center mt-0.5"
          >
            {collapsed ? '▾ Show details' : '▴ Hide details'}
          </button>
        </div>

        {/* Facts grid */}
        {!collapsed && (
          <div className="grid grid-cols-2 border-t border-gray-100 dark:border-gray-800 -mx-4 -mb-4 mt-auto divide-x divide-y divide-gray-100 dark:divide-gray-800">
            <div className="px-4 py-2.5">
              <SectionLabel>Sale date</SectionLabel>
              <div className={`text-sm font-semibold mt-0.5 ${db.cls || 'text-gray-800 dark:text-gray-200'}`}>{fmtDateUS(l.saleDate)}</div>
            </div>
            <div className="px-4 py-2.5">
              <SectionLabel>{l.daysToSale != null && l.daysToSale <= 30 ? 'Countdown' : 'Timing'}</SectionLabel>
              <div className={`text-sm font-semibold mt-0.5 ${db.cls || 'text-gray-800 dark:text-gray-200'}`}>{db.text}</div>
            </div>
            <div className="px-4 py-2.5">
              <SectionLabel>Assessed value</SectionLabel>
              <div className="text-sm font-semibold mt-0.5 text-gray-800 dark:text-gray-200">{money(l.assessedValue)}</div>
            </div>
            <div className="px-4 py-2.5">
              <SectionLabel>Loan amount</SectionLabel>
              <div className="text-sm font-semibold mt-0.5 text-gray-800 dark:text-gray-200">
                {money(l.loanAmount)}
                {!l.debtFigureReliable && (
                  <span
                    title="Recorded principal on a reverse mortgage is a multiple of the maximum claim amount, so it overstates the debt. Not used for equity."
                    className="ml-1 text-amber-600 dark:text-amber-400 cursor-help"
                  >⚠</span>
                )}
              </div>
            </div>
            <div className="px-4 py-2.5" title={equityBlankReason}>
              <SectionLabel>Equity spread</SectionLabel>
              <div className={`text-sm font-semibold mt-0.5 ${l.equitySpread == null ? 'text-gray-800 dark:text-gray-200' : l.equitySpread >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {signedMoney(l.equitySpread)}
                {suppressedEquity && <span className="ml-1 text-amber-600 dark:text-amber-400 cursor-help">⚠</span>}
              </div>
            </div>
            <div className="px-4 py-2.5" title={equityBlankReason}>
              <SectionLabel>Est. equity %</SectionLabel>
              <div className="text-sm font-semibold mt-0.5 text-gray-800 dark:text-gray-200">
                {l.equityPct == null ? '-' : `${l.equityPct}%`}
                {suppressedEquity && <span className="ml-1 text-amber-600 dark:text-amber-400 cursor-help">⚠</span>}
              </div>
            </div>
          </div>
        )}
      </div>

      {showSignals && (
        <SignalModal
          lead={l}
          onClose={() => setShowSignals(false)}
          onToggleAction={onToggleAction}
        />
      )}

      {editing && (
        <ContactEditModal
          lead={l}
          onClose={() => setEditing(false)}
          onSave={(patch, local) => { onUpdate(l.id, patch, local); setEditing(false); }}
        />
      )}
    </div>
  );
}

// ─── Signal detail modal ─────────────────────────────────────────────────────
// Evidence is the field names the signal rests on; actions are suggestions the
// user ticks off. Nothing here contacts anyone - ticking records what was done.
function SignalModal({ lead, onClose, onToggleAction }: {
  lead: FclLead;
  onClose: () => void;
  onToggleAction: (signalId: string, action: string, completed: boolean) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl w-full max-w-lg p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900 dark:text-gray-100">Signals</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none">✕</button>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 -mt-2">{lead.address}</div>

        {lead.signals.length === 0 && (
          <div className="text-sm text-gray-400 dark:text-gray-500 italic">
            No signals on this filing. Nothing unusual was found.
          </div>
        )}

        {lead.signals.map((sig) => (
          <div key={sig.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide flex-shrink-0 mt-0.5 ${severityClass(sig.severity)}`}>
                {sig.severity}
              </span>
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{sig.headline}</span>
            </div>

            <div>
              <SectionLabel>Based on</SectionLabel>
              <div className="flex gap-1 flex-wrap mt-1">
                {sig.evidence.map((f) => (
                  <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                    {evidenceLabel(f)}
                  </span>
                ))}
              </div>
            </div>

            {sig.recommendedActions.length > 0 && (
              <div>
                <SectionLabel>Suggested next steps</SectionLabel>
                <div className="flex flex-col gap-1 mt-1">
                  {sig.recommendedActions.map((a) => {
                    const done = sig.completedActions.includes(a);
                    return (
                      <label key={a} className="flex items-start gap-2 text-sm cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={done}
                          onChange={() => onToggleAction(sig.id, a, !done)}
                          className="w-4 h-4 mt-0.5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 flex-shrink-0"
                        />
                        <span className={done ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-700 dark:text-gray-300'}>
                          {actionLabel(a)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}

        <div className="text-[11px] text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800 pt-3">
          Suggestions only. Ticking a step records that you did it - nothing here sends a message.
        </div>
      </div>
    </div>
  );
}

// ─── Contact edit modal ───────────────────────────────────────────────────────
function ContactEditModal({ lead: l, onClose, onSave }: {
  lead: FclLead;
  onClose: () => void;
  onSave: (patch: any, local: any) => void;
}) {
  const [owner, setOwner] = useState(l.ownerNames || '');
  const [rows, setRows] = useState([
    { num: l.phone1 || '', type: l.phone1Type || '' },
    { num: l.phone2 || '', type: l.phone2Type || '' },
    { num: l.phone3 || '', type: l.phone3Type || '' },
    { num: l.phone4 || '', type: l.phone4Type || '' },
  ]);
  const [email1, setEmail1] = useState(l.email || '');
  const [email2, setEmail2] = useState(l.email2 || '');

  const setRow = (i: number, key: 'num' | 'type', val: string) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));

  const digits = (v: string) => v.replace(/\D/g, '').slice(-10);

  const save = () => {
    const patch: any = {
      ownerNames: owner.trim(),
      email: email1.trim(),
      email2: email2.trim(),
    };
    rows.forEach((r, i) => {
      patch[`phone${i + 1}`] = r.num ? digits(r.num) : '';
      patch[`phone${i + 1}Type`] = r.type || null;
    });
    // Local mirror so the card updates instantly (dto field names match).
    const local: any = {
      ownerNames: patch.ownerNames,
      email: patch.email || null,
      email2: patch.email2 || null,
      phone1: patch.phone1 || null, phone1Type: patch.phone1Type,
      phone2: patch.phone2 || null, phone2Type: patch.phone2Type,
      phone3: patch.phone3 || null, phone3Type: patch.phone3Type,
      phone4: patch.phone4 || null, phone4Type: patch.phone4Type,
    };
    onSave(patch, local);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl w-full max-w-md p-5 flex flex-col gap-3 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900 dark:text-gray-100">Edit contact</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none">✕</button>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 -mt-1">{l.address}</div>

        <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Owner name</label>
        <input value={owner} onChange={(e) => setOwner(e.target.value)} className="input text-sm" placeholder="First Last" />

        <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-1">Phones</label>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input value={r.num} onChange={(e) => setRow(i, 'num', e.target.value)} className="input text-sm flex-1" placeholder={`Phone ${i + 1}`} />
            <select value={r.type} onChange={(e) => setRow(i, 'type', e.target.value)} className="input text-sm w-28">
              <option value="">Type</option>
              <option value="Mobile">Mobile</option>
              <option value="Landline">Landline</option>
            </select>
          </div>
        ))}

        <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-1">Emails</label>
        <input value={email1} onChange={(e) => setEmail1(e.target.value)} className="input text-sm" placeholder="Email 1" />
        <input value={email2} onChange={(e) => setEmail2(e.target.value)} className="input text-sm" placeholder="Email 2" />

        <div className="flex justify-end gap-2 mt-2">
          <button onClick={onClose} className="btn btn-secondary btn-sm">Cancel</button>
          <button onClick={save} className="btn btn-primary btn-sm">Save</button>
        </div>
      </div>
    </div>
  );
}
