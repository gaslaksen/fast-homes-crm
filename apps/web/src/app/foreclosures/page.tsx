'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { foreclosuresAPI } from '@/lib/api';
import { formatPhoneDisplay } from '@/lib/format';
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
  phone1: string | null;
  phone2: string | null;
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
  ownerOccupied: string | null;
  mailingAddress: string | null;
  skipStatus: string | null;
  parcelUrl: string | null;
  parcelLabel: string | null;
  zillowUrl: string | null;
  realtorQuery: string | null;
  daysToSale: number | null;
}

const WORK_STATUSES = [
  { value: 'NOT_CONTACTED', label: 'Not Contacted' },
  { value: 'IN_CONVERSATION', label: 'In Conversation' },
  { value: 'APPOINTMENT_SET', label: 'Appointment Set' },
  { value: 'UNDER_CONTRACT', label: 'Under Contract' },
  { value: 'DEAD', label: 'Dead' },
];

const NOTICE_TYPES = [
  { value: '', label: 'All notices' },
  { value: 'mortgage_foreclosure', label: 'Mortgage Foreclosure' },
  { value: 'hoa_lien', label: 'HOA / Lien' },
  { value: 'tax_foreclosure', label: 'Tax Foreclosure' },
  { value: 'sheriff_sale', label: 'Sheriff Sale' },
  { value: 'pre_foreclosure_hearing', label: 'Pre-Foreclosure Hearing' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────
function money(n: number | null): string {
  return n == null ? '-' : `$${Math.round(n).toLocaleString()}`;
}
function noticeLabel(t: string | null): string {
  return (t || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function scoreClass(s: number): string {
  if (s >= 65) return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800';
  if (s >= 40) return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800';
  return 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700';
}
function priorityClass(p: string): string {
  if (p === 'HIGH') return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
  if (p === 'MEDIUM') return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
  return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';
}
function daysBadge(d: number | null): { text: string; cls: string } | null {
  if (d == null) return null;
  if (d < 0) return { text: 'Sale passed', cls: 'bg-gray-100 dark:bg-gray-800 text-gray-500' };
  if (d === 0) return { text: 'Sale today', cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' };
  if (d <= 7) return { text: `${d}d to sale`, cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' };
  if (d <= 21) return { text: `${d}d to sale`, cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' };
  return { text: `${d}d to sale`, cls: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400' };
}
function realtorUrl(l: FclLead): string {
  if (!l.realtorQuery) return '';
  return `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(String(l.zip || '').replace(/\s+/g, '-'))}`;
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

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ForeclosuresPage() {
  const [leads, setLeads] = useState<FclLead[]>([]);
  const [stats, setStats] = useState({ total: 0, high: 0, soon: 0, highEquity: 0 });
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 60, total: 0, totalPages: 1 });

  // Filters
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('');
  const [noticeType, setNoticeType] = useState('');
  const [occupancy, setOccupancy] = useState('');
  const [equityMin, setEquityMin] = useState('');
  const [saleWithinDays, setSaleWithinDays] = useState('');
  const [sort, setSort] = useState('sale');
  const [page, setPage] = useState(1);

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
      if (priority) params.priority = priority;
      if (noticeType) params.noticeType = noticeType;
      if (occupancy) params.occupancy = occupancy;
      if (equityMin) params.equityMin = equityMin;
      if (saleWithinDays) params.saleWithinDays = saleWithinDays;
      const res = await foreclosuresAPI.list(params);
      setLeads(res.data.leads || []);
      setPagination(res.data.pagination || { page: 1, pageSize: 60, total: 0, totalPages: 1 });
    } catch (e: any) {
      if (e.name !== 'CanceledError') showToast('Failed to load foreclosures', true);
    } finally {
      setLoading(false);
    }
  }, [search, priority, noticeType, occupancy, equityMin, saleWithinDays, sort, page]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await foreclosuresAPI.stats();
      setStats(res.data);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(fetchLeads, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchLeads, search]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Reset to page 1 when a filter changes.
  useEffect(() => {
    setPage(1);
  }, [search, priority, noticeType, occupancy, equityMin, saleWithinDays, sort]);

  const updateLead = async (id: string, patch: any) => {
    // Optimistic update
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    try {
      await foreclosuresAPI.update(id, patch);
    } catch {
      showToast('Update failed', true);
      fetchLeads();
    }
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
    setPriority('');
    setNoticeType('');
    setOccupancy('');
    setEquityMin('');
    setSaleWithinDays('');
  };

  const anyFilter = search || priority || noticeType || occupancy || equityMin || saleWithinDays;

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
          <StatCard label="High equity (40%+)" value={stats.highEquity} accent="text-green-600 dark:text-green-400" />
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex gap-2 flex-wrap items-center">
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
            <select value={noticeType} onChange={(e) => setNoticeType(e.target.value)} className="input w-auto">
              {NOTICE_TYPES.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
            </select>
            <select value={equityMin} onChange={(e) => setEquityMin(e.target.value)} className="input w-auto">
              <option value="">Any equity</option>
              <option value="20">Equity 20%+</option>
              <option value="40">Equity 40%+</option>
              <option value="50">Equity 50%+</option>
            </select>
            <select value={saleWithinDays} onChange={(e) => setSaleWithinDays(e.target.value)} className="input w-auto">
              <option value="">Any sale date</option>
              <option value="7">Sale within 7d</option>
              <option value="14">Sale within 14d</option>
              <option value="30">Sale within 30d</option>
            </select>
            {anyFilter && (
              <button onClick={resetFilters} className="btn btn-secondary btn-sm">Reset</button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-[11px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Priority</span>
            {['HIGH', 'MEDIUM', 'LOW'].map((p) => (
              <Chip key={p} active={priority === p} onClick={() => setPriority(priority === p ? '' : p)}
                activeClass={p === 'HIGH' ? 'bg-red-600 text-white border-red-600' : p === 'MEDIUM' ? 'bg-amber-500 text-white border-amber-500' : 'bg-blue-600 text-white border-blue-600'}>
                {p.charAt(0) + p.slice(1).toLowerCase()}
              </Chip>
            ))}
            <span className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
            <span className="text-[11px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">Occupancy</span>
            <Chip active={occupancy === 'absentee'} onClick={() => setOccupancy(occupancy === 'absentee' ? '' : 'absentee')}>Absentee</Chip>
            <Chip active={occupancy === 'owner'} onClick={() => setOccupancy(occupancy === 'owner' ? '' : 'owner')}>Owner-occupied</Chip>
          </div>
        </div>

        {/* Count */}
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {loading ? 'Loading...' : `${pagination.total} lead${pagination.total === 1 ? '' : 's'}`}
        </div>

        {/* Grid */}
        {!loading && leads.length === 0 ? (
          <div className="text-center py-16 text-gray-500 dark:text-gray-400">
            <p className="text-lg font-medium">No foreclosure leads yet</p>
            <p className="text-sm mt-1">Import the tracker sheet, upload an eCourts PDF, or refresh the feed to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {leads.map((l) => (
              <LeadCard key={l.id} lead={l} onUpdate={updateLead} realtor={realtorUrl(l)} />
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

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm shadow-lg border ${
          toast.err ? 'bg-white dark:bg-gray-900 border-red-400 text-red-600 dark:text-red-400'
                    : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100'}`}>
          {toast.msg}
        </div>
      )}
    </AppShell>
  );
}

// ─── Lead card ────────────────────────────────────────────────────────────────
function LeadCard({ lead: l, onUpdate, realtor }: { lead: FclLead; onUpdate: (id: string, patch: any) => void; realtor: string }) {
  const db = daysBadge(l.daysToSale);
  const priBar = l.priority === 'HIGH' ? 'bg-red-500' : l.priority === 'MEDIUM' ? 'bg-amber-500' : 'bg-blue-500';
  return (
    <div className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col ${l.doNotCall ? 'ring-2 ring-red-400' : ''}`}>
      <div className={`h-1 ${priBar}`} />
      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Header */}
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <Link href={`/leads/${l.id}`} className="font-bold text-gray-900 dark:text-gray-100 hover:text-primary-600 leading-tight block truncate">
              {l.address}
            </Link>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {[l.city, l.state, l.zip].filter(Boolean).join(', ')}
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
          {db && <Tag cls={db.cls}>{db.text}</Tag>}
          {l.equityPct != null && (
            <Tag cls={l.equityPct >= 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}>
              {l.equityPct >= 0 ? '▲' : '▼'} {l.equityPct}% equity
            </Tag>
          )}
          {l.ownerOccupied === 'N' && <Tag cls="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">Absentee</Tag>}
        </div>

        {/* Owner + facts */}
        <div className="text-sm grid grid-cols-2 gap-y-1 gap-x-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Owner</div>
            <div className="text-gray-800 dark:text-gray-200 truncate">{l.ownerNames || l.countyOwner || '-'}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Case</div>
            <div className="text-gray-800 dark:text-gray-200 truncate">{l.caseNumber || '-'}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Sale date</div>
            <div className="text-gray-800 dark:text-gray-200">{l.saleDate || '-'}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Assessed</div>
            <div className="text-gray-800 dark:text-gray-200">{money(l.assessedValue)}</div>
          </div>
        </div>

        {/* Contact */}
        {(l.phone1 || l.phone2 || l.email) && (
          <div className="flex flex-col gap-1 text-sm border-t border-gray-100 dark:border-gray-800 pt-2">
            {l.phone1 && <a href={`tel:${l.phone1}`} className="text-primary-600 dark:text-primary-400 hover:underline">☎ {formatPhoneDisplay(l.phone1)}</a>}
            {l.phone2 && <a href={`tel:${l.phone2}`} className="text-primary-600 dark:text-primary-400 hover:underline">☎ {formatPhoneDisplay(l.phone2)}</a>}
            {l.email && <a href={`mailto:${l.email}`} className="text-primary-600 dark:text-primary-400 hover:underline truncate">✉ {l.email}</a>}
          </div>
        )}

        {/* Links */}
        <div className="flex gap-1.5 flex-wrap text-xs">
          {l.zillowUrl && <a href={l.zillowUrl} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200">Zillow</a>}
          {realtor && <a href={realtor} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200">Realtor</a>}
          {l.parcelUrl && <a href={l.parcelUrl} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200">{l.parcelLabel || 'Parcel'}</a>}
          {l.noticeUrl && <a href={l.noticeUrl} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200">Notice</a>}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-gray-100 dark:border-gray-800 pt-2 mt-auto">
          <select
            value={l.workStatus}
            onChange={(e) => onUpdate(l.id, { workStatus: e.target.value })}
            className="input py-1 text-xs flex-1"
          >
            {WORK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button
            onClick={() => onUpdate(l.id, { doNotCall: !l.doNotCall })}
            className={`px-2 py-1 rounded text-xs font-medium border ${
              l.doNotCall
                ? 'bg-red-600 text-white border-red-600'
                : 'bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
            }`}
            title="Do Not Call"
          >
            DNC
          </button>
        </div>
      </div>
    </div>
  );
}
