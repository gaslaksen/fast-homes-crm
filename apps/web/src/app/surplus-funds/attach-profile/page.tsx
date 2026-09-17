'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { surplusAPI } from '@/lib/api';
import { nameFromPageTitle, readSocialTarget, type SocialTarget } from '@/lib/surplus-social';
import '@/components/pipelines/pipeline-board.css';

/**
 * Save a profile to a card, from the Save to Dealcore bookmarklet.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Facebook keeps most personal profiles out of search engines, so the only
 * search that reliably finds a claimant is the one a person runs in their
 * own logged-in Facebook tab. That leaves the profile in one tab and the card
 * in another, with a copy and a paste between them. The bookmarklet closes
 * the gap: clicked on the profile, it opens this page carrying the profile's
 * address and title, and this page already knows which card was being
 * searched from, because the card wrote it down when the search was opened.
 *
 * Nothing is read from the other site but its address and its title, and
 * nothing is saved until the person confirms which card it belongs to: a
 * profile on the wrong card is a message to the wrong person.
 */

interface Pick {
  leadId: string;
  heirId: string | null;
  label: string;
  sub: string | null;
}

function AttachProfile() {
  const params = useSearchParams();
  const url = params.get('url') || '';
  const pageName = nameFromPageTitle(params.get('title') || '');

  const [pick, setPick] = useState<Pick | null>(null);
  const [remembered, setRemembered] = useState<SocialTarget | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Pick[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = readSocialTarget();
    setRemembered(t);
    if (t) setPick({ leadId: t.leadId, heirId: t.heirId, label: t.label, sub: t.sub });
    // No card remembered: start the picker on the name the page gave.
    else if (pageName) setQ(pageName.split(/\s+/).slice(-1)[0] || '');
  }, [pageName]);

  // The picker, for when the remembered card is not the one.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      surplusAPI
        .list({ search: term, pageSize: 20 })
        .then((r) => {
          if (!live) return;
          const rows: any[] = r.data?.data || [];
          setResults(
            rows
              .flatMap((row) => row.claimants || [])
              .slice(0, 12)
              .map((c: any) => ({
                leadId: c.id,
                heirId: null,
                label: c.claimant,
                sub: [c.county ? `${c.county} County` : null, c.caseNumber ? `case ${c.caseNumber}` : null].filter(Boolean).join(', ') || null,
              })),
          );
        })
        .catch(() => live && setResults([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const save = async () => {
    if (!pick || !url) return;
    setBusy(true);
    setError(null);
    try {
      const r = await surplusAPI.addSocialProfile(pick.leadId, { url, heirId: pick.heirId, displayName: pageName });
      setDone(`${r.data?.platformLabel || 'Profile'} saved to ${pick.label}.`);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const box: React.CSSProperties = { border: '1px solid var(--border2)', borderRadius: 10, padding: 14, background: 'var(--surface2)' };

  return (
    <div className="dc-board dc-wp" style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', padding: 20 }}>
      <div style={{ maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Save to Dealcore</div>

        {!url && (
          <div style={box}>
            No profile came with this window. Open the person&apos;s profile page and click the Save to Dealcore bookmark there.
          </div>
        )}

        {url && (
          <div style={box}>
            <div style={{ fontSize: 11, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: 0.5 }}>The profile</div>
            {pageName && <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{pageName}</div>}
            <div style={{ fontSize: 12, color: 'var(--dim)', wordBreak: 'break-all', marginTop: 2 }}>{url}</div>
          </div>
        )}

        {url && !done && (
          <div style={box}>
            <div style={{ fontSize: 11, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Save it to</div>
            {pick ? (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{pick.label}</div>
                {pick.sub && <div style={{ fontSize: 12, color: 'var(--dim)' }}>{pick.sub}</div>}
                {remembered && pick.leadId === remembered.leadId && pick.heirId === remembered.heirId && (
                  <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>The last card you searched from.</div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button type="button" className="dc-wp-btn on" disabled={busy} onClick={save}>
                    {busy ? 'Saving...' : `Save to ${pick.label}`}
                  </button>
                  <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => setPick(null)}>
                    A different card
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 6 }}>
                <input
                  className="dc-input"
                  style={{ width: '100%', fontSize: 13 }}
                  value={q}
                  autoFocus
                  placeholder="Search claimant, county or case number"
                  onChange={(e) => setQ(e.target.value)}
                  aria-label="Find the card"
                />
                {results && results.length === 0 && <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 6 }}>No claimant matches that.</div>}
                {(results || []).map((r) => (
                  <button
                    key={r.leadId}
                    type="button"
                    className="dc-wp-btn"
                    style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 6 }}
                    onClick={() => setPick(r)}
                  >
                    <b>{r.label}</b>
                    {r.sub ? <span style={{ color: 'var(--dim)' }}> · {r.sub}</span> : null}
                  </button>
                ))}
                {remembered && (
                  <button
                    type="button"
                    className="dc-wp-btn"
                    style={{ marginTop: 8 }}
                    onClick={() => setPick({ leadId: remembered.leadId, heirId: remembered.heirId, label: remembered.label, sub: remembered.sub })}
                  >
                    Back to {remembered.label}
                  </button>
                )}
              </div>
            )}
            {error && <div style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 8 }}>{error}</div>}
          </div>
        )}

        {done && (
          <div style={{ ...box, borderColor: 'var(--mint)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--mint)' }}>{done}</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
              It is on the card as a confirmed profile, with Open, Message and Log message sent. Refresh the card if it is
              already open.
            </div>
            <button type="button" className="dc-wp-btn" style={{ marginTop: 10 }} onClick={() => window.close()}>
              Close this window
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AttachProfilePage() {
  return (
    <Suspense fallback={null}>
      <AttachProfile />
    </Suspense>
  );
}
