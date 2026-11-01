'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import PipelineBoard, { inBoardOrder, type PipelineView } from '@/components/pipelines/PipelineBoard';
import AddLeadSheet, { SURPLUS_FIELDS } from '@/components/pipelines/AddLeadSheet';
import SurplusWorkPanel from '@/components/pipelines/SurplusWorkPanel';
import SurplusBatches, { BatchRef } from '@/components/pipelines/SurplusBatches';
import SurplusIdiImport from '@/components/pipelines/SurplusIdiImport';
import SurplusImportReport, { SurplusImportResult } from '@/components/pipelines/SurplusImportReport';
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
  fmtDay,
  money,
  pct,
  phoneDisplay,
  moneyShort,
  agoLabel,
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
  /** Null for a US address. */
  ownerMailingCountry?: string | null;
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
  hold: CHIP.pink,
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
    // What happens next on this one, first column and first read. The team's
    // own next action and its date when somebody has set one; the work queue
    // the board computed when nobody has, so the column is never blank.
    // Sorts on the work score so "Call now" rows arrive in call order.
    key: 'queue',
    label: 'Next',
    width: '170px',
    sortable: true,
    render: (r) => {
      const c = QUEUE_CHIP[r.queue] || CHIP.slate;
      const others = Object.entries(r.queueCounts || {}).filter(([k]) => k !== r.queue);
      const t = r.nextTask;
      const chip = (
        <span className="dc-tag" style={{ background: c.bg, color: c.fg, ...(t ? { fontSize: 10.5, padding: '2px 7px' } : {}) }}>
          {r.queueLabel}
        </span>
      );
      return (
        <div style={{ minWidth: 0 }}>
          {r.claimantUpdateOverdue && (
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--red)' }}>Monthly update owed</div>
          )}
          {t ? (
            <>
              <div
                style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}
                title={t.title}
              >
                {t.title}
              </div>
              <div style={{ fontSize: 11, color: isOverdue(t.dueDate) ? 'var(--red)' : 'var(--faint)', marginBottom: 3 }}>
                {dueLabel(t.dueDate)}
                {r.ownerNames?.length ? ` · ${r.ownerNames.join(', ')}` : ''}
                {r.openTaskCount > 1 ? ` · +${r.openTaskCount - 1} more` : ''}
              </div>
              {chip}
            </>
          ) : (
            <>
              {chip}
              {r.ownerNames?.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>{r.ownerNames.join(', ')}</div>
              )}
            </>
          )}
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
    // The people owed and the house they are owed on, one cell. The claimant
    // used to have a column of its own, which cost a row of height for every
    // property with a long name. The NAME leads: the team finds a file by
    // who is owed, not by where the house was, so the name is the bold line
    // and the address sits under it, smaller and unbolded. Sorts by name for
    // the same reason.
    key: 'property',
    label: 'Claimant and property',
    sortable: true,
    render: (r) => (
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25, overflowWrap: 'anywhere' }}>
          <span style={r.allDeceased ? { textDecoration: 'line-through' } : undefined}>
            {r.claimantNames.slice(0, 2).join(', ') || 'Unknown claimant'}
          </span>
          {r.claimantCount > 2 && (
            <span style={{ fontWeight: 400, color: 'var(--faint)' }}> +{r.claimantCount - 2} more</span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--dim)', overflowWrap: 'anywhere', marginTop: 1 }}>
          {r.address}
          <span style={{ color: 'var(--faint)' }}>
            , {r.city} · {r.county}
            {r.caseNumber ? ` · ${r.caseNumber}` : ''}
          </span>
        </div>
        {/* Found through somebody around the claim, not the claimant. */}
        {r.searchMatches?.length > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--mint)', overflowWrap: 'anywhere' }}>
            Found: {r.searchMatches.slice(0, 3).join(', ')}
            {r.searchMatches.length > 3 ? ` +${r.searchMatches.length - 3} more` : ''}
          </div>
        )}
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
    sortable: true,
    render: (r) => <b title={money(r.grossSurplus)}>{moneyShort(r.grossSurplus)}</b>,
  },
  {
    // Age since the sale. Past a year the money can only be requested through
    // an attorney, which is why the team filters those out; the column went
    // in the Phase 2 trim and came straight back.
    key: 'age',
    label: 'Age',
    align: 'right',
    width: '80px',
    nowrap: true,
    // Oldest first on the first click: a stale case is either already worked
    // by somebody else or past the point where we can file it ourselves.
    sortable: true,
    render: (r) =>
      r.daysSinceSale == null ? (
        <span style={{ color: 'var(--faint)', fontSize: 12 }}>unknown</span>
      ) : (
        <span
          style={{
            color: r.daysSinceSale > 365 ? 'var(--red)' : r.daysSinceSale > 120 ? 'var(--amber)' : 'var(--mint)',
            fontWeight: 600,
          }}
          title={
            r.daysSinceSale > 365
              ? `Sold ${fmtDay(r.saleDate)}. Over a year: only an attorney can request this one.`
              : r.saleDate
                ? `Sold ${fmtDay(r.saleDate)}`
                : undefined
          }
        >
          {r.daysSinceSale > 365 ? `${(r.daysSinceSale / 365).toFixed(1)}y` : `${r.daysSinceSale}d`}
          {/* Under two months to the team's day-340 cutoff. */}
          {r.shortWindow && (
            <span
              style={{ display: 'block', fontSize: 10.5, color: 'var(--red)', fontWeight: 600 }}
              title={
                r.daysToCutoff != null && r.daysToCutoff >= 0
                  ? `${r.daysToCutoff} days to the day-340 cutoff. Day 365 is the legal end.`
                  : 'Past the day-340 cutoff, still inside the legal year.'
              }
            >
              short
            </span>
          )}
        </span>
      ),
  },
  {
    key: 'claimStatus',
    label: 'Claim',
    width: '120px',
    sortable: true,
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
    width: '130px',
    sortable: true,
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
    // When we last tried, and whether anyone has ever answered. Tapped is
    // stamped by the channel that heard back, so it cannot drift from what
    // went out. Sorts the most neglected first, so the column answers "who
    // has nobody been calling" rather than "who is popular".
    key: 'touches',
    label: 'Last touch',
    width: '110px',
    nowrap: true,
    sortable: true,
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
  {
    // When anyone on the file, the claimant or a person filed under them,
    // last gained a phone or email. Only an addition moves it, so the column
    // answers "who has new numbers" and sorts the newest first. Green when
    // the new info landed after the last touch: nobody has used it yet.
    key: 'contactUpdated',
    label: 'Contact updated',
    width: '120px',
    nowrap: true,
    sortable: true,
    render: (r) => {
      if (!r.contactUpdatedAt) return <span style={{ fontSize: 12, color: 'var(--faint)' }}>never</span>;
      const fresh =
        !r.lastTouchedAt || new Date(r.contactUpdatedAt).getTime() > new Date(r.lastTouchedAt).getTime();
      return (
        <div style={{ fontSize: 12 }}>
          <span>{agoLabel(r.contactUpdatedAt)}</span>
          {fresh && (
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--mint)' }}>New since last touch</div>
          )}
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
  ['likely', 'Likely match'],
  ['heirs', 'Find the heirs'],
  ['trace', 'Send to IDI'],
  ['name_search', 'Research by name'],
  ['entity', 'Entity'],
  ['mailed', 'Letter sent'],
  ['hold', 'On hold'],
  ['closed', 'Closed'],
];
const QUEUE_LABEL: Record<string, string> = Object.fromEntries(QUEUES);

const QUEUE_HELP: Record<string, string> = {
  call: 'A callable number and a claim still open. Pick up the phone.',
  likely:
    'Numbers from a likely but unconfirmed match: the only person with that name in the state the clerk wrote to, with no address tie to the case. Usual for out-of-town owners of vacant lots. Call, but confirm who you are speaking to before discussing the claim.',
  heirs:
    'The claimant is deceased and no living heir is on file. Only a person with standing can file, so no amount of skip tracing helps: find the probate case and add the filing.',
  trace:
    'Not sent to IDI yet and the notice address still looks live. This queue is the next batch: More, Export everyone ready for IDI builds the file in one click.',
  name_search:
    'The address route is spent, either the clerk mail came back or IDI found nobody. Research by name: obituary, social, county records, and confirm against the property that sold.',
  entity: 'An LLC, estate or trust. No consumer record exists; the registered agent on Sunbiz is who can sign.',
  mailed:
    'A letter went out to the address on file and nobody can be phoned. Parked until they reply, so the address is not traced or searched again. A claimant with a callable number stays in Call now even after a letter.',
  hold: 'A person put the file on hold, with a reason. Nobody works it and its drips wait until somebody releases it.',
  closed: 'Paid out, already assigned, or do-not-call. Nothing to do.',
};

/** The drawer's status cuts: key, label, what it means. */
const STATUS_CHIPS: [string, string, string | undefined][] = [
  ['not_tapped', 'No reply yet', 'Nobody has heard back from anyone on this property yet. The working list.'],
  ['missing', 'Untried channel', 'At least one of call, text, email, letter has not been tried on this property.'],
  [
    'letter_due',
    'Letter due',
    'Nobody has replied, there is an address, and the last letter is older than the cadence, or none has gone out.',
  ],
  [
    'update_overdue',
    'Update overdue',
    'A signed claimant who has not heard from us in thirty days. The course says monthly, news or not.',
  ],
  ['short', 'Short window', 'Under two months to the day-340 cutoff the team works to, or past it but still inside the year.'],
  ['estate', 'Estate or probate', undefined],
  ['lien', 'Competing lien filed', 'Informational. Does not block outreach, but the payout may land under the posted surplus.'],
];

const TIER_HELP: Record<string, string> = {
  A: '$25k and up, living owner, no competing lien',
  B: '$10k to $25k, living owner',
  C: '$25k and up, owner deceased',
};

const BAND_OPTS: [string, string][] = [
  ['all', 'Any surplus'],
  ['15-25', '$15k to $25k'],
  ['25-50', '$25k to $50k'],
  ['50+', '$50k+'],
];

const AGE_OPTS: [string, string][] = [
  ['all', 'Any claim age'],
  ['0-7', 'New, last 7 days'],
  ['under-120', 'Under 120 days'],
  ['120-365', '120 to 365 days'],
  ['365+', 'Over 365 days'],
];

/** The board's page sizes, in properties. */
const PAGE_SIZES = [25, 50, 100];

const WINDOW_OPTS: [string, string][] = [
  ['all', 'Any claim window'],
  ['open', 'Other claims still possible'],
  ['closed', 'Other claims closed'],
];

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

/**
 * Whether a run actually pulled the county's list. A run with a few cases
 * that failed still pulled; only one that never got the list, or never
 * finished, did not. Judging by `ok` alone, one bad case out of Lee's few
 * hundred read as "never run".
 */
function pulled(r: any): boolean {
  return !!r.ok || (!!r.finishedAt && (r.scanned || 0) > 0);
}

function feedItems(runs: any[], sources: FeedSource[]) {
  if (!runs.length && !sources.length) return [];
  // One entry per registered feed. A weekly feed judged by the daily rule was
  // amber six days out of seven, which taught everyone to ignore the line.
  const feeds: FeedSource[] = sources.length
    ? sources
    : [{ key: 'duval_taxdeed', county: 'Duval', cadence: 'weekly' }];

  const items = feeds.map((f) => {
    const mine = (r: any) => r.trigger === 'cron' && (!r.source || r.source === f.key);
    const lastCron = runs.find((r) => mine(r) && pulled(r));
    // The newest attempt, pulled or not, so a feed that has started failing
    // says so rather than "never run".
    const lastTry = runs.find(mine);
    const ageHours = lastCron ? (Date.now() - new Date(lastCron.startedAt).getTime()) / 3600000 : Infinity;
    const late = !lastCron || ageHours > staleAfterHours(f.cadence);
    const errs = lastCron?.errors ? `, ${lastCron.errors} case${lastCron.errors === 1 ? '' : 's'} failed` : '';
    // The short form is what sits under the title. The sentence, which used
    // to sit there in full on every visit, is the tooltip.
    const short = !lastCron
      ? lastTry
        ? `${f.county} pull failing`
        : `${f.county} pull has never run`
      : late
        ? `${f.county} pull late, last ${agoLabel(lastCron.startedAt)}`
        : `${f.county} pulled ${agoLabel(lastCron.startedAt)}${errs}`;
    const detail = !lastCron
      ? lastTry
        ? `The ${f.county} pull (${scheduleLabel(f.cadence)}) has not got the county list yet. Last try ${agoLabel(lastTry.startedAt)}${lastTry.message ? `: ${lastTry.message}` : '.'}`
        : `The ${f.county} pull (${scheduleLabel(f.cadence)}) has never succeeded. Cases only arrive when somebody chooses Refresh feed.`
      : late
        ? `The ${f.county} pull last succeeded ${agoLabel(lastCron.startedAt)}. It should run ${scheduleLabel(f.cadence)}.`
        : `${f.county}, ${scheduleLabel(f.cadence)}: ${lastCron.scanned} scanned, ${lastCron.created} new, ${lastCron.updated} updated, ${lastCron.belowFloor} under the floor${errs}.`;
    return { key: f.key, county: f.county, late, short, detail };
  });
  return items;
}

/**
 * The feeds and the call numbers, behind one button instead of two lines of
 * small print under the title. The button keeps the one thing that has to
 * stay visible: a late or failing feed turns it amber and says so, because a
 * broken pull looks exactly like a quiet week on the board.
 *
 * The call numbers only show once there are enough calls to say anything; a
 * best window off four calls is noise dressed as advice.
 */
/** GET /surplus/notice-usage: the notice reader's month. */
type NoticeUsage = { period: string; checks: number; spent: number; budget: number; paused: boolean; left: number | null };

function StatusMenu({ runs, sources, calls, notice }: { runs: any[]; sources: FeedSource[]; calls: any; notice: NoticeUsage | null }) {
  const items = feedItems(runs, sources);
  if (!items.length && !(calls && calls.calls >= 10) && !notice) return null;
  const late = items.filter((i) => i.late);
  const rate = calls ? Math.round((calls.connectRate || 0) * 100) : 0;
  return (
    <details className="dc-menu">
      <summary className={`dc-btn dc-status${late.length ? ' warn' : ''}`} title={late.map((i) => i.detail).join('\n') || 'Every county feed is on time'}>
        <i />
        {late.length ? `${late.length} feed${late.length === 1 ? '' : 's'} late` : 'Status'}
      </summary>
      <div className="dc-menu-list" style={{ minWidth: 320, maxWidth: 420, padding: 12, gap: 10, whiteSpace: 'normal' }}>
        {items.length > 0 && (
          <div>
            <div className="dc-flabel" style={{ marginBottom: 6 }}>County feeds</div>
            <div style={{ display: 'grid', gap: 5 }}>
              {items.map((i) => (
                <div key={i.key} style={{ fontSize: 12.5, lineHeight: 1.45 }} title={i.detail}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      marginRight: 7,
                      background: i.late ? 'var(--amber)' : 'var(--mint)',
                    }}
                  />
                  <span style={{ color: i.late ? 'var(--amber)' : 'var(--text)' }}>{i.short}</span>
                  {i.late && <div style={{ color: 'var(--dim)', fontSize: 11.5, marginLeft: 14 }}>{i.detail}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
        {notice && (
          <div>
            <div className="dc-flabel" style={{ marginBottom: 6 }}>Notice reads, {notice.period}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }} title="Scanned Notices of Surplus Funds read by Claude for the owner's mailing address, from day 95 of the claim clock">
              {notice.checks} read, ${notice.spent.toFixed(2)} spent{notice.budget ? ` of $${notice.budget}` : ''}.
              {notice.paused && <span style={{ color: 'var(--amber)' }}> Paused.</span>}
            </div>
          </div>
        )}
        {calls && calls.calls >= 10 && (
          <div>
            <div className="dc-flabel" style={{ marginBottom: 6 }}>Calls, last {calls.sinceDays} days</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              {calls.calls} placed, {rate}% reached a person.
              {calls.best && (
                <>
                  {' '}
                  Best window so far: <b style={{ color: 'var(--mint)' }}>{calls.best.label}</b> ({calls.best.connected} of{' '}
                  {calls.best.calls}).
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * Pages of 25, 50 or 100 properties. The board used to ask for 200 at once,
 * which was slow to draw and, past 200, quietly left the rest off.
 */
function Pager({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (n: number) => void;
  onPageSize: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= PAGE_SIZES[0]) return null;
  const go = (n: number) => {
    onPage(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 14, fontSize: 13, color: 'var(--dim)' }}>
      <button type="button" className="dc-btn sm" disabled={page <= 1} onClick={() => go(page - 1)}>
        Previous
      </button>
      <span>
        Page <b style={{ color: 'var(--text)' }}>{page}</b> of {pages}
      </span>
      <button type="button" className="dc-btn sm" disabled={page >= pages} onClick={() => go(page + 1)}>
        Next
      </button>
      <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        Per page
        <select className="dc-in" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} style={{ width: 'auto', padding: '6px 9px', fontSize: 12.5 }}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
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
  /** A column header sort, which beats the toolbar's until the toolbar is next changed. */
  const [colSort, setColSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  /**
   * The work queue chip. Replaced the dollar tier as the board's primary cut,
   * and the board lands on Call now: the first screen of the day is the phone
   * list, and one click clears it.
   */
  const [queueQ, setQueueQ] = useState<string | null>('call');
  /** The secondary filters live in a drawer that says how many are on. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  /**
   * Hide sales older than a year. Past that the money can only be requested
   * through an attorney, so the team works the under-a-year list almost
   * always. Remembered in the browser: once on, it stays on. A case with no
   * sale date stays visible, because "unknown" is not "too old".
   */
  const [underYear, setUnderYear] = useState(false);
  /**
   * Hide claims that are not workable yet. The claim window is 120 days from
   * the mailed notice and nobody can be approached until it is nearly up, so
   * the board opens on the ones that are ready. On by default, and remembered
   * once turned off. A claim with no notice and no sale date stays visible,
   * because unknown is not early.
   */
  const [hideEarly, setHideEarly] = useState(true);
  useEffect(() => {
    try {
      setUnderYear(localStorage.getItem('dc-surplus-under-year') === '1');
      setHideEarly(localStorage.getItem('dc-surplus-hide-early') !== '0');
    } catch {
      /* defaults are fine */
    }
  }, []);
  const toggleHideEarly = () => {
    const next = !hideEarly;
    setHideEarly(next);
    try {
      localStorage.setItem('dc-surplus-hide-early', next ? '1' : '0');
    } catch {
      /* defaults are fine */
    }
  };
  const toggleUnderYear = () => {
    const next = !underYear;
    setUnderYear(next);
    try {
      localStorage.setItem('dc-surplus-under-year', next ? '1' : '0');
    } catch {
      /* defaults are fine */
    }
  };
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [chipQ, setChipQ] = useState<string | null>(null);
  /** Only the cases I own. Combines with any queue, unlike the status chips. */
  const [mineQ, setMineQ] = useState(false);
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
  /**
   * The saved IDI batch the board is narrowed to. While it is on, the board
   * shows everyone in the batch: the early, dead, do-not-call and under-a-year
   * cuts are set aside for the query, and put back when it is cleared.
   */
  const [batchQ, setBatchQ] = useState<BatchRef | null>(null);
  /** The Batches window: closed, the list (''), or open on one batch. */
  const [batchesOpen, setBatchesOpen] = useState<string | null>(null);
  /** Total claimant leads behind the properties on screen. */
  const [leadCount, setLeadCount] = useState(0);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const idiFileRef = useRef<HTMLInputElement>(null);
  /** An IDI results file being previewed before it is applied. */
  const [idiFile, setIdiFile] = useState<File | null>(null);
  /** The last list import's report, open until dismissed. */
  const [importReport, setImportReport] = useState<{ fileName: string; result: SurplusImportResult } | null>(null);
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
  /** The notice reader's month: reads, dollars, paused. Null until answered. */
  const [noticeUsage, setNoticeUsage] = useState<NoticeUsage | null>(null);
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

  /**
   * /surplus-funds?lead=<id> opens that claimant's panel, so a link from
   * anywhere else (a drip campaign's roster) lands on the surplus card rather
   * than the generic lead page. The board is narrowed to the claimant's case
   * with every hiding filter off, so the saved filters cannot keep the lead
   * off screen. Nothing here is written to localStorage.
   */
  const [linkedLead, setLinkedLead] = useState<string | null>(null);
  const [linkedClaimant, setLinkedClaimant] = useState<string | null>(null);
  useEffect(() => {
    let id: string | null = null;
    try {
      id = new URLSearchParams(window.location.search).get('lead');
    } catch {
      /* no link to follow */
    }
    if (!id) return;
    surplusAPI
      .get(id)
      .then((res) => {
        const row = res.data || {};
        setQueueQ(null);
        setChipQ(null);
        setTierQ(null);
        setStageQ(null);
        setCounty('all');
        setBand('all');
        setAgeQ('all');
        setLienWin('all');
        setUnderYear(false);
        setHideEarly(false);
        setHideDead(false);
        setHideDnc(false);
        if (row.claimantType === 'lienholder') setCtype('lienholder');
        setQ(row.caseNumber || row.claimant || '');
        setLinkedLead(id);
      })
      .catch(() => say('That surplus lead could not be found.'));
  }, [say]);

  // A typed search answers "is this person anywhere in Dealcore", so it looks
  // past the queue and the cuts the board opens with, the same as a batch.
  const searching = q.trim().length > 0;
  const wide = searching || !!batchQ;

  // Paging. The filters as one key: any change to them goes back to page 1,
  // set during render rather than in an effect so the fetch never runs once
  // with the old page first.
  const filterKey = JSON.stringify([q, queueQ, tierQ, stageQ, ctype, county, band, chipQ, ageQ, lienWin, hideDead, hideDnc, sort, colSort?.key, colSort?.dir, underYear, hideEarly, batchQ?.id, mineQ]);
  const [pageAt, setPageAt] = useState<{ key: string; page: number }>({ key: filterKey, page: 1 });
  const page = pageAt.key === filterKey ? pageAt.page : 1;
  const setPage = (n: number) => setPageAt({ key: filterKey, page: n });
  /** Properties per page, remembered in the browser. */
  const [pageSize, setPageSizeState] = useState(50);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem('dc-surplus-page-size'));
      if (PAGE_SIZES.includes(v)) setPageSizeState(v);
    } catch {
      /* the default is fine */
    }
  }, []);
  const setPageSize = (n: number) => {
    setPageSizeState(n);
    setPage(1);
    try {
      localStorage.setItem('dc-surplus-page-size', String(n));
    } catch {
      /* the default is fine */
    }
  };
  /** Properties matching the filters, across every page. */
  const [total, setTotal] = useState(0);
  // The last query that drew the board. A refetch of the same query (a save
  // in the panel, a touch logged) refreshes in the background instead of
  // blanking the list behind the panel while it reloads.
  const drawnFor = useRef<string | null>(null);
  // Bumped per request, so a slow answer for a page somebody has already left
  // cannot draw over the page they are on.
  const fetchSeq = useRef(0);

  const fetchRows = useCallback(async () => {
    const seq = ++fetchSeq.current;
    const loadKey = `${filterKey}|${page}|${pageSize}`;
    const quiet = drawnFor.current === loadKey;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await surplusAPI.list({
        search: q || undefined,
        queue: (!searching && queueQ) || undefined,
        tier: tierQ || undefined,
        stage: stageQ || undefined,
        claimantType: ctype === 'all' ? undefined : ctype,
        county,
        band: band === 'all' ? undefined : band,
        noticeAge: ageQ === 'all' ? undefined : ageQ,
        // "New, last 7 days" is a deliberate look at what just landed, and
        // asking for the claims under 120 days is the same deliberate look.
        // Both show the early ones whatever this toggle says.
        hideEarly: hideEarly && !wide && ageQ !== '0-7' && ageQ !== 'under-120' ? true : undefined,
        lienWindow: lienWin === 'all' ? undefined : lienWin,
        hideDead: (hideDead && !wide) || undefined,
        hideDnc: (hideDnc && !wide) || undefined,
        hideRetired: searching ? false : undefined,
        contact: chipQ === 'not_tapped' ? 'not_tapped' : undefined,
        missingChannel: chipQ === 'missing' || undefined,
        letterDue: chipQ === 'letter_due' || undefined,
        updateOverdue: chipQ === 'update_overdue' || undefined,
        batch: batchQ?.id,
        mine: mineQ || undefined,
        // These used to narrow the loaded rows in the browser, which was only
        // right while the whole list came back at once. The API applies them
        // per property, before paging.
        estate: chipQ === 'estate' || undefined,
        shortWindow: chipQ === 'short' || undefined,
        competingLien: chipQ === 'lien' || undefined,
        underYear: (underYear && !wide) || undefined,
        sort,
        sortColumn: colSort?.key,
        sortDir: colSort?.dir,
        page,
        pageSize,
      });
      if (seq !== fetchSeq.current) return;
      const data: any[] = res.data.data || [];
      // Past the last page, which a save that shrinks the list can cause.
      const pages = Math.max(1, Math.ceil((res.data.total ?? data.length) / pageSize));
      if (!data.length && page > pages) {
        setPage(pages);
        return;
      }
      setRows(data);
      setTotal(res.data.total ?? data.length);
      drawnFor.current = loadKey;
      setLeadCount(res.data.leadCount ?? data.length);
      setCounties(Array.isArray(res.data.counties) ? res.data.counties : []);
      setFloor(res.data.surplusFloor ?? 15000);
    } catch (err: any) {
      if (seq !== fetchSeq.current) return;
      setError(err?.response?.data?.message || err.message || 'Could not load surplus leads.');
      // A background refresh that fails keeps what is on screen.
      if (!quiet) {
        setRows([]);
        setLeadCount(0);
        setTotal(0);
      }
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, q, searching, wide, queueQ, tierQ, stageQ, ctype, county, band, chipQ, ageQ, lienWin, hideDead, hideDnc, sort, colSort, underYear, hideEarly, batchQ, mineQ, page, pageSize]);

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
   * Indexed off the order the board reports, column header sort included, so
   * the arrows follow whatever filter and sort is on screen rather than some
   * separate order. Null at the ends instead of wrapping, which is what
   * disables the button and makes the end of the list visible.
   */
  const [boardOrder, setBoardOrder] = useState<string[] | null>(null);
  const navRows = inBoardOrder(rows, boardOrder, (r: any) => r.key);
  const openIndex = navRows.findIndex((r: any) => r.key === openId);
  const goTo = (i: number) => setOpenId(navRows[i] ? (navRows[i] as any).key : null);

  // Open the linked claimant once the board carries their property.
  useEffect(() => {
    if (!linkedLead || loading) return;
    const row: any = rows.find((r: any) => (r.claimants || []).some((c: any) => c.id === linkedLead));
    if (!row) return;
    setLinkedClaimant(linkedLead);
    setOpenId(row.key);
    setLinkedLead(null);
  }, [linkedLead, rows, loading]);


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
    surplusAPI
      .noticeUsage()
      .then((r) => setNoticeUsage(r.data || null))
      .catch(() => setNoticeUsage(null));
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

  /**
   * The batch profile search: living claimants nobody can reach, not yet
   * searched. Counts and prices them first, then asks, because every check
   * is paid. The per-card button is for one person; this is the backlog.
   */
  const socialBatch = async () => {
    setPolling(true);
    try {
      const dry = (await surplusAPI.socialSearch({ dryRun: true })).data;
      if (!dry.candidates) {
        say('Nobody to search: every living claimant without a number has been searched already.');
        return;
      }
      const usage = (await surplusAPI.socialUsage()).data;
      if (usage?.paused) {
        say('The profile search is turned off in the API settings. The search links on each card still work.');
        return;
      }
      const limit = Math.min(dry.candidates, 25);
      const est = Math.round(limit * 0.45 * 100) / 100;
      if (
        !window.confirm(
          `${dry.candidates} living claimant${dry.candidates === 1 ? ' has' : 's have'} no number and no profile search yet. Search the web for the first ${limit} now? About $${est}${usage.left == null ? '' : `; $${usage.left} left this month`}.`,
        )
      ) {
        return;
      }
      say(`Searching the web for ${limit} claimant${limit === 1 ? '' : 's'}...`);
      const r = (await surplusAPI.socialSearch({ limit })).data;
      say(
        `Profile search: ${r.checked} searched, ${r.found} with a profile to check, ${r.profiles} profile${r.profiles === 1 ? '' : 's'} filed, $${r.spent} spent` +
          (r.errors ? `. ${r.message || `${r.errors} failed`}` : '.'),
      );
      fetchRows();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The profile search failed.');
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
      // The report, not a toast: the matched rows need reading, and the ruled
      // out ones are the cases nobody should research again.
      setImportReport({ fileName: f.name, result: res.data });
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
  // since a claim is filed per claimant and not per house. Only what is on
  // this page counts: a pick left on another page must not show in the count,
  // the confirm or the CSV when the action would not touch it.
  const chosenRows = rows.filter((r) => picked[r.key]);
  const chosenKeys = chosenRows.map((r) => r.key);
  const chosen = chosenRows.flatMap((r) => r.claimants.map((c: any) => c.id));

  /** Narrow the board to one batch, clearing the other cuts so nobody in it is hidden. */
  const showBatch = (b: BatchRef) => {
    reset();
    setBatchQ(b);
    setBatchesOpen(null);
  };

  const reset = () => {
    setQ('');
    setBatchQ(null);
    setQueueQ(null);
    setTierQ(null);
    setChipQ(null);
    setMineQ(false);
    setStageQ(null);
    setCounty('all');
    setBand('all');
    setCtype('all');
    setAgeQ('all');
    setLienWin('all');
    setHideDead(true);
    setHideDnc(true);
  };

  /** Take off the drawer's filters, leaving the queue, the search and the batch alone. */
  const clearFilters = () => {
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
   * The IDI batch upload file for every claimant on the selected properties,
   * in IDI's Batch Template. Upload it to the profile folder over SFTP and
   * bring the file from its out folder back through Import IDI results.
   */
  const exportIdi = async () => {
    if (!chosen.length || busy) return;
    await runIdiExport(() => surplusAPI.idiExport(chosen), 'Nobody selected can be sent to IDI.');
  };

  /**
   * The Monday click: the whole Send to IDI queue, inside the trace window
   * and not already waiting on a batch, as one file. No selection needed.
   */
  const exportIdiReady = async () => {
    if (busy) return;
    await runIdiExport(
      () => surplusAPI.idiExportReady(county !== 'all' ? county : null),
      'Nobody is ready to send to IDI right now.',
    );
  };

  const runIdiExport = async (call: () => Promise<any>, nobody: string) => {
    setBusy(true);
    try {
      const r = (await call()).data;
      if (r.included) {
        const blob = new Blob([r.csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = r.fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
      const left = r.skipped?.length || 0;
      const waiting = r.waiting ? ` ${r.waiting} more already sent and waiting on IDI.` : '';
      say(
        (r.included
          ? `${r.batch ? `Batch ${r.batch.code}: ` : ''}${r.included} claimant${r.included === 1 ? '' : 's'} in ${r.fileName}. Upload it to the IDI profile folder, beside the out folder.${waiting}`
          : nobody + waiting) +
          (left
            ? ` Left out ${left}: ${r.skipped
                .slice(0, 3)
                .map((x: any) => `${x.claimant} (${x.reason.replace(/\.$/, '')})`)
                .join(', ')}${left > 3 ? ` and ${left - 3} more` : ''}.`
            : ''),
      );
    } catch (err: any) {
      say(err?.response?.data?.message || 'The IDI file could not be built.');
    } finally {
      setBusy(false);
    }
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
    const source = chosenRows.length ? chosenRows : rows;
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
        fmtDay(r.saleDate), r.salePrice, fmtDay(r.noticeDate), r.noticeConfirmed ? 'Yes' : 'No',
        fmtDay(r.claimDeadline), r.daysRemaining, r.grossSurplus, r.totalLiens, r.netToClaimant,
        r.tier, r.dripTrack, r.stage,
        r.arrangement === 'assignment' ? 'Assignment of rights' : 'Limited power of attorney',
        r.totalConsideration, pct(r.pctOfGross), pct(r.pctOfNet),
        r.compliance.rule ? (r.compliance.rule.feeCap == null ? 'none' : `${r.compliance.rule.feeCap}%`) : 'no rule',
        r.compliance.rule?.capConfidence || '-',
        r.compliance.clear ? 'Clear' : 'Blocked', r.compliance.blocks.join(' | '),
        fmtDay(r.certOfDisbursements), fmtDay(r.assignmentDeadline),
        r.phones.map((p: any) => phoneDisplay(p.number)).join(' | '), r.emails.join(' | '),
        r.totalTouches, r.callNotes,
        fmtDate(r.letterMailedAt), r.letterMailedTo,
      ]),
    );
    say(`Exported ${list.length} lead${list.length === 1 ? '' : 's'}.`);
  };

  /**
   * The secondary filters that are on, each with a way to take it off. Drives
   * both the badge on the Filters button and the chips under the queues. The
   * queue is not here: it is the board's primary cut, not a filter somebody
   * could forget they set.
   */
  const filterChips: { key: string; label: string; clear: () => void }[] = [];
  const optLabel = (opts: [string, string][], v: string) => opts.find(([k]) => k === v)?.[1] ?? v;
  if (chipQ) filterChips.push({ key: 'status', label: optLabel(STATUS_CHIPS.map(([k, l]) => [k, l]), chipQ), clear: () => setChipQ(null) });
  if (tierQ) filterChips.push({ key: 'tier', label: `Tier: ${TIER[tierQ as keyof typeof TIER]?.label ?? tierQ}`, clear: () => setTierQ(null) });
  if (stageQ) filterChips.push({ key: 'stage', label: `Stage: ${stageQ}`, clear: () => setStageQ(null) });
  if (county !== 'all') filterChips.push({ key: 'county', label: county, clear: () => setCounty('all') });
  if (band !== 'all') filterChips.push({ key: 'band', label: optLabel(BAND_OPTS, band), clear: () => setBand('all') });
  if (ctype !== 'all') filterChips.push({ key: 'ctype', label: CLAIMANT_TYPE_LABEL[ctype] || ctype, clear: () => setCtype('all') });
  if (ageQ !== 'all') filterChips.push({ key: 'age', label: optLabel(AGE_OPTS, ageQ), clear: () => setAgeQ('all') });
  if (lienWin !== 'all') filterChips.push({ key: 'window', label: optLabel(WINDOW_OPTS, lienWin), clear: () => setLienWin('all') });
  if (!hideDead) filterChips.push({ key: 'dead', label: 'Showing dead', clear: () => setHideDead(true) });
  if (!hideDnc) filterChips.push({ key: 'dnc', label: 'Showing Do-Not-Call', clear: () => setHideDnc(true) });
  const activeFilters = filterChips.length;

  /** The count beside a status chip, where the stats carry one. */
  const statusCount = (k: string): number | null => {
    const n = { not_tapped: stats.notTapped, missing: stats.missingChannel, letter_due: stats.letterDue, update_overdue: stats.updateOverdue }[k];
    return n ?? null;
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
            </div>
            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center' }}>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={onFile} />
              <input
                ref={idiFileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) setIdiFile(f);
                }}
              />
              {/* Everything a caller does not do on a normal day sits behind
                  More: the county pull, the import, the references. One
                  primary button remains. */}
              <StatusMenu runs={runs} sources={sources} calls={callStats} notice={noticeUsage} />
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
                  <button
                    type="button"
                    className="dc-menu-item"
                    onClick={exportIdiReady}
                    disabled={busy}
                    title="Everyone in the Send to IDI queue who is inside the trace window and not already waiting on a batch, as one file. The county filter narrows it."
                  >
                    {busy ? 'Building the file...' : 'Export everyone ready for IDI'}
                  </button>
                  <button
                    type="button"
                    className="dc-menu-item"
                    onClick={() => idiFileRef.current?.click()}
                    disabled={busy}
                    title="The file from the out folder of an IDI batch. Each row is matched to a claimant and shown before anything is written."
                  >
                    Import IDI results
                  </button>
                  <button
                    type="button"
                    className="dc-menu-item"
                    onClick={() => setBatchesOpen('')}
                    title="Every IDI export, what came back, and the people each batch turned up."
                  >
                    IDI batches
                  </button>
                  <Link
                    className="dc-menu-item"
                    href={
                      batchQ
                        ? `/surplus-funds/outreach?batch=${batchQ.id}`
                        : `/surplus-funds/outreach?queue=${queueQ && queueQ !== 'closed' ? queueQ : 'call'}`
                    }
                    title="Every person on this queue or batch, one row each, with what has been tried and what is left."
                  >
                    Outreach list
                  </Link>
                  <button
                    type="button"
                    className="dc-menu-item"
                    onClick={socialBatch}
                    disabled={polling || busy}
                    title="Search the web for the profiles of living claimants nobody can reach. Paid per check; asks first."
                  >
                    Find profiles for the unreachable
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
                placeholder="Search a claimant, relative, phone, email, address or case number"
                aria-label="Search every claim by person, phone, email, address or case number"
              />
              {q && (
                <button onClick={() => setQ('')} style={{ color: 'var(--faint)' }}>
                  ✕
                </button>
              )}
            </div>
            <Sel
              v={sort}
              set={(v: string) => {
                setSort(v);
                setColSort(null);
              }}
              opts={[
                ['work', 'Sort: Call first'],
                ['surplus', 'Sort: Biggest surplus'],
                ['net', 'Sort: Net to claimant'],
                ['notice', 'Sort: Newest notice'],
              ]}
            />
            <button
              className={`dc-tab${hideEarly ? ' on' : ''}`}
              onClick={toggleHideEarly}
              title="Hide claims whose notice is under 110 days old. The 120 day claim window has to be nearly up before anybody can be approached. Stays as you leave it."
            >
              Ready to work
            </button>
            <button
              className={`dc-tab${underYear ? ' on' : ''}`}
              onClick={toggleUnderYear}
              title="Hide sales older than a year. Past that, only an attorney can request the money. Stays on until you turn it off."
            >
              Under a year
            </button>
            <button
              className={`dc-btn${filtersOpen ? ' on' : ''}`}
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              title="Tier, contact status, stage, county, amount, claim age and the lienholder window"
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
            {batchQ && (
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <button
                  type="button"
                  className="dc-tab on"
                  onClick={() => setBatchesOpen(batchQ.id)}
                  title="Open this batch's rows and relatives"
                >
                  Batch {batchQ.code}
                </button>
                <button
                  type="button"
                  className="dc-tab"
                  onClick={() => setBatchQ(null)}
                  aria-label={`Stop showing batch ${batchQ.code}`}
                >
                  ✕
                </button>
              </span>
            )}
            {QUEUES.map(([k, label]) => (
              <button
                key={k}
                className={`dc-tab${queueQ === k && !searching ? ' on' : ''}`}
                onClick={() => {
                  // Picking a queue while a search is in the box means "this
                  // queue", so the search gives way to it.
                  if (searching) {
                    setQ('');
                    setQueueQ(k);
                  } else setQueueQ(queueQ === k ? null : k);
                }}
                title={QUEUE_HELP[k]}
              >
                {label}
                {stats.queues?.[k] != null && (
                  <span style={{ marginLeft: 5, opacity: 0.6 }}>{stats.queues[k]}</span>
                )}
              </button>
            ))}
            <button
              className={`dc-tab${mineQ ? ' on' : ''}`}
              onClick={() => setMineQ(!mineQ)}
              title="Only the cases you own. Set the owner at the top of a case."
              style={{ marginLeft: 'auto' }}
            >
              Mine
            </button>
          </div>

          {/* What is narrowing the board, each with its own ✕. The Filters
              badge said how many were on but not which, so a board that came
              up short sent people opening the drawer to find out why. */}
          {filterChips.length > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              {filterChips.map((c) => (
                <span key={c.key} className="dc-active" style={{ background: 'var(--mintGhost)', color: 'var(--mint)', borderColor: 'var(--mint)' }}>
                  {c.label}
                  <button type="button" onClick={c.clear} aria-label={`Remove ${c.label}`}>
                    ✕
                  </button>
                </span>
              ))}
              {filterChips.length > 1 && (
                <button type="button" className="dc-btn sm" onClick={clearFilters}>
                  Clear all
                </button>
              )}
            </div>
          )}

          {filtersOpen && (
            <div className="dc-drawer">
              {/* Status first: these are the cuts people reach for. "New, 7
                  days" moved to the claim age menu it always duplicated, and
                  the "No reply first" sort went, since No reply yet is the
                  same list without the rest under it. */}
              <div className="dc-drawer-row">
                <span className="dc-flabel">Status</span>
                {STATUS_CHIPS.map(([k, l, help]) => (
                  <button
                    key={k}
                    className={`dc-tab${chipQ === k ? ' on' : ''}`}
                    onClick={() => setChipQ(chipQ === k ? null : k)}
                    title={help}
                  >
                    {l}
                    {statusCount(k) != null && <span style={{ marginLeft: 5, opacity: 0.6 }}>{statusCount(k)}</span>}
                  </button>
                ))}
              </div>
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
                    title={TIER_HELP[t]}
                  >
                    {TIER[t].icon} {TIER[t].label}
                  </button>
                ))}
              </div>
              {/* One menu per question. The stage used to be three buttons and
                  a menu that held the same three. */}
              <div className="dc-drawer-row">
                <span className="dc-flabel">Narrow</span>
                <Sel
                  v={stageQ || 'all'}
                  set={(v) => setStageQ(v === 'all' ? null : v)}
                  opts={[['all', 'Any stage'] as [string, string]].concat(SURPLUS_STAGES.map((x) => [x, x] as [string, string]))}
                />
                <Sel v={county} set={setCounty} opts={countyOpts} />
                <Sel v={band} set={setBand} opts={BAND_OPTS} />
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
                  opts={AGE_OPTS.map(([k, l]) =>
                    k === '0-7' && stats.newSevenDays != null ? [k, `${l} (${stats.newSevenDays})`] : [k, l],
                  )}
                />
                <Sel v={lienWin} set={setLienWin} opts={WINDOW_OPTS} />
              </div>
              <div className="dc-drawer-row">
                <span className="dc-flabel">Hide</span>
                <button className={`dc-danger${hideDead ? '' : ' off'}`} onClick={() => setHideDead(!hideDead)}>
                  Hide dead
                </button>
                <button className={`dc-danger${hideDnc ? '' : ' off'}`} onClick={() => setHideDnc(!hideDnc)}>
                  Hide Do-Not-Call
                </button>
                <button className="dc-btn sm" style={{ marginLeft: 'auto' }} onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            </div>
          )}

          {importReport && (
            <SurplusImportReport
              fileName={importReport.fileName}
              result={importReport.result}
              floorLabel={money(floor)}
              onClose={() => setImportReport(null)}
            />
          )}

          {idiFile && (
            <SurplusIdiImport
              file={idiFile}
              onClose={() => setIdiFile(null)}
              onDone={(summary, batchId) => {
                setIdiFile(null);
                say(summary);
                fetchRows();
                fetchStats();
                // Land on the batch, so the people it turned up are in front
                // of whoever ran it rather than in a toast.
                if (batchId) setBatchesOpen(batchId);
              }}
            />
          )}

          {batchesOpen !== null && (
            <SurplusBatches
              initialBatchId={batchesOpen || null}
              onClose={() => setBatchesOpen(null)}
              onShowOnBoard={showBatch}
              onOpenClaimant={(leadId, b) => {
                showBatch(b);
                setLinkedLead(leadId);
              }}
            />
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
            onOrderChange={setBoardOrder}
            serverSort={{
              key: colSort?.key ?? null,
              dir: colSort?.dir ?? 'desc',
              onChange: (key, dir) => setColSort({ key, dir }),
            }}
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
              ) : searching ? (
                `Nothing in Dealcore matches "${q.trim()}".`
              ) : queueQ ? (
                <span>
                  Nothing in {QUEUE_LABEL[queueQ] || queueQ} right now.{' '}
                  <button className="dc-btn sm" onClick={() => setQueueQ(null)}>
                    Show all {stats.openClaims} open
                  </button>
                </span>
              ) : hideEarly ? (
                <span>
                  Nothing matches those filters. Claims under 110 days old are hidden until the
                  claim window is nearly up.{' '}
                  <button className="dc-btn sm" onClick={toggleHideEarly}>
                    Show the early ones
                  </button>
                </span>
              ) : (
                'Nothing matches those filters.'
              )
            }
            toolbarLeft={
              <span>
                {searching ? (
                  <>
                    {total} propert{total === 1 ? 'y' : 'ies'} match <b>&quot;{q.trim()}&quot;</b> across every
                    claim
                  </>
                ) : queueQ ? (
                  <>
                    {total} in <b>{QUEUE_LABEL[queueQ] || queueQ}</b> · {stats.openClaims} open
                  </>
                ) : (
                  <>
                    {total} propert{total === 1 ? 'y' : 'ies'}
                  </>
                )}
                {leadCount !== total && `, ${leadCount} claimants`}
                {total > rows.length && (
                  <span style={{ color: 'var(--faint)' }}>
                    {' '}
                    · showing {(page - 1) * pageSize + 1} to {(page - 1) * pageSize + rows.length}
                  </span>
                )}
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
                      onClick={exportIdi}
                      title="Download the selected claimants in IDI's Batch Template, at the clerk's notice address when we have one"
                    >
                      Export for IDI
                    </button>
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

          <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={setPageSize} />

          <div style={{ height: 34 }} />
        </div>

        {openProperty && (
          <SurplusWorkPanel
            onPrev={openIndex > 0 ? () => goTo(openIndex - 1) : null}
            onNext={openIndex >= 0 && openIndex < navRows.length - 1 ? () => goTo(openIndex + 1) : null}
            position={openIndex >= 0 ? { index: openIndex, total: navRows.length } : null}
            property={openProperty}
            initialClaimantId={linkedClaimant}
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

