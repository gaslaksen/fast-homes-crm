'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { leadsAPI, messagesAPI, compsAPI } from '@/lib/api';
import { format } from 'date-fns';

export default function LeadDetailPage() {
  const params = useParams();
  const leadId = params.id as string;
  
  const [lead, setLead] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [messageDrafts, setMessageDrafts] = useState<any>(null);
  const [selectedDraft, setSelectedDraft] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLead();
  }, [leadId]);

  const loadLead = async () => {
    try {
      const response = await leadsAPI.get(leadId);
      setLead(response.data);
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
      loadLead(); // Reload to get new message
      alert('Message sent!');
    } catch (error) {
      console.error('Failed to send message:', error);
      alert('Failed to send message');
    }
  };

  const handleFetchComps = async () => {
    try {
      await compsAPI.fetch(leadId);
      loadLead();
      alert('Comps fetched!');
    } catch (error) {
      console.error('Failed to fetch comps:', error);
      alert('Failed to fetch comps');
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

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!lead) {
    return <div className="min-h-screen flex items-center justify-center">Lead not found</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-3 mb-2 text-sm">
                <Link href="/dashboard" className="text-primary-600 hover:text-primary-700">
                  Dashboard
                </Link>
                <span className="text-gray-400">/</span>
                <Link href="/leads" className="text-primary-600 hover:text-primary-700">
                  Leads
                </Link>
                <span className="text-gray-400">/</span>
                <span className="text-gray-500">Detail</span>
              </div>
              <h1 className="text-2xl font-bold">{lead.propertyAddress}</h1>
              <p className="text-gray-600">{lead.propertyCity}, {lead.propertyState}</p>
            </div>
            <div className="flex items-center gap-4">
              <Link href={`/leads/${leadId}/edit`} className="btn btn-primary">
                Edit Lead
              </Link>
              <div className="text-right">
                <div className="text-3xl font-bold text-primary-600 mb-1">
                  {lead.totalScore}/12
                </div>
                <span className={`badge badge-${lead.scoreBand.toLowerCase().replace('_', '-')}`}>
                  {lead.scoreBand.replace('_', ' ')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex space-x-8">
            {['overview', 'messages', 'comps', 'activity'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
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
                <h2 className="text-xl font-bold mb-4">Property Details</h2>
                <dl className="grid grid-cols-2 gap-4">
                  {lead.propertyType && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Type</dt>
                      <dd className="mt-1 text-sm text-gray-900">{lead.propertyType}</dd>
                    </div>
                  )}
                  {lead.bedrooms && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Bedrooms</dt>
                      <dd className="mt-1 text-sm text-gray-900">{lead.bedrooms}</dd>
                    </div>
                  )}
                  {lead.bathrooms && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Bathrooms</dt>
                      <dd className="mt-1 text-sm text-gray-900">{lead.bathrooms}</dd>
                    </div>
                  )}
                  {lead.sqft && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Sqft</dt>
                      <dd className="mt-1 text-sm text-gray-900">{lead.sqft.toLocaleString()}</dd>
                    </div>
                  )}
                  {lead.conditionLevel && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Condition</dt>
                      <dd className="mt-1 text-sm text-gray-900">{lead.conditionLevel}</dd>
                    </div>
                  )}
                </dl>
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
                <button onClick={handleFetchComps} className="btn btn-primary btn-sm w-full">
                  Fetch Comps
                </button>
              </div>
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
            <h2 className="text-xl font-bold mb-4">Comparables</h2>
            {lead.comps?.length > 0 ? (
              <div className="space-y-3">
                {lead.comps.map((comp: any) => (
                  <div key={comp.id} className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">{comp.address}</div>
                        <div className="text-sm text-gray-600">
                          {comp.bedrooms}bd {comp.bathrooms}ba • {comp.sqft?.toLocaleString()} sqft
                        </div>
                        <div className="text-sm text-gray-600">
                          {comp.distance.toFixed(1)} mi • Sold {format(new Date(comp.soldDate), 'MMM yyyy')}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold">${comp.soldPrice.toLocaleString()}</div>
                        {comp.daysOnMarket && (
                          <div className="text-xs text-gray-500">{comp.daysOnMarket} DOM</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No comps fetched yet
                <br />
                <button onClick={handleFetchComps} className="btn btn-primary btn-sm mt-4">
                  Fetch Comps Now
                </button>
              </div>
            )}
          </div>
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
