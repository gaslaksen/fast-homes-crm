'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AppShell from '@/components/AppShell';
import PipelineBoard, { type PipelineView } from '@/components/pipelines/PipelineBoard';
import AddLeadSheet, { SURPLUS_FIELDS } from '@/components/pipelines/AddLeadSheet';
import SurplusWorkPanel from '@/components/pipelines/SurplusWorkPanel';
import SurplusPropertyCard, { STATUS_ACCENT } from '@/components/pipelines/SurplusPropertyCard';
import type { PipelineColumn, PipelineStage } from '@/components/pipelines/PipelineBoard';
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
  moneyShort,
  agoLabel,
  agoDays,
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
  /** One of us mailed a letter. Date and the address on the envelope. */
  letterMailedAt: string | null;
  letterMailedTo: string | null;
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

/**
 * The table, in the order somebody triages: is anyone else on this money, how
 * much, whose is it, where are they, can we reach them. Same question order as
 * the card, so switching views does not switch mental models.
 */
const QUEUE_CHIP: Record<string, { bg: string; fg: string }> = {
  call: CHIP.mint,
  trace: CHIP.blue,
  name_search: CHIP.amber,
  entity: CHIP.violet,
  // Red because it is a hard block, not a contact problem: nobody can sign.
  heirs: CHIP.red,
  closed: CHIP.slate,
};

const SURPLUS_COLUMNS: PipelineColumn<any>[] = [
  {
    // What to do with this one, first column and first read. Sorts on the
    // work score so "Call now" rows arrive in call order rather than
    // alphabetically by queue name.
    key: 'queue',
    label: 'Next step',
    width: '150px',
    sortValue: (r) => r.workScore,
    render: (r) => {
      const c = QUEUE_CHIP[r.queue] || CHIP.slate;
      const others = Object.entries(r.queueCounts || {}).filter(([k]) => k !== r.queue);
      return (
        <div>
          <span className="dc-tag" style={{ background: c.bg, color: c.fg }}>
            {r.queueLabel}
          </span>
          {/* A property takes its best claimant's queue, so say when the others
              are somewhere else rather than implying the whole house is
              callable. */}
          {others.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>
              +{others.reduce((n, [, v]) => n + (v as number), 0)} elsewhere
            </div>
          )}
        </div>
      );
    },
  },
  {
    key: 'claimStatus',
    label: 'Status',
    width: '150px',
    sortValue: (r) => r.workScore,
    render: (r) => {
      const c = CLAIM_STATUS_CHIP[r.claimStatus] || CHIP.slate;
      return (
        <span className="dc-tag" style={{ background: c.bg, color: c.fg }}>
          {r.claimStatusLabel}
        </span>
      );
    },
  },
  {
    key: 'surplus',
    label: 'Surplus',
    align: 'right',
    width: '92px',
    nowrap: true,
    sortValue: (r) => r.grossSurplus,
    render: (r) => <b title={money(r.grossSurplus)}>{moneyShort(r.grossSurplus)}</b>,
  },
  {
    key: 'property',
    label: 'Property',
    sortValue: (r) => r.address || '',
    render: (r) => (
      <div>
        <div style={{ fontWeight: 600 }}>{r.address}</div>
        <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
          {[r.city, r.zip].filter(Boolean).join(' ')} · {r.county} · {r.caseNumber}
        </div>
      </div>
    ),
  },
  {
    key: 'claimants',
    label: 'Claimants',
    sortValue: (r) => r.claimantNames[0] || '',
    render: (r) => (
      <div>
        <div style={r.allDeceased ? { textDecoration: 'line-through', color: 'var(--dim)' } : undefined}>
          {r.claimantNames.slice(0, 2).join(', ')}
        </div>
        {r.claimantCount > 2 && (
          <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>+{r.claimantCount - 2} more</div>
        )}
        {/* The whole point of the heirs work: say who can actually sign, so
            nobody spends an afternoon on a dead claimant. */}
        {r.anyDeceased && (
          <div
            style={{
              fontSize: 11.5,
              color: r.needsHeirs ? 'var(--red)' : 'var(--mint)',
            }}
          >
            {r.needsHeirs
              ? 'deceased, no heirs on file'
              : `${r.livingHeirCount} heir${r.livingHeirCount === 1 ? '' : 's'}${
                  r.callableHeirCount ? `, ${r.callableHeirCount} callable` : ', no number'
                }`}
          </div>
        )}
      </div>
    ),
  },
  {
    key: 'owner',
    label: 'Owner address',
    width: '150px',
    nowrap: true,
    sortValue: (r) => r.ownerMailingState || '',
    render: (r) => (
      <div>
        {r.ownerMailingStreet ? (
          <span
            style={{ color: 'var(--mint)', fontSize: 12 }}
            title={[r.ownerMailingStreet, r.ownerMailingCity, r.ownerMailingState, r.ownerMailingZip]
              .filter(Boolean)
              .join(', ')}
          >
            {[r.ownerMailingCity, r.ownerMailingState].filter(Boolean).join(', ')}
          </span>
        ) : (
          <span style={{ color: 'var(--faint)', fontSize: 12 }}>not recovered</span>
        )}
        {/* Which envelopes have gone out, so the row says so before anyone
            opens the panel to write the same person twice. */}
        {r.letterMailedCount > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--faint)' }} title={`${r.letterMailedCount} of ${r.claimantCount} claimant${r.claimantCount === 1 ? '' : 's'} mailed`}>
            {'✉'} Letter sent {fmtDate(r.letterMailedAt)}
            {r.letterMailedCount < r.claimantCount ? ` (${r.letterMailedCount} of ${r.claimantCount})` : ''}
          </div>
        )}
      </div>
    ),
  },
  {
    key: 'age',
    label: 'Days since sale',
    align: 'right',
    width: '110px',
    // Sorts oldest-first on the first click, which is the useful direction: a
    // stale case is either already worked by somebody else or close to the end
    // of its window.
    sortValue: (r) => r.daysSinceSale ?? -1,
    render: (r) =>
      r.daysSinceSale == null ? (
        <span style={{ color: 'var(--faint)' }}>unknown</span>
      ) : (
        <span
          style={{
            color:
              r.daysSinceSale > 365
                ? 'var(--red)'
                : r.daysSinceSale > 120
                  ? 'var(--amber)'
                  : 'var(--mint)',
            fontWeight: 600,
          }}
          title={r.saleDate ? `Sold ${fmtDate(r.saleDate)}` : undefined}
        >
          {r.daysSinceSale}d
        </span>
      ),
  },
  {
    // What we have actually done, not what somebody planned to do. Written by
    // the channel that sent it: every call placed, text and email.
    key: 'touches',
    label: 'Touches',
    align: 'right',
    width: '112px',
    nowrap: true,
    // Sorts the most neglected first, so the column answers "who has nobody
    // been calling" rather than "who is popular".
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
    width: '150px',
    // Sorts contactable to the top: a lead you can call outranks one you cannot.
    sortValue: (r) => (r.anyContactable ? 2 : r.anyMismatch ? 0 : 1),
    render: (r) =>
      r.anyContactable ? (
        <span style={{ color: 'var(--mint)', fontSize: 12 }}>☏ callable</span>
      ) : r.anyMismatch ? (
        <span style={{ color: 'var(--red)', fontSize: 12 }}>⚠ wrong person</span>
      ) : (
        <span style={{ color: 'var(--faint)', fontSize: 12 }}>no number</span>
      ),
  },
  {
    key: 'open',
    label: '',
    align: 'right',
    width: '80px',
    render: () => <span style={{ color: 'var(--mint)', fontWeight: 600, fontSize: 12 }}>Work it</span>,
  },
];

/** Kanban columns. Dead is deliberately last and unhighlighted. */
const SURPLUS_KANBAN: PipelineStage[] = SURPLUS_STAGES.map((st) => ({
  key: st,
  label: st,
  tone: (SURPLUS_STAGE_COLOR[st] || CHIP.slate).fg,
})).concat([{ key: 'Dead', label: 'Dead', tone: 'var(--border2)' }]);

// ─── Page ───────────────────────────────────────────────────────────────────

/**
 * The work queues, in the order somebody works them: the reachable first, then
 * the two kinds of research, then what is finished.
 *
 * "Closed" is offered as a filter but never leads, because its whole purpose is
 * to be out of the way.
 */
const QUEUES: [string, string, string][] = [
  ['call', 'Call now', '\u260E'],
  ['heirs', 'Find the heirs', '\u2696'],
  ['trace', 'Skip trace', '\u2318'],
  ['name_search', 'Name search', '\u{1F50E}'],
  ['entity', 'Entity', '\u{1F3E2}'],
  ['mailed', 'Letter sent', '\u2709'],
  ['closed', 'Closed', '\u2713'],
];

const QUEUE_HELP: Record<string, string> = {
  call: 'A callable number and a claim still open. Pick up the phone.',
  heirs:
    'The claimant is deceased and no living heir is on file. Only a person with standing can file, so no amount of skip tracing helps: find the probate case and add the filing.',
  trace: 'Nothing submitted yet and the notice address still looks live. Costs a credit.',
  name_search:
    'The address route is spent, either the clerk mail came back or a trace found nobody. Search by name and confirm against the property that sold.',
  entity: 'An LLC, estate or trust. No consumer record exists; the registered agent on Sunbiz is who can sign.',
  mailed:
    'A letter went out to the address on file and nobody can be phoned. Parked until they reply, so the address is not traced or searched again. A claimant with a callable number stays in Call now even after a letter.',
  closed: 'Paid out, already assigned, or do-not-call. Nothing to do.',
};

/**
 * Whether the daily county pull is actually running.
 *
 * Worth its own line because the failure mode is silent: the board keeps
 * showing yesterday's cases and looks perfectly healthy. "The county has posted
 * nothing new" and "the feed has been broken for a week" are indistinguishable
 * without this, and the only way to tell them apart was to ask someone to read
 * the logs.
 *
 * Only CRON runs count toward staleness. A manual pull does not prove the
 * schedule works, and counting it would mask exactly the failure this is for.
 */
function FeedHealth({ runs }: { runs: any[] }) {
  if (!runs.length) return null;
  const lastCron = runs.find((r) => r.trigger === 'cron' && r.ok);
  const ageHours = lastCron
    ? (Date.now() - new Date(lastCron.startedAt).getTime()) / 3600000
    : Infinity;

  let warn: string | null = null;
  if (!lastCron) {
    warn = 'The daily 5:45am pull has never succeeded. Cases only arrive when somebody clicks Refresh feed.';
  } else if (ageHours > 30) {
    warn = `The daily pull last succeeded ${Math.round(ageHours)} hours ago. It should run every morning at 5:45.`;
  }

  return (
    <div style={{ fontSize: 12, color: warn ? 'var(--amber)' : 'var(--faint)', marginTop: 6 }}>
      {warn ? (
        <>&#9888; {warn}</>
      ) : (
        <>
          Feed last pulled {agoLabel(lastCron.startedAt)} (scheduled): {lastCron.scanned} scanned,{' '}
          {lastCron.created} new, {lastCron.updated} updated, {lastCron.belowFloor} under the floor
        </>
      )}
    </div>
  );
}

export default function SurplusFundsPage() {
  /**
   * Subject properties, not leads. One sale can owe several claimants and each
   * is its own lead; the API groups them so a house is one card with N owners
   * instead of N identical-looking cards.
   */
  const [rows, setRows] = useState<any[]>([]);
  /** Counties actually represented in the data. The API derives it from the rows. */
  const [counties, setCounties] = useState<string[]>([]);
  const [floor, setFloor] = useState(15000);
  const [disclosureLabels, setDisclosureLabels] = useState<Record<string, string>>({});
  const [stats, setStats] = useState({
    openClaims: 0,
    newSevenDays: 0,
    tierA: 0,
    claimantCount: 0,
    /** Property counts per work queue, keyed by SurplusQueue. */
    queues: {} as Record<string, number>,
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
  /** The work queue chip. Replaced the dollar tier as the board's primary cut. */
  const [queueQ, setQueueQ] = useState<string | null>(null);
  const [chipQ, setChipQ] = useState<string | null>(null);
  const [stageQ, setStageQ] = useState<string | null>(null);
  const [county, setCounty] = useState('all');
  const [band, setBand] = useState('all');
  const [ctype, setCtype] = useState('all');
  const [ageQ, setAgeQ] = useState('all');
  const [lienWin, setLienWin] = useState('all');
  const [hideDead, setHideDead] = useState(true);
  const [hideDnc, setHideDnc] = useState(true);

  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  /** Table by default: seventy properties are scanned before they are worked. */
  const [view, setView] = useState<PipelineView>('table');
  /** The lead whose work panel is open, or null. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** Total claimant leads behind the properties on screen. */
  const [leadCount, setLeadCount] = useState(0);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  /** The last few county pulls, for the feed-health line under the title. */
  const [runs, setRuns] = useState<any[]>([]);
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
        queue: queueQ || undefined,
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
      setCounties(Array.isArray(res.data.counties) ? res.data.counties : []);
      setFloor(res.data.surplusFloor ?? 15000);
      setDisclosureLabels(res.data.disclosureLabels || {});
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Could not load surplus leads.');
      setRows([]);
      setLeadCount(0);
    } finally {
      setLoading(false);
    }
  }, [q, queueQ, stageQ, ctype, county, band, chipQ, ageQ, lienWin, hideDead, hideDnc, sort]);

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
  /**
   * Step through the filtered list from inside the panel.
   *
   * Indexed off the SAME array the board renders, so the arrows follow whatever
   * filter and sort is on screen rather than some separate order. Null at the
   * ends instead of wrapping, which is what disables the button and makes the
   * end of the list visible.
   */
  const openIndex = rows.findIndex((r) => r.key === openId);
  const goTo = (i: number) => setOpenId(rows[i] ? (rows[i] as any).key : null);


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

  const fetchRuns = useCallback(() => {
    surplusAPI
      .pollRuns()
      .then((r) => setRuns(r.data?.runs || []))
      .catch(() => setRuns([]));
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  /**
   * Pull the county docket now.
   *
   * This button used to call fetchRows() and fetchStats(), which re-read our
   * own database and never contacted Duval at all. It looked like a no-op
   * because it was one: no new cases, nothing in the log, and no way to tell
   * whether the feed was broken or the county simply had nothing new.
   */
  const pollCounty = async () => {
    setPolling(true);
    say('Pulling the latest cases from the county...');
    try {
      const res = await surplusAPI.poll({ source: 'duval_taxdeed' });
      const r = res.data;
      say(
        `County pull: ${r.created} new, ${r.updated} updated, ${r.belowFloor} under the floor` +
          (r.dead ? `, ${r.dead} retired` : '') +
          (r.errors ? `, ${r.errors} error${r.errors === 1 ? '' : 's'}` : '') +
          '.',
      );
      fetchRows();
      fetchStats();
      fetchRuns();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The county pull failed.');
    } finally {
      setPolling(false);
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
    setQueueQ(null);
    setChipQ(null);
    setStageQ(null);
    setCounty('all');
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
   * A batch of envelopes went out today, one per claimant, each to the address
   * the clerk wrote to that claimant. Confirmed first because the panel undoes
   * one at a time and a mis-click here parks a whole rack of leads.
   */
  const bulkLetterMailed = async () => {
    if (!chosen.length || busy) return;
    const n = chosen.length;
    if (
      !window.confirm(
        `Mark a letter as mailed today to ${n} claimant${n === 1 ? '' : 's'} across ${chosenKeys.length} propert${chosenKeys.length === 1 ? 'y' : 'ies'}?\n\n` +
          'Each claimant is recorded at the address the clerk wrote to them, and a note is added to each lead. Open the panel to use a different date or address.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await surplusAPI.letterMailed(chosen);
      const done = res.data?.updated ?? n;
      say(`Recorded a letter to ${done} claimant${done === 1 ? '' : 's'}`);
      setPicked({});
      fetchRows();
      fetchStats();
    } catch (err: any) {
      say(err?.response?.data?.message || 'Those letters could not be recorded.');
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
        'Letter mailed', 'Letter address',
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
        fmtDate(r.letterMailedAt), r.letterMailedTo,
      ]),
    );
    say(`Exported ${list.length} lead${list.length === 1 ? '' : 's'}.`);
  };

  // Only counties we hold leads for. Offering the ones we intend to work next
  // put seven options on the menu that every returned an empty board.
  const countyOpts: [string, string][] = [
    ['all', counties.length > 1 ? 'All counties' : 'Every county'],
    ...counties.map((c) => [c, c] as [string, string]),
  ];

  return (
    <AppShell>
      <div className="dc-board" style={{ background: 'var(--bg)', minHeight: '100vh', padding: 26 }}>
        <div style={{ maxWidth: 1600, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <h1 className="dc-h1">Surplus Funds</h1>
              <FeedHealth runs={runs} />
            </div>
            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={onFile} />
              <button className="dc-btn" onClick={pollCounty} disabled={polling || busy}>
                {polling ? 'Pulling from the county...' : 'Refresh feed'}
              </button>
              <button className="dc-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? 'Importing...' : 'Import county list'}
              </button>
              <button className="dc-btn pri" onClick={() => setAdding(true)}>
                Add lead
              </button>
            </div>
          </div>



          {error && (
            <div className="dc-panel bad" style={{ marginBottom: 16 }}>
              <div className="head" style={{ color: 'var(--redHead)' }}>
                <span>⛔</span> {error}
              </div>
            </div>
          )}

          <div className="dc-stats">
            {/* Properties, matching the row count under the board. It used to
                count claimants, so the headline read 74 against 47 rows. */}
            <div className="dc-stat">
              <div className="k">Open properties</div>
              <div className="v">{stats.openClaims}</div>
              {stats.claimantCount > stats.openClaims && (
                <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>
                  {stats.claimantCount} claimants
                </div>
              )}
            </div>
            <button className={`dc-stat${chipQ === 'new' ? ' on' : ''}`} onClick={() => setChipQ(chipQ === 'new' ? null : 'new')}>
              <div className="k">New, 7 days</div>
              <div className="v" style={{ color: 'var(--red)' }}>{stats.newSevenDays}</div>
            </button>
            <button
              className={`dc-stat${queueQ === 'call' ? ' on' : ''}`}
              onClick={() => setQueueQ(queueQ === 'call' ? null : 'call')}
            >
              <div className="k">Callable now</div>
              <div className="v" style={{ color: 'var(--mint)' }}>{stats.queues?.call ?? 0}</div>
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
                ['surplus', 'Sort: Biggest surplus'],
                ['net', 'Sort: Net to claimant'],
                ['notice', 'Sort: Newest notice'],
              ]}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <span className="dc-flabel">Quick filters</span>
            {/* The work queue, not the dollar band. Each names what to do next
                and who does it; the dollars are a sort, which is what they are
                good for: ordering inside a queue, not choosing between them. */}
            {QUEUES.map(([k, label, icon]) => (
              <button
                key={k}
                className={`dc-tab${queueQ === k ? ' on' : ''}`}
                onClick={() => setQueueQ(queueQ === k ? null : k)}
                title={QUEUE_HELP[k]}
              >
                {icon} {label}
                {stats.queues?.[k] != null && (
                  <span style={{ marginLeft: 5, opacity: 0.6 }}>{stats.queues[k]}</span>
                )}
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

          <PipelineBoard
            rows={rows}
            keyOf={(r) => r.key}
            columns={SURPLUS_COLUMNS}
            stages={SURPLUS_KANBAN}
            stageOf={(r) => r.stage}
            onStageChange={(r, stage) => {
              // Dragging a property restages every claim on it, which is what
              // the column means: the house has been worked, not one owner.
              surplusAPI
                .bulkStage(r.claimants.map((c: any) => c.id), stage)
                .then(() => {
                  say(`Moved ${r.address} to ${stage}`);
                  fetchRows();
                  fetchStats();
                })
                .catch(() => say('That stage change could not be saved.'));
            }}
            view={view}
            onViewChange={setView}
            selected={picked}
            onSelect={(k, on) => setPicked({ ...picked, [k]: on })}
            onSelectAll={(on) => {
              if (!on) return setPicked({});
              const n: Record<string, boolean> = {};
              rows.forEach((r) => { n[r.key] = true; });
              setPicked(n);
            }}
            onOpen={(r) => setOpenId(r.key)}
            accentOf={(r) => STATUS_ACCENT[r.claimStatus] || 'var(--border2)'}
            loading={loading}
            renderCard={(r) => (
              <SurplusPropertyCard
                p={r}
                picked={!!picked[r.key]}
                onPick={(on) => setPicked({ ...picked, [r.key]: on })}
                onOpen={() => setOpenId(r.key)}
              />
            )}
            empty={
              stats.total === 0
                ? 'No surplus leads yet. Import a county list to get started.'
                : 'Nothing matches those filters.'
            }
            toolbarLeft={
              <span>
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
                {chosenKeys.length > 0 && (
                  <>
                    <button
                      className="dc-btn sm"
                      disabled={busy}
                      onClick={bulkLetterMailed}
                      title="Record that a letter went out today to every selected claimant, at the address the clerk wrote to them"
                    >
                      {'✉'} Letter mailed
                    </button>
                    <button className="dc-btn sm dngr" disabled={busy} onClick={() => bulkStage('Dead')}>
                      Mark dead
                    </button>
                  </>
                )}
                <button style={{ color: 'var(--mint)', fontWeight: 600, fontSize: 13 }} onClick={csv}>
                  Download {chosenKeys.length ? 'selected' : 'shown'} as CSV
                </button>
              </>
            }
          />

          <div style={{ height: 34 }} />
        </div>

        {openProperty && (
          <SurplusWorkPanel
            onPrev={openIndex > 0 ? () => goTo(openIndex - 1) : null}
            onNext={openIndex >= 0 && openIndex < rows.length - 1 ? () => goTo(openIndex + 1) : null}
            position={openIndex >= 0 ? { index: openIndex, total: rows.length } : null}
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
