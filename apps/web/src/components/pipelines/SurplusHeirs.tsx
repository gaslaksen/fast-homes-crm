'use client';

import { useEffect, useRef, useState } from 'react';
import { surplusAPI } from '@/lib/api';
import { DNC_STATE, phoneDisplay, fmtDate } from './format';
import { SURPLUS_PERSON_ROLES, SURPLUS_CONTACT_STATUSES, personRoleLabel } from '@/lib/surplus-people';
import { rememberSocialTarget, socialSearchLinks, type SocialProfile } from '@/lib/surplus-social';
import { AddSocialProfile, FindProfilesButton, SocialProfileList } from './SurplusSocial';
import { PersonDrips } from './SurplusDrips';

/**
 * Who inherited a deceased claimant's interest, and who is safe to ring.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * An Estate claimant is a dead end until somebody finds who inherited: only a
 * living person with standing can file the claim. Before this, those leads sat
 * in the name-search queue looking exactly like a living owner nobody could
 * reach, and the time went into skip tracing a dead man.
 *
 * ── Why a PDF and not a search ─────────────────────────────────────────────
 *
 * Duval's probate file is in CORE, behind a Google reCAPTCHA and a click-through
 * user agreement, with the clerk citing Florida Supreme Court order AOSC24-65.
 * The captcha-free Official Records index does not carry these documents at all,
 * because petitions and orders are court records rather than recorded
 * instruments: a live search for ALFRED SPENCER returns 42 instruments and the
 * 2025 petition is not among them.
 *
 * So the link opens CORE, the person finds the case and downloads the filing,
 * and the filing is read here. Deciding that the Alfred Spencer who died in 2021
 * is the one who lost 1624 W 35th St is an identification, not a lookup.
 */

/**
 * Where to send somebody for a county whose records URL the API does not
 * know. A web search for the clerk beats a guessed URL: clerks' public-access
 * systems differ per county and a wrong link reads as broken.
 */
export function courtRecordsSearch(county: string | null): string {
  const q = `${county || 'Florida'} County Clerk of Court records search probate`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export interface Heir {
  id: string;
  name: string;
  /** Heir by default. Anybody else is a route to the claimant, not a signer. */
  role: string;
  roleLabel: string;
  isHeir: boolean;
  contactStatus: string;
  contactStatusLabel: string;
  lastContactedAt: string | null;
  /** When this person last gained a phone or email. */
  contactInfoUpdatedAt?: string | null;
  relationship: string | null;
  share: string | null;
  address: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  deceased: boolean;
  dateOfDeath: string | null;
  phones: { number: string; type: string | null; dnc: string | null; bad?: boolean }[];
  emails: string[];
  cleanPhoneCount: number;
  /** Who to try first, lowest first, and the word for it (Spouse, Child, Neighbor). */
  priority?: number;
  priorityLabel?: string;
  contactMismatch: boolean;
  mismatchedName: string | null;
  trace: { state: string; label: string; tone: 'good' | 'warn' | 'bad' | 'idle'; detail: string; actionable: boolean } | null;
  doNotCall: boolean;
  callNotes: string;
  sourceCaseNumber: string | null;
  sourceDocument: string | null;
  callable: boolean;
  traceable: boolean;
  socialSearchedAt?: string | null;
}

const TONE: Record<string, string> = {
  good: 'var(--mint)',
  warn: 'var(--amber)',
  bad: 'var(--red)',
  idle: 'var(--dim)',
};

/**
 * How sure we are this is the person, in the course's words. A court filing
 * names them; a trace that matched is probable; anything else is unverified.
 */
export function personConfidence(p: {
  sourceDocument?: string | null;
  contactMismatch?: boolean;
  trace?: { state: string } | null;
}): { label: string; tone: string } {
  if (p.contactMismatch || p.trace?.state === 'mismatch') return { label: 'Wrong person?', tone: 'var(--red)' };
  if (p.sourceDocument) return { label: 'From a filing', tone: 'var(--mint)' };
  if (p.trace?.state === 'matched') return { label: 'Probable', tone: 'var(--mint)' };
  return { label: 'Unverified', tone: 'var(--amber)' };
}

/** "2 numbers, 1 wrong · 1 email", the contact summary on a compact row. */
export function contactSummary(phones: { dnc?: string | null; bad?: boolean }[], emails: string[]): string {
  const bad = phones.filter((p) => p.bad).length;
  const dnc = phones.filter((p) => !p.bad && p.dnc).length;
  const parts = [
    phones.length
      ? `${phones.length} number${phones.length === 1 ? '' : 's'}${bad ? `, ${bad} wrong` : ''}${dnc ? `, ${dnc} DNC` : ''}`
      : 'no number',
    emails.length ? `${emails.length} email${emails.length === 1 ? '' : 's'}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * One person as a single line: who they are, how sure we are, how to reach
 * them and where it stands. Clicking it opens the full card. The list reads
 * as the claim jacket, every person on one screen, instead of a stack of
 * cards ten controls deep.
 */
export function PersonLine({
  name,
  who,
  confidence,
  contacts,
  status,
  statusTone,
  struck,
  open,
  onToggle,
}: {
  name: string;
  who: string;
  confidence: { label: string; tone: string } | null;
  contacts: string;
  status: string;
  statusTone?: string;
  struck?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className={`dc-wp-person${open ? ' open' : ''}`} onClick={onToggle} aria-expanded={open}>
      <span style={{ minWidth: 0, flex: '1 1 180px' }}>
        <b style={struck ? { textDecoration: 'line-through' } : undefined}>{name}</b>
        <span style={{ color: 'var(--dim)' }}> · {who}</span>
        {confidence && (
          <span className="dc-wp-conf" style={{ color: confidence.tone, borderColor: confidence.tone }}>
            {confidence.label}
          </span>
        )}
      </span>
      <span style={{ color: 'var(--dim)', flex: '1 1 140px' }}>{contacts}</span>
      <span style={{ color: statusTone || 'var(--faint)', flex: '0 1 auto' }}>{status}</span>
      <span aria-hidden="true" style={{ color: 'var(--faint)' }}>
        {open ? '▴' : '▾'}
      </span>
    </button>
  );
}

export default function SurplusHeirs({
  leadId,
  claimant,
  claimantDeceased,
  propertyAddress,
  county,
  courtRecordsUrl,
  onCall,
  onText,
  onEmail,
  onChanged,
  say,
  social,
  socialPaused,
}: {
  leadId: string;
  claimant: string;
  /** The claimant is an estate or marked deceased, so heirs are the route. */
  claimantDeceased: boolean;
  propertyAddress: string;
  county: string | null;
  /** The county's public-access court records, from the API, or null. */
  courtRecordsUrl?: string | null;
  /** Every social profile on the claim; each row shows its own person's. */
  social?: SocialProfile[];
  /** Whether the paid web search is paused. Null while unknown. */
  socialPaused?: boolean | null;
  /** Dial a number. The name is the person being rung, not the claimant. */
  onCall: (n: string, name?: string) => void;
  onText: (n: string) => void;
  onEmail: (a: string) => void;
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const [heirs, setHeirs] = useState<Heir[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  /** The extract awaiting confirmation. Nothing is saved until this is kept. */
  const [pending, setPending] = useState<any>(null);
  /** The person whose row is open as a form, or null. One at a time. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The person whose full card is open. Everyone else is one line. */
  const [openId, setOpenId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    surplusAPI
      .heirs(leadId)
      .then((r) => setHeirs(r.data?.heirs || []))
      .catch(() => setHeirs([]));
  };

  useEffect(load, [leadId]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setReading(true);
    setPending(null);
    say('Reading the filing...');
    try {
      const res = await surplusAPI.readFiling(leadId, f);
      setPending({ ...res.data, sourceDocument: f.name });
      const n = res.data?.heirs?.length || 0;
      say(n ? `Found ${n} name${n === 1 ? '' : 's'}. Check them before saving.` : 'No heirs found in that filing.');
    } catch (err: any) {
      say(err?.response?.data?.message || 'That filing could not be read.');
    } finally {
      setReading(false);
    }
  };

  const keep = async () => {
    if (!pending?.heirs?.length) return;
    setBusy(true);
    try {
      const res = await surplusAPI.saveHeirs(leadId, {
        heirs: pending.heirs,
        caseNumber: pending.caseNumber,
        sourceDocument: pending.sourceDocument,
      });
      setHeirs(res.data?.heirs || []);
      setPending(null);
      say(`Saved ${res.data.created} heir${res.data.created === 1 ? '' : 's'}${res.data.updated ? `, ${res.data.updated} updated` : ''}.`);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'Those heirs could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const setDnc = async (h: Heir) => {
    setBusy(true);
    try {
      await surplusAPI.updateHeir(h.id, { doNotCall: !h.doNotCall });
      load();
      onChanged();
      say(h.doNotCall ? 'Do-not-call cleared.' : 'Marked do not call.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (h: Heir) => {
    if (!window.confirm(`Remove ${h.name} from this claim?`)) return;
    setBusy(true);
    try {
      await surplusAPI.deleteHeir(h.id);
      load();
      onChanged();
      say(`${h.name} removed.`);
    } finally {
      setBusy(false);
    }
  };

  // Best first within each group: spouse, children, heirs, family, then
  // neighbors, the order the course works associates in.
  const byPriority = (a: Heir, b: Heir) => (a.priority ?? 9) - (b.priority ?? 9) || a.name.localeCompare(b.name);
  const living = (heirs || []).filter((h) => !h.deceased && h.isHeir).sort(byPriority);
  // Everyone dead, heir or not, so a dead relative is not simply missing.
  const dead = (heirs || []).filter((h) => h.deceased);
  // People who are not heirs: a relative, a neighbor, a friend. They cannot
  // sign anything, but one of them usually knows where the claimant is.
  const associates = (heirs || []).filter((h) => !h.deceased && !h.isHeir).sort(byPriority);
  const coreSearch = courtRecordsUrl || courtRecordsSearch(county);

  const setStatus = async (h: Heir, contactStatus: string) => {
    setBusy(true);
    try {
      await surplusAPI.updateHeir(h.id, { contactStatus });
      load();
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  /** The form in place of a row, while that person is being edited. */
  const editor = (h: Heir) =>
    editingId === h.id ? (
      <div key={h.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 4 }}>
        <PersonForm
          leadId={leadId}
          person={h}
          say={say}
          onCancel={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            load();
            onChanged();
          }}
        />
      </div>
    ) : null;

  const statusColor = (h: Heir) =>
    h.contactStatus === 'message_passed' ? 'var(--mint)' : h.contactStatus === 'dead_end' ? 'var(--red)' : h.contactStatus === 'contacted' ? 'var(--amber)' : 'var(--faint)';

  const personRow = (h: Heir) =>
    openId === h.id ? (
      <div key={h.id} className="dc-wp-person-card">
        {personCard(h)}
      </div>
    ) : (
      <PersonLine
        key={h.id}
        name={h.name}
        who={h.relationship || h.priorityLabel || h.roleLabel}
        confidence={personConfidence(h)}
        contacts={contactSummary(h.phones, h.emails)}
        status={`${h.contactStatusLabel}${h.lastContactedAt ? `, ${fmtDate(h.lastContactedAt)}` : ''}${h.doNotCall ? ' · do not call' : ''}`}
        statusTone={statusColor(h)}
        open={false}
        onToggle={() => setOpenId(h.id)}
      />
    );

  const personCard = (h: Heir) => (
    <HeirRow
      key={h.id}
      onCollapse={() => setOpenId(null)}
      h={h}
      busy={busy}
      onCall={(n) => onCall(n, h.name)}
      onText={onText}
      onEmail={onEmail}
      onDnc={() => setDnc(h)}
      onRemove={() => remove(h)}
      onStatus={(v) => setStatus(h, v)}
      onEdit={() => setEditingId(h.id)}
      leadId={leadId}
      profiles={(social || []).filter((p) => p.heirId === h.id)}
      socialPaused={socialPaused ?? null}
      say={say}
      people={(heirs || []).map((x) => ({ id: x.id, name: x.name, deceased: x.deceased }))}
      claimant={claimant}
      claimantDeceased={claimantDeceased}
      onChanged={() => {
        load();
        onChanged();
      }}
    />
  );

  const deadRow = (h: Heir) => (
    <div
      key={h.id}
      style={{
        fontSize: 12,
        padding: '6px 0',
        borderTop: '1px solid var(--border)',
        opacity: 0.75,
      }}
    >
      <span style={{ textDecoration: 'line-through' }}>{h.name}</span>
      <span style={{ color: 'var(--red)' }}>
        {' '}· died {h.dateOfDeath ? fmtDate(h.dateOfDeath) : 'date unknown'}
      </span>
      {h.share && <div style={{ color: 'var(--faint)', fontSize: 11.5 }}>{h.share}</div>}
      <div style={{ color: 'var(--dim)', fontSize: 11.5 }}>
        Their share needs its own estate opened before it can be claimed.
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => setEditingId(h.id)}>
          Edit
        </button>
        <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => remove(h)}>
          Remove
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {/* The state that used to be invisible. A dead claimant with no heirs on
          file reads as "no number" everywhere else, which sends somebody
          skip tracing a person who cannot sign anything. */}
      {claimantDeceased && !living.length && (
        <div
          style={{
            padding: '9px 11px',
            borderRadius: 6,
            background: 'var(--bg2)',
            borderLeft: '3px solid var(--red)',
            fontSize: 12,
          }}
        >
          <b style={{ color: 'var(--red)' }}>{claimant} is deceased and no living heir is on file.</b>
          <div style={{ color: 'var(--dim)', marginTop: 3 }}>
            Nobody can file this claim yet, so a phone number for the claimant is
            worth nothing. Find the probate case, download the petition, and drop
            it in below.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
        <a
          href={coreSearch}
          target="_blank"
          rel="noopener noreferrer"
          className="dc-wp-btn"
          style={{ textDecoration: 'none' }}
          title={
            courtRecordsUrl
              ? `${county || 'County'} clerk public access. Search the probate division by the claimant's name.`
              : `No records link on file for ${county || 'this county'} yet. Opens a search for the clerk's public-access site.`
          }
        >
          Open {county || 'county'} court records
        </a>
        <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={onFile} />
        <button
          type="button"
          className="dc-wp-btn"
          disabled={reading || busy}
          onClick={() => fileRef.current?.click()}
        >
          {reading ? 'Reading the filing...' : 'Add heirs from a filing'}
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--faint)' }}>
        Search the probate division for {claimant}, download the petition or order,
        then drop the PDF here. The court file is behind a captcha and a user
        agreement, so it cannot be pulled automatically.
      </div>

      {/* Nothing is written until this is confirmed. A wrong heir is a stranger
          being told they have money coming. */}
      {pending && (
        <div
          style={{
            padding: 11,
            borderRadius: 6,
            background: 'var(--bg2)',
            border: '1px solid var(--amber)',
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>
            Check this before saving
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--dim)', marginBottom: 7 }}>
            {pending.sourceDocument}
            {pending.decedent ? ` · decedent ${pending.decedent}` : ''}
            {pending.caseNumber ? ` · case ${pending.caseNumber}` : ''}
            {pending.propertyAddress ? ` · ${pending.propertyAddress}` : ''}
          </div>
          {(pending.warnings || []).map((w: string, i: number) => (
            <div key={i} style={{ fontSize: 11.5, color: 'var(--amber)', marginBottom: 3 }}>
              &#9888; {w}
            </div>
          ))}
          {(pending.heirs || []).map((h: any, i: number) => (
            <div key={i} style={{ fontSize: 12, padding: '4px 0', borderTop: '1px solid var(--border)' }}>
              <b>{h.name}</b>
              {h.deceased && <span style={{ color: 'var(--red)' }}> · deceased{h.dateOfDeath ? ` ${h.dateOfDeath}` : ''}</span>}
              {h.relationship && <span style={{ color: 'var(--dim)' }}> · {h.relationship}</span>}
              {h.share && <span style={{ color: 'var(--dim)' }}> · {h.share}</span>}
              <div style={{ color: 'var(--faint)', fontSize: 11.5 }}>
                {[h.street, h.city, [h.state, h.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'no address in the filing'}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" className="dc-wp-btn on" disabled={busy || !pending.heirs?.length} onClick={keep}>
              Save these heirs
            </button>
            <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => setPending(null)}>
              Discard
            </button>
          </div>
        </div>
      )}

      {heirs === null && <div style={{ fontSize: 12, color: 'var(--faint)' }}>Loading heirs...</div>}

      {!!living.length && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mint)', letterSpacing: 0.4, marginBottom: 4 }}>
            LIVING HEIRS &middot; CONTACT THESE
          </div>
          {living.map((h) => editor(h) || personRow(h))}
        </div>
      )}

      {!!associates.length && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', letterSpacing: 0.4, marginBottom: 4 }}>
            PEOPLE WHO MAY KNOW WHERE {claimantDeceased ? 'THE HEIRS ARE' : `${claimant.toUpperCase()} IS`}
          </div>
          {associates.map((h) => editor(h) || personRow(h))}
        </div>
      )}

      <AddPerson leadId={leadId} claimant={claimant} busy={busy} say={say} onAdded={() => { load(); onChanged(); }} />

      {/* Shown, not hidden. Knowing an heir is dead is why nobody wastes an
          afternoon on them, and their share still needs its own estate. */}
      {!!dead.length && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', letterSpacing: 0.4, marginBottom: 4 }}>
            DECEASED &middot; DO NOT CONTACT
          </div>
          {dead.map((h) => editor(h) || deadRow(h))}
        </div>
      )}
    </div>
  );
}

function HeirRow({
  h,
  onCollapse,
  busy,
  onCall,
  onText,
  onEmail,
  onDnc,
  onRemove,
  onStatus,
  onEdit,
  leadId,
  profiles,
  socialPaused,
  say,
  onChanged,
  people,
  claimant,
  claimantDeceased,
}: {
  h: Heir;
  /** Everybody on the case, so a number can be moved to the person it reaches. */
  people: { id: string; name: string; deceased: boolean }[];
  claimant: string;
  claimantDeceased: boolean;
  /** Fold the card back to its one line. */
  onCollapse?: () => void;
  busy: boolean;
  onCall: (n: string) => void;
  onText: (n: string) => void;
  onEmail: (a: string) => void;
  onDnc: () => void;
  onRemove: () => void;
  onStatus: (status: string) => void;
  onEdit: () => void;
  leadId: string;
  profiles: SocialProfile[];
  socialPaused: boolean | null;
  say: (msg: string) => void;
  onChanged: () => void;
}) {
  const [findOpen, setFindOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const statusTone =
    h.contactStatus === 'message_passed' ? 'var(--mint)' : h.contactStatus === 'dead_end' ? 'var(--red)' : h.contactStatus === 'contacted' ? 'var(--amber)' : 'var(--faint)';
  return (
    <div style={{ padding: '7px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>{h.name}</b>
        {(() => {
          const c = personConfidence(h);
          return (
            <span className="dc-wp-conf" style={{ color: c.tone, borderColor: c.tone }}>
              {c.label}
            </span>
          );
        })()}
        {!h.isHeir && (
          <span className="dc-tag" style={{ background: 'var(--bg2)', color: 'var(--dim)' }}>
            {h.roleLabel}
          </span>
        )}
        {h.relationship && <span style={{ fontSize: 11.5, color: 'var(--dim)' }}>{h.relationship}</span>}
        {h.share && (
          <span className="dc-tag" style={{ background: 'var(--bg2)', color: 'var(--dim)' }}>
            {h.share}
          </span>
        )}
        {h.doNotCall && <span style={{ fontSize: 11.5, color: 'var(--red)' }}>do not call</span>}
        {onCollapse && (
          <button type="button" className="dc-wp-btn" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11 }} onClick={onCollapse}>
            Close
          </button>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
        {h.address || 'no address in the filing'}
        {h.sourceCaseNumber ? ` · case ${h.sourceCaseNumber}` : ''}
      </div>

      {h.callNotes && (
        <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{h.callNotes}</div>
      )}

      {h.trace && !h.phones.length && (
        <div style={{ fontSize: 11.5, color: TONE[h.trace.tone], marginTop: 3 }}>
          <b>{h.trace.label}.</b> <span style={{ color: 'var(--dim)' }}>{h.trace.detail}</span>
        </div>
      )}

      {h.phones.map((p: any) => {
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
              <button type="button" className="dc-wp-btn" disabled={h.doNotCall} onClick={() => onCall(p.number)}>
                Call
              </button>
              <button type="button" className="dc-wp-btn" disabled={h.doNotCall} onClick={() => onText(p.number)}>
                Text
              </button>
              <MoveNumber
                leadId={leadId}
                number={p.number}
                currentHeirId={h.id}
                people={people}
                claimant={claimant}
                claimantDeceased={claimantDeceased}
                say={say}
                onChanged={onChanged}
              />
            </div>
          </div>
        );
      })}

      {h.emails.map((e) => (
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

      {/* Their profiles: the route when the numbers are dead or there were
          none. A candidate the search offered waits for the identification. */}
      {!h.deceased && <SocialProfileList profiles={profiles} say={say} onChanged={onChanged} />}
      {!h.deceased && (
        <div style={{ marginTop: 4 }}>
          <button type="button" className="dc-wp-btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setFindOpen((v) => !v)}>
            {findOpen ? 'Done' : profiles.length ? 'Find more online' : 'Find online'}
          </button>
          {findOpen && (
            <div
              style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}
              onClickCapture={() => rememberSocialTarget({ leadId, heirId: h.id, label: h.name, sub: h.relationship || h.roleLabel || null })}
            >
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {socialSearchLinks(h.name, h.city, h.state).map((l) => (
                  <a key={l.site} href={l.url} target="_blank" rel="noopener noreferrer" className="dc-wp-searchlink">
                    {l.site}
                  </a>
                ))}
              </div>
              <FindProfilesButton
                leadId={leadId}
                heirId={h.id}
                who={h.name}
                searchedAt={h.socialSearchedAt || null}
                paused={socialPaused}
                say={say}
                onChanged={onChanged}
              />
              <AddSocialProfile leadId={leadId} heirId={h.id} say={say} onChanged={onChanged} />
            </div>
          )}
        </div>
      )}

      {/* Where the outreach to this person stands. "Passed a message on" is
          the win with a neighbor or a relative: the claimant now knows to call. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, fontSize: 11.5 }}>
        <select
          value={h.contactStatus}
          disabled={busy}
          onChange={(e) => onStatus(e.target.value)}
          aria-label={`Contact status for ${h.name}`}
          style={{
            fontSize: 11.5,
            padding: '2px 6px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--surface2)',
            color: statusTone,
          }}
        >
          {SURPLUS_CONTACT_STATUSES.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        {h.lastContactedAt && <span style={{ color: 'var(--faint)' }}>last {fmtDate(h.lastContactedAt)}</span>}
        {h.contactInfoUpdatedAt && (
          <span style={{ color: 'var(--faint)' }}>contact updated {fmtDate(h.contactInfoUpdatedAt)}</span>
        )}
      </div>

      {/* This person's own drips, on their own number and email. */}
      <PersonDrips
        heirId={h.id}
        name={h.name}
        emails={h.emails}
        blocked={h.deceased ? 'marked deceased' : h.doNotCall ? 'marked do not call' : null}
      />

      <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
        {/* The rarely used controls behind one button, so the card reads as
            the person and their numbers rather than a row of switches. */}
        <button type="button" className="dc-wp-btn" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
          {moreOpen ? 'Less' : 'More ⋯'}
        </button>
        {moreOpen && (
          <>
            <button type="button" className="dc-wp-btn" disabled={busy} onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="dc-wp-btn" disabled={busy} onClick={onDnc}>
              {h.doNotCall ? 'Allow calls' : 'Do not call'}
            </button>
            <button type="button" className="dc-wp-btn" disabled={busy} onClick={onRemove}>
              Remove
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Line types offered for a number, same list as the claimant's contacts. */
const LINE_TYPES = ['Mobile', 'Landline', 'VOIP'];
/** The contact slots a person row has. Past these a number has nowhere to go. */
const MAX_PHONES = 4;
const MAX_EMAILS = 2;

/** Ten digits, or null for anything that is not a whole US number. */
function phoneDigits(v: string): string | null {
  const d = String(v || '').replace(/[^0-9]/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
}

/**
 * One person, added by hand or corrected after the fact. A missed heir, or
 * the relative, neighbor or friend the course says to ring when the claimant
 * cannot be reached directly. Every field but the name is optional: a
 * neighbor's first name and a phone number is a real lead.
 *
 * The same form edits a person already on file, because a name read off a
 * filing can be misspelled and a relative's second number turns up later.
 * Phones and emails go up as whole lists, so removing one here removes it.
 */
function PersonForm({
  leadId,
  person,
  onSaved,
  onCancel,
  say,
}: {
  leadId: string;
  /** The person being edited, or absent to add a new one. */
  person?: Heir;
  onSaved: () => void;
  onCancel: () => void;
  say: (msg: string) => void;
}) {
  const [name, setName] = useState(person?.name || '');
  const [role, setRole] = useState(person?.role || 'relative');
  const [relationship, setRelationship] = useState(person?.relationship || '');
  const [share, setShare] = useState(person?.share || '');
  const [phones, setPhones] = useState<{ number: string; type: string; dnc: string | null }[]>(
    person?.phones.length
      ? person.phones.map((p) => ({ number: phoneDisplay(p.number), type: p.type || '', dnc: p.dnc }))
      : [{ number: '', type: 'Mobile', dnc: null }],
  );
  const [emails, setEmails] = useState<string[]>(person?.emails.length ? [...person.emails] : ['']);
  const [street, setStreet] = useState(person?.street || '');
  const [city, setCity] = useState(person?.city || '');
  const [state, setState] = useState(person?.state || '');
  const [zip, setZip] = useState(person?.zip || '');
  const [note, setNote] = useState(person?.callNotes || '');
  const [deceased, setDeceased] = useState(!!person?.deceased);
  const [dateOfDeath, setDateOfDeath] = useState(person?.dateOfDeath ? String(person.dateOfDeath).slice(0, 10) : '');
  const [saving, setSaving] = useState(false);
  const isHeir = role === 'heir';

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
  const small: React.CSSProperties = { padding: '2px 8px', fontSize: 11 };

  const setPhone = (i: number, patch: Partial<{ number: string; type: string }>) =>
    setPhones((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const setEmail = (i: number, v: string) => setEmails((list) => list.map((e, j) => (j === i ? v : e)));

  const save = async () => {
    const who = name.trim();
    if (!who) {
      say('A person needs a name.');
      return;
    }
    const keptPhones = phones.filter((p) => p.number.trim());
    // Said out loud rather than dropped. The API keeps only whole numbers, so
    // a typo here used to vanish on save with nothing to say it had.
    const badPhone = keptPhones.find((p) => !phoneDigits(p.number));
    if (badPhone) {
      say(`${badPhone.number.trim()} is not a full phone number.`);
      return;
    }
    const keptEmails = emails.map((e) => e.trim()).filter(Boolean);
    const badEmail = keptEmails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (badEmail) {
      say(`${badEmail} is not an email address.`);
      return;
    }
    const body = {
      name: who,
      role,
      relationship: relationship.trim() || null,
      share: isHeir ? share.trim() || null : null,
      phones: keptPhones.map((p) => ({ number: phoneDigits(p.number) as string, type: p.type || null })),
      emails: keptEmails,
      street: street.trim() || null,
      city: city.trim() || null,
      state: state.trim() || null,
      zip: zip.trim() || null,
      callNotes: note.trim() || null,
      // Only an heir can be filed as deceased. Anybody else who has died is
      // no route to the claimant and is removed, not kept.
      ...(person ? { deceased: isHeir && deceased, dateOfDeath: isHeir && deceased && dateOfDeath ? dateOfDeath : null } : {}),
    };
    setSaving(true);
    try {
      if (person) {
        await surplusAPI.updateHeir(person.id, body);
        say(`${who} saved.`);
      } else {
        await surplusAPI.addHeir(leadId, body);
        say(`${who} added as ${personRoleLabel(role).toLowerCase()}.`);
      }
      onSaved();
    } catch (err: any) {
      say(err?.response?.data?.message || (person ? 'That person could not be saved.' : 'That person could not be added.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 6, padding: 10, border: '1px solid var(--border)', borderRadius: 8, marginTop: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 6 }}>
        <input style={field} value={name} placeholder="Name" onChange={(e) => setName(e.target.value)} autoFocus />
        <select style={field} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          {SURPLUS_PERSON_ROLES.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <input
        style={field}
        value={relationship}
        placeholder={isHeir ? 'Relationship as printed: Son, Surviving Spouse' : 'How they know the claimant: lived next door, works with them'}
        onChange={(e) => setRelationship(e.target.value)}
      />
      {isHeir && (
        <input style={field} value={share} placeholder="Share as printed: 50% Remainder Interest, optional" onChange={(e) => setShare(e.target.value)} />
      )}

      {phones.map((p, i) => (
        <div key={`p${i}`} style={{ display: 'grid', gridTemplateColumns: '1fr 110px auto', gap: 6, alignItems: 'center' }}>
          <input
            style={field}
            value={p.number}
            placeholder={i === 0 ? 'Phone' : `Phone ${i + 1}`}
            inputMode="tel"
            onChange={(e) => setPhone(i, { number: e.target.value })}
            aria-label={`Phone ${i + 1}`}
          />
          <select style={field} value={p.type} onChange={(e) => setPhone(i, { type: e.target.value })} aria-label={`Phone ${i + 1} line type`}>
            <option value="">Type</option>
            {/* A trace can file a type of its own; keep it pickable. */}
            {(p.type && !LINE_TYPES.includes(p.type) ? [...LINE_TYPES, p.type] : LINE_TYPES).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {p.dnc && DNC_STATE[p.dnc] && (
              <span style={{ fontSize: 11, color: 'var(--red)', whiteSpace: 'nowrap' }}>{DNC_STATE[p.dnc].label}</span>
            )}
            <button
              type="button"
              className="dc-wp-btn"
              style={small}
              aria-label={`Remove phone ${i + 1}`}
              title="Remove this number"
              onClick={() => setPhones((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : [{ number: '', type: 'Mobile', dnc: null }]))}
            >
              &times;
            </button>
          </div>
        </div>
      ))}
      {phones.length < MAX_PHONES && (
        <div>
          <button
            type="button"
            className="dc-wp-btn"
            style={small}
            onClick={() => setPhones((list) => [...list, { number: '', type: 'Mobile', dnc: null }])}
          >
            + Add another phone
          </button>
        </div>
      )}

      {emails.map((e, i) => (
        <div key={`e${i}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center' }}>
          <input
            style={field}
            value={e}
            type="email"
            placeholder={i === 0 ? 'Email' : `Email ${i + 1}`}
            onChange={(ev) => setEmail(i, ev.target.value)}
            aria-label={`Email ${i + 1}`}
          />
          <button
            type="button"
            className="dc-wp-btn"
            style={small}
            aria-label={`Remove email ${i + 1}`}
            title="Remove this email"
            onClick={() => setEmails((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : ['']))}
          >
            &times;
          </button>
        </div>
      ))}
      {emails.length < MAX_EMAILS && (
        <div>
          <button type="button" className="dc-wp-btn" style={small} onClick={() => setEmails((list) => [...list, ''])}>
            + Add another email
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 60px 80px', gap: 6 }}>
        <input style={field} value={street} placeholder="Street" onChange={(e) => setStreet(e.target.value)} />
        <input style={field} value={city} placeholder="City" onChange={(e) => setCity(e.target.value)} />
        <input style={field} value={state} placeholder="ST" maxLength={2} onChange={(e) => setState(e.target.value)} />
        <input style={field} value={zip} placeholder="Zip" onChange={(e) => setZip(e.target.value)} />
      </div>
      <input style={field} value={note} placeholder="Note, optional" onChange={(e) => setNote(e.target.value)} />
      {person && isHeir && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={deceased} onChange={(e) => setDeceased(e.target.checked)} />
            Deceased
          </label>
          {deceased && (
            <input
              style={{ ...field, width: 160 }}
              type="date"
              value={dateOfDeath}
              onChange={(e) => setDateOfDeath(e.target.value)}
              aria-label="Date of death"
            />
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="dc-wp-btn" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="dc-wp-btn on" disabled={saving || !name.trim()} onClick={save}>
          {person ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  );
}

/** The Add a person button, opening the same form empty. */
function AddPerson({
  leadId,
  claimant,
  busy,
  say,
  onAdded,
}: {
  leadId: string;
  claimant: string;
  busy: boolean;
  say: (msg: string) => void;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div>
        <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => setOpen(true)}>
          Add a person
        </button>
        <span style={{ fontSize: 11, color: 'var(--faint)', marginLeft: 8 }}>
          An heir the filing missed, or a relative or neighbor who may know where {claimant} is.
        </span>
      </div>
    );
  }

  return (
    <PersonForm
      leadId={leadId}
      say={say}
      onCancel={() => setOpen(false)}
      onSaved={() => {
        setOpen(false);
        onAdded();
      }}
    />
  );
}

/**
 * "This number reaches someone else." A skip trace files numbers on the case,
 * not on the person, so the son's cell sits on the father's row and every
 * text from it is logged as the father. Picking who it really reaches moves
 * the number to their row (or a new person) and re-files the thread.
 */
export function MoveNumber({
  leadId,
  number,
  currentHeirId,
  people,
  claimant,
  claimantDeceased,
  say,
  onChanged,
}: {
  leadId: string;
  number: string;
  /** Whose row the number sits on now; null for the claimant's. */
  currentHeirId: string | null;
  people: { id: string; name: string; deceased: boolean }[];
  claimant: string;
  claimantDeceased: boolean;
  say: (msg: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('');
  const [newName, setNewName] = useState('');
  const [newRel, setNewRel] = useState('');
  const [busy, setBusy] = useState(false);
  const field: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    fontSize: 12.5,
    padding: '6px 8px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--surface2)',
    color: 'inherit',
  };

  const options: { id: string; label: string }[] = [
    ...(currentHeirId && !claimantDeceased ? [{ id: 'claimant', label: `${claimant} (the claimant)` }] : []),
    ...people.filter((p) => p.id !== currentHeirId && !p.deceased).map((p) => ({ id: p.id, label: p.name })),
    { id: 'new', label: 'Someone new on the case' },
  ];
  const canMove = !!choice && (choice !== 'new' || !!newName.trim()) && !busy;

  const move = async () => {
    if (!canMove) return;
    const to =
      choice === 'claimant'
        ? ({ claimant: true } as const)
        : choice === 'new'
          ? { newPerson: { name: newName.trim(), relationship: newRel.trim() || null } }
          : { heirId: choice };
    setBusy(true);
    try {
      const r = await surplusAPI.reassignNumber(leadId, { number, to });
      const n = r.data?.reattributed || { messages: 0, calls: 0 };
      say(
        `${phoneDisplay(number)} now reaches ${r.data?.name || 'them'}.` +
          (n.messages || n.calls ? ` ${n.messages} text${n.messages === 1 ? '' : 's'} and ${n.calls} call${n.calls === 1 ? '' : 's'} re-filed.` : ''),
      );
      setOpen(false);
      setChoice('');
      setNewName('');
      setNewRel('');
      onChanged();
    } catch (e: any) {
      say(e?.response?.data?.message || 'The number could not be moved.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="dc-wp-btn" title="This number reaches someone else on the case" onClick={() => setOpen(true)}>
        Reaches someone else
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', marginTop: 4 }}>
      <label style={{ fontSize: 11, color: 'var(--dim)' }}>Who does {phoneDisplay(number)} actually reach?</label>
      <select style={field} value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">Pick a person</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {choice === 'new' && (
        <div style={{ display: 'flex', gap: 4 }}>
          <input style={field} placeholder="Their name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input style={field} placeholder="Relationship (son, neighbor)" value={newRel} onChange={(e) => setNewRel(e.target.value)} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button" className="dc-wp-btn on" disabled={!canMove} onClick={move}>
          {busy ? 'Moving' : 'Move the number'}
        </button>
        <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
