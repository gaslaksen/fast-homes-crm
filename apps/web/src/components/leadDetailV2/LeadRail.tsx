'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';
import { leadsAPI, callsAPI, tasksAPI, authAPI, campaignAPI } from '@/lib/api';
import Avatar from '@/components/Avatar';
import DripEnvelopeIcon from '@/components/icons/DripEnvelopeIcon';
import LeadQueueNav from '@/components/leadDetailV2/LeadQueueNav';
import ShareDealModal from '@/components/ShareDealModal';
import ScheduleFollowUpModal from '@/components/ScheduleFollowUpModal';
import SellerPortalPanel from '@/components/SellerPortalPanel';
import { formatPhoneDisplay, getLeadDisplayName } from '@/lib/format';
import { zillowUrl, googleSearchUrl } from '@/lib/externalLinks';
import { readLeadQueue } from '@/lib/leadQueue';
import { useDialer } from '@/components/dialer/DialerContext';

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

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'MANUAL', label: 'Manual' },
  { value: 'PROPERTY_LEADS', label: 'Property Leads' },
  { value: 'GOOGLE_ADS', label: 'Google Ads' },
  { value: 'DEAL_SEARCH', label: 'Deal Search' },
  { value: 'OTHER', label: 'Other' },
];

const PROPERTY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Single Family', label: 'Single Family' },
  { value: 'Townhouse', label: 'Townhouse' },
  { value: 'Condo', label: 'Condo' },
  { value: 'Multi-Family', label: 'Multi-Family' },
  { value: 'Land', label: 'Land' },
];

const CONDITION_OPTIONS: { value: string; label: string }[] = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'distressed', label: 'Distressed' },
];

// Pill styling mirrors HeroStrip on the Overview tab so the rail reads the same.
const TIER_CONFIG: Record<number, { label: string; cls: string }> = {
  1: { label: 'T1 Contract Now', cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-300 dark:border-green-800' },
  2: { label: 'T2 Keep Pursuing', cls: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-800' },
  3: { label: 'T3 Cold', cls: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-700' },
};

const STAGE_META: Record<string, { label: string; cls: string }> = {
  NEW:                { label: 'New',             cls: 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' },
  ATTEMPTING_CONTACT: { label: 'Attempting',      cls: 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' },
  QUALIFYING:         { label: 'Qualifying',      cls: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800' },
  QUALIFIED:          { label: 'Qualified',       cls: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800' },
  OFFER_SENT:         { label: 'Offer Sent',      cls: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800' },
  NEGOTIATING:        { label: 'Negotiating',     cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' },
  UNDER_CONTRACT:     { label: 'Under Contract',  cls: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800' },
  CLOSING:            { label: 'Closing',         cls: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' },
  ACQUIRED:           { label: 'Acquired',        cls: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800' },
  SOLD:               { label: 'Sold',            cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800' },
  SOLD_LOSS:          { label: 'Sold (Loss)',     cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800' },
  HELD_LONG_TERM:     { label: 'Held',            cls: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700' },
  CANCELLED:          { label: 'Cancelled',       cls: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700' },
  CLOSED_LOST:        { label: 'Closed Lost',     cls: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700' },
  NURTURE:            { label: 'Nurture',         cls: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800' },
  DEAD:               { label: '💀 Dead',         cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-300 dark:border-red-800' },
};

// Tier button styling mirrors PipelineTierCard on the Overview tab.
const TIERS: { value: 1 | 2 | 3; label: string; desc: string; cls: string }[] = [
  { value: 1, label: 'T1', desc: 'Contract now', cls: 'border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300' },
  { value: 2, label: 'T2', desc: 'Keep pursuing', cls: 'border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-300' },
  { value: 3, label: 'T3', desc: 'Cold / unlikely', cls: 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400' },
];

interface Props {
  lead: any;
  onLeadPatch: (patch: any) => void;
  onMarkDead: () => void;
  /** Hide the back-to-queue header when hosted outside the lead page (e.g. the inbox). */
  hideNav?: boolean;
}

// Self-contained left rail for the lead workspace. Owns its own API calls and
// modals so it can be dropped into /leads/[id], /leads/[id]/comps-analysis,
// and the inbox's contact pane.
export default function LeadRail({ lead, onLeadPatch, onMarkDead, hideNav }: Props) {
  const leadId = lead.id;
  const router = useRouter();
  const dialer = useDialer();
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingTier, setSavingTier] = useState(false);
  const [savingAutoRespond, setSavingAutoRespond] = useState(false);
  const [initiatingCall, setInitiatingCall] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [backHref, setBackHref] = useState('/leads');
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [aiInsight, setAiInsight] = useState<string | null>(lead.aiInsight ?? null);
  const [insightLoading, setInsightLoading] = useState(false);

  useEffect(() => {
    leadsAPI.getTasks(leadId).then((res) => setTasks(res.data || [])).catch(() => {});
    campaignAPI.leadCampaigns(leadId).then((res) => setEnrollments(res.data || [])).catch(() => {});
  }, [leadId]);
  useEffect(() => {
    authAPI.getMe().then((res) => setCurrentUser(res.data)).catch(() => {});
    authAPI.getTeam().then((res) => setTeamMembers(res.data || [])).catch(() => {});
    campaignAPI.list().then((res) => setCampaigns(res.data || [])).catch(() => {});
    const queue = readLeadQueue();
    if (queue?.returnUrl) setBackHref(queue.returnUrl);
  }, []);

  const handleEnroll = async () => {
    if (!selectedCampaignId) return;
    setEnrolling(true);
    try {
      await campaignAPI.enrollLead(selectedCampaignId, leadId);
      const res = await campaignAPI.leadCampaigns(leadId);
      setEnrollments(res.data || []);
      setSelectedCampaignId('');
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to enroll');
    } finally {
      setEnrolling(false);
    }
  };

  const handlePauseEnrollment = async (enrollmentId: string) => {
    await campaignAPI.pause(enrollmentId);
    setEnrollments((prev) => prev.map((e) => (e.id === enrollmentId ? { ...e, status: 'PAUSED' } : e)));
  };

  const handleResumeEnrollment = async (enrollmentId: string) => {
    await campaignAPI.resume(enrollmentId);
    setEnrollments((prev) => prev.map((e) => (e.id === enrollmentId ? { ...e, status: 'ACTIVE' } : e)));
  };

  const handleUnenroll = async (enrollmentId: string) => {
    if (!confirm('Remove from this campaign?')) return;
    await campaignAPI.unenroll(enrollmentId);
    setEnrollments((prev) => prev.filter((e) => e.id !== enrollmentId));
  };

  // Same AI insight the Overview hero shows.
  useEffect(() => {
    let cancelled = false;
    setInsightLoading(true);
    leadsAPI.getAiInsight(leadId).then((res) => {
      if (cancelled) return;
      setAiInsight(res.data?.insight ?? null);
    }).catch(() => {}).finally(() => {
      if (!cancelled) setInsightLoading(false);
    });
    return () => { cancelled = true; };
  }, [leadId, lead.status, lead.tier]);

  const regenerateInsight = async () => {
    setInsightLoading(true);
    try {
      const res = await leadsAPI.getAiInsight(leadId, true);
      setAiInsight(res.data?.insight ?? null);
    } catch {
      // keep prior insight
    } finally {
      setInsightLoading(false);
    }
  };

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

  const handleRefreshFromReapi = async () => {
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
    }
  };

  const handleCopyLink = () => {
    const url = `${window.location.origin}/leads/${leadId}`;
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => alert('Could not copy link'),
    );
  };

  // Inline field editing: PATCH one field, merge into page state.
  const saveField = (field: string) => async (value: string) => {
    const payload: any = { [field]: value || null };
    await leadsAPI.update(leadId, payload);
    onLeadPatch(payload);
  };

  const saveNumberField = (field: string, parse: (v: string) => number = parseFloat) => async (value: string) => {
    const num = value ? parse(value) : null;
    if (value && (num === null || Number.isNaN(num))) {
      alert('Enter a number');
      return;
    }
    const payload: any = { [field]: num };
    await leadsAPI.update(leadId, payload);
    onLeadPatch(payload);
  };

  const displayName = getLeadDisplayName(lead);
  const isDead = lead.status === 'DEAD';
  const contactDisabled = !lead.sellerPhone || !!lead.doNotContact || isDead;
  const tierCfg = lead.tier ? TIER_CONFIG[lead.tier] : null;
  const stageMeta = STAGE_META[lead.status] || { label: lead.status, cls: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700' };
  const addressParts = {
    address: lead.propertyAddress,
    city: lead.propertyCity,
    state: lead.propertyState,
    zip: lead.propertyZip,
  };
  const mao = (() => {
    if (!lead.arv) return null;
    const pct = (lead.maoPercent ?? 70) / 100;
    return Math.round(lead.arv * pct - (lead.repairCosts ?? 0) - (lead.assignmentFee ?? 0));
  })();
  const openTasks = tasks.filter((t: any) => !t.completed);
  const lastTouched = lead.lastTouchedAt
    ? formatDistanceToNow(new Date(lead.lastTouchedAt), { addSuffix: true })
    : null;
  const activeEnrollments = enrollments.filter((e: any) => e.status === 'ACTIVE');
  const inDrip = activeEnrollments.length > 0 || lead.dripSequence?.status === 'ACTIVE';

  return (
    <div className="p-4 space-y-4 text-sm">
      {/* Back to queue + position */}
      {!hideNav && (
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
      )}

      {/* Identity: initials avatar (same hash colors as the conversation) + name */}
      <div className="flex items-center gap-2.5">
        <Avatar name={displayName || '?'} size="md" />
        <h1 className="min-w-0 flex-1 text-lg font-bold text-gray-900 dark:text-gray-100 leading-tight truncate" title={displayName}>
          {displayName}
        </h1>
      </div>

      {/* Status pills + touch summary — read-only, Overview hero style */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {tierCfg && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ${tierCfg.cls}`}>
              {tierCfg.label}
            </span>
          )}
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ${stageMeta.cls}`}>
            {stageMeta.label}
          </span>
          {inDrip && (
            <span
              title="Enrolled in active drip campaign"
              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300"
            >
              <DripEnvelopeIcon className="w-3 h-3" />
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {lastTouched ? `Last touched ${lastTouched}` : 'Never touched'}
        </div>
        <div className="text-[11px] text-gray-400 dark:text-gray-500">
          {lead.touchCount ?? 0} {lead.touchCount === 1 ? 'touch' : 'touches'}
        </div>
      </div>

      {/* AI insight — same content as the Overview hero */}
      {(aiInsight || insightLoading) && (
        <div className="rounded-lg border border-purple-100 dark:border-purple-900/40 bg-purple-50/50 dark:bg-purple-950/20 px-3 py-2">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-purple-500 dark:text-purple-400">✨ AI Insight</span>
            <button
              type="button"
              onClick={regenerateInsight}
              disabled={insightLoading}
              title="Regenerate insight"
              className="text-purple-400 hover:text-purple-600 dark:hover:text-purple-300 disabled:opacity-40"
            >
              <svg className={`w-3 h-3 ${insightLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
          </div>
          <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
            {insightLoading && !aiInsight ? 'Generating…' : aiInsight}
          </p>
        </div>
      )}

      {/* Quick actions — same compact icon buttons as the Overview Action Bar */}
      <div className="space-y-2 border-t border-gray-100 dark:border-gray-800 pt-3">
        <div className="flex items-center gap-1 flex-wrap">
          <IconBtn title="Send SMS" onClick={() => router.push(`/leads/${leadId}?tab=communications&action=reply`)} disabled={isDead}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
          </IconBtn>
          <IconBtn title="Call seller" onClick={() => dialer.startCall({ name: getLeadDisplayName(lead), phone: lead.sellerPhone, leadId })} disabled={contactDisabled}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
          </IconBtn>
          <IconBtn title="Start AI call" onClick={handleAiCall} disabled={contactDisabled || initiatingCall}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
          </IconBtn>
          <IconBtn title="Schedule follow-up" onClick={() => setShowFollowUpModal(true)}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </IconBtn>
          <IconBtn title="Share with partners" onClick={() => setShowShareModal(true)}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
          </IconBtn>
          <IconBtn title="Send offer" onClick={() => router.push(`/leads/${leadId}?tab=disposition&action=offer`)} disabled={isDead}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </IconBtn>
          <IconBtn title={refreshing ? 'Refreshing…' : 'Refresh from REAPI'} onClick={handleRefreshFromReapi} disabled={refreshing}>
            <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </IconBtn>
          <IconBtn title={copied ? 'Copied!' : 'Copy lead link'} onClick={handleCopyLink}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-4 4a4 4 0 01-5.656-5.656l1.102-1.101m11.452-9.972a4 4 0 015.656 5.656l-4 4a4 4 0 01-5.656 0" /></svg>
          </IconBtn>
          <IconBtn title="Mark dead" onClick={onMarkDead} disabled={isDead}>
            <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </IconBtn>
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

        {/* External lookups — CC-style labeled buttons */}
        <div className="flex gap-1.5">
          <a
            href={zillowUrl(addressParts)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            View on Zillow
          </a>
          <a
            href={googleSearchUrl(addressParts)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M21 21l-4.35-4.35" /></svg>
            View on Google
          </a>
        </div>
      </div>

      <RailSection title="Contact" storageKey="contact" defaultOpen>
        <dl className="space-y-1 text-[13px]">
          <EditableRow label="First" value={lead.sellerFirstName} required onSave={saveField('sellerFirstName')} />
          <EditableRow label="Last" value={lead.sellerLastName} onSave={saveField('sellerLastName')} />
          <EditableRow
            label="Phone"
            value={lead.sellerPhone}
            displayValue={lead.sellerPhone ? formatPhoneDisplay(lead.sellerPhone) : undefined}
            href={lead.sellerPhone && !lead.doNotContact ? `tel:${lead.sellerPhone}` : undefined}
            required
            onSave={saveField('sellerPhone')}
          />
          <EditableRow
            label="Email"
            value={lead.sellerEmail}
            href={lead.sellerEmail ? `mailto:${lead.sellerEmail}` : undefined}
            onSave={saveField('sellerEmail')}
          />
          <EditableRow label="Street" value={lead.propertyAddress} onSave={saveField('propertyAddress')} />
          <EditableRow label="City" value={lead.propertyCity} onSave={saveField('propertyCity')} />
          <EditableRow label="State" value={lead.propertyState} onSave={saveField('propertyState')} />
          <EditableRow label="Zip" value={lead.propertyZip} onSave={saveField('propertyZip')} />
          <EditableRow label="Source" value={lead.source} options={SOURCE_OPTIONS} onSave={saveField('source')} />
        </dl>
        {lead.doNotContact && (
          <div className="mt-2 px-2 py-1.5 rounded bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
            Do Not Contact
          </div>
        )}
      </RailSection>

      <RailSection title="Property" storageKey="property">
        {(lead.reapiId || lead.attomId) && (
          <div className="mb-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              lead.reapiId
                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
            }`}>
              ✓ {lead.reapiId ? 'REAPI' : 'ATTOM'} Verified
            </span>
          </div>
        )}
        <dl className="space-y-1 text-[13px]">
          <EditableRow label="Type" value={lead.propertyType} options={PROPERTY_TYPE_OPTIONS} onSave={saveField('propertyType')} />
          <EditableRow label="Beds" value={lead.bedrooms != null ? String(lead.bedrooms) : null} onSave={saveNumberField('bedrooms', (v) => parseInt(v, 10))} />
          <EditableRow label="Baths" value={lead.bathrooms != null ? String(lead.bathrooms) : null} onSave={saveNumberField('bathrooms')} />
          <EditableRow
            label="Sqft"
            value={lead.sqft != null ? String(lead.sqft) : null}
            displayValue={
              lead.sqftOverride
                ? `${lead.sqftOverride.toLocaleString()} (override)`
                : lead.sqft != null ? lead.sqft.toLocaleString() : undefined
            }
            onSave={saveNumberField('sqft', (v) => parseInt(v.replace(/[^0-9]/g, ''), 10))}
          />
          <EditableRow label="Year" value={lead.yearBuilt != null ? String(lead.yearBuilt) : null} onSave={saveNumberField('yearBuilt', (v) => parseInt(v, 10))} />
          <div className="flex items-baseline gap-2">
            <dt className="w-14 shrink-0 text-[11px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500">Lot</dt>
            <dd className="min-w-0 flex-1 text-gray-800 dark:text-gray-200">
              {lead.lotSize
                ? lead.lotSize > 100 ? `${(lead.lotSize / 43560).toFixed(2)} acres` : `${lead.lotSize.toFixed(2)} acres`
                : '—'}
            </dd>
          </div>
          <EditableRow
            label="Cond."
            value={lead.conditionLevel}
            displayValue={lead.conditionLevel || lead.propertyCondition || undefined}
            options={CONDITION_OPTIONS}
            onSave={saveField('conditionLevel')}
          />
        </dl>
        <Link
          href={`/leads/${leadId}/comps-analysis?tab=valuation`}
          className="mt-2 block text-center text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
        >
          Photos{lead.photos?.length ? ` (${lead.photos.length})` : ''} & full details →
        </Link>
      </RailSection>

      <RailSection title={`Follow-Ups${openTasks.length ? ` (${openTasks.length})` : ''}`} storageKey="followups">
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

      <RailSection title="Pipeline" storageKey="pipeline">
        <div className="space-y-3">
          <div>
            <RailLabel>Stage</RailLabel>
            <select
              value={lead.status}
              disabled={savingStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="mt-1 w-full text-sm px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:opacity-50"
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

      <RailSection title={`Drip Campaigns${activeEnrollments.length ? ` (${activeEnrollments.length})` : ''}`} storageKey="drip">
        {enrollments.length > 0 ? (
          <div className="space-y-1.5">
            {enrollments.map((enrollment: any) => (
              <div key={enrollment.id} className="p-2 rounded-lg bg-gray-50 dark:bg-gray-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                    {enrollment.campaign?.name || 'Campaign'}
                  </span>
                  <span className={`text-[10px] font-semibold shrink-0 ${
                    enrollment.status === 'ACTIVE' ? 'text-green-600 dark:text-green-400' :
                    enrollment.status === 'PAUSED' ? 'text-yellow-600 dark:text-yellow-400' :
                    enrollment.status === 'REPLIED' ? 'text-purple-600 dark:text-purple-400' :
                    'text-gray-500 dark:text-gray-400'
                  }`}>
                    {enrollment.status}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                    Step {enrollment.currentStepOrder}
                    {enrollment.nextSendAt && enrollment.status === 'ACTIVE' && (
                      <> · next {new Date(enrollment.nextSendAt).toLocaleDateString()}</>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {enrollment.status === 'ACTIVE' && (
                      <button
                        type="button"
                        onClick={() => handlePauseEnrollment(enrollment.id)}
                        className="text-[11px] font-medium text-yellow-700 dark:text-yellow-400 hover:underline"
                      >
                        Pause
                      </button>
                    )}
                    {enrollment.status === 'PAUSED' && (
                      <button
                        type="button"
                        onClick={() => handleResumeEnrollment(enrollment.id)}
                        className="text-[11px] font-medium text-green-700 dark:text-green-400 hover:underline"
                      >
                        Resume
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleUnenroll(enrollment.id)}
                      className="text-[11px] text-red-500 dark:text-red-400 hover:underline"
                    >
                      Remove
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 dark:text-gray-500">Not enrolled in any campaigns.</p>
        )}
        <div className="mt-2 flex items-center gap-1.5">
          <select
            value={selectedCampaignId}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
            className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">Select a campaign…</option>
            {campaigns.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleEnroll}
            disabled={!selectedCampaignId || enrolling}
            className="text-xs px-3 py-1.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-50 shrink-0"
          >
            {enrolling ? '…' : 'Enroll'}
          </button>
        </div>
      </RailSection>

      <RailSection title="Valuation" storageKey="valuation">
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

      <RailSection title="CAMP Discovery" storageKey="camp">
        <div className="grid grid-cols-2 gap-1.5">
          <CampChip label="Priority" value={lead.timeline ? `${lead.timeline} days` : null} complete={lead.campPriorityComplete} />
          <CampChip label="Money" value={lead.askingPrice ? `$${lead.askingPrice.toLocaleString()}` : null} complete={lead.campMoneyComplete} />
          <CampChip label="Challenge" value={lead.conditionLevel || null} complete={lead.campChallengeComplete} />
          <CampChip label="Authority" value={lead.ownershipStatus?.replace(/_/g, ' ') || null} complete={lead.campAuthorityComplete} />
        </div>
      </RailSection>

      <RailSection title="Seller Portal" storageKey="portal">
        <SellerPortalPanel leadId={leadId} />
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

// Click-to-edit field row: pencil on hover, Enter/blur saves, Esc cancels.
function EditableRow({
  label,
  value,
  displayValue,
  href,
  required,
  options,
  onSave,
}: {
  label: string;
  value: string | null | undefined;
  displayValue?: string;
  href?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const begin = () => {
    setDraft(value || '');
    setEditing(true);
  };

  const commit = async (next?: string) => {
    const trimmed = (next ?? draft).trim();
    if (trimmed === (value || '') || (required && !trimmed)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
    } catch (err) {
      console.error(`Failed to save ${label}`, err);
      alert(`Failed to save ${label}`);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const shown = displayValue || (options ? options.find((o) => o.value === value)?.label || value : value);

  return (
    <div className="group flex items-baseline gap-2">
      <dt className="w-14 shrink-0 text-[11px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500">{label}</dt>
      <dd className="min-w-0 flex-1">
        {editing ? (
          options ? (
            <select
              autoFocus
              value={draft}
              disabled={saving}
              onChange={(e) => commit(e.target.value)}
              onBlur={() => setEditing(false)}
              className="w-full text-[13px] px-1.5 py-0.5 rounded border border-primary-300 dark:border-primary-700 bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-400"
            >
              <option value="">—</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              value={draft}
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="w-full text-[13px] px-1.5 py-0.5 rounded border border-primary-300 dark:border-primary-700 bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-400"
            />
          )
        ) : (
          <span className="flex items-center gap-1 min-w-0">
            {href && value ? (
              <a href={href} className="truncate text-gray-800 dark:text-gray-200 hover:text-primary-600 hover:underline" title={String(shown)}>
                {shown}
              </a>
            ) : (
              <button
                type="button"
                onClick={begin}
                title={`Edit ${label.toLowerCase()}`}
                className={`truncate text-left ${value ? 'text-gray-800 dark:text-gray-200' : 'text-gray-300 dark:text-gray-600'}`}
              >
                {shown || '—'}
              </button>
            )}
            <button
              type="button"
              onClick={begin}
              title={`Edit ${label.toLowerCase()}`}
              className="opacity-0 group-hover:opacity-100 shrink-0 text-gray-300 hover:text-primary-600 dark:text-gray-600 dark:hover:text-primary-400 transition-opacity"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            </button>
          </span>
        )}
      </dd>
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

function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500">
      {children}
    </div>
  );
}

// Collapsible section; open state persists per section in localStorage.
function RailSection({
  title,
  storageKey,
  defaultOpen = false,
  children,
}: {
  title: string;
  storageKey: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`dealcore:rail:${storageKey}`);
      if (stored !== null) setOpen(stored === 'true');
    } catch {}
  }, [storageKey]);

  const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const isOpen = e.currentTarget.open;
    setOpen(isOpen);
    try {
      window.localStorage.setItem(`dealcore:rail:${storageKey}`, String(isOpen));
    } catch {}
  };

  return (
    <details open={open} onToggle={handleToggle} className="border-t border-gray-100 dark:border-gray-800 pt-3 group">
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
