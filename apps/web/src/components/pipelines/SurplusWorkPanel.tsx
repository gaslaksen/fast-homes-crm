'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import CommunicationsTimeline from '@/components/communications/CommunicationsTimeline';
import MessageComposer, { type EmailAction } from '@/components/communications/MessageComposer';
import NotesPanel from '@/components/communications/NotesPanel';
import type { NoteItem, TimelineItem } from '@/components/communications/types';
import { authAPI, campaignsAPI, leadsAPI } from '@/lib/api';
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
  lead: SurplusPanelLead;
  currentUser: any;
  onClose: () => void;
  /** Refresh the board row after something changes here. */
  onChanged: () => void;
  say: (msg: string) => void;
}

export default function SurplusWorkPanel({ lead, currentUser, onClose, onChanged, say }: Props) {
  const [tab, setTab] = useState<Tab>('case');
  const [comms, setComms] = useState<{ timeline: TimelineItem[]; notes: NoteItem[] }>({
    timeline: [],
    notes: [],
  });
  const [emailAction, setEmailAction] = useState<EmailAction | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [enrolling, setEnrolling] = useState(false);
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

  const ledger = lead.claimLedger || [];
  const tone = CLAIM_STATUS_TONE[lead.claimStatus] || 'var(--dim)';

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
                <span style={{ fontSize: 17, fontWeight: 700 }}>{lead.claimant}</span>
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
                  {lead.claimStatusLabel}
                </span>
                {lead.isDeceased && (
                  <span style={{ fontSize: 11, color: 'var(--amber)' }}>Estate</span>
                )}
                {lead.doNotCall && (
                  <span style={{ fontSize: 11, color: 'var(--red)' }}>Do not call</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 3 }}>
                {lead.address}
                {lead.city ? `, ${lead.city}` : ''} {lead.zip}
              </div>
              <div style={{ fontSize: 12, color: 'var(--faint, #7a828e)', marginTop: 2 }}>
                {lead.county} County
                {lead.caseNumber ? ` - case ${lead.caseNumber}` : ''}
                {lead.sourceUrl && (
                  <>
                    {' '}
                    <a
                      href={lead.sourceUrl}
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
            <strong style={{ color: tone }}>Rank {lead.workScore}</strong> {lead.workReason}
          </div>

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
            <CaseTab lead={lead} ledger={ledger} />
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

function CaseTab({ lead, ledger }: { lead: SurplusPanelLead; ledger: LedgerDoc[] }) {
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
        <Row k="Surplus posted today" v={money(lead.grossSurplus)} />
        {lead.surplusAtNotice != null && lead.surplusAtNotice !== lead.grossSurplus && (
          <Row
            k="Stated in the mailed notice"
            v={money(lead.surplusAtNotice)}
            note="What the claimant was told they are owed. Use this number on a call."
          />
        )}
        <Row k="Net to claimant" v={money(lead.netToClaimant)} />
        {lead.estFee != null && <Row k="Fee at the cap" v={money(lead.estFee)} />}
      </Section>

      <Section title="The clock">
        <Row k="Sale" v={lead.saleDate ? fmtDate(lead.saleDate) : 'unknown'} />
        <Row
          k="Notice mailed"
          v={lead.noticeDate ? fmtDate(lead.noticeDate) : 'unknown'}
          note={
            lead.noticeConfirmed
              ? undefined
              : 'Estimated from the sale date. Duval publishes no filing dates and its notice is a scan, so this is a floor, not a confirmed date.'
          }
        />
        {lead.daysRemaining != null && (
          <Row
            k="Lien window"
            v={
              lead.daysRemaining > 0
                ? `${lead.daysRemaining} days left`
                : `closed ${Math.abs(lead.daysRemaining)} days ago`
            }
            note="Whether another lienholder can still appear and shrink the payout. A previous owner is not barred by it."
          />
        )}
      </Section>

      <Section title="Reaching them">
        {lead.phones.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--faint)' }}>
            No numbers yet.{' '}
            {lead.contactMismatch
              ? `A skip trace returned ${lead.mismatchedName || 'somebody else'}, so its contacts were discarded rather than attached.`
              : 'Not skip traced yet.'}
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
        {lead.mailVerdict && (
          <Row
            k="Clerk mail"
            v={
              lead.mailVerdict === 'undeliverable'
                ? 'every mailing returned'
                : lead.mailVerdict === 'delivered'
                  ? 'delivered'
                  : lead.mailVerdict === 'mixed'
                    ? 'some delivered, some returned'
                    : 'unknown'
            }
            tone={lead.mailVerdict === 'undeliverable' ? 'var(--red)' : undefined}
            note={
              lead.mailVerdict === 'undeliverable'
                ? 'The address of record is dead, so this lead lives or dies on the skip trace.'
                : undefined
            }
          />
        )}
      </Section>

      <Section
        title="The docket"
        note={
          lead.lastPolledAt
            ? `Last checked ${fmtDate(lead.lastPolledAt)}`
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
