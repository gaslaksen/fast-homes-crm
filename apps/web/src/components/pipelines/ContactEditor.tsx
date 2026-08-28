'use client';

import { useEffect, useState } from 'react';
import { leadsAPI } from '@/lib/api';
import { phoneDisplay } from './format';

/**
 * Editing the contacts we hold for one lead.
 *
 * Two operations, deliberately different in kind:
 *
 * ADD replaces the whole list. The slots behind this are positional and shared
 * with the skip trace, so "write the first empty one" races with a trace
 * writing the same slots. Sending the full list, primary first, is the only
 * version that cannot lose somebody's typing.
 *
 * FLAG marks a contact as one that does not reach this person and KEEPS it.
 * Deleting a dead number loses the fact that it was tried, and the next person
 * to open the lead dials it again. It is also separate from the DNC flag, which
 * is a legal reason not to call a number that may work perfectly well.
 */

export interface EditableContact {
  numbers: { number: string; label: string; type: string | null; isPrimary: boolean; dnc: string | null; bad: boolean }[];
  emails: { address: string; isPrimary: boolean; bad: boolean }[];
}

const LINE_TYPES = ['Mobile', 'Landline', 'VOIP'];

export default function ContactEditor({
  leadId,
  onChanged,
  say,
}: {
  leadId: string;
  /** Refresh the board row and the panel, since the primary may have moved. */
  onChanged: () => void;
  say: (msg: string) => void;
}) {
  const [data, setData] = useState<EditableContact | null>(null);
  const [busy, setBusy] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newType, setNewType] = useState('Mobile');
  const [newEmail, setNewEmail] = useState('');

  const load = () => {
    leadsAPI
      .contacts(leadId)
      .then((r) => setData(r.data))
      .catch(() => setData({ numbers: [], emails: [] }));
  };

  useEffect(load, [leadId]);

  const save = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true);
    try {
      const res = await fn();
      setData(res.data);
      say(msg);
      onChanged();
    } catch (e: any) {
      say(e?.response?.data?.message || 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div style={{ fontSize: 12, color: 'var(--faint)' }}>Loading contacts...</div>;

  const addPhone = () => {
    const value = newPhone.trim();
    if (!value) return;
    save(
      () =>
        leadsAPI.setContacts(leadId, {
          phones: [
            ...data.numbers.map((n) => ({ number: n.number, type: n.type })),
            { number: value, type: newType },
          ],
        }),
      'Number added.',
    ).then(() => setNewPhone(''));
  };

  const removePhone = (number: string) =>
    save(
      () =>
        leadsAPI.setContacts(leadId, {
          phones: data.numbers.filter((n) => n.number !== number).map((n) => ({ number: n.number, type: n.type })),
        }),
      'Number removed.',
    );

  const addEmail = () => {
    const value = newEmail.trim();
    if (!value) return;
    save(
      () => leadsAPI.setContacts(leadId, { emails: [...data.emails.map((e) => e.address), value] }),
      'Email added.',
    ).then(() => setNewEmail(''));
  };

  const removeEmail = (address: string) =>
    save(
      () =>
        leadsAPI.setContacts(leadId, {
          emails: data.emails.filter((e) => e.address !== address).map((e) => e.address),
        }),
      'Email removed.',
    );

  const flag = (value: string, bad: boolean) =>
    save(
      () => leadsAPI.flagContact(leadId, value, bad),
      bad ? 'Marked as not working.' : 'Flag cleared.',
    );

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 7 }}>
        Found a better number or address? Add it here. Mark one that does not
        reach them rather than deleting it, so nobody tries it again.
      </div>

      {data.numbers.map((n) => (
        <div
          key={n.number}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0', fontSize: 12 }}
        >
          <span
            style={{
              minWidth: 120,
              textDecoration: n.bad ? 'line-through' : undefined,
              color: n.bad ? 'var(--faint)' : undefined,
            }}
          >
            {phoneDisplay(n.number)}
          </span>
          <span style={{ color: 'var(--faint)', fontSize: 11 }}>
            {n.type || 'Phone'}
            {n.isPrimary ? ' · primary' : ''}
          </span>
          {n.bad && <span style={{ color: 'var(--red)', fontSize: 11 }}>does not reach them</span>}
          <button
            type="button"
            className="dc-wp-btn"
            style={{ marginLeft: 'auto' }}
            disabled={busy}
            onClick={() => flag(n.number, !n.bad)}
            title={n.bad ? 'It works after all' : 'Disconnected, wrong party, or no such person'}
          >
            {n.bad ? 'Works' : 'Not working'}
          </button>
          <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => removePhone(n.number)}>
            Remove
          </button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input
          value={newPhone}
          onChange={(e) => setNewPhone(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addPhone()}
          placeholder="Add a phone number"
          className="dc-input"
          style={{ flex: 1 }}
        />
        <select value={newType} onChange={(e) => setNewType(e.target.value)} className="dc-input">
          {LINE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button type="button" className="dc-wp-btn" disabled={busy || !newPhone.trim()} onClick={addPhone}>
          Add
        </button>
      </div>

      {data.emails.map((e) => (
        <div
          key={e.address}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0', fontSize: 12, marginTop: 4 }}
        >
          <span
            style={{
              textDecoration: e.bad ? 'line-through' : undefined,
              color: e.bad ? 'var(--faint)' : undefined,
            }}
          >
            {e.address}
          </span>
          {e.bad && <span style={{ color: 'var(--red)', fontSize: 11 }}>bounces</span>}
          <button
            type="button"
            className="dc-wp-btn"
            style={{ marginLeft: 'auto' }}
            disabled={busy}
            onClick={() => flag(e.address, !e.bad)}
          >
            {e.bad ? 'Works' : 'Not working'}
          </button>
          <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => removeEmail(e.address)}>
            Remove
          </button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addEmail()}
          placeholder="Add an email address"
          className="dc-input"
          style={{ flex: 1 }}
        />
        <button type="button" className="dc-wp-btn" disabled={busy || !newEmail.trim()} onClick={addEmail}>
          Add
        </button>
      </div>
    </div>
  );
}
