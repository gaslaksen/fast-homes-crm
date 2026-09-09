'use client';

import { useEffect, useRef, useState } from 'react';
import { surplusAPI } from '@/lib/api';
import { DNC_STATE, phoneDisplay, fmtDate } from './format';
import { SURPLUS_PERSON_ROLES, SURPLUS_CONTACT_STATUSES, personRoleLabel } from '@/lib/surplus-people';

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
function courtRecordsSearch(county: string | null): string {
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
  relationship: string | null;
  share: string | null;
  address: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  deceased: boolean;
  dateOfDeath: string | null;
  phones: { number: string; type: string | null; dnc: string | null }[];
  emails: string[];
  cleanPhoneCount: number;
  contactMismatch: boolean;
  mismatchedName: string | null;
  trace: { state: string; label: string; tone: 'good' | 'warn' | 'bad' | 'idle'; detail: string; actionable: boolean } | null;
  doNotCall: boolean;
  callNotes: string;
  sourceCaseNumber: string | null;
  sourceDocument: string | null;
  callable: boolean;
  traceable: boolean;
}

const TONE: Record<string, string> = {
  good: 'var(--mint)',
  warn: 'var(--amber)',
  bad: 'var(--red)',
  idle: 'var(--dim)',
};

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
}: {
  leadId: string;
  claimant: string;
  /** The claimant is an estate or marked deceased, so heirs are the route. */
  claimantDeceased: boolean;
  propertyAddress: string;
  county: string | null;
  /** The county's public-access court records, from the API, or null. */
  courtRecordsUrl?: string | null;
  onCall: (n: string) => void;
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

  const trace = async (heirId: string, name: string) => {
    setBusy(true);
    say(`Skip tracing ${name}...`);
    try {
      const res = await surplusAPI.skipTraceHeirs({ heirIds: [heirId] });
      const r = res.data;
      say(
        r.contacted
          ? `Found contacts for ${name}.`
          : r.mismatched
            ? `The trace returned somebody else, so nothing was attached to ${name}.`
            : r.errors
              ? r.message || 'The trace failed.'
              : `Nothing found for ${name}.`,
      );
      load();
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The trace failed.');
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

  const living = (heirs || []).filter((h) => !h.deceased && h.isHeir);
  const dead = (heirs || []).filter((h) => h.deceased && h.isHeir);
  // People who are not heirs: a relative, a neighbor, a friend. They cannot
  // sign anything, but one of them usually knows where the claimant is.
  const associates = (heirs || []).filter((h) => !h.deceased && !h.isHeir);
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
          {living.map((h) => (
            <HeirRow
              key={h.id}
              h={h}
              busy={busy}
              onCall={onCall}
              onText={onText}
              onEmail={onEmail}
              onTrace={() => trace(h.id, h.name)}
              onDnc={() => setDnc(h)}
              onRemove={() => remove(h)}
              onStatus={(v) => setStatus(h, v)}
            />
          ))}
        </div>
      )}

      {!!associates.length && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', letterSpacing: 0.4, marginBottom: 4 }}>
            PEOPLE WHO MAY KNOW WHERE {claimantDeceased ? 'THE HEIRS ARE' : `${claimant.toUpperCase()} IS`}
          </div>
          {associates.map((h) => (
            <HeirRow
              key={h.id}
              h={h}
              busy={busy}
              onCall={onCall}
              onText={onText}
              onEmail={onEmail}
              onTrace={() => trace(h.id, h.name)}
              onDnc={() => setDnc(h)}
              onRemove={() => remove(h)}
              onStatus={(v) => setStatus(h, v)}
            />
          ))}
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
          {dead.map((h) => (
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
              <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => remove(h)} style={{ marginTop: 4 }}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HeirRow({
  h,
  busy,
  onCall,
  onText,
  onEmail,
  onTrace,
  onDnc,
  onRemove,
  onStatus,
}: {
  h: Heir;
  busy: boolean;
  onCall: (n: string) => void;
  onText: (n: string) => void;
  onEmail: (a: string) => void;
  onTrace: () => void;
  onDnc: () => void;
  onRemove: () => void;
  onStatus: (status: string) => void;
}) {
  const statusTone =
    h.contactStatus === 'message_passed' ? 'var(--mint)' : h.contactStatus === 'dead_end' ? 'var(--red)' : h.contactStatus === 'contacted' ? 'var(--amber)' : 'var(--faint)';
  return (
    <div style={{ padding: '7px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>{h.name}</b>
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
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
        {h.address || 'no address in the filing'}
        {h.sourceCaseNumber ? ` · case ${h.sourceCaseNumber}` : ''}
      </div>

      {h.trace && !h.phones.length && (
        <div style={{ fontSize: 11.5, color: TONE[h.trace.tone], marginTop: 3 }}>
          <b>{h.trace.label}.</b> <span style={{ color: 'var(--dim)' }}>{h.trace.detail}</span>
        </div>
      )}

      {h.phones.map((p) => {
        const flag = p.dnc ? DNC_STATE[p.dnc] : null;
        return (
          <div key={p.number} className="dc-wp-contact">
            <div className="dc-wp-contact-main">
              <span className="num">{phoneDisplay(p.number)}</span>
              <span className="meta">{p.type || 'Phone'}</span>
              {flag && <span className="flag">{flag.label}</span>}
            </div>
            <div className="dc-wp-contact-actions">
              <button type="button" className="dc-wp-btn" disabled={h.doNotCall} onClick={() => onCall(p.number)}>
                Call
              </button>
              <button type="button" className="dc-wp-btn" disabled={h.doNotCall} onClick={() => onText(p.number)}>
                Text
              </button>
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
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
        {/* Offered only while a submission could still tell us something. The
            heir's address comes off a recent filing, which is far better input
            than a claimant address the clerk's mail came back from. */}
        {h.traceable && (
          <button
            type="button"
            className="dc-wp-btn"
            disabled={busy || h.trace?.actionable === false}
            title={
              h.trace?.actionable === false
                ? 'Already submitted. The same address returns the same answer.'
                : `Traces ${h.address}`
            }
            onClick={onTrace}
          >
            Skip trace {h.name}
          </button>
        )}
        <button type="button" className="dc-wp-btn" disabled={busy} onClick={onDnc}>
          {h.doNotCall ? 'Allow calls' : 'Do not call'}
        </button>
        <button type="button" className="dc-wp-btn" disabled={busy} onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

/**
 * One person added by hand. A missed heir, or the relative, neighbor or
 * friend the course says to ring when the claimant cannot be reached
 * directly. Every field but the name is optional: a neighbor's first name
 * and a phone number is a real lead.
 */
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
  const [name, setName] = useState('');
  const [role, setRole] = useState('relative');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

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

  const save = async () => {
    if (!name.trim()) {
      say('A person needs a name.');
      return;
    }
    setSaving(true);
    try {
      await surplusAPI.addHeir(leadId, {
        name: name.trim(),
        role,
        relationship: relationship.trim() || null,
        phones: phone.trim() ? [phone.trim()] : [],
        emails: email.trim() ? [email.trim()] : [],
        street: street.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        zip: zip.trim() || null,
        callNotes: note.trim() || null,
      });
      say(`${name.trim()} added as ${personRoleLabel(role).toLowerCase()}.`);
      setOpen(false);
      setName('');
      setRelationship('');
      setPhone('');
      setEmail('');
      setStreet('');
      setCity('');
      setState('');
      setZip('');
      setNote('');
      onAdded();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That person could not be added.');
    } finally {
      setSaving(false);
    }
  };

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
    <div style={{ display: 'grid', gap: 6, padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
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
        placeholder={role === 'heir' ? 'Relationship as printed: Son, Surviving Spouse' : 'How they know the claimant: lived next door, works with them'}
        onChange={(e) => setRelationship(e.target.value)}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <input style={field} value={phone} placeholder="Phone" onChange={(e) => setPhone(e.target.value)} />
        <input style={field} value={email} placeholder="Email" onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 60px 80px', gap: 6 }}>
        <input style={field} value={street} placeholder="Street" onChange={(e) => setStreet(e.target.value)} />
        <input style={field} value={city} placeholder="City" onChange={(e) => setCity(e.target.value)} />
        <input style={field} value={state} placeholder="ST" maxLength={2} onChange={(e) => setState(e.target.value)} />
        <input style={field} value={zip} placeholder="Zip" onChange={(e) => setZip(e.target.value)} />
      </div>
      <input style={field} value={note} placeholder="Note, optional" onChange={(e) => setNote(e.target.value)} />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="dc-wp-btn" disabled={saving} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="button" className="dc-wp-btn on" disabled={saving || !name.trim()} onClick={save}>
          Add
        </button>
      </div>
    </div>
  );
}
