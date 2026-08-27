'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AppShell from '@/components/AppShell';
import LeadRack, { RackView } from '@/components/pipelines/LeadRack';
import AddLeadSheet, { SURPLUS_FIELDS } from '@/components/pipelines/AddLeadSheet';
import SurplusWorkPanel from '@/components/pipelines/SurplusWorkPanel';
import { authAPI, surplusAPI } from '@/lib/api';
import '@/components/pipelines/pipeline-board.css';
import {
  CHIP,
  CLAIMANT_TYPE_LABEL,
  DAYS,
  DNC_STATE,
  DOC_LABEL,
  DRIP_TRACK_COLOR,
  SURPLUS_STAGES,
  SURPLUS_STAGE_COLOR,
  TIER,
  downloadCsv,
  fmtDate,
  money,
  pct,
  phoneDisplay,
} from '@/components/pipelines/format';

/**
 * Contract sending is not built. The button below only advanced the stage and
 * showed a toast, which reads as "sent" without anything having been sent, and
 * the compliance gate exists to guard that send. Until there is a real send,
 * both are hidden rather than deleted, so the FL disclosure and fee-cap work
 * survives intact. Flip this to true when contracts are wired up.
 */
const CONTRACTS_ENABLED = false;

// ─── Types ──────────────────────────────────────────────────────────────────

interface Phone {
  number: string;
  type: string | null;
  /** DncRegistry value, or null when the number came back clean. */
  dnc: string | null;
}

interface Lien {
  type: string;
  holder: string;
  amount: number;
  priority: number;
  governmental?: boolean;
}

interface ComplianceRule {
  feeCap: number | null;
  capConfidence: string;
  capBasis: string;
  licenseRequired: boolean;
  licenseTypes: string[];
  registrationBody: string | null;
  requiredDisclosures: string[];
  statuteRefs: string[];
  lastVerified: string;
}

interface SurplusLead {
  id: string;
  claimant: string;
  claimantType: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string | null;
  caseNumber: string | null;
  parcelId: string | null;

  deceased: boolean;
  heirsRequired: boolean;
  isDeceased: boolean;
  competingLien: boolean;

  surplusType: string;
  fundLocation: string;

  stage: string;
  tier: string;
  dripTrack: string;

  saleDate: string | null;
  salePrice: number | null;
  noticeDate: string | null;
  noticeConfirmed: boolean;
  noticeAge: number | null;
  claimDeadline: string | null;
  daysRemaining: number | null;
  windowElapsedPct: number;
  certOfDisbursements: string | null;
  assignmentDeadline: string | null;
  assignmentDaysLeft: number | null;
  lienWindowOpen: boolean;

  grossSurplus: number;
  liens: Lien[];
  totalLiens: number;
  netToClaimant: number;
  estFee: number | null;

  arrangement: string;
  totalConsideration: number;
  pctOfGross: number;
  pctOfNet: number;
  governingPct: number;
  licensedRepId: string | null;

  entitlementVerified: boolean;
  titleSearchComplete: boolean;
  canQualify: boolean;
  disclosures: Record<string, boolean>;
  docs: Record<string, boolean>;

  compliance: {
    clear: boolean;
    blocks: string[];
    warns: string[];
    rule: ComplianceRule | null;
  };

  phones: Phone[];
  emails: string[];
  cleanPhoneCount: number;
  /** A skip trace returned somebody other than the claimant, so it was discarded. */
  contactMismatch: boolean;
  mismatchedName: string | null;
  doNotCall: boolean;
  callNotes: string;
  touchDays: Record<string, boolean>;
  totalTouches: number;

  // ── From the county poll ──────────────────────────────────────────────────
  /** SurplusClaimStatus: where the money stands on the clerk's docket. */
  claimStatus: string;
  claimStatusLabel: string;
  /** Call-now ranking. Claim status dominates, then contactability, then money. */
  workScore: number;
  workReason: string;
  surplusAtNotice: number | null;
  mailVerdict: string | null;
  claimLedger: { title: string; kind: string; docId?: string | null; url?: string | null }[] | null;
  sourceSystem: string | null;
  sourceCaseId: string | null;
  sourceUrl: string | null;
  lastPolledAt: string | null;
}

/** Tone for each claim status, matching the panel. */
const CLAIM_STATUS_CHIP: Record<string, { fg: string; bg: string }> = {
  denied: CHIP.mint,
  open: CHIP.mint,
  gov_lien: CHIP.amber,
  pending: CHIP.amber,
  assigned: CHIP.red,
  distributed: CHIP.red,
  unknown: CHIP.slate,
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SurplusFundsPage() {
  const [rows, setRows] = useState<SurplusLead[]>([]);
  const [counties, setCounties] = useState<{ active: string[]; candidate: string[] }>({
    active: [],
    candidate: [],
  });
  const [floor, setFloor] = useState(15000);
  const [disclosureLabels, setDisclosureLabels] = useState<Record<string, string>>({});
  const [stats, setStats] = useState({
    openClaims: 0,
    newSevenDays: 0,
    tierA: 0,
    complianceBlocked: 0,
    netInPipeline: 0,
    belowFloor: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [q, setQ] = useState('');
  // The board opens on the call-now order. Tier alone does not answer "who do
  // I ring first": it bands the dollars, and a big surplus whose owner already
  // signed with a competitor is worth less than a small one with a live number.
  const [sort, setSort] = useState('work');
  const [tierQ, setTierQ] = useState<string | null>(null);
  const [chipQ, setChipQ] = useState<string | null>(null);
  const [stageQ, setStageQ] = useState<string | null>(null);
  const [county, setCounty] = useState('active');
  const [band, setBand] = useState('all');
  const [ctype, setCtype] = useState('all');
  const [ageQ, setAgeQ] = useState('all');
  const [lienWin, setLienWin] = useState('all');
  const [hideDead, setHideDead] = useState(true);
  const [hideDnc, setHideDnc] = useState(true);

  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<RackView>('rack');
  /** The lead whose work panel is open, or null. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const say = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 6000);
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await surplusAPI.list({
        search: q || undefined,
        tier: tierQ || undefined,
        stage: stageQ || undefined,
        claimantType: ctype === 'all' ? undefined : ctype,
        county,
        band: band === 'all' ? undefined : band,
        // "New, 7 days" is the same window as the 0-7 notice-age filter, so the
        // quick chip drives the same query rather than a second one.
        noticeAge: chipQ === 'new' ? '0-7' : ageQ === 'all' ? undefined : ageQ,
        lienWindow: lienWin === 'all' ? undefined : lienWin,
        hideDead: hideDead || undefined,
        hideDnc: hideDnc || undefined,
        sort,
        pageSize: 200,
      });
      let data: SurplusLead[] = res.data.data || [];
      // Estate and competing-lien are properties of the loaded row, not query
      // parameters, so they narrow here rather than round-tripping.
      if (chipQ === 'estate') data = data.filter((r) => r.isDeceased);
      if (chipQ === 'lien') data = data.filter((r) => r.competingLien);
      setRows(data);
      setCounties(res.data.counties || { active: [], candidate: [] });
      setFloor(res.data.surplusFloor ?? 15000);
      setDisclosureLabels(res.data.disclosureLabels || {});
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Could not load surplus leads.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [q, tierQ, stageQ, ctype, county, band, chipQ, ageQ, lienWin, hideDead, hideDnc, sort]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await surplusAPI.stats();
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

  // The work panel composes messages as the logged-in user, and notes are
  // attributed to them.
  useEffect(() => {
    authAPI.getMe().then((res) => setCurrentUser(res.data)).catch(() => {});
  }, []);

  // The open row is read out of `rows` rather than held in its own state, so a
  // refresh after sending a message or enrolling a campaign flows straight into
  // the panel instead of leaving it showing a stale case.
  const openLead = openId ? rows.find((r) => r.id === openId) || null : null;

  // A lead that drops out of the current filter while its panel is open would
  // otherwise leave the panel mounted with nothing behind it.
  useEffect(() => {
    if (openId && !loading && !rows.some((r) => r.id === openId)) setOpenId(null);
  }, [openId, rows, loading]);

  /* Optimistic, then reconciled. The server recomputes the tier and re-runs the
     compliance gate on every write, so a card that only echoed the local change
     would keep saying "blocked" after the disclosure that unblocked it. */
  const patch = useCallback(
    async (id: string, body: any, optimistic?: Partial<SurplusLead>) => {
      if (optimistic) {
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...optimistic } : r)));
      }
      try {
        const res = await surplusAPI.update(id, body);
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
      const res = await surplusAPI.importExecute(f, { importBatch: f.name });
      const r = res.data;
      const mismatches = r.contactMismatches?.length || 0;
      say(
        `Imported ${r.created} lead${r.created === 1 ? '' : 's'} from ${f.name}` +
          (r.duplicates ? `, ${r.duplicates} already on file` : '') +
          (r.belowFloor ? `, ${r.belowFloor} under the ${money(floor)} floor` : '') +
          (r.errors?.length ? `, ${r.errors.length} row${r.errors.length === 1 ? '' : 's'} skipped` : '') +
          '.' +
          // Worth its own sentence: these leads landed WITHOUT contacts, and a
          // count buried in a list reads as a rounding detail rather than work.
          (mismatches
            ? ` ${mismatches} skip trace${mismatches === 1 ? '' : 's'} came back as a different person, so those contacts were discarded.`
            : ''),
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
      await surplusAPI.create(values);
      setAdding(false);
      say('Lead added.');
      fetchRows();
      fetchStats();
    } catch (err: any) {
      // The commonest rejection is the surplus floor, and the server says so.
      say(err?.response?.data?.message || 'That lead could not be added.');
    } finally {
      setSaving(false);
    }
  };

  const chosen = Object.keys(picked).filter((k) => picked[k]);

  const reset = () => {
    setQ('');
    setTierQ(null);
    setChipQ(null);
    setStageQ(null);
    setCounty('active');
    setBand('all');
    setCtype('all');
    setAgeQ('all');
    setLienWin('all');
    setHideDead(true);
    setHideDnc(true);
  };

  const csv = () => {
    const list = chosen.length ? rows.filter((r) => picked[r.id]) : rows;
    downloadCsv(
      `surplus_funds_${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'County', 'Case', 'Address', 'City', 'Zip', 'Parcel', 'Claimant', 'Claimant type',
        'Surplus type', 'Fund location', 'Sale date', 'Sale price', 'Notice date',
        'Notice confirmed', 'Claim deadline', 'Days remaining', 'Gross surplus', 'Total liens',
        'Net to claimant', 'Tier', 'Drip track', 'Stage', 'Arrangement', 'Total consideration',
        '% of gross', '% of net', 'Fee cap', 'Cap confidence', 'Compliance', 'Blocks',
        'Cert of disbursements', 'Assignment deadline', 'Phones', 'Emails', 'Touches', 'Notes',
      ],
      list.map((r) => [
        r.county, r.caseNumber, r.address, r.city, r.zip, r.parcelId, r.claimant,
        CLAIMANT_TYPE_LABEL[r.claimantType] || r.claimantType,
        r.surplusType === 'tax_deed' ? 'Tax deed' : 'Mortgage FC',
        r.fundLocation === 'clerk' ? 'Held by clerk' : 'Escheated to DFS',
        fmtDate(r.saleDate), r.salePrice, fmtDate(r.noticeDate), r.noticeConfirmed ? 'Yes' : 'No',
        fmtDate(r.claimDeadline), r.daysRemaining, r.grossSurplus, r.totalLiens, r.netToClaimant,
        r.tier, r.dripTrack, r.stage,
        r.arrangement === 'assignment' ? 'Assignment of rights' : 'Limited power of attorney',
        r.totalConsideration, pct(r.pctOfGross), pct(r.pctOfNet),
        r.compliance.rule ? (r.compliance.rule.feeCap == null ? 'none' : `${r.compliance.rule.feeCap}%`) : 'no rule',
        r.compliance.rule?.capConfidence || '-',
        r.compliance.clear ? 'Clear' : 'Blocked', r.compliance.blocks.join(' | '),
        fmtDate(r.certOfDisbursements), fmtDate(r.assignmentDeadline),
        r.phones.map((p) => phoneDisplay(p.number)).join(' | '), r.emails.join(' | '),
        r.totalTouches, r.callNotes,
      ]),
    );
    say(`Exported ${list.length} lead${list.length === 1 ? '' : 's'}.`);
  };

  const countyOpts: [string, string][] = [
    ['active', 'Active counties'],
    ['all', 'All Florida counties'],
    ...counties.active.map((c) => [c, c] as [string, string]),
    ...counties.candidate.map((c) => [c, `${c} (candidate)`] as [string, string]),
  ];

  return (
    <AppShell>
      <div className="dc-board" style={{ background: 'var(--bg)', minHeight: '100vh', padding: 26 }}>
        <div style={{ maxWidth: 1600, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <h1 className="dc-h1">Surplus Funds</h1>
              <div className="dc-sub">
                Florida tax deed and mortgage foreclosure overages. Contract send is gated on the fee cap, not warned about.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={onFile} />
              <button className="dc-btn" onClick={() => { fetchRows(); fetchStats(); }} disabled={loading}>
                Refresh feed
              </button>
              <button className="dc-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? 'Importing...' : 'Import county list'}
              </button>
              <button className="dc-btn pri" onClick={() => setAdding(true)}>
                Add lead
              </button>
            </div>
          </div>

          <div style={{ color: 'var(--dim)', fontSize: 13, margin: '18px 0 16px' }}>
            {loading ? (
              'Loading from Dealcore...'
            ) : (
              <>
                {stats.openClaims} surplus lead{stats.openClaims === 1 ? '' : 's'} loaded
                {stats.belowFloor > 0 && <>, {stats.belowFloor} below the {money(floor)} floor</>}
              </>
            )}
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
              <div className="k">Open claims</div>
              <div className="v">{stats.openClaims}</div>
            </div>
            <button className={`dc-stat${chipQ === 'new' ? ' on' : ''}`} onClick={() => setChipQ(chipQ === 'new' ? null : 'new')}>
              <div className="k">New, 7 days</div>
              <div className="v" style={{ color: 'var(--red)' }}>{stats.newSevenDays}</div>
            </button>
            <button className={`dc-stat${tierQ === 'A' ? ' on' : ''}`} onClick={() => setTierQ(tierQ === 'A' ? null : 'A')}>
              <div className="k">Tier A</div>
              <div className="v" style={{ color: 'var(--amber)' }}>{stats.tierA}</div>
            </button>
            {CONTRACTS_ENABLED && (
              <div className="dc-stat">
                <div className="k">Compliance blocked</div>
                <div className="v" style={{ color: 'var(--red)' }}>{stats.complianceBlocked}</div>
              </div>
            )}
            <div className="dc-stat">
              <div className="k">Net in pipeline</div>
              <div className="v" style={{ color: 'var(--mint)', fontSize: 24 }}>{money(stats.netInPipeline)}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div className="dc-search" style={{ flex: '1 1 320px' }}>
              <span>🔍</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search claimant, address, county, case number..."
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
                ['work', 'Sort: Call first'],
                ['notice', 'Sort: Newest notice'],
                ['surplus', 'Sort: Surplus size'],
                ['net', 'Sort: Net to claimant'],
                ['tier', 'Sort: Tier'],
              ]}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <span className="dc-flabel">Quick filters</span>
            {['A', 'B', 'C'].map((t) => (
              <button key={t} className={`dc-tab${tierQ === t ? ' on' : ''}`} onClick={() => setTierQ(tierQ === t ? null : t)}>
                {TIER[t].icon} {TIER[t].label}
              </button>
            ))}
            <span className="dc-sep" />
            {(
              [
                ['new', 'New, 7 days'],
                ['estate', 'Estate or probate'],
                ['lien', 'Competing lien filed'],
              ] as [string, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                className={`dc-tab${chipQ === k ? ' on' : ''}`}
                onClick={() => setChipQ(chipQ === k ? null : k)}
                title={
                  k === 'lien'
                    ? 'Informational. Does not block outreach, but the payout may land under the posted surplus.'
                    : undefined
                }
              >
                {l}
              </button>
            ))}
            <span className="dc-sep" />
            {['Agreement Signed', 'Claim Filed', 'Paid'].map((k) => (
              <button key={k} className={`dc-tab${stageQ === k ? ' on' : ''}`} onClick={() => setStageQ(stageQ === k ? null : k)}>
                {k}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <span className="dc-flabel">Filters</span>
            <Sel v={county} set={setCounty} opts={countyOpts} />
            <Sel v={band} set={setBand} opts={[['all', 'Any surplus'], ['15-25', '$15k to $25k'], ['25-50', '$25k to $50k'], ['50+', '$50k+']]} />
            <Sel
              v={ctype}
              set={setCtype}
              opts={[['all', 'Owners and heirs'] as [string, string]].concat(
                Object.entries(CLAIMANT_TYPE_LABEL) as [string, string][],
              )}
            />
            <Sel
              v={ageQ}
              set={setAgeQ}
              opts={[['all', 'Any notice age'], ['0-7', '0 to 7 days'], ['8-30', '8 to 30 days'], ['31-120', '31 to 120 days'], ['120+', '120+ days']]}
            />
            <Sel
              v={lienWin}
              set={setLienWin}
              opts={[['all', 'Any lienholder window'], ['open', 'Lienholder window open'], ['closed', 'Lienholder window closed']]}
            />
            <Sel
              v={stageQ || 'all'}
              set={(v) => setStageQ(v === 'all' ? null : v)}
              opts={[['all', 'Any pipeline status'] as [string, string]].concat(
                SURPLUS_STAGES.map((x) => [x, x] as [string, string]),
              )}
            />
            <button className={`dc-danger${hideDead ? '' : ' off'}`} onClick={() => setHideDead(!hideDead)}>
              Hide dead
            </button>
            <button className={`dc-danger${hideDnc ? '' : ' off'}`} onClick={() => setHideDnc(!hideDnc)}>
              Hide Do-Not-Call
            </button>
          </div>

          <div style={{ display: 'flex', marginBottom: 16 }}>
            <button className="dc-btn" style={{ marginLeft: 'auto' }} onClick={reset}>
              Reset filters
            </button>
          </div>

          {adding && (
            <AddLeadSheet
              title="New surplus lead"
              note={`It is filed as a SURPLUS record, so it can only ever appear in this pipeline. A surplus under ${money(floor)} is refused outright rather than filtered out of a view.`}
              fields={SURPLUS_FIELDS}
              submitting={saving}
              onAdd={addLead}
              onClose={() => setAdding(false)}
            />
          )}

          <LeadRack
            items={rows}
            keyOf={(r) => r.id}
            view={view}
            onViewChange={setView}
            empty={
              <div className="dc-empty">
                {loading
                  ? 'Loading...'
                  : stats.total === 0
                    ? 'No surplus leads yet. Import a county list to get started.'
                    : 'Nothing matches those filters.'}
              </div>
            }
            toolbarLeft={
              <span style={{ color: 'var(--dim)', fontSize: 13 }}>
                {rows.length} lead{rows.length === 1 ? '' : 's'}
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
                    className={rows.length > 0 && rows.every((r) => picked[r.id]) ? 'on' : ''}
                    onClick={() => {
                      const n: Record<string, boolean> = {};
                      rows.forEach((r) => {
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
              <SurplusCard
                r={r}
                onOpen={() => setOpenId(r.id)}
                picked={!!picked[r.id]}
                onPick={(on) => setPicked({ ...picked, [r.id]: on })}
                editing={!!editing[r.id]}
                onEditing={(on) => setEditing({ ...editing, [r.id]: on })}
                disclosureLabels={disclosureLabels}
                patch={patch}
                copy={copy}
                say={say}
              />
            )}
          />

          <div style={{ height: 34 }} />
        </div>

        {openLead && (
          <SurplusWorkPanel
            lead={openLead as any}
            currentUser={currentUser}
            onClose={() => setOpenId(null)}
            onChanged={() => {
              fetchRows();
              fetchStats();
            }}
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
              maxWidth: 560, textAlign: 'center',
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

function Sel({ v, set, opts }: { v: string; set: (v: string) => void; opts: [string, string][] }) {
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

interface CardProps {
  r: SurplusLead;
  onOpen: () => void;
  picked: boolean;
  onPick: (on: boolean) => void;
  editing: boolean;
  onEditing: (on: boolean) => void;
  disclosureLabels: Record<string, string>;
  patch: (id: string, body: any, optimistic?: Partial<SurplusLead>) => void;
  copy: (v: string) => void;
  say: (t: string) => void;
}

function SurplusCard({ r, onOpen, picked, onPick, editing, onEditing, disclosureLabels, patch, copy, say }: CardProps) {
  const tier = TIER[r.tier] || TIER.U;
  const stageColor = SURPLUS_STAGE_COLOR[r.stage] || CHIP.slate;
  const dripColor = DRIP_TRACK_COLOR[r.dripTrack] || CHIP.blue;
  const rem = r.daysRemaining;
  const g = r.compliance;

  const clockColor =
    !r.noticeConfirmed || rem === null
      ? 'var(--faint)'
      : rem < 30
        ? 'var(--red)'
        : rem <= 60
          ? 'var(--amber)'
          : 'var(--mint)';
  const barColor = rem !== null && rem < 30 ? 'var(--red)' : rem !== null && rem <= 60 ? 'var(--amber)' : 'var(--mint)';
  const claimChip = CLAIM_STATUS_CHIP[r.claimStatus] || CHIP.slate;

  const setPhone = (i: number, next: Partial<Phone>) => {
    const nx = r.phones.map((p, k) => (k === i ? { ...p, ...next } : p));
    patch(r.id, { phones: nx }, { phones: nx });
  };

  return (
    <div className={`dc-lead${picked ? ' pick' : ''}`} style={{ borderTopColor: tier.fg }}>
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
              {r.claimant}
            </span>
            <button className="dc-copy" onClick={() => copy(r.claimant)}>
              ⧉
            </button>
          </div>
          <div style={{ color: 'var(--dim)', fontSize: 12.5, marginTop: 2 }}>
            {r.address}, {r.city} · {r.county} County
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
          <div className="dc-score" style={{ borderColor: tier.fg }}>
            <b style={{ color: tier.fg, fontSize: 15 }}>{tier.icon}</b>
            <span>Tier {r.tier}</span>
          </div>
          <button className="dc-btn xs" onClick={onOpen} title={r.workReason}>
            Work it
          </button>
        </div>
      </div>

      {/* Why this lead ranks where it does. The order has to be auditable, so
          the reason travels with the card rather than living in the sort. */}
      <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 6 }}>{r.workReason}</div>

      <div className="dc-cardbody">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className="dc-tag" style={{ background: stageColor.bg, color: stageColor.fg }}>
            {r.stage}
          </span>
          <span className="dc-tag" style={{ background: dripColor.bg, color: dripColor.fg }}>
            {r.dripTrack}
          </span>
          <span
            className="dc-tag"
            style={{ background: claimChip.bg, color: claimChip.fg }}
            title={r.workReason}
          >
            {r.claimStatusLabel}
          </span>
          <span className="dc-tag" style={{ background: 'var(--surface3)', color: 'var(--text)' }}>
            {r.surplusType === 'tax_deed' ? 'Tax deed' : 'Mortgage FC'}
          </span>
          {r.fundLocation === 'state_escheated' && (
            <span className="dc-tag" style={{ background: CHIP.red.bg, color: CHIP.red.fg }}>
              Escheated
            </span>
          )}
        </div>

        {/* Claim clock. */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <Lbl style={{ margin: 0 }}>Claim clock</Lbl>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: clockColor }}>
              {rem === null ? 'No notice date' : rem < 0 ? `${Math.abs(rem)}d past` : `${rem}d left`}
            </span>
          </div>
          <div className="dc-bar" style={{ opacity: r.noticeConfirmed ? 1 : 0.35 }}>
            <i style={{ width: `${r.windowElapsedPct}%`, background: barColor }} />
          </div>
          {!r.noticeConfirmed && (
            <div style={{ color: 'var(--amber)', fontSize: 11.5, marginTop: 5, fontWeight: 600 }}>
              Notice date unconfirmed, this countdown is a guess
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <Stat label="Gross surplus" value={money(r.grossSurplus)} />
          <Stat label="Net to claimant" value={money(r.netToClaimant)} color="var(--mint)" bold />
          <Stat label="Est. fee" value={r.estFee === null ? '-' : money(r.estFee)} />
        </div>

        {/* Compliance strip. This is the gate, not a warning. */}
        {CONTRACTS_ENABLED && (
          <div className={`dc-panel ${g.clear ? 'ok' : 'bad'}`}>
            <div
              className="head"
              style={{ color: g.clear ? 'var(--mint)' : 'var(--redHead)', marginBottom: g.blocks.length || g.warns.length ? 7 : 0 }}
            >
              <span>{g.clear ? '✓' : '⛔'}</span>
              {g.clear
                ? 'Clear to send a contract'
                : `Contract send blocked, ${g.blocks.length} blocker${g.blocks.length === 1 ? '' : 's'}`}
            </div>
            {/* Blockers and warnings used to render as near-identical bullets, so a
                header reading "1 issue" sat above three lines and looked like a
                miscount. Label each group and say plainly which one stops a send. */}
            {g.blocks.length > 0 && (
              <>
                <div className="dc-gate-lbl" style={{ color: 'var(--redHead)' }}>
                  Must fix to send
                </div>
                {g.blocks.map((b, i) => (
                  <div key={i} className="note" style={{ color: 'var(--redBody)' }}>
                    · {b}
                  </div>
                ))}
              </>
            )}
            {g.warns.length > 0 && (
              <>
                <div
                  className="dc-gate-lbl"
                  style={{ color: 'var(--amberBody)', marginTop: g.blocks.length ? 9 : 0 }}
                >
                  Heads up, does not block sending
                </div>
                {g.warns.map((w, i) => (
                  <div key={i} className="note" style={{ color: 'var(--amberBody)' }}>
                    · {w}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

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
                    onChange={(e) => setPhone(i, { number: e.target.value })}
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
                  <button className="dc-btn xs dngr" onClick={() => patch(r.id, { phones: r.phones.filter((_, k) => k !== i) })}>
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
            </>
          ) : (
            <>
              {r.phones.length === 0 && r.emails.length === 0 && !r.contactMismatch && (
                <div style={{ color: 'var(--faint)', fontSize: 12.5, paddingBottom: 6 }}>No contact details yet.</div>
              )}
              {r.contactMismatch && (
                <div
                  style={{
                    color: 'var(--amberBody)', background: 'rgba(180,83,9,.12)',
                    border: '1px solid var(--amber)', borderRadius: 8,
                    padding: '8px 10px', fontSize: 11.5, lineHeight: 1.5, marginBottom: 8, fontWeight: 600,
                  }}
                >
                  Skip trace came back as {r.mismatchedName || 'a different person'}, not {r.claimant}. Those
                  contacts were discarded rather than stored. Re-trace or find the claimant by hand.
                </div>
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
                      {phoneDisplay(ph.number) || '-'}
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
            {/* Skip trace is not wired for this pipeline yet. The existing
                enricher is bound to LeadSource.FORECLOSURE and to NC OneMap,
                which does not cover Florida at all. */}
            <button className="dc-btn sm" disabled title="Skip trace is not wired up for surplus funds yet">
              ↻ Skip trace
            </button>
            {CONTRACTS_ENABLED && (
              <button
                className="dc-btn sm pri"
                style={{ flex: 1, justifyContent: 'center' }}
                disabled={!g.clear}
                title={g.clear ? 'Send the fee agreement' : 'Blocked by compliance'}
                onClick={() => {
                  // Sending is not signing. The pipeline only advances to
                  // Agreement Signed when it actually comes back executed.
                  if (r.stage === 'New') patch(r.id, { stage: 'Contacted' });
                  say('Agreement queued for signature.');
                }}
              >
                Send contract
              </button>
            )}
          </div>
        </div>

        <div>
          <Lbl style={{ marginBottom: 6 }}>Stage</Lbl>
          <select
            className="dc-in"
            value={r.stage}
            style={{ fontSize: 12.5, padding: '8px 10px' }}
            onChange={(e) => {
              const next = e.target.value;
              if (next === 'Agreement Signed' && !r.canQualify) {
                say('An agreement needs entitlement verified, notice date confirmed, and title search complete.');
                return;
              }
              patch(r.id, { stage: next }, { stage: next });
            }}
          >
            {SURPLUS_STAGES.concat(['Dead']).map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
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

        {/* Lien waterfall. */}
        <div style={{ marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <Lbl style={{ marginBottom: 8 }}>Lien waterfall</Lbl>
          <Line label="Gross surplus" value={money(r.grossSurplus)} bold />
          {r.liens.length === 0 && (
            <div style={{ color: 'var(--faint)', fontSize: 12.5, padding: '5px 0' }}>No liens of record.</div>
          )}
          {r.liens.map((l, i) => (
            <Line
              key={i}
              label={
                <>
                  {l.type}
                  <span style={{ color: 'var(--faint)' }}> · {l.holder}</span>
                  {l.governmental && (
                    <span className="dc-tag" style={{ background: 'var(--surface3)', color: 'var(--dim)', fontSize: 10, padding: '2px 6px', marginLeft: 6 }}>
                      paid first
                    </span>
                  )}
                </>
              }
              value={`-${money(l.amount)}`}
              valueColor="var(--red)"
            />
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0 0', marginTop: 5, borderTop: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 700 }}>Net to claimant</span>
            <span style={{ fontWeight: 800, color: 'var(--mint)' }}>{money(r.netToClaimant)}</span>
          </div>
        </div>

        {/* Document checklist. */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <Lbl style={{ marginBottom: 8 }}>Documents</Lbl>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {Object.keys(DOC_LABEL).map((k) => {
              const on = !!r.docs?.[k];
              return (
                <button
                  key={k}
                  onClick={() => patch(r.id, { docs: { [k]: !on } })}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, textAlign: 'left', padding: '3px 0' }}
                >
                  <span className={`dc-check${on ? ' on' : ''}`}>✓</span>
                  <span style={{ color: on ? 'var(--dim)' : 'var(--text)' }}>{DOC_LABEL[k]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="dc-meta">
          <Meta k="Sale date" v={fmtDate(r.saleDate)} />
          <Meta k="Sale price" v={money(r.salePrice)} />
          <Meta k="Notice date" v={r.noticeDate ? fmtDate(r.noticeDate) : 'Unconfirmed'} color={r.noticeConfirmed ? undefined : 'var(--amber)'} />
          <Meta k="Claim deadline" v={fmtDate(r.claimDeadline)} />
          <Meta k="Cert. of disbursements" v={fmtDate(r.certOfDisbursements)} small />
          <Meta
            k="Assignment deadline"
            v={r.assignmentDeadline ? `${fmtDate(r.assignmentDeadline)} (${r.assignmentDaysLeft}d)` : '-'}
            color={r.assignmentDaysLeft !== null && r.assignmentDaysLeft <= 14 ? 'var(--red)' : undefined}
            small
          />
          <Meta k="Arrangement" v={r.arrangement === 'assignment' ? 'Assignment of rights' : 'Limited power of attorney'} small />
          <Meta k="Fund location" v={r.fundLocation === 'clerk' ? 'Held by clerk' : 'Escheated to DFS'} small />
          <Meta k="Total consideration" v={money(r.totalConsideration)} />
          <Meta
            k="Against cap"
            v={
              <>
                {r.totalConsideration ? pct(r.governingPct) : '-'}
                <span style={{ color: 'var(--faint)', fontWeight: 500, fontSize: 11.5 }}>
                  {g.rule && g.rule.feeCap != null ? ` of ${g.rule.feeCap}%` : ' no cap on file'}
                </span>
              </>
            }
            color={g.rule && g.rule.feeCap != null && r.governingPct > g.rule.feeCap ? 'var(--red)' : undefined}
          />
        </div>

        {/* The rule itself, so a block can be read rather than just obeyed. */}
        {g.rule && (
          <div className="dc-rule" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 12.5 }}>Governing rule</span>
              <span
                className="dc-tag"
                style={{
                  background: g.rule.capConfidence === 'confirmed' ? CHIP.mint.bg : CHIP.amber.bg,
                  color: g.rule.capConfidence === 'confirmed' ? CHIP.mint.fg : CHIP.amber.fg,
                  fontSize: 11.5,
                  padding: '3px 8px',
                }}
              >
                {g.rule.capConfidence}
              </span>
              <span style={{ color: 'var(--faint)', fontSize: 11.5 }}>
                {g.rule.statuteRefs.join(', ')} · verified {fmtDate(g.rule.lastVerified)}
              </span>
            </div>
            <div style={{ color: 'var(--dim)', fontSize: 11.5, lineHeight: 1.6 }}>{g.rule.capBasis}</div>
            {g.rule.licenseRequired && (
              <div style={{ color: 'var(--redBody)', fontSize: 11.5, lineHeight: 1.6, marginTop: 8, fontWeight: 600, background: 'var(--redGhost)', padding: '8px 10px', borderRadius: 8 }}>
                Requires a representative registered with {g.rule.registrationBody}: {g.rule.licenseTypes.join(', ')}.
              </div>
            )}
            {/* Only reachable state for these is "ticked so a send unblocks",
                so they follow the send rather than standing on their own. */}
            {CONTRACTS_ENABLED && (
            <div style={{ marginTop: 10 }}>
              <Lbl style={{ marginBottom: 6 }}>Required disclosures</Lbl>
              {g.rule.requiredDisclosures.map((d) => {
                const on = !!r.disclosures?.[d];
                return (
                  <button
                    key={d}
                    onClick={() => patch(r.id, { disclosures: { [d]: !on } })}
                    style={{ display: 'flex', gap: 8, alignItems: 'flex-start', textAlign: 'left', padding: '4px 0', width: '100%' }}
                  >
                    <span className={`dc-check${on ? ' on' : ' want'}`} style={{ marginTop: 1 }}>
                      ✓
                    </span>
                    <span style={{ fontSize: 11.5, lineHeight: 1.5, color: on ? 'var(--dim)' : 'var(--text)' }}>
                      {disclosureLabels[d] || d}
                    </span>
                  </button>
                );
              })}
            </div>
            )}
          </div>
        )}

        {/* Qualification gate. */}
        <div style={{ marginTop: 12 }}>
          <Lbl style={{ marginBottom: 6 }}>Qualification gate</Lbl>
          {(
            [
              ['entitlementVerified', 'Entitlement verified'],
              ['noticeConfirmed', 'Notice date confirmed with the clerk'],
              ['titleSearchComplete', 'Title search complete'],
            ] as [keyof SurplusLead, string][]
          ).map(([k, label]) => {
            const on = !!r[k];
            return (
              <button
                key={k}
                onClick={() => patch(r.id, { [k]: !on }, { [k]: !on } as Partial<SurplusLead>)}
                style={{ display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left', padding: '4px 0', width: '100%' }}
              >
                <span className={`dc-check${on ? ' on' : ''}`}>✓</span>
                <span style={{ fontSize: 12.5, color: on ? 'var(--dim)' : 'var(--text)' }}>{label}</span>
              </button>
            );
          })}
          {!r.canQualify && (
            <div style={{ color: 'var(--amber)', fontSize: 11.5, marginTop: 6, fontWeight: 600 }}>
              Cannot move to Agreement Signed until all three are ticked.
            </div>
          )}
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

function Line({ label, value, valueColor, bold }: { label: React.ReactNode; value: string; valueColor?: string; bold?: boolean }) {
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

/** Saved on blur: the card re-renders from the server after each write, which
    would otherwise take the cursor with it on every keystroke. */
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
