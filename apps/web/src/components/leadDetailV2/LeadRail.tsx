'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { leadsAPI, callsAPI, tasksAPI, authAPI } from '@/lib/api';
import PropertyPhoto from '@/components/PropertyPhoto';
import LeadQueueNav from '@/components/leadDetailV2/LeadQueueNav';
import ShareDealModal from '@/components/ShareDealModal';
import ScheduleFollowUpModal from '@/components/ScheduleFollowUpModal';
import { formatPhoneDisplay, getLeadAddressLine, getLeadDisplayName } from '@/lib/format';
import { zillowUrl, realtorUrl } from '@/lib/externalLinks';
import { readLeadQueue } from '@/lib/leadQueue';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'NEW', label: 'New Lead' },
  { value: 'ATTEMPTING_CONTACT', label: 'Attempting Contact' },
  { value: 'QUALIFYING', label: 'Qualifying' },
  { value: 'QUALIFIED', label: 'Qualified' },
  { value: 'OFFER_SENT', label: 'Offer Made' },
  { value: 'NEGOTIATING', label: 'Negotiating' },
  { value: 'UNDER_CONTRACT', label: 'Under Contract' },
  { value: 'CLOSING', label: 'Closing' },
  { value: 'ACQUIRED', label: 'Acquired' },
  { value: 'SOLD', label: 'Sold' },
  { value: 'SOLD_LOSS', label: 'Sold (Loss)' },
  { value: 'HELD_LONG_TERM', label: 'Held (Long Term)' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'CLOSED_LOST', label: 'Closed / Lost' },
  { value: 'NURTURE', label: 'Nurture' },
  { value: 'DEAD', label: 'Dead' },
];

interface Props {
  lead: any;
  onLeadPatch: (patch: any) => void;
  onMarkDead: () => void;
}

// Self-contained left rail for the lead workspace. Owns its own API calls and
// modals so it can be dropped into both /leads/[id] and /leads/[id]/comps-analysis.
export default function LeadRail({ lead, onLeadPatch, onMarkDead }: Props) {
  const leadId = lead.id;
  const router = useRouter();
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingTier, setSavingTier] = useState(false);
  const [savingAutoRespond, setSavingAutoRespond] = useState(false);
  const [initiatingCall, setInitiatingCall] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [backHref, setBackHref] = useState('/leads');

  useEffect(() => {
    leadsAPI.getTasks(leadId).then((res) => setTasks(res.data || [])).catch(() => {});
  }, [leadId]);
  useEffect(() => {
    authAPI.getMe().then((res) => setCurrentUser(res.data)).catch(() => {});
    const queue = readLeadQueue();
    if (queue?.returnUrl) setBackHref(queue.returnUrl);
  }, []);

  const refreshTasks = () => leadsAPI.getTasks(leadId).then((res) => setTasks(res.data || [])).catch(() => {});

  const handleStatusChange = async (status: string) => {
    setSavingStatus(true);
    try {
      await leadsAPI.update(leadId, { status });
      onLeadPatch({ status });
    } catch (err) {
      console.error('Failed to update status', err);
      alert('Failed to update stage');
    } finally {
      setSavingStatus(false);
    }
  };

  const handleSetTier = async (tier: number | null) => {
    setSavingTier(true);
    try {
      await leadsAPI.update(leadId, { tier });
      onLeadPatch({ tier });
    } catch (err) {
      console.error('Failed to set tier', err);
    } finally {
      setSavingTier(false);
    }
  };

  const handleToggleAutoRespond = async () => {
    setSavingAutoRespond(true);
    try {
      await leadsAPI.toggleAutoRespond(leadId, !lead.autoRespond);
      onLeadPatch({ autoRespond: !lead.autoRespond });
    } catch (err) {
      console.error('Failed to toggle auto-respond', err);
      alert('Failed to toggle auto-respond');
    } finally {
      setSavingAutoRespond(false);
    }
  };

  const handleAiCall = async () => {
    setInitiatingCall(true);
    try {
      await callsAPI.initiateAiCall(leadId);
      alert('AI call initiated!');
    } catch (err) {
      console.error('Failed to initiate AI call', err);
      alert('Failed to initiate AI call');
    } finally {
      setInitiatingCall(false);
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    try {
      await tasksAPI.complete(taskId, currentUser?.id);
      refreshTasks();
    } catch (err) {
      console.error('Failed to complete task', err);
    }
  };

  const displayName = getLeadDisplayName(lead);
  const addressLine = getLeadAddressLine(lead);
  const isDead = lead.status === 'DEAD';
  const contactDisabled = !lead.sellerPhone || !!lead.doNotContact || isDead;
  const mao = (() => {
    if (!lead.arv) return null;
    const pct = (lead.maoPercent ?? 70) / 100;
    return Math.round(lead.arv * pct - (lead.repairCosts ?? 0) - (lead.assignmentFee ?? 0));
  })();
  const openTasks = tasks.filter((t: any) => !t.completed);

  return (
    <div className="p-4 space-y-4 text-sm">
      {/* Back to queue + position */}
      <div className="flex items-center justify-between gap-2">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Leads
        </Link>
        <LeadQueueNav leadId={leadId} />
      </div>

      {/* Identity */}
      <div className="flex items-start gap-3">
        <PropertyPhoto src={lead.primaryPhoto} scoreBand={lead.scoreBand} address={lead.propertyAddress} size="sm" />
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-tight truncate" title={displayName}>
            {displayName}
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">{addressLine}</p>
          {isDead && (
            <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-[11px] font-semibold border border-red-300 dark:border-red-800">
              💀 DEAD
            </span>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-1.5">
        <RailAction
          icon="📞"
          label="Call"
          disabled={contactDisabled}
          href={contactDisabled ? undefined : `tel:${lead.sellerPhone}`}
          title={contactDisabled ? 'Calling unavailable' : 'Call seller'}
        />
        <RailAction
          icon="💬"
          label="Text"
          disabled={contactDisabled}
          onClick={() => router.push(`/leads/${leadId}?tab=communications`)}
          title={contactDisabled ? 'Texting unavailable' : 'Open conversation'}
        />
        <RailAction
          icon="🤖"
          label="AI Call"
          disabled={contactDisabled || initiatingCall}
          onClick={handleAiCall}
          title="Start AI call"
        />
        <RailAction icon="📅" label="Follow-up" onClick={() => setShowFollowUpModal(true)} title="Schedule follow-up" />
        <RailAction icon="🤝" label="Share" onClick={() => setShowShareModal(true)} title="Share with partners" />
        <RailAction icon="💰" label="Offer" href={`/leads/${leadId}/comps-analysis?tab=deal-intel`} title="Build an offer" />
        <RailAction icon="💀" label="Dead" danger disabled={isDead} onClick={onMarkDead} title="Mark lead dead" />
        <RailMoreMenu lead={lead} leadId={leadId} onLeadPatch={onLeadPatch} />
      </div>

      {/* Seller contact */}
      <RailSection title="Seller">
        <dl className="space-y-1.5">
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500 dark:text-gray-400">Phone</dt>
            <dd className="text-gray-900 dark:text-gray-100 text-right">
              {lead.sellerPhone ? (
                lead.doNotContact ? formatPhoneDisplay(lead.sellerPhone) : (
                  <a href={`tel:${lead.sellerPhone}`} className="hover:text-primary-600 hover:underline">
                    {formatPhoneDisplay(lead.sellerPhone)}
                  </a>
                )
              ) : '—'}
            </dd>
          </div>
          {lead.sellerEmail && (
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500 dark:text-gray-400">Email</dt>
              <dd className="text-gray-900 dark:text-gray-100 text-right truncate" title={lead.sellerEmail}>{lead.sellerEmail}</dd>
            </div>
          )}
          {lead.source && (
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500 dark:text-gray-400">Source</dt>
              <dd className="text-gray-900 dark:text-gray-100 text-right">{lead.source}</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500 dark:text-gray-400">Touches</dt>
            <dd className="text-gray-900 dark:text-gray-100 text-right">{lead.touchCount ?? 0}</dd>
          </div>
        </dl>
        {lead.doNotContact && (
          <div className="mt-2 px-2 py-1.5 rounded bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
            Do Not Contact
          </div>
        )}
      </RailSection>

      {/* Stage + tier + AI mode */}
      <RailSection title="Pipeline">
        <div className="space-y-3">
          <div>
            <RailLabel>Stage</RailLabel>
            <select
              value={lead.status}
              disabled={savingStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="mt-1 w-full text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div>
            <RailLabel>Deal Tier</RailLabel>
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {[
                { tier: 1, active: 'border-green-500 bg-green-500 text-white', idle: 'border-green-300 dark:border-green-800 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950' },
                { tier: 2, active: 'border-yellow-500 bg-yellow-500 text-white', idle: 'border-yellow-300 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-950' },
                { tier: 3, active: 'border-gray-500 bg-gray-500 text-white', idle: 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800' },
              ].map(({ tier, active, idle }) => {
                const isActive = lead.tier === tier;
                return (
                  <button
                    key={tier}
                    type="button"
                    disabled={savingTier}
                    onClick={() => handleSetTier(isActive ? null : tier)}
                    title={tier === 1 ? 'Send a contract now' : tier === 2 ? 'Opportunity, keep pursuing' : 'Low chance, dead/no go'}
                    className={`px-2 py-1 rounded-lg border-2 text-xs font-semibold transition-colors disabled:opacity-50 ${isActive ? active : idle}`}
                  >
                    T{tier}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <RailLabel>AI Auto-Respond</RailLabel>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {lead.autoRespond ? 'AI replies automatically' : 'Manual mode'}
              </div>
            </div>
            <button
              type="button"
              disabled={savingAutoRespond}
              onClick={handleToggleAutoRespond}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                lead.autoRespond ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
              } ${savingAutoRespond ? 'opacity-50' : ''}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  lead.autoRespond ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </RailSection>

      <RailSection title="Valuation">
        <div className="space-y-1.5">
          <RailStat
            label="ARV"
            value={lead.arv ? `$${lead.arv.toLocaleString()}` : null}
            valueClass="text-green-700 dark:text-green-400"
            hint={lead.arvConfidence ? `${lead.arvConfidence}% conf` : undefined}
          />
          <RailStat
            label="Asking"
            value={lead.askingPrice ? `$${lead.askingPrice.toLocaleString()}` : null}
            hint={lead.arv && lead.askingPrice ? `${((lead.askingPrice / lead.arv) * 100).toFixed(0)}% of ARV` : undefined}
          />
          <RailStat
            label={`MAO (${Math.round(((lead.maoPercent ?? 70) / 100) * 100)}%)`}
            value={mao !== null ? `$${Math.max(mao, 0).toLocaleString()}` : null}
            valueClass="text-blue-700 dark:text-blue-400"
            hint={
              mao !== null && lead.askingPrice
                ? lead.askingPrice <= mao
                  ? 'Under MAO ✓'
                  : `$${(lead.askingPrice - mao).toLocaleString()} over`
                : undefined
            }
          />
        </div>
        <Link
          href={`/leads/${leadId}/comps-analysis`}
          className="mt-2 block text-center text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
        >
          Full comps analysis →
        </Link>
      </RailSection>

      <RailSection title="CAMP Discovery">
        <div className="grid grid-cols-2 gap-1.5">
          <CampChip label="Priority" value={lead.timeline ? `${lead.timeline} days` : null} complete={lead.campPriorityComplete} />
          <CampChip label="Money" value={lead.askingPrice ? `$${lead.askingPrice.toLocaleString()}` : null} complete={lead.campMoneyComplete} />
          <CampChip label="Challenge" value={lead.conditionLevel || null} complete={lead.campChallengeComplete} />
          <CampChip label="Authority" value={lead.ownershipStatus?.replace(/_/g, ' ') || null} complete={lead.campAuthorityComplete} />
        </div>
      </RailSection>

      <RailSection title={`Follow-Ups${openTasks.length ? ` (${openTasks.length})` : ''}`}>
        {openTasks.length > 0 ? (
          <div className="space-y-1.5">
            {openTasks.map((task: any) => (
              <div key={task.id} className="flex items-start gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-950">
                <button
                  type="button"
                  onClick={() => handleCompleteTask(task.id)}
                  className="mt-0.5 w-3.5 h-3.5 rounded border-2 border-gray-300 dark:border-gray-600 hover:border-primary-500 flex-shrink-0 transition-colors"
                  title="Mark complete"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{task.title}</div>
                  {task.dueDate && (
                    <div className="text-[11px] text-gray-400 dark:text-gray-500">
                      {format(new Date(task.dueDate), 'MMM d · h:mm a')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 dark:text-gray-500">No follow-ups scheduled.</p>
        )}
        <button
          type="button"
          onClick={() => setShowFollowUpModal(true)}
          className="mt-2 w-full text-center text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
        >
          + Schedule follow-up
        </button>
      </RailSection>

      <ScheduleFollowUpModal
        open={showFollowUpModal}
        onClose={() => setShowFollowUpModal(false)}
        onCreated={refreshTasks}
        lead={{
          id: leadId,
          propertyAddress: lead.propertyAddress,
          propertyCity: lead.propertyCity,
          propertyState: lead.propertyState,
          sellerFirstName: lead.sellerFirstName,
          sellerLastName: lead.sellerLastName,
        }}
      />
      <ShareDealModal
        leadId={leadId}
        propertyAddress={`${lead.propertyAddress}, ${lead.propertyCity}`}
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
      />
    </div>
  );
}

function RailAction({
  icon,
  label,
  onClick,
  href,
  disabled,
  danger,
  title,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  const className = `flex flex-col items-center gap-0.5 px-1 py-2 rounded-lg border text-[11px] font-medium transition-colors ${
    danger
      ? 'border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950'
      : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
  } ${disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}`;
  const inner = (
    <>
      <span className="text-base leading-none">{icon}</span>
      <span className="truncate w-full text-center">{label}</span>
    </>
  );
  if (href && !disabled) {
    return href.startsWith('/') ? (
      <Link href={href} title={title} className={className}>{inner}</Link>
    ) : (
      <a href={href} title={title} className={className}>{inner}</a>
    );
  }
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={title} className={className}>
      {inner}
    </button>
  );
}

function RailMoreMenu({ lead, leadId, onLeadPatch }: { lead: any; leadId: string; onLeadPatch: (p: any) => void }) {
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const addressParts = {
    address: lead.propertyAddress,
    city: lead.propertyCity,
    state: lead.propertyState,
    zip: lead.propertyZip,
  };

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await leadsAPI.refreshPropertyDetails(leadId);
      const refreshed = await leadsAPI.get(leadId);
      onLeadPatch(refreshed.data);
    } catch (err: any) {
      alert(`Refresh failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setRefreshing(false);
      setOpen(false);
    }
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/leads/${leadId}`;
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
          setOpen(false);
        }, 1200);
      },
      () => alert('Could not copy link'),
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="More actions"
        className="w-full h-full flex flex-col items-center justify-center gap-0.5 px-1 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-[11px] font-medium transition-colors"
      >
        <span className="text-base leading-none">⋯</span>
        <span>More</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-52 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 z-30">
          <a
            href={zillowUrl(addressParts)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            Open in Zillow
          </a>
          <a
            href={realtorUrl(addressParts)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            Open in Realtor.com
          </a>
          <div className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh from REAPI'}
          </button>
          <button
            type="button"
            onClick={handleCopyLink}
            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            {copied ? 'Copied!' : 'Copy lead link'}
          </button>
        </div>
      )}
    </div>
  );
}

function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
      {children}
    </div>
  );
}

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="border-t border-gray-100 dark:border-gray-800 pt-3 group">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5 mb-2">
        <svg
          className="w-3 h-3 text-gray-400 transition-transform group-open:rotate-90"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">{title}</span>
      </summary>
      {children}
    </details>
  );
}

function RailStat({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string | null;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-right">
        <span className={`font-semibold ${value ? valueClass || 'text-gray-900 dark:text-gray-100' : 'text-gray-300 dark:text-gray-600'}`}>
          {value || '—'}
        </span>
        {hint && <span className="block text-[11px] text-gray-400 dark:text-gray-500">{hint}</span>}
      </span>
    </div>
  );
}

function CampChip({ label, value, complete }: { label: string; value: string | null; complete: boolean }) {
  return (
    <div
      className={`px-2 py-1.5 rounded-lg border text-xs ${
        complete
          ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950'
          : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-gray-600 dark:text-gray-300">{label}</span>
        {complete && <span className="text-green-600 dark:text-green-400">✓</span>}
      </div>
      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{value || 'Pending'}</div>
    </div>
  );
}
