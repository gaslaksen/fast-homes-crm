'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from '@/components/AppShell';
import LeadRack, { RackView } from '@/components/pipelines/LeadRack';
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
  const [view, setView] = useState<RackView>('rack');
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

          <LeadRack
            items={shown}
            keyOf={(r) => r.id}
            view={view}
            onViewChange={setView}
            empty={
              <div className="dc-empty">
                {loading ? 'Loading...' : rows.length === 0 ? 'No tax sale leads yet. Import a county list to get started.' : 'Nothing matches those filters.'}
              </div>
            }
            toolbarLeft={
              <span style={{ color: 'var(--dim)', fontSize: 13 }}>
                {shown.length} lead{shown.length === 1 ? '' : 's'}
                {chosen.length > 0 && (
                  <>
                    {' '}· <b style={{ color: 'var(--mint)' }}>{chosen.length} selected</b>
                  </>
                )}{' '}
                · click a card to select it for CSV export
              </span>
            }
            toolbarRight={
              <>
                <div className="dc-seg" title="Select or clear every card currently shown">
                  <button
                    className={shown.length > 0 && shown.every((r) => picked[r.id]) ? 'on' : ''}
                    onClick={() => {
                      const n: Record<string, boolean> = {};
                      shown.forEach((r) => {
                        n[r.id] = true;
                      });
                      setPicked(n);
                    }}
                  >
                    Select all
                  </button>
                  <button className={chosen.length === 0 ? 'on' : ''} onClick={() => setPicked({})}>
                    Deselect
                  </button>
                </div>
                <button style={{ color: 'var(--mint)', fontWeight: 600, fontSize: 13 }} onClick={csv}>
                  Download {chosen.length ? 'selected' : 'shown'} as CSV
                </button>
              </>
            }
            renderItem={(r) => (
              <TaxSaleCard
                r={r}
                picked={!!picked[r.id]}
                onPick={(on) => setPicked({ ...picked, [r.id]: on })}
                editing={!!editing[r.id]}
                onEditing={(on) => setEditing({ ...editing, [r.id]: on })}
                chipOn={chipOn}
                toggleChip={toggleChip}
                chipColor={chipColor}
                patch={patch}
                copy={copy}
                say={say}
              />
            )}
          />

          <div style={{ height: 34 }} />
        </div>

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

interface CardProps {
  r: TaxSaleLead;
  picked: boolean;
  onPick: (on: boolean) => void;
  editing: boolean;
  onEditing: (on: boolean) => void;
  chipOn: (kind: string, value: string) => boolean;
  toggleChip: (kind: string, value: string) => void;
  chipColor: (kind: string, value: string) => ChipColor;
  patch: (id: string, body: any, optimistic?: Partial<TaxSaleLead>) => void;
  copy: (v: string) => void;
  say: (t: string) => void;
}

function TaxSaleCard({ r, picked, onPick, editing, onEditing, chipOn, toggleChip, chipColor, patch, copy, say }: CardProps) {
  const prio = PRIORITY[r.priority] || PRIORITY.LOW;
  const d = r.daysToSale;
  const ud = r.daysToUpset;
  const upsetting = r.stage === 'UPSET_BID_PERIOD';

  const clockColor =
    d === null ? 'var(--faint)' : d < 0 ? 'var(--dim)' : d <= 14 ? 'var(--red)' : d <= 30 ? 'var(--amber)' : 'var(--mint)';
  const barColor = d !== null && d <= 14 ? 'var(--red)' : d !== null && d <= 30 ? 'var(--amber)' : 'var(--mint)';

  // Liens first, they matter most, then the descriptive tags.
  const cardChips: CardChip[] = [
    { kind: 'priority', key: r.priority, label: prio.label, up: true, color: prio },
    { kind: 'stage', key: r.stage, label: TAX_STAGE_LABEL[r.stage] || r.stage, color: TAX_STAGE_COLOR[r.stage] || CHIP.slate },
    {
      kind: 'method',
      key: r.method,
      label: `${METHOD_LABEL[r.method] || r.method} ${r.statute}`,
      color: { fg: 'var(--text)', bg: 'var(--surface3)' },
    },
  ];
  if (r.hasMortgage) {
    cardChips.push({
      kind: 'lien',
      key: 'Mortgage on title',
      label: 'Mortgage on title',
      color: CHIP.red,
      hint: 'A lender on title usually redeems to protect its lien',
    });
  }
  if (r.hasIrsLien) {
    cardChips.push({
      kind: 'lien',
      key: 'IRS lien',
      label: 'IRS lien',
      color: CHIP.red,
      hint: '120 day federal right of redemption after the sale',
    });
  }
  for (const t of r.tags || []) {
    cardChips.push({ kind: 'tag', key: t, label: t, color: TAG_COLOR[t] || CHIP.slate });
  }

  // Outreach clearance. Every note here is a reason a call should not be made,
  // or a reason it needs care, and the button below is gated on the same rules.
  const notes: string[] = [];
  if (r.doNotCall) notes.push('On your internal do not call list.');
  else if (!r.phones.length) notes.push('No number yet, run a skip trace.');
  else if (!r.cleanPhoneCount) notes.push('Every number on file is registered, do not dial.');
  else if (!r.scrubFresh) {
    notes.push(`Scrub is ${r.scrubAgeDays === null ? 'missing' : `${r.scrubAgeDays} days`} old, re-run before dialing.`);
  }
  if (!r.inCallWindow) notes.push('Outside the 8am to 9pm calling window.');
  if (r.rescueRuleApplies) {
    notes.push('Principal residence. A leaseback or buyback turns this into a 75-121 rescue transaction.');
  }
  if (r.hasMortgage) notes.push('Lender on title will usually redeem to protect its lien.');
  if (r.hasIrsLien) notes.push('IRS lien carries a 120 day federal redemption right after the sale.');

  const setPhone = (i: number, next: Partial<Phone>) => {
    const nx = r.phones.map((p, k) => (k === i ? { ...p, ...next } : p));
    // Editing a number clears its scrub, so it has to be re-checked before dialing.
    patch(r.id, { phones: nx }, { phones: nx as Phone[] });
  };

  return (
    <div className={`dc-lead${picked ? ' pick' : ''}`} style={{ borderTopColor: prio.fg }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
        <input
          type="checkbox"
          checked={picked}
          onChange={(e) => onPick(e.target.checked)}
          style={{ width: 15, height: 15, accentColor: '#2FDDB6', marginTop: 3, flex: '0 0 15px' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.address}
            </span>
            <button className="dc-copy" onClick={() => copy(`${r.address}, ${r.city} ${r.state} ${r.zip}`)}>
              ⧉
            </button>
          </div>
          <div style={{ color: 'var(--dim)', fontSize: 12.5, marginTop: 2 }}>
            {r.city}, {r.zip}
          </div>
        </div>
        <div className="dc-score" style={r.score >= 45 ? { borderColor: prio.fg } : {}}>
          <b style={{ color: r.score >= 45 ? prio.fg : 'var(--text)' }}>{r.score}</b>
          <span>Score</span>
        </div>
      </div>

      <div className="dc-cardbody">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {cardChips.map((c) => {
            const on = chipOn(c.kind, c.key);
            return (
              <button
                key={c.kind + c.key}
                type="button"
                className={`dc-tag${c.up ? ' up' : ''}${on ? ' picked' : ''}`}
                style={{ background: c.color.bg, color: c.color.fg }}
                title={c.hint || (on ? `Remove the ${c.label} filter` : `Filter every lead by ${c.label}`)}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleChip(c.kind, c.key);
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        <div>
          <Lbl style={{ marginBottom: 4 }}>Owner</Lbl>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.35 }}>{r.owner || '-'}</span>
            <button className="dc-copy" onClick={() => copy(r.owner)}>
              ⧉
            </button>
          </div>
        </div>

        {/* Sale clock, the same shape as the surplus claim clock. */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <Lbl style={{ margin: 0 }}>{upsetting ? 'Upset clock' : 'Sale clock'}</Lbl>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: clockColor }}>
              {upsetting && ud !== null
                ? ud <= 0
                  ? 'Closes today'
                  : `${ud}d to upset`
                : d === null
                  ? 'No date'
                  : d < 0
                    ? 'Sale held'
                    : `${d}d left`}
            </span>
          </div>
          <div className="dc-bar">
            <i
              style={{
                width: `${
                  upsetting && ud !== null
                    ? Math.max(0, Math.min(100, ((UPSET_DAYS - ud) / UPSET_DAYS) * 100))
                    : r.saleElapsedPct
                }%`,
                background: barColor,
              }}
            />
          </div>
        </div>

        {/* The three numbers that decide whether this is worth a call. */}
        <div style={{ display: 'flex', gap: 10 }}>
          <Stat label="Assessed" value={money(r.assessedValue)} />
          <Stat label="Payoff" value={money(r.redemptionAmount)} color="var(--amber)" bold />
          <Stat label="Equity" value={money(r.equity)} color="var(--mint)" bold />
        </div>

        {/* Outreach clearance, same shape as the surplus compliance strip. */}
        <div className={`dc-panel ${r.callable ? 'ok' : 'bad'}`}>
          <div className="head" style={{ color: r.callable ? 'var(--mint)' : 'var(--redHead)', marginBottom: notes.length ? 7 : 0 }}>
            <span>{r.callable ? '✓' : '⛔'}</span>
            {r.callable ? `Clear to call, ${r.cleanPhoneCount} of ${r.phones.length} numbers` : 'Not clear to call'}
          </div>
          {notes.map((t, i) => (
            <div key={i} className="note" style={{ color: r.callable ? 'var(--amberBody)' : 'var(--redBody)' }}>
              · {t}
            </div>
          ))}
        </div>

        <div className="dc-contact">
          {editing ? (
            <>
              <Lbl style={{ marginBottom: 6 }}>Phone numbers</Lbl>
              {r.phones.map((ph, i) => (
                <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
                  <input
                    className="dc-in"
                    value={ph.number}
                    placeholder="0000000000"
                    style={{ fontSize: 12.5, padding: '7px 9px' }}
                    onChange={(e) => setPhone(i, { number: e.target.value, dnc: null })}
                  />
                  <select
                    className="dc-in"
                    value={ph.type || 'Mobile'}
                    style={{ width: 'auto', fontSize: 12.5, padding: '7px 6px' }}
                    onChange={(e) => setPhone(i, { type: e.target.value })}
                  >
                    <option>Mobile</option>
                    <option>Landline</option>
                  </select>
                  <button
                    className="dc-btn xs dngr"
                    onClick={() => patch(r.id, { phones: r.phones.filter((_, k) => k !== i) })}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {r.phones.length < 4 && (
                <button
                  className="dc-btn sm"
                  style={{ marginBottom: 10 }}
                  onClick={() => patch(r.id, { phones: r.phones.concat([{ number: '', type: 'Mobile', dnc: null }]) })}
                >
                  + Add number
                </button>
              )}
              <Lbl style={{ marginBottom: 6 }}>Emails</Lbl>
              {r.emails.map((em, i) => (
                <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
                  <input
                    className="dc-in"
                    value={em}
                    placeholder="name@example.com"
                    style={{ fontSize: 12.5, padding: '7px 9px' }}
                    onChange={(e) => {
                      const nx = r.emails.map((x, k) => (k === i ? e.target.value : x));
                      patch(r.id, { emails: nx }, { emails: nx });
                    }}
                  />
                  <button className="dc-btn xs dngr" onClick={() => patch(r.id, { emails: r.emails.filter((_, k) => k !== i) })}>
                    ✕
                  </button>
                </div>
              ))}
              {r.emails.length < 2 && (
                <button className="dc-btn sm" onClick={() => patch(r.id, { emails: r.emails.concat(['']) })}>
                  + Add email
                </button>
              )}
              <div style={{ color: 'var(--amber)', fontSize: 11.5, marginTop: 8, lineHeight: 1.5 }}>
                Editing a number clears its scrub, so it has to be re-checked before dialing.
              </div>
            </>
          ) : (
            <>
              {r.phones.length === 0 && r.emails.length === 0 && (
                <div style={{ color: 'var(--faint)', fontSize: 12.5, paddingBottom: 6 }}>No contact details yet.</div>
              )}
              {r.phones.map((ph, i) => {
                const flag = ph.dnc ? DNC_STATE[ph.dnc] : null;
                return (
                  <div key={i} className="dc-crow">
                    <span style={{ color: flag ? 'var(--red)' : 'var(--faint)' }}>{flag ? '⊘' : '☏'}</span>
                    <span
                      style={{
                        flex: 1,
                        fontWeight: 600,
                        color: flag ? 'var(--dim)' : 'var(--text)',
                        textDecoration: flag ? 'line-through' : 'none',
                      }}
                    >
                      {phoneDisplay(ph.number)}
                    </span>
                    <button className="dc-copy" onClick={() => copy(phoneDisplay(ph.number))}>
                      ⧉
                    </button>
                    <span
                      className="dc-tag"
                      style={{
                        background: flag ? flag.bg : 'var(--surface3)',
                        color: flag ? flag.fg : 'var(--dim)',
                        fontSize: 11.5,
                        padding: '4px 9px',
                      }}
                      title={flag ? 'Do not dial this number' : ph.type || ''}
                    >
                      {flag ? flag.label : ph.type || 'Unknown'}
                    </span>
                  </div>
                );
              })}
              {r.emails.map((em, i) => (
                <div key={i} className="dc-crow">
                  <span style={{ color: 'var(--faint)' }}>✉</span>
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--dim)' }}>
                    {em || '-'}
                  </span>
                  <button className="dc-copy" onClick={() => copy(em)}>
                    ⧉
                  </button>
                </div>
              ))}
            </>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
            <button className={`dc-btn sm${editing ? ' pri' : ''}`} onClick={() => onEditing(!editing)}>
              {editing ? 'Done' : '✎ Edit'}
            </button>
            {/* Skip trace is not wired for this pipeline yet: the foreclosure
                enricher is bound to LeadSource.FORECLOSURE and to NC OneMap.
                Left visible and disabled rather than faking a result, because
                an invented number here would be dialed. */}
            <button className="dc-btn sm" disabled title="Skip trace is not wired up for tax sales yet">
              ↻ Skip trace
            </button>
            <button
              className="dc-btn sm pri"
              style={{ flex: 1, justifyContent: 'center' }}
              disabled={!r.callable || !r.workupComplete}
              title={
                !r.callable
                  ? 'Blocked by the calling rules'
                  : !r.workupComplete
                    ? 'Finish the workup checklist first'
                    : 'Queue the outreach'
              }
              onClick={() => {
                patch(r.id, { workStatus: 'ATTEMPTED' });
                say('Outreach queued.');
              }}
            >
              Start outreach
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {r.zillowUrl && (
            <a className="dc-tile" href={r.zillowUrl} target="_blank" rel="noreferrer">
              <b>🏠 Zillow</b>
              <span>listing</span>
            </a>
          )}
          {r.realtorQuery && (
            <a
              className="dc-tile"
              href={`https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(r.realtorQuery)}`}
              target="_blank"
              rel="noreferrer"
            >
              <b>🔑 Realtor</b>
              <span>listing</span>
            </a>
          )}
          {r.parcelUrl && (
            <a className="dc-tile" href={r.parcelUrl} target="_blank" rel="noreferrer">
              <b>📍 Property</b>
              <span>PID {r.parcelId || '-'}</span>
            </a>
          )}
        </div>

        <div>
          <Lbl style={{ marginBottom: 6 }}>Status</Lbl>
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="dc-in"
              value={r.workStatus}
              onChange={(e) => patch(r.id, { workStatus: e.target.value }, { workStatus: e.target.value })}
              style={{ flex: 1, minWidth: 140, fontSize: 12.5, padding: '8px 10px' }}
            >
              {Object.entries(WORK_STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={r.doNotCall}
                onChange={(e) => patch(r.id, { doNotCall: e.target.checked }, { doNotCall: e.target.checked })}
                style={{ width: 15, height: 15, accentColor: '#F0524D' }}
              />
              Do Not Call
            </label>
          </div>
        </div>

        <div>
          <Lbl style={{ marginBottom: 6 }}>Contacted this week</Lbl>
          <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
            {DAYS.map(([k, short, full]) => (
              <div key={k}>
                <button
                  className={`dc-daybox${r.touchDays?.[k] ? ' on' : ''}`}
                  title={full}
                  onClick={() => patch(r.id, { touchDays: { ...r.touchDays, [k]: !r.touchDays?.[k] } })}
                >
                  ✓
                </button>
                <div className="dc-daylbl">{short}</div>
              </div>
            ))}
            <span style={{ marginLeft: 'auto', color: 'var(--dim)', fontSize: 12.5, paddingTop: 6 }}>
              Total touches: <b style={{ color: 'var(--text)' }}>{r.totalTouches}</b>
            </span>
          </div>
        </div>

        {/* Payoff waterfall, mirroring the surplus lien waterfall. */}
        <div style={{ marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <Lbl style={{ marginBottom: 8 }}>Payoff waterfall</Lbl>
          <Line label="Assessed value" value={money(r.assessedValue)} bold />
          <Line
            label={
              <>
                Delinquent taxes<span style={{ color: 'var(--faint)' }}> · {r.yearsBehind} years</span>
              </>
            }
            value={`-${money(r.taxesOwed)}`}
            valueColor="var(--red)"
          />
          <Line
            label={
              <>
                Interest, fees, and costs
                {r.cityTaxes && (
                  <span className="dc-tag" style={{ background: 'var(--surface3)', color: 'var(--dim)', fontSize: 10, padding: '2px 6px', marginLeft: 6 }}>
                    city taxes too
                  </span>
                )}
              </>
            }
            value={`-${money(r.payoffExtras)}`}
            valueColor="var(--red)"
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0 0', marginTop: 5, borderTop: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 700 }}>Equity at the payoff</span>
            <span style={{ fontWeight: 800, color: 'var(--mint)' }}>{money(r.equity)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '6px 0 0', color: 'var(--faint)' }}>
            <span>Less an allowance for closing and repair, 9%</span>
            <span>{money(r.netAfterCosts)}</span>
          </div>
        </div>

        {/* Workup checklist, mirroring the surplus document checklist. */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <Lbl style={{ marginBottom: 8 }}>Workup</Lbl>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {Object.entries(WORKUP_LABEL).map(([k, label]) => {
              const on = !!r.workup?.[k];
              return (
                <button
                  key={k}
                  onClick={() => patch(r.id, { workup: { [k]: !on } })}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, textAlign: 'left', padding: '3px 0' }}
                >
                  <span className={`dc-check${on ? ' on' : ''}`}>✓</span>
                  <span style={{ color: on ? 'var(--dim)' : 'var(--text)' }}>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="dc-meta">
          <Meta k="Sale date" v={fmtDate(r.saleDate)} />
          <Meta k="Timing" v={d === null ? '-' : d < 0 ? 'Sale held' : `${d}d to sale`} color={d !== null && d <= 14 ? 'var(--red)' : undefined} />
          <Meta k="Taxes owed" v={money(r.taxesOwed)} />
          <Meta
            k="Years behind"
            v={
              <>
                {r.yearsBehind}
                {r.delinquentYears.length > 0 && (
                  <span style={{ color: 'var(--faint)', fontWeight: 500, fontSize: 11.5 }}>
                    {' '}
                    ({r.delinquentYears[0]}-{r.delinquentYears[r.delinquentYears.length - 1]})
                  </span>
                )}
              </>
            }
          />
          <Meta k="Opening bid" v={money(r.openingBid)} />
          <Meta k="Deposit at sale" v={r.depositPct != null ? `${r.depositPct}% of bid` : '-'} />
          <Meta k="File number" v={r.fileNumber || '-'} small />
          <Meta k="Deed on sale" v={r.deedType} small />
          <Meta k="Property" v={`${r.propertyType || 'Unknown'}${r.acreage ? ` · ${r.acreage} ac` : ''}`} />
          <Meta k="Owned since" v={r.ownedSince || '-'} />
          <Meta
            k="DNC scrub"
            v={r.dncScrubbedAt ? `${r.scrubAgeDays}d ago` : 'Never run'}
            color={r.scrubFresh ? 'var(--mint)' : 'var(--red)'}
          />
          <Meta k="Call window" v={r.inCallWindow ? 'Open' : 'Closed'} color={r.inCallWindow ? 'var(--mint)' : 'var(--amber)'} />
          {r.currentBid != null && (
            <>
              <Meta k="Current bid" v={money(r.currentBid)} />
              <Meta
                k="Next upset"
                v={
                  <>
                    {money(r.nextUpsetBid)}
                    {ud !== null && (
                      <span style={{ color: ud <= 3 ? 'var(--red)' : 'var(--faint)', fontWeight: 500, fontSize: 11.5 }}> · {ud}d</span>
                    )}
                  </>
                }
              />
            </>
          )}
        </div>

        {/* The rule that governs this filing, mirroring the surplus rule panel. */}
        <div className="dc-rule" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 12.5 }}>Governing rule</span>
            <span className="dc-tag" style={{ background: 'var(--surface3)', color: 'var(--dim)', fontSize: 11.5, padding: '3px 8px' }}>
              NCGS {r.statute}
            </span>
            {r.filedBy && <span style={{ color: 'var(--faint)', fontSize: 11.5 }}>{r.filedBy}</span>}
          </div>
          <div style={{ color: 'var(--dim)', fontSize: 11.5, lineHeight: 1.6 }}>
            {r.method === 'JUDICIAL'
              ? 'Full civil action. A commissioner conducts the sale and title passes by Commissioner’s Deed.'
              : 'Clerk docketed judgment. The Sheriff conducts the sale and title passes by Sheriff’s Deed.'}{' '}
            Bidding stays open {UPSET_DAYS} days after the report of sale, and an upset must beat the standing bid by 5% or
            $750, whichever is greater. The owner can redeem any time before the court confirms, which withdraws the
            property from the sale.
          </div>
          {r.rescueRuleApplies && (
            <div style={{ color: 'var(--amberBody)', fontSize: 11.5, lineHeight: 1.6, marginTop: 8, fontWeight: 600, background: 'rgba(180,83,9,.10)', padding: '8px 10px', borderRadius: 8 }}>
              Principal residence. Offering a leaseback, buyback, or any option to stay makes this a foreclosure rescue
              transaction under NCGS 75-120, which requires paying at least 50% of appraised value. A plain cash purchase
              with no option to return is not covered.
            </div>
          )}
        </div>

        {/* Readiness gate, mirroring the surplus qualification gate. */}
        <div style={{ marginTop: 12 }}>
          <Lbl style={{ marginBottom: 6 }}>Ready to work</Lbl>
          {(
            [
              ['Workup complete', r.workupComplete],
              ['A number that is clear to dial', r.cleanPhoneCount > 0],
              ['Scrub inside 31 days', r.scrubFresh],
              ['Sale has not passed', d === null || d >= 0],
            ] as [string, boolean][]
          ).map(([label, done]) => (
            <div key={label} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
              <span className={`dc-check${done ? ' on' : ''}`}>✓</span>
              <span style={{ fontSize: 12.5, color: done ? 'var(--dim)' : 'var(--text)' }}>{label}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <Lbl style={{ marginBottom: 6 }}>Notes</Lbl>
          <NotesBox value={r.callNotes} onSave={(v) => patch(r.id, { callNotes: v })} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, letterSpacing: '.8px', color: 'var(--faint)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontWeight: bold ? 800 : 700, fontSize: 15, marginTop: 2, color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}

function Line({
  label,
  value,
  valueColor,
  bold,
}: {
  label: React.ReactNode;
  value: string;
  valueColor?: string;
  bold?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '5px 0' }}>
      <span style={{ color: 'var(--dim)', minWidth: 0 }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 600, color: valueColor, whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

function Meta({ k, v, color, small }: { k: string; v: React.ReactNode; color?: string; small?: boolean }) {
  return (
    <div>
      <div className="k">{k}</div>
      <div className="v" style={{ color, fontSize: small ? 12 : undefined }}>
        {v}
      </div>
    </div>
  );
}

/**
 * Notes are saved on blur rather than on every keystroke. The card re-renders
 * from the server response after each save, so a per-keystroke write would take
 * the cursor with it.
 */
function NotesBox({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      className="dc-in"
      rows={3}
      style={{ resize: 'vertical', fontSize: 12.5 }}
      value={draft}
      placeholder="Call notes, reminders..."
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onSave(draft);
      }}
    />
  );
}
