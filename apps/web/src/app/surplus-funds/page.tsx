'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AppShell from '@/components/AppShell';
import LeadRack, { RackView } from '@/components/pipelines/LeadRack';
import AddLeadSheet, { SURPLUS_FIELDS } from '@/components/pipelines/AddLeadSheet';
import SurplusWorkPanel from '@/components/pipelines/SurplusWorkPanel';
import SurplusPropertyCard from '@/components/pipelines/SurplusPropertyCard';
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
  noticeRecipient: string | null;
  ownerMailingStreet: string | null;
  ownerMailingCity: string | null;
  ownerMailingState: string | null;
  ownerMailingZip: string | null;
  ownerAddressSource: string | null;
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
  /**
   * Subject properties, not leads. One sale can owe several claimants and each
   * is its own lead; the API groups them so a house is one card with N owners
   * instead of N identical-looking cards.
   */
  const [rows, setRows] = useState<any[]>([]);
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
  /** Total claimant leads behind the properties on screen. */
  const [leadCount, setLeadCount] = useState(0);
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
      let data: any[] = res.data.data || [];
      // Estate and competing-lien are facts about the loaded row, not query
      // parameters, so they narrow here rather than round-tripping. They read
      // off the group's rolled-up flags, since a property counts if ANY
      // claimant on it qualifies.
      if (chipQ === 'estate') data = data.filter((r) => r.anyDeceased);
      if (chipQ === 'lien') data = data.filter((r) => r.competingLien);
      setRows(data);
      setLeadCount(res.data.leadCount ?? data.length);
      setCounties(res.data.counties || { active: [], candidate: [] });
      setFloor(res.data.surplusFloor ?? 15000);
      setDisclosureLabels(res.data.disclosureLabels || {});
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Could not load surplus leads.');
      setRows([]);
      setLeadCount(0);
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
  const openProperty = openId ? rows.find((r) => r.key === openId) || null : null;

  // A lead that drops out of the current filter while its panel is open would
  // otherwise leave the panel mounted with nothing behind it.
  useEffect(() => {
    if (openId && !loading && !rows.some((r) => r.key === openId)) setOpenId(null);
  }, [openId, rows, loading]);

  /**
   * Save a change to one CLAIMANT. Rows are properties now, so the edited lead
   * sits inside a group and the server recomputes the group's rank and status
   * from it. Refetching is both simpler and more correct than patching a nested
   * row: a status change can reorder the whole board.
   */
  const patch = useCallback(
    async (id: string, body: any) => {
      try {
        await surplusAPI.update(id, body);
        fetchRows();
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

  // A picked card is a PROPERTY; bulk actions operate on the leads under it,
  // since a claim is filed per claimant and not per house.
  const chosenKeys = Object.keys(picked).filter((k) => picked[k]);
  const chosen = rows
    .filter((r) => picked[r.key])
    .flatMap((r) => r.claimants.map((c: any) => c.id));

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

  /**
   * Move every claimant on the selected properties to one stage.
   *
   * Dead is the common case: a board is cleared by retiring what has been
   * worked, not by deleting it, so the classifier's verdict and the trace
   * history survive for the next poll to compare against.
   */
  const bulkStage = async (stage: string) => {
    if (!chosen.length || busy) return;
    setBusy(true);
    try {
      const res = await surplusAPI.bulkStage(chosen, stage);
      say(`Moved ${res.data?.updated ?? chosen.length} claimant${chosen.length === 1 ? '' : 's'} to ${stage}`);
      setPicked({});
      fetchRows();
      fetchStats();
    } catch (err: any) {
      say(err?.response?.data?.message || 'Those leads could not be updated.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Permanent, and confirmed first. Ingestion is idempotent on dedupeUid, so a
   * deleted lead comes straight back on the next poll; marking it Dead is
   * usually what somebody actually wants.
   */
  const bulkDelete = async () => {
    if (!chosen.length || busy) return;
    const n = chosen.length;
    const ok = window.confirm(
      `Permanently delete ${n} claimant lead${n === 1 ? '' : 's'} across ${chosenKeys.length} propert${chosenKeys.length === 1 ? 'y' : 'ies'}?\n\n` +
        'The next county poll will re-create anything still on the docket. To retire a lead for good, mark it Dead instead.',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await surplusAPI.bulkDelete(chosen);
      say(`Deleted ${n} lead${n === 1 ? '' : 's'}`);
      setPicked({});
      fetchRows();
      fetchStats();
    } catch (err: any) {
      say(err?.response?.data?.message || 'Those leads could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  const csv = () => {
    // One row per CLAIMANT, not per property: a claim is filed per person, and
    // a downstream call list is dialled per person.
    const source = chosenKeys.length ? rows.filter((r) => picked[r.key]) : rows;
    const list: any[] = source.flatMap((r: any) => r.claimants);
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
        r.phones.map((p: any) => phoneDisplay(p.number)).join(' | '), r.emails.join(' | '),
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
                {stats.openClaims} surplus claim{stats.openClaims === 1 ? '' : 's'} across{' '}
                {rows.length} propert{rows.length === 1 ? 'y' : 'ies'}
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
            keyOf={(r) => r.key}
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
                {rows.length} propert{rows.length === 1 ? 'y' : 'ies'}
                {leadCount !== rows.length && `, ${leadCount} claimants`}
                {chosenKeys.length > 0 && (
                  <>
                    {' '}· <b style={{ color: 'var(--mint)' }}>{chosenKeys.length} selected</b>
                  </>
                )}
              </span>
            }
            toolbarRight={
              <>
                <div className="dc-seg" title="Select or clear every card currently shown">
                  <button
                    className={rows.length > 0 && rows.every((r) => picked[r.key]) ? 'on' : ''}
                    onClick={() => {
                      const n: Record<string, boolean> = {};
                      rows.forEach((r) => {
                        n[r.key] = true;
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
                {/* Bulk actions operate on the CLAIMANTS under the selected
                    properties, because a stage and a deletion both belong to a
                    claim rather than to a house. */}
                {chosenKeys.length > 0 && (
                  <>
                    <button
                      className="dc-btn sm"
                      disabled={busy}
                      onClick={() => bulkStage('Dead')}
                      title="Mark every claimant on the selected properties as dead"
                    >
                      Mark dead
                    </button>
                    <button
                      className="dc-btn sm dngr"
                      disabled={busy}
                      onClick={bulkDelete}
                      title="Permanently delete these leads"
                    >
                      Delete
                    </button>
                  </>
                )}
                <button style={{ color: 'var(--mint)', fontWeight: 600, fontSize: 13 }} onClick={csv}>
                  Download {chosenKeys.length ? 'selected' : 'shown'} as CSV
                </button>
              </>
            }
            renderItem={(r) => (
              <SurplusPropertyCard
                p={r}
                picked={!!picked[r.key]}
                onPick={(on) => setPicked({ ...picked, [r.key]: on })}
                onOpen={() => setOpenId(r.key)}
              />
            )}
          />

          <div style={{ height: 34 }} />
        </div>

        {openProperty && (
          <SurplusWorkPanel
            property={openProperty}
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
