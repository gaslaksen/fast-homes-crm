'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { campaignsAPI } from '@/lib/api';
import { fmtDate } from './format';

/**
 * Drip campaigns for each person on a surplus case.
 *
 * The person who answers is often not the claimant: a son, a neighbor, an
 * heir. Each of them can be put on a campaign of their own, on their own
 * number and email, and each person's card shows and manages theirs. The
 * claimant's sit under "Reaching" on the Case tab, everyone else's on their
 * People card.
 *
 * Enrolling stays a deliberate act by a person. Surplus outreach is regulated
 * speech under FS 45.033, so nothing here enrolls anybody on its own.
 */

export interface DripCampaign {
  id: string;
  name: string;
  isActive?: boolean;
  steps?: { channel: string }[];
}

export interface DripEnrollment {
  id: string;
  campaignId: string;
  /** Null is the claimant. */
  heirId: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'REPLIED' | 'COMPLETED' | 'OPTED_OUT' | 'REMOVED' | string;
  currentStepOrder: number;
  nextSendAt: string | null;
  toEmail: string | null;
  campaign: { id: string; name: string; steps?: { channel: string }[] };
  messageLogs?: { status: string; sentAt: string }[];
}

interface DripState {
  leadId: string;
  campaigns: DripCampaign[];
  enrollments: DripEnrollment[];
  reload: () => void;
  say: (msg: string) => void;
}

const DripContext = createContext<DripState | null>(null);

export const SurplusDripProvider = DripContext.Provider;

/**
 * Loads the campaigns and this lead's enrollments for the panel. Reloads
 * whenever `refreshKey` changes, which the panel ties to the lead row, so a
 * person marked do not call (which ends their drips on the server) shows the
 * change without reopening the panel.
 */
export function useSurplusDrips(leadId: string, refreshKey: unknown, say: (msg: string) => void): DripState {
  const [campaigns, setCampaigns] = useState<DripCampaign[]>([]);
  const [enrollments, setEnrollments] = useState<DripEnrollment[]>([]);

  useEffect(() => {
    campaignsAPI
      .list()
      .then((r) => setCampaigns((r.data || []).filter((c: DripCampaign) => c.isActive !== false)))
      .catch(() => {});
  }, []);

  const reload = useCallback(() => {
    campaignsAPI
      .leadEnrollments(leadId)
      .then((r) => setEnrollments(r.data || []))
      .catch(() => {});
  }, [leadId]);

  useEffect(() => {
    setEnrollments([]);
  }, [leadId]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  return { leadId, campaigns, enrollments, reload, say };
}

/** Where one enrollment stands, in words. */
function statusLine(e: DripEnrollment): { text: string; tone: string } {
  const total = e.campaign.steps?.length || 0;
  const sent = e.currentStepOrder;
  const last = e.messageLogs?.[0];
  const skipped = last?.status === 'SKIPPED' ? ', last step skipped' : '';
  switch (e.status) {
    case 'ACTIVE':
      return {
        text: `step ${Math.min(sent + 1, total || sent + 1)} of ${total}${
          e.nextSendAt ? `, next ${fmtDate(e.nextSendAt)}` : ''
        }${skipped}`,
        tone: 'var(--mint)',
      };
    case 'PAUSED':
      return { text: `paused after ${sent} of ${total}${skipped}`, tone: 'var(--amber)' };
    case 'REPLIED':
      return { text: `stopped, somebody on the case replied`, tone: 'var(--dim)' };
    case 'COMPLETED':
      return { text: `finished, ${total} of ${total}`, tone: 'var(--faint)' };
    case 'OPTED_OUT':
      return { text: 'opted out', tone: 'var(--red)' };
    default:
      return { text: e.status.toLowerCase(), tone: 'var(--faint)' };
  }
}

/**
 * One person's drips: what they are on, with pause, resume and remove, and a
 * picker to add them to another campaign.
 */
export function PersonDrips({
  heirId,
  name,
  emails,
  blocked,
}: {
  /** Null for the claimant. */
  heirId: string | null;
  name: string;
  /** This person's own emails, for a campaign with an email step. */
  emails: string[];
  /** Why this person cannot be enrolled, e.g. "marked do not call". */
  blocked?: string | null;
}) {
  const ctx = useContext(DripContext);
  const [busy, setBusy] = useState(false);
  // A campaign picked for a person with more than one email waits here while
  // somebody chooses which address it goes to.
  const [pickEmailFor, setPickEmailFor] = useState<string | null>(null);
  const [pickedEmail, setPickedEmail] = useState('');
  if (!ctx) return null;
  const { leadId, campaigns, enrollments, reload, say } = ctx;

  const mine = enrollments.filter((e) => (e.heirId || null) === heirId && e.status !== 'REMOVED');
  // A campaign this person is already on, finished or not, cannot be picked
  // again: enrolling them a second time would be a no-op on the server.
  const taken = new Set(mine.map((e) => e.campaignId));
  const offered = campaigns.filter((c) => !taken.has(c.id));

  const run = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      say(done);
      reload();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  const enroll = (campaignId: string, toEmail?: string) => {
    if (!campaignId) return;
    const campaign = campaigns.find((c) => c.id === campaignId);
    const mails = campaign?.steps?.some((st) => st.channel === 'EMAIL');
    if (mails && toEmail === undefined && emails.length > 1) {
      setPickEmailFor(campaignId);
      setPickedEmail(emails[0]);
      return;
    }
    run(async () => {
      await campaignsAPI.enroll(campaignId, leadId, toEmail, heirId);
      setPickEmailFor(null);
    }, `${name} added to ${campaign?.name || 'the campaign'}${toEmail ? `, emailing ${toEmail}` : ''}`);
  };

  return (
    <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
      {mine.map((e) => {
        const s = statusLine(e);
        const live = e.status === 'ACTIVE' || e.status === 'PAUSED' || e.status === 'REPLIED';
        return (
          <div
            key={e.id}
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12 }}
          >
            <span style={{ fontWeight: 600 }}>Drip: {e.campaign.name}</span>
            <span style={{ color: s.tone }}>{s.text}</span>
            {e.toEmail && <span style={{ color: 'var(--faint)' }}>emailing {e.toEmail}</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {e.status === 'ACTIVE' && (
                <button
                  type="button"
                  className="dc-wp-btn"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  disabled={busy}
                  onClick={() => run(() => campaignsAPI.pauseEnrollment(e.id), `Paused ${e.campaign.name} for ${name}`)}
                >
                  Pause
                </button>
              )}
              {(e.status === 'PAUSED' || e.status === 'REPLIED') && (
                <button
                  type="button"
                  className="dc-wp-btn"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  disabled={busy || !!blocked}
                  title={blocked ? `${name} is ${blocked}` : undefined}
                  onClick={() => run(() => campaignsAPI.resumeEnrollment(e.id), `Resumed ${e.campaign.name} for ${name}`)}
                >
                  Resume
                </button>
              )}
              {live && (
                <button
                  type="button"
                  className="dc-wp-btn"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Take ${name} off ${e.campaign.name}?`)) return;
                    run(() => campaignsAPI.removeEnrollment(e.id), `Removed ${name} from ${e.campaign.name}`);
                  }}
                >
                  Remove
                </button>
              )}
            </span>
          </div>
        );
      })}

      {pickEmailFor ? (
        <div style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
          <div style={{ fontWeight: 600 }}>
            Which of {name}&apos;s emails should &quot;
            {campaigns.find((c) => c.id === pickEmailFor)?.name || 'this campaign'}&quot; go to?
          </div>
          {emails.map((e) => (
            <label key={e} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="radio"
                name={`drip-email-${heirId || 'claimant'}`}
                checked={pickedEmail === e}
                onChange={() => setPickedEmail(e)}
              />
              {e}
            </label>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="dc-wp-btn" disabled={busy} onClick={() => setPickEmailFor(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="dc-wp-btn on"
              disabled={busy || !pickedEmail}
              onClick={() => enroll(pickEmailFor, pickedEmail)}
            >
              Enroll
            </button>
          </div>
        </div>
      ) : (
        offered.length > 0 && (
          <div>
            <select
              className="dc-wp-sel"
              value=""
              disabled={busy || !!blocked}
              onChange={(ev) => enroll(ev.target.value)}
              aria-label={`Add ${name} to a drip campaign`}
              title={blocked ? `${name} is ${blocked}` : `Add ${name} to a drip campaign`}
              style={{ fontSize: 12, padding: '3px 8px' }}
            >
              <option value="">{mine.length ? 'Add to another drip...' : 'Add to drip campaign...'}</option>
              {offered.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )
      )}
    </div>
  );
}
