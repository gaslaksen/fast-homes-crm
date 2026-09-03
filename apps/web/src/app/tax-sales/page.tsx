'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from '@/components/AppShell';
import PipelineBoard, { type PipelineView, type PipelineColumn, type PipelineStage } from '@/components/pipelines/PipelineBoard';
import PipelineWorkPanel from '@/components/pipelines/PipelineWorkPanel';
import TaxSaleCard, { TAX_ACCENT } from '@/components/pipelines/TaxSaleCard';
import TaxSaleDetail from '@/components/pipelines/TaxSaleDetail';
import AddLeadSheet, { TAX_SALE_FIELDS } from '@/components/pipelines/AddLeadSheet';
import { taxSalesAPI } from '@/lib/api';
import '@/components/pipelines/pipeline-board.css';
import {
  DAYS,
  DNC_STATE,
  METHOD_LABEL,
  OCCUPANCY_LABEL,
  PRIORITY,
  TAG_COLOR,
  TAX_STAGE_COLOR,
  TAX_STAGE_LABEL,
  WORKUP_LABEL,
  WORK_STATUS_LABEL,
  ChipColor,
  CHIP,
  downloadCsv,
  fmtDate,
  money,
  phoneDisplay,
  agoLabel,
  agoDays,
} from '@/components/pipelines/format';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Phone {
  number: string;
  type: string | null;
  dnc: string | null;
}

interface TaxSaleLead {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string | null;
  parcelId: string | null;

  owner: string;
  fileNumber: string | null;
  method: string;
  statute: string;
  deedType: string;
  filedBy: string | null;

  stage: string;
  workStatus: string;
  priority: string;
  score: number;

  saleDate: string | null;
  upsetDeadline: string | null;
  daysToSale: number | null;
  daysToUpset: number | null;
  saleElapsedPct: number;
  upsetDays: number;

  assessedValue: number | null;
  taxesOwed: number | null;
  redemptionAmount: number | null;
  openingBid: number | null;
  currentBid: number | null;
  nextUpsetBid: number | null;
  depositPct: number | null;
  payoffExtras: number;
  delinquentYears: number[];
  yearsBehind: number;
  cityTaxes: boolean;
  hasMortgage: boolean;
  hasIrsLien: boolean;

  equity: number;
  equityPct: number;
  netAfterCosts: number;

  propertyType: string | null;
  acreage: number | null;
  ownedSince: string | null;
  occupancy: string;
  rescueRuleApplies: boolean;

  phones: Phone[];
  emails: string[];
  cleanPhoneCount: number;
  dncScrubbedAt: string | null;
  scrubAgeDays: number | null;
  scrubFresh: boolean;
  callable: boolean;
  inCallWindow: boolean;

  doNotCall: boolean;
  callNotes: string;
  tags: string[];
  workup: Record<string, boolean>;
  workupComplete: boolean;

  touchDays: Record<string, boolean>;
  totalTouches: number;

  zillowUrl: string | null;
  realtorQuery: string | null;
  realtorZip: string | null;
  parcelUrl: string | null;
}

type Chip = { kind: string; value: string };

const UPSET_DAYS = 10;

// ─── Page ───────────────────────────────────────────────────────────────────

/**
 * The table, in the order a tax sale is triaged: how close is the clock, what
 * does it cost to take, whose is it, can we reach them. Same order as the card.
 */
const TAX_COLUMNS: PipelineColumn<any>[] = [
  {
    key: 'stage',
    label: 'Stage',
    width: '150px',
    sortValue: (r) => r.score,
    render: (r) => {
      const c = TAX_STAGE_COLOR[r.stage] || CHIP.slate;
      return (
        <span className="dc-tag" style={{ background: c.bg, color: c.fg }}>
          {TAX_STAGE_LABEL[r.stage] || r.stage}
        </span>
      );
    },
  },
  {
    key: 'clock',
    label: 'Clock',
    align: 'right',
    width: '120px',
    // Upset first when it is open, since a competing bid can take the property
    // away in days; otherwise days to sale. Soonest sorts first.
    sortValue: (r) =>
      r.daysToUpset != null && r.daysToUpset >= 0 ? r.daysToUpset : (r.daysToSale ?? 9999),
    render: (r) =>
      r.daysToUpset != null && r.daysToUpset >= 0 ? (
        <span style={{ color: r.daysToUpset <= 3 ? 'var(--red)' : 'var(--amber)', fontWeight: 600 }}>
          {r.daysToUpset}d upset
        </span>
      ) : r.daysToSale != null ? (
        <span style={{ color: r.daysToSale >= 0 && r.daysToSale <= 14 ? 'var(--red)' : 'var(--dim)' }}>
          {r.daysToSale < 0 ? `${Math.abs(r.daysToSale)}d past` : `${r.daysToSale}d to sale`}
        </span>
      ) : (
        <span style={{ color: 'var(--faint)' }}>no date</span>
      ),
  },
  {
    key: 'redemption',
    label: 'Redemption',
    align: 'right',
    width: '115px',
    sortValue: (r) => r.redemptionAmount ?? 0,
    render: (r) => <b>{money(r.redemptionAmount)}</b>,
  },
  {
    key: 'equity',
    label: 'Equity',
    align: 'right',
    width: '110px',
    sortValue: (r) => r.equity ?? 0,
    render: (r) => <span style={{ color: 'var(--mint)' }}>{money(r.equity)}</span>,
  },
  {
    key: 'property',
    label: 'Property',
    sortValue: (r) => r.address || '',
    render: (r) => (
      <div>
        <div style={{ fontWeight: 600 }}>{r.address}</div>
        <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
          {[r.city, r.zip].filter(Boolean).join(' ')} · {r.county} · {METHOD_LABEL[r.method] || r.method}
        </div>
      </div>
    ),
  },
  { key: 'owner', label: 'Owner', sortValue: (r) => r.owner || '', render: (r) => r.owner },
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
    width: '120px',
    sortValue: (r) => (r.doNotCall ? -1 : r.cleanPhoneCount || 0),
    render: (r) =>
      r.doNotCall ? (
        <span style={{ color: 'var(--red)', fontSize: 12 }}>do not call</span>
      ) : r.cleanPhoneCount > 0 ? (
        <span style={{ color: 'var(--mint)', fontSize: 12 }}>☏ {r.cleanPhoneCount} callable</span>
      ) : (
        <span style={{ color: 'var(--faint)', fontSize: 12 }}>no number</span>
      ),
  },
];

/** Kanban columns follow the statutory progression of a tax foreclosure. */
const TAX_KANBAN: PipelineStage[] = Object.keys(TAX_STAGE_LABEL).map((k) => ({
  key: k,
  label: TAX_STAGE_LABEL[k],
  tone: (TAX_STAGE_COLOR[k] || CHIP.slate).fg,
}));

export default function TaxSalesPage() {
  const [rows, setRows] = useState<TaxSaleLead[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [counties, setCounties] = useState<string[]>([]);
  const [stats, setStats] = useState({ total: 0, high: 0, saleWithin14: 0, equity40: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [sort, setSort] = useState('recent');
  const [priority, setPriority] = useState<string | null>(null);
  const [workStatus, setWorkStatus] = useState<string | null>(null);
  const [trackQ, setTrackQ] = useState<string | null>(null);
  const [county, setCounty] = useState('all');
  const [city, setCity] = useState('all');
  const [equity, setEquity] = useState('all');
  const [years, setYears] = useState('all');
  const [saleWin, setSaleWin] = useState('all');
  const [occ, setOcc] = useState('all');
  const [payoff, setPayoff] = useState('all');
  const [ptype, setPtype] = useState('all');
  const [phoneQ, setPhoneQ] = useState('all');
  const [hideRedeemed, setHideRedeemed] = useState(true);
  const [hideDnc, setHideDnc] = useState(true);

  /* Chips on a card double as filters. Clicking one pins it at the top and
     narrows every card to the ones carrying it. Several stack as AND, so
     Owner-occupied plus Title complexity means both, not either. Kept on the
     client because they filter on values already in the loaded rows. */
  const [chips, setChips] = useState<Chip[]>([]);

  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  /** Table by default: a long docket is scanned before any of it is worked. */
  const [view, setView] = useState<PipelineView>('table');
  const [openId, setOpenId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const say = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 5000);
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await taxSalesAPI.list({
        search: q || undefined,
        priority: priority || undefined,
        workStatus: workStatus || undefined,
        stage: trackQ === 'Upset Bid' ? 'UPSET_BID_PERIOD' : undefined,
        method: trackQ === 'In Rem' ? 'IN_REM' : trackQ === 'Judicial' ? 'JUDICIAL' : undefined,
        county: county === 'all' ? undefined : county,
        city: city === 'all' ? undefined : city,
        propertyType: ptype === 'all' ? undefined : ptype,
        occupancy: occ === 'all' ? undefined : occ,
        equityMin: equity === 'all' ? undefined : Number(equity),
        yearsMin: years === 'all' ? undefined : Number(years),
        saleWithinDays: saleWin === 'all' ? undefined : Number(saleWin),
        payoffBand: payoff === 'all' ? undefined : payoff,
        phoneStatus: phoneQ === 'all' ? undefined : phoneQ,
        hideRedeemed: hideRedeemed || undefined,
        hideDnc: hideDnc || undefined,
        sort,
        pageSize: 200,
      });
      setRows(res.data.data || []);
      setCities(res.data.cities || []);
      setCounties(res.data.counties || []);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Could not load tax sale leads.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [q, priority, workStatus, trackQ, county, city, ptype, occ, equity, years, saleWin, payoff, phoneQ, hideRedeemed, hideDnc, sort]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await taxSalesAPI.stats();
      setStats(res.data);
    } catch {
      /* the headline tiles are not worth an error banner of their own */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(fetchRows, 250);
    return () => clearTimeout(t);
  }, [fetchRows]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // ── Card edits ────────────────────────────────────────────────────────────

  /* Optimistic, then reconciled against what the server actually stored. The
     server recomputes the score, the priority and the equity on every write, so
     a card that only echoed the local change would show a stale score until the
     next reload. */
  const patch = useCallback(
    async (id: string, body: any, optimistic?: Partial<TaxSaleLead>) => {
      if (optimistic) {
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...optimistic } : r)));
      }
      try {
        const res = await taxSalesAPI.update(id, body);
        setRows((rs) => rs.map((r) => (r.id === id ? res.data : r)));
        fetchStats();
      } catch (err: any) {
        say(err?.response?.data?.message || 'That change could not be saved.');
        fetchRows();
      }
    },
    [fetchRows, fetchStats, say],
  );

  const copy = (v: string) => {
    try {
      navigator.clipboard.writeText(v);
      say('Copied');
    } catch {
      say('Copy blocked');
    }
  };

  /**
   * Bulk actions on the checked rows, the same pair every pipeline board
   * carries: retire a lead, or remove it outright.
   *
   * Marking dead is the usual one. A dead tax sale is still a record of a
   * judgment we saw, and deleting it lets the next import re-create it as new.
   */
  const bulkStatus = async (status: string, label: string) => {
    if (!chosen.length) return;
    setBusy(true);
    try {
      const res = await taxSalesAPI.bulkStatus(chosen, status);
      say(`${label} ${res.data.updated} lead${res.data.updated === 1 ? '' : 's'}.`);
      setPicked({});
      fetchRows();
      fetchStats();
    } catch (err: any) {
      say(err?.response?.data?.message || `${label} failed.`);
    } finally {
      setBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (!chosen.length) return;
    if (!window.confirm(`Delete ${chosen.length} lead${chosen.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await taxSalesAPI.bulkDelete(chosen);
      say(`Deleted ${res.data.deleted} lead${res.data.deleted === 1 ? '' : 's'}.`);
      setPicked({});
      fetchRows();
      fetchStats();
    } catch (err: any) {
      say(err?.response?.data?.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const res = await taxSalesAPI.importExecute(f, { importBatch: f.name });
      const r = res.data;
      say(
        `Imported ${r.created} lead${r.created === 1 ? '' : 's'} from ${f.name}` +
          (r.duplicates ? `, ${r.duplicates} already on file` : '') +
          (r.errors?.length ? `, ${r.errors.length} row${r.errors.length === 1 ? '' : 's'} skipped` : '') +
          '.',
      );
      fetchRows();
      fetchStats();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That file could not be imported.');
    } finally {
      setBusy(false);
    }
  };

  const addLead = async (values: Record<string, string | number>) => {
    setSaving(true);
    try {
      await taxSalesAPI.create(values);
      setAdding(false);
      say('Lead added.');
      fetchRows();
      fetchStats();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That lead could not be added.');
    } finally {
      setSaving(false);
    }
  };

  // ── Client-side chip filtering ────────────────────────────────────────────

  const chipOn = (kind: string, value: string) => chips.some((c) => c.kind === kind && c.value === value);
  const toggleChip = (kind: string, value: string) =>
    setChips((cs) =>
      cs.some((c) => c.kind === kind && c.value === value)
        ? cs.filter((c) => !(c.kind === kind && c.value === value))
        : cs.concat([{ kind, value }]),
    );

  const chipColor = (kind: string, value: string): ChipColor => {
    if (kind === 'priority') return PRIORITY[value] || CHIP.slate;
    if (kind === 'stage') return TAX_STAGE_COLOR[value] || CHIP.slate;
    if (kind === 'method') return { fg: 'var(--text)', bg: 'var(--surface3)' };
    if (kind === 'lien') return CHIP.red;
    return TAG_COLOR[value] || CHIP.slate;
  };

  const chipLabel = (kind: string, value: string) => {
    if (kind === 'priority') return PRIORITY[value]?.label || value;
    if (kind === 'stage') return TAX_STAGE_LABEL[value] || value;
    if (kind === 'method') return `${METHOD_LABEL[value] || value}`;
    return value;
  };

  const shown = useMemo(
    () =>
      rows.filter((r) =>
        chips.every((c) => {
          if (c.kind === 'priority') return r.priority === c.value;
          if (c.kind === 'stage') return r.stage === c.value;
          if (c.kind === 'method') return r.method === c.value;
          if (c.kind === 'lien') {
            return c.value === 'Mortgage on title' ? r.hasMortgage : r.hasIrsLien;
          }
          return (r.tags || []).includes(c.value);
        }),
      ),
    [rows, chips],
  );
  const openLead = openId ? shown.find((r) => r.id === openId) || null : null;
  /**
   * Step through the filtered list from inside the panel.
   *
   * Indexed off the SAME array the board renders, so the arrows follow whatever
   * filter and sort is on screen rather than some separate order. Null at the
   * ends instead of wrapping, which is what disables the button and makes the
   * end of the list visible.
   */
  const openIndex = shown.findIndex((r) => r.id === openId);
  const goTo = (i: number) => setOpenId(shown[i] ? (shown[i] as any).id : null);



  const chosen = Object.keys(picked).filter((k) => picked[k]);

  const reset = () => {
    setQ('');
    setPriority(null);
    setWorkStatus(null);
    setTrackQ(null);
    setCounty('all');
    setCity('all');
    setEquity('all');
    setYears('all');
    setSaleWin('all');
    setOcc('all');
    setPayoff('all');
    setPtype('all');
    setPhoneQ('all');
    setHideRedeemed(true);
    setHideDnc(true);
    setChips([]);
  };

  const csv = () => {
    const list = chosen.length ? shown.filter((r) => picked[r.id]) : shown;
    downloadCsv(
      `tax_sales_${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'Address', 'City', 'Zip', 'County', 'Parcel', 'Acreage', 'Property type', 'File no',
        'Method', 'Statute', 'Deed', 'Filed by', 'Owner', 'Stage', 'Sale date', 'Days to sale',
        'Assessed', 'Taxes owed', 'Redemption payoff', 'Opening bid', 'Current bid',
        'Upset deadline', 'Next upset bid', 'Deposit %', 'Years delinquent', 'Mortgage',
        'IRS lien', 'Equity', 'Equity %', 'Score', 'Priority', 'Status', 'Occupancy',
        'Phones', 'Emails', 'Touches', 'Notes',
      ],
      list.map((r) => [
        r.address, r.city, r.zip, r.county, r.parcelId, r.acreage, r.propertyType, r.fileNumber,
        METHOD_LABEL[r.method] || r.method, `NCGS ${r.statute}`, r.deedType, r.filedBy, r.owner,
        TAX_STAGE_LABEL[r.stage] || r.stage, fmtDate(r.saleDate), r.daysToSale,
        r.assessedValue, r.taxesOwed, r.redemptionAmount, r.openingBid, r.currentBid,
        fmtDate(r.upsetDeadline), r.nextUpsetBid, r.depositPct != null ? `${r.depositPct}%` : '',
        r.yearsBehind, r.hasMortgage ? 'Yes' : 'No', r.hasIrsLien ? 'Yes' : 'No',
        r.equity, `${r.equityPct}%`, r.score, PRIORITY[r.priority]?.label || r.priority,
        WORK_STATUS_LABEL[r.workStatus] || r.workStatus, OCCUPANCY_LABEL[r.occupancy] || r.occupancy,
        r.phones.map((p) => phoneDisplay(p.number)).join(' | '), r.emails.join(' | '),
        r.totalTouches, r.callNotes,
      ]),
    );
    say(`Exported ${list.length} lead${list.length === 1 ? '' : 's'}.`);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="dc-board" style={{ background: 'var(--bg)', minHeight: '100vh', padding: 26 }}>
        <div style={{ maxWidth: 1600, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <h1 className="dc-h1">Tax Sales</h1>
              <div className="dc-sub">
                Delinquent tax foreclosure leads. No automatic outreach - AI replies stay off until campaigns are enabled.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={onFile} />
              <button className="dc-btn" onClick={() => { fetchRows(); fetchStats(); }} disabled={loading}>
                Refresh feed
              </button>
              <button className="dc-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? 'Importing...' : 'Import sheet'}
              </button>
              <button className="dc-btn pri" onClick={() => setAdding(true)}>
                Add lead
              </button>
            </div>
          </div>

          <div style={{ color: 'var(--dim)', fontSize: 13, margin: '18px 0 16px' }}>
            {loading
              ? 'Loading from Dealcore...'
              : `${stats.total} tax sale lead${stats.total === 1 ? '' : 's'} loaded`}
          </div>

          {error && (
            <div className="dc-panel bad" style={{ marginBottom: 16 }}>
              <div className="head" style={{ color: 'var(--redHead)' }}>
                <span>⛔</span> {error}
              </div>
            </div>
          )}

          <div className="dc-stats">
            <div className="dc-stat">
              <div className="k">Total leads</div>
              <div className="v">{stats.total}</div>
            </div>
            <button
              className={`dc-stat${priority === 'HIGH' ? ' on' : ''}`}
              onClick={() => setPriority(priority === 'HIGH' ? null : 'HIGH')}
            >
              <div className="k">High priority</div>
              <div className="v" style={{ color: 'var(--red)' }}>{stats.high}</div>
            </button>
            <button
              className={`dc-stat${saleWin === '14' ? ' on' : ''}`}
              onClick={() => setSaleWin(saleWin === '14' ? 'all' : '14')}
            >
              <div className="k">Sale within 14d</div>
              <div className="v" style={{ color: 'var(--amber)' }}>{stats.saleWithin14}</div>
            </button>
            <button
              className={`dc-stat${equity === '40' ? ' on' : ''}`}
              onClick={() => setEquity(equity === '40' ? 'all' : '40')}
            >
              <div className="k">40%+ equity</div>
              <div className="v" style={{ color: 'var(--mint)' }}>{stats.equity40}</div>
            </button>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div className="dc-search" style={{ flex: '1 1 320px' }}>
              <span>🔍</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search address, owner, file number, email..."
              />
              {q && (
                <button onClick={() => setQ('')} style={{ color: 'var(--faint)' }}>
                  ✕
                </button>
              )}
            </div>
            <Sel
              v={sort}
              set={setSort}
              opts={[
                ['recent', 'Sort: Recently added'],
                ['sale', 'Sort: Sale date'],
                ['score', 'Sort: Score'],
                ['payoff', 'Sort: Lowest payoff'],
                ['equity', 'Sort: Equity'],
                ['years', 'Sort: Years delinquent'],
              ]}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <span className="dc-flabel">Quick filters</span>
            {['HIGH', 'MEDIUM', 'LOW'].map((k) => (
              <button
                key={k}
                className={`dc-tab${priority === k ? ' on' : ''}`}
                onClick={() => setPriority(priority === k ? null : k)}
              >
                {k[0] + k.slice(1).toLowerCase()}
              </button>
            ))}
            <span className="dc-sep" />
            {['IN_CONVERSATION', 'APPOINTMENT_SET', 'UNDER_CONTRACT'].map((k) => (
              <button
                key={k}
                className={`dc-tab${workStatus === k ? ' on' : ''}`}
                onClick={() => setWorkStatus(workStatus === k ? null : k)}
              >
                {WORK_STATUS_LABEL[k]}
              </button>
            ))}
            <span className="dc-sep" />
            {['In Rem', 'Judicial', 'Upset Bid'].map((k) => (
              <button
                key={k}
                className={`dc-tab${trackQ === k ? ' on' : ''}`}
                onClick={() => setTrackQ(trackQ === k ? null : k)}
              >
                {k}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <span className="dc-flabel">Filters</span>
            <Sel v={county} set={setCounty} opts={[['all', 'All counties'] as [string, string]].concat(counties.map((c) => [c, c] as [string, string]))} />
            <Sel v={city} set={setCity} opts={[['all', 'All cities'] as [string, string]].concat(cities.map((c) => [c, c] as [string, string]))} />
            <Sel v={equity} set={setEquity} opts={[['all', 'Any equity'], ['40', '40%+ equity'], ['60', '60%+ equity'], ['80', '80%+ equity']]} />
            <Sel v={years} set={setYears} opts={[['all', 'Any years delinquent'], ['3', '3+ years behind'], ['5', '5+ years behind'], ['8', '8+ years behind']]} />
            <Sel v={saleWin} set={setSaleWin} opts={[['all', 'Any sale date'], ['14', 'Within 14 days'], ['30', 'Within 30 days'], ['60', 'Within 60 days']]} />
            <Sel
              v={occ}
              set={setOcc}
              opts={[['all', 'Any occupancy'], ['OWNER_OCCUPIED', 'Owner-occupied'], ['ABSENTEE', 'Absentee'], ['VACANT', 'Vacant']]}
            />
            <Sel v={payoff} set={setPayoff} opts={[['all', 'Any payoff'], ['u10', 'Payoff under $10k'], ['10-25', '$10k to $25k'], ['25+', '$25k+']]} />
            <Sel
              v={ptype}
              set={setPtype}
              opts={[['all', 'Any property type'], ['Single family', 'Single family'], ['Duplex', 'Duplex'], ['Mobile home', 'Mobile home'], ['Vacant land', 'Vacant land']]}
            />
            <Sel
              v={phoneQ}
              set={setPhoneQ}
              opts={[['all', 'Any phone status'], ['callable', 'Safe to call'], ['dnc', 'DNC flagged'], ['stale', 'Scrub over 31 days'], ['none', 'No number yet']]}
            />
            <button className={`dc-danger${hideRedeemed ? '' : ' off'}`} onClick={() => setHideRedeemed(!hideRedeemed)}>
              Hide redeemed
            </button>
            <button className={`dc-danger${hideDnc ? '' : ' off'}`} onClick={() => setHideDnc(!hideDnc)}>
              Hide Do-Not-Call
            </button>
          </div>

          {chips.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <span className="dc-flabel">On card</span>
              {chips.map((c) => {
                const col = chipColor(c.kind, c.value);
                return (
                  <span key={c.kind + c.value} className="dc-active" style={{ background: col.bg, color: col.fg, borderColor: col.fg }}>
                    {chipLabel(c.kind, c.value)}
                    <button onClick={() => toggleChip(c.kind, c.value)} aria-label={`Remove ${c.value} filter`}>
                      ✕
                    </button>
                  </span>
                );
              })}
              <button className="dc-btn sm" onClick={() => setChips([])}>
                Clear tags
              </button>
            </div>
          )}

          <div style={{ display: 'flex', marginBottom: 16 }}>
            <button className="dc-btn" style={{ marginLeft: 'auto' }} onClick={reset}>
              Reset filters
            </button>
          </div>

          {adding && (
            <AddLeadSheet
              title="New tax sale lead"
              note="It is filed as a TAX_SALE record, so it can only ever appear in this pipeline. Everything else on the card can be filled in afterwards."
              fields={TAX_SALE_FIELDS}
              submitting={saving}
              onAdd={addLead}
              onClose={() => setAdding(false)}
            />
          )}

          <PipelineBoard
            rows={shown}
            keyOf={(r) => r.id}
            columns={TAX_COLUMNS}
            stages={TAX_KANBAN}
            stageOf={(r) => r.stage}
            onStageChange={(r, stage) => patch(r.id, { stage })}
            view={view}
            onViewChange={setView}
            selected={picked}
            onSelect={(k, on) => setPicked({ ...picked, [k]: on })}
            onSelectAll={(on) => {
              if (!on) return setPicked({});
              const n: Record<string, boolean> = {};
              shown.forEach((r) => { n[r.id] = true; });
              setPicked(n);
            }}
            onOpen={(r) => setOpenId(r.id)}
            accentOf={(r) => TAX_ACCENT[r.stage] || 'var(--border2)'}
            loading={loading}
            renderCard={(r) => (
              <TaxSaleCard
                r={r}
                picked={!!picked[r.id]}
                onPick={(on) => setPicked({ ...picked, [r.id]: on })}
                onOpen={() => setOpenId(r.id)}
              />
            )}
            empty={
              rows.length === 0
                ? 'No tax sale leads yet. Import a county list to get started.'
                : 'Nothing matches those filters.'
            }
            toolbarLeft={
              <span>
                {shown.length} lead{shown.length === 1 ? '' : 's'}
                {chosen.length > 0 && (
                  <>
                    {' '}· <b style={{ color: 'var(--mint)' }}>{chosen.length} selected</b>
                  </>
                )}
              </span>
            }
            toolbarRight={
              <>
                {chosen.length > 0 && (
                  <>
                    <button className="dc-btn sm dngr" disabled={busy} onClick={() => bulkStatus('DEAD', 'Marked dead')}>
                      Mark dead
                    </button>
                  </>
                )}
                <button style={{ color: 'var(--mint)', fontWeight: 600, fontSize: 13 }} onClick={csv}>
                  Download {chosen.length ? 'selected' : 'shown'} as CSV
                </button>
              </>
            }
          />

          <div style={{ height: 34 }} />
        </div>

        {openLead && (
          <PipelineWorkPanel
            onPrev={openIndex > 0 ? () => goTo(openIndex - 1) : null}
            onNext={openIndex >= 0 && openIndex < shown.length - 1 ? () => goTo(openIndex + 1) : null}
            position={openIndex >= 0 ? { index: openIndex, total: shown.length } : null}
            title={openLead.address}
            subtitle={`${[openLead.city, openLead.zip].filter(Boolean).join(' ')} · ${money(openLead.redemptionAmount)} to redeem`}
            meta={`${openLead.county} County${openLead.fileNumber ? ` · file ${openLead.fileNumber}` : ''}`}
            chips={
              <span
                className="dc-tag"
                style={{
                  background: (TAX_STAGE_COLOR[openLead.stage] || CHIP.slate).bg,
                  color: (TAX_STAGE_COLOR[openLead.stage] || CHIP.slate).fg,
                }}
              >
                {TAX_STAGE_LABEL[openLead.stage] || openLead.stage}
              </span>
            }
            detail={<TaxSaleDetail r={openLead} />}
            subjects={[
              {
                leadId: openLead.id,
                name: openLead.owner,
                phones: openLead.phones,
                emails: openLead.emails,
              },
            ]}
            onClose={() => setOpenId(null)}
            onChanged={fetchRows}
            say={say}
          />
        )}

        {toast && (
          <div
            style={{
              position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)',
              background: 'var(--surface2)', border: '1px solid var(--border2)',
              borderRadius: 10, padding: '11px 18px', fontSize: 13, fontWeight: 600,
              zIndex: 100, boxShadow: '0 8px 26px rgba(0,0,0,.25)', color: 'var(--text)',
            }}
          >
            {toast}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ─── Bits ───────────────────────────────────────────────────────────────────

function Sel({
  v,
  set,
  opts,
}: {
  v: string;
  set: (v: string) => void;
  opts: [string, string][];
}) {
  return (
    <select
      className="dc-in"
      value={v}
      onChange={(e) => set(e.target.value)}
      style={{ width: 'auto', minWidth: 132, fontSize: 12.5, padding: '8px 11px' }}
    >
      {opts.map(([val, label]) => (
        <option key={val} value={val}>
          {label}
        </option>
      ))}
    </select>
  );
}

function Lbl({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="dc-lbl" style={style}>
      {children}
    </div>
  );
}

type CardChip = {
  kind: string;
  key: string;
  label: string;
  color: ChipColor;
  /** Set on the priority chip only, which is the one rendered upper-case. */
  up?: boolean;
  /** Why this chip matters, shown on hover. Liens carry one, plain tags do not. */
  hint?: string;
};
