'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { leadsAPI, messagesAPI, settingsAPI, authAPI, gmailAPI, sellerPortalAPI, inboxAPI } from '@/lib/api';
import DispoTab from '@/components/DispoTab';
import AppShell from '@/components/AppShell';
import LeadTabNav, { DETAIL_TABS, COMPS_TABS } from '@/components/LeadTabNav';
import LeadQueueNav from '@/components/leadDetailV2/LeadQueueNav';
import LeadRail from '@/components/leadDetailV2/LeadRail';
import LeadSidePanel from '@/components/leadDetailV2/LeadSidePanel';
import AlertsCard from '@/components/leadDetailV2/AlertsCard';
import { useContradictions } from '@/components/leadDetailV2/useContradictions';
import { formatPhoneDisplay, getLeadAddressLine, getLeadDisplayName } from '@/lib/format';
import CommunicationsTimeline from '@/components/communications/CommunicationsTimeline';
import NotesPanel from '@/components/communications/NotesPanel';
import MessageComposer from '@/components/communications/MessageComposer';
import type { TimelineItem, NoteItem } from '@/components/communications/types';

const LEAD_DETAIL_V2 = process.env.NEXT_PUBLIC_LEAD_DETAIL_V2 === 'restructured';

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
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [showDeadForm, setShowDeadForm] = useState(false);
  const [deadReason, setDeadReason] = useState('');
  const [markingDead, setMarkingDead] = useState(false);
  const [sendingOutreach, setSendingOutreach] = useState(false);
  const replyIntentApplied = useRef(false);
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
      loadComms();
    } catch (error) {
      console.error('Failed to load lead:', error);
    } finally {
      setLoading(false);
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

      {/* Contradiction alerts: pinned above the content on every tab */}
      <WorkspaceAlerts
        lead={lead}
        leadId={leadId}
        onToggleAutoRespond={handleToggleAutoRespond}
        onReload={loadLead}
      />

      <main className={`flex-1 min-w-0 px-4 sm:px-6 py-6 ${activeTab === 'communications' ? 'lg:flex lg:flex-col lg:min-h-0' : 'lg:overflow-y-auto'}`}>

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
            {/* Mark-dead reason form (opened by the rail's Dead action) */}
            {showDeadForm && lead.status !== 'DEAD' && (
              <div className="card border-red-200 dark:border-red-800 space-y-3">
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
                {comms.timeline.length === 0 && !lead.doNotContact && lead.status !== 'DEAD' && (
                  <div className="flex justify-end mb-3 shrink-0">
                    <button
                      onClick={handleSendOutreach}
                      disabled={sendingOutreach}
                      className="btn btn-sm text-xs border border-green-300 dark:border-green-800 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950 disabled:opacity-50"
                    >
                      {sendingOutreach ? 'Sending…' : '📤 Send Initial Text'}
                    </button>
                  </div>
                )}
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

      </main>
      </div>{/* end center column */}

      {/* Right pane (desktop, all tabs): Notes / Activity */}
      <LeadSidePanel
        modes={['notes', 'activity']}
        storagePrefix="dealcore:leadPane"
        collapsedLabel="Notes"
        lead={lead}
        notes={comms.notes}
        currentUser={currentUser}
        onAddNote={async (text) => {
          if (!currentUser) return;
          await leadsAPI.addNote(leadId, text, currentUser.id);
          await loadComms();
        }}
      />

      </div>{/* end workspace */}
      </div>{/* end full-height shell */}
    </AppShell>
  );
}

// Contradiction warnings pinned above the tab content (formerly the Overview
// tab's Alerts card). Actions resolve in place; dismissals persist per lead.
function WorkspaceAlerts({
  lead,
  leadId,
  onToggleAutoRespond,
  onReload,
}: {
  lead: any;
  leadId: string;
  onToggleAutoRespond: () => void;
  onReload: () => void;
}) {
  const router = useRouter();
  const { contradictions, dismiss } = useContradictions({
    lead,
    leadId,
    onPauseDrip: async () => {
      try {
        await leadsAPI.cancelDrip(leadId, 'User paused from Alerts');
        onReload();
      } catch (err) {
        console.error('Failed to pause drip', err);
      }
    },
    onTurnOffAutoRespond: () => {
      if (lead.autoRespond) onToggleAutoRespond();
    },
    onRunAnalysis: () => router.push(`/leads/${leadId}/comps-analysis`),
    onOpenContract: () => router.push(`/leads/${leadId}?tab=disposition&action=contract`),
    onReviewTier: () => {
      // Tier controls live in the rail now: open its Pipeline section and scroll
      // to it. Match across asides (the app nav sidebar is also an <aside>).
      const pipeline = Array.from(document.querySelectorAll('aside summary')).find(
        (s) => s.textContent?.includes('Pipeline'),
      );
      if (pipeline) {
        const details = pipeline.parentElement as HTMLDetailsElement;
        if (!details.open) (pipeline as HTMLElement).click();
        details.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
  });

  if (contradictions.length === 0) return null;
  return (
    <div className="shrink-0 px-4 sm:px-6 pt-4">
      <AlertsCard contradictions={contradictions} onDismiss={dismiss} />
    </div>
  );
}


