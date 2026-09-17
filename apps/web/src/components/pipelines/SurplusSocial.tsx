'use client';

import { useState } from 'react';
import { surplusAPI } from '@/lib/api';
import { fmtDate } from './format';
import type { SocialProfile } from '@/lib/surplus-social';

/**
 * A social profile on a claim, as a row a person acts on.
 *
 * Three states. A CANDIDATE is what the search offered, with the evidence
 * beside it, and the two buttons are the identification: it is them, or it
 * is not. A CONFIRMED profile is a contact: open it, message them in the
 * platform's own app, and log that a message went out so it counts as a
 * touch. A REJECTED one is kept out of sight so the search never offers it
 * again.
 *
 * Nothing here sends anything. The platforms forbid automated messages and
 * would close the team's accounts; the person sends, this records.
 */
export function SocialProfileRow({
  p,
  say,
  onChanged,
}: {
  p: SocialProfile;
  say: (msg: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (what: string, fn: () => Promise<any>, done: string) => {
    setBusy(what);
    try {
      await fn();
      say(done);
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setBusy(null);
    }
  };
  const candidate = p.status === 'candidate';
  const rejected = p.status === 'rejected';
  const name = p.displayName || p.handle || p.url.replace(/^https?:\/\/(www\.)?/, '');
  const tone = candidate ? (p.confidence === 'strong' ? 'var(--mint)' : 'var(--amber)') : rejected ? 'var(--faint)' : 'var(--mint)';

  return (
    <div className="dc-wp-contact" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="dc-wp-contact-main" style={{ flex: '1 1 200px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="num" style={{ textDecoration: rejected ? 'line-through' : undefined, color: rejected ? 'var(--faint)' : undefined }}>
              {name}
            </span>
            <span className="meta">{p.platformLabel}</span>
            {candidate && (
              <span className="meta" style={{ color: tone, fontWeight: 700 }}>
                {p.confidence === 'strong' ? 'likely them, check' : 'possibly them, check'}
              </span>
            )}
            {!candidate && !rejected && p.foundBy === 'search' && <span className="meta" style={{ color: tone }}>confirmed</span>}
            {rejected && <span className="meta">not them</span>}
            {p.messageCount > 0 && (
              <span className="meta" style={{ color: 'var(--mint)' }}>
                {p.messageCount === 1 ? 'messaged' : `${p.messageCount} messages`} {p.lastMessagedAt ? fmtDate(p.lastMessagedAt) : ''}
              </span>
            )}
          </div>
          {p.evidence && !rejected && (
            <div style={{ fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.4 }}>{p.evidence}</div>
          )}
        </div>
      </div>
      <div className="dc-wp-contact-actions" style={{ flexWrap: 'wrap' }}>
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="dc-wp-btn" style={{ padding: '4px 10px', fontSize: 11.5 }}>
          Open
        </a>
        {!rejected && p.messageUrl && (
          <a href={p.messageUrl} target="_blank" rel="noopener noreferrer" className="dc-wp-btn on" style={{ padding: '4px 10px', fontSize: 11.5 }} title="Opens a message to them in the app. Log it here afterwards.">
            Message
          </a>
        )}
        {!rejected && (
          <button
            type="button"
            className="dc-wp-btn"
            disabled={!!busy}
            title="A message went out to them through this profile. Counts as a touch."
            onClick={() => run('messaged', () => surplusAPI.socialMessaged(p.id), `${p.platformLabel} message logged.`)}
          >
            {busy === 'messaged' ? 'Logging...' : 'Log message sent'}
          </button>
        )}
        {candidate && (
          <>
            <button type="button" className="dc-wp-btn" disabled={!!busy} onClick={() => run('confirm', () => surplusAPI.setSocialProfileStatus(p.id, 'confirmed'), 'Profile confirmed.')}>
              {busy === 'confirm' ? 'Saving...' : 'It is them'}
            </button>
            <button type="button" className="dc-wp-btn" disabled={!!busy} onClick={() => run('reject', () => surplusAPI.setSocialProfileStatus(p.id, 'rejected'), 'Not them. The search will not offer it again.')}>
              {busy === 'reject' ? 'Saving...' : 'Not them'}
            </button>
          </>
        )}
        {rejected && (
          <button type="button" className="dc-wp-btn" disabled={!!busy} onClick={() => run('reopen', () => surplusAPI.setSocialProfileStatus(p.id, 'candidate'), 'Reopened for a second look.')}>
            Reopen
          </button>
        )}
        {!candidate && (
          <button
            type="button"
            className="dc-wp-btn"
            disabled={!!busy}
            onClick={() => {
              if (!window.confirm('Remove this profile from the claim?')) return;
              run('remove', () => surplusAPI.removeSocialProfile(p.id), 'Profile removed.');
            }}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The profiles for one person, candidates first, rejected ones folded away.
 * Used for the claimant on the panel and for each heir or associate.
 */
export function SocialProfileList({
  profiles,
  say,
  onChanged,
}: {
  profiles: SocialProfile[];
  say: (msg: string) => void;
  onChanged: () => void;
}) {
  const order = (p: SocialProfile) => (p.status === 'candidate' ? 0 : p.status === 'confirmed' ? 1 : 2);
  const live = profiles.filter((p) => p.status !== 'rejected').sort((a, b) => order(a) - order(b));
  const rejected = profiles.filter((p) => p.status === 'rejected');
  return (
    <div>
      {live.map((p) => (
        <SocialProfileRow key={p.id} p={p} say={say} onChanged={onChanged} />
      ))}
      {rejected.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ fontSize: 11, color: 'var(--faint)', cursor: 'pointer' }}>
            {rejected.length} rejected as not them
          </summary>
          {rejected.map((p) => (
            <SocialProfileRow key={p.id} p={p} say={say} onChanged={onChanged} />
          ))}
        </details>
      )}
    </div>
  );
}

/**
 * Paste a profile link. Confirmed on arrival: the person who found it made
 * the identification, and the search log gets a social search marked found.
 */
export function AddSocialProfile({
  leadId,
  heirId,
  say,
  onChanged,
}: {
  leadId: string;
  heirId?: string | null;
  say: (msg: string) => void;
  onChanged: () => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const u = url.trim();
    if (!u) return;
    setBusy(true);
    try {
      const r = await surplusAPI.addSocialProfile(leadId, { url: u, heirId: heirId || null });
      say(`${r.data?.platformLabel || 'Profile'} added.`);
      setUrl('');
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be added.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
      <input
        className="dc-input"
        style={{ flex: 1, minWidth: 0, fontSize: 12 }}
        value={url}
        placeholder="Paste a profile link: facebook.com/..., instagram.com/..., linkedin.com/in/..."
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add();
        }}
        aria-label="Profile link"
      />
      <button type="button" className="dc-wp-btn" disabled={busy || !url.trim()} onClick={add}>
        {busy ? 'Adding...' : 'Add profile'}
      </button>
    </div>
  );
}

/**
 * The web search for one person's profiles, paid per check and on by
 * default. Disabled with the reason when it has been turned off, so nobody
 * wonders why the button does nothing. Shows when it last ran, since a miss does not change from
 * one week to the next and running it twice buys the same answer.
 */
export function FindProfilesButton({
  leadId,
  heirId,
  who,
  searchedAt,
  paused,
  say,
  onChanged,
}: {
  leadId: string;
  heirId?: string | null;
  who: string;
  searchedAt: string | null;
  /** Null while unknown. */
  paused: boolean | null;
  say: (msg: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const find = async () => {
    if (searchedAt && !window.confirm(`The web was already searched for ${who} on ${fmtDate(searchedAt)}. Search again? It costs about fifty cents.`)) return;
    setBusy(true);
    try {
      const r = await surplusAPI.findSocialProfiles(leadId, heirId || null);
      const n = r.data?.added || 0;
      const found = r.data?.verdict?.profiles?.length || 0;
      say(
        found
          ? `${found} profile${found === 1 ? '' : 's'} found for ${who}${n < found ? `, ${found - n} already on file` : ''}. Check the evidence before messaging.`
          : `No profile found for ${who}. ${r.data?.verdict?.searched || ''}`,
      );
      onChanged();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The search failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <button
        type="button"
        className="dc-wp-btn"
        disabled={busy || paused !== false}
        title={
          paused
            ? 'The profile search is turned off in the API settings, or the API has no Anthropic key.'
            : 'Claude searches the public web for their Facebook, Instagram, LinkedIn, X and TikTok, and offers what fits with the evidence. About fifty cents.'
        }
        onClick={find}
      >
        {busy ? 'Searching the web...' : `Search the web for ${who}'s profiles`}
      </button>
      {paused && <span style={{ fontSize: 11, color: 'var(--faint)' }}>turned off in the API settings</span>}
      {searchedAt && !busy && <span style={{ fontSize: 11, color: 'var(--faint)' }}>searched {fmtDate(searchedAt)}</span>}
    </span>
  );
}
