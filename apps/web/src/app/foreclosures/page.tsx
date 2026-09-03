'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import PipelineBoard, {
  type PipelineView,
  type PipelineColumn,
  type PipelineStage,
} from '@/components/pipelines/PipelineBoard';
import PipelineWorkPanel from '@/components/pipelines/PipelineWorkPanel';
import ForeclosureCard, { FCL_ACCENT } from '@/components/pipelines/ForeclosureCard';
import ForeclosureDetail from '@/components/pipelines/ForeclosureDetail';
import { CHIP, PRIORITY , agoLabel, agoDays } from '@/components/pipelines/format';
import '@/components/pipelines/pipeline-board.css';
import Link from 'next/link';
import { foreclosuresAPI } from '@/lib/api';
import { formatPhoneDisplay } from '@/lib/format';
import { writeLeadQueue } from '@/lib/leadQueue';
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

/** One recorded pull of the Mecklenburg Times feed, cron or manual. */
interface PollRun {
  at: string;
  trigger: string;
  ok: boolean;
  scanned: number;
  created: number;
  skipped: number;
  pastDated: number;
  errors: number;
  message: string | null;
  /** The run filed leads under a different org, so they are invisible here. */
  orgMismatch: boolean;
}

interface Stats {
  total: number;
  high: number;
  soon: number;
  highEquity: number;
  lastPoll: PollRun | null;
  lastCronPoll: PollRun | null;
  /** False when the daily Mecklenburg Times pull is switched off. */
  rssPollEnabled: boolean;
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
/** Parcel link: a known parcel id uses the stored link (a Mecklenburg deep
 *  link when we have one, otherwise a search carrying the id); everything else
 *  gets a Google parcel-records search on the address, since county GIS
 *  homepages cannot deep link one. */
function parcelHref(l: FclLead): string {
  if ((l.parcelType === 'exact' || l.parcelType === 'county') && l.parcelUrl) return l.parcelUrl;
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

/**
 * Why the recorded debt figure is not used for equity. Two loan types suppress
 * it for opposite reasons - a reverse mortgage records far MORE than is owed, an
 * HOA lien records far less than stands against the property - so the note has
 * to say which, or it tells the user the wrong thing half the time.
 */
function debtFigureNote(loanType: string | null): { figure: string; blank: string } {
  if (loanType === 'HOA_ASSESSMENT') {
    return {
      figure: 'This is the HOA lien only. The first mortgage is senior to it and survives the association sale, so it is not the debt against the property. Not used for equity.',
      blank: 'Blank on purpose: an HOA lien excludes the senior mortgage, so equity cannot be computed from it. Pull the mortgage payoff before bidding.',
    };
  }
  if (loanType === 'REVERSE_HECM') {
    return {
      figure: 'Recorded principal on a reverse mortgage is a multiple of the maximum claim amount, so it overstates the debt. Not used for equity.',
      blank: 'Blank on purpose: the recorded principal on a reverse mortgage overstates the debt, so equity cannot be computed from it.',
    };
  }
  return {
    figure: 'The recorded debt figure cannot be relied on for this filing. Not used for equity.',
    blank: 'Blank on purpose: the recorded debt figure cannot support the equity calculation.',
  };
}

/** "3 hours ago" / "2 days ago", coarse on purpose. */
function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!isFinite(mins)) return 'unknown';
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// The poll runs daily, so a healthy cron is never much older than a day.
// 36 hours leaves room for a deploy or a slow run without crying wolf.
const CRON_STALE_HOURS = 36;

/**
 * When the feed was last pulled, and whether the daily cron is actually doing
 * it. A manual Refresh always succeeds on demand, so "notices are arriving"
 * is not evidence the schedule is alive - the cron line is tracked separately
 * for that reason.
 */
function FeedStatus({
  lastPoll,
  lastCronPoll,
  scheduleEnabled,
}: {
  lastPoll: PollRun | null;
  lastCronPoll: PollRun | null;
  /** False once the daily pull is switched off, which it is by default. */
  scheduleEnabled: boolean;
}) {
  const cronAgeHours = lastCronPoll
    ? (Date.now() - new Date(lastCronPoll.at).getTime()) / 3600000
    : Infinity;

  let warning: string | null = null;
  // With the schedule off, a stale or missing cron run is the expected state,
  // not a fault. Warning about it forever would train everyone to ignore the
  // one line that exists to catch a genuinely broken feed.
  if (!scheduleEnabled) {
    warning = null;
  } else if (!lastCronPoll) {
    warning = 'The daily 6:30am pull has never run. Notices only arrive when someone clicks Refresh feed.';
  } else if (!lastCronPoll.ok) {
    warning = `The last daily pull failed${lastCronPoll.message ? `: ${lastCronPoll.message}` : '.'}`;
  } else if (cronAgeHours > CRON_STALE_HOURS) {
    warning = `The daily pull last ran ${timeAgo(lastCronPoll.at)}. It should run every morning at 6:30.`;
  } else if (lastCronPoll.orgMismatch) {
    warning = 'The daily pull is filing notices under a different organization, so they will not appear here. Check FORECLOSURE_DEFAULT_ORG_ID.';
  }

  return (
    <div className="mb-4 text-xs">
      <div className="text-gray-500 dark:text-gray-400">
        {lastPoll ? (
          <>
            Feed last pulled <span className="font-medium text-gray-700 dark:text-gray-300">{timeAgo(lastPoll.at)}</span>
            {' '}({lastPoll.trigger === 'cron' ? 'scheduled' : 'manual'}):{' '}
            {lastPoll.scanned} scanned, {lastPoll.created} new, {lastPoll.skipped} existing, {lastPoll.pastDated} past-dated
          </>
        ) : (
          'Feed has not been pulled yet.'
        )}
        {/* Say the schedule is off rather than leaving people to infer it from
            a pull that keeps getting older. */}
        {!scheduleEnabled && (
          <span> &middot; the daily pull is switched off, use Refresh feed</span>
        )}
      </div>
      {warning && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1.5 text-amber-800 dark:text-amber-300">
          <span aria-hidden>⚠</span>
          <span>{warning}</span>
        </div>
      )}
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
/**
 * The table, in the order a foreclosure is triaged: how long until the sale,
 * how much equity is behind it, whose is it, can we reach them. The deadline
 * leads because after the sale there is nothing to buy.
 */
const FCL_COLUMNS: PipelineColumn<any>[] = [
  {
    key: 'priority',
    label: 'Priority',
    width: '110px',
    sortValue: (l) => l.score ?? 0,
    render: (l) => {
      const p: any = PRIORITY[l.priority] || CHIP.slate;
      return (
        <span className="dc-tag" style={{ background: p.bg, color: p.fg }}>
          {p.label || l.priority}
        </span>
      );
    },
  },
  {
    key: 'sale',
    label: 'Days to sale',
    align: 'right',
    width: '115px',
    // Soonest first. A past sale sorts to the bottom: there is nothing to buy.
    sortValue: (l) => (l.daysToSale == null ? 9999 : l.daysToSale < 0 ? 9998 : l.daysToSale),
    render: (l) =>
      l.daysToSale == null ? (
        <span style={{ color: 'var(--faint)' }}>no date</span>
      ) : l.daysToSale < 0 ? (
        <span style={{ color: 'var(--faint)' }}>{Math.abs(l.daysToSale)}d past</span>
      ) : (
        <span style={{ color: l.daysToSale <= 14 ? 'var(--red)' : 'var(--dim)', fontWeight: 600 }}>
          {l.daysToSale}d
        </span>
      ),
  },
  {
    key: 'equity',
    label: 'Equity',
    align: 'right',
    width: '120px',
    sortValue: (l) => (l.debtFigureReliable ? l.equitySpread ?? 0 : -1),
    render: (l) =>
      // Blank on purpose where the rules engine will not stand behind the debt
      // figure. Printing a number here would invent one.
      l.debtFigureReliable && l.equitySpread != null ? (
        <b style={{ color: 'var(--mint)' }}>{money(l.equitySpread)}</b>
      ) : (
        <span style={{ color: 'var(--amber)', fontSize: 12 }}>not computed</span>
      ),
  },
  {
    key: 'property',
    label: 'Property',
    sortValue: (l) => l.address || '',
    render: (l) => (
      <div>
        <div style={{ fontWeight: 600 }}>{l.address}</div>
        <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
          {[l.city, l.zip].filter(Boolean).join(' ')} · {l.county}
          {l.caseNumber ? ` · ${l.caseNumber}` : ''}
        </div>
      </div>
    ),
  },
  { key: 'owner', label: 'Owner', sortValue: (l) => l.ownerNames || '', render: (l) => l.ownerNames },
  {
    key: 'signals',
    label: 'Signals',
    width: '90px',
    sortValue: (l) => (l.signals || []).filter((s: any) => s.severity === 'critical').length,
    render: (l) => {
      const crit = (l.signals || []).filter((s: any) => s.severity === 'critical').length;
      return crit ? (
        <span style={{ color: 'var(--red)', fontSize: 12, fontWeight: 600 }}>{crit} critical</span>
      ) : (
        <span style={{ color: 'var(--faint)', fontSize: 12 }}>{(l.signals || []).length}</span>
      );
    },
  },
  {
    // The record of what actually went out: every call placed, text and email,
    // written by the channel that sent it. Distinct from the weekly touch-day
    // boxes, which are a plan rather than a log.
    key: 'touches',
    label: 'Touches',
    align: 'right',
    width: '112px',
    nowrap: true,
    // Most neglected first, so the column answers "who has nobody been calling".
    sortValue: (r) => -agoDays(r.lastTouchedAt),
    // One line, not a stack. Two short values stacked set the row height for
    // every other cell in the table and read as a wrap rather than a design.
    render: (r) => (
      <span style={{ fontSize: 12, color: r.touches ? 'var(--text)' : 'var(--faint)' }}>
        <b>{r.touches || 0}</b>
        <span style={{ color: 'var(--faint)' }}> · {agoLabel(r.lastTouchedAt)}</span>
      </span>
    ),
  },
  {
    key: 'contact',
    label: 'Reach',
    width: '115px',
    sortValue: (l) => (l.doNotCall ? -1 : l.phone1 ? 1 : 0),
    render: (l) =>
      l.doNotCall ? (
        <span style={{ color: 'var(--red)', fontSize: 12 }}>do not call</span>
      ) : l.phone1 ? (
        <span style={{ color: 'var(--mint)', fontSize: 12 }}>☏ on file</span>
      ) : (
        <span style={{ color: 'var(--faint)', fontSize: 12 }}>no number</span>
      ),
  },
];

const FCL_KANBAN: PipelineStage[] = WORK_STATUSES.map((s) => ({ key: s.value, label: s.label }));

export default function ForeclosuresPage() {
  const [leads, setLeads] = useState<FclLead[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [counties, setCounties] = useState<string[]>([]);
  const [collapseAll, setCollapseAll] = useState(false);
  const [stats, setStats] = useState<Stats>({ total: 0, high: 0, soon: 0, highEquity: 0, lastPoll: null, lastCronPoll: null, rssPollEnabled: false });
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 60, total: 0, totalPages: 1 });
  // Filters the cards were last loaded with, replayed against /ids so the
  // detail page's prev/next walks this whole filtered set and not one page.
  const [queueParams, setQueueParams] = useState<Record<string, string> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Table by default: a long docket is scanned before any of it is worked. */
  const [view, setView] = useState<PipelineView>('table');
  const [openId, setOpenId] = useState<string | null>(null);

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

  const openLead = openId ? leads.find((l) => l.id === openId) || null : null;
  /**
   * Step through the filtered list from inside the panel.
   *
   * Indexed off the SAME array the board renders, so the arrows follow whatever
   * filter and sort is on screen rather than some separate order. Null at the
   * ends instead of wrapping, which is what disables the button and makes the
   * end of the list visible.
   */
  const openIndex = leads.findIndex((l) => l.id === openId);
  const goTo = (i: number) => setOpenId(leads[i] ? (leads[i] as any).id : null);


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
      setQueueParams(params);
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

  /**
   * Mark every checked lead Dead. Deliberately not a delete: a dead
   * foreclosure is still a record of a notice we saw, and deleting it would
   * let the next ingest re-create it as new.
   */
  const handleStatusSelected = async (status: string, label: string) => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setBusy(true);
    try {
      const res = await foreclosuresAPI.bulkStatus(ids, status);
      showToast(`${label} ${res.data.updated} lead${res.data.updated === 1 ? '' : 's'}.`);
      setSelected(new Set());
      fetchLeads();
      fetchStats();
    } catch (e: any) {
      showToast(e.response?.data?.message || `${label} failed`, true);
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

  // Hand the lead detail page the full filtered set. Fetched as ids rather
  // than reused from `leads`, which only ever holds the current page - that is
  // why the counter used to read "16 of 50" against 97 matching leads.
  useEffect(() => {
    if (!queueParams || loading) return;
    let cancelled = false;
    (async () => {
      try {
        const { page: _p, pageSize: _s, ...rest } = queueParams;
        const res = await foreclosuresAPI.ids(rest);
        const ids: string[] = res.data?.ids || [];
        if (cancelled || !ids.length) return;
        writeLeadQueue({
          ids,
          label: anyFilter ? 'Filtered foreclosures' : 'Foreclosures',
          returnUrl: `${window.location.pathname}${window.location.search}`,
        });
      } catch {
        // Non-fatal: without a queue the detail page simply hides prev/next.
      }
    })();
    return () => { cancelled = true; };
  }, [queueParams, loading, anyFilter]);
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

        <FeedStatus
          lastPoll={stats.lastPoll}
          lastCronPoll={stats.lastCronPoll}
          scheduleEnabled={stats.rssPollEnabled !== false}
        />

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

        {/* Wrapped in .dc-board so the shared board's colour tokens resolve. */}
        <div className="dc-board">
          <PipelineBoard
            rows={leads}
            keyOf={(l) => l.id}
            columns={FCL_COLUMNS}
            stages={FCL_KANBAN}
            stageOf={(l) => l.workStatus || 'NOT_CONTACTED'}
            onStageChange={(l, workStatus) => updateLead(l.id, { workStatus })}
            view={view}
            onViewChange={setView}
            selected={Object.fromEntries([...selected].map((k) => [k, true]))}
            onSelect={(k, on) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (on) next.add(k);
                else next.delete(k);
                return next;
              })
            }
            onSelectAll={(on) => setSelected(on ? new Set(leads.map((l) => l.id)) : new Set())}
            onOpen={(l) => setOpenId(l.id)}
            accentOf={(l) => FCL_ACCENT[l.priority] || 'var(--border2)'}
            loading={loading}
            renderCard={(l) => (
              <ForeclosureCard
                l={l}
                picked={selected.has(l.id)}
                onPick={(on) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(l.id);
                    else next.delete(l.id);
                    return next;
                  })
                }
                onOpen={() => setOpenId(l.id)}
              />
            )}
            empty="No foreclosure leads found. Import the tracker sheet, upload an eCourts PDF, refresh the feed, or clear filters."
            toolbarLeft={
              <span>
                {pagination.total.toLocaleString()} lead{pagination.total === 1 ? '' : 's'}
                {selected.size > 0 && (
                  <>
                    {' '}· <b style={{ color: 'var(--mint)' }}>{selected.size} selected</b>
                  </>
                )}
              </span>
            }
            /* Selection actions sit in the board toolbar, beside the count they
               act on, the same as every other pipeline. They used to be a fixed
               bar pinned to the bottom of the viewport, which floated over the
               rows and put the controls nowhere near the checkboxes. */
            toolbarRight={
              <>
                {selected.size > 0 && (
                  <>
                    <button className="dc-btn sm" disabled={busy} onClick={handleSkiptraceSelected}>
                      Skip trace
                    </button>
                    <button
                      className="dc-btn sm dngr"
                      disabled={busy}
                      onClick={() => handleStatusSelected('DEAD', 'Marked dead')}
                    >
                      Mark dead
                    </button>
                  </>
                )}
                <button
                  style={{ color: 'var(--mint)', fontWeight: 600, fontSize: 13 }}
                  onClick={() => downloadCsv(selected.size ? selectedLeads : leads)}
                >
                  Download {selected.size ? 'selected' : 'shown'} as CSV
                </button>
              </>
            }
          />
        </div>

        {openLead && (
          <PipelineWorkPanel
            onPrev={openIndex > 0 ? () => goTo(openIndex - 1) : null}
            onNext={openIndex >= 0 && openIndex < leads.length - 1 ? () => goTo(openIndex + 1) : null}
            position={openIndex >= 0 ? { index: openIndex, total: leads.length } : null}
            title={openLead.address}
            subtitle={`${[openLead.city, openLead.zip].filter(Boolean).join(' ')}${
              openLead.daysToSale != null
                ? openLead.daysToSale < 0
                  ? ` · sold ${Math.abs(openLead.daysToSale)} days ago`
                  : ` · ${openLead.daysToSale} days to sale`
                : ''
            }`}
            meta={`${openLead.county} County${openLead.caseNumber ? ` · ${openLead.caseNumber}` : ''}`}
            detail={<ForeclosureDetail l={openLead} />}
            subjects={[
              {
                leadId: openLead.id,
                name: openLead.ownerNames || 'Owner',
                phones: [
                  { number: openLead.phone1, type: openLead.phone1Type },
                  { number: openLead.phone2, type: openLead.phone2Type },
                  { number: openLead.phone3, type: openLead.phone3Type },
                  { number: openLead.phone4, type: openLead.phone4Type },
                ].filter((p) => p.number) as any,
                emails: [openLead.email, openLead.email2].filter(Boolean) as string[],
              },
            ]}
            onClose={() => setOpenId(null)}
            onChanged={fetchLeads}
            say={() => {}}
          />
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
