'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AppShell from '@/components/AppShell';
import PipelineBoard, { type PipelineView } from '@/components/pipelines/PipelineBoard';
import AddLeadSheet, { SURPLUS_FIELDS } from '@/components/pipelines/AddLeadSheet';
import SurplusWorkPanel from '@/components/pipelines/SurplusWorkPanel';
import SurplusPropertyCard, { STATUS_ACCENT } from '@/components/pipelines/SurplusPropertyCard';
import type { PipelineColumn, PipelineStage } from '@/components/pipelines/PipelineBoard';
import { authAPI, surplusAPI } from '@/lib/api';
import { dueLabel, isOverdue } from '@/lib/dates';
import { SURPLUS_DEAD_REASONS } from '@/lib/surplus-dead';
import '@/components/pipelines/pipeline-board.css';
import {
  CHIP,
  CLAIMANT_TYPE_LABEL,
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

/**
 * The table, in the order somebody picks a lead: what to do, for whom, how
 * much, whether anyone else is on the money, whether we can reach them,
 * what is promised next, and when we last tried. Seven columns. The owner
 * address, the days since sale and the touch count moved to the panel; at
 * thirteen columns the table was 1,252px wide in an 1,131px space and the
 * two that said whether to bother were the ones cut off.
 */
const SURPLUS_COLUMNS: PipelineColumn<any>[] = [
  {
    // What to do with this one, first column and first read. Sorts on the
    // work score so "Call now" rows arrive in call order rather than
    // alphabetically by queue name.
    key: 'queue',
    label: 'Next step',
    width: '140px',
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
    // The house and the people owed on it, one cell. The claimant used to
    // have a column of its own, which cost a row of height for every
    // property with a long name.
    key: 'property',
    label: 'Property and claimant',
    sortValue: (r) => r.address || '',
    render: (r) => (
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
          {r.address}
          <span style={{ fontWeight: 400, color: 'var(--faint)' }}>, {r.city}</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--dim)', overflowWrap: 'anywhere' }}>
          <span style={r.allDeceased ? { textDecoration: 'line-through' } : undefined}>
            {r.claimantNames.slice(0, 2).join(', ')}
          </span>
          {r.claimantCount > 2 && ` +${r.claimantCount - 2} more`}
          <span style={{ color: 'var(--faint)' }}>
            {' '}· {r.county}
            {r.caseNumber ? ` · ${r.caseNumber}` : ''}
          </span>
        </div>
        {/* The whole point of the heirs work: say who can actually sign, so
            nobody spends an afternoon on a dead claimant. */}
        {r.anyDeceased && (
          <div style={{ fontSize: 11.5, color: r.needsHeirs ? 'var(--red)' : 'var(--mint)' }}>
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
    key: 'surplus',
    label: 'Surplus',
    align: 'right',
    width: '92px',
    nowrap: true,
    sortValue: (r) => r.grossSurplus,
    render: (r) => <b title={money(r.grossSurplus)}>{moneyShort(r.grossSurplus)}</b>,
  },
  {
    key: 'claimStatus',
    label: 'Claim',
    width: '130px',
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
    // Can we reach anyone who can sign. One line, in priority order. A
    // deceased claimant with no heirs on file comes first even when a number
    // exists, because that number is the dead claimant's and rings nobody
    // who can sign; after that a live number is what makes a lead callable
    // today, and everything else explains why there is not one.
    key: 'reach',
    label: 'Reach',
    width: '140px',
    sortValue: (r) => (r.needsHeirs ? 1 : r.anyContactable ? 3 : r.anyMismatch ? 0 : 2),
    render: (r) => (
      <div style={{ fontSize: 12 }}>
        {r.needsHeirs ? (
          <span style={{ color: 'var(--red)' }}>no heirs on file</span>
        ) : r.anyContactable ? (
          <span style={{ color: 'var(--mint)' }}>☏ callable</span>
        ) : r.anyMismatch ? (
          <span style={{ color: 'var(--red)' }}>⚠ wrong person</span>
        ) : (
          <span style={{ color: 'var(--faint)' }}>no number</span>
        )}
        {/* The cadence, off the history: due for the next envelope, or three
            unanswered and time to upgrade the postage. */}
        {r.letterDue ? (
          <div style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 600 }}>
            {r.escalateMail ? 'Letter due, send Priority or FedEx' : 'Letter due'}
          </div>
        ) : r.letterMailedCount > 0 ? (
          <div style={{ fontSize: 11, color: 'var(--faint)' }}>✉ letter {fmtDate(r.letterMailedAt)}</div>
        ) : null}
      </div>
    ),
  },
  {
    // What somebody has promised to do next, and whether it has slipped. The
    // course's whole discipline is that every follow-up has a date; this is
    // where the board shows whether the dates are being kept.
    key: 'nextTask',
    label: 'Next action',
    width: '170px',
    // Soonest first on the first click: the board sorts descending, so the
    // nearest date gets the largest value and rows with nothing due go last.
    sortValue: (r) => (r.nextTask?.dueDate ? -new Date(r.nextTask.dueDate).getTime() : -Infinity),
    render: (r) =>
      r.claimantUpdateOverdue ? (
        <div style={{ fontSize: 12, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--red)' }}>Monthly update owed</div>
          {r.nextTask && (
            <div style={{ fontSize: 11, color: isOverdue(r.nextTask.dueDate) ? 'var(--red)' : 'var(--faint)' }}>
              {r.nextTask.title}, {dueLabel(r.nextTask.dueDate)}
            </div>
          )}
        </div>
      ) : r.nextTask ? (
        <div style={{ fontSize: 12, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 160,
            }}
            title={r.nextTask.title}
          >
            {r.nextTask.title}
          </div>
          <div style={{ fontSize: 11, color: isOverdue(r.nextTask.dueDate) ? 'var(--red)' : 'var(--faint)' }}>
            {dueLabel(r.nextTask.dueDate)}
            {r.openTaskCount > 1 ? ` · +${r.openTaskCount - 1} more` : ''}
          </div>
        </div>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>none</span>
      ),
  },
  {
    // When we last tried, and whether anyone has ever answered. Tapped is
    // stamped by the channel that heard back, so it cannot drift from what
    // went out. Sorts the most neglected first, so the column answers "who
    // has nobody been calling" rather than "who is popular".
    key: 'touches',
    label: 'Last touch',
    width: '120px',
    nowrap: true,
    sortValue: (r) => -agoDays(r.lastTouchedAt),
    render: (r) => {
      const status = r.contactStatus || 'not_tapped';
      return (
        <div style={{ fontSize: 12 }}>
          <span style={{ color: r.touches ? 'var(--text)' : 'var(--faint)' }}>
            {agoLabel(r.lastTouchedAt)}
            {r.touches ? <span style={{ color: 'var(--faint)' }}> · {r.touches}</span> : null}
          </span>
          <div style={{ fontSize: 11, fontWeight: 600, color: status === 'not_tapped' ? 'var(--amber)' : 'var(--mint)' }}>
            {status === 'not_tapped' ? 'No reply yet' : status === 'tapped' ? 'Replied' : 'Follow-up booked'}
          </div>
        </div>
      );
    },
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
const QUEUES: [string, string][] = [
  ['call', 'Call now'],
  ['heirs', 'Find the heirs'],
  ['trace', 'Skip trace'],
  ['name_search', 'Name search'],
  ['entity', 'Entity'],
  ['mailed', 'Letter sent'],
  ['closed', 'Closed'],
];
const QUEUE_LABEL: Record<string, string> = Object.fromEntries(QUEUES);

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
interface FeedSource {
  key: string;
  county: string;
  /** 'daily' | 'weekly'. Decides how old a pull can be before it is late. */
  cadence?: string;
}

/** How long a feed can go without a successful cron pull before it is late. */
function staleAfterHours(cadence?: string): number {
  return cadence === 'weekly' ? 8 * 24 : 30;
}

function scheduleLabel(cadence?: string): string {
  return cadence === 'weekly' ? 'every Monday at 4:30' : 'every morning at 5:45';
}

function FeedLine({ runs, sources }: { runs: any[]; sources: FeedSource[] }) {
  if (!runs.length && !sources.length) return null;
  // One entry per registered feed. A weekly feed judged by the daily rule was
  // amber six days out of seven, which taught everyone to ignore the line.
  const feeds: FeedSource[] = sources.length
    ? sources
    : [{ key: 'duval_taxdeed', county: 'Duval', cadence: 'daily' }];

  const items = feeds.map((f) => {
    const lastCron = runs.find((r) => r.trigger === 'cron' && r.ok && (!r.source || r.source === f.key));
    const ageHours = lastCron ? (Date.now() - new Date(lastCron.startedAt).getTime()) / 3600000 : Infinity;
    const late = !lastCron || ageHours > staleAfterHours(f.cadence);
    // The short form is what sits under the title. The sentence, which used
    // to sit there in full on every visit, is the tooltip.
    const short = !lastCron
      ? `${f.county} pull has never run`
      : late
        ? `${f.county} pull late, last ${agoLabel(lastCron.startedAt)}`
        : `${f.county} pulled ${agoLabel(lastCron.startedAt)}`;
    const detail = !lastCron
      ? `The ${f.county} pull (${scheduleLabel(f.cadence)}) has never succeeded. Cases only arrive when somebody chooses Refresh feed.`
      : late
        ? `The ${f.county} pull last succeeded ${agoLabel(lastCron.startedAt)}. It should run ${scheduleLabel(f.cadence)}.`
        : `${f.county}, ${scheduleLabel(f.cadence)}: ${lastCron.scanned} scanned, ${lastCron.created} new, ${lastCron.updated} updated, ${lastCron.belowFloor} under the floor.`;
    return { key: f.key, late, short, detail };
  });
  const bad = items.some((i) => i.late);

  return (
    <div className={`dc-feedline${bad ? ' warn' : ''}`} title={items.map((i) => i.detail).join('\n')}>
      <i />
      Feeds: {items.map((i) => i.short).join(' · ')}
    </div>
  );
}

/**
 * When calls connect. Shown only once there are enough calls to say
 * anything; a best window off four calls is noise dressed as advice.
 */
function CallWindows({ stats }: { stats: any }) {
  if (!stats || stats.calls < 10) return null;
  const rate = Math.round((stats.connectRate || 0) * 100);
  return (
    <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>
      Calls, last {stats.sinceDays} days: {stats.calls} placed, {rate}% reached a person
      {stats.best ? (
        <>
          . Best window so far: <b style={{ color: 'var(--mint)' }}>{stats.best.label}</b> (
          {stats.best.connected} of {stats.best.calls})
        </>
      ) : (
        '.'
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
    /** Properties nobody has heard back from, and with an untried channel. */
    notTapped: null as number | null,
    missingChannel: null as number | null,
    letterDue: null as number | null,
    updateOverdue: null as number | null,
    collected: 0,
    feesEarned: 0,
    recoveries: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [q, setQ] = useState('');
  // The board opens on the call-now order. Tier alone does not answer "who do
  // I ring first": it bands the dollars, and a big surplus whose owner already
  // signed with a competitor is worth less than a small one with a live number.
  const [sort, setSort] = useState('work');
  /**
   * The work queue chip. Replaced the dollar tier as the board's primary cut,
   * and the board lands on Call now: the first screen of the day is the phone
   * list, and one click clears it.
   */
  const [queueQ, setQueueQ] = useState<string | null>('call');
  /** The secondary filters live in a drawer that says how many are on. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
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
  /** The county feeds the API can pull, with their cadence. */
  const [sources, setSources] = useState<FeedSource[]>([]);
  /** Which feed Refresh feed pulls. Defaults to the first registered. */
  const [source, setSource] = useState<string>('');
  /** Connect rate by weekday and hour, off the call log. */
  const [callStats, setCallStats] = useState<any>(null);
  /** The dollar band chip. A sort more than a cut, but the course filters on it. */
  const [tierQ, setTierQ] = useState<string | null>(null);
  /** The bulk Mark dead form: a reason is required. */
  const [deadOpen, setDeadOpen] = useState(false);
  const [deadReason, setDeadReason] = useState('');
  const [deadNote, setDeadNote] = useState('');
  const [deadOverride, setDeadOverride] = useState(false);
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
        contact: chipQ === 'not_tapped' ? 'not_tapped' : undefined,
        missingChannel: chipQ === 'missing' || undefined,
        letterDue: chipQ === 'letter_due' || undefined,
        updateOverdue: chipQ === 'update_overdue' || undefined,
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
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Could not load surplus leads.');
      setRows([]);
      setLeadCount(0);
    } finally {
      setLoading(false);
    }
  }, [q, queueQ, tierQ, stageQ, ctype, county, band, chipQ, ageQ, lienWin, hideDead, hideDnc, sort]);

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

  const fetchRuns = useCallback(() => {
    surplusAPI
      .pollRuns()
      .then((r) => {
        setRuns(r.data?.runs || []);
        setSources(r.data?.sources || []);
      })
      .catch(() => setRuns([]));
    surplusAPI
      .callStats()
      .then((r) => setCallStats(r.data || null))
      .catch(() => setCallStats(null));
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
    const feed = sources.find((s) => s.key === source) || sources[0];
    say(`Pulling the latest cases from ${feed ? feed.county : 'the county'}...`);
    try {
      const res = await surplusAPI.poll({ source: feed?.key || 'duval_taxdeed' });
      const r = res.data;
      say(
        `${feed ? feed.county : 'County'} pull: ${r.created} new, ${r.updated} updated, ${r.belowFloor} under the floor` +
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
            : '') +
          // Previously worked and retired, named rather than silently skipped,
          // so nobody re-researches a case the team already closed.
          (r.previouslyDead?.length
            ? ` ${r.previouslyDead.length} ${r.previouslyDead.length === 1 ? 'was' : 'were'} previously worked and marked dead: ${r.previouslyDead
                .slice(0, 3)
                .map((p: any) => `${p.claimant}${p.reason ? ` (${p.reason})` : ''}`)
                .join(', ')}${r.previouslyDead.length > 3 ? ` and ${r.previouslyDead.length - 3} more` : ''}.`
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
    setTierQ(null);
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
  const bulkStage = async (stage: string, dead?: { deadReason: string; deadNote?: string | null; deadOverride?: boolean }) => {
    if (!chosen.length || busy) return;
    setBusy(true);
    try {
      const res = await surplusAPI.bulkStage(chosen, stage, dead);
      say(`Moved ${res.data?.updated ?? chosen.length} claimant${chosen.length === 1 ? '' : 's'} to ${stage}`);
      setDeadOpen(false);
      setDeadReason('');
      setDeadNote('');
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

  // How many secondary filters are on, for the badge on the Filters button.
  // The queue chip is not counted: it is the board's primary cut, not a filter
  // somebody could forget they set.
  const activeFilters = [
    tierQ,
    chipQ,
    stageQ,
    county !== 'all',
    band !== 'all',
    ctype !== 'all',
    ageQ !== 'all',
    lienWin !== 'all',
    !hideDead,
    !hideDnc,
  ].filter(Boolean).length;

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
              <FeedLine runs={runs} sources={sources} />
              <CallWindows stats={callStats} />
            </div>
            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center' }}>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={onFile} />
              {/* Everything a caller does not do on a normal day sits behind
                  More: the county pull, the import, the references. One
                  primary button remains. */}
              <details className="dc-menu" ref={menuRef}>
                <summary className="dc-btn">More</summary>
                <div className="dc-menu-list" onClick={() => menuRef.current?.removeAttribute('open')}>
                  {sources.length > 1 && (
                    <label className="dc-menu-item" onClick={(e) => e.stopPropagation()}>
                      Feed to pull
                      <select
                        className="dc-in"
                        value={source || sources[0].key}
                        onChange={(e) => setSource(e.target.value)}
                        disabled={polling}
                        aria-label="County feed to pull"
                      >
                        {sources.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.county}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button type="button" className="dc-menu-item" onClick={pollCounty} disabled={polling || busy}>
                    {polling ? 'Pulling from the county...' : 'Refresh feed'}
                  </button>
                  <button type="button" className="dc-menu-item" onClick={() => fileRef.current?.click()} disabled={busy}>
                    {busy ? 'Importing...' : 'Import county list'}
                  </button>
                  <a className="dc-menu-item" href="/surplus-funds/references">
                    References{stats.recoveries ? ` (${stats.recoveries} paid)` : ''}
                  </a>
                </div>
              </details>
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

          {/* Three tiles. "New, 7 days" and "Callable now" were the same
              numbers as two chips one row below. */}
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
            <div className="dc-stat">
              <div className="k">Net in pipeline</div>
              <div className="v" style={{ color: 'var(--mint)', fontSize: 24 }}>{money(stats.netInPipeline)}</div>
              <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>estimate, before liens are confirmed</div>
            </div>
            {/* Real money, off the county's checks, as against the pipeline
                estimate beside it. */}
            <div className="dc-stat">
              <div className="k">Collected</div>
              <div className="v" style={{ color: 'var(--mint)', fontSize: 24 }}>{money(stats.collected || 0)}</div>
              <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>
                {stats.recoveries || 0} paid out · {money(stats.feesEarned || 0)} earned
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
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
                ['untapped', 'Sort: No reply first'],
                ['surplus', 'Sort: Biggest surplus'],
                ['net', 'Sort: Net to claimant'],
                ['notice', 'Sort: Newest notice'],
              ]}
            />
            <button
              className={`dc-btn${filtersOpen ? ' on' : ''}`}
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              title="Tier, contact status, stage, county, amount, notice age and the lienholder window"
            >
              Filters
              {activeFilters > 0 && <span className="dc-count">{activeFilters}</span>}
            </button>
          </div>

          {/* The work queue, not the dollar band. Each names what to do next
              and who does it; the dollars are a sort, which is what they are
              good for: ordering inside a queue, not choosing between them.
              These stay on the front row. They are the workflow. */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            {QUEUES.map(([k, label]) => (
              <button
                key={k}
                className={`dc-tab${queueQ === k ? ' on' : ''}`}
                onClick={() => setQueueQ(queueQ === k ? null : k)}
                title={QUEUE_HELP[k]}
              >
                {label}
                {stats.queues?.[k] != null && (
                  <span style={{ marginLeft: 5, opacity: 0.6 }}>{stats.queues[k]}</span>
                )}
              </button>
            ))}
          </div>

          {filtersOpen && (
            <div className="dc-drawer">
              {/* The dollar band. Computed on every row and kept as a sort, but
                  the course's first quick filter is tier and a caller working
                  the big ones first should not need the dropdowns. */}
              <div className="dc-drawer-row">
                <span className="dc-flabel">Tier</span>
                {(['A', 'B', 'C'] as const).map((t) => (
                  <button
                    key={t}
                    className={`dc-tab${tierQ === t ? ' on' : ''}`}
                    onClick={() => setTierQ(tierQ === t ? null : t)}
                    title={
                      t === 'A'
                        ? '$25k and up, living owner, no competing lien'
                        : t === 'B'
                          ? '$10k to $25k, living owner'
                          : '$25k and up, owner deceased'
                    }
                  >
                    {TIER[t].icon} {TIER[t].label}
                  </button>
                ))}
              </div>
              <div className="dc-drawer-row">
                <span className="dc-flabel">Status</span>
                {(
                  [
                    ['not_tapped', 'No reply yet'],
                    ['missing', 'Untried channel'],
                    ['letter_due', 'Letter due'],
                    ['update_overdue', 'Update overdue'],
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
                        : k === 'not_tapped'
                          ? 'Nobody has heard back from anyone on this property yet. The working list.'
                          : k === 'missing'
                            ? 'At least one of call, text, email, letter has not been tried on this property.'
                            : k === 'letter_due'
                              ? 'Nobody has replied, there is an address, and the last letter is older than the cadence, or none has gone out.'
                              : k === 'update_overdue'
                                ? 'A signed claimant who has not heard from us in thirty days. The course says monthly, news or not.'
                                : k === 'new'
                                  ? 'Notice mailed in the last seven days.'
                                  : undefined
                    }
                  >
                    {l}
                    {k === 'new' && <span style={{ marginLeft: 5, opacity: 0.6 }}>{stats.newSevenDays}</span>}
                    {k === 'update_overdue' && stats.updateOverdue != null && (
                      <span style={{ marginLeft: 5, opacity: 0.6 }}>{stats.updateOverdue}</span>
                    )}
                    {k === 'not_tapped' && stats.notTapped != null && (
                      <span style={{ marginLeft: 5, opacity: 0.6 }}>{stats.notTapped}</span>
                    )}
                    {k === 'missing' && stats.missingChannel != null && (
                      <span style={{ marginLeft: 5, opacity: 0.6 }}>{stats.missingChannel}</span>
                    )}
                    {k === 'letter_due' && stats.letterDue != null && (
                      <span style={{ marginLeft: 5, opacity: 0.6 }}>{stats.letterDue}</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="dc-drawer-row">
                <span className="dc-flabel">Stage</span>
                {['Agreement Signed', 'Claim Filed', 'Paid'].map((k) => (
                  <button key={k} className={`dc-tab${stageQ === k ? ' on' : ''}`} onClick={() => setStageQ(stageQ === k ? null : k)}>
                    {k}
                  </button>
                ))}
                <Sel
                  v={stageQ || 'all'}
                  set={(v) => setStageQ(v === 'all' ? null : v)}
                  opts={[['all', 'Any pipeline status'] as [string, string]].concat(
                    SURPLUS_STAGES.map((x) => [x, x] as [string, string]),
                  )}
                />
              </div>
              <div className="dc-drawer-row">
                <span className="dc-flabel">Narrow</span>
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
                  opts={[['all', 'Any claim window'], ['open', 'Other claims still possible'], ['closed', 'Other claims closed']]}
                />
                <button className={`dc-danger${hideDead ? '' : ' off'}`} onClick={() => setHideDead(!hideDead)}>
                  Hide dead
                </button>
                <button className={`dc-danger${hideDnc ? '' : ' off'}`} onClick={() => setHideDnc(!hideDnc)}>
                  Hide Do-Not-Call
                </button>
                <button className="dc-btn sm" style={{ marginLeft: 'auto' }} onClick={reset}>
                  Reset filters
                </button>
              </div>
            </div>
          )}

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
              // Confirmed first because a drop is easy to do by accident and
              // it moves several people at once; the panel moves one.
              const n = r.claimants.length;
              if (
                n > 1 &&
                !window.confirm(
                  `Move all ${n} claimants at ${r.address} to ${stage}?\n\nTo move one claimant, open the property and change the stage in the panel.`,
                )
              ) {
                fetchRows();
                return;
              }
              surplusAPI
                .bulkStage(r.claimants.map((c: any) => c.id), stage)
                .then(() => {
                  say(`Moved ${r.address} to ${stage}`);
                  fetchRows();
                  fetchStats();
                })
                .catch((err: any) => {
                  say(err?.response?.data?.message || 'That stage change could not be saved.');
                  fetchRows();
                });
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
            hideCards
            empty={
              stats.total === 0 ? (
                'No surplus leads yet. Import a county list (under More) to get started.'
              ) : queueQ ? (
                <span>
                  Nothing in {QUEUE_LABEL[queueQ] || queueQ} right now.{' '}
                  <button className="dc-btn sm" onClick={() => setQueueQ(null)}>
                    Show all {stats.openClaims} open
                  </button>
                </span>
              ) : (
                'Nothing matches those filters.'
              )
            }
            toolbarLeft={
              <span>
                {queueQ ? (
                  <>
                    {rows.length} in <b>{QUEUE_LABEL[queueQ] || queueQ}</b> · {stats.openClaims} open
                  </>
                ) : (
                  <>
                    {rows.length} propert{rows.length === 1 ? 'y' : 'ies'}
                  </>
                )}
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
                    {/* Dead needs a reason, so the button opens a small form
                        rather than acting at once. */}
                    {deadOpen ? (
                      <>
                        <select
                          className="dc-in"
                          value={deadReason}
                          onChange={(e) => setDeadReason(e.target.value)}
                          aria-label="Dead reason"
                        >
                          <option value="">Why dead?</option>
                          {SURPLUS_DEAD_REASONS.map(([k, l]) => (
                            <option key={k} value={k}>
                              {l}
                            </option>
                          ))}
                        </select>
                        <input
                          className="dc-in"
                          value={deadNote}
                          placeholder={deadOverride ? 'Why, required' : 'Note, optional'}
                          onChange={(e) => setDeadNote(e.target.value)}
                          style={{ width: 160 }}
                        />
                        {/* "Unresponsive" is checked against the search log, the
                            letters and the call count on every selected claimant.
                            The override needs a note. */}
                        {deadReason === 'unresponsive' && (
                          <label
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--dim)', cursor: 'pointer' }}
                            title="Skip the effort gate: the free searches, a social search, a letter and three calls"
                          >
                            <input type="checkbox" checked={deadOverride} onChange={(e) => setDeadOverride(e.target.checked)} />
                            Override the effort gate
                          </label>
                        )}
                        <button
                          className="dc-btn sm dngr"
                          disabled={busy || !deadReason || (deadOverride && !deadNote.trim())}
                          onClick={() =>
                            bulkStage('Dead', {
                              deadReason,
                              deadNote: deadNote.trim() || null,
                              ...(deadOverride && deadReason === 'unresponsive' ? { deadOverride: true } : {}),
                            })
                          }
                        >
                          Confirm dead
                        </button>
                        <button className="dc-btn sm" disabled={busy} onClick={() => setDeadOpen(false)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button className="dc-btn sm dngr" disabled={busy} onClick={() => setDeadOpen(true)}>
                        Mark dead
                      </button>
                    )}
                    <button
                      className="dc-btn sm dngr"
                      disabled={busy}
                      onClick={bulkDelete}
                      title="Remove leads that should never have been ingested. Writes a suppression so the county poll cannot bring them back. To retire a lead, mark it Dead instead."
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

