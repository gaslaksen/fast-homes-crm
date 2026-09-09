'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import CommunicationsTimeline from '@/components/communications/CommunicationsTimeline';
import MessageComposer, { type EmailAction } from '@/components/communications/MessageComposer';
import NotesPanel from '@/components/communications/NotesPanel';
import type { NoteItem, TimelineItem } from '@/components/communications/types';
import { authAPI, campaignsAPI, leadsAPI, surplusAPI, tasksAPI } from '@/lib/api';
import { dueLabel, isOverdue, quickDueDates } from '@/lib/dates';
import { useDialer } from '@/components/dialer/DialerContext';
import { DNC_STATE, SURPLUS_STAGES } from './format';
import ContactEditor from './ContactEditor';
import SurplusHeirs from './SurplusHeirs';
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
  not_tapped: 'Not tapped',
  tapped: 'Tapped',
  recap_scheduled: 'Recap scheduled',
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

          {/* Why this lead sits where it does. The ranking has to be auditable. */}
          <div
            style={{
              marginTop: 10,
              padding: '7px 10px',
              borderRadius: 6,
              background: 'var(--bg2)',
              fontSize: 12,
              color: 'var(--dim)',
            }}
          >
            <strong style={{ color: tone }}>Rank {property.workScore}</strong> {property.workReason}
          </div>

          {/* One property, several claims. Each claimant is contacted separately,
              so the conversation and notes tabs follow this selection. */}
          {/* Always shown, even for a single claimant. The NAME is what gets
              searched and traced, and burying it made it unclear whose result
              the panel below was showing. */}
          {property.claimants.length > 0 && (
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
              onTrace={trace}
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
  /** The contact editor is opt-in, so the panel stays readable when reading. */
  const [editing, setEditing] = useState(false);
  const grouped = LEDGER_GROUPS.map((g) => ({
    ...g,
    docs: ledger.filter((d) => d.kind === g.kind),
  })).filter((g) => g.docs.length > 0);

  const other = ledger.filter(
    (d) => !LEDGER_GROUPS.some((g) => g.kind === d.kind),
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <StageControl lead={lead} onChanged={onChanged} say={say} />

      <TasksSection lead={lead} currentUser={currentUser} onChanged={onChanged} say={say} />

      <Section title="The money">
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
      </Section>

      <Section title="The clock">
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
            k="Lien window"
            v={
              property.daysRemaining > 0
                ? `${property.daysRemaining} days left`
                : `closed ${Math.abs(property.daysRemaining)} days ago`
            }
            note="Whether another lienholder can still appear and shrink the payout. A previous owner is not barred by it."
          />
        )}
      </Section>

      {/* The two addresses are different things and the difference is the whole
          game. The property is where the tax deed sold; the mailing address is
          where the clerk actually wrote to the owner, and it is what gets
          traced. On case 2025-0023TD those are Jacksonville and Hartford. */}
      <Section title="Addresses">
        <Row k="Property that sold" v={[property.address, property.city, property.zip].filter(Boolean).join(', ')} />
        {/* Per CLAIMANT, not per property. The clerk prints one notice page per
            recipient and co-owners are frequently at different addresses, so
            lifting the first page's address onto everyone gives one claimant
            the other's address and then traces them at it. */}
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
        <LetterHistory lead={lead} onChanged={onChanged} say={say} />
      </Section>

      <CountySection lead={lead} />

      {/* Heirs lead for a deceased claimant, because they are the only people
          who can file. For a living one the section still appears once heirs
          exist, since an estate can be opened mid-claim. */}
      {(lead.isDeceased || (lead.heirCount || 0) > 0) && (
        <Section
          title="Who inherited"
          note={
            lead.isDeceased
              ? 'Only a living heir can file this claim'
              : undefined
          }
        >
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
        </Section>
      )}

      <Section
        title={`Reaching ${lead.claimant}`}
        note={
          lead.isDeceased
            ? 'Deceased. These are the claimant\u2019s own contacts and cannot sign anything.'
            : undefined
        }
      >
        <CredibilityBlock lead={lead} say={say} onChanged={onChanged} />
        {/* The verdict, stated before the contacts rather than inferred from
            their absence. "Nothing has been tried" and "everything has been
            tried" both render as an empty contact list, and they want opposite
            next actions: one costs a credit, the other a name search. */}
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
            <strong style={{ fontSize: 12.5, color: TRACE_TONE[lead.trace.tone] }}>
              {lead.trace.label}
            </strong>
            {lead.trace.at && (
              <span style={{ fontSize: 11, color: 'var(--faint)' }}>{fmtDate(lead.trace.at)}</span>
            )}
            <div style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--dim)' }}>
              {lead.trace.detail}
            </div>
          </div>
        )}
        {lead.phones.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--faint)' }}>
            <div style={{ marginTop: 2 }}>
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
                    ? 'Already submitted. The same address returns the same answer; use the name search below.'
                    : undefined
                }
              >
                {tracing ? 'Tracing...' : `Skip trace ${lead.claimant}`}
              </button>
              {lead.trace?.actionable === false && (
                <span style={{ marginLeft: 8, fontSize: 11 }}>
                  Already submitted, so this is spent. The route now is the name search below.
                </span>
              )}
            </div>
            <div style={{ marginTop: 4, fontSize: 11 }}>
              {lead.ownerMailingStreet
                ? `Traces ${lead.ownerMailingStreet}, ${lead.ownerMailingCity || ''} ${lead.ownerMailingState || ''}, the address the surplus notice was mailed to ${lead.noticeRecipient || lead.claimant}.`
                : `No owner address recovered for ${lead.claimant}, so this would trace the property at ${lead.address}, which is usually not where the owner is.`}
            </div>
          </div>
        )}
        {/* Clickable: dial it, or open the conversation already addressed to it.
            A flagged number still shows and is still clickable, because the
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
        <div style={{ marginTop: 4 }}>
          <button type="button" className="dc-wp-btn" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done editing' : 'Edit contacts'}
          </button>
        </div>
        {editing && (
          <ContactEditor leadId={lead.id} onChanged={onChanged} say={say} />
        )}

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
      </Section>

      {/* When the address route is exhausted, the name route is what is left.
          The course teaches searching NAME plus STATE and confirming against
          the property that was sold, which is the inverse of what BatchData
          does and is why the two complement each other. */}
      {lead.nameSearch && (
        <Section
          title={`Find ${lead.claimant} by name`}
          note={
            property.claimants.length > 1
              ? `One claimant at a time. Switch at the top to search ${property.claimants
                  .filter((c: any) => c.id !== lead.id)
                  .map((c: any) => c.claimant)
                  .join(' or ')}.`
              : undefined
          }
        >
          {lead.nameSearch.reason && (
            <div style={{ fontSize: 11.5, color: 'var(--amber)', marginBottom: 4 }}>
              {lead.nameSearch.reason}
            </div>
          )}
          <Row k="Search for" v={lead.nameSearch.query} />
          {lead.nameSearch.state && <Row k="In state" v={lead.nameSearch.state} />}
          {lead.nameSearch.verifyAgainst && (
            <Row
              k="Confirm against"
              v={lead.nameSearch.verifyAgainst}
              tone="var(--mint)"
              note="A result whose address history includes this property is your claimant. One that does not is a different person with the same name."
            />
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {lead.nameSearch.links.map((l: any) => (
              <a
                key={l.site}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="dc-wp-searchlink"
              >
                {l.site}
                {l.free && <span className="free">free</span>}
              </a>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="The docket"
        note={
          property.lastPolledAt
            ? `Last checked ${fmtDate(property.lastPolledAt)}`
            : 'Not yet pulled from the county'
        }
      >
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
            <summary style={{ fontSize: 11, color: 'var(--faint)', cursor: 'pointer' }}>
              {other.length} routine filings
            </summary>
            <div style={{ marginTop: 4 }}>
              {other.map((d, i) => (
                <DocLink key={`${d.docId || d.title}-${i}`} doc={d} source={property.sourceSystem} />
              ))}
            </div>
          </details>
        )}
      </Section>
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
      title="Next action"
      note={tasks && tasks.length ? `${tasks.length} open` : undefined}
    >
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
  const stages = SURPLUS_STAGES.concat('Dead');

  const move = async (stage: string) => {
    if (!stage || stage === lead.stage || saving) return;
    const warning =
      stage === 'Dead'
        ? `Mark ${lead.claimant} as Dead? The lead stays on file and the county poll will not bring it back as new.`
        : `Move ${lead.claimant} to ${stage}?`;
    if (!window.confirm(warning)) return;
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
    <Section title="Where the claim stands" note="This claimant only">
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
        {lead.stage !== 'Agreement Signed' && !lead.stage.match(/Notarized|Filed|Paid|Dead/) && (
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>
            Agreement Signed needs entitlement verified, the notice date confirmed and the title search
            complete.
          </span>
        )}
      </div>
      <ContactLine lead={lead} />
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
  const why = status ? `Not set up: ${status.missing.join(', ')}` : 'Checking...';
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
