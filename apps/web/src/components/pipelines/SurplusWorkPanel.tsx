'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import CommunicationsTimeline from '@/components/communications/CommunicationsTimeline';
import MessageComposer, { type EmailAction } from '@/components/communications/MessageComposer';
import NotesPanel from '@/components/communications/NotesPanel';
import type { NoteItem, TimelineItem } from '@/components/communications/types';
import { authAPI, campaignsAPI, leadsAPI, surplusAPI } from '@/lib/api';
import { useDialer } from '@/components/dialer/DialerContext';
import { DNC_STATE } from './format';
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
 * The panel deliberately does NOT duplicate the card's editing controls. The
 * card stays the place to change stage and tick documents; this is the place to
 * read the case and talk to the person.
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
}

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
  onClose: () => void;
  /** Refresh the board row after something changes here. */
  onChanged: () => void;
  say: (msg: string) => void;
}

export default function SurplusWorkPanel({
  property,
  currentUser,
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

  // Escape closes, which is what a slide-over is expected to do.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
  const call = (number: string) => dialer.startCall({ name: lead.claimant, phone: number, leadId: lead.id });

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
                  {c.claimant}
                  {/* The trace state, not just the phone count. A claimant with
                      no numbers is either untried or exhausted, and those want
                      opposite actions. */}
                  <span className="sub" style={{ color: TRACE_TONE[c.trace?.tone || 'idle'] }}>
                    {c.cleanPhoneCount > 0
                      ? `${c.cleanPhoneCount} callable`
                      : c.trace?.label || 'Never skip traced'}
                  </span>
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
              onTrace={trace}
              tracing={tracing}
              onCall={call}
              onText={message}
              onEmail={mail}
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
  onTrace,
  tracing,
  onCall,
  onText,
  onEmail,
}: {
  lead: SurplusPanelLead;
  property: any;
  ledger: LedgerDoc[];
  onTrace: () => void;
  tracing: boolean;
  onCall: (number: string) => void;
  onText: (number: string) => void;
  onEmail: (address: string) => void;
}) {
  const grouped = LEDGER_GROUPS.map((g) => ({
    ...g,
    docs: ledger.filter((d) => d.kind === g.kind),
  })).filter((g) => g.docs.length > 0);

  const other = ledger.filter(
    (d) => !LEDGER_GROUPS.some((g) => g.kind === d.kind),
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
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
      </Section>

      <Section title={`Reaching ${lead.claimant}`}>
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
              <DocLink key={`${d.docId || d.title}-${i}`} doc={d} />
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
                <DocLink key={`${d.docId || d.title}-${i}`} doc={d} />
              ))}
            </div>
          </details>
        )}
      </Section>
    </div>
  );
}

function DocLink({ doc }: { doc: LedgerDoc }) {
  const label = doc.title;
  if (!doc.url) {
    return (
      <div style={{ fontSize: 12, color: 'var(--faint)' }}>
        {label} <span style={{ fontSize: 10 }}>(not scanned)</span>
      </div>
    );
  }
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
