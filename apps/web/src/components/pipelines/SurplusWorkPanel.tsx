'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import CommunicationsTimeline from '@/components/communications/CommunicationsTimeline';
import MessageComposer, { type EmailAction } from '@/components/communications/MessageComposer';
import NotesPanel from '@/components/communications/NotesPanel';
import type { NoteItem, ThreadPerson, TimelineItem } from '@/components/communications/types';
import { authAPI, leadsAPI, surplusAPI, tasksAPI } from '@/lib/api';
import { PersonDrips, SurplusDripProvider, useSurplusDrips } from './SurplusDrips';
import { dueLabel, isOverdue, quickDueDates, todayLocal } from '@/lib/dates';
import { SURPLUS_DEAD_REASONS, deadReasonLabel } from '@/lib/surplus-dead';
import { SURPLUS_EXPENSE_KINDS, SURPLUS_FEE_SCHEDULE_LABEL, expenseLabel, usd } from '@/lib/surplus-money';
import { SURPLUS_TRACE_CHANNELS, SURPLUS_TIER1_CHANNELS, TRACE_RESULTS, channelForSite, traceChannelLabel } from '@/lib/surplus-trace';
import { useDialer } from '@/components/dialer/DialerContext';
import { DNC_STATE, SURPLUS_STAGES } from './format';
import ContactEditor from './ContactEditor';
import SurplusHeirs, { MoveNumber, PersonLine, contactSummary, courtRecordsSearch, personConfidence } from './SurplusHeirs';
import { AddSocialProfile, FindProfilesButton, SocialProfileList } from './SurplusSocial';
import { SOCIAL_LEAD_LABEL, rememberSocialTarget, saveToDealcoreBookmarklet, socialOpener, type SocialProfile } from '@/lib/surplus-social';
import { fmtDate, fmtDay, money, phoneDisplay } from './format';

/**
 * The work panel: everything needed to assess and contact one surplus claimant,
 * without leaving the board.
 *
 * Before this, working a surplus lead meant reading the case on /surplus-funds,
 * then opening /leads/[id] in another tab to actually text or email, then coming
 * back to record the touch. The conversation stack was already lead-scoped and
 * surplus leads are ordinary Lead rows with source=SURPLUS, so this is a wiring
 * job rather than a second messaging implementation: CommunicationsTimeline,
 * MessageComposer and NotesPanel are the same components the lead page uses.
 *
 * The panel does not duplicate the card's editing controls, with one
 * exception: the stage moves from here, per claimant, because the card no
 * longer carries a stage select and a kanban drag restages a whole property.
 * Everything else here is for reading the case and talking to the person.
 */

const CONV_POLL_MS = 8_000;

/**
 * Tabs by kind of work, not by step. Every tab is always one click away and
 * nothing is locked; the panel opens on People before a signature and on
 * Claim after one.
 */
type Tab = 'people' | 'activity' | 'research' | 'claim' | 'details';

const TAB_LABEL: Record<Tab, string> = {
  people: 'People',
  activity: 'Activity',
  research: 'Research',
  claim: 'Claim',
  details: 'Details',
};

interface CaseQuestion {
  key: 'money' | 'signer' | 'person' | 'reach';
  label: string;
  state: 'known' | 'unknown' | 'problem';
  answer: string;
  detail: string | null;
}

/** The document kinds worth pulling out of the ledger, in the order they matter. */
const LEDGER_GROUPS: { kind: string; label: string; tone: string }[] = [
  { kind: 'distribution', label: 'Distribution', tone: 'var(--red)' },
  { kind: 'claim', label: 'Claims filed', tone: 'var(--amber)' },
  { kind: 'denial', label: 'Denials', tone: 'var(--mint)' },
  { kind: 'gov_lien_claim', label: 'Government liens', tone: 'var(--amber)' },
  { kind: 'notice_surplus', label: 'Notice of surplus', tone: 'var(--dim)' },
  { kind: 'mail_undeliverable', label: 'Returned mail', tone: 'var(--red)' },
  { kind: 'mail_delivered', label: 'Delivered mail', tone: 'var(--mint)' },
  { kind: 'probate', label: 'Probate', tone: 'var(--dim)' },
];

const CLAIM_STATUS_TONE: Record<string, string> = {
  denied: 'var(--mint)',
  open: 'var(--mint)',
  gov_lien: 'var(--amber)',
  pending: 'var(--amber)',
  assigned: 'var(--red)',
  distributed: 'var(--red)',
  unknown: 'var(--dim)',
};

interface LedgerDoc {
  title: string;
  kind: string;
  docId?: string | null;
  url?: string | null;
  /** ISO date the county filed it, on sources that publish one. */
  filedAt?: string | null;
  /** The county's document type token, needed to mint a RealTDM link. */
  docType?: string | null;
}

export interface SurplusPanelLead {
  id: string;
  claimant: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string | null;
  caseNumber: string | null;
  parcelId: string | null;
  /** The county's public court-records search, when the API knows it. */
  courtRecordsUrl: string | null;
  stage: string;
  tier: string;
  claimStatus: string;
  claimStatusLabel: string;
  workScore: number;
  workReason: string;
  mailVerdict: string | null;
  claimLedger: LedgerDoc[] | null;
  sourceUrl: string | null;
  lastPolledAt: string | null;
  grossSurplus: number;
  surplusAtNotice: number | null;
  noticeRecipient: string | null;
  ownerMailingStreet: string | null;
  ownerMailingCity: string | null;
  ownerMailingState: string | null;
  ownerMailingZip: string | null;
  /** Null for a US address. */
  ownerMailingCountry?: string | null;
  ownerAddressSource: string | null;
  nameSearch: {
    query: string;
    state: string | null;
    verifyAgainst: string | null;
    reason?: string;
    links: { site: string; url: string; free: boolean }[];
  } | null;
  netToClaimant: number;
  estFee: number | null;
  saleDate: string | null;
  daysSinceSale: number | null;
  noticeDate: string | null;
  noticeConfirmed: boolean;
  daysRemaining: number | null;
  /** bad: marked wrong or disconnected. Shown, never counted as callable. */
  phones: { number: string; type: string | null; dnc: string | null; bad?: boolean }[];
  emails: string[];
  contactMismatch: boolean;
  mismatchedName: string | null;
  heirCount: number;
  livingHeirCount: number;
  callableHeirCount: number;
  /** Relatives, neighbors, friends: people who may know where the claimant is. */
  associateCount: number;
  callableAssociateCount: number;
  associatesUntried: number;
  /** Per-claimant skip trace state, computed server side. */
  trace: {
    state: string;
    label: string;
    tone: 'good' | 'warn' | 'bad' | 'idle';
    detail: string;
    at: string | null;
    /** True only when nothing has been submitted yet. */
    actionable: boolean;
  } | null;
  /** When EnformionGo last searched this claimant, by name or as an estate. */
  enformionSearchedAt?: string | null;
  /** When the claimant last gained a phone or email. */
  contactInfoUpdatedAt?: string | null;
  doNotCall: boolean;
  /** The teammate who owns the case. The course's Owner field. */
  ownerId?: string | null;
  ownerName?: string | null;
  /** The earliest open follow-up: the course's Next action and Due. */
  nextTask?: { id: string; title: string; dueDate: string | null; userId: string | null; userName: string | null } | null;
  openTaskCount?: number;
  /** The last call, text or email that went out to anyone on the claim. */
  lastTouchedAt?: string | null;
  /** The four things every case has to settle, computed by the API. */
  questions?: CaseQuestion[];
  /** At most three things to do, offered when no next action is set. */
  suggestions?: { key: string; text: string }[];
  /** A person put the file on hold, and why. Null when it is not held. */
  heldAt?: string | null;
  holdReason?: string | null;
  /** Set when the hold is a pause: the day it ends. */
  holdUntil?: string | null;
  /** Sixty days of full effort and nobody reached: the rules say pause it. */
  pauseOffer?: { since: string; days: number; until: string } | null;
  /** Under two months to the day-340 cutoff (negative once past it). */
  shortWindow?: boolean;
  daysToCutoff?: number | null;
  isDeceased: boolean;
  /** YYYY-MM-DD, when a people search dated the death. */
  dateOfDeath?: string | null;
  /** 'endato' | 'batchdata' | 'idi' | 'obituary' when a vendor record or an obituary set the flag. */
  deathSource?: string | null;
  /** 'possible' asks for a check on the card before anybody calls. */
  obituaryMatch?: string | null;
  obituary?: {
    url: string | null;
    nameInObituary: string | null;
    dateOfDeath: string | null;
    place: string | null;
    evidence: string;
  } | null;
  totalTouches: number;
  /** Every attempt on record: calls, texts, emails, letters and hand marks, in one number. */
  touchesLogged?: number;
  /** One of us mailed a letter. Date and the address on the envelope. */
  letterMailedAt: string | null;
  letterMailedTo: string | null;
  /** 'not_tapped' | 'tapped' | 'recap_scheduled', from the channels that heard from them. */
  contactStatus: string;
  tappedAt: string | null;
  /** Which of the four channels have been tried, off the records themselves. */
  channels: { called: boolean; texted: boolean; emailed: boolean; lettered: boolean; messaged: boolean };
  channelsMissing: string[];
  /** Social profiles: the third route when no phone or address is live. */
  social: {
    profiles: SocialProfile[];
    /** One-click searches for the claimant on each platform. Empty for an entity. */
    links: { site: string; url: string; free: boolean }[];
    searchedAt: string | null;
    lastSearch: {
      searched: string | null;
      note: string | null;
      found: number;
      /** What tells this person from a namesake, each with the Facebook search it suggests. */
      leads?: { kind: string; value: string; detail: string | null; searchUrl: string | null }[];
    } | null;
  } | null;
  credibilitySentAt: string | null;
  credibilityChannels: string[];
  /** Every envelope on this claim, newest first. */
  letters: {
    id: string;
    mailedAt: string;
    recipientName: string | null;
    address: string | null;
    mailType: string;
    trackingNumber: string | null;
    templateKind: string | null;
    heirId: string | null;
    /** The envelope came back undeliverable. */
    returnedAt: string | null;
  }[];
  letterCount: number;
  /** A letter came back from the mailing address on file, so it is not mailed again. */
  mailReturned?: boolean;
  /** 7 or 14. */
  letterCadenceDays: number;
  letterDueAt: string | null;
  letterDue: boolean;
  /** Three standard letters unanswered: send the next by Priority or FedEx. */
  escalateMail: boolean;
  /** Heirs on file, for addressing a letter. Same shape the heirs panel uses. */
  heirs: {
    id: string;
    name: string;
    address: string | null;
    deceased: boolean;
    /** Only a heir can sign; a relative is who to ask. */
    isHeir?: boolean;
    relationship?: string | null;
    callable?: boolean;
    phones?: { number: string; type: string | null; dnc: string | null }[];
  }[];
  /** The document set: one entry per kind, with the file when there is one. */
  documents: PanelDocument[];
  docsRequired: string[];
  docsMissing: string[];
  docsComplete: boolean;
  /** What each gated stage still needs, keyed by stage name. Empty means ready. */
  stageBlocks: Record<string, string[]>;
  /** Why it died, when it did. */
  deadReason: string | null;
  deadNote: string | null;
  /** What "unresponsive" still needs before it is a reason. Empty when it is. */
  deadGateMissing: string[];
  deadAt: string | null;
  /** Every search run for this person, and what the escalation rule makes of it. */
  tracing: {
    attempts: {
      id: string;
      heirId: string | null;
      channel: string;
      channelLabel: string;
      source: string | null;
      result: string;
      summary: string | null;
      cost: number | null;
      ranAt: string;
    }[];
    channelsTried: string[];
    tier1Done: boolean;
    paidRuns: number;
    tierSkipped: boolean;
    proTracerEligible: boolean;
    lastTier1At: string | null;
    tier1AgeDays: number | null;
    /** No number, nobody reached, and the free searches are sixty days old. */
    tier1RecheckDue: boolean;
    totalCost: number;
  };
  /** After the payout: the survey and whether this claimant may be named to the next one. */
  survey: {
    sentAt: string | null;
    returnedAt: string | null;
    bonusPaidAt: string | null;
    score: number | null;
    comments: string | null;
    overdue: boolean;
  };
  reference: {
    id: string;
    consented: boolean;
    consentedAt: string | null;
    story: string | null;
    quote: string | null;
    county: string | null;
    amountRecovered: number | null;
  } | null;
  /** The money coming back: the county's check, the fee, expenses, both shares, the claimant's check. */
  disbursement: {
    checkReceivedAt: string | null;
    checkAmount: number | null;
    /** The percent typed for this claim, or null when the agreement's schedule applies. */
    feePercentOverride: number | null;
    /** The fee as a percent of the check, typed or the schedule's effective rate. */
    feePercent: number;
    feeScheduled: boolean;
    /** How the fee was arrived at: "40% of $50,000 + 35% of $25,000" or "12%". */
    feeLabel: string;
    feeSchedule: string;
    capPct: number | null;
    expenses: { id: string; kind: string; amount: number; incurredAt: string; note: string | null }[];
    expensesFromClaimantShare: boolean;
    gross: number;
    fee: number;
    expensesTotal: number;
    claimantShare: number;
    companyShare: number;
    companyNet: number;
    considerationPct: number;
    overCap: boolean;
    frozen: boolean;
    reportSignedAt: string | null;
    clearingDueAt: string | null;
    clearingPassed: boolean;
    checkSentAt: string | null;
    checkSentMethod: string | null;
    checkSentTrackingNumber: string | null;
  };
  /** The monthly word to a signed claimant. */
  claimantUpdate: { applies: boolean; lastAt: string | null; daysSince: number | null; overdue: boolean };
  /** The filing: how the package went to the county and what the county said. */
  submission: {
    method: string | null;
    trackingNumber: string | null;
    signatureRequired: boolean | null;
    submittedAt: string | null;
    countyAcknowledgedAt: string | null;
    clerkContactName: string | null;
    clerkStatusNote: string | null;
    additionalDocsRequested: string | null;
    expectedDisbursementAt: string | null;
    daysUnacknowledged: number | null;
  };
  /** The attorney, where the county requires one, and the rule that follows. */
  attorney: {
    required: boolean | null;
    requiredFrom: 'case' | 'county' | null;
    name: string | null;
    firm: string | null;
    phone: string | null;
    email: string | null;
    source: string | null;
    engagedAt: string | null;
    notes: string | null;
    engaged: boolean;
  };
  /** 'attorney' once one is engaged, 'clerk' otherwise. */
  countyContactVia: 'attorney' | 'clerk';
  /** The mobile notary and where the appointment stands. */
  notary: {
    name: string | null;
    phone: string | null;
    email: string | null;
    source: string | null;
    notes: string | null;
    agreementSignedAt: string | null;
    appointmentAt: string | null;
    appointmentPlace: string | null;
    signedInOrderAt: string | null;
    retentionConfirmed: boolean;
  };
  /** The qualification gate and the compliance gate. */
  entitlementVerified: boolean;
  titleSearchComplete: boolean;
  disclosures: Record<string, boolean>;
  compliance: {
    clear: boolean;
    blocks: string[];
    warns: string[];
    rule: {
      feeCap: number | null;
      capConfidence: string;
      requiredDisclosures: string[];
      statuteRefs: string[];
    } | null;
  };
  /** What this county requires to file, off the county table. Null when not on the list. */
  countyInfo: {
    id: string;
    claimFormUrl: string | null;
    surplusListUrl: string | null;
    assignmentPreference: string | null;
    acceptedMethods: string[];
    signatureRequired: boolean | null;
    attorneyRequired: boolean | null;
    clerkContactName: string | null;
    clerkContactPhone: string | null;
    clerkContactEmail: string | null;
    clerkAddress: string | null;
    notes: string | null;
    practiceRunAt: string | null;
    lastVerifiedAt: string | null;
    stale: boolean;
    unknowns: string[];
    /** Every one of the five clerk answers is in. The gate before Agreement Signed. */
    ready: boolean;
    /** The clerk call, question by question. */
    script: { key: string; ask: string; field: string; answered: boolean }[];
  } | null;
  /** The clerk's own row on this case, once added, so county mail is addressed to it. */
  clerkContact: { id: string; name: string } | null;
}

interface PanelDocument {
  id: string | null;
  kind: string;
  label: string;
  docSet: 'ours' | 'county' | 'claimant';
  status: string;
  statusLabel: string;
  collected: boolean;
  required: boolean;
  hasFile: boolean;
  fileName: string | null;
  signedAt: string | null;
  note: string | null;
  updatedAt: string | null;
  /** Generated from a template, and which version this copy came from. */
  hasTemplate: boolean;
  templateVersion: number | null;
  templateActiveVersion: number | null;
  templateStale: boolean;
}

const DOC_SET_LABEL: Record<string, string> = {
  ours: 'Ours',
  county: "The county's",
  claimant: 'From the claimant',
};

const DOC_STATUSES: [string, string][] = [
  ['outstanding', 'Outstanding'],
  ['drafted', 'Drafted'],
  ['sent', 'Sent'],
  ['received', 'Received'],
  ['signed', 'Signed'],
  ['notarized', 'Notarized'],
  ['filed', 'Filed'],
];

/**
 * The document set for this claim, in the course's three sets, with what is
 * still missing said out loud. A file is attached to the checklist entry,
 * so "signed" with a scan behind it and "signed" ticked from paper look
 * different here: one has a View link.
 */
function DocumentsSection({
  lead,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const [storage, setStorage] = useState<{ configured: boolean; message?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    surplusAPI
      .storageStatus()
      .then((r) => setStorage(r.data || { configured: false }))
      .catch(() => setStorage({ configured: false, message: 'status unavailable' }));
  }, []);

  const pick = (kind: string) => {
    setPendingKind(kind);
    fileRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    const kind = pendingKind;
    setPendingKind(null);
    if (!f || !kind) return;
    setBusy(kind);
    try {
      await surplusAPI.uploadDocument(lead.id, kind, f);
      say(`${f.name} attached`);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That file could not be uploaded.');
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (doc: PanelDocument, status: string) => {
    if (status === doc.status) return;
    setBusy(doc.kind);
    try {
      await surplusAPI.setDocumentStatus(lead.id, doc.kind, { status });
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That status could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const view = async (doc: PanelDocument) => {
    if (!doc.id) return;
    try {
      const r = await surplusAPI.documentUrl(doc.id);
      window.open(r.data?.url, '_blank', 'noopener');
    } catch (err: any) {
      say(err?.response?.data?.message || 'The file could not be opened.');
    }
  };

  const remove = async (doc: PanelDocument) => {
    if (!doc.id) return;
    if (!window.confirm(`Remove the ${doc.label.toLowerCase()} file and reset it to outstanding?`)) return;
    setBusy(doc.kind);
    try {
      await surplusAPI.removeDocument(doc.id);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The file could not be removed.');
    } finally {
      setBusy(null);
    }
  };

  const docs = lead.documents || [];
  const required = docs.filter((d) => d.required);
  const inHand = required.filter((d) => d.collected).length;
  const canUpload = !!storage?.configured;
  const groups = (['ours', 'county', 'claimant'] as const).map((set) => ({
    set,
    label: DOC_SET_LABEL[set],
    docs: docs.filter((d) => d.docSet === set),
  }));

  return (
    <Section
      title="Documents"
      note={required.length ? `${inHand} of ${required.length} required in hand` : undefined}
    >
      <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" style={{ display: 'none' }} onChange={onFile} />
      {lead.docsMissing?.length > 0 ? (
        <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
          Still needed before filing:{' '}
          {lead.docsMissing.map((k) => docs.find((d) => d.kind === k)?.label || k).join(', ')}.
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--mint)' }}>Every required document is in hand.</div>
      )}
      {storage && !storage.configured && (
        <div style={{ fontSize: 11, color: 'var(--faint)' }}>
          File upload is off until document storage is configured on the API. Statuses can still be set from paper.
        </div>
      )}
      {groups.map((g) => (
        <div key={g.set} style={{ display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', letterSpacing: 0.3, marginTop: 4 }}>{g.label}</div>
          {g.docs.map((doc) => {
            const tone = doc.collected ? 'var(--mint)' : doc.required ? 'var(--amber)' : 'var(--faint)';
            return (
              <div
                key={doc.kind}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}
              >
                <span style={{ flex: 1, minWidth: 140 }}>
                  {doc.label}
                  {doc.required && !doc.collected && (
                    <span style={{ color: 'var(--amber)', fontSize: 10.5, marginLeft: 5 }}>required</span>
                  )}
                  {doc.fileName && (
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--faint)', overflowWrap: 'anywhere' }}>
                      {doc.fileName}
                      {doc.signedAt ? ` · signed ${fmtDate(doc.signedAt)}` : ''}
                    </span>
                  )}
                  {/* Which wording this copy was built from, and whether the
                      template has moved on since. A stale draft is fine to
                      regenerate; a stale signed copy is a fact to know. */}
                  {doc.templateVersion != null && (
                    <span
                      style={{ display: 'block', fontSize: 11, color: doc.templateStale ? 'var(--amber)' : 'var(--faint)' }}
                    >
                      from template v{doc.templateVersion}
                      {doc.templateStale ? `, revised since (now v${doc.templateActiveVersion})` : ''}
                    </span>
                  )}
                </span>
                {doc.hasTemplate && (
                  <button
                    type="button"
                    className="dc-wp-btn"
                    style={{ padding: '3px 8px', fontSize: 11 }}
                    onClick={() =>
                      window.open(
                        `/surplus-funds/document?lead=${encodeURIComponent(lead.id)}&kind=${encodeURIComponent(doc.kind)}`,
                        '_blank',
                        'noopener',
                      )
                    }
                    title={doc.templateStale ? 'Regenerate from the current template' : 'Build this document from its template'}
                  >
                    {doc.templateStale ? 'Regenerate' : 'Draft'}
                  </button>
                )}
                <select
                  className="dc-wp-sel"
                  value={doc.status}
                  disabled={busy === doc.kind}
                  onChange={(e) => setStatus(doc, e.target.value)}
                  style={{ color: tone, padding: '4px 8px', fontSize: 11.5 }}
                  aria-label={`${doc.label} status`}
                >
                  {DOC_STATUSES.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                {doc.hasFile ? (
                  <>
                    <button type="button" className="dc-wp-btn" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => view(doc)}>
                      View
                    </button>
                    <button
                      type="button"
                      className="dc-wp-btn"
                      style={{ padding: '3px 8px', fontSize: 11 }}
                      disabled={busy === doc.kind}
                      onClick={() => pick(doc.kind)}
                      title="Replace the file"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      className="dc-wp-btn"
                      style={{ padding: '3px 8px', fontSize: 11 }}
                      disabled={busy === doc.kind}
                      onClick={() => remove(doc)}
                      title="Remove the file and reset to outstanding"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="dc-wp-btn"
                    style={{ padding: '3px 8px', fontSize: 11 }}
                    disabled={!canUpload || busy === doc.kind}
                    onClick={() => pick(doc.kind)}
                    title={canUpload ? 'Attach a PDF or photo' : 'Document storage is not configured'}
                  >
                    {busy === doc.kind ? 'Uploading...' : 'Upload'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </Section>
  );
}

/**
 * After the payout: the survey that went with the check, and the ask that
 * builds the reference library. The course's strongest answer to "can I
 * trust you" is somebody who was paid saying so, so every payout is asked
 * and consent is a dated fact rather than an assumption.
 */
function SurveySection({
  lead,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const s = lead.survey || ({} as SurplusPanelLead['survey']);
  const ref = lead.reference;
  const [busy, setBusy] = useState(false);
  const [score, setScore] = useState<number | null>(s.score ?? null);
  const [comments, setComments] = useState(s.comments || '');
  const [story, setStory] = useState(ref?.story || '');
  const [quote, setQuote] = useState(ref?.quote || '');
  const [refOpen, setRefOpen] = useState(false);

  useEffect(() => {
    setScore(s.score ?? null);
    setComments(s.comments || '');
    setStory(ref?.story || '');
    setQuote(ref?.quote || '');
    setRefOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, s.score, ref?.story, ref?.quote]);

  const paid = lead.stage === 'Paid' || !!s.sentAt;
  if (!paid) return null;

  const save = async (patch: any, done: string) => {
    setBusy(true);
    try {
      await surplusAPI.update(lead.id, patch);
      say(done);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const saveRef = async (consented: boolean) => {
    setBusy(true);
    try {
      await surplusAPI.saveReference(lead.id, { consented, story: story.trim() || null, quote: quote.trim() || null });
      say(consented ? `${lead.claimant} is now a reference` : 'Reference saved, not consented');
      setRefOpen(false);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The reference could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 12.5,
    padding: '6px 8px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--surface2)',
    color: 'inherit',
  };
  const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--dim)' };

  return (
    <Section
      title="After the payout"
      note={ref?.consented ? 'Reference on file' : s.returnedAt ? 'Survey back' : s.sentAt ? 'Survey out' : undefined}
    >
      <Row k="Survey sent with the check" v={s.sentAt ? fmtDate(s.sentAt) : 'not yet'} />
      {s.overdue && (
        <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
          Ten days and no survey back. Ask {lead.claimant}, and remind them of the bonus for returning it.
        </div>
      )}
      {!s.returnedAt ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="dc-wp-btn on"
            disabled={busy}
            onClick={() => save({ surveyReturnedAt: new Date().toISOString() }, 'Survey recorded as returned')}
          >
            Survey came back
          </button>
        </div>
      ) : (
        <>
          <Row k="Survey returned" v={fmtDate(s.returnedAt)} tone="var(--mint)" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ color: 'var(--dim)' }}>Score</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`dc-wp-btn${score === n ? ' on' : ''}`}
                style={{ padding: '3px 8px', fontSize: 11 }}
                disabled={busy}
                onClick={() => {
                  setScore(n);
                  save({ surveyScore: n }, `Score ${n} of 5`);
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <label style={lbl}>
            What they said
            <input
              style={field}
              value={comments}
              placeholder="Their comments, in brief"
              onChange={(e) => setComments(e.target.value)}
              onBlur={() => comments !== (s.comments || '') && save({ surveyComments: comments.trim() || null }, 'Comments saved')}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ color: 'var(--dim)' }}>Return bonus</span>
            {s.bonusPaidAt ? (
              <span style={{ color: 'var(--mint)' }}>paid {fmtDate(s.bonusPaidAt)}</span>
            ) : (
              <button
                type="button"
                className="dc-wp-btn"
                style={{ padding: '3px 8px', fontSize: 11 }}
                disabled={busy}
                onClick={() => save({ surveyBonusPaidAt: new Date().toISOString() }, 'Bonus recorded as paid')}
              >
                Mark paid
              </button>
            )}
          </div>
        </>
      )}

      {/* The reference. */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', letterSpacing: 0.3, marginTop: 4 }}>Reference</div>
      {ref?.consented ? (
        <div style={{ fontSize: 12.5 }}>
          <span style={{ color: 'var(--mint)', fontWeight: 600 }}>Agreed to be named</span>
          <span style={{ color: 'var(--faint)' }}> {ref.consentedAt ? fmtDate(ref.consentedAt) : ''}</span>
          {ref.quote && <div style={{ color: 'var(--dim)', marginTop: 2 }}>&ldquo;{ref.quote}&rdquo;</div>}
          {ref.story && <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>{ref.story}</div>}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--faint)' }}>
          {ref ? 'On file, not consented to be named.' : `Ask ${lead.claimant} whether their story can be shared with the next claimant.`}
        </div>
      )}
      {!refOpen ? (
        <div>
          <button type="button" className="dc-wp-btn" onClick={() => setRefOpen(true)}>
            {ref ? 'Edit the reference' : 'Record the reference'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
          <label style={lbl}>
            Their story, a few sentences
            <textarea style={{ ...field, minHeight: 60 }} value={story} onChange={(e) => setStory(e.target.value)} />
          </label>
          <label style={lbl}>
            A line in their words, optional
            <input style={field} value={quote} onChange={(e) => setQuote(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => setRefOpen(false)}>
              Cancel
            </button>
            <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => saveRef(false)}>
              Save, not consented
            </button>
            <button type="button" className="dc-wp-btn on" disabled={busy} onClick={() => saveRef(true)}>
              Save, they agreed to be named
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

/**
 * The money coming back, in the course's order: the check arrives and the
 * claimant is told the same day, every expense is itemized, the report is
 * signed by the claimant before funds move, the county's check clears for
 * thirty days, then the claimant's check goes out tracked. The Paid stage
 * follows from the last step rather than being set by hand.
 */
function DisbursementSection({
  lead,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const m = lead.disbursement || ({} as SurplusPanelLead['disbursement']);
  const [busy, setBusy] = useState(false);
  const [receivedAt, setReceivedAt] = useState(m.checkReceivedAt ? m.checkReceivedAt.slice(0, 10) : '');
  const [amount, setAmount] = useState(m.checkAmount != null ? String(m.checkAmount) : '');
  const [feePct, setFeePct] = useState(m.feePercentOverride != null ? String(m.feePercentOverride) : '');
  const [expKind, setExpKind] = useState('title_search');
  const [expAmount, setExpAmount] = useState('');
  const [expNote, setExpNote] = useState('');
  const [sentAt, setSentAt] = useState(m.checkSentAt ? m.checkSentAt.slice(0, 10) : '');
  const [sentMethod, setSentMethod] = useState(m.checkSentMethod || 'usps');
  const [sentTracking, setSentTracking] = useState(m.checkSentTrackingNumber || '');

  useEffect(() => {
    setReceivedAt(m.checkReceivedAt ? m.checkReceivedAt.slice(0, 10) : '');
    setAmount(m.checkAmount != null ? String(m.checkAmount) : '');
    setFeePct(m.feePercentOverride != null ? String(m.feePercentOverride) : '');
    setSentAt(m.checkSentAt ? m.checkSentAt.slice(0, 10) : '');
    setSentMethod(m.checkSentMethod || 'usps');
    setSentTracking(m.checkSentTrackingNumber || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, m.checkReceivedAt, m.checkAmount, m.feePercentOverride, m.checkSentAt]);

  const save = async (patch: any, done: string) => {
    setBusy(true);
    try {
      await surplusAPI.update(lead.id, patch);
      say(done);
      onChanged();
      return true;
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addExpense = async () => {
    const n = Number(expAmount);
    if (!Number.isFinite(n) || n <= 0) return;
    setBusy(true);
    try {
      await surplusAPI.addExpense(lead.id, { kind: expKind, amount: n, note: expNote.trim() || null });
      setExpAmount('');
      setExpNote('');
      say('Expense added');
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The expense could not be added.');
    } finally {
      setBusy(false);
    }
  };

  const removeExpense = async (id: string) => {
    setBusy(true);
    try {
      await surplusAPI.removeExpense(id);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The expense could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 12.5,
    padding: '6px 8px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--surface2)',
    color: 'inherit',
  };
  const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--dim)' };
  const relevant = ['Awaiting Disbursement', 'Check Received', 'Paid'].includes(lead.stage) || !!m.checkReceivedAt;
  if (!relevant) return null;

  const openReport = () => window.open(`/surplus-funds/disbursement?lead=${encodeURIComponent(lead.id)}`, '_blank', 'noopener');

  return (
    <Section
      title="The check and the shares"
      note={m.frozen ? `Paid ${fmtDate(m.checkSentAt)}` : m.checkReceivedAt ? `Check in hand ${fmtDate(m.checkReceivedAt)}` : undefined}
    >
      {/* 1. The check. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <label style={lbl}>
          Check received
          <input type="date" style={field} value={receivedAt} disabled={m.frozen} onChange={(e) => setReceivedAt(e.target.value)} />
        </label>
        <label style={lbl}>
          Amount
          <input style={field} value={amount} disabled={m.frozen} placeholder="0.00" onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label style={lbl} title={`Blank means the agreement's schedule: ${m.feeSchedule || SURPLUS_FEE_SCHEDULE_LABEL}${m.capPct != null ? `, reduced to the ${m.capPct}% legal cap` : ''}`}>
          Fee % override{m.capPct != null ? `, cap ${m.capPct}` : ''}
          <input style={field} value={feePct} disabled={m.frozen} placeholder="schedule" onChange={(e) => setFeePct(e.target.value)} />
        </label>
      </div>
      {!m.frozen && (
        <div>
          <button
            type="button"
            className="dc-wp-btn on"
            disabled={busy}
            onClick={() =>
              save(
                {
                  checkReceivedAt: receivedAt ? new Date(receivedAt).toISOString() : null,
                  checkAmount: amount.trim() ? Number(amount) : null,
                  feePercent: feePct.trim() ? Number(feePct) : null,
                },
                receivedAt && !m.checkReceivedAt ? 'Check recorded. Clearing started, the claimant is owed a call today.' : 'Saved',
              )
            }
          >
            Save the check
          </button>
        </div>
      )}
      {m.clearingDueAt && (
        <div style={{ fontSize: 11.5, color: m.clearingPassed ? 'var(--mint)' : 'var(--amber)' }}>
          {m.clearingPassed ? `Cleared ${fmtDate(m.clearingDueAt)}.` : `Clearing until ${fmtDate(m.clearingDueAt)}. Nothing goes out before then.`}
        </div>
      )}

      {/* 2. Expenses. */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', letterSpacing: 0.3, marginTop: 4 }}>Expenses</div>
      {m.expenses.length === 0 && <div style={{ fontSize: 12, color: 'var(--faint)' }}>None recorded.</div>}
      {m.expenses.map((e) => (
        <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5 }}>
          <span style={{ flex: 1 }}>
            {expenseLabel(e.kind)}
            {e.note ? <span style={{ color: 'var(--faint)' }}> · {e.note}</span> : null}
            <span style={{ color: 'var(--faint)', fontSize: 11 }}> {fmtDate(e.incurredAt)}</span>
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{usd(e.amount)}</span>
          {!m.frozen && (
            <button type="button" className="dc-wp-btn" style={{ padding: '2px 7px', fontSize: 11 }} disabled={busy} onClick={() => removeExpense(e.id)}>
              ✕
            </button>
          )}
        </div>
      ))}
      {!m.frozen && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1fr auto', gap: 6, alignItems: 'end' }}>
          <select className="dc-wp-sel" value={expKind} onChange={(e) => setExpKind(e.target.value)} aria-label="Expense kind">
            {SURPLUS_EXPENSE_KINDS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <input style={field} value={expAmount} placeholder="0.00" onChange={(e) => setExpAmount(e.target.value)} aria-label="Amount" />
          <input style={field} value={expNote} placeholder="Note" onChange={(e) => setExpNote(e.target.value)} aria-label="Note" />
          <button type="button" className="dc-wp-btn" disabled={busy || !expAmount} onClick={addExpense}>
            Add
          </button>
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <input
          type="checkbox"
          checked={!!m.expensesFromClaimantShare}
          disabled={m.frozen || busy}
          onChange={(e) => save({ expensesFromClaimantShare: e.target.checked }, e.target.checked ? 'Expenses come out of the claimant’s share' : 'Expenses borne by the company')}
        />
        <span>
          Expenses come out of the claimant&apos;s share
          <span style={{ display: 'block', fontSize: 11, color: 'var(--faint)' }}>
            They then count as consideration toward the Florida cap. Off, the company bears them.
          </span>
        </span>
      </label>

      {/* 3. The shares. */}
      <div style={{ display: 'grid', gap: 3, fontSize: 13, padding: '8px 10px', borderRadius: 6, background: 'var(--bg2)' }}>
        <Row k="Surplus received" v={usd(m.gross)} />
        <Row k={m.feeScheduled ? `Fee, ${m.feeLabel}` : `Fee at ${m.feePercent}%`} v={usd(m.fee)} />
        <Row k={m.expensesFromClaimantShare ? 'Expenses, from the claimant' : 'Expenses, borne by us'} v={usd(m.expensesTotal)} />
        <Row k={`To ${lead.claimant}`} v={usd(m.claimantShare)} tone="var(--mint)" />
        <Row k="Company share" v={usd(m.companyShare)} />
        <Row k="Company net after expenses" v={usd(m.companyNet)} tone={m.companyNet < 0 ? 'var(--red)' : undefined} />
        <div style={{ fontSize: 11, color: m.overCap ? 'var(--red)' : 'var(--faint)' }}>
          Total consideration {m.considerationPct}% of the check{m.capPct != null ? `, cap ${m.capPct}%` : ', no statutory cap while the clerk holds the funds'}.
          {m.overCap ? ' Over the cap: reduce the fee or stop passing expenses before this is signed.' : ''}
        </div>
      </div>

      {/* 4. The report and the claimant's signature. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="dc-wp-btn" onClick={openReport}>
          Print the report
        </button>
        {m.reportSignedAt ? (
          <span style={{ fontSize: 12, color: 'var(--mint)' }}>Signed by {lead.claimant} {fmtDate(m.reportSignedAt)}</span>
        ) : (
          <button
            type="button"
            className="dc-wp-btn"
            disabled={busy || !m.checkAmount || m.overCap}
            title={!m.checkAmount ? 'Record the check first' : m.overCap ? 'Over the cap' : 'Record that the claimant signed the report today'}
            onClick={() => save({ disbursementReportSignedAt: new Date().toISOString() }, 'Report recorded as signed')}
          >
            Claimant signed the report
          </button>
        )}
      </div>

      {/* 5. The claimant's check. */}
      {m.reportSignedAt && !m.frozen && (
        <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>Send {lead.claimant}&apos;s check, {usd(m.claimantShare)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <label style={lbl}>
              Sent
              <input type="date" style={field} value={sentAt} onChange={(e) => setSentAt(e.target.value)} />
            </label>
            <label style={lbl}>
              By
              <select style={field} value={sentMethod} onChange={(e) => setSentMethod(e.target.value)}>
                <option value="usps">USPS</option>
                <option value="fedex">FedEx</option>
                <option value="ups">UPS</option>
                <option value="in_person">In person</option>
              </select>
            </label>
            <label style={lbl}>
              Tracking, signature required
              <input style={field} value={sentTracking} onChange={(e) => setSentTracking(e.target.value)} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="dc-wp-btn on"
              disabled={busy || !sentAt || !m.clearingPassed}
              title={m.clearingPassed ? 'Records the check as sent, freezes the shares, and marks the claim Paid' : `Clearing until ${fmtDate(m.clearingDueAt)}`}
              onClick={() =>
                save(
                  {
                    checkSentAt: new Date(sentAt).toISOString(),
                    checkSentMethod: sentMethod,
                    checkSentTrackingNumber: sentTracking.trim() || null,
                  },
                  `${lead.claimant} paid. Claim closed.`,
                )
              }
            >
              Check sent, claim paid
            </button>
            {!m.clearingPassed && <span style={{ fontSize: 11, color: 'var(--amber)' }}>Waits for the clearing period.</span>}
          </div>
        </div>
      )}
      {m.frozen && (
        <div style={{ fontSize: 12, color: 'var(--mint)' }}>
          Check sent {fmtDate(m.checkSentAt)}{m.checkSentMethod ? ` by ${m.checkSentMethod.toUpperCase()}` : ''}
          {m.checkSentTrackingNumber ? `, tracking ${m.checkSentTrackingNumber}` : ''}. Shares frozen.
        </div>
      )}
    </Section>
  );
}

const SUBMISSION_METHODS: [string, string][] = [
  ['usps', 'USPS'],
  ['fedex', 'FedEx'],
  ['ups', 'UPS'],
  ['in_person', 'In person'],
  ['efile', 'E-file'],
];

/**
 * The filing: how the package went to the county and what the county has
 * said since. The tracking number is what makes "we mailed it" a fact, and
 * the acknowledgement date is what moves the claim to Awaiting Disbursement
 * and closes the "check with the clerk" task. The county's accepted methods
 * narrow the choice so a package does not go by a carrier the clerk refuses.
 */
function FilingSection({
  lead,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const s = lead.submission || ({} as SurplusPanelLead['submission']);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState(s.method || '');
  const [tracking, setTracking] = useState(s.trackingNumber || '');
  const [signature, setSignature] = useState<boolean | null>(s.signatureRequired ?? null);
  const [submittedAt, setSubmittedAt] = useState(s.submittedAt ? s.submittedAt.slice(0, 10) : '');
  const [acknowledgedAt, setAcknowledgedAt] = useState(s.countyAcknowledgedAt ? s.countyAcknowledgedAt.slice(0, 10) : '');
  const [clerk, setClerk] = useState(s.clerkContactName || '');
  const [note, setNote] = useState(s.clerkStatusNote || '');
  const [extraDocs, setExtraDocs] = useState(s.additionalDocsRequested || '');
  const [expected, setExpected] = useState(s.expectedDisbursementAt ? s.expectedDisbursementAt.slice(0, 10) : '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setMethod(s.method || '');
    setTracking(s.trackingNumber || '');
    setSignature(s.signatureRequired ?? null);
    setSubmittedAt(s.submittedAt ? s.submittedAt.slice(0, 10) : '');
    setAcknowledgedAt(s.countyAcknowledgedAt ? s.countyAcknowledgedAt.slice(0, 10) : '');
    setClerk(s.clerkContactName || '');
    setNote(s.clerkStatusNote || '');
    setExtraDocs(s.additionalDocsRequested || '');
    setExpected(s.expectedDisbursementAt ? s.expectedDisbursementAt.slice(0, 10) : '');
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, s.method, s.trackingNumber, s.submittedAt, s.countyAcknowledgedAt, s.clerkStatusNote]);

  const allowed = lead.countyInfo?.acceptedMethods?.length ? lead.countyInfo.acceptedMethods : null;
  const methods = allowed ? SUBMISSION_METHODS.filter(([k]) => allowed.includes(k)) : SUBMISSION_METHODS;
  const tracked = ['usps', 'fedex', 'ups'].includes(method);
  const filedStage = ['Claim Filed', 'Awaiting Disbursement', 'Check Received', 'Paid'].includes(lead.stage);

  const save = async () => {
    setBusy(true);
    try {
      await surplusAPI.update(lead.id, {
        submissionMethod: method || null,
        submissionTrackingNumber: tracking.trim() || null,
        submissionSignatureRequired: signature,
        submittedAt: submittedAt ? new Date(submittedAt).toISOString() : null,
        countyAcknowledgedAt: acknowledgedAt ? new Date(acknowledgedAt).toISOString() : null,
        clerkContactName: clerk.trim() || null,
        clerkStatusNote: note.trim() || null,
        additionalDocsRequested: extraDocs.trim() || null,
        expectedDisbursementAt: expected ? new Date(expected).toISOString() : null,
      });
      say('Filing saved');
      setDirty(false);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 12.5,
    padding: '6px 8px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--surface2)',
    color: 'inherit',
  };
  const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--dim)' };
  const mark = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  const summary = !s.submittedAt
    ? filedStage
      ? 'Filed, date not recorded'
      : undefined
    : s.countyAcknowledgedAt
      ? `Acknowledged ${fmtDate(s.countyAcknowledgedAt)}`
      : `Submitted ${fmtDate(s.submittedAt)}, awaiting acknowledgement`;

  return (
    <Section title="The filing" note={summary}>
      {s.daysUnacknowledged != null && s.daysUnacknowledged >= 21 && (
        <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
          {s.daysUnacknowledged} days since filing with no acknowledgement from the county.
          {lead.countyContactVia === 'attorney' ? ` Ask ${lead.attorney?.name || 'the attorney'}.` : ' Call the clerk.'}
        </div>
      )}
      {s.additionalDocsRequested && (
        <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>County asked for: {s.additionalDocsRequested}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <label style={lbl}>
          Submitted by
          <select style={field} value={method} onChange={(e) => mark(setMethod)(e.target.value)}>
            <option value="">Not yet</option>
            {methods.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          {allowed && <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>Only what {lead.county} accepts</span>}
        </label>
        <label style={lbl}>
          {tracked ? 'Tracking number, required' : 'Tracking or confirmation number'}
          <input style={field} value={tracking} onChange={(e) => mark(setTracking)(e.target.value)} />
        </label>
        <label style={lbl}>
          Date submitted
          <input type="date" style={field} value={submittedAt} onChange={(e) => mark(setSubmittedAt)(e.target.value)} />
        </label>
        <label style={lbl}>
          County acknowledged receipt
          <input type="date" style={field} value={acknowledgedAt} onChange={(e) => mark(setAcknowledgedAt)(e.target.value)} />
        </label>
        <label style={lbl}>
          Clerk contact
          <input style={field} value={clerk} placeholder={lead.countyInfo?.clerkContactName || 'Name'} onChange={(e) => mark(setClerk)(e.target.value)} />
        </label>
        <label style={lbl}>
          Expected disbursement
          <input type="date" style={field} value={expected} onChange={(e) => mark(setExpected)(e.target.value)} />
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <span style={{ color: 'var(--dim)' }}>Signature on delivery</span>
        {([
          [null, 'Not set'],
          [true, 'Yes'],
          [false, 'No'],
        ] as [boolean | null, string][]).map(([v, l]) => (
          <button
            key={String(v)}
            type="button"
            className={`dc-wp-btn${signature === v ? ' on' : ''}`}
            style={{ padding: '3px 8px', fontSize: 11 }}
            onClick={() => mark(setSignature)(v)}
          >
            {l}
          </button>
        ))}
      </div>
      <label style={lbl}>
        Clerk status note
        <input style={field} value={note} placeholder="What the clerk said last time" onChange={(e) => mark(setNote)(e.target.value)} />
      </label>
      <label style={lbl}>
        Additional documents requested
        <input style={field} value={extraDocs} placeholder="Anything the county asked for after filing" onChange={(e) => mark(setExtraDocs)(e.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" className="dc-wp-btn on" disabled={busy || !dirty} onClick={save}>
          {busy ? 'Saving...' : 'Save filing'}
        </button>
        {acknowledgedAt && !s.countyAcknowledgedAt && lead.stage === 'Claim Filed' && (
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>Saving the acknowledgement moves the claim to Awaiting Disbursement.</span>
        )}
      </div>
    </Section>
  );
}

const ATTORNEY_SOURCES: [string, string][] = [
  ['martindale', 'Martindale.com'],
  ['lawyers_com', 'Lawyers.com'],
  ['county_records', 'A prior overage case in county records'],
  ['referral', 'Referral'],
  ['other', 'Other'],
];

/**
 * The attorney, where the county requires one, and the rule that follows
 * from engaging one: every contact with the county and the court goes
 * through them. The rule is printed on the case rather than remembered, so
 * nobody rings the clerk by mistake, and the county follow-up tasks are
 * addressed to the attorney the moment one is engaged.
 */
function AttorneySection({
  lead,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const a = lead.attorney || ({} as SurplusPanelLead['attorney']);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(a.name || '');
  const [firm, setFirm] = useState(a.firm || '');
  const [phone, setPhone] = useState(a.phone || '');
  const [email, setEmail] = useState(a.email || '');
  const [source, setSource] = useState(a.source || '');
  const [notes, setNotes] = useState(a.notes || '');

  useEffect(() => {
    setEditing(false);
    setName(a.name || '');
    setFirm(a.firm || '');
    setPhone(a.phone || '');
    setEmail(a.email || '');
    setSource(a.source || '');
    setNotes(a.notes || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  const save = async (patch: any, done: string) => {
    setBusy(true);
    try {
      await surplusAPI.update(lead.id, patch);
      say(done);
      onChanged();
      return true;
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 12.5,
    padding: '6px 8px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--surface2)',
    color: 'inherit',
  };
  const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--dim)' };

  const requiredLabel =
    a.required === null
      ? 'not known'
      : a.required
        ? `yes${a.requiredFrom === 'county' ? ', per the county' : ', set on this case'}`
        : `no${a.requiredFrom === 'county' ? ', per the county' : ', set on this case'}`;

  return (
    <Section
      title="The attorney"
      note={a.engaged ? `Engaged${a.engagedAt ? ` ${fmtDate(a.engagedAt)}` : ''}` : undefined}
    >
      {/* The rule, first and loud, because it is the thing that gets broken. */}
      {a.engaged && (
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            background: 'var(--bg2)',
            borderLeft: '3px solid var(--amber)',
            fontSize: 12.5,
          }}
        >
          <b style={{ color: 'var(--amber)' }}>All contact with the county and the court goes through {a.name || 'the attorney'}.</b>
          <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 2 }}>
            Do not ring the clerk about this claim. County follow-up tasks on this file are addressed to the attorney.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--dim)' }}>Required to file</span>
        <span style={{ fontWeight: 600, color: a.required ? 'var(--amber)' : 'inherit' }}>{requiredLabel}</span>
        <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
          {([
            [null, 'County default'],
            [true, 'Yes'],
            [false, 'No'],
          ] as [boolean | null, string][]).map(([v, l]) => (
            <button
              key={String(v)}
              type="button"
              className={`dc-wp-btn${(a.requiredFrom === 'case' ? a.required : null) === v ? ' on' : ''}`}
              style={{ padding: '3px 8px', fontSize: 11 }}
              disabled={busy}
              onClick={() => save({ attorneyRequired: v }, v === null ? 'Using the county answer' : `Attorney required: ${l.toLowerCase()}`)}
              title={v === null ? "Use the county's answer from the county table" : `Override the county for this case: ${l.toLowerCase()}`}
            >
              {l}
            </button>
          ))}
        </span>
      </div>

      {!editing ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--dim)' }}>Attorney</span>
          <span style={{ fontWeight: 600, flex: 1 }}>
            {a.name || <span style={{ color: 'var(--faint)', fontWeight: 400 }}>none on the case</span>}
            {a.firm ? `, ${a.firm}` : ''}
            {a.phone ? ` · ${a.phone}` : ''}
            {a.email ? ` · ${a.email}` : ''}
            {a.source ? (
              <span style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 400 }}>
                {' '}
                found via {ATTORNEY_SOURCES.find(([k]) => k === a.source)?.[1] || a.source}
              </span>
            ) : null}
          </span>
          <button type="button" className="dc-wp-btn" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => setEditing(true)}>
            {a.name ? 'Edit' : 'Add attorney'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <label style={lbl}>
              Name
              <input style={field} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label style={lbl}>
              Firm
              <input style={field} value={firm} onChange={(e) => setFirm(e.target.value)} />
            </label>
            <label style={lbl}>
              Phone
              <input style={field} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label style={lbl}>
              Email
              <input style={field} value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </div>
          <label style={lbl}>
            Found on
            <select style={field} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Not recorded</option>
              {ATTORNEY_SOURCES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label style={lbl}>
            Notes
            <input style={field} value={notes} placeholder="Fee, scope, anything to remember" onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="dc-wp-btn on"
              disabled={busy}
              onClick={async () => {
                const ok = await save(
                  {
                    attorneyName: name.trim() || null,
                    attorneyFirm: firm.trim() || null,
                    attorneyPhone: phone.trim() || null,
                    attorneyEmail: email.trim() || null,
                    attorneySource: source || null,
                    attorneyNotes: notes.trim() || null,
                  },
                  'Attorney saved',
                );
                if (ok) setEditing(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {a.name && !a.engagedAt && (
        <div>
          <button
            type="button"
            className="dc-wp-btn on"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Mark ${a.name} as engaged on this claim? From then on all county and court contact goes through them, and the open county tasks are re-addressed.`)) return;
              save({ attorneyEngagedAt: new Date().toISOString() }, `${a.name} engaged. County contact now goes through them.`);
            }}
          >
            Mark engaged
          </button>
        </div>
      )}
      {a.engagedAt && (
        <div>
          <button
            type="button"
            className="dc-wp-btn"
            disabled={busy}
            onClick={() => save({ attorneyEngagedAt: null }, 'Engagement cleared')}
            title="Undo a mistaken mark. The attorney stays on the case."
          >
            Clear engagement
          </button>
        </div>
      )}
      {a.required && !a.engaged && (
        <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
          This county requires an attorney to file. Claim Filed stays closed until one is engaged.
        </div>
      )}
    </Section>
  );
}

const NOTARY_SOURCES: [string, string][] = [
  ['123notary', '123notary.com'],
  ['notaryrotary', 'notaryrotary.com'],
  ['other', 'Other'],
];

/**
 * The mobile notary: who, the signed instruction sheet, the appointment, and
 * the confirmation that everything was signed in the printed order.
 *
 * The order of the controls is the course's rule. The appointment cannot be
 * booked until the notary has signed the sheet, because that is what locks
 * in the document list, the payment and the signing order. Confirming
 * "signed in order" moves the document set with it, which is what the
 * Package Notarized gate waits for.
 */
function NotarySection({
  lead,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const n = lead.notary || ({} as SurplusPanelLead['notary']);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(n.name || '');
  const [phone, setPhone] = useState(n.phone || '');
  const [email, setEmail] = useState(n.email || '');
  const [source, setSource] = useState(n.source || '');
  const [place, setPlace] = useState(n.appointmentPlace || '');
  const [notes, setNotes] = useState(n.notes || '');
  const [appointment, setAppointment] = useState('');

  useEffect(() => {
    setEditing(false);
    setName(n.name || '');
    setPhone(n.phone || '');
    setEmail(n.email || '');
    setSource(n.source || '');
    setPlace(n.appointmentPlace || '');
    setNotes(n.notes || '');
    setAppointment('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  const save = async (patch: any, done: string) => {
    setBusy(true);
    try {
      await surplusAPI.update(lead.id, patch);
      say(done);
      onChanged();
      return true;
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 12.5,
    padding: '6px 8px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--surface2)',
    color: 'inherit',
  };
  const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--dim)' };
  const countyReady = lead.countyInfo?.practiceRunAt;

  const openPacket = (all: boolean) =>
    window.open(
      `/surplus-funds/notary-packet?lead=${encodeURIComponent(lead.id)}${all ? '&all=true' : ''}`,
      '_blank',
      'noopener',
    );

  return (
    <Section
      title="The notary"
      note={
        n.signedInOrderAt
          ? `Signed in order ${fmtDate(n.signedInOrderAt)}`
          : n.appointmentAt
            ? `Appointment ${fmtDate(n.appointmentAt)}`
            : n.agreementSignedAt
              ? 'Agreement signed, not yet booked'
              : undefined
      }
    >
      {!countyReady && (
        <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
          {lead.county || 'This county'} has not had its practice run. Fill out the whole document set once before
          the first real appointment there.
        </div>
      )}

      {/* Who. */}
      {!editing ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--dim)' }}>Notary</span>
          <span style={{ fontWeight: 600, flex: 1 }}>
            {n.name || <span style={{ color: 'var(--faint)', fontWeight: 400 }}>not yet chosen</span>}
            {n.phone ? ` · ${n.phone}` : ''}
            {n.source ? (
              <span style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 400 }}>
                {' '}
                via {NOTARY_SOURCES.find(([k]) => k === n.source)?.[1] || n.source}
              </span>
            ) : null}
          </span>
          <button type="button" className="dc-wp-btn" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => setEditing(true)}>
            {n.name ? 'Edit' : 'Add notary'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
          <label style={lbl}>
            Name
            <input style={field} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <label style={lbl}>
              Phone
              <input style={field} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label style={lbl}>
              Email
              <input style={field} value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </div>
          <label style={lbl}>
            Found on
            <select style={field} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Not recorded</option>
              {NOTARY_SOURCES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label style={lbl}>
            Where the signing happens
            <input style={field} value={place} placeholder="The claimant's address, or wherever they asked" onChange={(e) => setPlace(e.target.value)} />
          </label>
          <label style={lbl}>
            Notes
            <input style={field} value={notes} placeholder="Fee agreed, travel, anything to remember" onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="dc-wp-btn on"
              disabled={busy}
              onClick={async () => {
                const ok = await save(
                  {
                    notaryName: name.trim() || null,
                    notaryPhone: phone.trim() || null,
                    notaryEmail: email.trim() || null,
                    notarySource: source || null,
                    notaryAppointmentPlace: place.trim() || null,
                    notaryNotes: notes.trim() || null,
                  },
                  'Notary saved',
                );
                if (ok) setEditing(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* The gate, in order. */}
      <Row
        k="1. Instruction sheet signed by the notary"
        v={n.agreementSignedAt ? fmtDate(n.agreementSignedAt) : 'not yet'}
        tone={n.agreementSignedAt ? 'var(--mint)' : 'var(--amber)'}
        note="Locks in the document list, the payment and the signing order before anything is booked."
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {!n.agreementSignedAt ? (
          <button
            type="button"
            className="dc-wp-btn on"
            disabled={busy || !n.name}
            title={n.name ? 'Record that the notary signed the instruction sheet today' : 'Add the notary first'}
            onClick={() => save({ notaryAgreementSignedAt: new Date().toISOString() }, 'Notary agreement recorded as signed')}
          >
            Notary signed the sheet
          </button>
        ) : (
          <button
            type="button"
            className="dc-wp-btn"
            disabled={busy}
            onClick={() => save({ notaryAgreementSignedAt: null }, 'Notary agreement cleared')}
            title="Undo a mistaken mark"
          >
            Clear
          </button>
        )}
      </div>

      <Row
        k="2. Appointment with the claimant"
        v={n.appointmentAt ? new Date(n.appointmentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not booked'}
        tone={n.appointmentAt ? 'var(--mint)' : undefined}
        note={n.agreementSignedAt ? undefined : 'Available once the notary has signed the sheet.'}
      />
      {n.agreementSignedAt && !n.signedInOrderAt && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="datetime-local"
            style={{ ...field, width: 'auto' }}
            value={appointment}
            onChange={(e) => setAppointment(e.target.value)}
            aria-label="Appointment"
          />
          <button
            type="button"
            className="dc-wp-btn on"
            disabled={busy || !appointment}
            onClick={() =>
              save({ notaryAppointmentAt: new Date(appointment).toISOString() }, 'Appointment booked and a reminder set')
            }
          >
            {n.appointmentAt ? 'Rebook' : 'Book'}
          </button>
        </div>
      )}

      <Row
        k="3. Signed in the printed order"
        v={n.signedInOrderAt ? fmtDate(n.signedInOrderAt) : 'not yet'}
        tone={n.signedInOrderAt ? 'var(--mint)' : undefined}
        note="The notary reports every document signed in order and the fee agreement put away before the assignment. Confirming moves the document set."
      />
      {n.appointmentAt && !n.signedInOrderAt && (
        <div>
          <button
            type="button"
            className="dc-wp-btn on"
            disabled={busy}
            onClick={() => {
              if (!window.confirm('Confirm the notary signed every document in the printed order? This marks the fee agreement and POA signed and the assignment notarized.')) return;
              save({ notarySignedInOrderAt: new Date().toISOString() }, 'Signed in order confirmed, documents updated');
            }}
          >
            Confirm signed in order
          </button>
        </div>
      )}

      {/* The packet. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
        <button type="button" className="dc-wp-btn" onClick={() => openPacket(false)}>
          Print the packet
        </button>
        <button type="button" className="dc-wp-btn" onClick={() => openPacket(true)} title="Every document in signing order, for a single appointment where the notary keeps the order">
          Whole set
        </button>
        <span style={{ fontSize: 11, color: 'var(--faint)' }}>
          {n.retentionConfirmed
            ? 'Fee agreement signed: the POA, the direction to pay and the county form go in.'
            : 'Fee agreement not yet signed: the package is withheld, only the agreement goes in.'}
        </span>
      </div>
    </Section>
  );
}

/**
 * One name-search link with the logging beside it. Opening the site is the
 * search; the two small buttons afterwards are what puts it on the record,
 * which is what the escalation rule and the recheck cadence read.
 */
function SearchLink({
  lead,
  link,
  say,
  onChanged,
}: {
  lead: SurplusPanelLead;
  link: { site: string; url: string; free: boolean };
  say: (msg: string) => void;
  onChanged: () => void;
}) {
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const channel = channelForSite(link.site);
  const already = (lead.tracing?.attempts || []).find(
    (a) => !a.heirId && a.source && a.source.toLowerCase() === link.site.toLowerCase(),
  );

  const log = async (result: string) => {
    setBusy(true);
    try {
      await surplusAPI.addTraceAttempt(lead.id, { channel, source: link.site, result });
      say(`${link.site}: ${result === 'found' ? 'found something' : result === 'mismatch' ? 'wrong person' : 'nothing'}. Logged.`);
      setOpened(false);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be logged.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="dc-wp-searchlink"
        onClick={() => setOpened(true)}
        title={already ? `Logged ${fmtDate(already.ranAt)}: ${already.result}` : 'Opens the search. Log what you found afterwards.'}
        style={already ? { borderColor: 'var(--mint)' } : undefined}
      >
        {link.site}
        {link.free && <span className="free">free</span>}
        {already && <span style={{ marginLeft: 4, color: 'var(--mint)' }}>✓</span>}
      </a>
      {opened && !busy && (
        <>
          {TRACE_RESULTS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              className="dc-wp-btn"
              style={{ padding: '2px 6px', fontSize: 10.5 }}
              onClick={() => log(k)}
            >
              {l}
            </button>
          ))}
        </>
      )}
    </span>
  );
}

/**
 * Every search run for this person, by channel, and what the course's
 * escalation rule makes of it. Cheapest first is a rule the panel can
 * check only because the free searches are logged too.
 */
function SearchLog({
  lead,
  say,
  onChanged,
}: {
  lead: SurplusPanelLead;
  say: (msg: string) => void;
  onChanged: () => void;
}) {
  const t = lead.tracing;
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState('free_search');
  const [source, setSource] = useState('');
  const [result, setResult] = useState('nothing');
  const [summary, setSummary] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  if (!t) return null;

  const add = async () => {
    setBusy(true);
    try {
      await surplusAPI.addTraceAttempt(lead.id, {
        channel,
        source: source.trim() || null,
        result,
        summary: summary.trim() || null,
        cost: cost.trim() ? Number(cost) : null,
      });
      say('Logged');
      setOpen(false);
      setSource('');
      setSummary('');
      setCost('');
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be logged.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await surplusAPI.removeTraceAttempt(id);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 12.5,
    padding: '6px 8px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--surface2)',
    color: 'inherit',
  };
  const own = t.attempts.filter((a) => !a.heirId);
  const tone = (r: string) => (r === 'found' ? 'var(--mint)' : r === 'mismatch' ? 'var(--red)' : 'var(--dim)');

  return (
    <div style={{ display: 'grid', gap: 6, padding: '7px 10px', marginBottom: 8, borderRadius: 6, background: 'var(--bg2)', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>Search log</span>
        <span style={{ color: 'var(--faint)' }}>
          {own.length ? `${own.length} attempt${own.length === 1 ? '' : 's'}` : 'nothing logged yet'}
          {t.totalCost ? ` · ${usd(t.totalCost)} spent` : ''}
        </span>
        <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
          {SURPLUS_TIER1_CHANNELS.map((c) => (
            <span
              key={c}
              title={`${traceChannelLabel(c)}: ${t.channelsTried.includes(c) ? 'tried' : 'not yet'}`}
              style={{
                fontSize: 10.5,
                padding: '1px 6px',
                borderRadius: 4,
                background: t.channelsTried.includes(c) ? 'var(--mintGhost)' : 'var(--surface3)',
                color: t.channelsTried.includes(c) ? 'var(--mint)' : 'var(--faint)',
              }}
            >
              {traceChannelLabel(c)}
            </span>
          ))}
        </span>
      </div>
      {t.tierSkipped && (
        <div style={{ color: 'var(--amber)', fontSize: 11.5 }}>
          A paid database was run before any free search was logged. Cheapest first: log the Google, social and county-records checks.
        </div>
      )}
      {t.tier1RecheckDue && (
        <div style={{ color: 'var(--amber)', fontSize: 11.5 }}>
          The free searches are {t.tier1AgeDays} days old and nobody has reached {lead.claimant}. Run them again: people move, and an obituary or a new listing may have appeared since.
        </div>
      )}
      {own.slice(0, 6).map((a) => (
        <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5 }}>
          <span style={{ color: 'var(--faint)', whiteSpace: 'nowrap' }}>{fmtDate(a.ranAt)}</span>
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            {a.channelLabel}
            {a.source ? ` · ${a.source}` : ''}
            <span style={{ color: tone(a.result), fontWeight: 600 }}> · {a.result}</span>
            {a.summary ? <span style={{ color: 'var(--dim)' }}> · {a.summary}</span> : null}
          </span>
          {a.source !== 'batchdata' && (
            <button type="button" className="dc-wp-btn" style={{ padding: '1px 6px', fontSize: 10.5 }} disabled={busy} onClick={() => remove(a.id)} title="Remove a mistaken entry">
              ✕
            </button>
          )}
        </div>
      ))}
      {own.length > 6 && <div style={{ fontSize: 11, color: 'var(--faint)' }}>and {own.length - 6} more</div>}
      {!open ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="dc-wp-btn" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => setOpen(true)}>
            Log a search
          </button>
          {t.proTracerEligible && !t.channelsTried.includes('pro_tracer') && (
            <button
              type="button"
              className="dc-wp-btn"
              style={{ padding: '3px 8px', fontSize: 11 }}
              title="Tier A and B only, once the free routes and the paid database have both failed"
              onClick={() => {
                setChannel('pro_tracer');
                setResult('nothing');
                setOpen(true);
              }}
            >
              Engage a professional tracer
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <select style={field} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
              {SURPLUS_TRACE_CHANNELS.filter(([k]) => k !== 'paid_db' && (k !== 'pro_tracer' || t.proTracerEligible)).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <input style={field} value={source} placeholder="Where: Google, Facebook, Sunbiz, tracer's name" onChange={(e) => setSource(e.target.value)} />
            <select style={field} value={result} onChange={(e) => setResult(e.target.value)} aria-label="Result">
              {TRACE_RESULTS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <input style={field} value={cost} placeholder="Cost, optional" onChange={(e) => setCost(e.target.value)} />
          </div>
          <input style={field} value={summary} placeholder="What came back, in a line" onChange={(e) => setSummary(e.target.value)} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="dc-wp-btn on" disabled={busy} onClick={add}>
              Log it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const METHOD_LABEL: Record<string, string> = {
  usps: 'USPS',
  fedex: 'FedEx',
  ups: 'UPS',
  in_person: 'in person',
  efile: 'e-file',
};

/**
 * What this county requires to file, so the answer is on the case and not in
 * somebody's head. Read-only here; the county table is edited in settings.
 * Says plainly when the county has not been asked yet or the answer is
 * older than 180 days, because a filing built on a stale answer is the
 * expensive mistake.
 */
function CountySection({ lead, onChanged, say }: { lead: SurplusPanelLead; onChanged?: () => void; say?: (msg: string) => void }) {
  const c = lead.countyInfo;
  const name = lead.county || 'this county';
  const [scriptOpen, setScriptOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const addClerk = async () => {
    if (adding) return;
    setAdding(true);
    try {
      const r = await surplusAPI.addClerkContact(lead.id);
      say?.(r.data?.created ? `${r.data.name} added as the county contact. Letters and emails to the clerk go on their row.` : `${r.data?.name} is already on the case.`);
      onChanged?.();
    } catch (err: any) {
      say?.(err?.response?.data?.message || 'The clerk could not be added.');
    } finally {
      setAdding(false);
    }
  };
  const edit = (
    <a href="/settings/surplus/counties" target="_blank" rel="noopener noreferrer" className="dc-wp-link" style={{ fontSize: 11 }}>
      Edit counties
    </a>
  );
  if (!c) {
    return (
      <Section title={`Filing in ${name}`}>
        <div style={{ fontSize: 12, color: 'var(--faint)' }}>
          {name} is not on the county list yet, so nothing is known about how it takes a claim. {edit}
        </div>
      </Section>
    );
  }
  const yesNo = (v: boolean | null) => (v === null ? 'not asked' : v ? 'yes' : 'no');
  const verified = c.lastVerifiedAt
    ? `Checked with the clerk ${fmtDate(c.lastVerifiedAt)}${c.stale ? ', older than 180 days' : ''}`
    : 'Never checked with the clerk';
  return (
    <Section title={`Filing in ${name}`} note={verified}>
      {!c.ready ? (
        <div style={{ fontSize: 11.5, color: 'var(--amber)', fontWeight: 600 }}>
          County not ready: the clerk has not answered on {c.unknowns.join(', ')}. Agreement Signed waits on it.{' '}
          <button type="button" className="dc-wp-link" style={{ fontSize: 11.5 }} onClick={() => setScriptOpen((v) => !v)}>
            {scriptOpen ? 'Hide the clerk script' : 'Show the clerk script'}
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--mint)' }}>
          County ready to file in: all five clerk answers are on the card.{' '}
          <button type="button" className="dc-wp-link" style={{ fontSize: 11.5 }} onClick={() => setScriptOpen((v) => !v)}>
            {scriptOpen ? 'Hide the clerk script' : 'Clerk script'}
          </button>
        </div>
      )}
      {scriptOpen && (
        <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 12 }}>
          {c.script.map((q) => (
            <li key={q.key} style={{ color: q.answered ? 'var(--faint)' : 'var(--text)' }}>
              {q.ask}
              <div style={{ fontSize: 11, color: 'var(--faint)' }}>
                {q.answered ? 'Answered' : 'Open'} · goes in {q.field}. {edit}
              </div>
            </li>
          ))}
        </ol>
      )}
      {(c.stale || !c.lastVerifiedAt) && c.ready && (
        <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
          Confirm these with the clerk before filing. {edit}
        </div>
      )}
      <Row
        k="Claim form"
        v={c.claimFormUrl ? 'on file' : 'not on file'}
        note={c.claimFormUrl ? undefined : 'Find the county form and add its link in settings.'}
      />
      {c.claimFormUrl && (
        <div style={{ fontSize: 12 }}>
          <a href={c.claimFormUrl} target="_blank" rel="noopener noreferrer" className="dc-wp-link">
            Open the county claim form
          </a>
        </div>
      )}
      <Row
        k="Submit by"
        v={c.acceptedMethods.length ? c.acceptedMethods.map((m) => METHOD_LABEL[m] || m).join(', ') : 'not asked'}
      />
      <Row k="Signature on delivery" v={yesNo(c.signatureRequired)} />
      <Row
        k="Attorney required"
        v={yesNo(c.attorneyRequired)}
        tone={c.attorneyRequired ? 'var(--amber)' : undefined}
        note={c.attorneyRequired ? 'Once an attorney is engaged, all contact with the county goes through them.' : undefined}
      />
      {lead.countyContactVia === 'attorney' && (
        <div style={{ fontSize: 11.5, color: 'var(--amber)', fontWeight: 600 }}>
          Contact about this claim goes through {lead.attorney?.name || 'the attorney'}, not the clerk.
        </div>
      )}
      <Row k="Assignment of rights" v={c.assignmentPreference ? c.assignmentPreference : 'not asked'} />
      {(c.clerkContactName || c.clerkContactPhone || c.clerkContactEmail) && (
        <Row k="Clerk contact" v={[c.clerkContactName, c.clerkContactPhone, c.clerkContactEmail].filter(Boolean).join(' · ')} />
      )}
      <div style={{ fontSize: 11.5, color: 'var(--dim)' }}>
        {lead.clerkContact ? (
          <>
            {lead.clerkContact.name} is on the case as the county contact, so a letter or an email to the county is logged against the clerk, never as a
            relative.
          </>
        ) : (
          <>
            <button type="button" className="dc-wp-link" style={{ fontSize: 11.5 }} disabled={adding} onClick={addClerk}>
              {adding ? 'Adding...' : 'Add the clerk as a contact on this case'}
            </button>{' '}
            so letters and emails to the county are logged as county contact, not as a relative.
          </>
        )}
      </div>
      {c.clerkAddress && <Row k="Mail claims to" v={c.clerkAddress} />}
      {c.notes && <div style={{ fontSize: 11.5, color: 'var(--dim)', whiteSpace: 'pre-wrap' }}>{c.notes}</div>}
      <Row
        k="Practice run"
        v={c.practiceRunAt ? `done ${fmtDate(c.practiceRunAt)}` : 'not yet'}
        note={c.practiceRunAt ? undefined : 'Fill out the whole document set once for this county before the first real case.'}
      />
      {c.lastVerifiedAt && !c.stale && <div style={{ fontSize: 11, color: 'var(--faint)' }}>{edit}</div>}
    </Section>
  );
}

const CONTACT_LABEL: Record<string, string> = {
  not_tapped: 'No reply yet',
  tapped: 'Replied',
  recap_scheduled: 'Follow-up booked',
};
const CONTACT_TONE: Record<string, string> = {
  not_tapped: 'var(--amber)',
  tapped: 'var(--mint)',
  recap_scheduled: 'var(--mint)',
};
const CHANNEL_GLYPH: [keyof SurplusPanelLead['channels'], string, string][] = [
  ['called', '☎', 'Called'],
  ['texted', '\u{1F4AC}', 'Texted'],
  ['emailed', '@', 'Emailed'],
  ['lettered', '✉', 'Lettered'],
  ['messaged', '\u{1F464}', 'Messaged'],
];

/** Colour per trace tone. Bad is red because a wrong-person result is a
 *  discard, not a partial success. */
const TRACE_TONE: Record<string, string> = {
  good: 'var(--mint)',
  warn: 'var(--amber)',
  bad: 'var(--red)',
  idle: 'var(--dim)',
};

interface Props {
  /** The subject property, with every claimant owed on it. */
  property: any;
  currentUser: any;
  /**
   * Move to the previous or next property in the filtered list behind the
   * panel, so a queue can be worked without closing and reopening. Null at
   * either end rather than wrapping: looping silently back to the first record
   * makes it impossible to tell you have reached the last one.
   */
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
  /** "3 of 45", from the same filtered list. */
  position?: { index: number; total: number } | null;
  onClose: () => void;
  /** Refresh the board row after something changes here. */
  onChanged: () => void;
  say: (msg: string) => void;
  /** The claimant to open on, when a link named one. Else the first. */
  initialClaimantId?: string | null;
}

export default function SurplusWorkPanel({
  property,
  initialClaimantId,
  currentUser,
  onPrev,
  onNext,
  position,
  onClose,
  onChanged,
  say,
}: Props) {
  const [tab, setTab] = useState<Tab>(() => {
    const first = property.claimants.find((c: any) => c.id === initialClaimantId) || property.claimants[0];
    return first ? defaultTab(first) : 'people';
  });
  /**
   * Which claimant's conversation is open. Shared facts (the property, the
   * money, the docket) belong to the case; the conversation, the notes and the
   * contacts belong to one person, because each claimant files their own claim.
   */
  const [claimantId, setClaimantId] = useState<string>(
    initialClaimantId && property.claimants.some((c: any) => c.id === initialClaimantId)
      ? initialClaimantId
      : property.claimants[0]?.id,
  );
  const lead: SurplusPanelLead =
    property.claimants.find((c: any) => c.id === claimantId) || property.claimants[0];

  // A different claimant opens on their own default tab: People before a
  // signature, Claim after one. Set during render, React's pattern for
  // state that follows a prop, so the old tab never flashes first.
  const [tabFor, setTabFor] = useState(lead?.id);
  if (lead && tabFor !== lead.id) {
    setTabFor(lead.id);
    setTab(defaultTab(lead));
  }

  // A refresh can reorder or replace claimants; keep the selection valid.
  useEffect(() => {
    if (!property.claimants.some((c: any) => c.id === claimantId)) {
      setClaimantId(property.claimants[0]?.id);
    }
  }, [property.claimants, claimantId]);
  const [comms, setComms] = useState<{ timeline: TimelineItem[]; notes: NoteItem[]; people?: ThreadPerson[] }>({
    timeline: [],
    notes: [],
  });
  /**
   * Whose conversation is showing: 'all', 'claimant', or a person's id. A
   * claim worked through a daughter, a son and a neighbor reads as one thread
   * per person instead of all of them interleaved.
   */
  const [personFilter, setPersonFilter] = useState<string>('all');
  const [emailAction, setEmailAction] = useState<EmailAction | null>(null);
  // Every person's drips on this claim, shared by the claimant's contacts on
  // the Case tab and each card on the People tab. Reloads with the lead row,
  // so a change made elsewhere on the panel shows here too.
  const drips = useSurplusDrips(lead.id, lead, say);
  /** Raised by clicking a number or an email, consumed by the composer. */
  const [composeIntent, setComposeIntent] = useState<any>(null);
  const dialer = useDialer();
  const [fullLead, setFullLead] = useState<any>(null);
  /** Needed by the composer for @mentions on internal comments. */
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const sigRef = useRef('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const sigOf = (t: TimelineItem[], n: NoteItem[]) =>
    `${t.length}:${t[t.length - 1]?.id ?? ''}|${n.length}:${n[n.length - 1]?.id ?? ''}`;

  const loadComms = useCallback(
    async (silent = false) => {
      try {
        const res = await leadsAPI.communications(lead.id);
        const timeline = res.data?.timeline || [];
        const notes = res.data?.notes || [];
        const people: ThreadPerson[] | undefined = res.data?.people;
        const sig = sigOf(timeline, notes);
        if (silent && sig === sigRef.current) return;
        sigRef.current = sig;
        setComms({ timeline, notes, people });
      } catch {
        // Keep whatever is on screen; a transient failure should not blank the
        // thread mid-conversation.
      }
    },
    [lead.id],
  );

  // The composer needs the Lead row itself for sellerPhone, sellerEmail and the
  // do-not-contact flag, which the surplus row does not carry in the same shape.
  useEffect(() => {
    let cancelled = false;
    setComms({ timeline: [], notes: [] });
    setPersonFilter('all');
    sigRef.current = '';
    setFullLead(null);
    // An address or number clicked on the last lead belongs to that lead. Left
    // set, the composer replayed it when it mounted for the next one, so the
    // To field kept the previous claimant's email after the arrow keys.
    setEmailAction(null);
    setComposeIntent(null);
    leadsAPI
      .get(lead.id)
      .then((r) => !cancelled && setFullLead(r.data))
      .catch(() => {});
    loadComms();
    return () => {
      cancelled = true;
    };
  }, [lead.id, loadComms]);

  // Poll only while the conversation tab is open and the window is visible, so
  // an open panel on a background tab is not hitting the API every 8 seconds.
  useEffect(() => {
    if (tab !== 'activity') return;
    const t = setInterval(() => {
      if (!document.hidden) loadComms(true);
    }, CONV_POLL_MS);
    return () => clearInterval(t);
  }, [tab, loadComms]);

  // Every other tab opens at its top. The body is one scroll box shared by
  // all tabs, so without this Claim opened halfway down, wherever People was.
  useEffect(() => {
    if (tab === 'activity') return;
    bodyRef.current?.scrollTo({ top: 0 });
  }, [tab, lead.id]);

  useEffect(() => {
    if (tab !== 'activity') return;
    // Scroll the timeline box only. scrollIntoView would also scroll the
    // panel itself, which scrolls when the composer is tall, and hide the
    // header with the lead's name.
    const box = bottomRef.current?.closest('.dc-wp-body');
    box?.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  }, [comms.timeline, tab]);

  useEffect(() => {
    authAPI
      .getTeam()
      .then((r) => setTeamMembers(r.data || []))
      .catch(() => {});
  }, []);

  /**
   * Escape closes; the arrows step through the filtered list.
   *
   * Both are ignored while focus is in a field, so typing a note or editing a
   * phone number never navigates away mid-sentence and loses the edit.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable);
      if (e.key === 'Escape') return onClose();
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' && onPrev) {
        e.preventDefault();
        onPrev();
      }
      if (e.key === 'ArrowRight' && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  /**
   * Call a number straight from the panel. The dialer is app-wide, so this is
   * the same call path as the lead page and the floating dialer, and the call
   * is attributed to this lead rather than appearing as an anonymous dial.
   */
  // leadSource tells the dialer's summary screen to offer the surplus
  // outcomes (spoke to claimant, message passed, already signed elsewhere)
  // instead of the wholesaling dispositions.
  //
  // `who` is set when the number belongs to somebody else on the case, a
  // relative or an heir, so the dialer shows who is actually being rung.
  const call = (number: string, who?: string) =>
    dialer.startCall({
      name: who ? `${who} (${lead.claimant})` : lead.claimant,
      phone: number,
      leadId: lead.id,
      leadSource: 'SURPLUS',
    });

  /** Open the conversation on SMS with this number already selected. */
  const message = (number: string) => {
    setComposeIntent({ nonce: Date.now(), channel: 'sms', to: number });
    setTab('activity');
  };

  /** Open the conversation on email, addressed to this address. */
  const mail = (address: string) => {
    setComposeIntent({ nonce: Date.now(), channel: 'email', to: address });
    setEmailAction({ nonce: Date.now(), mode: 'reply', subject: '', bodyHtml: '', to: address });
    setTab('activity');
  };

  const ledger = property.claimLedger || [];
  /** A change anywhere on the panel refreshes the row and the thread. */
  const changed = () => {
    onChanged();
    loadComms(true);
  };
  const addNote = async (text: string) => {
    if (!currentUser?.id) return;
    await leadsAPI.addNote(lead.id, text, currentUser.id);
    await loadComms();
  };
  /** Everybody on the People tab: heirs, living or not, and associates. */
  const peopleCount = (lead.heirCount || 0) + (lead.associateCount || 0);
  const tone = CLAIM_STATUS_TONE[property.claimStatus] || 'var(--dim)';

  return (
    // The panel is fixed-position, so where it sits in the DOM is irrelevant to
    // layout, but it must be inside `.dc-board` for the colour tokens to
    // resolve. They are scoped to that class on purpose.
    <div className="dc-board">
      <div className="dc-wp-scrim" onClick={onClose} />
      <aside className="dc-wp" role="dialog" aria-label={`Surplus lead ${lead.claimant}`}>
        <div className="dc-wp-head">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* The claimant's name is the headline, not the house. The team
                  finds a file by who is owed, so the name carries the size
                  and weight and the property address sits under it, plain. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    lineHeight: 1.2,
                    overflowWrap: 'anywhere',
                    ...(lead.isDeceased ? { textDecoration: 'line-through' } : {}),
                  }}
                >
                  {lead.claimant}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: tone,
                    border: `1px solid ${tone}`,
                    borderRadius: 4,
                    padding: '1px 6px',
                  }}
                >
                  {property.claimStatusLabel}
                </span>
                {property.anyDeceased && (
                  <span style={{ fontSize: 11, color: 'var(--amber)' }}>Estate</span>
                )}
                {lead.county && (!lead.countyInfo || !lead.countyInfo.ready) && (
                  <span
                    style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 600 }}
                    title={
                      lead.countyInfo
                        ? `Before anyone signs in ${lead.county}, the clerk has to answer: ${lead.countyInfo.unknowns.join(', ')}. The script is on the Claim tab.`
                        : `${lead.county} is not on the county list yet, so nothing is known about how it takes a claim.`
                    }
                  >
                    County not ready
                  </span>
                )}
                {lead.shortWindow && (
                  <span
                    style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600 }}
                    title="Under two months to the team's day-340 cutoff. Day 365 is the legal end."
                  >
                    {shortWindowLabel(lead.daysToCutoff)}
                  </span>
                )}
                {lead.holdUntil && (
                  <span style={{ fontSize: 11, color: 'var(--dim)' }}>Paused until {fmtDay(lead.holdUntil)}</span>
                )}
                <span className="dc-wp-stagepill" title="This claimant's stage">
                  <i />
                  {lead.stage}
                </span>
                {lead.doNotCall && (
                  <span style={{ fontSize: 11, color: 'var(--red)' }}>Do not call</span>
                )}
                {lead.heldAt && (
                  <span style={{ fontSize: 11, color: 'var(--amber)' }} title={lead.holdReason || undefined}>
                    On hold
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 400, color: 'var(--text)', marginTop: 4, overflowWrap: 'anywhere' }}>
                {property.address}
                <span style={{ color: 'var(--dim)' }}>
                  {[property.city, property.zip].filter(Boolean).length > 0
                    ? `, ${[property.city, property.zip].filter(Boolean).join(' ')}`
                    : ''}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 3 }}>
                {money(property.grossSurplus)} surplus ·{' '}
                {property.claimantCount === 1
                  ? '1 claimant'
                  : `${property.claimantCount} claimants`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--faint, #7a828e)', marginTop: 2 }}>
                {property.county} County
                {property.caseNumber ? ` - case ${property.caseNumber}` : ''}
                {property.sourceUrl && (
                  <>
                    {' '}
                    <a
                      href={property.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="dc-wp-link"
                    >
                      open at the clerk
                    </a>
                  </>
                )}
              </div>
            </div>
            {/* Step through the filtered list without closing the panel.
                Disabled rather than wrapping at either end, so it is obvious
                when you have reached the last one. */}
            {(onPrev !== undefined || onNext !== undefined) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  className="dc-wp-btn"
                  onClick={() => onPrev?.()}
                  disabled={!onPrev}
                  aria-label="Previous"
                  title="Previous (left arrow)"
                >
                  ‹
                </button>
                {position && (
                  <span style={{ fontSize: 11.5, color: 'var(--faint)', whiteSpace: 'nowrap' }}>
                    {position.index + 1} of {position.total}
                  </span>
                )}
                <button
                  type="button"
                  className="dc-wp-btn"
                  onClick={() => onNext?.()}
                  disabled={!onNext}
                  aria-label="Next"
                  title="Next (right arrow)"
                >
                  ›
                </button>
              </div>
            )}
            <button type="button" className="dc-wp-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          {/* The course's four tracking fields. The team writes the next
              step; nothing here is guessed from the queue. */}
          <CaseFields lead={lead} team={teamMembers} currentUser={currentUser} onChanged={onChanged} say={say} />

          {/* One property, several claims. Each claimant is contacted
              separately, so every tab follows this selection. A single
              claimant needs no switcher: they are the first person on People. */}
          {property.claimants.length > 1 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 11, flexWrap: 'wrap' }}>
              {property.claimants.map((c: any) => (
                <button
                  key={c.id}
                  type="button"
                  className={`dc-wp-claimant${c.id === lead.id ? ' on' : ''}`}
                  onClick={() => setClaimantId(c.id)}
                >
                  <span style={c.isDeceased ? { textDecoration: 'line-through' } : undefined}>
                    {c.claimant}
                  </span>
                  {/* For a dead claimant the trace state is beside the point:
                      they cannot sign, so what matters is whether an heir has
                      been found. Showing "never skip traced" here is what sent
                      people off tracing a dead man. */}
                  {c.isDeceased ? (
                    <span
                      className="sub"
                      style={{ color: c.callableHeirCount > 0 ? 'var(--mint)' : 'var(--red)' }}
                    >
                      {c.callableHeirCount > 0
                        ? `deceased · ${c.callableHeirCount} callable heir${c.callableHeirCount === 1 ? '' : 's'}`
                        : c.livingHeirCount > 0
                          ? `deceased · ${c.livingHeirCount} heir${c.livingHeirCount === 1 ? '' : 's'}, no number`
                          : 'deceased · no heirs on file'}
                    </span>
                  ) : (
                    <span className="sub" style={{ color: TRACE_TONE[c.trace?.tone || 'idle'] }}>
                      {c.cleanPhoneCount > 0
                        ? `${c.cleanPhoneCount} callable`
                        : c.trace?.label || 'Never skip traced'}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {lead.obituaryMatch === 'possible' && lead.obituary && (
            <PossibleObituary lead={lead} onChanged={onChanged} />
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`dc-wp-btn${tab === t ? ' on' : ''}`}
                onClick={() => setTab(t)}
              >
                {TAB_LABEL[t]}
                {t === 'activity' && comms.timeline.length > 0 && ` (${comms.timeline.length})`}
                {t === 'people' && ` (${peopleCount + 1})`}
              </button>
            ))}
          </div>
        </div>

        <div className="dc-wp-body" ref={bodyRef}>
          {tab === 'people' && (
            <SurplusDripProvider value={drips}>
              <PeopleWork
                lead={lead}
                property={property}
                currentUser={currentUser}
                onCall={call}
                onText={message}
                onEmail={mail}
                onChanged={changed}
                say={say}
              />
            </SurplusDripProvider>
          )}

          {tab === 'research' && (
            <ResearchTab
              lead={lead}
              property={property}
              currentUser={currentUser}
              notes={comms.notes}
              onAddNote={addNote}
              onNotesChanged={() => loadComms()}
              onChanged={changed}
              say={say}
            />
          )}

          {tab === 'claim' && <ClaimTab lead={lead} onChanged={changed} say={say} />}

          {tab === 'details' && <DetailsTab lead={lead} property={property} ledger={ledger} onChanged={changed} say={say} />}

          {tab === 'activity' && (
            <div>
              {comms.timeline.length === 0 && (
                <div style={{ color: 'var(--faint)', fontSize: 13, padding: '8px 0 16px' }}>
                  No messages yet with {lead.claimant}.
                </div>
              )}
              {(comms.people?.length || 0) > 1 && (
                <div className="dc-wp-people-filter" role="group" aria-label="Show the conversation with">
                  <button
                    type="button"
                    className={`dc-wp-btn${personFilter === 'all' ? ' on' : ''}`}
                    onClick={() => setPersonFilter('all')}
                  >
                    Everyone
                  </button>
                  {comms.people!.map((p) => {
                    const key = p.id ?? 'claimant';
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`dc-wp-btn${personFilter === key ? ' on' : ''}`}
                        onClick={() => setPersonFilter(key)}
                        title={p.label}
                      >
                        {p.name}
                        {p.id ? <span style={{ opacity: 0.7 }}> · {p.label}</span> : null}
                        <span style={{ marginLeft: 5, opacity: 0.6 }}>{p.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <CommunicationsTimeline
                items={
                  personFilter === 'all'
                    ? comms.timeline
                    : comms.timeline.filter(
                        (t: any) => t.person && (t.person.id ?? 'claimant') === personFilter,
                      )
                }
                onEmailAction={setEmailAction}
              />
              <div ref={bottomRef} />
            </div>
          )}

        </div>

        {/* The composer on the conversation tab, actions everywhere else. */}
        <div className="dc-wp-foot">
          {tab === 'activity' ? (
            // Only once the Lead row is THIS lead's. Right after the arrows the
            // row on hand is still the previous lead's, and its email, phone
            // and do-not-contact flag must never reach this lead's composer.
            fullLead?.id === lead.id ? (
              <MessageComposer
                key={lead.id}
                leadId={lead.id}
                sellerPhone={fullLead.sellerPhone}
                sellerEmail={fullLead.sellerEmail}
                currentUser={currentUser}
                teamMembers={teamMembers}
                doNotContact={fullLead.doNotContact}
                emailAction={emailAction}
                composeIntent={composeIntent}
                surplusCase
                knownEmails={lead.emails}
                onSent={() => {
                  loadComms();
                  onChanged();
                }}
              />
            ) : (
              <div style={{ fontSize: 12, color: 'var(--faint)' }}>Loading composer...</div>
            )
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="dc-wp-btn on"
                onClick={() => setTab('activity')}
              >
                Open conversation
              </button>
              <span
                style={{ fontSize: 12, color: 'var(--faint)', marginLeft: 'auto' }}
                title="Calls placed, texts and emails sent, letters mailed and hand marks, together"
              >
                {lead.touchesLogged ?? lead.totalTouches} touch{(lead.touchesLogged ?? lead.totalTouches) === 1 ? '' : 'es'} logged
              </span>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ─── Case tab ───────────────────────────────────────────────────────────────

/** The lifecycle, in order. Dead is off it. */
const STAGE_ORDER = [
  'New',
  'Contacted',
  'Agreement Signed',
  'Package Notarized',
  'Claim Filed',
  'Awaiting Disbursement',
  'Check Received',
  'Paid',
];

/** Where the panel opens: the people before a signature, the paperwork after one. */
function defaultTab(lead: SurplusPanelLead): Tab {
  return STAGE_ORDER.indexOf(lead.stage) >= STAGE_ORDER.indexOf('Agreement Signed') ? 'claim' : 'people';
}

/** How sure we are the claimant is the claimant, in the same words as the people rows. */
function claimantConfidence(lead: SurplusPanelLead): { label: string; tone: string } {
  if (lead.entitlementVerified) return { label: 'Confirmed', tone: 'var(--mint)' };
  return personConfidence({ contactMismatch: lead.contactMismatch, trace: lead.trace });
}

/**
 * The People tab: the claim jacket. What the case still has to settle and
 * the team's follow-ups, then the claimant, then everyone around them best
 * first, each one line until it is opened. Nothing here is in a fixed order
 * to tick through: whoever is the best route today is the one to open.
 */
function PeopleWork({
  lead,
  property,
  currentUser,
  onCall,
  onText,
  onEmail,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  property: any;
  currentUser: any;
  onCall: (number: string, who?: string) => void;
  onText: (number: string) => void;
  onEmail: (address: string) => void;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const [claimantOpen, setClaimantOpen] = useState(!lead.isDeceased);
  useEffect(() => setClaimantOpen(!lead.isDeceased), [lead.id, lead.isDeceased]);
  const listRef = useRef<HTMLDivElement>(null);
  const toPeople = () => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const status = lead.tappedAt ? `Replied ${fmtDate(lead.tappedAt)}` : lead.lastTouchedAt ? `No reply yet, last tried ${fmtDate(lead.lastTouchedAt)}` : 'Nothing tried yet';

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <CaseQuestions lead={lead} property={property} currentUser={currentUser} onOpenPeople={toPeople} onChanged={onChanged} say={say} />
        <TasksSection lead={lead} currentUser={currentUser} onChanged={onChanged} say={say} />
      </div>

      <div>
        <SubHead title="The claimant" />
        {claimantOpen ? (
          <div className="dc-wp-person-card">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap', marginBottom: 6 }}>
              <b style={{ fontSize: 13, ...(lead.isDeceased ? { textDecoration: 'line-through' } : {}) }}>{lead.claimant}</b>
              {(() => {
                const c = claimantConfidence(lead);
                return (
                  <span className="dc-wp-conf" style={{ color: c.tone, borderColor: c.tone }}>
                    {c.label}
                  </span>
                );
              })()}
              {lead.isDeceased && <span style={{ fontSize: 11.5, color: 'var(--red)' }}>{deathLabel(lead)}. Their own contacts cannot sign anything.</span>}
              <button
                type="button"
                className="dc-wp-btn"
                style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11 }}
                onClick={() => setClaimantOpen(false)}
              >
                Close
              </button>
            </div>
            <ContactLine lead={lead} />
            <ContactsBlock lead={lead} onCall={onCall} onText={onText} onEmail={onEmail} onChanged={onChanged} say={say} />
            {/* The claimant's own drips. Everyone else's are on their own card. */}
            <PersonDrips heirId={null} name={lead.claimant} emails={lead.emails} blocked={lead.doNotCall ? 'marked do not call' : null} />
            <MailingAddress
              lead={lead}
              variant="row"
              noticeReadForCase={property.claimants.some((c: any) => c.ownerMailingStreet)}
              onChanged={onChanged}
              say={say}
            />
            <div style={{ marginTop: 8 }}>
              <CredibilityBlock lead={lead} say={say} onChanged={onChanged} />
            </div>
          </div>
        ) : (
          <PersonLine
            name={lead.claimant}
            who={lead.isDeceased ? 'Claimant, deceased' : 'Claimant'}
            confidence={claimantConfidence(lead)}
            contacts={contactSummary(lead.phones, lead.emails)}
            status={status}
            statusTone={lead.tappedAt ? 'var(--mint)' : undefined}
            struck={lead.isDeceased}
            open={false}
            onToggle={() => setClaimantOpen(true)}
          />
        )}
      </div>

      <div ref={listRef}>
        <PeopleTab lead={lead} property={property} onCall={onCall} onText={onText} onEmail={onEmail} onChanged={onChanged} say={say} />
      </div>

      <div>
        <SubHead title="Letters" />
        <LetterHistory lead={lead} onChanged={onChanged} say={say} />
      </div>
    </div>
  );
}

/**
 * The Research tab: every search run for the claimant and the people around
 * them, free and paid, dead ends included so nobody repeats them, and the
 * notes that go with it.
 */
function ResearchTab({
  lead,
  property,
  currentUser,
  notes,
  onAddNote,
  onNotesChanged,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  property: any;
  currentUser: any;
  notes: NoteItem[];
  onAddNote: (text: string) => Promise<void>;
  onNotesChanged: () => unknown;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  // Whether the paid profile search is paused, asked once per tab. Null until
  // answered; the button reads null as "do not know yet".
  const [socialPaused, setSocialPaused] = useState<boolean | null>(null);
  useEffect(() => {
    surplusAPI
      .socialUsage()
      .then((r) => setSocialPaused(!!r.data?.paused))
      .catch(() => setSocialPaused(true));
  }, []);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {lead.phones.length === 0 && <TraceBlock lead={lead} />}
      <SearchLog lead={lead} say={say} onChanged={onChanged} />
      {lead.nameSearch && <NameSearchBlock lead={lead} property={property} say={say} onChanged={onChanged} />}
      {lead.social && <SocialBlock lead={lead} currentUser={currentUser} paused={socialPaused} say={say} onChanged={onChanged} />}
      <div>
        <SubHead title="Notes" />
        <NotesPanel
          notes={notes}
          canAdd={!!currentUser}
          onAddNote={onAddNote}
          leadId={lead.id}
          currentUser={currentUser}
          onNotesChanged={onNotesChanged}
        />
      </div>
    </div>
  );
}

/** "Short window, 41 days", or "Past day 340" once the team cutoff has gone by. */
function shortWindowLabel(days: number | null | undefined) {
  if (days == null) return 'Short window';
  return days >= 0 ? `Short window, ${days} day${days === 1 ? '' : 's'}` : 'Past day 340';
}

/** A dated step that has happened, or not yet. */
function stepAt(at: string | null | undefined): { done: boolean; at: string | null } {
  return { done: !!at, at: at || null };
}

/**
 * The paperwork in signing order, read off the documents, the notary, the
 * filing and the payout. Each line is what Dealcore holds, not a box for
 * somebody to tick: a document marked signed in its section ticks here.
 * After a Yes this really is a fixed sequence, fee agreement first and the
 * county form last.
 */
function PaperworkChecklist({ lead }: { lead: SurplusPanelLead }) {
  const doc = (kind: string) => (lead.documents || []).find((d) => d.kind === kind);
  const signed = (kind: string) => {
    const d = doc(kind);
    if (!d || !d.required) return null;
    return { done: d.collected, at: d.signedAt || null };
  };
  const steps: { label: string; state: { done: boolean; at: string | null } | null }[] = [
    // The course puts the clerk's five answers before the first signature.
    { label: `${lead.county || 'County'} ready to file in`, state: lead.county ? { done: !!lead.countyInfo?.ready, at: null } : null },
    { label: 'Fee agreement signed', state: lead.notary?.retentionConfirmed ? { done: true, at: doc('fee_agreement')?.signedAt || null } : { done: false, at: null } },
    { label: 'Limited power of attorney', state: signed('limited_poa') },
    { label: 'Partial assignment', state: signed('assignment_of_rights') },
    { label: 'County claim form', state: signed('county_claim_form') },
    { label: 'Package notarized', state: stepAt(lead.notary?.signedInOrderAt) },
    { label: 'Submitted to the county', state: stepAt(lead.submission?.submittedAt) },
    { label: 'County acknowledged', state: stepAt(lead.submission?.countyAcknowledgedAt) },
    { label: 'Check received', state: stepAt(lead.disbursement?.checkReceivedAt) },
    { label: 'Claimant paid', state: stepAt(lead.disbursement?.checkSentAt) },
  ];
  const shown = steps.filter((s) => s.state);
  const next = shown.find((s) => !s.state!.done);
  return (
    <Section title="Paperwork" note={next ? `Next: ${next.label.toLowerCase()}` : 'All done'}>
      <div style={{ display: 'grid', gap: 4 }}>
        {shown.map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span aria-hidden="true" style={{ width: 16, color: s.state!.done ? 'var(--mint)' : 'var(--faint)' }}>
              {s.state!.done ? '✓' : '○'}
            </span>
            <span style={{ fontWeight: s === next ? 700 : 400, color: s.state!.done ? 'var(--text)' : s === next ? 'var(--text)' : 'var(--dim)' }}>{s.label}</span>
            {s.state!.at && <span style={{ color: 'var(--faint)', fontSize: 11.5 }}>{fmtDate(s.state!.at)}</span>}
          </div>
        ))}
      </div>
    </Section>
  );
}

/** The Claim tab: the checks, then the paperwork and everything after a signature, in order. */
function ClaimTab({ lead, onChanged, say }: { lead: SurplusPanelLead; onChanged: () => void; say: (msg: string) => void }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <PaperworkChecklist lead={lead} />
      <QualificationSection lead={lead} onChanged={onChanged} say={say} />
      <DocumentsSection lead={lead} onChanged={onChanged} say={say} />
      <NotarySection lead={lead} onChanged={onChanged} say={say} />
      <AttorneySection lead={lead} onChanged={onChanged} say={say} />
      <FilingSection lead={lead} onChanged={onChanged} say={say} />
      <DisbursementSection lead={lead} onChanged={onChanged} say={say} />
      <SurveySection lead={lead} onChanged={onChanged} say={say} />
    </div>
  );
}

/**
 * The Details tab: the money, the clocks, the property, the county's rules
 * and the docket. Looked up, not worked, so out of the way until needed.
 */
function DetailsTab({
  lead,
  property,
  ledger,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  property: any;
  ledger: LedgerDoc[];
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <SubHead title="The money" />
        <Row k="Surplus posted today" v={money(property.grossSurplus)} />
        {property.surplusAtNotice != null && property.surplusAtNotice !== property.grossSurplus && (
          <Row
            k="Stated in the mailed notice"
            v={money(property.surplusAtNotice)}
            note="What the claimant was told they are owed. Use this number on a call."
          />
        )}
        <Row k="Net to claimant" v={money(property.netToClaimant)} />
        {property.estFee != null && <Row k="Estimated fee under the agreement" v={money(property.estFee)} note={SURPLUS_FEE_SCHEDULE_LABEL} />}
      </div>
      <div>
        <SubHead title="The clock" />
        <Row
          k="Sale"
          v={
            property.saleDate
              ? `${fmtDay(property.saleDate)}${property.daysSinceSale != null ? ` (${property.daysSinceSale} days ago)` : ''}`
              : 'unknown'
          }
        />
        <Row
          k="Notice mailed"
          v={property.noticeDate ? fmtDay(property.noticeDate) : 'unknown'}
          note={
            property.noticeConfirmed
              ? undefined
              : 'Estimated from the sale date. Duval publishes no filing dates and its notice is a scan, so this is a floor, not a confirmed date.'
          }
        />
        {lead.daysToCutoff != null && (
          <Row
            k="Team cutoff"
            v={
              lead.daysToCutoff >= 0
                ? `day 340, ${lead.daysToCutoff} day${lead.daysToCutoff === 1 ? '' : 's'} from now`
                : `day 340, passed ${-lead.daysToCutoff} day${lead.daysToCutoff === -1 ? '' : 's'} ago`
            }
            note={
              lead.shortWindow
                ? 'Short window: under two months to the cutoff. The legal end is day 365, so a claim that moves now can still be filed.'
                : 'The team works to day 340 so a late find still has time to be signed, notarized and filed before day 365.'
            }
          />
        )}
        {property.daysRemaining != null && (
          <Row
            k="Other claims"
            v={
              property.daysRemaining > 0
                ? `still possible until ${fmtDate(new Date(Date.now() + property.daysRemaining * 86400000))}`
                : `closed ${fmtDate(new Date(Date.now() + property.daysRemaining * 86400000))}`
            }
            note="Until then another lienholder can still appear and shrink the payout. A previous owner is not barred by it."
          />
        )}
      </div>
      <div>
        <SubHead title="The property" />
        <Row k="Property that sold" v={[property.address, property.city, property.zip].filter(Boolean).join(', ')} />
        {property.mailVerdict && (
          <Row
            k="Clerk mail"
            v={
              property.mailVerdict === 'undeliverable'
                ? 'every mailing returned'
                : property.mailVerdict === 'delivered'
                  ? 'delivered'
                  : property.mailVerdict === 'mixed'
                    ? 'some delivered, some returned'
                    : 'unknown'
            }
            tone={property.mailVerdict === 'undeliverable' ? 'var(--red)' : undefined}
            note={
              property.mailVerdict === 'undeliverable'
                ? 'The address of record is dead, so this lead lives or dies on the skip trace.'
                : undefined
            }
          />
        )}
      </div>
      <CountySection lead={lead} onChanged={onChanged} say={say} />
      <DocketBlock property={property} ledger={ledger} />
      <HoldControl lead={lead} onChanged={onChanged} say={say} />
    </div>
  );
}

/**
 * Put the file on hold, with a reason, or release it. A held file leaves the
 * working queues for On hold and its drips wait, so nobody contacts anyone on
 * it until somebody clears it: an active claim to check, a legal question.
 */
function HoldControl({
  lead,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  /** A revisit date makes it a pause. Empty is an ordinary hold with no end. */
  const [until, setUntil] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (on: boolean) => {
    if (saving || (on && !reason.trim())) return;
    setSaving(true);
    try {
      await surplusAPI.hold(lead.id, on, on ? reason.trim() : undefined, on && until ? until : undefined);
      say(
        !on
          ? `${lead.claimant} released from hold`
          : until
            ? `${lead.claimant} paused until ${fmtDay(until)}. It comes back on its own then.`
            : `${lead.claimant} is on hold. Drips wait until it is released.`,
      );
      setUntil('');
      setOpen(false);
      setReason('');
      onChanged();
    } catch (e: any) {
      say(e?.response?.data?.message || 'The hold could not be changed');
    } finally {
      setSaving(false);
    }
  };

  if (lead.heldAt) {
    return (
      <div className="dc-wp-hold on">
        <div>
          {lead.holdUntil ? (
            <>
              <b>Paused</b> since {fmtDate(lead.heldAt)} until {fmtDay(lead.holdUntil)}
              {lead.holdReason ? `: ${lead.holdReason}` : ''}. It comes back on its own that morning with a revisit task.
            </>
          ) : (
            <>
              <b>On hold</b> since {fmtDate(lead.heldAt)}
              {lead.holdReason ? `: ${lead.holdReason}` : ''}. Nobody works it and its drips wait.
            </>
          )}
        </div>
        <button type="button" className="dc-wp-btn" disabled={saving} onClick={() => save(false)}>
          {saving ? 'Releasing...' : 'Release'}
        </button>
      </div>
    );
  }
  if (!open) {
    return (
      <div className="dc-wp-hold">
        <button type="button" className="dc-wp-btn" onClick={() => setOpen(true)}>
          Put on hold
        </button>
      </div>
    );
  }
  return (
    <div className="dc-wp-hold">
      <input
        className="dc-input"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why: an active claim to check, a legal question, waiting on Ian"
        aria-label="Why the file is on hold"
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && save(true)}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--dim)' }}>
        Until
        <input
          type="date"
          className="dc-input"
          style={{ width: 'auto' }}
          value={until}
          min={todayLocal()}
          onChange={(e) => setUntil(e.target.value)}
          aria-label="Revisit date, leave empty for a hold with no end"
        />
      </label>
      <button type="button" className="dc-wp-btn on" disabled={saving || !reason.trim()} onClick={() => save(true)}>
        {saving ? 'Saving...' : until ? 'Pause' : 'Hold'}
      </button>
      <button type="button" className="dc-wp-btn" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}

/**
 * The People tab: the heirs who can sign and the relatives, neighbors and
 * friends who may know where the claimant is.
 *
 * Its own tab because on the Case tab it was one long section in the middle
 * of the outreach, with every person's numbers, profiles and buttons pushing
 * the rest of the case off the screen. Here they can be read and rung one
 * after another.
 */
function PeopleTab({
  lead,
  property,
  onCall,
  onText,
  onEmail,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  property: any;
  onCall: (number: string, who?: string) => void;
  onText: (number: string) => void;
  onEmail: (address: string) => void;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  // Whether the paid profile search is paused, asked once per tab. Null until
  // answered; the button reads null as "do not know yet".
  const [socialPaused, setSocialPaused] = useState<boolean | null>(null);
  useEffect(() => {
    surplusAPI
      .socialUsage()
      .then((r) => setSocialPaused(!!r.data?.paused))
      .catch(() => setSocialPaused(true));
  }, []);
  return (
    <div>
      <SubHead title={lead.isDeceased ? 'Who inherited' : 'People around the claimant'} note={peopleNote(lead)} />
      <SurplusHeirs
        key={lead.id}
        leadId={lead.id}
        claimant={lead.claimant}
        claimantDeceased={!!lead.isDeceased}
        propertyAddress={property.address}
        county={property.county}
        courtRecordsUrl={lead.courtRecordsUrl}
        social={lead.social?.profiles || []}
        socialPaused={socialPaused}
        onCall={onCall}
        onText={onText}
        onEmail={onEmail}
        onChanged={onChanged}
        say={say}
      />
    </div>
  );
}

/** One line on where things stand with the people around the claimant. */
function peopleNote(lead: SurplusPanelLead): string {
  if (lead.isDeceased) return 'Only a living heir can file this claim';
  if (lead.associateCount) {
    return `${lead.associateCount} who may know where ${lead.claimant} is${lead.associatesUntried ? `, ${lead.associatesUntried} not yet contacted` : ''}`;
  }
  return 'A relative or a neighbor usually knows where they are';
}

/**
 * The claimant's mailing address, and where to correct it.
 *
 * Off the county it is where the clerk wrote to them. Once somebody confirms
 * a current address it replaces that one: letters default to it, the skip
 * trace targets it, and the county poll leaves it alone. The address it
 * replaced is written to Notes by the API so nothing is lost.
 *
 * 'contact' renders it as a line in the claimant's contacts, next to the
 * phones and emails, which is where people look to change it. 'row' is the
 * read-only line under Addresses in The case, beside the property that sold.
 */
function MailingAddress({
  lead,
  noticeReadForCase = false,
  variant,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  noticeReadForCase?: boolean;
  variant: 'contact' | 'row';
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [street, setStreet] = useState(lead.ownerMailingStreet || '');
  const [city, setCity] = useState(lead.ownerMailingCity || '');
  const [state, setState] = useState(lead.ownerMailingState || '');
  const [zip, setZip] = useState(lead.ownerMailingZip || '');
  const [country, setCountry] = useState(lead.ownerMailingCountry || '');

  const reset = () => {
    setStreet(lead.ownerMailingStreet || '');
    setCity(lead.ownerMailingCity || '');
    setState(lead.ownerMailingState || '');
    setZip(lead.ownerMailingZip || '');
    setCountry(lead.ownerMailingCountry || '');
  };

  // Another claimant's address must never sit in this form.
  useEffect(() => {
    setEditing(false);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  const manual = lead.ownerAddressSource === 'manual';
  const who = lead.noticeRecipient || lead.claimant;
  const onFile = [
    lead.ownerMailingStreet,
    lead.ownerMailingCity,
    [lead.ownerMailingState, lead.ownerMailingZip].filter(Boolean).join(' '),
    lead.ownerMailingCountry,
  ]
    .filter(Boolean)
    .join(', ');

  const save = async () => {
    if (!street.trim()) {
      say('The mailing address needs a street.');
      return;
    }
    setBusy(true);
    try {
      await surplusAPI.update(lead.id, {
        // An empty country means the US.
        ownerMailing: { street: street.trim(), city: city.trim(), state: state.trim(), zip: zip.trim(), country: country.trim() },
      });
      say(lead.ownerMailingStreet ? 'Mailing address updated. The old one is in Notes.' : 'Mailing address saved');
      setEditing(false);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 12.5,
    padding: '6px 8px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--surface2)',
    color: 'inherit',
  };
  const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--dim)' };

  if (editing) {
    return (
      <div style={{ display: 'grid', gap: 6, padding: 8, marginTop: 4, border: '1px solid var(--border)', borderRadius: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Current mailing address for {lead.claimant}</div>
        <label style={lbl}>
          Street
          <input style={field} value={street} onChange={(e) => setStreet(e.target.value)} autoFocus />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 6 }}>
          <label style={lbl}>
            City
            <input style={field} value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <label style={lbl}>
            State
            <input
              style={field}
              value={state}
              maxLength={country.trim() ? undefined : 2}
              onChange={(e) => setState(e.target.value.toUpperCase())}
            />
          </label>
          <label style={lbl}>
            ZIP
            <input style={field} value={zip} onChange={(e) => setZip(e.target.value)} />
          </label>
        </div>
        <label style={lbl}>
          Country (leave blank for the US)
          <input style={field} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
        </label>
        {lead.ownerMailingStreet && (
          <div style={{ fontSize: 11, color: 'var(--faint)' }}>
            Replaces {onFile}. The old address is saved to Notes.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="dc-wp-btn"
            disabled={busy}
            onClick={() => {
              reset();
              setEditing(false);
            }}
          >
            Cancel
          </button>
          <button type="button" className="dc-wp-btn on" disabled={busy} onClick={save}>
            Save
          </button>
        </div>
      </div>
    );
  }

  if (variant === 'contact') {
    return (
      <div className="dc-wp-contact">
        <div className="dc-wp-contact-main">
          <span className="num" style={lead.ownerMailingStreet ? undefined : { color: 'var(--faint)', fontWeight: 400 }}>
            {onFile || 'No mailing address'}
          </span>
          <span className="meta">{manual ? 'Mailing, confirmed' : lead.ownerMailingStreet ? 'Mailing, from the clerk' : 'Mailing'}</span>
        </div>
        <div className="dc-wp-contact-actions">
          <button type="button" className="dc-wp-btn" onClick={() => setEditing(true)}>
            {lead.ownerMailingStreet ? 'Edit address' : 'Add address'}
          </button>
        </div>
      </div>
    );
  }

  if (!lead.ownerMailingStreet) {
    return (
      <div>
        <Row
          k={`Where the clerk wrote to ${lead.claimant}`}
          v="not recovered"
          tone="var(--amber)"
          note={
            noticeReadForCase
              ? 'The notice was read for this case but no page was addressed to this claimant, so a trace here would fall back to the property address, which is usually not where they are.'
              : 'The Notice of Surplus Funds has not been read for this case, so any trace falls back to the property address, which is usually not where the owner is.'
          }
        />
      </div>
    );
  }

  return (
    <div>
      <Row
        k={manual ? `Current address for ${lead.claimant}` : `Where the clerk wrote to ${who}`}
        v={onFile}
        tone="var(--mint)"
        note={
          manual
            ? 'Confirmed by the team. Letters default to it and it is the address that gets skip traced.'
            : lead.noticeRecipient && lead.noticeRecipient !== lead.claimant
              ? `The notice names ${lead.noticeRecipient}, matched to this claimant. This is the address that gets skip traced.`
              : 'This is the address that gets skip traced.'
        }
      />
    </div>
  );
}

/** A heading inside a fold. Smaller than the fold's own title on purpose. */
function SubHead({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--dim)' }}>
        {title}
      </div>
      {note && <div style={{ fontSize: 11, color: 'var(--faint)' }}>{note}</div>}
    </div>
  );
}

/**
 * The claimant's own numbers and emails, clickable. For a deceased claimant
 * they are folded under a plain warning: the buttons used to sit at full
 * weight under a grey note that they could not sign, which is how time went
 * into ringing a dead man's mobile.
 */
function ContactsBlock({
  lead,
  onCall,
  onText,
  onEmail,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  onCall: (number: string) => void;
  onText: (number: string) => void;
  onEmail: (address: string) => void;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const list = (
    <>
      {lead.phones.length === 0 && lead.emails.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--faint)' }}>No phone or email on file.</div>
      )}
      {/* A flagged number still shows and is still clickable, because the
          decision belongs to the person making the call, but the flag is
          loud enough that it cannot be missed. */}
      {lead.phones.map((p) => {
        const flag = p.dnc ? DNC_STATE[p.dnc] : null;
        return (
          <div key={p.number} className="dc-wp-contact" style={p.bad ? { opacity: 0.6 } : undefined}>
            <div className="dc-wp-contact-main">
              <span className="num" style={p.bad ? { textDecoration: 'line-through' } : undefined}>
                {phoneDisplay(p.number)}
              </span>
              <span className="meta">{p.type || 'Phone'}</span>
              {flag && <span className="flag">{flag.label}</span>}
              {p.bad && <span className="flag">Wrong or disconnected</span>}
            </div>
            <div className="dc-wp-contact-actions">
              <button type="button" className="dc-wp-btn" onClick={() => onCall(p.number)}>
                Call
              </button>
              <button type="button" className="dc-wp-btn" onClick={() => onText(p.number)}>
                Text
              </button>
              <MoveNumber
                leadId={lead.id}
                number={p.number}
                currentHeirId={null}
                people={(lead.heirs || []).map((h) => ({ id: h.id, name: h.name, deceased: !!h.deceased }))}
                claimant={lead.claimant}
                claimantDeceased={!!lead.isDeceased}
                say={say}
                onChanged={onChanged}
              />
            </div>
          </div>
        );
      })}
      {lead.emails.map((e) => (
        <div key={e} className="dc-wp-contact">
          <div className="dc-wp-contact-main">
            <span className="num">{e}</span>
            <span className="meta">Email</span>
          </div>
          <div className="dc-wp-contact-actions">
            <button type="button" className="dc-wp-btn" onClick={() => onEmail(e)}>
              Email
            </button>
          </div>
        </div>
      ))}
      <MailingAddress lead={lead} variant="contact" onChanged={onChanged} say={say} />
      {/* Research turns up numbers the vendor never had. This is where they
          go, and where a number that turned out to be somebody else gets
          marked rather than deleted. */}
      <div style={{ marginTop: 6 }}>
        <button type="button" className="dc-wp-btn" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Done editing' : 'Edit contacts'}
        </button>
      </div>
      {editing && <ContactEditor leadId={lead.id} onChanged={onChanged} say={say} />}
    </>
  );
  if (!lead.isDeceased) return <div>{list}</div>;
  return (
    <details className="dc-fold-sub">
      <summary>
        {lead.claimant}&apos;s own contacts <span className="flag">cannot sign</span>
      </summary>
      <div style={{ fontSize: 11.5, color: 'var(--faint)', margin: '4px 0 6px' }}>
        Kept for the record. Nothing here can sign or be paid; the heirs are the route.
      </div>
      {list}
    </details>
  );
}

/**
 * The trace verdict, stated before the contacts rather than inferred from
 * their absence. "Nothing has been tried" and "everything has been tried"
 * both render as an empty contact list, and they want opposite next actions:
 * one costs a credit, the other a name search.
 */
function TraceBlock({ lead }: { lead: SurplusPanelLead }) {
  return (
    <div>
      {lead.trace && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            flexWrap: 'wrap',
            padding: '7px 10px',
            marginBottom: 8,
            borderRadius: 6,
            background: 'var(--bg2)',
            borderLeft: `3px solid ${TRACE_TONE[lead.trace.tone]}`,
          }}
        >
          <strong style={{ fontSize: 12.5, color: TRACE_TONE[lead.trace.tone] }}>{lead.trace.label}</strong>
          {lead.trace.at && <span style={{ fontSize: 11, color: 'var(--faint)' }}>{fmtDate(lead.trace.at)}</span>}
          <div style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--dim)' }}>{lead.trace.detail}</div>
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--faint)' }}>
        {/* BatchData and EnformionGo were retired on 2026-10-31: neither
            produced usable contacts. The trace is the IDI batch, exported
            from the board, so the card points there instead of buying a
            search by itself. */}
        <div>
          Skip tracing runs through IDI: select {lead.claimant} on the board and use <b>Export for IDI</b>, then import
          the results under <b>More, IDI batches</b>.
        </div>
        {lead.enformionSearchedAt && (
          <span style={{ fontSize: 11 }}>Last people search {fmtDate(lead.enformionSearchedAt)}.</span>
        )}
        {lead.contactInfoUpdatedAt && (
          <span style={{ marginLeft: 8, fontSize: 11 }}>Contact updated {fmtDate(lead.contactInfoUpdatedAt)}.</span>
        )}
      </div>
    </div>
  );
}

/**
 * The claimant's social profiles, and how to find them.
 *
 * Nobody publishes an API for finding a person on Facebook, so this is the
 * shortcut for what the team already does by hand: the searches open
 * pre-filled on each platform, a found link is pasted in and kept, and the
 * paid web search does the looking and offers what fits with the evidence.
 * A profile on file gets an Open, a Message into the platform's own app,
 * and a Log so the message counts as a touch. The opener is one click to
 * copy and never names the amount or the county.
 */
function SocialBlock({
  lead,
  currentUser,
  paused,
  say,
  onChanged,
}: {
  lead: SurplusPanelLead;
  currentUser: any;
  paused: boolean | null;
  say: (msg: string) => void;
  onChanged: () => void;
}) {
  const social = lead.social!;
  const [findOpen, setFindOpen] = useState(false);
  // The person, not the estate: the profile was Odessa Rainwater's, never "Estate of".
  const who = lead.claimant.replace(/^(the\s+)?estate\s+of\s+/i, '').trim() || lead.claimant;
  const mine = social.profiles.filter((p) => !p.heirId);
  const leads = social.lastSearch?.leads || [];
  // The card a profile found in another tab belongs to. Any click in this
  // block means this is the person being looked for.
  const remember = () =>
    rememberSocialTarget({
      leadId: lead.id,
      heirId: null,
      label: who,
      sub: [lead.county ? `${lead.county} County` : null, lead.caseNumber ? `case ${lead.caseNumber}` : null].filter(Boolean).join(', ') || null,
    });
  const addRelative = async (l: { kind: string; value: string; detail: string | null }) => {
    try {
      await surplusAPI.addHeir(lead.id, {
        name: l.value,
        role: 'relative',
        relationship: l.kind === 'spouse' ? 'Spouse' : null,
        callNotes: `From web research${l.detail ? `: ${l.detail}` : ''}. Unverified.`,
      });
      say(`${l.value} added to the people around ${who}.`);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be added.');
    }
  };
  const candidates = mine.filter((p) => p.status === 'candidate').length;
  const confirmed = mine.filter((p) => p.status === 'confirmed').length;
  const sender = [currentUser?.firstName, currentUser?.lastName].filter(Boolean).join(' ') || 'the team';
  const copyOpener = async () => {
    const text = socialOpener(who, sender, 'D.I.G. Deeper LLC', null);
    try {
      await navigator.clipboard.writeText(text);
      say('Opener copied. Paste it into the message.');
    } catch {
      window.prompt('Copy the opener:', text);
    }
  };
  const note = lead.isDeceased
    ? 'Deceased. Their profile can still name the family; message the heirs, not this account.'
    : candidates
      ? `${candidates} to check before messaging`
      : confirmed
        ? `${confirmed} confirmed`
        : lead.phones.length === 0
          ? 'No number on file, so a profile may be the only way to reach them'
          : undefined;
  return (
    <div style={{ marginTop: 10 }} onClickCapture={remember}>
      <SubHead title={`${who} online`} note={note} />
      {mine.length === 0 && !findOpen && (
        <div style={{ fontSize: 12, color: 'var(--faint)' }}>No profile on file yet.</div>
      )}
      <SocialProfileList profiles={mine} say={say} onChanged={onChanged} />
      {leads.length > 0 && <SocialLeads leads={leads} who={who} onAddRelative={addRelative} />}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
        <button type="button" className="dc-wp-btn" onClick={() => setFindOpen((v) => !v)}>
          {findOpen ? 'Done' : mine.length ? 'Find more' : `Find ${who} online`}
        </button>
        {confirmed > 0 && (
          <button type="button" className="dc-wp-btn" onClick={copyOpener} title="A short first message: who is writing and why, no amount, no county.">
            Copy the opener
          </button>
        )}
      </div>
      {findOpen && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {social.links.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>
                Each opens the search on that site, filled in. Log what you find afterwards; a logged social search is what the escalation rule reads.
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {social.links.map((l) => (
                  <SearchLink key={l.site} lead={lead} link={l} say={say} onChanged={onChanged} />
                ))}
              </div>
            </div>
          )}
          {!lead.isDeceased && (
            <div>
              <FindProfilesButton
                leadId={lead.id}
                who={who}
                searchedAt={social.searchedAt}
                paused={paused}
                say={say}
                onChanged={onChanged}
              />
              {social.lastSearch && (
                <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3 }}>
                  Last search: {social.lastSearch.found ? `${social.lastSearch.found} offered.` : 'nothing fit.'} {social.lastSearch.searched || ''}
                  {social.lastSearch.note ? ` ${social.lastSearch.note}` : ''}
                </div>
              )}
            </div>
          )}
          <AddSocialProfile leadId={lead.id} say={say} onChanged={onChanged} />
          <SaveToDealcore />
        </div>
      )}
    </div>
  );
}

/**
 * What the web research found that is not a profile: a spouse, an employer,
 * a business, a team. Facebook keeps most personal profiles out of search
 * engines, so the paid search usually cannot see the profile itself, but it
 * can see what tells this person from the namesakes. Each lead is one click
 * into Facebook's own search, run from the person's logged-in browser.
 */
function SocialLeads({
  leads,
  who,
  onAddRelative,
}: {
  leads: { kind: string; value: string; detail: string | null; searchUrl: string | null }[];
  who: string;
  onAddRelative: (l: { kind: string; value: string; detail: string | null }) => void;
}) {
  return (
    <div style={{ marginTop: 6, padding: '7px 10px', borderRadius: 6, background: 'var(--bg2)' }}>
      <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>
        From the web search. Unverified: use these to tell {who} from a namesake, not as facts.
      </div>
      {leads.map((l) => {
        const person = l.kind === 'spouse' || l.kind === 'relative';
        return (
          <div key={`${l.kind}-${l.value}`} className="dc-wp-contact" style={{ padding: '4px 0' }}>
            <div className="dc-wp-contact-main">
              <span className="meta" style={{ minWidth: 62 }}>{SOCIAL_LEAD_LABEL[l.kind] || 'Lead'}</span>
              <span className="num" style={{ fontSize: 12.5 }}>{l.value}</span>
              {l.detail && <span className="meta">{l.detail}</span>}
            </div>
            <div className="dc-wp-contact-actions">
              {l.searchUrl && (
                <a
                  href={l.searchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dc-wp-btn"
                  style={{ padding: '4px 10px', fontSize: 11.5 }}
                  title={person ? `Searches Facebook for ${l.value}` : `Searches Facebook for ${who} together with ${l.value}`}
                >
                  Facebook
                </a>
              )}
              {person && (
                <button type="button" className="dc-wp-btn" onClick={() => onAddRelative(l)} title="Adds them to the people around the claimant, so they can be traced and contacted">
                  Add as relative
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The Save to Dealcore bookmarklet. Dragged to the bookmarks bar once; then
 * on anybody's profile page one click attaches that profile to the card
 * being worked, with no copying and pasting. The href is set after mount
 * because React refuses a javascript: address written in JSX.
 */
function SaveToDealcore() {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.setAttribute('href', saveToDealcoreBookmarklet(window.location.origin));
  }, []);
  return (
    <details>
      <summary style={{ fontSize: 11.5, color: 'var(--dim)', cursor: 'pointer' }}>Skip the copy and paste: the Save to Dealcore button</summary>
      <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}>
        Drag this to your bookmarks bar, once:{' '}
        <a
          ref={ref}
          className="dc-wp-searchlink"
          onClick={(e) => e.preventDefault()}
          title="Drag me to the bookmarks bar. Clicking here does nothing."
          style={{ cursor: 'grab' }}
        >
          Save to Dealcore
        </a>
        <div style={{ marginTop: 4, color: 'var(--faint)' }}>
          Then, on the person&apos;s Facebook, Instagram or LinkedIn page, click it. A small window asks which card to
          save the profile to, already set to the last card you searched from.
        </div>
      </div>
    </details>
  );
}

/**
 * When the address route is exhausted, the name route is what is left. The
 * course teaches searching NAME plus STATE and confirming against the
 * property that was sold, which is the inverse of what BatchData does and is
 * why the two complement each other.
 */
function NameSearchBlock({
  lead,
  property,
  say,
  onChanged,
}: {
  lead: SurplusPanelLead;
  property: any;
  say: (msg: string) => void;
  onChanged: () => void;
}) {
  const ns = lead.nameSearch!;
  return (
    <div>
      <SubHead
        title={`Find ${lead.claimant} by name`}
        note={
          property.claimants.length > 1
            ? `One claimant at a time. Switch at the top to search ${property.claimants
                .filter((c: any) => c.id !== lead.id)
                .map((c: any) => c.claimant)
                .join(' or ')}.`
            : undefined
        }
      />
      {ns.reason && <div style={{ fontSize: 11.5, color: 'var(--amber)', marginBottom: 4 }}>{ns.reason}</div>}
      <Row k="Search for" v={ns.query} />
      {ns.state && <Row k="In state" v={ns.state} />}
      {ns.verifyAgainst && (
        <Row
          k="Confirm against"
          v={ns.verifyAgainst}
          tone="var(--mint)"
          note="A result whose address history includes this property is your claimant. One that does not is a different person with the same name."
        />
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {ns.links.map((l: any) => (
          <SearchLink key={l.site} lead={lead} link={l} say={say} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

/** The county's document list for the case, grouped by what matters. */
function DocketBlock({ property, ledger }: { property: any; ledger: LedgerDoc[] }) {
  const grouped = LEDGER_GROUPS.map((g) => ({ ...g, docs: ledger.filter((d) => d.kind === g.kind) })).filter(
    (g) => g.docs.length > 0,
  );
  const other = ledger.filter((d) => !LEDGER_GROUPS.some((g) => g.kind === d.kind));
  return (
    <div>
      <SubHead
        title="The docket"
        note={property.lastPolledAt ? `Last checked ${fmtDate(property.lastPolledAt)}` : 'Not yet pulled from the county'}
      />
      {ledger.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--faint)' }}>
          No document list on file. This lead came from an upload rather than a county poll.
        </div>
      )}
      {grouped.map((g) => (
        <div key={g.kind} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: g.tone, fontWeight: 700, marginBottom: 3 }}>
            {g.label} ({g.docs.length})
          </div>
          {g.docs.map((d, i) => (
            <DocLink key={`${d.docId || d.title}-${i}`} doc={d} source={property.sourceSystem} />
          ))}
        </div>
      ))}
      {other.length > 0 && (
        <details>
          <summary style={{ fontSize: 11, color: 'var(--faint)', cursor: 'pointer' }}>{other.length} routine filings</summary>
          <div style={{ marginTop: 4 }}>
            {other.map((d, i) => (
              <DocLink key={`${d.docId || d.title}-${i}`} doc={d} source={property.sourceSystem} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * One document on the docket.
 *
 * Duval links are durable relative paths and open directly. RealTDM hands out
 * pre-signed S3 URLs that expire within the hour, so those ledgers store only
 * the document id and the link is minted when clicked. The tab is opened
 * before the request so the browser treats it as the click's own navigation
 * rather than a popup.
 */
function DocLink({ doc, source }: { doc: LedgerDoc; source?: string | null }) {
  const label = doc.title;
  const filed = doc.filedAt ? ` ${fmtDate(doc.filedAt)}` : '';

  if (doc.url) {
    return (
      <div style={{ fontSize: 12 }}>
        <a
          // Absolute since the Pioneer counties landed; older Duval ledgers
          // hold a path, and Duval is the only county that ever stored one.
          href={doc.url.startsWith('http') ? doc.url : `https://taxdeed.duvalclerk.com${doc.url}`}
          target="_blank"
          rel="noopener noreferrer"
          className="dc-wp-doc"
        >
          {label}
        </a>
      </div>
    );
  }

  if (doc.docId && source && source.startsWith('realtdm')) {
    const open = async (e: React.MouseEvent) => {
      e.preventDefault();
      const tab = window.open('', '_blank');
      try {
        const res = await surplusAPI.documentLink(source, doc.docId!, doc.docType);
        const url = res?.data?.url;
        if (tab && url) tab.location.href = url;
        else tab?.close();
      } catch {
        tab?.close();
      }
    };
    return (
      <div style={{ fontSize: 12 }}>
        <a href="#" onClick={open} className="dc-wp-doc">
          {label}
        </a>
        <span style={{ fontSize: 10, color: 'var(--faint)' }}>{filed}</span>
      </div>
    );
  }

  return (
    <div style={{ fontSize: 12, color: 'var(--faint)' }}>
      {label} <span style={{ fontSize: 10 }}>(not scanned)</span>
    </div>
  );
}

/**
 * "We mailed them." For the claimants nobody can phone, a letter to the
 * address on file is the outreach, and this is the record of it: the date and
 * the envelope. Setting it parks the claimant in the Letter sent queue so the
 * address is not traced or searched again, and adds a note to the lead so the
 * mailing shows in the timeline beside every call and text.
 *
 * One letter per claimant for now. Marking again overwrites the date; the
 * notes keep the history.
 */
const MAIL_TYPE_LABEL: Record<string, string> = {
  standard: 'Standard',
  priority: 'Priority Mail',
  fedex: 'FedEx',
};

const LETTER_KINDS: [string, string][] = [
  ['letter_claimant', 'To the claimant'],
  ['letter_claimant_2', 'To the claimant, second letter'],
  ['letter_claimant_3', 'To the claimant, third letter'],
  ['letter_family', 'To a family member'],
  ['letter_associate', 'To a neighbour or associate'],
];

/**
 * Every envelope that went out on this claim, and where the cadence stands.
 *
 * The course's rule is weekly or biweekly letters until somebody replies,
 * with the third unanswered standard letter upgraded to Priority or FedEx
 * so it is actually opened. Both are counted here off the history rather
 * than remembered. "Write a letter" opens the print view built from the
 * template; "Record a letter" is for one that went out some other way.
 */
function LetterHistory({
  lead,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const onFile = [
    lead.ownerMailingStreet,
    lead.ownerMailingCity,
    [lead.ownerMailingState, lead.ownerMailingZip].filter(Boolean).join(' '),
    lead.ownerMailingCountry,
  ]
    .filter(Boolean)
    .join(', ');
  const livingHeirs = (lead.heirs || []).filter((h) => !h.deceased);

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayLocal);
  const [recipient, setRecipient] = useState<string>('claimant');
  const [address, setAddress] = useState(onFile);
  const [mailType, setMailType] = useState('standard');
  const [tracking, setTracking] = useState('');
  const [note, setNote] = useState('');
  const [writeKind, setWriteKind] = useState('letter_claimant');
  const [writeTo, setWriteTo] = useState<string>('claimant');
  const [busy, setBusy] = useState(false);

  // Switching claimant closes the form and re-seeds the envelope, because the
  // address is per claimant and a stale one here is exactly the mistake the
  // record exists to prevent.
  useEffect(() => {
    setOpen(false);
    setRecipient('claimant');
    setAddress(onFile);
    setMailType(lead.escalateMail ? 'priority' : 'standard');
    setTracking('');
    setNote('');
    setDate(todayLocal());
    setWriteTo('claimant');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  // The recipient picks the envelope address: an heir's is their own, off the
  // filing, and must never default to the dead claimant's. A corrected
  // mailing address re-seeds the claimant's envelope too.
  useEffect(() => {
    if (recipient === 'claimant') setAddress(onFile);
    else {
      const h = livingHeirs.find((x) => x.id === recipient);
      setAddress(h?.address || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipient, onFile]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const heir = recipient === 'claimant' ? null : livingHeirs.find((x) => x.id === recipient) || null;
      await surplusAPI.letterMailed([lead.id], {
        mailedAt: date || null,
        address: address.trim() || null,
        note: note.trim() || null,
        mailType,
        trackingNumber: tracking.trim() || null,
        heirId: heir?.id || null,
        recipientName: heir?.name || null,
      });
      say('Letter recorded');
      setOpen(false);
      onChanged();
    } catch (e: any) {
      say(e?.response?.data?.message || 'The letter could not be recorded');
    } finally {
      setBusy(false);
    }
  };

  const markReturned = async (letterId: string, returned: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await surplusAPI.letterReturned(letterId, returned);
      say(returned ? 'Marked as returned. That address will not be mailed again.' : 'No longer marked returned');
      onChanged();
    } catch (e: any) {
      say(e?.response?.data?.message || 'The letter could not be updated');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (letterId: string) => {
    if (busy) return;
    if (!window.confirm('Remove this letter from the history? The note in the Notes tab stays.')) return;
    setBusy(true);
    try {
      await surplusAPI.deleteLetter(letterId);
      say('Letter removed');
      onChanged();
    } catch (e: any) {
      say(e?.response?.data?.message || 'The letter could not be removed');
    } finally {
      setBusy(false);
    }
  };

  const setCadence = async (days: number) => {
    if (busy || days === lead.letterCadenceDays) return;
    setBusy(true);
    try {
      await surplusAPI.update(lead.id, { letterCadenceDays: days });
      say(days === 7 ? 'Letters weekly' : 'Letters every two weeks');
      onChanged();
    } catch (e: any) {
      say(e?.response?.data?.message || 'The cadence could not be saved');
    } finally {
      setBusy(false);
    }
  };

  const write = () => {
    const heir = writeTo === 'claimant' ? null : writeTo;
    const q = new URLSearchParams({ lead: lead.id, kind: writeKind });
    if (heir) q.set('heir', heir);
    window.open(`/surplus-funds/letter?${q.toString()}`, '_blank', 'noopener');
  };

  const field: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 12.5,
    padding: '6px 8px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--surface2)',
    color: 'inherit',
  };
  const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--dim)' };

  const letters = lead.letters || [];
  const replied = !!lead.tappedAt;
  const dueLine = replied
    ? `${lead.claimant} has replied, so the letter cadence is off.`
    : !onFile && !letters.length
      ? 'No address to write to yet.'
      : lead.letterDue
        ? letters.length
          ? `Letter due. The last one went out ${fmtDate(letters[0].mailedAt)} and the cadence is ${lead.letterCadenceDays} days.`
          : 'No letter has gone out yet. Everyone gets a letter.'
        : lead.letterDueAt
          ? `Next letter due ${fmtDate(lead.letterDueAt)}.`
          : '';

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', fontSize: 13 }}>
        <span style={{ color: 'var(--dim)' }}>
          Letters
          {letters.length ? <span style={{ color: 'var(--faint)' }}> · {letters.length} sent</span> : null}
        </span>
        <span style={{ display: 'inline-flex', gap: 4, fontSize: 11 }} title="How often a letter goes out while nobody has replied">
          {([7, 14] as const).map((d) => (
            <button
              key={d}
              type="button"
              className={`dc-wp-btn${lead.letterCadenceDays === d ? ' on' : ''}`}
              disabled={busy}
              onClick={() => setCadence(d)}
              style={{ padding: '3px 8px', fontSize: 11 }}
            >
              {d === 7 ? 'Weekly' : 'Biweekly'}
            </button>
          ))}
        </span>
      </div>

      {dueLine && (
        <div style={{ fontSize: 11.5, color: lead.letterDue && !replied ? 'var(--amber)' : 'var(--faint)' }}>
          {dueLine}
        </div>
      )}
      {lead.escalateMail && !replied && (
        <div
          style={{
            fontSize: 11.5,
            padding: '6px 9px',
            borderRadius: 6,
            background: 'var(--bg2)',
            borderLeft: '3px solid var(--amber)',
            color: 'var(--dim)',
          }}
        >
          Three standard letters have gone unanswered. Send the next one by Priority Mail or FedEx so it
          gets opened.
        </div>
      )}

      {lead.mailReturned && (
        <div
          style={{
            fontSize: 12,
            padding: '6px 9px',
            borderRadius: 6,
            background: 'var(--bg2)',
            borderLeft: '3px solid var(--red)',
            color: 'var(--dim)',
          }}
        >
          A letter came back from the mailing address on file, so it will not be mailed again. Find a newer
          address to write to.
        </div>
      )}

      {letters.length > 0 && (
        <div style={{ display: 'grid', gap: 3 }}>
          {letters.map((l) => (
            <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12 }}>
              <span style={{ color: 'var(--mint)', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDate(l.mailedAt)}</span>
              <span style={{ color: 'var(--dim)', minWidth: 0, overflowWrap: 'anywhere', flex: 1 }}>
                {l.recipientName && l.recipientName !== lead.claimant ? `${l.recipientName}, ` : ''}
                {l.address || 'address not recorded'}
                {l.mailType !== 'standard' ? ` · ${MAIL_TYPE_LABEL[l.mailType] || l.mailType}` : ''}
                {l.trackingNumber ? ` · ${l.trackingNumber}` : ''}
                {l.templateKind ? ` · ${LETTER_KINDS.find(([k]) => k === l.templateKind)?.[1] || l.templateKind}` : ''}
                {l.returnedAt && (
                  <span style={{ color: 'var(--red)', fontWeight: 600 }}> · Came back {fmtDate(l.returnedAt)}</span>
                )}
              </span>
              <button
                type="button"
                className="dc-wp-btn"
                disabled={busy}
                onClick={() => markReturned(l.id, !l.returnedAt)}
                title={l.returnedAt ? 'It was delivered after all' : 'The envelope came back undeliverable'}
                style={{ padding: '2px 7px', fontSize: 11, whiteSpace: 'nowrap' }}
              >
                {l.returnedAt ? 'Not returned' : 'Came back'}
              </button>
              <button
                type="button"
                className="dc-wp-btn"
                disabled={busy}
                onClick={() => remove(l.id)}
                title="Remove a mistaken entry"
                style={{ padding: '2px 7px', fontSize: 11 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Write one from the template. Opens the print view in its own tab so
          the letter can be printed and then recorded from there. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="dc-wp-sel" value={writeKind} onChange={(e) => setWriteKind(e.target.value)} aria-label="Letter kind">
          {LETTER_KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        {livingHeirs.length > 0 && (
          <select className="dc-wp-sel" value={writeTo} onChange={(e) => setWriteTo(e.target.value)} aria-label="Addressed to">
            <option value="claimant">{lead.claimant}</option>
            {livingHeirs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="dc-wp-btn on" onClick={write}>
          {'✉'} Write a letter
        </button>
        {!open && (
          <button type="button" className="dc-wp-btn" onClick={() => setOpen(true)}>
            Record a letter
          </button>
        )}
      </div>

      {open && (
        <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>Record a mailed letter</div>
          <label style={lbl}>
            Date mailed
            <input type="date" style={field} value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
          </label>
          {livingHeirs.length > 0 && (
            <label style={lbl}>
              Addressed to
              <select style={field} value={recipient} onChange={(e) => setRecipient(e.target.value)}>
                <option value="claimant">{lead.claimant}</option>
                {livingHeirs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label style={lbl}>
            Mailed to
            <input type="text" style={field} value={address} placeholder="Street, city, state zip" onChange={(e) => setAddress(e.target.value)} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <label style={lbl}>
              Mail type
              <select style={field} value={mailType} onChange={(e) => setMailType(e.target.value)}>
                {Object.entries(MAIL_TYPE_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label style={lbl}>
              Tracking number
              <input type="text" style={field} value={tracking} placeholder="Optional" onChange={(e) => setTracking(e.target.value)} />
            </label>
          </div>
          <label style={lbl}>
            Note, optional
            <input type="text" style={field} value={note} placeholder="Anything worth remembering about this mailing" onChange={(e) => setNote(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="dc-wp-btn on" disabled={busy || !date} onClick={save}>
              {busy ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * What somebody has committed to doing next on this claimant, and when.
 *
 * The course's rule is that no call ends with "circle back later": every
 * follow-up carries a date. The call summary and the stage changes create
 * tasks on their own; this is where they are seen, ticked off, and where a
 * person adds one by hand. Overdue is red because a slipped promise is the
 * thing that loses a claimant's trust.
 */
function TasksSection({
  lead,
  currentUser,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  currentUser: any;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const picks = quickDueDates();

  const load = useCallback(() => {
    leadsAPI
      .getTasks(lead.id)
      .then((r) => setTasks((r.data || []).filter((t: any) => !t.completed)))
      .catch(() => setTasks([]));
  }, [lead.id]);

  useEffect(() => {
    setTasks(null);
  }, [lead.id]);

  // The header's Next action writes tasks too. Reload when it changes, or
  // this list says nothing is scheduled right under a next action.
  const nextKey = `${lead.nextTask?.id || ''}:${lead.nextTask?.title || ''}:${lead.nextTask?.dueDate || ''}:${lead.openTaskCount || 0}`;
  useEffect(() => {
    load();
  }, [nextKey, load]);

  const complete = async (t: any) => {
    setBusy(true);
    try {
      await tasksAPI.complete(t.id, currentUser?.id);
      say(`Done: ${t.title}`);
      load();
      onChanged();
    } catch {
      say('That task could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const text = title.trim();
    if (!text || !due) return;
    setBusy(true);
    try {
      await leadsAPI.createTask(lead.id, {
        title: text,
        dueDate: new Date(due).toISOString(),
        userId: currentUser?.id,
      });
      setTitle('');
      setDue('');
      setAdding(false);
      say('Follow-up added');
      load();
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That follow-up could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Follow-ups"
      note={tasks && tasks.length ? `${tasks.length} open` : undefined}
    >
      {lead.claimantUpdate?.applies && (
        <div style={{ fontSize: 11.5, color: lead.claimantUpdate.overdue ? 'var(--red)' : 'var(--faint)' }}>
          {lead.claimantUpdate.lastAt
            ? `Last word to ${lead.claimant}: ${fmtDate(lead.claimantUpdate.lastAt)}, ${lead.claimantUpdate.daysSince} day${lead.claimantUpdate.daysSince === 1 ? '' : 's'} ago.`
            : `Nothing has been said to ${lead.claimant} since they signed.`}
          {lead.claimantUpdate.overdue ? ' A monthly update is owed, news or not.' : ''}
        </div>
      )}
      {tasks === null ? (
        <div style={{ fontSize: 12, color: 'var(--faint)' }}>Loading...</div>
      ) : tasks.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--faint)' }}>
          Nothing scheduled for {lead.claimant}. A call outcome or a stage change adds one, or add
          one here.
        </div>
      ) : (
        tasks.map((t) => {
          const late = isOverdue(t.dueDate);
          return (
            <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                disabled={busy}
                onChange={() => complete(t)}
                aria-label={`Complete ${t.title}`}
                style={{ marginTop: 3, accentColor: 'var(--mint)' }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{t.title}</div>
                <div style={{ fontSize: 11, color: late ? 'var(--red)' : 'var(--faint)' }}>
                  {dueLabel(t.dueDate)}
                  {t.dueDate ? `, ${fmtDate(t.dueDate)}` : ''}
                  {t.user?.firstName ? ` · ${t.user.firstName}` : ''}
                </div>
              </div>
            </div>
          );
        })
      )}

      {adding ? (
        <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
          <input
            className="dc-input"
            placeholder="What needs doing"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {picks.map((p) => (
              <button
                key={p.label}
                type="button"
                className={`dc-wp-btn${due === p.value ? ' on' : ''}`}
                onClick={() => setDue(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            className="dc-input"
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Due"
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="dc-wp-btn on"
              disabled={busy || !title.trim() || !due}
              onClick={add}
            >
              Save
            </button>
            <button type="button" className="dc-wp-btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className="dc-wp-btn" onClick={() => setAdding(true)}>
            Add a follow-up
          </button>
        </div>
      )}
    </Section>
  );
}

/**
 * Moving this claimant's stage, shared by the header's Stage field.
 *
 * Per claimant, not per property: each person files their own claim and
 * signs their own agreement, so one co-owner can be at Agreement Signed while
 * the other is still unreached. The API refuses a gated stage and says which
 * item is missing, and that message is shown as is rather than paraphrased.
 * Dead needs a reason, so choosing it opens a form instead of a confirm.
 */
function useStageMove(lead: SurplusPanelLead, onChanged: () => void, say: (msg: string) => void) {
  const [saving, setSaving] = useState(false);
  const [deadOpen, setDeadOpen] = useState(false);
  const [deadReason, setDeadReason] = useState('');
  const [deadNote, setDeadNote] = useState('');
  const [deadOverride, setDeadOverride] = useState(false);
  // The effort gate: "unresponsive" is a claim about the work done, and the
  // panel knows what is still missing before the button is pressed.
  const gateMissing = deadReason === 'unresponsive' ? lead.deadGateMissing || [] : [];
  const gateBlocks = gateMissing.length > 0 && !(deadOverride && deadNote.trim());

  useEffect(() => {
    setDeadOpen(false);
    setDeadReason('');
    setDeadNote('');
    setDeadOverride(false);
  }, [lead.id]);

  const markDead = async () => {
    if (!deadReason || saving || gateBlocks) return;
    setSaving(true);
    try {
      await surplusAPI.update(lead.id, {
        stage: 'Dead',
        deadReason,
        deadNote: deadNote.trim() || null,
        ...(deadOverride ? { deadOverride: true } : {}),
      });
      say(`${lead.claimant} marked dead: ${deadReasonLabel(deadReason)}`);
      setDeadOpen(false);
      setDeadReason('');
      setDeadNote('');
      setDeadOverride(false);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const move = async (stage: string) => {
    if (!stage || stage === lead.stage || saving) return;
    if (stage === 'Dead') {
      setDeadOpen(true);
      return;
    }
    if (!window.confirm(`Move ${lead.claimant} to ${stage}?`)) return;
    setSaving(true);
    try {
      await surplusAPI.update(lead.id, { stage });
      say(`${lead.claimant} moved to ${stage}`);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That stage change could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const deadForm = deadOpen && (
    <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--red)', borderRadius: 8, marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>Why is this claim dead?</div>
      <select className="dc-wp-sel" value={deadReason} onChange={(e) => setDeadReason(e.target.value)} aria-label="Dead reason">
        <option value="">Pick a reason</option>
        {SURPLUS_DEAD_REASONS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      <input
        className="dc-input"
        value={deadNote}
        placeholder={deadOverride ? 'Why the file is done despite the gaps (required)' : 'Anything worth remembering, optional'}
        onChange={(e) => setDeadNote(e.target.value)}
      />
      {gateMissing.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--amber)', display: 'grid', gap: 4 }}>
          <div>
            Nobody is unresponsive until the free routes, the mail and the calls have been tried. Still needed: {gateMissing.join(', ')}.
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={deadOverride} onChange={(e) => setDeadOverride(e.target.checked)} />
            Override, with a note saying why
          </label>
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--faint)' }}>
        The lead stays on file with the reason, and the county poll will not bring it back as new.
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="dc-wp-btn" disabled={saving} onClick={() => setDeadOpen(false)}>
          Cancel
        </button>
        <button type="button" className="dc-wp-btn on" disabled={saving || !deadReason || gateBlocks} onClick={markDead}>
          Mark dead
        </button>
      </div>
    </div>
  );

  return { saving, move, deadForm };
}

/**
 * "Thu 10/29, 9:00 AM", or "Overdue since ..." once it has passed. Spelled out
 * rather than "due in 1d", which rounds hours to days and called 9am
 * tomorrow "due today" when it was set late in the evening.
 */
function dueWhen(iso: string): string {
  const d = new Date(iso);
  const when = `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  return d.getTime() < Date.now() ? `Overdue since ${when}` : when;
}

/** Tomorrow at 9am, as a datetime-local value: the default due date for a suggestion taken up. */
function tomorrowNine(): string {
  return quickDueDates().find((p) => p.label === 'Tomorrow 9am')?.value || '';
}

/**
 * The course's four tracking fields, at the top of the panel: Stage, Next
 * action, Owner, Due.
 *
 * Next action is the earliest open follow-up, so a call outcome or a stage
 * change that schedules one fills it, and so does the team. Owner is the
 * lead's assignee. Nothing here is guessed from the queue: when no next
 * action is set the field says so, and the Case tab offers suggestions.
 */
function CaseFields({
  lead,
  team,
  currentUser,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  team: any[];
  currentUser: any;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const stage = useStageMove(lead, onChanged, say);
  const stages = SURPLUS_STAGES.concat('Dead');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const next = lead.nextTask || null;
  const late = !!next?.dueDate && isOverdue(next.dueDate);

  useEffect(() => setEditing(false), [lead.id]);

  const setOwner = async (userId: string) => {
    setBusy(true);
    try {
      const res = await surplusAPI.setOwner(lead.id, userId || null);
      say(res.data?.ownerName ? `Owner: ${res.data.ownerName}` : 'Owner cleared');
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The owner could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const done = async () => {
    if (!next) return;
    setBusy(true);
    try {
      await tasksAPI.complete(next.id, currentUser?.id);
      say(`Done: ${next.title}`);
      onChanged();
    } catch {
      say('That could not be marked done.');
    } finally {
      setBusy(false);
    }
  };

  const cell: React.CSSProperties = { minWidth: 0 };
  return (
    <div style={{ marginTop: 12 }}>
      <div className="dc-wp-fields">
        <div style={{ ...cell, gridColumn: '1 / -1' }}>
          <div className="dc-lbl">Next action</div>
          {next ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span
                style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={next.title}
              >
                {next.title}
              </span>
              <button type="button" className="dc-wp-mini" disabled={busy} onClick={done} title="Mark this done">
                Done
              </button>
              <button type="button" className="dc-wp-mini" disabled={busy} onClick={() => setEditing((v) => !v)}>
                Change
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 12.5, color: 'var(--faint)' }}>None set</span>
              <button type="button" className="dc-wp-mini" onClick={() => setEditing((v) => !v)}>
                Set
              </button>
            </div>
          )}
        </div>
        <div style={cell}>
          <div className="dc-lbl">Stage</div>
          <select
            className="dc-wp-sel"
            value={lead.stage}
            disabled={stage.saving}
            onChange={(e) => {
              const to = e.target.value;
              // Reset so a refused move leaves the select on the real stage.
              e.target.value = lead.stage;
              stage.move(to);
            }}
            aria-label="Stage"
            style={{ padding: '5px 8px', marginTop: 3 }}
          >
            {stages.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>
        <div style={cell}>
          <div className="dc-lbl">Owner</div>
          <select
            className="dc-wp-sel"
            value={lead.ownerId || ''}
            disabled={busy}
            onChange={(e) => setOwner(e.target.value)}
            aria-label="Owner"
            style={{ padding: '5px 8px', marginTop: 3, maxWidth: 140 }}
          >
            <option value="">Nobody</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {`${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email}
              </option>
            ))}
          </select>
        </div>
        <div style={cell}>
          <div className="dc-lbl">Due</div>
          <div style={{ fontSize: 12.5, marginTop: 5, color: late ? 'var(--red)' : next?.dueDate ? 'var(--text)' : 'var(--faint)', whiteSpace: 'nowrap' }}>
            {next?.dueDate ? dueWhen(next.dueDate) : '-'}
            {next?.userName ? <span style={{ color: 'var(--faint)' }}> · {next.userName}</span> : null}
          </div>
        </div>
      </div>
      {lead.stage === 'Dead' && lead.deadReason && (
        <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>
          Dead{lead.deadAt ? ` since ${fmtDate(lead.deadAt)}` : ''}: {deadReasonLabel(lead.deadReason)}
          {lead.deadNote ? <span style={{ color: 'var(--dim)' }}>. {lead.deadNote}</span> : null}
        </div>
      )}
      {stage.deadForm}
      {editing && (
        <NextActionEditor
          lead={lead}
          team={team}
          currentUser={currentUser}
          initial={next ? { taskId: next.id, title: next.title, due: next.dueDate, userId: next.userId } : null}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
          say={say}
        />
      )}
    </div>
  );
}

/** Write or rewrite the next action: what, when, and who. */
function NextActionEditor({
  lead,
  team,
  currentUser,
  initial,
  onDone,
  onCancel,
  say,
}: {
  lead: SurplusPanelLead;
  team: any[];
  currentUser: any;
  initial: { taskId: string; title: string; due: string | null; userId: string | null } | null;
  onDone: () => void;
  onCancel: () => void;
  say: (msg: string) => void;
}) {
  const toLocal = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [title, setTitle] = useState(initial?.title || '');
  const [due, setDue] = useState(initial ? toLocal(initial.due) : tomorrowNine());
  const [userId, setUserId] = useState(initial?.userId || lead.ownerId || currentUser?.id || '');
  const [busy, setBusy] = useState(false);
  const picks = quickDueDates();

  const save = async () => {
    if (!title.trim() || !due || busy) return;
    setBusy(true);
    try {
      await surplusAPI.setNextAction(lead.id, {
        title: title.trim(),
        dueDate: new Date(due).toISOString(),
        userId: userId || null,
        taskId: initial?.taskId || null,
      });
      say(initial ? 'Next action changed' : 'Next action set');
      onDone();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The next action could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 8, padding: 8, border: '1px solid var(--border2)', borderRadius: 8 }}>
      <input
        className="dc-input"
        placeholder="What happens next, e.g. Call the daughter and ask who is handling the estate"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        autoFocus
        aria-label="Next action"
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {picks.map((p) => (
          <button key={p.label} type="button" className={`dc-wp-mini${due === p.value ? ' on' : ''}`} onClick={() => setDue(p.value)}>
            {p.label}
          </button>
        ))}
        <input className="dc-input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" style={{ width: 'auto' }} />
        <select className="dc-wp-sel" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Whose action" style={{ padding: '5px 8px' }}>
          <option value="">Anyone</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              {`${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="dc-wp-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="dc-wp-btn on" onClick={save} disabled={busy || !title.trim() || !due}>
          Save
        </button>
      </div>
    </div>
  );
}

const QUESTION_TONE: Record<CaseQuestion['state'], string> = {
  known: 'var(--mint)',
  unknown: 'var(--amber)',
  problem: 'var(--red)',
};

/** Suggestions somebody dismissed on this case, kept per browser. A convenience, so a lost list is harmless. */
function useDismissed(leadId: string) {
  const key = `dc-surplus-dismissed:${leadId}`;
  const read = useCallback((): string[] => {
    try {
      return JSON.parse(window.localStorage.getItem(key) || '[]');
    } catch {
      return [];
    }
  }, [key]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => setDismissed(read()), [read]);
  const dismiss = (k: string) => {
    const next = Array.from(new Set([...dismissed, k]));
    setDismissed(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage blocked: the dismissal lasts until the panel closes.
    }
  };
  return { dismissed, dismiss };
}

/**
 * The four open questions, answered in any order, and up to three
 * suggestions when no next action is set.
 *
 * The answers come from the API, read off what the case already has. They
 * replace the progress circles: nothing here is a step to tick in order.
 * Where a person decides, the answer is a real switch.
 */
function CaseQuestions({
  lead,
  property,
  currentUser,
  onOpenPeople,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  property: any;
  currentUser: any;
  onOpenPeople: () => void;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const { dismissed, dismiss } = useDismissed(lead.id);
  const questions = lead.questions || [];
  const suggestions = (lead.suggestions || []).filter((s) => !dismissed.includes(s.key));
  const hasPeople = (lead.heirCount || 0) + (lead.associateCount || 0) > 0;

  const flipPerson = async () => {
    setBusy(true);
    try {
      await surplusAPI.update(lead.id, { entitlementVerified: !lead.entitlementVerified });
      say(lead.entitlementVerified ? 'Right person: not confirmed' : 'Right person confirmed');
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  /** The rules' pause: aside for about six months, back on its own. */
  const pause = async () => {
    const offer = lead.pauseOffer;
    if (!offer) return;
    setBusy(true);
    try {
      await surplusAPI.hold(
        lead.id,
        true,
        `${offer.days} days of full effort, nobody reached`,
        String(offer.until).slice(0, 10),
      );
      say(`${lead.claimant} paused until ${fmtDay(offer.until)}. It comes back on its own then.`);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The file could not be paused.');
    } finally {
      setBusy(false);
    }
  };

  const take = async (text: string) => {
    setBusy(true);
    try {
      await surplusAPI.setNextAction(lead.id, {
        title: text,
        dueDate: new Date(tomorrowNine()).toISOString(),
        userId: lead.ownerId || currentUser?.id || null,
      });
      say('Next action set, due tomorrow');
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The next action could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const extra = (q: CaseQuestion) => {
    if (q.key === 'money' && property.sourceUrl) {
      return (
        <a href={property.sourceUrl} target="_blank" rel="noopener noreferrer" className="dc-wp-link">
          open at the clerk
        </a>
      );
    }
    if (q.key === 'person') {
      return (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!lead.entitlementVerified} disabled={busy} onChange={flipPerson} style={{ accentColor: 'var(--mint)' }} />
          Confirmed
        </label>
      );
    }
    if ((q.key === 'signer' || q.key === 'reach') && (hasPeople || lead.isDeceased)) {
      return (
        <button type="button" className="dc-wp-mini" onClick={onOpenPeople}>
          People
        </button>
      );
    }
    return null;
  };

  if (!questions.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="dc-wp-questions">
        {questions.map((q) => (
          <div key={q.key} className={`dc-wp-q ${q.state}`}>
            <div className="dc-lbl">{q.label}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: QUESTION_TONE[q.state], marginTop: 3 }}>{q.answer}</div>
            {q.detail && <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>{q.detail}</div>}
            {extra(q) && <div style={{ fontSize: 11.5, marginTop: 5 }}>{extra(q)}</div>}
          </div>
        ))}
      </div>
      {/* The pause offer shows even with a next action set: it is the
          decision the file is waiting on, not another thing to do. */}
      {(!lead.nextTask || suggestions.some((s) => s.key === 'pause')) && suggestions.length > 0 && (
        <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          <div className="dc-lbl">{lead.nextTask ? 'Suggested' : 'Suggested, no next action set'}</div>
          {suggestions.map((s) => (
            <div key={s.key} className="dc-wp-suggest">
              <span style={{ flex: 1, minWidth: 0 }}>{s.text}</span>
              {s.key === 'pause' ? (
                <button type="button" className="dc-wp-mini on" disabled={busy} onClick={pause}>
                  Pause until {lead.pauseOffer ? fmtDay(lead.pauseOffer.until) : 'later'}
                </button>
              ) : (
                <button type="button" className="dc-wp-mini on" disabled={busy} onClick={() => take(s.text)}>
                  Make it the next action
                </button>
              )}
              <button type="button" className="dc-wp-mini" onClick={() => dismiss(s.key)}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const DISCLOSURE_LABEL: Record<string, string> = {
  financial: 'Financial disclosure',
  noAttorneyNeeded: 'No attorney needed',
  allConsideration: 'All consideration stated',
};

/**
 * The qualification gate and the compliance gate, as switches a person
 * flips, with the rule that decides the fee cap shown beside them. These
 * used to live on the old card and had no home in the panel, which left the
 * Agreement Signed gate satisfiable by nobody. Nothing here is automatic:
 * each is a fact somebody has checked.
 */
function QualificationSection({
  lead,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const flip = async (key: string, patch: any, label: string) => {
    setBusy(key);
    try {
      await surplusAPI.update(lead.id, patch);
      say(label);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setBusy(null);
    }
  };
  const Toggle = ({
    on,
    label,
    keyName,
    patch,
    note,
  }: {
    on: boolean;
    label: string;
    keyName: string;
    patch: any;
    note?: string;
  }) => (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={on}
        disabled={busy === keyName}
        onChange={() => flip(keyName, patch, `${label}: ${on ? 'cleared' : 'checked'}`)}
        style={{ marginTop: 3, accentColor: 'var(--mint)' }}
      />
      <span>
        <span style={{ fontWeight: 600, color: on ? 'var(--mint)' : 'inherit' }}>{label}</span>
        {note && <span style={{ display: 'block', fontSize: 11, color: 'var(--faint)' }}>{note}</span>}
      </span>
    </label>
  );
  const rule = lead.compliance?.rule || null;
  const disclosures = lead.disclosures || {};
  const talking = STAGE_ORDER.indexOf(lead.stage) >= 1;
  return (
    <Section
      title="Checks"
      note={lead.compliance?.blocks?.length ? 'Agreement not yet allowed' : 'Agreement allowed'}
    >
      <Toggle
        on={!!lead.entitlementVerified}
        label="Right person confirmed"
        keyName="entitlementVerified"
        patch={{ entitlementVerified: !lead.entitlementVerified }}
        note="The claimant is who the clerk noticed, and nobody else has a better claim."
      />
      <Toggle
        on={!!lead.noticeConfirmed}
        label="Notice date confirmed with the clerk"
        keyName="noticeConfirmed"
        patch={{ noticeConfirmed: !lead.noticeConfirmed }}
        note="The claim window runs from the mailed notice, not the sale. Until confirmed the countdown is a guess."
      />
      <Toggle
        on={!!lead.titleSearchComplete}
        label="Title search complete"
        keyName="titleSearchComplete"
        patch={{ titleSearchComplete: !lead.titleSearchComplete }}
        note="Every lien on the waterfall is known, so the net to the claimant is real."
      />
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', letterSpacing: 0.3, marginTop: 6 }}>
        Disclosures in the agreement
      </div>
      {(rule?.requiredDisclosures || Object.keys(DISCLOSURE_LABEL)).map((k) => (
        <Toggle
          key={k}
          on={!!disclosures[k]}
          label={DISCLOSURE_LABEL[k] || k}
          keyName={`disclosure:${k}`}
          patch={{ disclosures: { [k]: !disclosures[k] } }}
        />
      ))}
      {/* The fee cap and its statute belong to the agreement, so they show
          once somebody is talking to the claimant and not before. */}
      {talking && rule && (
        <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 4 }}>
          {rule.feeCap != null
            ? `Legal cap: ${rule.feeCap}% of total consideration${rule.capConfidence !== 'confirmed' ? ` (${rule.capConfidence})` : ''}. The agreement's schedule is reduced to it.`
            : rule.capConfidence === 'none'
              ? `No statutory cap while the clerk holds these funds; the agreement's schedule applies (${SURPLUS_FEE_SCHEDULE_LABEL}). Counsel confirmation pending.`
              : 'No cap confirmed, so no agreement can go out.'}{' '}
          {rule.statuteRefs?.join(', ')}.
        </div>
      )}
      {talking && lead.compliance?.blocks?.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--red)' }}>
          Stops the agreement: {lead.compliance.blocks.join('; ')}.
        </div>
      )}
      {talking && lead.compliance?.warns?.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>{lead.compliance.warns.join('; ')}.</div>
      )}
    </Section>
  );
}

/**
 * Tapped or not, and which channels have been tried. Both derived: tapped is
 * stamped by the channel that heard from the claimant, and a channel counts
 * as tried when its own record exists, so nothing here can be ticked by hand
 * and drift from what actually went out.
 */
function ContactLine({ lead }: { lead: SurplusPanelLead }) {
  const status = lead.contactStatus || 'not_tapped';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, marginTop: 4 }}>
      <span style={{ fontWeight: 700, color: CONTACT_TONE[status] }}>
        {CONTACT_LABEL[status]}
        {lead.tappedAt ? ` ${fmtDate(lead.tappedAt)}` : ''}
      </span>
      <span style={{ display: 'inline-flex', gap: 6 }} title="Called, texted, emailed, lettered, messaged on social">
        {CHANNEL_GLYPH.map(([k, glyph, label]) => {
          const on = !!lead.channels?.[k];
          return (
            <span
              key={k}
              title={on ? `${label}` : `Not yet ${label.toLowerCase()}`}
              style={{
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 4,
                background: on ? 'var(--mintGhost)' : 'var(--surface3)',
                color: on ? 'var(--mint)' : 'var(--faint)',
                textDecoration: on ? 'none' : 'line-through',
              }}
            >
              {glyph} {label}
            </span>
          );
        })}
      </span>
    </div>
  );
}

/**
 * The Instant Credibility packet from the panel: website, Sunbiz filing,
 * one-pager and callback number, by text or email, as Dig Deeper. Shows when
 * it last went out so a follow-up call does not send the same links twice,
 * and stays disabled with the reason until the links are configured.
 */
function CredibilityBlock({
  lead,
  say,
  onChanged,
}: {
  lead: SurplusPanelLead;
  say: (msg: string) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<{ ready: boolean; missing: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    surplusAPI
      .credibilityStatus()
      .then((r) => setStatus(r.data || null))
      .catch(() => setStatus({ ready: false, missing: ['status unavailable'] }));
  }, []);

  const phone = lead.phones.find((p) => !p.dnc && !p.bad)?.number || null;
  const email = lead.emails[0] || null;

  const send = async (channel: 'sms' | 'email') => {
    setBusy(channel);
    try {
      const r = await surplusAPI.sendCredibility(lead.id, {
        channels: [channel],
        phone: channel === 'sms' ? phone : undefined,
        email: channel === 'email' ? email : undefined,
      });
      say(
        `Credibility packet sent by ${channel === 'sms' ? 'text' : 'email'}.` +
          (r.data?.errors?.length ? ` ${r.data.errors.join(' ')}` : ''),
      );
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The packet could not be sent.');
    } finally {
      setBusy(null);
    }
  };

  const ready = !!status?.ready;
  // The API names the missing settings. On screen they read as what they
  // are, not as environment variables.
  const plain = (k: string) =>
    /WEBSITE/i.test(k) ? 'the website link' : /SUNBIZ/i.test(k) ? 'the Sunbiz filing link' : /ONEPAGER/i.test(k) ? 'the one-pager link' : k.toLowerCase().replace(/_/g, ' ');
  const why = status
    ? `Packet links are not set up yet: ${status.missing.map(plain).join(', ')}. Add them in the API settings.`
    : 'Checking...';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '7px 10px',
        marginBottom: 8,
        borderRadius: 6,
        background: 'var(--bg2)',
        fontSize: 12,
      }}
    >
      <span style={{ fontWeight: 700 }}>Credibility packet</span>
      {lead.credibilitySentAt ? (
        <span style={{ color: 'var(--mint)' }}>
          sent {fmtDate(lead.credibilitySentAt)}
          {lead.credibilityChannels?.length
            ? ` by ${lead.credibilityChannels.map((c) => (c === 'sms' ? 'text' : 'email')).join(' and ')}`
            : ''}
        </span>
      ) : (
        <span style={{ color: 'var(--faint)' }}>not sent yet</span>
      )}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
        <button
          type="button"
          className="dc-wp-btn"
          disabled={!ready || !phone || !!busy || lead.doNotCall}
          onClick={() => send('sms')}
          title={!ready ? why : !phone ? 'No callable number' : 'Text the website, Sunbiz filing, one-pager and callback number'}
        >
          {busy === 'sms' ? 'Sending...' : 'Text packet'}
        </button>
        <button
          type="button"
          className="dc-wp-btn"
          disabled={!ready || !email || !!busy || lead.doNotCall}
          onClick={() => send('email')}
          title={!ready ? why : !email ? 'No email on file' : 'Email the packet'}
        >
          {busy === 'email' ? 'Sending...' : 'Email packet'}
        </button>
      </span>
      {status && !ready && (
        <div style={{ flexBasis: '100%', fontSize: 11, color: 'var(--faint)' }}>{why}</div>
      )}
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.3 }}>{title}</div>
        {note && <div style={{ fontSize: 11, color: 'var(--faint)' }}>{note}</div>}
      </div>
      <div style={{ display: 'grid', gap: 4 }}>{children}</div>
    </div>
  );
}

function Row({
  k,
  v,
  note,
  tone,
}: {
  k: string;
  v: string;
  note?: string;
  tone?: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
        <span style={{ color: 'var(--dim)' }}>{k}</span>
        <span style={{ color: tone || 'inherit', fontWeight: 600 }}>{v}</span>
      </div>
      {note && (
        <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 1 }}>{note}</div>
      )}
    </div>
  );
}

/**
 * "deceased", or "died Mar 2021 per Endato" when a people search set the flag.
 * A vendor death record can belong to a namesake, so the card names its
 * source; the flag is unticked in Edit if the family says otherwise.
 */
function deathLabel(lead: { dateOfDeath?: string | null; deathSource?: string | null }): string {
  const vendor =
    lead.deathSource === 'endato'
      ? 'Endato'
      : lead.deathSource === 'batchdata'
        ? 'BatchData'
        : lead.deathSource === 'obituary'
          ? 'obituary'
          : lead.deathSource === 'idi'
            ? 'IDI'
            : null;
  if (!vendor) return 'deceased';
  const d = lead.dateOfDeath ? new Date(`${lead.dateOfDeath}T12:00:00Z`) : null;
  const when = d && !isNaN(d.getTime())
    ? `died ${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`
    : 'deceased';
  return `${when} per ${vendor}`;
}


/**
 * The obituary search found an obituary that may be this claimant's. Shown
 * above the tabs so nobody dials before looking: Confirm marks them dead and
 * files the spouse and children it names; Not them clears the warning.
 */
function PossibleObituary({ lead, onChanged }: { lead: any; onChanged: () => void }) {
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const o = lead.obituary || {};
  const answer = async (a: 'confirm' | 'reject') => {
    setBusy(a);
    setError(null);
    try {
      await surplusAPI.resolveObituary(lead.id, a);
      onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not save that');
    } finally {
      setBusy(null);
    }
  };
  const when = o.dateOfDeath
    ? new Date(`${o.dateOfDeath}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : null;
  return (
    <div className="dc-wp-banner amber" style={{ marginTop: 12 }}>
      <div className="head">Possible obituary, check before calling</div>
      <div className="text">
        {o.nameInObituary || lead.claimant}
        {when ? `, died ${when}` : ''}
        {o.place ? `, ${o.place}` : ''}. {o.evidence}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {o.url && (
          <a href={o.url} target="_blank" rel="noopener noreferrer" className="dc-wp-btn on">
            Read the obituary
          </a>
        )}
        <button type="button" className="dc-wp-btn" disabled={!!busy} onClick={() => answer('confirm')}>
          {busy === 'confirm' ? 'Saving...' : 'It is them, mark deceased'}
        </button>
        <button type="button" className="dc-wp-btn" disabled={!!busy} onClick={() => answer('reject')}>
          {busy === 'reject' ? 'Saving...' : 'Not them'}
        </button>
      </div>
      {error && <div className="text" style={{ color: 'var(--red)' }}>{error}</div>}
    </div>
  );
}
