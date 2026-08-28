'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import CommunicationsTimeline from '@/components/communications/CommunicationsTimeline';
import MessageComposer, { type EmailAction } from '@/components/communications/MessageComposer';
import NotesPanel from '@/components/communications/NotesPanel';
import type { NoteItem, TimelineItem } from '@/components/communications/types';
import { authAPI, campaignsAPI, leadsAPI } from '@/lib/api';
import { useDialer } from '@/components/dialer/DialerContext';
import { DNC_STATE, phoneDisplay } from './format';

/**
 * The shared work panel for every acquisition pipeline.
 *
 * ── What is shared and what is not ──────────────────────────────────────────
 *
 * Talking to somebody is identical across pipelines: the timeline, the
 * composer, the notes, the campaign enrolment and the dialer all key on a lead
 * id and nothing else. Reading a CASE is not identical at all. A surplus claim
 * has a docket and two addresses; a tax sale has a redemption payoff and an
 * upset window; a probate heir has a decedent and several properties; a
 * foreclosure has filings and signals.
 *
 * So this owns the shared half and takes the pipeline-specific half as
 * `detail`. Each pipeline keeps its own vocabulary in its own component instead
 * of four boards growing a union of everything.
 *
 * ── Contacts ────────────────────────────────────────────────────────────────
 *
 * Numbers and emails are rendered here rather than by each pipeline, because
 * click-to-call, click-to-text and click-to-email should behave the same
 * everywhere, and because the DNC flag must be shown consistently. A flagged
 * number is still shown and still clickable: the decision belongs to whoever is
 * making the call, and hiding a number means one exists that nobody knows about.
 */

const CONV_POLL_MS = 8_000;

type Tab = 'detail' | 'conversation' | 'notes';

export interface PanelContact {
  number: string;
  type?: string | null;
  /** DncRegistry value, or null when the number came back clean. */
  dnc?: string | null;
}

/** One person who can be contacted about this record. */
export interface PanelSubject {
  leadId: string;
  name: string;
  phones: PanelContact[];
  emails: string[];
  /** Shown under the name in the subject switcher. */
  hint?: string;
}

interface Props {
  /** Big line at the top: the property, the case, the person. */
  title: string;
  subtitle?: ReactNode;
  /** Small line under the subtitle, for county/case/source links. */
  meta?: ReactNode;
  /** Chips beside the title. */
  chips?: ReactNode;
  /** One line saying why this record ranks where it does. */
  reason?: ReactNode;
  /** Label for the pipeline-specific tab. */
  detailLabel?: string;
  /** The pipeline-specific content. */
  detail: ReactNode;

  /**
   * Everyone contactable on this record. More than one when a case owes several
   * claimants or an heir holds several properties; the switcher picks whose
   * conversation is shown.
   */
  subjects: PanelSubject[];
  /** Extra actions in the footer, beside campaign enrolment. */
  actions?: ReactNode;

  onClose: () => void;
  onChanged: () => void;
  say: (msg: string) => void;
}

export default function PipelineWorkPanel({
  title,
  subtitle,
  meta,
  chips,
  reason,
  detailLabel = 'Case',
  detail,
  subjects,
  actions,
  onClose,
  onChanged,
  say,
}: Props) {
  const [tab, setTab] = useState<Tab>('detail');
  const [subjectId, setSubjectId] = useState<string>(subjects[0]?.leadId);
  const subject = subjects.find((s) => s.leadId === subjectId) || subjects[0];

  const [comms, setComms] = useState<{ timeline: TimelineItem[]; notes: NoteItem[] }>({
    timeline: [],
    notes: [],
  });
  const [emailAction, setEmailAction] = useState<EmailAction | null>(null);
  const [composeIntent, setComposeIntent] = useState<any>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [fullLead, setFullLead] = useState<any>(null);
  const sigRef = useRef('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const dialer = useDialer();

  const sigOf = (t: TimelineItem[], n: NoteItem[]) =>
    `${t.length}:${t[t.length - 1]?.id ?? ''}|${n.length}:${n[n.length - 1]?.id ?? ''}`;

  const loadComms = useCallback(
    async (silent = false) => {
      if (!subject) return;
      try {
        const res = await leadsAPI.communications(subject.leadId);
        const timeline = res.data?.timeline || [];
        const notes = res.data?.notes || [];
        const sig = sigOf(timeline, notes);
        if (silent && sig === sigRef.current) return;
        sigRef.current = sig;
        setComms({ timeline, notes });
      } catch {
        // Keep what is on screen; a transient failure should not blank a thread
        // somebody is reading.
      }
    },
    [subject?.leadId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (!subjects.some((s) => s.leadId === subjectId)) setSubjectId(subjects[0]?.leadId);
  }, [subjects, subjectId]);

  useEffect(() => {
    if (!subject) return;
    setComms({ timeline: [], notes: [] });
    sigRef.current = '';
    setFullLead(null);
    leadsAPI.get(subject.leadId).then((r) => setFullLead(r.data)).catch(() => {});
    loadComms();
  }, [subject?.leadId, loadComms]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll only while the conversation is open and the window is visible, so an
  // open panel on a background tab is not hitting the API every 8 seconds.
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
    authAPI.getMe().then((r) => setCurrentUser(r.data)).catch(() => {});
    authAPI.getTeam().then((r) => setTeamMembers(r.data || [])).catch(() => {});
    campaignsAPI
      .list()
      .then((r) => setCampaigns(r.data?.filter?.((c: any) => c.isActive !== false) || r.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const call = (n: string) => dialer.startCall({ name: subject.name, phone: n, leadId: subject.leadId });
  const text = (n: string) => {
    setComposeIntent({ nonce: Date.now(), channel: 'sms', to: n });
    setTab('conversation');
  };
  const mail = (a: string) => {
    setComposeIntent({ nonce: Date.now(), channel: 'email', to: a });
    setEmailAction({ nonce: Date.now(), mode: 'reply', subject: '', bodyHtml: '', to: a });
    setTab('conversation');
  };

  const enroll = async (campaignId: string) => {
    if (!campaignId || enrolling || !subject) return;
    setEnrolling(true);
    try {
      await campaignsAPI.enroll(campaignId, subject.leadId);
      say('Enrolled in campaign');
      onChanged();
    } catch (e: any) {
      say(e?.response?.data?.message || 'Could not enrol this lead');
    } finally {
      setEnrolling(false);
    }
  };

  if (!subject) return null;

  return (
    // Fixed position, so the DOM location is irrelevant to layout, but it must
    // sit inside `.dc-board` for the colour tokens to resolve.
    <div className="dc-board">
      <div className="dc-wp-scrim" onClick={onClose} />
      <aside className="dc-wp" role="dialog" aria-label={title}>
        <div className="dc-wp-head">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 17, fontWeight: 700 }}>{title}</span>
                {chips}
              </div>
              {subtitle && (
                <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 3 }}>{subtitle}</div>
              )}
              {meta && (
                <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>{meta}</div>
              )}
            </div>
            <button type="button" className="dc-wp-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          {reason && (
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
              {reason}
            </div>
          )}

          {/* One record, several people. Each is contacted separately. */}
          {subjects.length > 1 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 11, flexWrap: 'wrap' }}>
              {subjects.map((s) => (
                <button
                  key={s.leadId}
                  type="button"
                  className={`dc-wp-claimant${s.leadId === subject.leadId ? ' on' : ''}`}
                  onClick={() => setSubjectId(s.leadId)}
                >
                  {s.name}
                  {s.hint && <span className="sub">{s.hint}</span>}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            {([['detail', detailLabel], ['conversation', 'Conversation'], ['notes', 'Notes']] as [Tab, string][]).map(
              ([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={`dc-wp-btn${tab === k ? ' on' : ''}`}
                  onClick={() => setTab(k)}
                >
                  {label}
                  {k === 'conversation' && comms.timeline.length > 0 && ` (${comms.timeline.length})`}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="dc-wp-body">
          {tab === 'detail' && (
            <div style={{ display: 'grid', gap: 16 }}>
              {detail}
              <Contacts subject={subject} onCall={call} onText={text} onEmail={mail} />
            </div>
          )}

          {tab === 'conversation' && (
            <div>
              {comms.timeline.length === 0 && (
                <div style={{ color: 'var(--faint)', fontSize: 13, padding: '8px 0 16px' }}>
                  No messages yet with {subject.name}.
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
              onAddNote={async (t) => {
                if (!currentUser?.id) return;
                await leadsAPI.addNote(subject.leadId, t, currentUser.id);
                await loadComms();
              }}
            />
          )}
        </div>

        <div className="dc-wp-foot">
          {tab === 'conversation' ? (
            fullLead ? (
              <MessageComposer
                leadId={subject.leadId}
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
              <button type="button" className="dc-wp-btn on" onClick={() => setTab('conversation')}>
                Open conversation
              </button>
              <select
                className="dc-wp-sel"
                defaultValue=""
                disabled={enrolling}
                onChange={(e) => {
                  enroll(e.target.value);
                  e.target.value = '';
                }}
              >
                <option value="">Add to drip campaign...</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {actions}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Contacts({
  subject,
  onCall,
  onText,
  onEmail,
}: {
  subject: PanelSubject;
  onCall: (n: string) => void;
  onText: (n: string) => void;
  onEmail: (a: string) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.3, marginBottom: 6 }}>
        Reaching {subject.name}
      </div>
      {subject.phones.length === 0 && subject.emails.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--faint)' }}>No phone or email on file.</div>
      )}
      {subject.phones.map((p) => {
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
      {subject.emails.map((e) => (
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
    </div>
  );
}

/** Shared row for a pipeline's detail sections, so they read alike. */
export function PanelSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
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

export function PanelRow({
  k,
  v,
  note,
  tone,
}: {
  k: string;
  v: ReactNode;
  note?: string;
  tone?: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
        <span style={{ color: 'var(--dim)' }}>{k}</span>
        <span style={{ color: tone || 'inherit', fontWeight: 600, textAlign: 'right' }}>{v}</span>
      </div>
      {note && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 1 }}>{note}</div>}
    </div>
  );
}
