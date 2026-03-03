'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { leadsAPI, messagesAPI, compsAPI, settingsAPI, photosAPI, pipelineAPI, callsAPI } from '@/lib/api';
import PropertyPhoto from '@/components/PropertyPhoto';
import PhotoGallery from '@/components/PhotoGallery';
import AppNav from '@/components/AppNav';
import AiSummaryBox from '@/components/AiSummaryBox';
import { format } from 'date-fns';

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
  const leadId = params.id as string;

  const [lead, setLead] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('overview');

  const handleTabClick = (tab: string) => {
    if (tab === 'comps') {
      router.push(`/leads/${leadId}/comps-analysis`);
      return;
    }
    setActiveTab(tab);
  };
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

  useEffect(() => {
    loadLead();
    settingsAPI.getDrip().then((res) => setDemoMode(res.data.demoMode ?? false)).catch(() => {});
  }, [leadId]);

  const loadLead = async () => {
    try {
      const response = await leadsAPI.get(leadId);
      setLead(response.data);
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
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
                <h1 className="text-xl font-bold text-gray-900">{lead.propertyAddress}</h1>
                <p className="text-gray-600 text-sm">{lead.propertyCity}, {lead.propertyState} {lead.propertyZip}</p>
              </div>
            </div>
            <div className="flex items-center gap-5">
              {/* Lead score donut */}
              <DonutStat
                value={lead.totalScore}
                max={12}
                label={({ STRIKE_ZONE: 'Strike Zone', HOT: 'Hot', WORKABLE: 'Workable', DEAD_COLD: 'Cold' } as Record<string,string>)[lead.scoreBand] ?? lead.scoreBand.replace('_', ' ')}
                color={lead.scoreBand === 'HOT' ? '#ef4444' : lead.scoreBand === 'WARM' ? '#f97316' : '#6b7280'}
                size={60}
              />
              {/* AI analysis score donut */}
              {aiAnalysis?.dealRating != null ? (
                <DonutStat
                  value={aiAnalysis.dealRating}
                  max={10}
                  label="AI Score"
                  color={aiAnalysis.dealRating >= 7 ? '#10b981' : aiAnalysis.dealRating >= 4 ? '#f59e0b' : '#ef4444'}
                  size={60}
                />
              ) : null}
              <button
                onClick={handleAiCall}
                disabled={initiatingCall || lead.doNotContact}
                className="btn btn-sm flex items-center gap-1.5"
                style={{ backgroundColor: '#16a34a', color: 'white', opacity: initiatingCall || lead.doNotContact ? 0.5 : 1 }}
                title={lead.doNotContact ? 'Lead is on Do Not Contact list' : 'Start AI phone call'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                </svg>
                {initiatingCall ? 'Calling...' : 'AI Call'}
              </button>
              <Link href={`/leads/${leadId}/edit`} className="btn btn-primary">
                Edit Lead
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Tab Nav */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-6 text-sm">
            {['overview', 'messages', 'comps', 'analysis', 'activity'].map((tab) => (
              <button
                key={tab}
                onClick={() => handleTabClick(tab)}
                className={`py-3 px-1 border-b-2 font-medium whitespace-nowrap ${
                  activeTab === tab
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

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
                    <dd className="mt-1 text-sm text-gray-900">{lead.sellerPhone}</dd>
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
                  <h2 className="text-xl font-bold">Property Details</h2>
                  {(lead.bedrooms || lead.sqft) && (
                    <span className="text-xs text-green-600 font-medium">
                      Auto-populated from public records
                    </span>
                  )}
                </div>
                {/* Property specs */}
                <dl className="grid grid-cols-2 gap-4 mb-5">
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
                    <dt className="text-sm font-medium text-gray-500">Sqft</dt>
                    <dd className="mt-1 text-sm text-gray-900">{lead.sqft?.toLocaleString() || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Year Built</dt>
                    <dd className="mt-1 text-sm text-gray-900">{lead.yearBuilt ?? 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Lot Size</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {lead.lotSize
                        ? lead.lotSize < 10
                          ? `${lead.lotSize.toFixed(2)} acres`
                          : `${(lead.lotSize / 43560).toFixed(2)} acres`
                        : 'Unknown'}
                    </dd>
                  </div>
                  {lead.conditionLevel && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Condition</dt>
                      <dd className="mt-1 text-sm text-gray-900">{lead.conditionLevel}</dd>
                    </div>
                  )}
                  {lead.hoaFee && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">HOA Fee</dt>
                      <dd className="mt-1 text-sm text-gray-900">${lead.hoaFee.toLocaleString()}/mo</dd>
                    </div>
                  )}
                  {lead.ownerOccupied != null && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Owner Occupied</dt>
                      <dd className="mt-1 text-sm text-gray-900">{lead.ownerOccupied ? 'Yes' : 'No'}</dd>
                    </div>
                  )}
                </dl>

                {/* Sale & Assessment History */}
                {(lead.lastSaleDate || lead.lastSalePrice || lead.taxAssessedValue) && (
                  <div className="border-t border-gray-100 pt-4 mb-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                      🏷️ Sale & Assessment History
                    </h3>
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
                          <dd className="mt-1 text-sm font-bold text-blue-700">
                            ${lead.lastSalePrice.toLocaleString()}
                          </dd>
                          {lead.arv && (
                            <dd className="text-xs text-gray-400 mt-0.5">
                              {((lead.lastSalePrice / lead.arv) * 100).toFixed(0)}% of ARV
                            </dd>
                          )}
                        </div>
                      )}
                      {lead.taxAssessedValue && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500">Tax Assessed Value</dt>
                          <dd className="mt-1 text-sm font-semibold text-gray-900">
                            ${lead.taxAssessedValue.toLocaleString()}
                          </dd>
                          {lead.arv && (
                            <dd className="text-xs text-gray-400 mt-0.5">
                              {((lead.taxAssessedValue / lead.arv) * 100).toFixed(0)}% of ARV
                            </dd>
                          )}
                        </div>
                      )}
                      {lead.lastSalePrice && lead.askingPrice && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500">vs. Asking Price</dt>
                          <dd className={`mt-1 text-sm font-bold ${lead.askingPrice >= lead.lastSalePrice ? 'text-green-600' : 'text-red-600'}`}>
                            {lead.askingPrice >= lead.lastSalePrice ? '+' : ''}${(lead.askingPrice - lead.lastSalePrice).toLocaleString()}
                          </dd>
                          <dd className="text-xs text-gray-400 mt-0.5">
                            {lead.askingPrice >= lead.lastSalePrice ? 'above' : 'below'} last sale
                          </dd>
                        </div>
                      )}
                    </dl>

                    {/* Seller equity callout */}
                    {lead.lastSalePrice && lead.arv && (
                      <div className={`mt-3 rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${
                        lead.lastSalePrice < lead.arv * 0.6
                          ? 'bg-green-50 text-green-800 border border-green-200'
                          : lead.lastSalePrice < lead.arv * 0.8
                          ? 'bg-yellow-50 text-yellow-800 border border-yellow-200'
                          : 'bg-red-50 text-red-800 border border-red-200'
                      }`}>
                        <span className="text-base">
                          {lead.lastSalePrice < lead.arv * 0.6 ? '💚' : lead.lastSalePrice < lead.arv * 0.8 ? '⚠️' : '🔴'}
                        </span>
                        <span>
                          {lead.lastSalePrice < lead.arv * 0.6
                            ? `Strong equity position — paid $${lead.lastSalePrice.toLocaleString()}, ARV $${lead.arv.toLocaleString()}`
                            : lead.lastSalePrice < lead.arv * 0.8
                            ? `Moderate equity — paid $${lead.lastSalePrice.toLocaleString()}, limited spread`
                            : `Thin equity — paid $${lead.lastSalePrice.toLocaleString()}, close to ARV`}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Mortgage note */}
                <div className="border-t border-gray-100 pt-4 mb-1">
                  <p className="text-xs text-gray-400 italic">
                    💡 Mortgage & lien data not available from public records API — verify via county recorder or title search.
                  </p>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await leadsAPI.refreshPropertyDetails(leadId);
                      loadLead();
                    } catch (error) {
                      console.error('Failed to refresh property details:', error);
                      alert('Failed to refresh property details');
                    }
                  }}
                  className="btn btn-secondary btn-sm mt-4"
                >
                  Refresh Property Details
                </button>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Score Breakdown */}
              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold">Score Breakdown</h3>
                  <button onClick={handleRescore} className="btn btn-sm btn-secondary">
                    Rescore
                  </button>
                </div>
                <div className="space-y-3">
                  <ScoreBar label="Challenge" score={lead.challengeScore} max={3} />
                  <ScoreBar label="Authority" score={lead.authorityScore} max={3} />
                  <ScoreBar label="Money" score={lead.moneyScore} max={3} />
                  <ScoreBar label="Priority" score={lead.priorityScore} max={3} />
                </div>
                {lead.scoringRationale && (
                  <p className="mt-4 text-sm text-gray-600 italic">
                    {lead.scoringRationale}
                  </p>
                )}
              </div>

              {/* ARV/Price */}
              <div className="card">
                <h3 className="text-lg font-bold mb-4">Valuation</h3>
                {lead.arv && (
                  <div className="mb-3">
                    <div className="text-sm text-gray-500">ARV</div>
                    <div className="text-2xl font-bold text-green-600">
                      ${lead.arv.toLocaleString()}
                    </div>
                    {lead.arvConfidence && (
                      <div className="text-xs text-gray-500">
                        {lead.arvConfidence}% confidence
                      </div>
                    )}
                    {lead.lastCompsDate && (
                      <div className="text-xs text-gray-400">
                        Updated {format(new Date(lead.lastCompsDate), 'MMM d, h:mm a')}
                      </div>
                    )}
                  </div>
                )}
                {lead.askingPrice && (
                  <div className="mb-3">
                    <div className="text-sm text-gray-500">Asking Price</div>
                    <div className="text-xl font-bold">
                      ${lead.askingPrice.toLocaleString()}
                    </div>
                    {lead.arv && (
                      <div className="text-xs text-gray-500">
                        {((lead.askingPrice / lead.arv) * 100).toFixed(0)}% of ARV
                      </div>
                    )}
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
                  <button
                    onClick={() => handleFetchComps(true)}
                    disabled={fetchingComps}
                    className="text-xs text-primary-600 hover:underline w-full text-center"
                  >
                    Force Refresh
                  </button>
                )}
              </div>

              {/* AI Summary Box */}
              <AiSummaryBox
                lead={lead}
                onRefresh={loadLead}
                onViewAnalysis={() => setActiveTab('analysis')}
              />
            </div>
          </div>
        )}

        {/* Messages Tab */}
        {activeTab === 'messages' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="card">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold">Messages</h2>
                  <button onClick={handleDraftMessage} className="btn btn-primary btn-sm">
                    Draft Message
                  </button>
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
          </div>
        )}

        {/* Comps Tab */}
        {activeTab === 'comps' && (
          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">
                Comparables
                {lead.comps?.length > 0 && (
                  <span className="text-sm font-normal text-gray-500 ml-2">({lead.comps.length})</span>
                )}
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => handleFetchComps(true)}
                  disabled={fetchingComps}
                  className="btn btn-secondary btn-sm"
                >
                  {fetchingComps ? 'Fetching...' : 'Refresh Comps'}
                </button>
                <Link href={`/leads/${leadId}/comps-analysis?tab=map`} className="btn btn-secondary btn-sm">
                  Map View
                </Link>
                <Link href={`/leads/${leadId}/comps-analysis`} className="btn btn-primary btn-sm">
                  Full Analysis
                </Link>
              </div>
            </div>

            {fetchingComps && (
              <div className="text-center py-4 text-primary-600 text-sm font-medium">
                Fetching live comps from RentCast...
              </div>
            )}

            {lead.comps?.length > 0 ? (
              <>
                <div className="space-y-3">
                  {lead.comps.map((comp: any) => (
                    <div key={comp.id} className={`p-4 rounded-lg ${comp.selected ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'}`}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{comp.address}</span>
                            {comp.similarityScore != null && (
                              <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${
                                comp.similarityScore >= 90 ? 'bg-green-100 text-green-700' :
                                comp.similarityScore >= 80 ? 'bg-yellow-100 text-yellow-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                {comp.similarityScore}% match
                              </span>
                            )}
                            {comp.source && comp.source !== 'manual' && (
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                comp.source === 'rentcast' ? 'bg-blue-100 text-blue-700' :
                                comp.source === 'chatarv' ? 'bg-purple-100 text-purple-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {comp.source === 'rentcast' ? 'RentCast' :
                                 comp.source === 'chatarv' ? 'ChatARV' : comp.source}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-600">
                            {comp.bedrooms || '?'}bd {comp.bathrooms || '?'}ba &bull; {comp.sqft?.toLocaleString() || '?'} sqft
                            {comp.yearBuilt ? ` &bull; Built ${comp.yearBuilt}` : ''}
                            {comp.lotSize ? ` &bull; ${comp.lotSize} acres` : ''}
                          </div>
                          <div className="text-sm text-gray-600">
                            {comp.distance.toFixed(2)} mi &bull; Sold {format(new Date(comp.soldDate), 'MMM yyyy')}
                            {comp.correlation ? ` &bull; ${(comp.correlation * 100).toFixed(0)}% match` : ''}
                          </div>
                          {(comp.hasPool || comp.hasGarage) && (
                            <div className="flex gap-1.5 mt-1">
                              {comp.hasPool && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700">Pool</span>
                              )}
                              {comp.hasGarage && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">Garage</span>
                              )}
                            </div>
                          )}
                          {comp.notes && (
                            <div className="text-xs text-gray-500 italic mt-1">{comp.notes}</div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold">${comp.soldPrice.toLocaleString()}</div>
                          {comp.sqft && (
                            <div className="text-xs text-gray-500">
                              ${Math.round(comp.soldPrice / comp.sqft)}/sqft
                            </div>
                          )}
                          {comp.daysOnMarket != null && (
                            <div className="text-xs text-gray-500">{comp.daysOnMarket} DOM</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 text-xs text-gray-400 text-center">
                  Powered by RentCast
                  {lead.lastCompsDate && (
                    <span> &bull; Last updated {format(new Date(lead.lastCompsDate), 'MMM d, yyyy h:mm a')}</span>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-gray-500">
                {fetchingComps ? null : (
                  <>
                    No comps fetched yet
                    <br />
                    <div className="flex justify-center gap-3 mt-4">
                      <button
                        onClick={() => handleFetchComps(false)}
                        disabled={fetchingComps}
                        className="btn btn-primary btn-sm"
                      >
                        Fetch Live Comps (RentCast)
                      </button>
                      <Link href={`/leads/${leadId}/comps-analysis`} className="btn btn-secondary btn-sm">
                        Run Full Analysis
                      </Link>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Analysis Tab */}
        {activeTab === 'analysis' && (
          <AnalysisTab
            leadId={leadId}
            lead={lead}
            aiAnalysis={aiAnalysis}
            setAiAnalysis={setAiAnalysis}
            analysisLoading={analysisLoading}
            setAnalysisLoading={setAnalysisLoading}
            onLeadRefresh={loadLead}
          />
        )}

        {/* Activity Tab */}
        {activeTab === 'activity' && (
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

function AnalysisTab({
  leadId,
  lead,
  aiAnalysis,
  setAiAnalysis,
  analysisLoading,
  setAnalysisLoading,
  onLeadRefresh,
}: {
  leadId: string;
  lead: any;
  aiAnalysis: any;
  setAiAnalysis: (a: any) => void;
  analysisLoading: boolean;
  setAnalysisLoading: (l: boolean) => void;
  onLeadRefresh: () => void;
}) {
  // Load cached analysis from lead data on first render
  useEffect(() => {
    if (!aiAnalysis && lead?.aiAnalysis) {
      try {
        setAiAnalysis(JSON.parse(lead.aiAnalysis));
      } catch {
        // ignore parse errors
      }
    }
  }, [lead?.aiAnalysis]);

  const handleGenerate = async (forceRefresh = false) => {
    setAnalysisLoading(true);
    try {
      const res = forceRefresh
        ? await pipelineAPI.refreshLeadAnalysis(leadId)
        : await pipelineAPI.getLeadAnalysis(leadId);
      setAiAnalysis(res.data);
      onLeadRefresh();
    } catch (error) {
      console.error('Failed to generate analysis:', error);
      alert('Failed to generate AI analysis');
    } finally {
      setAnalysisLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Trigger Button */}
      {!aiAnalysis && !analysisLoading && (
        <div className="card text-center py-12">
          <div className="text-4xl mb-4">🤖</div>
          <h3 className="text-xl font-bold mb-2">AI Lead Analysis</h3>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">
            Get an AI-powered assessment of this deal including data gaps, deal quality rating, recommended actions, and red flags.
          </p>
          <button
            onClick={() => handleGenerate(false)}
            className="btn btn-primary"
          >
            Run AI Analysis
          </button>
        </div>
      )}

      {/* Loading State */}
      {analysisLoading && (
        <div className="card text-center py-12">
          <div className="text-4xl mb-4 animate-pulse">🤖</div>
          <h3 className="text-lg font-bold mb-2">Analyzing Lead...</h3>
          <p className="text-gray-500 text-sm">Claude is reviewing property data, CAMP scores, comps, and activity history...</p>
        </div>
      )}

      {/* Analysis Results */}
      {aiAnalysis && !analysisLoading && (
        <>
          {/* Top Row: Deal Rating + Worthiness */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="card text-center">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Deal Rating</h3>
              <div className={`text-5xl font-bold mb-1 ${
                aiAnalysis.dealRating >= 7 ? 'text-green-600' :
                aiAnalysis.dealRating >= 4 ? 'text-yellow-600' :
                'text-red-600'
              }`}>
                {aiAnalysis.dealRating}/10
              </div>
              <p className="text-xs text-gray-500 mt-2">{aiAnalysis.dealRatingExplanation}</p>
            </div>

            <div className="card text-center">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Deal Worthiness</h3>
              <div className={`text-3xl font-bold mb-1 ${
                aiAnalysis.dealWorthiness === 'YES' ? 'text-green-600' :
                aiAnalysis.dealWorthiness === 'NEED_MORE_DATA' ? 'text-yellow-600' :
                'text-red-600'
              }`}>
                {aiAnalysis.dealWorthiness === 'NEED_MORE_DATA' ? 'NEED DATA' : aiAnalysis.dealWorthiness}
              </div>
              <p className="text-xs text-gray-500 mt-2">{aiAnalysis.worthinessReason}</p>
            </div>

            <div className="card text-center">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Confidence</h3>
              <div className="text-5xl font-bold text-primary-600 mb-1">
                {aiAnalysis.confidenceLevel}%
              </div>
              <div className="mt-2">
                <span className="text-xs text-gray-500">Profit Potential: </span>
                <span className={`text-xs font-bold ${
                  aiAnalysis.estimatedProfitPotential === 'HIGH' ? 'text-green-600' :
                  aiAnalysis.estimatedProfitPotential === 'MEDIUM' ? 'text-yellow-600' :
                  aiAnalysis.estimatedProfitPotential === 'LOW' ? 'text-red-600' :
                  'text-gray-500'
                }`}>
                  {aiAnalysis.estimatedProfitPotential}
                </span>
              </div>
              {aiAnalysis.estimatedProfit !== null && aiAnalysis.estimatedProfit !== undefined && (
                <div className={`text-sm font-bold mt-1 ${aiAnalysis.estimatedProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {aiAnalysis.estimatedProfit >= 0 ? '+' : ''}${aiAnalysis.estimatedProfit.toLocaleString()}
                </div>
              )}
            </div>
          </div>

          {/* Middle Row: Data Gaps + Next Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-lg font-bold mb-3">
                Data Gaps
                {aiAnalysis.missingDataCount > 0 && (
                  <span className="text-sm font-normal text-red-500 ml-2">
                    ({aiAnalysis.missingDataCount} missing)
                  </span>
                )}
              </h3>
              {aiAnalysis.dataGaps?.length > 0 ? (
                <ol className="space-y-2">
                  {aiAnalysis.dataGaps.map((gap: string, i: number) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-red-100 text-red-600 text-xs font-bold flex items-center justify-center mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-sm text-gray-700">{gap}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-green-600">All key data collected!</p>
              )}
            </div>

            <div className="card">
              <h3 className="text-lg font-bold mb-3">Recommended Actions</h3>
              <ol className="space-y-2">
                {aiAnalysis.nextActions?.map((action: string, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-100 text-primary-600 text-xs font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-sm text-gray-700">{action}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Red Flags */}
          {aiAnalysis.redFlags?.length > 0 && (
            <div className="card border-2 border-red-200 bg-red-50">
              <h3 className="text-lg font-bold text-red-800 mb-3">Red Flags</h3>
              <ul className="space-y-2">
                {aiAnalysis.redFlags.map((flag: string, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-red-500 mt-0.5">&#x26A0;</span>
                    <span className="text-sm text-red-700">{flag}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Refresh Button */}
          <div className="text-center">
            <button
              onClick={() => handleGenerate(true)}
              className="btn btn-secondary btn-sm"
            >
              Refresh Analysis
            </button>
          </div>
        </>
      )}
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
