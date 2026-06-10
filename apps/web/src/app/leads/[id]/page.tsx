'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { leadsAPI, messagesAPI, compsAPI, settingsAPI, photosAPI, callsAPI, authAPI, tasksAPI, gmailAPI, campaignAPI, partnersAPI, sellerPortalAPI, inboxAPI } from '@/lib/api';
import ShareDealModal from '@/components/ShareDealModal';
import ShareHistory from '@/components/ShareHistory';
import DispoTab from '@/components/DispoTab';
import PhotoGallery from '@/components/PhotoGallery';
import AppShell from '@/components/AppShell';
import LeadTabNav, { DETAIL_TABS, COMPS_TABS } from '@/components/LeadTabNav';
import LeadQueueNav from '@/components/leadDetailV2/LeadQueueNav';
import SellerPortalPanel from '@/components/SellerPortalPanel';
import ScheduleFollowUpModal from '@/components/ScheduleFollowUpModal';
import LeadOverviewV2 from '@/components/leadDetailV2/LeadOverviewV2';
import LeadRail from '@/components/leadDetailV2/LeadRail';
import { format } from 'date-fns';
import { formatPhoneDisplay, getLeadAddressLine, getLeadDisplayName } from '@/lib/format';
import CommunicationsTimeline from '@/components/communications/CommunicationsTimeline';
import NotesPanel from '@/components/communications/NotesPanel';
import MessageComposer from '@/components/communications/MessageComposer';
import type { TimelineItem, NoteItem } from '@/components/communications/types';

const LEAD_DETAIL_V2 = process.env.NEXT_PUBLIC_LEAD_DETAIL_V2 === 'restructured';

// Lightweight icon + color cues for the Activity Log. Disposition-v2 events
// (PROFIT_BUCKET_CHANGED, COST_*, LEAD_ACQUIRED, FINAL_SALE_RECORDED,
// DISPOSITION_PLAN_UPDATED) get a money/calendar visual; legacy events stay
// uncolored so the change doesn't perturb existing rows.
const ACTIVITY_TYPE_META: Record<string, { icon?: string; color?: string }> = {
  PROFIT_BUCKET_CHANGED:    { icon: '📊', color: 'text-blue-600 dark:text-blue-400' },
  COST_ADDED:               { icon: '💸', color: 'text-amber-600 dark:text-amber-400' },
  COST_UPDATED:             { icon: '💸', color: 'text-amber-600 dark:text-amber-400' },
  COST_DELETED:             { icon: '💸', color: 'text-gray-400 dark:text-gray-500' },
  LEAD_ACQUIRED:            { icon: '🏷️', color: 'text-cyan-600 dark:text-cyan-400' },
  FINAL_SALE_RECORDED:      { icon: '🏁', color: 'text-green-600 dark:text-green-400' },
  DISPOSITION_PLAN_UPDATED: { icon: '🗺️', color: 'text-purple-600 dark:text-purple-400' },
  OFFER_MADE:               { icon: '✉️', color: 'text-orange-600 dark:text-orange-400' },
  OFFER_ACCEPTED:           { icon: '✅', color: 'text-green-600 dark:text-green-400' },
  STATUS_CHANGED:           { icon: '🔄', color: 'text-blue-500 dark:text-blue-400' },
  DOCUMENT_SENT:            { icon: '📄', color: 'text-indigo-600 dark:text-indigo-400' },
};

function getNextCampFocus(lead: any): string | null {
  if (!lead.campPriorityComplete) return 'Priority (Timeline)';
  if (!lead.campMoneyComplete) return 'Money (Asking Price)';
  if (!lead.campChallengeComplete) return 'Challenge (Condition)';
  if (!lead.campAuthorityComplete) return 'Authority (Ownership)';
  return null;
}

function campProgress(lead: any): number {
  let done = 0;
  if (lead.campPriorityComplete) done++;
  if (lead.campMoneyComplete) done++;
  if (lead.campChallengeComplete) done++;
  if (lead.campAuthorityComplete) done++;
  return done;
}

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadId = params.id as string;

  const [lead, setLead] = useState<any>(null);
  const [activeTab, setActiveTab] = useState(() => {
    const tab = searchParams.get('tab');
    // Redirect comps-analysis tabs to the comps-analysis page
    if (tab && COMPS_TABS.includes(tab as any)) {
      return '__redirect__';
    }
    // Conversation-first: the CRM workflow lands on communications by default
    return tab && DETAIL_TABS.includes(tab as any) ? tab : 'communications';
  });

  // Sync activeTab with URL changes (tab link clicks)
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && COMPS_TABS.includes(tab as any)) {
      router.replace(`/leads/${leadId}/comps-analysis?tab=${tab}`);
    } else if (tab && DETAIL_TABS.includes(tab as any)) {
      setActiveTab(tab);
    } else if (!tab) {
      setActiveTab('communications');
    }
  }, [searchParams, leadId, router]);

  // Deep-link intent handling: ?action=reply on Communications tab → pre-draft + focus
  useEffect(() => {
    if (!LEAD_DETAIL_V2 || !lead) return;
    const action = searchParams.get('action');
    if (action === 'reply' && activeTab === 'communications' && !replyIntentApplied.current) {
      replyIntentApplied.current = true;
      const lastMsg = lead.messages?.[0];
      const hasUnansweredInbound = lastMsg?.direction === 'INBOUND';
      if (hasUnansweredInbound) {
        (async () => {
          try {
            const response = await messagesAPI.draft(leadId);
            setMessageDrafts(response.data);
            setSelectedDraft(response.data.message);
          } catch (err) { console.error('Failed to auto-draft', err); }
          setTimeout(() => {
            messagesBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
            composerRef.current?.focus();
          }, 200);
        })();
      } else {
        setTimeout(() => {
          messagesBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
          composerRef.current?.focus();
        }, 200);
      }
    }
    if ((action === 'send-portal-link' || action === 'resend-portal-link') && activeTab === 'communications' && !portalLinkIntentApplied.current) {
      portalLinkIntentApplied.current = true;
      (async () => {
        try {
          const res = await sellerPortalAPI.getInfo(leadId);
          const portalUrl = res.data?.portalUrl;
          if (!portalUrl) return;
          const firstName = (lead.sellerFirstName || '').trim() || 'there';
          const message = action === 'resend-portal-link'
            ? `Hey ${firstName}, just resending the link in case you missed it — you can upload photos, see comps, and review offers here: ${portalUrl}`
            : `Hey ${firstName}! Here's the link where you can upload photos of the property, view comps, and review offers: ${portalUrl}`;
          setMessageDrafts({ message });
          setSelectedDraft(message);
        } catch (err) { console.error('Failed to load portal for draft', err); }
        setTimeout(() => {
          messagesBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
          composerRef.current?.focus();
        }, 200);
      })();
    }
  }, [activeTab, lead, leadId, searchParams]);
  const [messageDrafts, setMessageDrafts] = useState<any>(null);
  const [selectedDraft, setSelectedDraft] = useState('');
  const [comms, setComms] = useState<{ timeline: TimelineItem[]; notes: NoteItem[] }>({ timeline: [], notes: [] });
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [simulatingReply, setSimulatingReply] = useState(false);
  const [simReplyText, setSimReplyText] = useState('');
  const [togglingAutoRespond, setTogglingAutoRespond] = useState(false);
  const [fetchingComps, setFetchingComps] = useState(false);
  const [compsResult, setCompsResult] = useState<any>(null);
  const [initiatingCall, setInitiatingCall] = useState(false);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignStage, setAssignStage] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [showDeadForm, setShowDeadForm] = useState(false);
  const [deadReason, setDeadReason] = useState('');
  const [markingDead, setMarkingDead] = useState(false);
  const [settingTier, setSettingTier] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [leadEnrollments, setLeadEnrollments] = useState<any[]>([]);
  const [availableCampaigns, setAvailableCampaigns] = useState<any[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [enrollingInCampaign, setEnrollingInCampaign] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [leadTasks, setLeadTasks] = useState<any[]>([]);
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [showArvEdit, setShowArvEdit] = useState(false);
  const [arvInput, setArvInput] = useState('');
  const [savingArv, setSavingArv] = useState(false);
  const [sendingOutreach, setSendingOutreach] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const replyIntentApplied = useRef(false);
  const offerIntentApplied = useRef(false);
  const portalLinkIntentApplied = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesBottomRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the communications timeline pinned to the latest message.
  useEffect(() => {
    if (timelineScrollRef.current) {
      timelineScrollRef.current.scrollTop = timelineScrollRef.current.scrollHeight;
    }
  }, [comms.timeline, activeTab]);

  useEffect(() => {
    loadLead();
    // Viewing the thread counts as reading it (clears the inbox unread flag)
    inboxAPI.markRead(leadId).catch(() => {});
    settingsAPI.getDrip().then((res) => setDemoMode(res.data.demoMode ?? false)).catch(() => {});
    authAPI.getTeam().then((res) => setTeamMembers(res.data || [])).catch(() => {});
    authAPI.getMe().then((res) => setCurrentUser(res.data)).catch(() => {});
    gmailAPI.status().then((res) => setGmailConnected(res.data.connected)).catch(() => {});
    campaignAPI.leadCampaigns(leadId).then((res) => setLeadEnrollments(res.data || [])).catch(() => {});
    campaignAPI.list().then((res) => setAvailableCampaigns(res.data || [])).catch(() => {});
    leadsAPI.getTasks(leadId).then((res) => setLeadTasks(res.data || [])).catch(() => {});
  }, [leadId]);

  const loadComms = async () => {
    try {
      const res = await leadsAPI.communications(leadId);
      setComms({ timeline: res.data?.timeline || [], notes: res.data?.notes || [] });
    } catch {
      // keep existing
    }
  };

  const loadLead = async () => {
    try {
      const response = await leadsAPI.get(leadId);
      setLead(response.data);
      setAssignUserId(response.data?.assignedToUserId || '');
      setAssignStage(response.data?.assignedStage || '');
      loadComms();
    } catch (error) {
      console.error('Failed to load lead:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDraftMessage = async () => {
    try {
      const response = await messagesAPI.draft(leadId);
      setMessageDrafts(response.data);
      setSelectedDraft(response.data.message);
    } catch (error) {
      console.error('Failed to draft message:', error);
      alert('Failed to generate drafts');
    }
  };

  const handleSendMessage = async () => {
    if (!selectedDraft.trim()) return;
    try {
      await messagesAPI.send(leadId, selectedDraft, currentUser?.id);
      setMessageDrafts(null);
      setSelectedDraft('');
      loadLead();
      alert('Message sent!');
    } catch (error) {
      console.error('Failed to send message:', error);
      alert('Failed to send message');
    }
  };

  const handleFetchComps = async (forceRefresh = false) => {
    setFetchingComps(true);
    setCompsResult(null);
    try {
      const res = await compsAPI.fetch(leadId, forceRefresh);
      setCompsResult(res.data);
      loadLead();
    } catch (error) {
      console.error('Failed to fetch comps:', error);
      alert('Failed to fetch comps');
    } finally {
      setFetchingComps(false);
    }
  };

  const handleRescore = async () => {
    try {
      await messagesAPI.rescore(leadId);
      loadLead();
      alert('Lead rescored!');
    } catch (error) {
      console.error('Failed to rescore:', error);
    }
  };

  const handleFetchPhotos = async () => {
    try {
      await photosAPI.fetchAll(leadId);
      loadLead();
    } catch (error) {
      console.error('Failed to fetch photos:', error);
      alert('Failed to fetch photos');
    }
  };

  const handleUploadPhotos = async (files: File[]) => {
    try {
      if (files.length === 1) {
        await photosAPI.upload(leadId, files[0]);
      } else {
        await photosAPI.uploadMultiple(leadId, files);
      }
      loadLead();
    } catch (error) {
      console.error('Failed to upload photos:', error);
      alert('Failed to upload photos');
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    try {
      await photosAPI.delete(leadId, photoId);
      loadLead();
    } catch (error) {
      console.error('Failed to delete photo:', error);
      alert('Failed to delete photo');
    }
  };

  const handleSetPrimary = async (photoId: string) => {
    try {
      await photosAPI.setPrimary(leadId, photoId);
      loadLead();
    } catch (error) {
      console.error('Failed to set primary photo:', error);
    }
  };

  const handleAiCall = async () => {
    setInitiatingCall(true);
    try {
      await callsAPI.initiateAiCall(leadId);
      alert('AI call initiated!');
      loadLead();
    } catch (error) {
      console.error('Failed to initiate AI call:', error);
      alert('Failed to initiate AI call');
    } finally {
      setInitiatingCall(false);
    }
  };

  const handleAssign = async () => {
    if (!assignUserId) return;
    setAssignSaving(true);
    try {
      await leadsAPI.assign(leadId, assignUserId, assignStage || '');
      loadLead();
    } catch (error) {
      console.error('Failed to assign lead:', error);
      alert('Failed to assign lead');
    } finally {
      setAssignSaving(false);
    }
  };

  const handleUnassign = async () => {
    setAssignSaving(true);
    try {
      await leadsAPI.unassign(leadId);
      setAssignUserId('');
      setAssignStage('');
      loadLead();
    } catch (error) {
      console.error('Failed to unassign lead:', error);
      alert('Failed to unassign lead');
    } finally {
      setAssignSaving(false);
    }
  };

  const handleToggleAutoRespond = async () => {
    setTogglingAutoRespond(true);
    try {
      await leadsAPI.toggleAutoRespond(leadId, !lead.autoRespond);
      loadLead();
    } catch (error) {
      console.error('Failed to toggle auto-respond:', error);
      alert('Failed to toggle auto-respond');
    } finally {
      setTogglingAutoRespond(false);
    }
  };

  const handleMarkDead = async () => {
    if (!deadReason.trim()) return;
    setMarkingDead(true);
    try {
      if (currentUser) {
        await leadsAPI.addNote(leadId, `[Dead] ${deadReason}`, currentUser.id);
      }
      await leadsAPI.update(leadId, { status: 'DEAD' });
      setShowDeadForm(false);
      setDeadReason('');
      loadLead();
    } catch (error) {
      console.error('Failed to mark lead as dead:', error);
      alert('Failed to mark lead as dead');
    } finally {
      setMarkingDead(false);
    }
  };

  const refreshLeadTasks = async () => {
    try {
      const res = await leadsAPI.getTasks(leadId);
      setLeadTasks(res.data || []);
    } catch {
      // keep existing list
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    try {
      await tasksAPI.complete(taskId, currentUser?.id);
      const res = await leadsAPI.getTasks(leadId);
      setLeadTasks(res.data || []);
    } catch (error) {
      console.error('Failed to complete task:', error);
    }
  };

  const handleSetTier = async (tier: number | null) => {
    setSettingTier(true);
    try {
      await leadsAPI.update(leadId, { tier });
      loadLead();
    } catch (error) {
      console.error('Failed to set tier:', error);
    } finally {
      setSettingTier(false);
    }
  };

  const handleSaveArv = async () => {
    const value = Number(arvInput.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(value) || value <= 0) {
      alert('Enter a positive number');
      return;
    }
    setSavingArv(true);
    try {
      await leadsAPI.update(leadId, { arv: value, arvConfidence: 100 });
      setShowArvEdit(false);
      setArvInput('');
      loadLead();
    } catch (error) {
      console.error('Failed to save ARV:', error);
      alert('Failed to save ARV');
    } finally {
      setSavingArv(false);
    }
  };

  const handleSendOutreach = async () => {
    setSendingOutreach(true);
    try {
      await leadsAPI.sendOutreach(leadId);
      loadLead();
    } catch (error: any) {
      console.error('Failed to send outreach:', error);
      alert(error?.response?.data?.message || 'Failed to send outreach');
    } finally {
      setSendingOutreach(false);
    }
  };

  const openScheduleFollowUp = () => setShowFollowUpModal(true);

  // Notes pane collapse state persists across leads
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('dealcore:leadNotes:open');
      if (stored !== null) setNotesOpen(stored === 'true');
    } catch {}
  }, []);
  const toggleNotes = () => {
    setNotesOpen((open) => {
      try { window.localStorage.setItem('dealcore:leadNotes:open', String(!open)); } catch {}
      return !open;
    });
  };

  // Desktop: the workspace panes scroll internally; suppress the page-level
  // scrollbar (a 1px calc rounding artifact otherwise keeps it visible).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => {
      document.documentElement.style.overflowY = mq.matches ? 'hidden' : '';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => {
      document.documentElement.style.overflowY = '';
      mq.removeEventListener('change', apply);
    };
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center dark:bg-gray-950 dark:text-gray-100">Loading...</div>;
  }

  if (!lead) {
    return <div className="min-h-screen flex items-center justify-center dark:bg-gray-950 dark:text-gray-100">Lead not found</div>;
  }

  const nextFocus = getNextCampFocus(lead);
  const progress = campProgress(lead);
  const allCampComplete = progress === 4;

  return (
    <AppShell>
      {/* Full-height workspace on desktop; panes scroll internally */}
      <div className="flex flex-col lg:h-[calc(100dvh-3.5rem)] lg:overflow-hidden">

      {/* Mobile identity strip (the rail is hidden below lg) */}
      <div className="lg:hidden bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-tight truncate">{getLeadDisplayName(lead)}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{getLeadAddressLine(lead)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {lead.sellerPhone && !lead.doNotContact && lead.status !== 'DEAD' && (
            <a
              href={`tel:${lead.sellerPhone}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white"
            >
              📞 Call
            </a>
          )}
          <LeadQueueNav leadId={leadId} />
        </div>
      </div>

      {/* Workspace: persistent rail | tabs + content | notes pane */}
      <div className="flex-1 lg:min-h-0 lg:flex">

      {/* Left rail: identity, actions, and always-visible lead summary */}
      <aside className="hidden lg:block w-80 xl:w-96 shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto">
        <LeadRail
          lead={lead}
          onLeadPatch={(patch: any) => setLead((prev: any) => (prev ? { ...prev, ...patch } : prev))}
          onMarkDead={() => {
            setShowDeadForm(true);
            if (activeTab !== 'disposition') {
              router.push(`/leads/${leadId}?tab=disposition`);
            }
          }}
        />
      </aside>

      {/* Center column: tabs + active tab content */}
      <div className="flex-1 min-w-0 flex flex-col lg:min-h-0">
      <LeadTabNav leadId={leadId} activeTab={activeTab} />

      <main className={`flex-1 min-w-0 px-4 sm:px-6 py-6 ${activeTab === 'communications' ? 'lg:flex lg:flex-col lg:min-h-0' : 'lg:overflow-y-auto'}`}>

        {/* Overview Tab */}
        {activeTab === 'overview' && LEAD_DETAIL_V2 && (
          <LeadOverviewV2
            lead={lead}
            leadId={leadId}
            currentUser={currentUser}
            teamMembers={teamMembers}
            leadTasks={leadTasks}
            setLead={setLead}
            reload={loadLead}
            handlers={{
              onToggleAutoRespond: handleToggleAutoRespond,
              onAssign: handleAssign,
              onUnassign: handleUnassign,
              onSetTier: handleSetTier,
              onFetchComps: handleFetchComps,
              onSendOutreach: handleSendOutreach,
              onAiCall: handleAiCall,
              onMarkDead: () => setShowDeadForm(true),
              onSaveArv: handleSaveArv,
              onUploadPhotos: handleUploadPhotos,
              onFetchPhotos: handleFetchPhotos,
              onDeletePhoto: handleDeletePhoto,
              onSetPrimaryPhoto: handleSetPrimary,
              onCompleteTask: handleCompleteTask,
              onOpenFollowUpModal: openScheduleFollowUp,
              onOpenShareModal: () => setShowShareModal(true),
              openCommunications: (action?: string) => {
                const q = action ? `?tab=communications&action=${action}` : '?tab=communications';
                router.push(`/leads/${leadId}${q}`);
              },
              openDisposition: (action?: string) => {
                const q = action ? `?tab=disposition&action=${action}` : '?tab=disposition';
                router.push(`/leads/${leadId}${q}`);
              },
            }}
            uiState={{
              assignUserId,
              setAssignUserId,
              assignStage,
              setAssignStage,
              assignSaving,
              togglingAutoRespond,
              settingTier,
              fetchingComps,
              sendingOutreach,
              initiatingCall,
              showArvEdit,
              setShowArvEdit,
              arvInput,
              setArvInput,
              savingArv,
            }}
          />
        )}

        {activeTab === 'overview' && !LEAD_DETAIL_V2 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* Property Photos */}
              <div className="card">
                <PhotoGallery
                  photos={lead.photos || []}
                  primaryPhotoUrl={lead.primaryPhoto}
                  leadId={leadId}
                  onUpload={handleUploadPhotos}
                  onFetchPhotos={handleFetchPhotos}
                  onDelete={handleDeletePhoto}
                  onSetPrimary={handleSetPrimary}
                />
              </div>

              {/* CAMP Discovery Status */}
              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold">CAMP Discovery</h2>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500 dark:text-gray-400">{progress}/4 complete</span>
                    {allCampComplete && (
                      <span className="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">
                        All gathered
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <CampCard
                    label="Priority"
                    subtitle="Timeline"
                    complete={lead.campPriorityComplete}
                    value={lead.timeline ? `${lead.timeline} days` : null}
                    isNext={nextFocus?.includes('Priority')}
                  />
                  <CampCard
                    label="Money"
                    subtitle="Asking Price"
                    complete={lead.campMoneyComplete}
                    value={lead.askingPrice ? `$${lead.askingPrice.toLocaleString()}` : null}
                    isNext={nextFocus?.includes('Money')}
                  />
                  <CampCard
                    label="Challenge"
                    subtitle="Condition"
                    complete={lead.campChallengeComplete}
                    value={lead.conditionLevel || null}
                    isNext={nextFocus?.includes('Challenge')}
                  />
                  <CampCard
                    label="Authority"
                    subtitle="Ownership"
                    complete={lead.campAuthorityComplete}
                    value={lead.ownershipStatus?.replace('_', ' ') || null}
                    isNext={nextFocus?.includes('Authority')}
                  />
                </div>

                {nextFocus && !allCampComplete && (
                  <div className="text-sm text-primary-600 bg-primary-50 rounded px-3 py-2">
                    Next question will explore: <strong>{nextFocus}</strong>
                  </div>
                )}
              </div>

              {/* Auto-Respond Control */}
              <div className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold">Auto-Respond</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {lead.autoRespond
                        ? 'AI will automatically respond to incoming messages and discover CAMP data.'
                        : 'Manual mode — AI will not send automatic responses for this lead.'}
                    </p>
                    {lead.autoResponseCount > 0 && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        {lead.autoResponseCount} auto-response{lead.autoResponseCount !== 1 ? 's' : ''} sent today (max 5/day)
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={togglingAutoRespond}
                      onClick={handleToggleAutoRespond}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        lead.autoRespond ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
                      } ${togglingAutoRespond ? 'opacity-50' : ''}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          lead.autoRespond ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Seller Info */}
              <div className="card">
                <h2 className="text-xl font-bold mb-4">Seller Information</h2>
                <dl className="grid grid-cols-2 gap-4">
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Name</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                      {lead.sellerFirstName} {lead.sellerLastName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Phone</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100 flex items-center gap-2">
                      {formatPhoneDisplay(lead.sellerPhone)}
                      {!lead.doNotContact && (
                        <a
                          href={`tel:${lead.sellerPhone}`}
                          title="Call via SmrtPhone"
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 hover:text-green-800 dark:hover:text-green-300 transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                          </svg>
                        </a>
                      )}
                    </dd>
                  </div>
                  {lead.sellerEmail && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Email</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{lead.sellerEmail}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Property Details */}
              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold">Property Details</h2>
                    {(lead as any).reapiId ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium">
                        ✓ REAPI Verified
                      </span>
                    ) : (lead as any).attomId && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium">
                        ✓ ATTOM Verified
                      </span>
                    )}
                    {/* MLS listing badge removed — automated check was unreliable */}
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await leadsAPI.refreshPropertyDetails(leadId);
                        loadLead();
                      } catch (error) {
                        console.error('Failed to refresh property details:', error);
                      }
                    }}
                    className="btn btn-secondary btn-sm"
                  >
                    Refresh
                  </button>
                </div>

                {/* Core specs */}
                <dl className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Type</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{lead.propertyType || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Bedrooms</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{lead.bedrooms ?? 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Bathrooms</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{lead.bathrooms ?? 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Sq Ft</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                      {(lead as any).sqftOverride
                        ? <><span className="font-semibold text-amber-700 dark:text-amber-400">{(lead as any).sqftOverride.toLocaleString()}</span><span className="text-xs text-amber-600 dark:text-amber-400 ml-1">(override)</span><span className="text-xs text-gray-400 dark:text-gray-500 ml-1">{(lead as any).reapiId ? 'REAPI' : 'Public records'}: {lead.sqft?.toLocaleString() || '—'}</span></>
                        : lead.sqft?.toLocaleString() || 'Unknown'
                      }
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Year Built</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                      {lead.yearBuilt ?? 'Unknown'}
                      {(lead as any).effectiveYearBuilt && (lead as any).effectiveYearBuilt !== lead.yearBuilt && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">(reno'd {(lead as any).effectiveYearBuilt})</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Lot Size</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                      {lead.lotSize
                        ? lead.lotSize > 100 ? `${(lead.lotSize / 43560).toFixed(2)} acres` : `${lead.lotSize.toFixed(2)} acres`
                        : 'Unknown'}
                    </dd>
                  </div>
                  {(lead as any).stories && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Stories</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{(lead as any).stories}</dd>
                    </div>
                  )}
                  {(lead as any).basementSqft > 0 && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Basement</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{(lead as any).basementSqft.toLocaleString()} sqft</dd>
                    </div>
                  )}
                  {(lead as any).wallType && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Construction</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{(lead as any).wallType}</dd>
                    </div>
                  )}
                  {lead.conditionLevel && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Condition</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                        {lead.conditionLevel}
                        {(lead as any).propertyCondition && (lead as any).propertyCondition !== lead.conditionLevel && (
                          <span className="text-xs text-indigo-600 dark:text-indigo-400 ml-1">(public records: {(lead as any).propertyCondition})</span>
                        )}
                      </dd>
                    </div>
                  )}
                  {!(lead.conditionLevel) && (lead as any).propertyCondition && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Condition</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{(lead as any).propertyCondition}
                        {(lead as any).propertyQuality && <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">· {(lead as any).propertyQuality} quality</span>}
                      </dd>
                    </div>
                  )}
                  {(lead as any).hasPool && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Pool</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">Yes 🏊</dd>
                    </div>
                  )}
                  {(lead as any).coolingType && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Cooling</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100 capitalize">{(lead as any).coolingType.toLowerCase()}</dd>
                    </div>
                  )}
                  {(lead as any).heatingType && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Heating</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100 capitalize">{(lead as any).heatingType.toLowerCase()}</dd>
                    </div>
                  )}
                  {lead.ownerOccupied != null && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Owner Occupied</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{lead.ownerOccupied ? 'Yes' : 'No'}</dd>
                    </div>
                  )}
                  {(lead as any).ownerName && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Recorded Owner</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100 font-medium">{(lead as any).ownerName}</dd>
                    </div>
                  )}
                  {(lead as any).apn && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">APN</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100 font-mono">{(lead as any).apn}</dd>
                    </div>
                  )}
                  {lead.hoaFee && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">HOA Fee</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">${lead.hoaFee.toLocaleString()}/mo</dd>
                    </div>
                  )}
                  {(lead as any).subdivision && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Subdivision</dt>
                      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{(lead as any).subdivision}</dd>
                    </div>
                  )}
                  {/* MLS listing status row removed — automated check was unreliable */}
                </dl>

                {/* ── Tax & Assessment ── */}
                {((lead as any).annualTaxAmount || (lead as any).taxAssessedValue || (lead as any).marketAssessedValue) && (
                  <details open className="border-t border-gray-100 dark:border-gray-800 pt-4 mb-4 group">
                    <summary className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <svg className="w-3.5 h-3.5 text-gray-400 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                      🏦 Tax & Assessment
                    </summary>
                    <dl className="grid grid-cols-2 gap-4">
                      {(lead as any).annualTaxAmount && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Annual Property Tax</dt>
                          <dd className="mt-1 text-sm font-bold text-gray-900 dark:text-gray-100">
                            ${Math.round((lead as any).annualTaxAmount).toLocaleString()}/yr
                          </dd>
                          <dd className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            ${Math.round((lead as any).annualTaxAmount / 12).toLocaleString()}/mo hold cost
                          </dd>
                        </div>
                      )}
                      {(lead as any).taxAssessedValue && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Tax Assessed Value</dt>
                          <dd className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                            ${Math.round((lead as any).taxAssessedValue).toLocaleString()}
                          </dd>
                          {lead.arv && (
                            <dd className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                              {(((lead as any).taxAssessedValue / lead.arv) * 100).toFixed(0)}% of ARV
                            </dd>
                          )}
                        </div>
                      )}
                      {(lead as any).marketAssessedValue && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Market Assessed Value</dt>
                          <dd className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                            ${Math.round((lead as any).marketAssessedValue).toLocaleString()}
                          </dd>
                        </div>
                      )}
                      {lead.arv && (lead as any).annualTaxAmount && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Tax Rate (est.)</dt>
                          <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                            {(((lead as any).annualTaxAmount / lead.arv) * 100).toFixed(2)}% of ARV
                          </dd>
                        </div>
                      )}
                    </dl>
                  </details>
                )}

                {/* ── Sale History ── */}
                {(() => {
                  const saleHistory: any[] = (lead as any).reapiSaleHistory || [];
                  const saleHistorySource = saleHistory.length > 0 ? 'REAPI' : null;
                  const hasAnySale = lead.lastSaleDate || lead.lastSalePrice || saleHistory.length > 0;
                  if (!hasAnySale) return null;
                  return (
                    <details open className="border-t border-gray-100 dark:border-gray-800 pt-4 mb-4 group">
                      <summary className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        <svg className="w-3.5 h-3.5 text-gray-400 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        🏷️ Sale History
                        {saleHistorySource && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">via {saleHistorySource}</span>
                        )}
                      </summary>

                      {saleHistory.length > 0 ? (
                        <div className="space-y-2">
                          {saleHistory.map((sale: any, i: number) => {
                            const isMostRecent = i === 0;
                            const saleDate = sale.saleTransDate || sale.saleRecDate;
                            const yearsHeld = saleHistory[i + 1]?.saleTransDate
                              ? Math.round((new Date(saleDate).getTime() - new Date(saleHistory[i + 1].saleTransDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                              : null;
                            return (
                              <div key={i} className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${isMostRecent ? 'bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800' : 'bg-gray-50 dark:bg-gray-950 border border-gray-100 dark:border-gray-800'}`}>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className={`text-sm font-bold ${isMostRecent ? 'text-blue-700 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}`}>
                                      ${Math.round(sale.saleAmt).toLocaleString()}
                                    </span>
                                    {sale.saleTransType && (
                                      <span className="text-xs text-gray-400 dark:text-gray-500">{sale.saleTransType}</span>
                                    )}
                                    {isMostRecent && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">Most Recent</span>}
                                  </div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                    {saleDate ? new Date(saleDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                                    {yearsHeld !== null && yearsHeld > 0 && <span className="ml-1">· held {yearsHeld}yr</span>}
                                    {sale.pricePerSqft && <span className="ml-1">· ${Math.round(sale.pricePerSqft)}/sqft</span>}
                                  </div>
                                </div>
                                {lead.arv && (
                                  <div className="text-right">
                                    <div className={`text-xs font-medium ${sale.saleAmt < lead.arv * 0.6 ? 'text-green-600' : sale.saleAmt < lead.arv * 0.8 ? 'text-yellow-600' : 'text-red-500'}`}>
                                      {((sale.saleAmt / lead.arv) * 100).toFixed(0)}% of ARV
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {/* Equity callout using most recent sale */}
                          {saleHistory[0]?.saleAmt && lead.arv && (
                            <div className={`mt-1 rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${
                              saleHistory[0].saleAmt < lead.arv * 0.6 ? 'bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-400 border border-green-200 dark:border-green-800'
                              : saleHistory[0].saleAmt < lead.arv * 0.8 ? 'bg-yellow-50 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800'
                              : 'bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-400 border border-red-200 dark:border-red-800'
                            }`}>
                              <span>{saleHistory[0].saleAmt < lead.arv * 0.6 ? '💚' : saleHistory[0].saleAmt < lead.arv * 0.8 ? '⚠️' : '🔴'}</span>
                              <span>
                                {saleHistory[0].saleAmt < lead.arv * 0.6
                                  ? `Strong equity — paid $${Math.round(saleHistory[0].saleAmt).toLocaleString()}, ARV $${lead.arv.toLocaleString()} (+$${(lead.arv - saleHistory[0].saleAmt).toLocaleString()})`
                                  : saleHistory[0].saleAmt < lead.arv * 0.8
                                  ? `Moderate equity — paid $${Math.round(saleHistory[0].saleAmt).toLocaleString()}, limited upside`
                                  : `Thin equity — paid $${Math.round(saleHistory[0].saleAmt).toLocaleString()}, near ARV`}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        /* Fallback: single sale from lead fields */
                        <dl className="grid grid-cols-2 gap-4">
                          {lead.lastSaleDate && (
                            <div>
                              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Last Sale Date</dt>
                              <dd className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                                {new Date(lead.lastSaleDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                              </dd>
                            </div>
                          )}
                          {lead.lastSalePrice && (
                            <div>
                              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Last Sale Price</dt>
                              <dd className="mt-1 text-sm font-bold text-blue-700 dark:text-blue-400">${lead.lastSalePrice.toLocaleString()}</dd>
                            </div>
                          )}
                        </dl>
                      )}
                    </details>
                  );
                })()}

                {/* ── Mortgage Information ── */}
                {(() => {
                  const mortgage = (lead as any).reapiMortgageData;
                  const mortgageSource = mortgage ? 'REAPI' : null;
                  if (!mortgage || (!mortgage.firstConcurrent && !mortgage.secondConcurrent)) return null;
                  const formatLoanType = (code: string | undefined) => {
                    if (!code) return null;
                    const map: Record<string, string> = { CNV: 'Conventional', FHA: 'FHA', VA: 'VA', USDA: 'USDA', HEL: 'Home Equity', RVS: 'Reverse' };
                    return map[code.toUpperCase()] || code;
                  };
                  const formatRateType = (type: string | undefined) => {
                    if (!type) return '';
                    return type.toUpperCase() === 'FIX' ? 'Fixed' : type.toUpperCase() === 'ARM' ? 'ARM' : type;
                  };
                  const totalOriginalDebt = (mortgage.firstConcurrent?.amount || 0) + (mortgage.secondConcurrent?.amount || 0);
                  const renderLoan = (loan: any, label: string) => {
                    if (!loan) return null;
                    return (
                      <div className="bg-gray-50 dark:bg-gray-950 rounded-lg px-3 py-2.5 border border-gray-100 dark:border-gray-800">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
                          {loan.loanTypeCode && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium">
                              {formatLoanType(loan.loanTypeCode)}
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
                          ${Math.round(loan.amount).toLocaleString()}
                        </div>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                          {loan.lenderLastName && (
                            <div>
                              <dt className="text-xs text-gray-400 dark:text-gray-500">Lender</dt>
                              <dd className="text-xs text-gray-700 dark:text-gray-300 capitalize">{loan.lenderLastName.toLowerCase()}</dd>
                            </div>
                          )}
                          {loan.interestRate && (
                            <div>
                              <dt className="text-xs text-gray-400 dark:text-gray-500">Rate</dt>
                              <dd className="text-xs text-gray-700 dark:text-gray-300">
                                {loan.interestRate}% {formatRateType(loan.interestRateType)}
                              </dd>
                            </div>
                          )}
                          {loan.date && (
                            <div>
                              <dt className="text-xs text-gray-400 dark:text-gray-500">Originated</dt>
                              <dd className="text-xs text-gray-700 dark:text-gray-300">
                                {new Date(loan.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
                              </dd>
                            </div>
                          )}
                          {loan.dueDate && (
                            <div>
                              <dt className="text-xs text-gray-400 dark:text-gray-500">Maturity</dt>
                              <dd className="text-xs text-gray-700 dark:text-gray-300">
                                {new Date(loan.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
                              </dd>
                            </div>
                          )}
                          {loan.term && (
                            <div>
                              <dt className="text-xs text-gray-400 dark:text-gray-500">Term</dt>
                              <dd className="text-xs text-gray-700 dark:text-gray-300">
                                {loan.termType?.toUpperCase() === 'MOS' ? `${Math.round(loan.term / 12)}yr` : `${loan.term}yr`}
                              </dd>
                            </div>
                          )}
                        </dl>
                      </div>
                    );
                  };
                  return (
                    <details open className="border-t border-gray-100 dark:border-gray-800 pt-4 mb-4 group">
                      <summary className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        <svg className="w-3.5 h-3.5 text-gray-400 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        🏠 Mortgage Information
                        {mortgageSource && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">via {mortgageSource}</span>
                        )}
                      </summary>
                      <div className="space-y-2">
                        {renderLoan(mortgage.firstConcurrent, '1st Mortgage')}
                        {renderLoan(mortgage.secondConcurrent, '2nd Mortgage')}
                        {mortgage.title?.companyName && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Title: <span className="capitalize">{mortgage.title.companyName.toLowerCase()}</span>
                          </div>
                        )}
                        {/* Equity insight: compare original debt to ARV */}
                        {lead.arv && totalOriginalDebt > 0 && (
                          <div className={`mt-1 rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${
                            totalOriginalDebt < lead.arv * 0.6 ? 'bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-400 border border-green-200 dark:border-green-800'
                            : totalOriginalDebt < lead.arv * 0.8 ? 'bg-yellow-50 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800'
                            : 'bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-400 border border-red-200 dark:border-red-800'
                          }`}>
                            <span>{totalOriginalDebt < lead.arv * 0.6 ? '💚' : totalOriginalDebt < lead.arv * 0.8 ? '⚠️' : '🔴'}</span>
                            <span>
                              Original debt ${Math.round(totalOriginalDebt).toLocaleString()} = {((totalOriginalDebt / lead.arv) * 100).toFixed(0)}% of ARV
                              {totalOriginalDebt < lead.arv * 0.6
                                ? ' — likely significant equity'
                                : totalOriginalDebt < lead.arv * 0.8
                                ? ' — moderate equity potential'
                                : ' — thin equity (verify payoff)'}
                            </span>
                          </div>
                        )}
                      </div>
                    </details>
                  );
                })()}
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Valuation — ARV, Asking Price, MAO */}
              <div className="card">
                <h3 className="text-lg font-bold mb-4">Valuation</h3>

                {/* ARV (primary) */}
                {lead.arv ? (
                  <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-300 dark:border-green-800">
                    <div className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">🏠 ARV</div>
                    <div className="text-3xl font-bold text-green-700 dark:text-green-400">${lead.arv.toLocaleString()}</div>
                    <div className="flex items-center gap-3 mt-1">
                      {lead.arvConfidence && (
                        <span className="text-xs text-green-600 dark:text-green-400">{lead.arvConfidence}% confidence</span>
                      )}
                      {lead.lastCompsDate && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">Updated {format(new Date(lead.lastCompsDate), 'MMM d')}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mb-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 space-y-2">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">ARV not yet available</div>
                    {showArvEdit ? (
                      <div className="space-y-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder="e.g. 185000"
                          value={arvInput}
                          onChange={(e) => setArvInput(e.target.value)}
                          className="input w-full text-sm"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button onClick={handleSaveArv} disabled={savingArv || !arvInput.trim()} className="btn btn-primary btn-sm flex-1">
                            {savingArv ? 'Saving…' : 'Save ARV'}
                          </button>
                          <button onClick={() => { setShowArvEdit(false); setArvInput(''); }} className="btn btn-secondary btn-sm">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Link href={`/leads/${leadId}/comps-analysis`} className="btn btn-primary btn-sm flex-1 text-center">
                          Run Full Analysis
                        </Link>
                        <button onClick={() => setShowArvEdit(true)} className="btn btn-secondary btn-sm flex-1">
                          Enter manually
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Asking Price */}
                {lead.askingPrice ? (
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Asking Price</div>
                      <div className="text-xl font-bold text-gray-800 dark:text-gray-200">${lead.askingPrice.toLocaleString()}</div>
                    </div>
                    {lead.arv && (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        lead.askingPrice / lead.arv < 0.7 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                        lead.askingPrice / lead.arv < 0.85 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                        'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                      }`}>
                        {((lead.askingPrice / lead.arv) * 100).toFixed(0)}% of ARV
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mb-3 text-xs text-gray-400 dark:text-gray-500 italic">Asking price not provided yet</div>
                )}

                {/* MAO */}
                {lead.arv && (
                  <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
                    {(() => {
                      const repairEst = (lead as any).repairCosts || 0;
                      const fee = (lead as any).assignmentFee || 0;
                      const maoPct = ((lead as any).maoPercent ?? 70) / 100;
                      const mao = Math.round(lead.arv * maoPct - fee - repairEst);
                      const maoPctDisplay = Math.round(maoPct * 100);
                      const feeDisplay = fee > 0 ? ` − $${fee.toLocaleString()} fee` : '';
                      return (
                        <>
                          <div className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1">MAO ({maoPctDisplay}%{feeDisplay})</div>
                          <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">${Math.max(mao, 0).toLocaleString()}</div>
                          {repairEst > 0 && (
                            <div className="text-xs text-blue-500 dark:text-blue-400 mt-0.5">incl. ~${repairEst.toLocaleString()} repairs</div>
                          )}
                          {lead.askingPrice && (
                            <div className={`text-xs mt-1 font-medium ${lead.askingPrice <= mao ? 'text-green-600' : 'text-red-600'}`}>
                              {lead.askingPrice <= mao ? '✓ Under MAO' : `$${(lead.askingPrice - mao).toLocaleString()} over MAO`}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {compsResult && (
                  <div className="mb-3 text-xs px-2 py-1.5 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 rounded border border-green-200 dark:border-green-800">
                    Found {compsResult.compsCount} comps via {compsResult.source}
                  </div>
                )}
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => handleFetchComps(false)}
                    disabled={fetchingComps}
                    className="btn btn-secondary btn-sm flex-1"
                  >
                    {fetchingComps ? 'Fetching...' : 'Fetch Live Comps'}
                  </button>
                  <Link href={`/leads/${leadId}/comps-analysis`} className="btn btn-primary btn-sm flex-1 text-center">
                    Full Analysis
                  </Link>
                </div>
                {lead.arv && (
                  <button onClick={() => handleFetchComps(true)} disabled={fetchingComps} className="text-xs text-primary-600 hover:underline w-full text-center">
                    Force Refresh
                  </button>
                )}
              </div>

              {/* Seller Portal */}
              <SellerPortalPanel leadId={leadId} />

              {/* Assignment */}
              <div className="card">
                <h3 className="text-lg font-bold mb-3">Assignment</h3>
                {lead.assignedTo ? (
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                      {lead.assignedTo.firstName?.[0]}{lead.assignedTo.lastName?.[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {lead.assignedTo.firstName} {lead.assignedTo.lastName}
                      </div>
                      {lead.assignedStage && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">{lead.assignedStage}</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">Unassigned</p>
                )}
                <div className="space-y-2">
                  <select
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                    className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select team member...</option>
                    {teamMembers.map((u: any) => (
                      <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                    ))}
                  </select>
                  <select
                    value={assignStage}
                    onChange={(e) => setAssignStage(e.target.value)}
                    className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select stage...</option>
                    <option value="intake">Intake</option>
                    <option value="disposition">Disposition</option>
                    <option value="closing">Closing</option>
                    <option value="follow-up">Follow-up</option>
                  </select>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAssign}
                      disabled={assignSaving || !assignUserId || !assignStage}
                      className="btn btn-primary btn-sm flex-1"
                    >
                      {assignSaving ? 'Saving...' : 'Assign'}
                    </button>
                    {lead.assignedTo && (
                      <button
                        onClick={handleUnassign}
                        disabled={assignSaving}
                        className="btn btn-secondary btn-sm"
                      >
                        Unassign
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Deal Tier */}
              <div className="card">
                <h3 className="text-lg font-bold mb-3">Deal Tier</h3>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">How likely are we to get this under contract?</p>
                <div className="space-y-2">
                  {[
                    { tier: 1, label: 'Tier 1', sub: 'Send a contract now', color: 'border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-400', activeColor: 'border-green-500 bg-green-500 text-white' },
                    { tier: 2, label: 'Tier 2', sub: 'Opportunity, keep pursuing', color: 'border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-400', activeColor: 'border-yellow-500 bg-yellow-500 text-white' },
                    { tier: 3, label: 'Tier 3', sub: 'Low chance, dead/no go', color: 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-950 text-gray-600 dark:text-gray-400', activeColor: 'border-gray-500 bg-gray-500 text-white' },
                  ].map(({ tier, label, sub, color, activeColor }) => {
                    const isActive = lead.tier === tier;
                    return (
                      <button
                        key={tier}
                        onClick={() => handleSetTier(isActive ? null : tier)}
                        disabled={settingTier}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border-2 text-left transition-all disabled:opacity-50 ${isActive ? activeColor : `${color} hover:opacity-80`}`}
                      >
                        <div>
                          <div className="text-sm font-semibold">{label}</div>
                          <div className={`text-xs ${isActive ? 'opacity-80' : 'opacity-60'}`}>{sub}</div>
                        </div>
                        {isActive && <span className="text-sm">✓</span>}
                      </button>
                    );
                  })}
                  {lead.tier && (
                    <button onClick={() => handleSetTier(null)} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 w-full text-center">
                      Clear tier
                    </button>
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="card">
                <h3 className="text-lg font-bold mb-3">Quick Actions</h3>
                {lead.status === 'DEAD' ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm">
                    <span>💀</span>
                    <span className="font-medium">Lead is Dead</span>
                  </div>
                ) : !showDeadForm ? (
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={handleSendOutreach}
                      disabled={sendingOutreach || lead.doNotContact}
                      className="flex flex-col items-center gap-1 px-2 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={lead.doNotContact ? 'Lead is Do Not Contact' : 'Send initial outreach SMS'}
                    >
                      <span className="text-lg">✉️</span>
                      <span>{sendingOutreach ? 'Sending…' : 'Send SMS'}</span>
                    </button>
                    <button
                      onClick={openScheduleFollowUp}
                      className="flex flex-col items-center gap-1 px-2 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 font-medium transition-colors"
                    >
                      <span className="text-lg">📅</span>
                      <span>Follow-up</span>
                    </button>
                    <button
                      onClick={() => setShowShareModal(true)}
                      className="flex flex-col items-center gap-1 px-2 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 font-medium transition-colors"
                    >
                      <span className="text-lg">🤝</span>
                      <span>Share</span>
                    </button>
                    <button
                      onClick={handleAiCall}
                      disabled={!!lead.doNotContact}
                      className="flex flex-col items-center gap-1 px-2 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={lead.doNotContact ? 'Lead is Do Not Contact' : 'Start AI call'}
                    >
                      <span className="text-lg">📞</span>
                      <span>AI Call</span>
                    </button>
                    <Link
                      href={`/leads/${leadId}/comps-analysis?tab=deal-intel`}
                      className="flex flex-col items-center gap-1 px-2 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 font-medium transition-colors"
                    >
                      <span className="text-lg">💰</span>
                      <span>Offer</span>
                    </Link>
                    <button
                      onClick={() => setShowDeadForm(true)}
                      className="flex flex-col items-center gap-1 px-2 py-3 rounded-lg border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 text-xs font-medium transition-colors"
                    >
                      <span className="text-lg">💀</span>
                      <span>Mark Dead</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Reason for disqualifying <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={deadReason}
                        onChange={(e) => setDeadReason(e.target.value)}
                        placeholder="e.g. Seller doesn't own the lot, asking price too high, no motivation..."
                        className="input w-full"
                        rows={3}
                        autoFocus
                      />
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">This will be saved as a note before marking dead.</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleMarkDead}
                        disabled={markingDead || !deadReason.trim()}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        {markingDead ? 'Saving...' : '💀 Confirm Dead'}
                      </button>
                      <button
                        onClick={() => { setShowDeadForm(false); setDeadReason(''); }}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Follow-Up Reminders */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold">Follow-Ups</h3>
                  <button
                    onClick={openScheduleFollowUp}
                    className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    + Schedule
                  </button>
                </div>

                {leadTasks.filter((t: any) => !t.completed).length > 0 ? (
                  <div className="space-y-2">
                    {leadTasks.filter((t: any) => !t.completed).map((task: any) => (
                      <div key={task.id} className="flex items-start gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-900">
                        <button
                          onClick={() => handleCompleteTask(task.id)}
                          className="mt-0.5 w-4 h-4 rounded border-2 border-gray-300 dark:border-gray-600 hover:border-primary-500 flex-shrink-0 transition-colors"
                          title="Mark complete"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{task.title}</div>
                          {task.description && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{task.description}</div>
                          )}
                          {task.dueDate && (
                            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                              {format(new Date(task.dueDate), 'MMM d, yyyy · h:mm a')}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={openScheduleFollowUp}
                    className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 py-4 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg hover:border-primary-300 dark:hover:border-primary-800 transition-colors"
                  >
                    + Schedule your first follow-up
                  </button>
                )}
              </div>

              {/* Share Deal */}
              <div className="card">
                <h3 className="text-lg font-bold mb-3">Deal Sharing</h3>
                <button
                  onClick={() => setShowShareModal(true)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 text-sm font-medium transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                  Share with Partners
                </button>
                <ShareHistory leadId={leadId} />
              </div>
            </div>
          </div>
        )}

        <ShareDealModal
          leadId={leadId}
          propertyAddress={lead ? `${lead.propertyAddress}, ${lead.propertyCity}` : ''}
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
        />

        {/* Disposition Tab */}
        {activeTab === 'disposition' && (
          <div className="space-y-6">
            {/* Pipeline Stage — always-visible status changer */}
            <div className="card flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Pipeline Stage</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Track where this lead is in your process. Stage advances automatically when offers are made or contracts are signed.</div>
              </div>
              <select
                value={lead.status}
                onChange={async (e) => {
                  const newStatus = e.target.value;
                  try {
                    await leadsAPI.update(leadId, { status: newStatus });
                    setLead((prev: any) => prev ? { ...prev, status: newStatus } : prev);
                  } catch (err) {
                    console.error('Failed to update status', err);
                    alert('Failed to update stage');
                  }
                }}
                className={`text-sm font-semibold px-4 py-2 rounded-lg border cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 min-w-[180px] ${
                  lead.status === 'SOLD'                                     ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 focus:ring-green-400' :
                  lead.status === 'ACQUIRED'                                 ? 'bg-cyan-50 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800 focus:ring-cyan-400' :
                  ['DEAD','CLOSED_LOST','SOLD_LOSS','HELD_LONG_TERM','CANCELLED'].includes(lead.status) ? 'bg-gray-50 dark:bg-gray-950 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 focus:ring-gray-400' :
                  lead.status === 'UNDER_CONTRACT'                           ? 'bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800 focus:ring-teal-400' :
                  lead.status === 'OFFER_SENT'                               ? 'bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800 focus:ring-orange-400' :
                  lead.status === 'NEGOTIATING'                              ? 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 focus:ring-amber-400' :
                  lead.status === 'QUALIFYING' || lead.status === 'QUALIFIED'? 'bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800 focus:ring-purple-400' :
                  lead.status === 'CLOSING'                                  ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 focus:ring-emerald-400' :
                  lead.status === 'NURTURE'                                  ? 'bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800 focus:ring-sky-400' :
                  'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 focus:ring-blue-400'
                }`}
              >
                <option value="NEW">New Lead</option>
                <option value="ATTEMPTING_CONTACT">Attempting Contact</option>
                <option value="QUALIFYING">Qualifying</option>
                <option value="QUALIFIED">Qualified</option>
                <option value="OFFER_SENT">Offer Made</option>
                <option value="NEGOTIATING">Negotiating</option>
                <option value="UNDER_CONTRACT">Under Contract</option>
                <option value="CLOSING">Closing</option>
                <option value="ACQUIRED">Acquired</option>
                <option value="SOLD">Sold</option>
                <option value="SOLD_LOSS">Sold (Loss)</option>
                <option value="HELD_LONG_TERM">Held (Long Term)</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="CLOSED_LOST">Closed / Lost</option>
                <option value="NURTURE">Nurture</option>
                <option value="DEAD">Dead</option>
              </select>
            </div>
            <DispoTab leadId={leadId} leadAddress={lead.propertyAddress} leadStatus={lead.status} />
          </div>
        )}

        {/* Communications Tab */}
        {activeTab === 'communications' && (
          <div className="flex flex-col gap-4 lg:flex-1 lg:min-h-0">

              {/* AI paused banner — shown when a human has stepped in */}
              {!lead.autoRespond && !lead.doNotContact && lead.status !== 'DEAD' && (
                <div className="shrink-0 flex items-center justify-between gap-4 px-4 py-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950">
                  <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400 text-sm">
                    <span className="text-base">🤚</span>
                    <span><strong>AI paused</strong> — you stepped in manually. The AI will not auto-respond until you resume it.</span>
                  </div>
                  <button
                    onClick={handleToggleAutoRespond}
                    disabled={togglingAutoRespond}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    {togglingAutoRespond ? 'Resuming...' : '▶ Resume AI'}
                  </button>
                </div>
              )}

              {/* Unified communications timeline (scrolls internally) */}
              <div className="card flex flex-col lg:flex-1 lg:min-h-0 overflow-hidden">
                <div className="flex items-center justify-between mb-4 shrink-0">
                  <h2 className="text-xl font-bold">Communications</h2>
                  {comms.timeline.length === 0 && !lead.doNotContact && lead.status !== 'DEAD' && (
                    <button
                      onClick={handleSendOutreach}
                      disabled={sendingOutreach}
                      className="btn btn-sm text-xs border border-green-300 dark:border-green-800 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950 disabled:opacity-50"
                    >
                      {sendingOutreach ? 'Sending…' : '📤 Send Initial Text'}
                    </button>
                  )}
                </div>
                <div ref={timelineScrollRef} className="flex-1 lg:min-h-0 overflow-y-auto">
                  <CommunicationsTimeline items={comms.timeline} />
                  <div ref={messagesBottomRef} />
                </div>
              </div>

              {/* Demo: simulate an inbound seller reply */}
              {demoMode && (
                <div className="card shrink-0">
                  <div className="p-4 border-2 border-dashed border-amber-300 dark:border-amber-800 rounded-lg bg-amber-50 dark:bg-amber-950">
                    <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-400 mb-2">Simulate Seller Reply (Demo)</h4>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {[
                        'I was hoping to get around $180,000 for it.',
                        'I need to sell within 30 days, relocating for work.',
                        'The roof needs replacing and the kitchen is outdated. Needs a lot of work.',
                        'I am the sole owner, no mortgage left on it.',
                      ].map((sample) => (
                        <button
                          key={sample}
                          onClick={() => setSimReplyText(sample)}
                          className="text-xs px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-800 dark:text-amber-400 text-left"
                        >
                          {sample.substring(0, 50)}...
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={simReplyText}
                      onChange={(e) => setSimReplyText(e.target.value)}
                      placeholder="Type a simulated seller reply..."
                      className="input w-full mb-2"
                      rows={2}
                    />
                    <button
                      onClick={async () => {
                        if (!simReplyText.trim()) return;
                        setSimulatingReply(true);
                        try {
                          await messagesAPI.simulateReply(leadId, simReplyText);
                          setSimReplyText('');
                          // Short delay to let auto-response complete
                          setTimeout(() => loadLead(), 1500);
                        } catch (error) {
                          console.error('Failed to simulate reply:', error);
                          alert('Failed to simulate reply');
                        } finally {
                          setSimulatingReply(false);
                        }
                      }}
                      disabled={simulatingReply || !simReplyText.trim()}
                      className="btn btn-primary btn-sm"
                    >
                      {simulatingReply ? 'Sending...' : 'Simulate Reply'}
                    </button>
                  </div>
                </div>
              )}

              {/* Unified composer: SMS / Email / Internal Comment */}
              <div className="card p-0 overflow-hidden shrink-0">
                <MessageComposer
                  leadId={leadId}
                  sellerPhone={lead.sellerPhone}
                  sellerEmail={lead.sellerEmail}
                  gmailConnected={gmailConnected}
                  currentUser={currentUser}
                  teamMembers={teamMembers}
                  doNotContact={lead.doNotContact}
                  seedBody={selectedDraft}
                  onSent={loadLead}
                />
              </div>
            {/* Mobile fallback: notes inline below the conversation; desktop uses the right pane */}
            <div className="lg:hidden card">
              <NotesPanel
                notes={comms.notes}
                canAdd={!!currentUser}
                onAddNote={async (text) => {
                  if (!currentUser) return;
                  await leadsAPI.addNote(leadId, text, currentUser.id);
                  await loadComms();
                }}
              />
            </div>
          </div>
        )}

        {/* Activity Tab */}
        {activeTab === 'activity' && (
          <div className="space-y-6">

            {/* Notes summary */}
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Notes{lead.notes?.length > 0 ? ` (${lead.notes.length})` : ''}</h2>
                <Link href={`/leads/${leadId}?tab=communications`} className="text-sm text-primary-600 hover:underline">
                  Add / View all →
                </Link>
              </div>
              {lead.notes?.length > 0 ? (
                <div className="space-y-3">
                  {lead.notes.slice(0, 3).map((note: any) => (
                    <div key={note.id} className={`p-3 rounded-lg border ${note.content?.startsWith('[Dead]') ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950' : 'border-blue-100 dark:border-blue-800 bg-blue-50 dark:bg-blue-950'}`}>
                      <div className="flex justify-between items-start mb-1">
                        <span className={`text-xs font-medium ${note.content?.startsWith('[Dead]') ? 'text-red-700 dark:text-red-400' : 'text-blue-700 dark:text-blue-400'}`}>
                          {note.content?.startsWith('[Dead]') ? '💀 ' : '📝 '}
                          {note.user ? `${note.user.firstName} ${note.user.lastName}` : '🤖 AI'}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {format(new Date(note.createdAt), 'MMM d, h:mm a')}
                        </span>
                      </div>
                      <div className="text-sm text-gray-800 whitespace-pre-wrap">
                        {note.content?.startsWith('[Dead] ') ? note.content.slice(7) : note.content}
                      </div>
                    </div>
                  ))}
                  {lead.notes.length > 3 && (
                    <Link href={`/leads/${leadId}?tab=communications`} className="text-sm text-primary-600 hover:underline block">
                      + {lead.notes.length - 3} more note{lead.notes.length - 3 !== 1 ? 's' : ''}
                    </Link>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  No notes yet.{' '}
                  <Link href={`/leads/${leadId}?tab=communications`} className="text-primary-600 hover:underline">
                    Add one →
                  </Link>
                </p>
              )}
            </div>

            {/* Campaign Enrollments */}
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">🔁 Drip Campaigns</h2>
                <Link href="/drip-campaigns" className="text-sm text-primary-600 hover:underline">
                  Manage →
                </Link>
              </div>

              {/* Active enrollments */}
              {leadEnrollments.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {leadEnrollments.map((enrollment: any) => (
                    <div key={enrollment.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-950 rounded-lg border border-gray-100 dark:border-gray-800">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                          {enrollment.campaign?.name || 'Campaign'}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Step {enrollment.currentStepOrder} ·{' '}
                          <span className={`font-medium ${
                            enrollment.status === 'ACTIVE' ? 'text-green-600 dark:text-green-400' :
                            enrollment.status === 'PAUSED' ? 'text-yellow-600 dark:text-yellow-400' :
                            enrollment.status === 'REPLIED' ? 'text-purple-600 dark:text-purple-400' :
                            'text-gray-500 dark:text-gray-400'
                          }`}>
                            {enrollment.status}
                          </span>
                          {enrollment.nextSendAt && enrollment.status === 'ACTIVE' && (
                            <> · Next: {new Date(enrollment.nextSendAt).toLocaleDateString()}</>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {enrollment.status === 'ACTIVE' && (
                          <button
                            onClick={async () => {
                              await campaignAPI.pause(enrollment.id);
                              setLeadEnrollments((prev) =>
                                prev.map((e) => e.id === enrollment.id ? { ...e, status: 'PAUSED' } : e),
                              );
                            }}
                            className="text-xs px-2 py-1 text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 rounded transition-colors"
                          >
                            Pause
                          </button>
                        )}
                        {enrollment.status === 'PAUSED' && (
                          <button
                            onClick={async () => {
                              await campaignAPI.resume(enrollment.id);
                              setLeadEnrollments((prev) =>
                                prev.map((e) => e.id === enrollment.id ? { ...e, status: 'ACTIVE' } : e),
                              );
                            }}
                            className="text-xs px-2 py-1 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors"
                          >
                            Resume
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            if (!confirm('Remove from this campaign?')) return;
                            await campaignAPI.unenroll(enrollment.id);
                            setLeadEnrollments((prev) => prev.filter((e) => e.id !== enrollment.id));
                          }}
                          className="text-xs px-2 py-1 text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">Not enrolled in any campaigns.</p>
              )}

              {/* Enroll in campaign */}
              <div className="flex gap-2">
                <select
                  value={selectedCampaignId}
                  onChange={(e) => setSelectedCampaignId(e.target.value)}
                  className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">Select a campaign...</option>
                  {availableCampaigns.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!selectedCampaignId || enrollingInCampaign}
                  onClick={async () => {
                    if (!selectedCampaignId) return;
                    setEnrollingInCampaign(true);
                    try {
                      await campaignAPI.enrollLead(selectedCampaignId, leadId);
                      const res = await campaignAPI.leadCampaigns(leadId);
                      setLeadEnrollments(res.data || []);
                      setSelectedCampaignId('');
                    } finally {
                      setEnrollingInCampaign(false);
                    }
                  }}
                  className="px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
                >
                  {enrollingInCampaign ? '...' : 'Enroll'}
                </button>
              </div>
            </div>

            {/* Activity Log */}
            <div className="card">
              <h2 className="text-xl font-bold mb-4">Activity Log</h2>
              <div className="space-y-3">
                {lead.activities?.map((activity: any) => {
                  const meta = ACTIVITY_TYPE_META[activity.type] ?? {};
                  return (
                    <div key={activity.id} className="p-3 bg-gray-50 dark:bg-gray-950 rounded">
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex items-start gap-2 min-w-0">
                          {meta.icon && (
                            <span className={`shrink-0 text-base leading-none mt-0.5 ${meta.color ?? ''}`}>{meta.icon}</span>
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{activity.description}</div>
                            {activity.user && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                by {activity.user.firstName} {activity.user.lastName}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                          {format(new Date(activity.createdAt), 'MMM d, h:mm a')}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}
      </main>
      </div>{/* end center column */}

      {/* Right notes pane (desktop, conversation view) */}
      {activeTab === 'communications' && (notesOpen ? (
        <aside className="hidden lg:flex w-80 xl:w-96 shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex-col lg:min-h-0">
          <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Notes</span>
            <button
              type="button"
              onClick={toggleNotes}
              title="Collapse notes"
              className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <NotesPanel
              notes={comms.notes}
              canAdd={!!currentUser}
              onAddNote={async (text) => {
                if (!currentUser) return;
                await leadsAPI.addNote(leadId, text, currentUser.id);
                await loadComms();
              }}
            />
          </div>
        </aside>
      ) : (
        <div className="hidden lg:block shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <button
            type="button"
            onClick={toggleNotes}
            title="Show notes"
            className="h-full px-1.5 py-4 text-[11px] font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors [writing-mode:vertical-rl]"
          >
            Notes
          </button>
        </div>
      ))}

      </div>{/* end workspace */}
      </div>{/* end full-height shell */}
      <ScheduleFollowUpModal
        open={showFollowUpModal}
        onClose={() => setShowFollowUpModal(false)}
        onCreated={refreshLeadTasks}
        lead={{
          id: leadId,
          propertyAddress: lead.propertyAddress,
          propertyCity: lead.propertyCity,
          propertyState: lead.propertyState,
          sellerFirstName: lead.sellerFirstName,
          sellerLastName: lead.sellerLastName,
        }}
      />
    </AppShell>
  );
}

function CampCard({
  label,
  subtitle,
  complete,
  value,
  isNext,
}: {
  label: string;
  subtitle: string;
  complete: boolean;
  value: string | null;
  isNext?: boolean;
}) {
  return (
    <div
      className={`p-3 rounded-lg border-2 ${
        complete
          ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950'
          : isNext
          ? 'border-primary-300 dark:border-primary-800 bg-primary-50 dark:bg-primary-950'
          : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{label}</span>
        {complete ? (
          <span className="text-green-600 dark:text-green-400 text-xs font-bold">Done</span>
        ) : isNext ? (
          <span className="text-primary-600 text-xs font-bold">Next</span>
        ) : (
          <span className="text-gray-400 dark:text-gray-500 text-xs">Pending</span>
        )}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</div>
      {value && (
        <div className="text-sm font-medium text-gray-800 mt-1">{value}</div>
      )}
    </div>
  );
}

function ScoreBar({ label, score, max }: { label: string; score: number; max: number }) {
  const percentage = (score / max) * 100;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-700 dark:text-gray-300">{label}</span>
        <span className="font-medium">{score}/{max}</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div
          className="bg-primary-600 h-2 rounded-full"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

