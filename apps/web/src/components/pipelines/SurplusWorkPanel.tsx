'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import CommunicationsTimeline from '@/components/communications/CommunicationsTimeline';
import MessageComposer, { type EmailAction } from '@/components/communications/MessageComposer';
import NotesPanel from '@/components/communications/NotesPanel';
import type { NoteItem, TimelineItem } from '@/components/communications/types';
import { authAPI, campaignsAPI, leadsAPI, surplusAPI } from '@/lib/api';
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
  noticeDate: string | null;
  noticeConfirmed: boolean;
  daysRemaining: number | null;
  phones: { number: string; type: string | null; dnc: string | null }[];
  emails: string[];
  contactMismatch: boolean;
  mismatchedName: string | null;
  doNotCall: boolean;
  isDeceased: boolean;
  totalTouches: number;
}

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
          {property.claimantCount > 1 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 11, flexWrap: 'wrap' }}>
              {property.claimants.map((c: any) => (
                <button
                  key={c.id}
                  type="button"
                  className={`dc-wp-claimant${c.id === lead.id ? ' on' : ''}`}
                  onClick={() => setClaimantId(c.id)}
                >
                  {c.claimant}
                  <span className="sub">
                    {c.cleanPhoneCount > 0
                      ? `${c.cleanPhoneCount} callable`
                      : c.contactMismatch
                        ? 'trace mismatched'
                        : 'no number'}
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
}: {
  lead: SurplusPanelLead;
  property: any;
  ledger: LedgerDoc[];
  onTrace: () => void;
  tracing: boolean;
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
        <Row k="Sale" v={property.saleDate ? fmtDate(property.saleDate) : 'unknown'} />
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
        {property.ownerMailingStreet ? (
          <Row
            k="Owner, per the notice"
            v={[
              property.ownerMailingStreet,
              property.ownerMailingCity,
              [property.ownerMailingState, property.ownerMailingZip].filter(Boolean).join(' '),
            ]
              .filter(Boolean)
              .join(', ')}
            tone="var(--mint)"
            note={
              property.noticeRecipient && property.noticeRecipient !== lead.claimant
                ? `Addressed to ${property.noticeRecipient}. This is the address that gets skip traced.`
                : 'This is the address that gets skip traced.'
            }
          />
        ) : (
          <Row
            k="Owner, per the notice"
            v="not recovered"
            tone="var(--amber)"
            note="The Notice of Surplus Funds has not been read for this case, so any trace falls back to the property address, which is usually not where the owner is."
          />
        )}
      </Section>

      <Section title="Reaching them">
        {lead.phones.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--faint)' }}>
            No numbers yet.{' '}
            {lead.contactMismatch
              ? `A skip trace returned ${lead.mismatchedName || 'somebody else'}, so its contacts were discarded rather than attached. This claimant needs a name based route: Sunbiz for an entity, official records for a later deed, or an obituary if deceased.`
              : 'Not skip traced yet.'}
            <div style={{ marginTop: 6 }}>
              <button type="button" className="dc-wp-btn" onClick={onTrace} disabled={tracing}>
                {tracing ? 'Tracing...' : lead.contactMismatch ? 'Re-run skip trace' : 'Skip trace'}
              </button>
            </div>
            <div style={{ marginTop: 4, fontSize: 11 }}>
              {property.ownerMailingStreet
                ? `Traces ${property.ownerMailingStreet}, ${property.ownerMailingCity || ''} ${property.ownerMailingState || ''}, the address the surplus notice was mailed to.`
                : `No owner address recovered, so this would trace the property at ${lead.address}, which is usually not where the owner is.`}
            </div>
          </div>
        )}
        {lead.phones.map((p) => (
          <Row
            key={p.number}
            k={p.type || 'Phone'}
            v={phoneDisplay(p.number)}
            note={p.dnc ? `On the ${p.dnc} registry` : undefined}
            tone={p.dnc ? 'var(--red)' : undefined}
          />
        ))}
        {lead.emails.map((e) => (
          <Row key={e} k="Email" v={e} />
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
        <Section title="Find them by name">
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
