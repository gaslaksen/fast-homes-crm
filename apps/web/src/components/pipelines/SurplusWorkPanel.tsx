'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import CommunicationsTimeline from '@/components/communications/CommunicationsTimeline';
import MessageComposer, { type EmailAction } from '@/components/communications/MessageComposer';
import NotesPanel from '@/components/communications/NotesPanel';
import type { NoteItem, TimelineItem } from '@/components/communications/types';
import { authAPI, campaignsAPI, leadsAPI, surplusAPI, tasksAPI } from '@/lib/api';
import { dueLabel, isOverdue, quickDueDates } from '@/lib/dates';
import { SURPLUS_DEAD_REASONS, deadReasonLabel } from '@/lib/surplus-dead';
import { SURPLUS_EXPENSE_KINDS, expenseLabel, usd } from '@/lib/surplus-money';
import { SURPLUS_TRACE_CHANNELS, SURPLUS_TIER1_CHANNELS, TRACE_RESULTS, channelForSite, traceChannelLabel } from '@/lib/surplus-trace';
import { useDialer } from '@/components/dialer/DialerContext';
import { DNC_STATE, SURPLUS_STAGES } from './format';
import ContactEditor from './ContactEditor';
import SurplusHeirs, { courtRecordsSearch } from './SurplusHeirs';
import { Fold, useFolds } from './PanelFold';
import { fmtDate, money, phoneDisplay } from './format';

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

type Tab = 'case' | 'conversation' | 'notes';

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
  phones: { number: string; type: string | null; dnc: string | null }[];
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
  doNotCall: boolean;
  isDeceased: boolean;
  totalTouches: number;
  /** One of us mailed a letter. Date and the address on the envelope. */
  letterMailedAt: string | null;
  letterMailedTo: string | null;
  /** 'not_tapped' | 'tapped' | 'recap_scheduled', from the channels that heard from them. */
  contactStatus: string;
  tappedAt: string | null;
  /** Which of the four channels have been tried, off the records themselves. */
  channels: { called: boolean; texted: boolean; emailed: boolean; lettered: boolean };
  channelsMissing: string[];
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
  }[];
  letterCount: number;
  /** 7 or 14. */
  letterCadenceDays: number;
  letterDueAt: string | null;
  letterDue: boolean;
  /** Three standard letters unanswered: send the next by Priority or FedEx. */
  escalateMail: boolean;
  /** Heirs on file, for addressing a letter. Same shape the heirs panel uses. */
  heirs: { id: string; name: string; address: string | null; deceased: boolean }[];
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
    feePercent: number | null;
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
  } | null;
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
  const [feePct, setFeePct] = useState(m.feePercent != null ? String(m.feePercent) : '');
  const [expKind, setExpKind] = useState('title_search');
  const [expAmount, setExpAmount] = useState('');
  const [expNote, setExpNote] = useState('');
  const [sentAt, setSentAt] = useState(m.checkSentAt ? m.checkSentAt.slice(0, 10) : '');
  const [sentMethod, setSentMethod] = useState(m.checkSentMethod || 'usps');
  const [sentTracking, setSentTracking] = useState(m.checkSentTrackingNumber || '');

  useEffect(() => {
    setReceivedAt(m.checkReceivedAt ? m.checkReceivedAt.slice(0, 10) : '');
    setAmount(m.checkAmount != null ? String(m.checkAmount) : '');
    setFeePct(m.feePercent != null ? String(m.feePercent) : '');
    setSentAt(m.checkSentAt ? m.checkSentAt.slice(0, 10) : '');
    setSentMethod(m.checkSentMethod || 'usps');
    setSentTracking(m.checkSentTrackingNumber || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, m.checkReceivedAt, m.checkAmount, m.feePercent, m.checkSentAt]);

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
        <label style={lbl}>
          Fee %{m.capPct != null ? `, cap ${m.capPct}` : ''}
          <input style={field} value={feePct} disabled={m.frozen} placeholder={m.capPct != null ? String(m.capPct) : ''} onChange={(e) => setFeePct(e.target.value)} />
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
        <Row k={`Fee at ${m.feePercent ?? 0}%`} v={usd(m.fee)} />
        <Row k={m.expensesFromClaimantShare ? 'Expenses, from the claimant' : 'Expenses, borne by us'} v={usd(m.expensesTotal)} />
        <Row k={`To ${lead.claimant}`} v={usd(m.claimantShare)} tone="var(--mint)" />
        <Row k="Company share" v={usd(m.companyShare)} />
        <Row k="Company net after expenses" v={usd(m.companyNet)} tone={m.companyNet < 0 ? 'var(--red)' : undefined} />
        <div style={{ fontSize: 11, color: m.overCap ? 'var(--red)' : 'var(--faint)' }}>
          Total consideration {m.considerationPct}% of the check{m.capPct != null ? `, cap ${m.capPct}%` : ''}.
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
function CountySection({ lead }: { lead: SurplusPanelLead }) {
  const c = lead.countyInfo;
  const name = lead.county || 'this county';
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
      {(c.stale || !c.lastVerifiedAt) && (
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
}

export default function SurplusWorkPanel({
  property,
  currentUser,
  onPrev,
  onNext,
  position,
  onClose,
  onChanged,
  say,
}: Props) {
  const [tab, setTab] = useState<Tab>('case');
  /**
   * Which claimant's conversation is open. Shared facts (the property, the
   * money, the docket) belong to the case; the conversation, the notes and the
   * contacts belong to one person, because each claimant files their own claim.
   */
  const [claimantId, setClaimantId] = useState<string>(property.claimants[0]?.id);
  const lead: SurplusPanelLead =
    property.claimants.find((c: any) => c.id === claimantId) || property.claimants[0];

  // A refresh can reorder or replace claimants; keep the selection valid.
  useEffect(() => {
    if (!property.claimants.some((c: any) => c.id === claimantId)) {
      setClaimantId(property.claimants[0]?.id);
    }
  }, [property.claimants, claimantId]);
  const [comms, setComms] = useState<{ timeline: TimelineItem[]; notes: NoteItem[] }>({
    timeline: [],
    notes: [],
  });
  const [emailAction, setEmailAction] = useState<EmailAction | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [tracing, setTracing] = useState(false);
  /** Raised by clicking a number or an email, consumed by the composer. */
  const [composeIntent, setComposeIntent] = useState<any>(null);
  const dialer = useDialer();
  const [fullLead, setFullLead] = useState<any>(null);
  /** Needed by the composer for @mentions on internal comments. */
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const sigRef = useRef('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const sigOf = (t: TimelineItem[], n: NoteItem[]) =>
    `${t.length}:${t[t.length - 1]?.id ?? ''}|${n.length}:${n[n.length - 1]?.id ?? ''}`;

  const loadComms = useCallback(
    async (silent = false) => {
      try {
        const res = await leadsAPI.communications(lead.id);
        const timeline = res.data?.timeline || [];
        const notes = res.data?.notes || [];
        const sig = sigOf(timeline, notes);
        if (silent && sig === sigRef.current) return;
        sigRef.current = sig;
        setComms({ timeline, notes });
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
    sigRef.current = '';
    setFullLead(null);
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
    if (tab !== 'conversation') return;
    const t = setInterval(() => {
      if (!document.hidden) loadComms(true);
    }, CONV_POLL_MS);
    return () => clearInterval(t);
  }, [tab, loadComms]);

  useEffect(() => {
    if (tab === 'conversation') bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comms.timeline, tab]);

  useEffect(() => {
    authAPI
      .getTeam()
      .then((r) => setTeamMembers(r.data || []))
      .catch(() => {});
    campaignsAPI
      .list()
      .then((r) => setCampaigns(r.data?.filter?.((c: any) => c.isActive !== false) || r.data || []))
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

  const enroll = async (campaignId: string) => {
    if (!campaignId || enrolling) return;
    setEnrolling(true);
    try {
      await campaignsAPI.enroll(campaignId, lead.id);
      say('Enrolled in campaign');
      onChanged();
    } catch (e: any) {
      say(e?.response?.data?.message || 'Could not enrol this lead');
    } finally {
      setEnrolling(false);
    }
  };

  /**
   * Trace the PROPERTY address, which is where the clerk mailed the Notice of
   * Surplus Funds. The property has since sold at auction, so this often
   * returns the current occupant instead; the name check on the server
   * discards those rather than attaching a stranger's number to the claimant.
   */
  const trace = async () => {
    if (tracing) return;
    setTracing(true);
    try {
      const res = await surplusAPI.skipTrace({ leadIds: [lead.id] });
      const d = res.data || {};
      if (d.contacted) say('Skip trace found contacts');
      else if (d.mismatched) say('Skip trace returned somebody else, so nothing was attached');
      else say(d.message || 'Skip trace found nothing at that address');
      onChanged();
    } catch (e: any) {
      say(e?.response?.data?.message || 'Skip trace failed');
    } finally {
      setTracing(false);
    }
  };

  /**
   * Cheapest first. A paid credit before any free route is logged is the
   * thing the course's escalation rule exists to stop, so the button asks.
   */
  const traceGated = () => {
    if (
      !lead.tracing?.tier1Done &&
      !window.confirm(
        `No free search has been logged for ${lead.claimant} yet. The course says Google, social and the county records come before a paid database. Spend the credit anyway?`,
      )
    ) {
      return;
    }
    trace();
  };

  /**
   * Call a number straight from the panel. The dialer is app-wide, so this is
   * the same call path as the lead page and the floating dialer, and the call
   * is attributed to this lead rather than appearing as an anonymous dial.
   */
  // leadSource tells the dialer's summary screen to offer the surplus
  // outcomes (spoke to claimant, message passed, already signed elsewhere)
  // instead of the wholesaling dispositions.
  const call = (number: string) =>
    dialer.startCall({ name: lead.claimant, phone: number, leadId: lead.id, leadSource: 'SURPLUS' });

  /** Open the conversation on SMS with this number already selected. */
  const message = (number: string) => {
    setComposeIntent({ nonce: Date.now(), channel: 'sms', to: number });
    setTab('conversation');
  };

  /** Open the conversation on email, addressed to this address. */
  const mail = (address: string) => {
    setComposeIntent({ nonce: Date.now(), channel: 'email', to: address });
    setEmailAction({ nonce: Date.now(), mode: 'reply', subject: '', bodyHtml: '', to: address });
    setTab('conversation');
  };

  const ledger = property.claimLedger || [];
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 17, fontWeight: 700 }}>{property.address}</span>
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
                <span className="dc-wp-stagepill" title="This claimant's stage">
                  <i />
                  {lead.stage}
                </span>
                {lead.doNotCall && (
                  <span style={{ fontSize: 11, color: 'var(--red)' }}>Do not call</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 3 }}>
                {[property.city, property.zip].filter(Boolean).join(' ')} ·{' '}
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

          <NextStepBanner
            lead={lead}
            property={property}
            onCall={call}
            onText={message}
            onTrace={traceGated}
            tracing={tracing}
          />

          {/* One property, several claims. Each claimant is contacted separately,
              so the conversation and notes tabs follow this selection. */}
          {/* Always shown, even for a single claimant. The NAME is what gets
              searched and traced, and burying it made it unclear whose result
              the panel below was showing. */}
          {property.claimants.length === 1 && (
            <div style={{ fontSize: 12.5, marginTop: 10, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <b style={lead.isDeceased ? { textDecoration: 'line-through' } : undefined}>{lead.claimant}</b>
              <span style={{ fontSize: 11.5, color: lead.isDeceased ? (lead.callableHeirCount > 0 ? 'var(--mint)' : 'var(--red)') : TRACE_TONE[lead.trace?.tone || 'idle'] }}>
                {lead.isDeceased
                  ? lead.callableHeirCount > 0
                    ? `deceased, ${lead.callableHeirCount} callable heir${lead.callableHeirCount === 1 ? '' : 's'}`
                    : lead.livingHeirCount > 0
                      ? `deceased, ${lead.livingHeirCount} heir${lead.livingHeirCount === 1 ? '' : 's'} on file, no number`
                      : 'deceased, no heirs on file'
                  : lead.phones.filter((p) => !p.dnc).length > 0
                    ? `${lead.phones.filter((p) => !p.dnc).length} callable number${lead.phones.filter((p) => !p.dnc).length === 1 ? '' : 's'}`
                    : lead.trace?.label || 'Never skip traced'}
              </span>
            </div>
          )}
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

          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            {(['case', 'conversation', 'notes'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`dc-wp-btn${tab === t ? ' on' : ''}`}
                onClick={() => setTab(t)}
                style={{ textTransform: 'capitalize' }}
              >
                {t}
                {t === 'conversation' && comms.timeline.length > 0 && ` (${comms.timeline.length})`}
              </button>
            ))}
          </div>
        </div>

        <div className="dc-wp-body">
          {tab === 'case' && (
            <CaseTab
              lead={lead}
              property={property}
              ledger={ledger}
              currentUser={currentUser}
              onTrace={traceGated}
              tracing={tracing}
              onCall={call}
              onText={message}
              onEmail={mail}
              onChanged={() => {
                onChanged();
                loadComms(true);
              }}
              say={say}
            />
          )}

          {tab === 'conversation' && (
            <div>
              {comms.timeline.length === 0 && (
                <div style={{ color: 'var(--faint)', fontSize: 13, padding: '8px 0 16px' }}>
                  No messages yet with {lead.claimant}.
                </div>
              )}
              <CommunicationsTimeline items={comms.timeline} onEmailAction={setEmailAction} />
              <div ref={bottomRef} />
            </div>
          )}

          {tab === 'notes' && (
            <NotesPanel
              notes={comms.notes}
              canAdd={!!currentUser}
              onAddNote={async (text) => {
                if (!currentUser?.id) return;
                await leadsAPI.addNote(lead.id, text, currentUser.id);
                await loadComms();
              }}
            />
          )}
        </div>

        {/* The composer on the conversation tab, actions everywhere else. */}
        <div className="dc-wp-foot">
          {tab === 'conversation' ? (
            fullLead ? (
              <MessageComposer
                leadId={lead.id}
                sellerPhone={fullLead.sellerPhone}
                sellerEmail={fullLead.sellerEmail}
                currentUser={currentUser}
                teamMembers={teamMembers}
                doNotContact={fullLead.doNotContact}
                emailAction={emailAction}
                composeIntent={composeIntent}
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
                onClick={() => setTab('conversation')}
              >
                Open conversation
              </button>
              <select
                className="dc-wp-sel"
                defaultValue=""
                disabled={enrolling || lead.doNotCall}
                onChange={(e) => {
                  enroll(e.target.value);
                  e.target.value = '';
                }}
                // Surplus outreach is regulated speech under FS 45.033, so
                // enrolment stays a deliberate act by a person rather than
                // something ingestion does on its own.
                title={
                  lead.doNotCall
                    ? 'This claimant is marked do not call'
                    : 'Add this claimant to a drip campaign'
                }
              >
                <option value="">Add to drip campaign...</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 12, color: 'var(--faint)', marginLeft: 'auto' }}>
                {lead.totalTouches} touch{lead.totalTouches === 1 ? '' : 'es'} logged
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

/** The job each back-half stage is doing, for the banner. */
const STAGE_JOB: Record<string, string> = {
  'Agreement Signed': 'Sign and notarize',
  'Package Notarized': 'File with the county',
  'Claim Filed': 'File with the county',
  'Awaiting Disbursement': 'Get paid',
  'Check Received': 'Get paid',
  Paid: 'Paid',
};

type FoldPlan = 'open' | 'done' | 'wait' | 'later';
type FoldKey = 'reach' | 'case' | 'qualify' | 'sign' | 'file' | 'paid';

/**
 * Which section is the work right now, which are finished, and which are not
 * yet possible.
 *
 * Read off the stage and the queue the API already sends on every row, so
 * nothing here is stored or configured. A New lead opens on its queue's
 * tools and never sees the notary; a lead at Agreement Signed opens on the
 * documents and the notary and finds the outreach folded with a check. Dead
 * reads like New: nothing later is possible, so nothing later is shown.
 */
function planFolds(lead: SurplusPanelLead): Record<FoldKey, FoldPlan> {
  const idx = STAGE_ORDER.indexOf(lead.stage);
  const i = idx < 0 ? 0 : idx;
  const replied = !!lead.tappedAt;
  return {
    reach: i >= 2 || replied ? 'done' : 'wait',
    case: 'wait',
    qualify: i >= 2 ? 'done' : i === 1 ? (replied ? 'open' : 'wait') : 'later',
    sign: i === 2 ? 'open' : i >= 3 ? 'done' : 'later',
    file: i === 3 || i === 4 ? 'open' : i >= 5 ? 'done' : 'later',
    paid: i >= 5 ? 'open' : 'later',
  };
}

/** Why a later section is folded away, in its own words. */
const LATER_NOTE: Record<FoldKey, string> = {
  reach: '',
  case: '',
  qualify: 'Opens once someone with standing has replied. The three checks and the disclosures live here.',
  sign: 'Opens at Agreement Signed: the document set, the notary and the attorney.',
  file: 'Opens at Package Notarized: how the package goes to the county and what the county says back.',
  paid: 'Opens when the county acknowledges the filing: the check, the expenses, the shares and the survey.',
};

const FOLD_TITLE: Record<FoldKey, string> = {
  reach: 'Reach the claimant',
  case: 'The case',
  qualify: 'Qualify the claim',
  sign: 'Sign and notarize',
  file: 'File with the county',
  paid: 'Get paid',
};

/** The channels tried, as a short list for a fold header. */
function channelsTried(lead: SurplusPanelLead): string[] {
  return CHANNEL_GLYPH.filter(([k]) => lead.channels?.[k]).map(([, , label]) => label.toLowerCase());
}

function CaseTab({
  lead,
  property,
  ledger,
  currentUser,
  onTrace,
  tracing,
  onCall,
  onText,
  onEmail,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  property: any;
  ledger: LedgerDoc[];
  currentUser: any;
  onTrace: () => void;
  tracing: boolean;
  onCall: (number: string) => void;
  onText: (number: string) => void;
  onEmail: (address: string) => void;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const { overrides, set } = useFolds(lead.id, lead.stage);
  const plan = planFolds(lead);
  const idx = STAGE_ORDER.indexOf(lead.stage);
  const back = idx >= 2;
  const dead = lead.stage === 'Dead';
  const queue: string = (lead as any).queue || property.queue || '';

  // Which tool belongs in Next step. Whatever is not the next step renders in
  // Reach, so every tool is on the panel exactly once.
  const front = !back && !dead;
  const inNext = {
    contacts: front && queue === 'call',
    heirs: front && queue === 'heirs',
    trace: front && queue === 'trace',
    search: front && (queue === 'name_search' || queue === 'entity'),
    letters: front && queue === 'mailed',
  };
  const showHeirs =
    lead.isDeceased || (lead.heirCount || 0) > 0 || (lead.associateCount || 0) > 0 || !lead.tappedAt;

  const heirsBlock = showHeirs && (
    <div>
      <SubHead
        title={lead.isDeceased ? 'Who inherited' : 'People around the claimant'}
        note={
          lead.isDeceased
            ? 'Only a living heir can file this claim'
            : lead.associateCount
              ? `${lead.associateCount} who may know where ${lead.claimant} is${lead.associatesUntried ? `, ${lead.associatesUntried} not yet contacted` : ''}`
              : 'A relative or a neighbor usually knows where they are'
        }
      />
      <SurplusHeirs
        leadId={lead.id}
        claimant={lead.claimant}
        claimantDeceased={!!lead.isDeceased}
        propertyAddress={property.address}
        county={property.county}
        courtRecordsUrl={lead.courtRecordsUrl}
        onCall={onCall}
        onText={onText}
        onEmail={onEmail}
        onChanged={onChanged}
        say={say}
      />
    </div>
  );
  const contactsBlock = (
    <ContactsBlock lead={lead} onCall={onCall} onText={onText} onEmail={onEmail} onChanged={onChanged} say={say} />
  );
  const traceBlock = lead.phones.length === 0 && <TraceBlock lead={lead} tracing={tracing} onTrace={onTrace} />;
  const searchBlock = lead.nameSearch && <NameSearchBlock lead={lead} property={property} say={say} onChanged={onChanged} />;
  const lettersBlock = (
    <div>
      <SubHead title="Letters" />
      <LetterHistory lead={lead} onChanged={onChanged} say={say} />
    </div>
  );

  // ── Header lines for the folded sections ────────────────────────────────
  const tried = channelsTried(lead);
  const reachStatus = [
    lead.tappedAt ? `Replied ${fmtDate(lead.tappedAt)}` : 'No reply yet',
    tried.length ? tried.join(', ') : 'nothing tried yet',
    lead.letterCount ? `${lead.letterCount} letter${lead.letterCount === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const caseStatus = [
    money(property.grossSurplus),
    property.saleDate ? `sold ${fmtDate(property.saleDate)}` : 'sale date unknown',
    property.noticeConfirmed ? 'notice confirmed' : 'notice date estimated',
  ].join(' · ');
  const checksDone = [lead.entitlementVerified, lead.noticeConfirmed, lead.titleSearchComplete].filter(Boolean).length;
  const qualifyStatus =
    plan.qualify === 'later'
      ? ''
      : `${checksDone} of 3 checks${lead.compliance?.blocks?.length && idx >= 1 ? ' · compliance blocked' : ''}`;
  const required = (lead.documents || []).filter((d) => d.required);
  const inHand = required.filter((d) => d.collected).length;
  const n = lead.notary || ({} as SurplusPanelLead['notary']);
  const signStatus =
    plan.sign === 'later'
      ? ''
      : [
          required.length ? `${inHand} of ${required.length} documents in hand` : null,
          n.signedInOrderAt ? `notarized ${fmtDate(n.signedInOrderAt)}` : n.appointmentAt ? 'notary booked' : null,
        ]
          .filter(Boolean)
          .join(' · ');
  const s = lead.submission || ({} as SurplusPanelLead['submission']);
  const fileStatus =
    plan.file === 'later'
      ? ''
      : s.countyAcknowledgedAt
        ? `Acknowledged ${fmtDate(s.countyAcknowledgedAt)}`
        : s.submittedAt
          ? `Submitted ${fmtDate(s.submittedAt)}, awaiting acknowledgement`
          : 'Not filed yet';
  const m = lead.disbursement || ({} as SurplusPanelLead['disbursement']);
  const paidStatus =
    plan.paid === 'later'
      ? ''
      : m.frozen
        ? `Paid ${fmtDate(m.checkSentAt)}`
        : m.checkReceivedAt
          ? `Check in hand ${fmtDate(m.checkReceivedAt)}`
          : "Waiting for the county's check";

  // ── The folds themselves ────────────────────────────────────────────────
  const bodies: Record<FoldKey, React.ReactNode> = {
    reach: (
      <>
        {!inNext.contacts && <CredibilityBlock lead={lead} say={say} onChanged={onChanged} />}
        <ContactLine lead={lead} />
        {!inNext.contacts && (
          <div>
            <SubHead
              title={`Reaching ${lead.claimant}`}
              note={lead.isDeceased ? 'Deceased. Their own contacts cannot sign anything.' : undefined}
            />
            {!inNext.trace && traceBlock}
            {contactsBlock}
          </div>
        )}
        {inNext.contacts && !inNext.trace && traceBlock}
        <SearchLog lead={lead} say={say} onChanged={onChanged} />
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
        {!inNext.letters && lettersBlock}
        {!inNext.heirs && heirsBlock}
        {!inNext.search && searchBlock}
      </>
    ),
    case: (
      <>
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
          {property.estFee != null && <Row k="Fee at the cap" v={money(property.estFee)} />}
        </div>
        <div>
          <SubHead title="The clock" />
          <Row
            k="Sale"
            v={
              property.saleDate
                ? `${fmtDate(property.saleDate)}${property.daysSinceSale != null ? ` (${property.daysSinceSale} days ago)` : ''}`
                : 'unknown'
            }
          />
          <Row
            k="Notice mailed"
            v={property.noticeDate ? fmtDate(property.noticeDate) : 'unknown'}
            note={
              property.noticeConfirmed
                ? undefined
                : 'Estimated from the sale date. Duval publishes no filing dates and its notice is a scan, so this is a floor, not a confirmed date.'
            }
          />
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
        {/* The two addresses are different things and the difference is the
            whole game. The property is where the tax deed sold; the mailing
            address is where the clerk actually wrote to the owner, and it is
            what gets traced. */}
        <div>
          <SubHead title="Addresses" />
          <Row k="Property that sold" v={[property.address, property.city, property.zip].filter(Boolean).join(', ')} />
          {lead.ownerMailingStreet ? (
            <Row
              k={`Where the clerk wrote to ${lead.noticeRecipient || lead.claimant}`}
              v={[
                lead.ownerMailingStreet,
                lead.ownerMailingCity,
                [lead.ownerMailingState, lead.ownerMailingZip].filter(Boolean).join(', ').replace(', ', ' '),
              ]
                .filter(Boolean)
                .join(', ')}
              tone="var(--mint)"
              note={
                lead.noticeRecipient && lead.noticeRecipient !== lead.claimant
                  ? `The notice names ${lead.noticeRecipient}, matched to this claimant. This is the address that gets skip traced.`
                  : 'This is the address that gets skip traced.'
              }
            />
          ) : (
            <Row
              k={`Where the clerk wrote to ${lead.claimant}`}
              v="not recovered"
              tone="var(--amber)"
              note={
                property.claimants.some((c: any) => c.ownerMailingStreet)
                  ? 'The notice was read for this case but no page was addressed to this claimant, so a trace here would fall back to the property address, which is usually not where they are.'
                  : 'The Notice of Surplus Funds has not been read for this case, so any trace falls back to the property address, which is usually not where the owner is.'
              }
            />
          )}
        </div>
        <CountySection lead={lead} />
        <DocketBlock property={property} ledger={ledger} />
      </>
    ),
    qualify: (
      <>
        <QualificationSection lead={lead} onChanged={onChanged} say={say} />
        {plan.qualify === 'later' && <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{LATER_NOTE.qualify}</div>}
      </>
    ),
    sign: (
      <>
        {plan.sign === 'later' && <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{LATER_NOTE.sign}</div>}
        <DocumentsSection lead={lead} onChanged={onChanged} say={say} />
        <NotarySection lead={lead} onChanged={onChanged} say={say} />
        <AttorneySection lead={lead} onChanged={onChanged} say={say} />
      </>
    ),
    file: (
      <>
        {plan.file === 'later' && <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{LATER_NOTE.file}</div>}
        <FilingSection lead={lead} onChanged={onChanged} say={say} />
      </>
    ),
    paid: (
      <>
        {plan.paid === 'later' && <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{LATER_NOTE.paid}</div>}
        <DisbursementSection lead={lead} onChanged={onChanged} say={say} />
        <SurveySection lead={lead} onChanged={onChanged} say={say} />
      </>
    ),
  };
  const status: Record<FoldKey, string> = {
    reach: reachStatus,
    case: caseStatus,
    qualify: qualifyStatus,
    sign: signStatus,
    file: fileStatus,
    paid: paidStatus,
  };

  const fold = (key: FoldKey) => {
    const state = plan[key] === 'later' ? 'wait' : plan[key];
    return (
      <Fold
        key={key}
        title={FOLD_TITLE[key]}
        status={status[key]}
        state={state}
        open={overrides[key] ?? state === 'open'}
        onToggle={(o) => set(key, o)}
      >
        {bodies[key]}
      </Fold>
    );
  };

  // The order: the work first, then what is waiting, then what is done with
  // the most recent on top, then the reference facts, then what is not yet
  // possible behind one line.
  const order: FoldKey[] = ['reach', 'qualify', 'sign', 'file', 'paid'];
  const open = order.filter((k) => plan[k] === 'open');
  const wait = order.filter((k) => plan[k] === 'wait');
  const done = order.filter((k) => plan[k] === 'done').reverse();
  const later = order.filter((k) => plan[k] === 'later');

  return (
    <div>
      <Fold title="Next step" status={dead ? 'Dead' : undefined} state="open" open={overrides.next ?? true} onToggle={(o) => set('next', o)}>
        {dead && lead.deadReason && (
          <div style={{ fontSize: 12, color: 'var(--red)' }}>
            Dead{lead.deadAt ? ` since ${fmtDate(lead.deadAt)}` : ''}: {deadReasonLabel(lead.deadReason)}
            {lead.deadNote ? <span style={{ color: 'var(--dim)' }}>. {lead.deadNote}</span> : null}
          </div>
        )}
        <TasksSection lead={lead} currentUser={currentUser} onChanged={onChanged} say={say} />
        {inNext.contacts && (
          <div>
            <SubHead title={`Reaching ${lead.claimant}`} />
            {contactsBlock}
            <div style={{ marginTop: 8 }}>
              <CredibilityBlock lead={lead} say={say} onChanged={onChanged} />
            </div>
          </div>
        )}
        {inNext.heirs && heirsBlock}
        {inNext.trace && (
          <div>
            <SubHead title={`Skip trace ${lead.claimant}`} />
            {traceBlock}
          </div>
        )}
        {inNext.search && searchBlock}
        {inNext.letters && lettersBlock}
      </Fold>

      {open.map(fold)}
      {wait.map(fold)}
      {done.map(fold)}
      {fold('case')}

      {later.length > 0 && (
        <details className="dc-fold-later">
          <summary>
            <b>Later steps ({later.length})</b>
            <span>{later.map((k) => FOLD_TITLE[k]).join(' · ')}</span>
          </summary>
          <div>{later.map(fold)}</div>
        </details>
      )}

      <StageControl lead={lead} onChanged={onChanged} say={say} />
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
          <div key={p.number} className="dc-wp-contact">
            <div className="dc-wp-contact-main">
              <span className="num">{phoneDisplay(p.number)}</span>
              <span className="meta">{p.type || 'Phone'}</span>
              {flag && <span className="flag">{flag.label}</span>}
            </div>
            <div className="dc-wp-contact-actions">
              <button type="button" className="dc-wp-btn" onClick={() => onCall(p.number)}>
                Call
              </button>
              <button type="button" className="dc-wp-btn" onClick={() => onText(p.number)}>
                Text
              </button>
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
function TraceBlock({ lead, tracing, onTrace }: { lead: SurplusPanelLead; tracing: boolean; onTrace: () => void }) {
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
        {/* Offered only when a submission could still tell us something.
            Re-running an address that already answered spends a credit to
            hear the same answer. */}
        <button
          type="button"
          className="dc-wp-btn"
          onClick={onTrace}
          disabled={tracing || lead.trace?.actionable === false}
          title={
            lead.trace?.actionable === false
              ? 'Already submitted. The same address returns the same answer; use the name search.'
              : undefined
          }
        >
          {tracing ? 'Tracing...' : `Skip trace ${lead.claimant}`}
        </button>
        {lead.trace?.actionable === false && (
          <span style={{ marginLeft: 8, fontSize: 11 }}>Already submitted, so this is spent. The route now is the name search.</span>
        )}
        <div style={{ marginTop: 4, fontSize: 11 }}>
          {lead.ownerMailingStreet
            ? `Traces ${lead.ownerMailingStreet}, ${lead.ownerMailingCity || ''} ${lead.ownerMailingState || ''}, the address the surplus notice was mailed to ${lead.noticeRecipient || lead.claimant}.`
            : `No owner address recovered for ${lead.claimant}, so this would trace the property at ${lead.address}, which is usually not where the owner is.`}
        </div>
      </div>
    </div>
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
 * The instruction at the top of the panel: what to do with this claimant,
 * in plain words, with the button that does it.
 *
 * On the front half it is the queue the API assigns and the reason it gives.
 * From Agreement Signed on it is the job the stage is doing and what the
 * next stage still needs. It replaces the "Rank 153.7" line, which was
 * auditable and not actionable; the rank still decides the board's order.
 */
function NextStepBanner({
  lead,
  property,
  onCall,
  onText,
  onTrace,
  tracing,
}: {
  lead: SurplusPanelLead;
  property: any;
  onCall: (number: string) => void;
  onText: (number: string) => void;
  onTrace: () => void;
  tracing: boolean;
}) {
  const idx = STAGE_ORDER.indexOf(lead.stage);
  const l = lead as any;
  const queue: string = l.queue || property.queue || '';
  const label: string = l.queueLabel || property.queueLabel || '';
  const reason: string = l.queueReason || property.queueReason || '';

  let tone = 'mint';
  let head = label;
  let text = reason;
  let actions: React.ReactNode = null;

  if (lead.stage === 'Dead') {
    tone = 'slate';
    head = 'Dead';
    text = lead.deadReason
      ? `${deadReasonLabel(lead.deadReason)}${lead.deadAt ? `, since ${fmtDate(lead.deadAt)}` : ''}.${lead.deadNote ? ` ${lead.deadNote}` : ''}`
      : 'Retired without a reason on file.';
  } else if (idx >= 2) {
    const next = nextGatedStage(lead.stage);
    const missing = next ? lead.stageBlocks?.[next] || [] : [];
    head = STAGE_JOB[lead.stage] || lead.stage;
    text = !next
      ? `Claim closed. ${lead.disbursement?.checkSentAt ? `${lead.claimant}'s check went out ${fmtDate(lead.disbursement.checkSentAt)}.` : ''}`
      : missing.length
        ? `${next} still needs ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.`
        : `Ready for ${next}. Everything it needs is in hand.`;
    if (lead.claimantUpdate?.overdue) {
      tone = 'amber';
      text += ` ${lead.claimant} is owed a monthly update, news or not.`;
    }
  } else {
    const phone = lead.phones.find((p) => !p.dnc)?.number || null;
    switch (queue) {
      case 'call':
        tone = 'mint';
        if (lead.isDeceased) {
          text = `${reason}. Work the heirs below; ${lead.claimant} cannot sign.`;
        } else if (phone) {
          text = `${reason}${lead.tappedAt ? '' : '. Nobody has heard back yet'}.`;
          actions = (
            <>
              <button type="button" className="dc-wp-btn on" onClick={() => onCall(phone)}>
                Call {phoneDisplay(phone)}
              </button>
              <button type="button" className="dc-wp-btn" onClick={() => onText(phone)}>
                Text
              </button>
            </>
          );
        }
        break;
      case 'heirs':
        tone = 'red';
        text = `${lead.claimant} is deceased and no living heir is on file. Only a living heir can sign, so a phone number for the claimant is worth nothing yet. Find the probate case and read the petition.`;
        actions = (
          <a
            href={lead.courtRecordsUrl || courtRecordsSearch(property.county)}
            target="_blank"
            rel="noopener noreferrer"
            className="dc-wp-btn on"
          >
            Open {property.county || 'county'} court records
          </a>
        );
        break;
      case 'trace':
        tone = 'amber';
        actions = (
          <button type="button" className="dc-wp-btn on" onClick={onTrace} disabled={tracing || lead.trace?.actionable === false}>
            {tracing ? 'Tracing...' : `Skip trace ${lead.claimant}`}
          </button>
        );
        break;
      case 'name_search':
      case 'entity': {
        tone = 'amber';
        const first = lead.nameSearch?.links?.[0];
        if (first) {
          actions = (
            <a href={first.url} target="_blank" rel="noopener noreferrer" className="dc-wp-btn on">
              Search {first.site}
            </a>
          );
        }
        break;
      }
      case 'mailed':
        tone = 'slate';
        text = `${reason}. ${lead.letterDue ? 'The next letter is due.' : lead.letterDueAt ? `Next letter due ${fmtDate(lead.letterDueAt)}.` : ''}`;
        break;
      default:
        tone = 'slate';
    }
  }

  return (
    <div className={`dc-wp-banner ${tone}`}>
      <div className="head">{head}</div>
      {text && <div className="text">{text}</div>}
      {actions && <div className="acts">{actions}</div>}
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
          href={`https://taxdeed.duvalclerk.com${doc.url}`}
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
  ]
    .filter(Boolean)
    .join(', ');
  const livingHeirs = (lead.heirs || []).filter((h) => !h.deceased);

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
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
    setDate(new Date().toISOString().slice(0, 10));
    setWriteTo('claimant');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  // The recipient picks the envelope address: an heir's is their own, off the
  // filing, and must never default to the dead claimant's.
  useEffect(() => {
    if (recipient === 'claimant') setAddress(onFile);
    else {
      const h = livingHeirs.find((x) => x.id === recipient);
      setAddress(h?.address || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipient]);

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
              </span>
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
            <input type="date" style={field} value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
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
    load();
  }, [load]);

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
 * Where this claimant's claim stands, and the one place to move it.
 *
 * Per claimant, not per property: each person files their own claim and
 * signs their own agreement, so one co-owner can be at Agreement Signed while
 * the other is still unreached. The API refuses Agreement Signed until the
 * qualification gate is met and says which item is missing, and that message
 * is shown as is rather than paraphrased.
 */
function StageControl({
  lead,
  onChanged,
  say,
}: {
  lead: SurplusPanelLead;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [deadOpen, setDeadOpen] = useState(false);
  const [deadReason, setDeadReason] = useState('');
  const [deadNote, setDeadNote] = useState('');
  const [deadOverride, setDeadOverride] = useState(false);
  const stages = SURPLUS_STAGES.concat('Dead');
  // The effort gate: "unresponsive" is a claim about the work done, and the
  // panel knows what is still missing before the button is pressed.
  const gateMissing = deadReason === 'unresponsive' ? lead.deadGateMissing || [] : [];
  const gateBlocks = gateMissing.length > 0 && !(deadOverride && deadNote.trim());

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
    // Dead needs a reason, so it opens a form instead of a confirm.
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

  return (
    <Section title="Stage" note="This claimant only">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select
          className="dc-wp-sel"
          value={lead.stage}
          disabled={saving}
          onChange={(e) => {
            const next = e.target.value;
            // Reset so a refused move leaves the select on the real stage.
            e.target.value = lead.stage;
            move(next);
          }}
          aria-label="Stage"
        >
          {stages.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {lead.stage === 'Dead' && lead.deadReason && (
        <div style={{ fontSize: 12, color: 'var(--red)' }}>
          Dead{lead.deadAt ? ` since ${fmtDate(lead.deadAt)}` : ''}: {deadReasonLabel(lead.deadReason)}
          {lead.deadNote ? <span style={{ color: 'var(--dim)' }}>. {lead.deadNote}</span> : null}
        </div>
      )}
      {deadOpen && (
        <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--red)', borderRadius: 8 }}>
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
      )}
      <StageGateHint lead={lead} />
    </Section>
  );
}

/** The next gated stage after the current one, or null past Claim Filed. */
function nextGatedStage(stage: string): string | null {
  const order = ['New', 'Contacted', 'Agreement Signed', 'Package Notarized', 'Claim Filed', 'Awaiting Disbursement'];
  const gated = ['Agreement Signed', 'Package Notarized', 'Claim Filed', 'Awaiting Disbursement'];
  const idx = order.indexOf(stage);
  if (idx < 0) return null;
  return gated.find((g) => order.indexOf(g) > idx) || null;
}

/**
 * What the next stage still needs, as a checklist rather than a sentence.
 * The list comes from the same function the API refuses with, so the panel
 * and the refusal can never disagree. Three items show; the rest fold, so a
 * New lead is not read a paragraph about a filing months away.
 */
function StageGateHint({ lead }: { lead: SurplusPanelLead }) {
  const next = nextGatedStage(lead.stage);
  if (!next) return null;
  const missing = lead.stageBlocks?.[next] || [];
  if (!missing.length) {
    return (
      <div className="dc-wp-gate">
        <div className="lead">
          Next: <b>{next}</b>
        </div>
        <div style={{ color: 'var(--mint)' }}>Ready. Everything it needs is in hand.</div>
      </div>
    );
  }
  const shown = missing.slice(0, 3);
  const rest = missing.slice(3);
  return (
    <div className="dc-wp-gate">
      <div className="lead">
        Next: <b>{next}</b> still needs
      </div>
      {shown.map((m) => (
        <div key={m} className="item">
          <span className="box" aria-hidden="true" />
          {m}
        </div>
      ))}
      {rest.length > 0 && (
        <details>
          <summary>and {rest.length} more</summary>
          {rest.map((m) => (
            <div key={m} className="item">
              <span className="box" aria-hidden="true" />
              {m}
            </div>
          ))}
        </details>
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
          Fee cap: {rule.feeCap != null ? `${rule.feeCap}% of total consideration` : 'none confirmed, so no agreement can go out'}
          {rule.capConfidence !== 'confirmed' ? ` (${rule.capConfidence})` : ''}. {rule.statuteRefs?.join(', ')}.
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
      <span style={{ display: 'inline-flex', gap: 6 }} title="Called, texted, emailed, lettered">
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

  const phone = lead.phones.find((p) => !p.dnc)?.number || null;
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
