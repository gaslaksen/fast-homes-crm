'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { leadsAPI, callsAPI, tasksAPI, authAPI } from '@/lib/api';
import Avatar from '@/components/Avatar';
import LeadQueueNav from '@/components/leadDetailV2/LeadQueueNav';
import ShareDealModal from '@/components/ShareDealModal';
import ScheduleFollowUpModal from '@/components/ScheduleFollowUpModal';
import { getPrimaryAction } from './actionMap';
import { getStage } from '@/lib/pipelineStages';
import { formatPhoneDisplay, getLeadAddressLine, getLeadDisplayName } from '@/lib/format';
import { zillowUrl, realtorUrl } from '@/lib/externalLinks';
import { readLeadQueue } from '@/lib/leadQueue';

const STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'NEW', label: 'New' },
  { value: 'ATTEMPTING_CONTACT', label: 'Attempting Contact' },
  { value: 'QUALIFYING', label: 'Qualifying' },
  { value: 'QUALIFIED', label: 'Qualified' },
  { value: 'OFFER_SENT', label: 'Offer Sent' },
  { value: 'NEGOTIATING', label: 'Negotiating' },
  { value: 'UNDER_CONTRACT', label: 'Under Contract' },
  { value: 'CLOSING', label: 'Closing' },
  { value: 'ACQUIRED', label: 'Acquired' },
  { value: 'SOLD', label: 'Sold' },
  { value: 'SOLD_LOSS', label: 'Sold (Loss)' },
  { value: 'HELD_LONG_TERM', label: 'Held (Long Term)' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'CLOSED_LOST', label: 'Closed Lost' },
  { value: 'NURTURE', label: 'Nurture' },
  { value: 'DEAD', label: 'Dead' },
];

// Tier styling mirrors PipelineTierCard on the Overview tab.
const TIERS: { value: 1 | 2 | 3; label: string; desc: string; cls: string }[] = [
  { value: 1, label: 'T1', desc: 'Contract now', cls: 'border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300' },
  { value: 2, label: 'T2', desc: 'Keep pursuing', cls: 'border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-300' },
  { value: 3, label: 'T3', desc: 'Cold / unlikely', cls: 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400' },
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
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [backHref, setBackHref] = useState('/leads');

  useEffect(() => {
    leadsAPI.getTasks(leadId).then((res) => setTasks(res.data || [])).catch(() => {});
  }, [leadId]);
  useEffect(() => {
    authAPI.getMe().then((res) => setCurrentUser(res.data)).catch(() => {});
    authAPI.getTeam().then((res) => setTeamMembers(res.data || [])).catch(() => {});
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

  const handleAssign = async () => {
    if (!assignUserId) return;
    setAssignSaving(true);
    try {
      await leadsAPI.assign(leadId, assignUserId, lead.assignedStage || '');
      const member = teamMembers.find((m: any) => m.id === assignUserId);
      onLeadPatch({ assignedTo: member || { id: assignUserId }, assignedToUserId: assignUserId });
      setAssignUserId('');
    } catch (err) {
      console.error('Failed to assign lead', err);
      alert('Failed to assign lead');
    } finally {
      setAssignSaving(false);
    }
  };

  const handleUnassign = async () => {
    setAssignSaving(true);
    try {
      await leadsAPI.unassign(leadId);
      onLeadPatch({ assignedTo: null, assignedToUserId: null, assignedStage: null });
    } catch (err) {
      console.error('Failed to unassign lead', err);
    } finally {
      setAssignSaving(false);
    }
  };

  const displayName = getLeadDisplayName(lead);
  const addressLine = getLeadAddressLine(lead);
  const isDead = lead.status === 'DEAD';
  const contactDisabled = !lead.sellerPhone || !!lead.doNotContact || isDead;
  const stageMeta = getStage(lead.status);
  const mao = (() => {
    if (!lead.arv) return null;
    const pct = (lead.maoPercent ?? 70) / 100;
    return Math.round(lead.arv * pct - (lead.repairCosts ?? 0) - (lead.assignmentFee ?? 0));
  })();
  const openTasks = tasks.filter((t: any) => !t.completed);

  // Same "what should I do next" logic as the Overview tab's Action Bar.
  const primary = getPrimaryAction(lead, null);
  const runPrimary = () => {
    switch (primary.intent) {
      case 'reply':
      case 'sms':
        return router.push(`/leads/${leadId}?tab=communications&action=reply`);
      case 'offer':
        return router.push(`/leads/${leadId}?tab=disposition&action=offer`);
      case 'follow-up':
        return setShowFollowUpModal(true);
      case 'camp':
        return router.push(`/leads/${leadId}?tab=communications&action=camp`);
      case 'contract':
        return router.push(`/leads/${leadId}?tab=disposition&action=contract`);
      case 'dispo':
        return router.push(`/leads/${leadId}?tab=disposition`);
      case 'call':
        window.location.href = `tel:${lead.sellerPhone}`;
        return;
      case 'share':
        return setShowShareModal(true);
    }
  };

  const quick = {
    onSms: () => router.push(`/leads/${leadId}?tab=communications&action=reply`),
    onCall: () => { window.location.href = `tel:${lead.sellerPhone}`; },
    onAiCall: handleAiCall,
    onFollowUp: () => setShowFollowUpModal(true),
    onShare: () => setShowShareModal(true),
    onOffer: () => router.push(`/leads/${leadId}?tab=disposition&action=offer`),
    onMarkDead: onMarkDead,
  };

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

      {/* Identity: initials avatar (same hash colors as the conversation) + name */}
      <div className="flex items-center gap-2.5">
        <Avatar name={displayName || '?'} size="md" />
        <h1 className="min-w-0 flex-1 text-lg font-bold text-gray-900 dark:text-gray-100 leading-tight truncate" title={displayName}>
          {displayName}
        </h1>
        {isDead && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-[11px] font-semibold border border-red-300 dark:border-red-800 shrink-0">
            💀 DEAD
          </span>
        )}
      </div>

      {/* Contact facts — always visible */}
      <dl className="space-y-1 text-[13px]">
        <InfoRow label="Address">{addressLine || '—'}</InfoRow>
        <InfoRow label="Phone">
          {lead.sellerPhone ? (
            lead.doNotContact ? formatPhoneDisplay(lead.sellerPhone) : (
              <a href={`tel:${lead.sellerPhone}`} className="hover:text-primary-600 hover:underline">
                {formatPhoneDisplay(lead.sellerPhone)}
              </a>
            )
          ) : '—'}
        </InfoRow>
        <InfoRow label="Email">
          {lead.sellerEmail ? (
            <a href={`mailto:${lead.sellerEmail}`} className="hover:text-primary-600 hover:underline truncate" title={lead.sellerEmail}>
              {lead.sellerEmail}
            </a>
          ) : '—'}
        </InfoRow>
        <InfoRow label="Source">{lead.source || '—'}</InfoRow>
        <InfoRow label="Touches">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full px-1.5 py-0.5">
            {lead.touchCount ?? 0}
          </span>
        </InfoRow>
      </dl>
      {lead.doNotContact && (
        <div className="px-2 py-1.5 rounded bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
          Do Not Contact
        </div>
      )}

      {/* Next step + quick actions — mirrors the Overview tab's Action Bar */}
      <div className="space-y-2">
        <PrimarySplitButton label={primary.label} onPrimary={runPrimary} quick={quick} />
        <div className="flex items-center gap-1 flex-wrap">
          <IconBtn title="Send SMS" onClick={quick.onSms} disabled={isDead}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
          </IconBtn>
          <IconBtn title="Call seller" onClick={quick.onCall} disabled={contactDisabled}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
          </IconBtn>
          <IconBtn title="Start AI call" onClick={quick.onAiCall} disabled={contactDisabled || initiatingCall}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
          </IconBtn>
          <IconBtn title="Schedule follow-up" onClick={quick.onFollowUp}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </IconBtn>
          <IconBtn title="Share with partners" onClick={quick.onShare}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
          </IconBtn>
          <IconBtn title="Send offer" onClick={quick.onOffer} disabled={isDead}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </IconBtn>
          <IconBtn title="Mark dead" onClick={quick.onMarkDead} disabled={isDead}>
            <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </IconBtn>
          <RailMoreMenu lead={lead} leadId={leadId} onLeadPatch={onLeadPatch} />
          <div className="flex-1" />
          <button
            onClick={handleToggleAutoRespond}
            disabled={savingAutoRespond}
            title={`Auto-Respond: ${lead.autoRespond ? 'ON' : 'OFF'} — click to toggle`}
            className={`text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${
              lead.autoRespond
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-300 dark:border-green-800'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-700'
            } ${savingAutoRespond ? 'opacity-50' : ''}`}
          >
            ✨ AI {lead.autoRespond ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

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

      <RailSection title="Pipeline">
        <div className="space-y-3">
          <div>
            <RailLabel>Stage</RailLabel>
            <select
              value={lead.status}
              disabled={savingStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              className={`mt-1 w-full text-sm font-semibold px-2 py-1.5 rounded-lg border cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:opacity-50 ${
                stageMeta?.color || 'bg-gray-50 dark:bg-gray-950 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
              }`}
            >
              {STAGE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div>
            <RailLabel>Deal Tier</RailLabel>
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {TIERS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => handleSetTier(lead.tier === t.value ? null : t.value)}
                  disabled={savingTier}
                  title={t.desc}
                  className={`px-2 py-1.5 rounded-lg border-2 text-xs font-bold transition-colors disabled:opacity-50 ${
                    lead.tier === t.value ? t.cls : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:border-gray-400'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <RailLabel>Assigned to</RailLabel>
            {lead.assignedTo ? (
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 min-w-0">
                  <Avatar
                    name={`${lead.assignedTo.firstName ?? ''} ${lead.assignedTo.lastName ?? ''}`}
                    avatarUrl={lead.assignedTo.avatarUrl}
                    size="sm"
                  />
                  <span className="text-gray-800 dark:text-gray-200 truncate">
                    {lead.assignedTo.firstName} {lead.assignedTo.lastName}
                    {lead.assignedStage && <span className="text-gray-400 dark:text-gray-500"> · {lead.assignedStage}</span>}
                  </span>
                </span>
                <button
                  onClick={handleUnassign}
                  disabled={assignSaving}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50 shrink-0"
                >
                  Unassign
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-2">
                <select
                  value={assignUserId}
                  onChange={(e) => setAssignUserId(e.target.value)}
                  className="flex-1 min-w-0 text-sm px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">— Select member —</option>
                  {teamMembers.map((m: any) => (
                    <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
                  ))}
                </select>
                <button
                  onClick={handleAssign}
                  disabled={!assignUserId || assignSaving}
                  className="text-xs px-3 py-1.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-50 shrink-0"
                >
                  {assignSaving ? '…' : 'Assign'}
                </button>
              </div>
            )}
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

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-16 shrink-0 text-[11px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-gray-800 dark:text-gray-200 truncate">{children}</dd>
    </div>
  );
}

// Same compact icon button as the Overview tab's Action Bar.
function IconBtn({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:opacity-40 transition-colors"
    >
      {children}
    </button>
  );
}

function PrimarySplitButton({
  label,
  onPrimary,
  quick,
}: {
  label: string;
  onPrimary: () => void;
  quick: {
    onSms: () => void;
    onCall: () => void;
    onAiCall: () => void;
    onFollowUp: () => void;
    onShare: () => void;
    onOffer: () => void;
    onMarkDead: () => void;
  };
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const item = (text: string, fn: () => void, danger = false) => (
    <button
      onClick={() => { setOpen(false); fn(); }}
      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${danger ? 'text-red-600 dark:text-red-400' : ''}`}
    >
      {text}
    </button>
  );

  return (
    <div className="relative flex w-full" ref={menuRef}>
      <button
        onClick={onPrimary}
        className="flex-1 px-4 py-2 rounded-l-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold shadow-sm transition-colors"
      >
        {label}
      </button>
      <button
        onClick={() => setOpen(!open)}
        className="px-2 py-2 rounded-r-lg bg-primary-600 hover:bg-primary-700 text-white border-l border-primary-500 shadow-sm"
        aria-label="More actions"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 z-30">
          {item('Send SMS', quick.onSms)}
          {item('Call seller', quick.onCall)}
          {item('Start AI call', quick.onAiCall)}
          {item('Schedule follow-up', quick.onFollowUp)}
          {item('Send offer', quick.onOffer)}
          {item('Share with partners', quick.onShare)}
          <div className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
          {item('Mark dead', quick.onMarkDead, true)}
        </div>
      )}
    </div>
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
        aria-label="More actions"
        className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
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
    <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500">
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
        <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">{title}</span>
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
