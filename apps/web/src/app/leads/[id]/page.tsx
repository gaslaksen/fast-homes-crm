'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { leadsAPI, messagesAPI, compsAPI, settingsAPI, photosAPI, callsAPI, authAPI, tasksAPI, gmailAPI, campaignAPI } from '@/lib/api';
import PropertyPhoto from '@/components/PropertyPhoto';
import DispoTab from '@/components/DispoTab';
import PhotoGallery from '@/components/PhotoGallery';
import AppNav from '@/components/AppNav';
import LeadTabNav, { DETAIL_TABS, COMPS_TABS } from '@/components/LeadTabNav';
import Avatar from '@/components/Avatar';
import AiSummaryBox from '@/components/AiSummaryBox';
import { format } from 'date-fns';
import { formatPhoneDisplay } from '@/lib/format';

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
    return tab && DETAIL_TABS.includes(tab as any) ? tab : 'overview';
  });

  // Sync activeTab with URL changes (tab link clicks)
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && COMPS_TABS.includes(tab as any)) {
      router.replace(`/leads/${leadId}/comps-analysis?tab=${tab}`);
    } else if (tab && DETAIL_TABS.includes(tab as any)) {
      setActiveTab(tab);
    } else if (!tab) {
      setActiveTab('overview');
    }
  }, [searchParams, leadId, router]);
  const [messageDrafts, setMessageDrafts] = useState<any>(null);
  const [selectedDraft, setSelectedDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [simulatingReply, setSimulatingReply] = useState(false);
  const [simReplyText, setSimReplyText] = useState('');
  const [togglingAutoRespond, setTogglingAutoRespond] = useState(false);
  const [fetchingComps, setFetchingComps] = useState(false);
  const [compsResult, setCompsResult] = useState<any>(null);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [initiatingCall, setInitiatingCall] = useState(false);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignStage, setAssignStage] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [showDeadForm, setShowDeadForm] = useState(false);
  const [deadReason, setDeadReason] = useState('');
  const [markingDead, setMarkingDead] = useState(false);
  const [settingTier, setSettingTier] = useState(false);
  const [emails, setEmails] = useState<any[]>([]);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [showComposeEmail, setShowComposeEmail] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);
  const [leadEnrollments, setLeadEnrollments] = useState<any[]>([]);
  const [availableCampaigns, setAvailableCampaigns] = useState<any[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [enrollingInCampaign, setEnrollingInCampaign] = useState(false);

  useEffect(() => {
    loadLead();
    settingsAPI.getDrip().then((res) => setDemoMode(res.data.demoMode ?? false)).catch(() => {});
    authAPI.getTeam().then((res) => setTeamMembers(res.data || [])).catch(() => {});
    authAPI.getMe().then((res) => setCurrentUser(res.data)).catch(() => {});
    gmailAPI.status().then((res) => setGmailConnected(res.data.connected)).catch(() => {});
    gmailAPI.emails(leadId).then((res) => setEmails(res.data || [])).catch(() => {});
    campaignAPI.leadCampaigns(leadId).then((res) => setLeadEnrollments(res.data || [])).catch(() => {});
    campaignAPI.list().then((res) => setAvailableCampaigns(res.data || [])).catch(() => {});
  }, [leadId]);

  const loadLead = async () => {
    try {
      const response = await leadsAPI.get(leadId);
      setLead(response.data);
      setAssignUserId(response.data?.assignedToUserId || '');
      setAssignStage(response.data?.assignedStage || '');
      if (response.data?.aiAnalysis) {
        try { setAiAnalysis(JSON.parse(response.data.aiAnalysis)); } catch {}
      }
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
      setSelectedDraft(response.data.friendly);
    } catch (error) {
      console.error('Failed to draft message:', error);
      alert('Failed to generate drafts');
    }
  };

  const handleSendMessage = async () => {
    if (!selectedDraft.trim()) return;
    try {
      await messagesAPI.send(leadId, selectedDraft);
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
    if (!assignUserId || !assignStage) return;
    setAssignSaving(true);
    try {
      await leadsAPI.assign(leadId, assignUserId, assignStage);
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

  const handleAddNote = async () => {
    if (!noteText.trim() || !currentUser) return;
    setAddingNote(true);
    try {
      await leadsAPI.addNote(leadId, noteText, currentUser.id);
      setNoteText('');
      loadLead();
    } catch (error) {
      console.error('Failed to add note:', error);
      alert('Failed to add note');
    } finally {
      setAddingNote(false);
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

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!lead) {
    return <div className="min-h-screen flex items-center justify-center">Lead not found</div>;
  }

  const nextFocus = getNextCampFocus(lead);
  const progress = campProgress(lead);
  const allCampComplete = progress === 4;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav />
      {/* Lead Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <PropertyPhoto
                src={lead.primaryPhoto}
                scoreBand={lead.scoreBand}
                address={lead.propertyAddress}
                size="md"
              />
              <div>
                <div className="flex items-center gap-1.5 mb-1 text-xs text-gray-400">
                  <Link href="/leads" className="hover:text-gray-700 transition-colors">Leads</Link>
                  <span>/</span>
                  <span className="text-gray-600 font-medium">{lead.propertyAddress}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-gray-900">{lead.propertyAddress}</h1>
                  {lead.tier === 1 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-800 border border-green-300 text-xs font-bold">T1 · Contract Now</span>}
                  {lead.tier === 2 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300 text-xs font-bold">T2 · Opportunity</span>}
                  {lead.tier === 3 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-300 text-xs font-bold">T3 · Dead</span>}
                  {lead.status === 'DEAD' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                      💀 Dead
                    </span>
                  )}
                </div>
                <p className="text-gray-600 text-sm">{lead.propertyCity}, {lead.propertyState} {lead.propertyZip}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  {/* Status — inline editable dropdown */}
                  <select
                    value={lead.status}
                    onChange={async (e) => {
                      const newStatus = e.target.value;
                      try {
                        await leadsAPI.update(leadId, { status: newStatus });
                        setLead((prev: any) => prev ? { ...prev, status: newStatus } : prev);
                      } catch (err) {
                        console.error('Failed to update status', err);
                      }
                    }}
                    className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border-0 cursor-pointer appearance-none focus:ring-2 focus:ring-offset-1 ${
                      lead.status === 'CLOSED_WON'                               ? 'bg-green-100 text-green-700 focus:ring-green-400' :
                      lead.status === 'DEAD' || lead.status === 'CLOSED_LOST'    ? 'bg-gray-100 text-gray-500 focus:ring-gray-400' :
                      lead.status === 'UNDER_CONTRACT'                           ? 'bg-teal-100 text-teal-700 focus:ring-teal-400' :
                      lead.status === 'OFFER_SENT'                               ? 'bg-orange-100 text-orange-700 focus:ring-orange-400' :
                      lead.status === 'NEGOTIATING'                              ? 'bg-amber-100 text-amber-700 focus:ring-amber-400' :
                      lead.status === 'QUALIFYING' || lead.status === 'QUALIFIED'? 'bg-purple-100 text-purple-700 focus:ring-purple-400' :
                      lead.status === 'CLOSING'                                  ? 'bg-emerald-100 text-emerald-700 focus:ring-emerald-400' :
                      lead.status === 'NURTURE'                                  ? 'bg-sky-100 text-sky-700 focus:ring-sky-400' :
                      'bg-blue-50 text-blue-600 focus:ring-blue-400'
                    }`}
                    title="Click to change stage"
                  >
                    <option value="NEW">New Lead</option>
                    <option value="ATTEMPTING_CONTACT">Attempting Contact</option>
                    <option value="QUALIFYING">Qualifying</option>
                    <option value="QUALIFIED">Qualified</option>
                    <option value="OFFER_SENT">Offer Made</option>
                    <option value="NEGOTIATING">Negotiating</option>
                    <option value="UNDER_CONTRACT">Under Contract</option>
                    <option value="CLOSING">Closing</option>
                    <option value="CLOSED_WON">Closed / Won</option>
                    <option value="CLOSED_LOST">Closed / Lost</option>
                    <option value="NURTURE">Nurture</option>
                    <option value="DEAD">Dead</option>
                  </select>
                  {/* Assignee avatar */}
                  {lead.assignedTo && (
                    <div className="flex items-center gap-1.5">
                      <Avatar
                        name={`${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`}
                        avatarUrl={lead.assignedTo.avatarUrl}
                        size="sm"
                      />
                      <span className="text-xs text-gray-500">{lead.assignedTo.firstName} {lead.assignedTo.lastName}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-5">
              {/* Zillow quick-link */}
              <a
                href={`https://www.zillow.com/homes/${encodeURIComponent(
                  [lead.propertyAddress, lead.propertyCity, lead.propertyState, lead.propertyZip]
                    .filter(Boolean).join(', ')
                )}_rb/`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on Zillow"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:border-[#006AFF] hover:bg-blue-50 transition-colors text-xs font-semibold text-[#006AFF]"
              >
                {/* Zillow "Z" wordmark */}
                <svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M16 0C7.163 0 0 7.163 0 16s7.163 16 16 16 16-7.163 16-16S24.837 0 16 0z" fill="#006AFF"/>
                  <path d="M22.4 21.6H9.6v-1.92l8.064-8.064H9.6V9.6h12.8v1.92l-8.064 8.064H22.4v2.016z" fill="white"/>
                </svg>
                Zillow
              </a>
              <Link href={`/leads/${leadId}/edit`} className="btn btn-primary">
                Edit Lead
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Tab Nav */}
      <LeadTabNav leadId={leadId} activeTab={activeTab} />

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Overview Tab */}
        {activeTab === 'overview' && (
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
                    <span className="text-sm text-gray-500">{progress}/4 complete</span>
                    {allCampComplete && (
                      <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 font-medium">
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
                    <p className="text-sm text-gray-600 mt-1">
                      {lead.autoRespond
                        ? 'AI will automatically respond to incoming messages and discover CAMP data.'
                        : 'Manual mode — AI will not send automatic responses for this lead.'}
                    </p>
                    {lead.autoResponseCount > 0 && (
                      <p className="text-xs text-gray-400 mt-1">
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
                        lead.autoRespond ? 'bg-primary-600' : 'bg-gray-300'
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
                    <dt className="text-sm font-medium text-gray-500">Name</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {lead.sellerFirstName} {lead.sellerLastName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Phone</dt>
                    <dd className="mt-1 text-sm text-gray-900 flex items-center gap-2">
                      {formatPhoneDisplay(lead.sellerPhone)}
                      {!lead.doNotContact && (
                        <a
                          href={`tel:${lead.sellerPhone}`}
                          title="Call via SmrtPhone"
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-800 transition-colors"
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
                      <dt className="text-sm font-medium text-gray-500">Email</dt>
                      <dd className="mt-1 text-sm text-gray-900">{lead.sellerEmail}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Property Details */}
              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold">Property Details</h2>
                    {(lead as any).attomId && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
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
                    <dt className="text-sm font-medium text-gray-500">Type</dt>
                    <dd className="mt-1 text-sm text-gray-900">{lead.propertyType || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Bedrooms</dt>
                    <dd className="mt-1 text-sm text-gray-900">{lead.bedrooms ?? 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Bathrooms</dt>
                    <dd className="mt-1 text-sm text-gray-900">{lead.bathrooms ?? 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Sq Ft</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {(lead as any).sqftOverride
                        ? <><span className="font-semibold text-amber-700">{(lead as any).sqftOverride.toLocaleString()}</span><span className="text-xs text-amber-600 ml-1">(override)</span><span className="text-xs text-gray-400 ml-1">ATTOM: {lead.sqft?.toLocaleString() || '—'}</span></>
                        : lead.sqft?.toLocaleString() || 'Unknown'
                      }
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Year Built</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {lead.yearBuilt ?? 'Unknown'}
                      {(lead as any).effectiveYearBuilt && (lead as any).effectiveYearBuilt !== lead.yearBuilt && (
                        <span className="text-xs text-gray-400 ml-1">(reno'd {(lead as any).effectiveYearBuilt})</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Lot Size</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {lead.lotSize
                        ? lead.lotSize < 10 ? `${lead.lotSize.toFixed(2)} acres` : `${(lead.lotSize / 43560).toFixed(2)} acres`
                        : 'Unknown'}
                    </dd>
                  </div>
                  {(lead as any).stories && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Stories</dt>
                      <dd className="mt-1 text-sm text-gray-900">{(lead as any).stories}</dd>
                    </div>
                  )}
                  {(lead as any).basementSqft > 0 && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Basement</dt>
                      <dd className="mt-1 text-sm text-gray-900">{(lead as any).basementSqft.toLocaleString()} sqft</dd>
                    </div>
                  )}
                  {(lead as any).wallType && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Construction</dt>
                      <dd className="mt-1 text-sm text-gray-900">{(lead as any).wallType}</dd>
                    </div>
                  )}
                  {lead.conditionLevel && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Condition</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        {lead.conditionLevel}
                        {(lead as any).propertyCondition && (lead as any).propertyCondition !== lead.conditionLevel && (
                          <span className="text-xs text-indigo-600 ml-1">(ATTOM: {(lead as any).propertyCondition})</span>
                        )}
                      </dd>
                    </div>
                  )}
                  {!(lead.conditionLevel) && (lead as any).propertyCondition && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Condition</dt>
                      <dd className="mt-1 text-sm text-gray-900">{(lead as any).propertyCondition}
                        {(lead as any).propertyQuality && <span className="text-xs text-gray-400 ml-1">· {(lead as any).propertyQuality} quality</span>}
                      </dd>
                    </div>
                  )}
                  {(lead as any).hasPool && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Pool</dt>
                      <dd className="mt-1 text-sm text-gray-900">Yes 🏊</dd>
                    </div>
                  )}
                  {(lead as any).coolingType && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Cooling</dt>
                      <dd className="mt-1 text-sm text-gray-900 capitalize">{(lead as any).coolingType.toLowerCase()}</dd>
                    </div>
                  )}
                  {(lead as any).heatingType && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Heating</dt>
                      <dd className="mt-1 text-sm text-gray-900 capitalize">{(lead as any).heatingType.toLowerCase()}</dd>
                    </div>
                  )}
                  {lead.ownerOccupied != null && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Owner Occupied</dt>
                      <dd className="mt-1 text-sm text-gray-900">{lead.ownerOccupied ? 'Yes' : 'No'}</dd>
                    </div>
                  )}
                  {(lead as any).ownerName && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Recorded Owner</dt>
                      <dd className="mt-1 text-sm text-gray-900 font-medium">{(lead as any).ownerName}</dd>
                    </div>
                  )}
                  {(lead as any).apn && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">APN</dt>
                      <dd className="mt-1 text-sm text-gray-900 font-mono">{(lead as any).apn}</dd>
                    </div>
                  )}
                  {lead.hoaFee && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">HOA Fee</dt>
                      <dd className="mt-1 text-sm text-gray-900">${lead.hoaFee.toLocaleString()}/mo</dd>
                    </div>
                  )}
                  {(lead as any).subdivision && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Subdivision</dt>
                      <dd className="mt-1 text-sm text-gray-900">{(lead as any).subdivision}</dd>
                    </div>
                  )}
                  {/* MLS listing status row removed — automated check was unreliable */}
                </dl>

                {/* ── Tax & Assessment ── */}
                {((lead as any).annualTaxAmount || (lead as any).taxAssessedValue || (lead as any).marketAssessedValue) && (
                  <div className="border-t border-gray-100 pt-4 mb-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                      🏦 Tax & Assessment
                    </h3>
                    <dl className="grid grid-cols-2 gap-4">
                      {(lead as any).annualTaxAmount && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500">Annual Property Tax</dt>
                          <dd className="mt-1 text-sm font-bold text-gray-900">
                            ${Math.round((lead as any).annualTaxAmount).toLocaleString()}/yr
                          </dd>
                          <dd className="text-xs text-gray-400 mt-0.5">
                            ${Math.round((lead as any).annualTaxAmount / 12).toLocaleString()}/mo hold cost
                          </dd>
                        </div>
                      )}
                      {(lead as any).taxAssessedValue && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500">Tax Assessed Value</dt>
                          <dd className="mt-1 text-sm font-semibold text-gray-900">
                            ${Math.round((lead as any).taxAssessedValue).toLocaleString()}
                          </dd>
                          {lead.arv && (
                            <dd className="text-xs text-gray-400 mt-0.5">
                              {(((lead as any).taxAssessedValue / lead.arv) * 100).toFixed(0)}% of ARV
                            </dd>
                          )}
                        </div>
                      )}
                      {(lead as any).marketAssessedValue && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500">Market Assessed Value</dt>
                          <dd className="mt-1 text-sm font-semibold text-gray-900">
                            ${Math.round((lead as any).marketAssessedValue).toLocaleString()}
                          </dd>
                        </div>
                      )}
                      {lead.arv && (lead as any).annualTaxAmount && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500">Tax Rate (est.)</dt>
                          <dd className="mt-1 text-sm text-gray-900">
                            {(((lead as any).annualTaxAmount / lead.arv) * 100).toFixed(2)}% of ARV
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                )}

                {/* ── Sale History ── */}
                {(() => {
                  const saleHistory: any[] = (lead as any).attomSaleHistory || [];
                  const hasAnySale = lead.lastSaleDate || lead.lastSalePrice || saleHistory.length > 0;
                  if (!hasAnySale) return null;
                  return (
                    <div className="border-t border-gray-100 pt-4 mb-4">
                      <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                        🏷️ Sale History
                        {saleHistory.length > 0 && (
                          <span className="text-xs text-gray-400 font-normal">via ATTOM</span>
                        )}
                      </h3>

                      {saleHistory.length > 0 ? (
                        <div className="space-y-2">
                          {saleHistory.map((sale: any, i: number) => {
                            const isMostRecent = i === 0;
                            const saleDate = sale.saleTransDate || sale.saleRecDate;
                            const yearsHeld = saleHistory[i + 1]?.saleTransDate
                              ? Math.round((new Date(saleDate).getTime() - new Date(saleHistory[i + 1].saleTransDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                              : null;
                            return (
                              <div key={i} className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${isMostRecent ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 border border-gray-100'}`}>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className={`text-sm font-bold ${isMostRecent ? 'text-blue-700' : 'text-gray-700'}`}>
                                      ${Math.round(sale.saleAmt).toLocaleString()}
                                    </span>
                                    {sale.saleTransType && (
                                      <span className="text-xs text-gray-400">{sale.saleTransType}</span>
                                    )}
                                    {isMostRecent && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-medium">Most Recent</span>}
                                  </div>
                                  <div className="text-xs text-gray-500 mt-0.5">
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
                              saleHistory[0].saleAmt < lead.arv * 0.6 ? 'bg-green-50 text-green-800 border border-green-200'
                              : saleHistory[0].saleAmt < lead.arv * 0.8 ? 'bg-yellow-50 text-yellow-800 border border-yellow-200'
                              : 'bg-red-50 text-red-800 border border-red-200'
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
                              <dt className="text-sm font-medium text-gray-500">Last Sale Date</dt>
                              <dd className="mt-1 text-sm font-semibold text-gray-900">
                                {new Date(lead.lastSaleDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                              </dd>
                            </div>
                          )}
                          {lead.lastSalePrice && (
                            <div>
                              <dt className="text-sm font-medium text-gray-500">Last Sale Price</dt>
                              <dd className="mt-1 text-sm font-bold text-blue-700">${lead.lastSalePrice.toLocaleString()}</dd>
                            </div>
                          )}
                        </dl>
                      )}
                    </div>
                  );
                })()}

                {/* ── Mortgage note ── */}
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-xs text-gray-400 italic">
                    💡 Mortgage & lien data requires a higher ATTOM tier — verify via county recorder or title search.
                  </p>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Valuation — ARV, Asking Price, MAO */}
              <div className="card">
                <h3 className="text-lg font-bold mb-4">Valuation</h3>

                {/* ARV (primary) */}
                {lead.arv ? (
                  <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-300">
                    <div className="text-xs font-semibold text-green-700 mb-1">🏠 ARV</div>
                    <div className="text-3xl font-bold text-green-700">${lead.arv.toLocaleString()}</div>
                    <div className="flex items-center gap-3 mt-1">
                      {lead.arvConfidence && (
                        <span className="text-xs text-green-600">{lead.arvConfidence}% confidence</span>
                      )}
                      {lead.lastCompsDate && (
                        <span className="text-xs text-gray-400">Updated {format(new Date(lead.lastCompsDate), 'MMM d')}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-400 italic">
                    ARV pending — ATTOM data loading or not available for this address
                  </div>
                )}

                {/* Asking Price */}
                {lead.askingPrice ? (
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs text-gray-500">Asking Price</div>
                      <div className="text-xl font-bold text-gray-800">${lead.askingPrice.toLocaleString()}</div>
                    </div>
                    {lead.arv && (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        lead.askingPrice / lead.arv < 0.7 ? 'bg-green-100 text-green-700' :
                        lead.askingPrice / lead.arv < 0.85 ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {((lead.askingPrice / lead.arv) * 100).toFixed(0)}% of ARV
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mb-3 text-xs text-gray-400 italic">Asking price not provided yet</div>
                )}

                {/* MAO */}
                {lead.arv && (
                  <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200">
                    {(() => {
                      const repairEst = (lead as any).repairCosts || 0;
                      const fee = (lead as any).assignmentFee || 0;
                      const maoPct = ((lead as any).maoPercent ?? 70) / 100;
                      const mao = Math.round(lead.arv * maoPct - fee - repairEst);
                      const maoPctDisplay = Math.round(maoPct * 100);
                      const feeDisplay = fee > 0 ? ` − $${fee.toLocaleString()} fee` : '';
                      return (
                        <>
                          <div className="text-xs font-semibold text-blue-700 mb-1">MAO ({maoPctDisplay}%{feeDisplay})</div>
                          <div className="text-2xl font-bold text-blue-700">${Math.max(mao, 0).toLocaleString()}</div>
                          {repairEst > 0 && (
                            <div className="text-xs text-blue-500 mt-0.5">incl. ~${repairEst.toLocaleString()} repairs</div>
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
                  <div className="mb-3 text-xs px-2 py-1.5 bg-green-50 text-green-700 rounded border border-green-200">
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

              {/* AI Summary Box */}
              <AiSummaryBox
                lead={lead}
                onRefresh={loadLead}
                onViewAnalysis={() => router.push(`/leads/${leadId}/comps-analysis?tab=deal-intel`)}
              />

              {/* Assignment */}
              <div className="card">
                <h3 className="text-lg font-bold mb-3">Assignment</h3>
                {lead.assignedTo ? (
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                      {lead.assignedTo.firstName?.[0]}{lead.assignedTo.lastName?.[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {lead.assignedTo.firstName} {lead.assignedTo.lastName}
                      </div>
                      {lead.assignedStage && (
                        <div className="text-xs text-gray-500 capitalize">{lead.assignedStage}</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 mb-3">Unassigned</p>
                )}
                <div className="space-y-2">
                  <select
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select team member...</option>
                    {teamMembers.map((u: any) => (
                      <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                    ))}
                  </select>
                  <select
                    value={assignStage}
                    onChange={(e) => setAssignStage(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                <p className="text-xs text-gray-400 mb-3">How likely are we to get this under contract?</p>
                <div className="space-y-2">
                  {[
                    { tier: 1, label: 'Tier 1', sub: 'Send a contract now', color: 'border-green-300 bg-green-50 text-green-800', activeColor: 'border-green-500 bg-green-500 text-white' },
                    { tier: 2, label: 'Tier 2', sub: 'Opportunity, keep pursuing', color: 'border-yellow-300 bg-yellow-50 text-yellow-800', activeColor: 'border-yellow-500 bg-yellow-500 text-white' },
                    { tier: 3, label: 'Tier 3', sub: 'Low chance, dead/no go', color: 'border-gray-300 bg-gray-50 text-gray-600', activeColor: 'border-gray-500 bg-gray-500 text-white' },
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
                    <button onClick={() => handleSetTier(null)} className="text-xs text-gray-400 hover:text-gray-600 w-full text-center">
                      Clear tier
                    </button>
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="card">
                <h3 className="text-lg font-bold mb-3">Quick Actions</h3>
                {lead.status === 'DEAD' ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 text-gray-500 text-sm">
                    <span>💀</span>
                    <span className="font-medium">Lead is Dead</span>
                  </div>
                ) : !showDeadForm ? (
                  <button
                    onClick={() => setShowDeadForm(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-red-200 text-red-700 hover:bg-red-50 text-sm font-medium transition-colors"
                  >
                    <span>💀</span>
                    <span>Mark as Dead</span>
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
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
                      <p className="text-xs text-gray-400 mt-1">This will be saved as a note before marking dead.</p>
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
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Disposition Tab */}
        {activeTab === 'disposition' && (
          <div className="space-y-6">
            {/* Pipeline Stage — always-visible status changer */}
            <div className="card flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Pipeline Stage</div>
                <div className="text-sm text-gray-500">Track where this lead is in your process. Stage advances automatically when offers are made or contracts are signed.</div>
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
                  lead.status === 'CLOSED_WON'                               ? 'bg-green-50 text-green-700 border-green-200 focus:ring-green-400' :
                  lead.status === 'DEAD' || lead.status === 'CLOSED_LOST'    ? 'bg-gray-50 text-gray-500 border-gray-200 focus:ring-gray-400' :
                  lead.status === 'UNDER_CONTRACT'                           ? 'bg-teal-50 text-teal-700 border-teal-200 focus:ring-teal-400' :
                  lead.status === 'OFFER_SENT'                               ? 'bg-orange-50 text-orange-700 border-orange-200 focus:ring-orange-400' :
                  lead.status === 'NEGOTIATING'                              ? 'bg-amber-50 text-amber-700 border-amber-200 focus:ring-amber-400' :
                  lead.status === 'QUALIFYING' || lead.status === 'QUALIFIED'? 'bg-purple-50 text-purple-700 border-purple-200 focus:ring-purple-400' :
                  lead.status === 'CLOSING'                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 focus:ring-emerald-400' :
                  lead.status === 'NURTURE'                                  ? 'bg-sky-50 text-sky-700 border-sky-200 focus:ring-sky-400' :
                  'bg-blue-50 text-blue-600 border-blue-200 focus:ring-blue-400'
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
                <option value="CLOSED_WON">Closed / Won</option>
                <option value="CLOSED_LOST">Closed / Lost</option>
                <option value="NURTURE">Nurture</option>
                <option value="DEAD">Dead</option>
              </select>
            </div>
            <DispoTab leadId={leadId} leadAddress={lead.propertyAddress} />
          </div>
        )}

        {/* Communications Tab */}
        {activeTab === 'communications' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">

              {/* AI paused banner — shown when a human has stepped in */}
              {!lead.autoRespond && !lead.doNotContact && lead.status !== 'DEAD' && (
                <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg border border-amber-300 bg-amber-50">
                  <div className="flex items-center gap-2 text-amber-800 text-sm">
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

              {/* Voice Call Section */}
              <div className="card">
                <div className="flex items-center gap-2 mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                  </svg>
                  <h2 className="text-xl font-bold">Voice Call</h2>
                </div>

                {lead.sellerPhone && (
                  <p className="text-sm text-gray-600 mb-3">
                    {formatPhoneDisplay(lead.sellerPhone)}
                  </p>
                )}

                {lead.doNotContact && (
                  <div className="mb-3 px-3 py-2 rounded bg-red-50 border border-red-200 text-sm text-red-700">
                    This lead is on the Do Not Contact list. Calling and texting is disabled.
                  </div>
                )}

                <div className="flex gap-2">
                  {lead.sellerPhone && !lead.doNotContact && (
                    <a
                      href={`tel:${lead.sellerPhone}`}
                      className="btn flex items-center gap-2"
                      style={{ backgroundColor: '#16a34a', color: 'white' }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                      </svg>
                      Start Call
                    </a>
                  )}
                  <button
                    onClick={handleAiCall}
                    disabled={initiatingCall || lead.doNotContact}
                    className="btn flex items-center gap-2"
                    style={{ backgroundColor: 'white', color: '#16a34a', border: '1px solid #16a34a', opacity: initiatingCall || lead.doNotContact ? 0.5 : 1 }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                    </svg>
                    {initiatingCall ? 'Initiating...' : 'Start AI Call'}
                  </button>
                </div>

                {/* Call Log History */}
                {lead.callLogs?.length > 0 ? (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">Call History</h4>
                    <div className="space-y-3">
                      {lead.callLogs.map((log: any) => (
                        <div key={log.id} className="bg-gray-50 rounded-lg p-3 text-sm">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                log.type === 'smrtphone_call' ? 'bg-purple-100 text-purple-800' :
                                log.type === 'smrtagent_call' ? 'bg-indigo-100 text-indigo-800' :
                                'bg-blue-100 text-blue-800'
                              }`}>
                                {log.type === 'smrtphone_call' ? 'SmrtPhone' : log.type === 'smrtagent_call' ? 'smrtAgent' : 'AI Call'}
                              </span>
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                log.status === 'completed' ? 'bg-green-100 text-green-800' :
                                log.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                                log.status === 'ended' ? 'bg-gray-100 text-gray-700' :
                                'bg-yellow-100 text-yellow-800'
                              }`}>
                                {log.status || 'queued'}
                              </span>
                              {log.duration != null && (
                                <span className="text-gray-500 text-xs">
                                  {Math.floor(log.duration / 60)}m {log.duration % 60}s
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-gray-400">
                              {format(new Date(log.createdAt), 'MMM d, h:mm a')}
                            </span>
                          </div>
                          {log.summary && !log.transcript && (
                            <p className="mt-1 text-xs text-gray-500">{log.summary}</p>
                          )}
                          {log.transcript && (
                            <details className="mt-2">
                              <summary className="text-xs text-primary-600 cursor-pointer hover:text-primary-800 font-medium">
                                View transcript &amp; summary
                              </summary>
                              {log.summary && (
                                <p className="mt-1 mb-1 text-xs text-gray-600 font-medium">{log.summary}</p>
                              )}
                              <div className="mt-2 p-2 bg-white border border-gray-200 rounded text-xs text-gray-700 whitespace-pre-wrap max-h-64 overflow-y-auto">
                                {log.transcript}
                              </div>
                            </details>
                          )}
                          {log.recordingUrl && (
                            <a href={log.recordingUrl} target="_blank" rel="noopener noreferrer" className="mt-1 text-xs text-primary-600 hover:text-primary-800 inline-flex items-center gap-1">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                              Recording
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-gray-400">No calls yet</p>
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-gray-200" />

              {/* Text Messages Section */}
              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold">Text Messages</h2>
                  <div className="flex items-center gap-2">
                    {lead.messages?.length === 0 && !lead.doNotContact && (
                      <button
                        onClick={async () => {
                          try {
                            await leadsAPI.sendOutreach(lead.id);
                            loadLead();
                          } catch (e: any) {
                            alert('Failed to send: ' + (e.response?.data?.message || e.message));
                          }
                        }}
                        className="btn btn-sm text-xs border border-green-300 text-green-700 hover:bg-green-50"
                      >
                        📤 Send Initial Text
                      </button>
                    )}
                  <button onClick={handleDraftMessage} className="btn btn-primary btn-sm">
                    Draft Message
                  </button>
                  </div>
                </div>
                <div className="space-y-3">
                  {lead.messages?.map((msg: any) => (
                    <div
                      key={msg.id}
                      className={`p-3 rounded-lg ${
                        msg.direction === 'OUTBOUND'
                          ? 'bg-primary-50 ml-12'
                          : 'bg-gray-100 mr-12'
                      }`}
                    >
                      <div className="text-xs text-gray-500 mb-1">
                        {msg.direction} • {format(new Date(msg.createdAt), 'MMM d, h:mm a')}
                      </div>
                      <div className="text-sm">{msg.body}</div>
                    </div>
                  ))}
                </div>

                {demoMode && (
                  <div className="mt-6 p-4 border-2 border-dashed border-amber-300 rounded-lg bg-amber-50">
                    <h4 className="text-sm font-semibold text-amber-800 mb-2">Simulate Seller Reply (Demo)</h4>
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
                          className="text-xs px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 text-left"
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
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-gray-200" />

              {/* Email Section */}
              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                      <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                    </svg>
                    <h2 className="text-xl font-bold">Emails</h2>
                  </div>
                  {gmailConnected && (
                    <button
                      onClick={() => {
                        setEmailTo(lead.sellerEmail || '');
                        setEmailSubject('');
                        setEmailBody('');
                        setShowComposeEmail(true);
                      }}
                      className="btn btn-primary btn-sm"
                    >
                      Compose Email
                    </button>
                  )}
                </div>

                {!gmailConnected ? (
                  <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700 flex items-center justify-between">
                    <span>Connect Gmail in Settings to send and view emails</span>
                    <Link href="/settings/profile" className="font-medium hover:underline">
                      Connect Gmail
                    </Link>
                  </div>
                ) : (
                  <>
                    {/* Compose form */}
                    {showComposeEmail && (
                      <div className="mb-4 p-4 border border-gray-200 rounded-lg bg-gray-50 space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
                          <input
                            type="email"
                            value={emailTo}
                            onChange={(e) => setEmailTo(e.target.value)}
                            className="input w-full"
                            placeholder="recipient@example.com"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
                          <input
                            type="text"
                            value={emailSubject}
                            onChange={(e) => setEmailSubject(e.target.value)}
                            className="input w-full"
                            placeholder="Subject line"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Message</label>
                          <textarea
                            value={emailBody}
                            onChange={(e) => setEmailBody(e.target.value)}
                            className="input w-full"
                            rows={5}
                            placeholder="Type your message..."
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              if (!emailTo.trim() || !emailSubject.trim() || !emailBody.trim()) return;
                              setSendingEmail(true);
                              try {
                                await gmailAPI.send({
                                  leadId,
                                  to: emailTo,
                                  subject: emailSubject,
                                  bodyText: emailBody,
                                });
                                setShowComposeEmail(false);
                                setEmailTo('');
                                setEmailSubject('');
                                setEmailBody('');
                                // Refresh emails
                                const res = await gmailAPI.emails(leadId);
                                setEmails(res.data || []);
                              } catch (error: any) {
                                console.error('Failed to send email:', error);
                                const msg = error?.response?.data?.message || error?.message || 'Unknown error';
                                alert('Failed to send email: ' + msg);
                              } finally {
                                setSendingEmail(false);
                              }
                            }}
                            disabled={sendingEmail || !emailTo.trim() || !emailSubject.trim() || !emailBody.trim()}
                            className="btn btn-primary btn-sm"
                          >
                            {sendingEmail ? 'Sending...' : 'Send Email'}
                          </button>
                          <button
                            onClick={() => setShowComposeEmail(false)}
                            className="btn btn-secondary btn-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Email thread */}
                    {emails.length > 0 ? (
                      <div className="space-y-3">
                        {emails.map((email: any) => (
                          <div
                            key={email.id}
                            className={`p-3 rounded-lg cursor-pointer transition-colors ${
                              email.direction === 'outbound'
                                ? 'bg-primary-50 ml-8 hover:bg-primary-100'
                                : 'bg-gray-100 mr-8 hover:bg-gray-200'
                            }`}
                            onClick={() => setExpandedEmailId(expandedEmailId === email.id ? null : email.id)}
                          >
                            <div className="flex justify-between items-start mb-1">
                              <div className="text-xs text-gray-500">
                                <span className={`font-medium ${email.direction === 'outbound' ? 'text-primary-700' : 'text-gray-700'}`}>
                                  {email.direction === 'outbound' ? 'Sent' : 'Received'}
                                </span>
                                {' · '}
                                {email.direction === 'outbound' ? `To: ${email.toAddress}` : `From: ${email.fromAddress}`}
                              </div>
                              <span className="text-xs text-gray-400">
                                {format(new Date(email.sentAt), 'MMM d, h:mm a')}
                              </span>
                            </div>
                            <div className="text-sm font-medium text-gray-800 mb-1">{email.subject}</div>
                            {expandedEmailId === email.id ? (
                              <div className="text-sm text-gray-700 whitespace-pre-wrap mt-2 pt-2 border-t border-gray-200">
                                {email.bodyText}
                              </div>
                            ) : (
                              <div className="text-sm text-gray-500 truncate">
                                {email.bodyText?.substring(0, 120)}
                                {email.bodyText?.length > 120 ? '...' : ''}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 text-center py-4">
                        No emails for this lead yet. Click "Compose Email" to send one, or sync your inbox in Settings.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            {messageDrafts && (
              <div className="card">
                <h3 className="text-lg font-bold mb-4">Message Drafts</h3>
                <div className="space-y-3">
                  <button
                    onClick={() => setSelectedDraft(messageDrafts.direct)}
                    className={`w-full text-left p-3 rounded border ${
                      selectedDraft === messageDrafts.direct
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="text-xs font-medium text-gray-500 mb-1">Direct</div>
                    <div className="text-sm">{messageDrafts.direct}</div>
                  </button>
                  <button
                    onClick={() => setSelectedDraft(messageDrafts.friendly)}
                    className={`w-full text-left p-3 rounded border ${
                      selectedDraft === messageDrafts.friendly
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="text-xs font-medium text-gray-500 mb-1">Friendly</div>
                    <div className="text-sm">{messageDrafts.friendly}</div>
                  </button>
                  <button
                    onClick={() => setSelectedDraft(messageDrafts.professional)}
                    className={`w-full text-left p-3 rounded border ${
                      selectedDraft === messageDrafts.professional
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="text-xs font-medium text-gray-500 mb-1">Professional</div>
                    <div className="text-sm">{messageDrafts.professional}</div>
                  </button>
                </div>
                <textarea
                  value={selectedDraft}
                  onChange={(e) => setSelectedDraft(e.target.value)}
                  className="input mt-4"
                  rows={4}
                  placeholder="Edit message..."
                />
                <div className="flex gap-2 mt-4">
                  <button onClick={handleSendMessage} className="btn btn-primary flex-1">
                    Send
                  </button>
                  <button
                    onClick={() => {
                      setMessageDrafts(null);
                      setSelectedDraft('');
                    }}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Notes Section (merged into Communications) */}
            <div className="lg:col-span-2 space-y-6 mt-6 border-t border-gray-200 pt-6">
              {/* Add Note Form */}
              <div className="card">
                <h2 className="text-xl font-bold mb-4">Notes</h2>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add a conversation note, follow-up detail, or anything relevant about this lead..."
                  className="input w-full mb-3"
                  rows={3}
                />
                <button
                  onClick={handleAddNote}
                  disabled={addingNote || !noteText.trim() || !currentUser}
                  className="btn btn-primary btn-sm"
                >
                  {addingNote ? 'Saving...' : 'Save Note'}
                </button>
                {!currentUser && (
                  <p className="text-xs text-gray-400 mt-2">Loading user info...</p>
                )}
              </div>

              {/* Notes List */}
              {lead.notes?.length > 0 ? (
                <div className="card">
                  <h3 className="text-lg font-bold mb-4">Notes ({lead.notes.length})</h3>
                  <div className="space-y-4">
                    {lead.notes.map((note: any) => (
                      <div key={note.id} className={`p-4 rounded-lg border ${note.content?.startsWith('[Dead]') ? 'border-red-200 bg-red-50' : 'border-blue-100 bg-blue-50'}`}>
                        <div className="flex justify-between items-start mb-2">
                          <span className={`text-xs font-semibold ${note.content?.startsWith('[Dead]') ? 'text-red-700' : 'text-blue-700'}`}>
                            {note.content?.startsWith('[Dead]') ? '💀 ' : '📝 '}
                            {note.user ? `${note.user.firstName} ${note.user.lastName}` : '🤖 AI'}
                          </span>
                          <span className="text-xs text-gray-400">
                            {format(new Date(note.createdAt), 'MMM d, yyyy h:mm a')}
                          </span>
                        </div>
                        <div className="text-sm text-gray-800 whitespace-pre-wrap">
                          {note.content?.startsWith('[Dead] ') ? note.content.slice(7) : note.content}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="card text-center py-8 text-gray-400">
                  <div className="text-3xl mb-2">📝</div>
                  <p className="text-sm">No notes yet. Add your first note above.</p>
                </div>
              )}
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
                    <div key={note.id} className={`p-3 rounded-lg border ${note.content?.startsWith('[Dead]') ? 'border-red-200 bg-red-50' : 'border-blue-100 bg-blue-50'}`}>
                      <div className="flex justify-between items-start mb-1">
                        <span className={`text-xs font-medium ${note.content?.startsWith('[Dead]') ? 'text-red-700' : 'text-blue-700'}`}>
                          {note.content?.startsWith('[Dead]') ? '💀 ' : '📝 '}
                          {note.user ? `${note.user.firstName} ${note.user.lastName}` : '🤖 AI'}
                        </span>
                        <span className="text-xs text-gray-400">
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
                <p className="text-sm text-gray-400">
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
                    <div key={enrollment.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-900 truncate">
                          {enrollment.campaign?.name || 'Campaign'}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          Step {enrollment.currentStepOrder} ·{' '}
                          <span className={`font-medium ${
                            enrollment.status === 'ACTIVE' ? 'text-green-600' :
                            enrollment.status === 'PAUSED' ? 'text-yellow-600' :
                            enrollment.status === 'REPLIED' ? 'text-purple-600' :
                            'text-gray-500'
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
                            className="text-xs px-2 py-1 text-yellow-700 bg-yellow-50 hover:bg-yellow-100 rounded transition-colors"
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
                            className="text-xs px-2 py-1 text-green-700 bg-green-50 hover:bg-green-100 rounded transition-colors"
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
                          className="text-xs px-2 py-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 mb-4">Not enrolled in any campaigns.</p>
              )}

              {/* Enroll in campaign */}
              <div className="flex gap-2">
                <select
                  value={selectedCampaignId}
                  onChange={(e) => setSelectedCampaignId(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
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
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {enrollingInCampaign ? '...' : 'Enroll'}
                </button>
              </div>
            </div>

            {/* Activity Log */}
            <div className="card">
              <h2 className="text-xl font-bold mb-4">Activity Log</h2>
              <div className="space-y-3">
                {lead.activities?.map((activity: any) => (
                  <div key={activity.id} className="p-3 bg-gray-50 rounded">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-sm font-medium">{activity.description}</div>
                        {activity.user && (
                          <div className="text-xs text-gray-500">
                            by {activity.user.firstName} {activity.user.lastName}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {format(new Date(activity.createdAt), 'MMM d, h:mm a')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
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
          ? 'border-green-200 bg-green-50'
          : isNext
          ? 'border-primary-300 bg-primary-50'
          : 'border-gray-200 bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold uppercase text-gray-500">{label}</span>
        {complete ? (
          <span className="text-green-600 text-xs font-bold">Done</span>
        ) : isNext ? (
          <span className="text-primary-600 text-xs font-bold">Next</span>
        ) : (
          <span className="text-gray-400 text-xs">Pending</span>
        )}
      </div>
      <div className="text-xs text-gray-500">{subtitle}</div>
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
        <span className="text-gray-700">{label}</span>
        <span className="font-medium">{score}/{max}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-primary-600 h-2 rounded-full"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

// ─── DonutStat ────────────────────────────────────────────────────────────────
function DonutStat({
  value, max, label, color, size = 56,
}: { value: number; max: number; label: string; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(value / max, 1) * circ;
  const cx = size / 2;
  const textStyle = {
    transform: `rotate(90deg)`,
    transformOrigin: `${cx}px ${cx}px`,
    fontSize: size < 52 ? 11 : 13,
    fontWeight: 700,
    fill: color,
  } as React.CSSProperties;
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#e5e7eb" strokeWidth={6} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
        <text x={cx} y={cx} textAnchor="middle" dominantBaseline="central" style={textStyle}>
          {value}
        </text>
      </svg>
      <div className="text-xs text-gray-500 text-center leading-tight mt-0.5">{label}</div>
    </div>
  );
}
