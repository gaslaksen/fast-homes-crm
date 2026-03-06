'use client';

import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { pipelineAPI, authAPI } from '@/lib/api';
import PropertyPhoto from '@/components/PropertyPhoto';
import AppNav from '@/components/AppNav';

const STAGES = [
  { id: 'NEW', name: 'New Leads', color: 'bg-blue-100 border-blue-300 text-blue-800' },
  { id: 'ATTEMPTING_CONTACT', name: 'Attempting Contact', color: 'bg-yellow-100 border-yellow-300 text-yellow-800' },
  { id: 'CONTACT_MADE', name: 'Contact Made', color: 'bg-green-100 border-green-300 text-green-800' },
  { id: 'QUALIFYING', name: 'Qualifying', color: 'bg-purple-100 border-purple-300 text-purple-800' },
  { id: 'QUALIFIED', name: 'Qualified', color: 'bg-indigo-100 border-indigo-300 text-indigo-800' },
  { id: 'OFFER_SENT', name: 'Offer Sent', color: 'bg-orange-100 border-orange-300 text-orange-800' },
  { id: 'NEGOTIATING', name: 'Negotiating', color: 'bg-pink-100 border-pink-300 text-pink-800' },
  { id: 'UNDER_CONTRACT', name: 'Under Contract', color: 'bg-teal-100 border-teal-300 text-teal-800' },
];

function formatTimeAgo(date: string) {
  const hours = Math.round(
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60),
  );
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function PipelinePage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Record<string, any[]>>({});
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState('');

  useEffect(() => {
    fetchPipeline();
    authAPI.getTeam().then(r => setTeamMembers(r.data || [])).catch(() => {});
  }, []);

  const fetchPipeline = async () => {
    try {
      const response = await pipelineAPI.get();
      setLeads(response.data.leadsByStage);
    } catch (error) {
      console.error('Failed to fetch pipeline:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAiInsights = async () => {
    setInsightsLoading(true);
    try {
      const response = await pipelineAPI.getInsights();
      setAiInsights(response.data);
    } catch (error) {
      console.error('Failed to fetch insights:', error);
    } finally {
      setInsightsLoading(false);
    }
  };

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const { draggableId: leadId, source, destination } = result;
    if (source.droppableId === destination.droppableId) return;

    // Optimistic update
    const prevLeads = { ...leads };
    const newLeads = { ...leads };
    const sourceList = [...(newLeads[source.droppableId] || [])];
    const destList = [...(newLeads[destination.droppableId] || [])];
    const [movedLead] = sourceList.splice(source.index, 1);
    destList.splice(destination.index, 0, movedLead);
    newLeads[source.droppableId] = sourceList;
    newLeads[destination.droppableId] = destList;
    setLeads(newLeads);

    try {
      await pipelineAPI.updateStage(leadId, destination.droppableId);
    } catch (error) {
      console.error('Failed to update stage:', error);
      setLeads(prevLeads);
    }
  };

  // Filter leads by assignee
  const filteredLeads: Record<string, any[]> = {};
  for (const [stage, stageLeads] of Object.entries(leads)) {
    if (assigneeFilter === 'unassigned') {
      filteredLeads[stage] = (stageLeads || []).filter((l: any) => !l.assignedToUserId);
    } else if (assigneeFilter) {
      filteredLeads[stage] = (stageLeads || []).filter((l: any) => l.assignedToUserId === assigneeFilter);
    } else {
      filteredLeads[stage] = stageLeads || [];
    }
  }

  const totalLeads = Object.values(filteredLeads).flat().length;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading pipeline...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav />
      <main className="px-4 sm:px-6 lg:px-8 py-6">
        {/* Pipeline Stats Bar */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-sm text-gray-600">
              {totalLeads} active leads across {STAGES.length} stages.
              Drag cards to move leads through your pipeline.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className={`text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 ${assigneeFilter ? 'border-primary-400 bg-primary-50 text-primary-700 font-medium' : 'border-gray-200'}`}
            >
              <option value="">All team members</option>
              <option value="unassigned">Unassigned</option>
              {teamMembers.map((u: any) => (
                <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
              ))}
            </select>
            <button
              onClick={fetchAiInsights}
              disabled={insightsLoading}
              className="btn btn-primary"
            >
              {insightsLoading ? 'Analyzing...' : aiInsights ? 'Refresh AI Insights' : 'Get AI Insights'}
            </button>
          </div>
        </div>

        {/* AI Insights Banner */}
        {aiInsights && (
          <div className="mb-6 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-5">
            <div className="flex items-start gap-4">
              <div className="text-4xl flex-shrink-0">🤖</div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold mb-2 text-purple-900">
                  AI Pipeline Insights
                </h2>
                <p className="text-gray-700 mb-3 leading-relaxed">
                  {aiInsights.summary}
                </p>
                <div className="bg-white rounded-lg p-3 border border-purple-200 mb-3">
                  <p className="font-semibold text-purple-900 mb-1">
                    Priority Recommendation
                  </p>
                  <p className="text-gray-800 text-sm">
                    {aiInsights.recommendation}
                  </p>
                </div>
                <div className="flex gap-4 text-sm flex-wrap">
                  <div className="bg-white px-3 py-1.5 rounded-lg border border-purple-100">
                    <span className="text-gray-600">Hot Leads: </span>
                    <span className="font-bold text-orange-600">
                      {aiInsights.hotLeadsCount}
                    </span>
                  </div>
                  <div className="bg-white px-3 py-1.5 rounded-lg border border-purple-100">
                    <span className="text-gray-600">Needs Follow-up: </span>
                    <span className="font-bold text-red-600">
                      {aiInsights.needsFollowUpCount}
                    </span>
                  </div>
                  <div className="bg-white px-3 py-1.5 rounded-lg border border-purple-100">
                    <span className="text-gray-600">Est. Close Rate: </span>
                    <span className="font-bold text-green-600">
                      {aiInsights.estimatedCloseRate}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Kanban Board */}
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {STAGES.map((stage) => (
              <div key={stage.id} className="flex-shrink-0" style={{ width: '300px' }}>
                {/* Column Header */}
                <div className={`${stage.color} border rounded-lg px-3 py-2 mb-3`}>
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-sm">{stage.name}</h3>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-white/60">
                      {filteredLeads[stage.id]?.length || 0}
                    </span>
                  </div>
                </div>

                {/* Droppable Column */}
                <Droppable droppableId={stage.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`space-y-3 min-h-[200px] p-2 rounded-lg transition-colors ${
                        snapshot.isDraggingOver
                          ? 'bg-blue-50 border-2 border-blue-300 border-dashed'
                          : 'border-2 border-transparent'
                      }`}
                    >
                      {(filteredLeads[stage.id] || []).map((lead: any, index: number) => (
                        <Draggable key={lead.id} draggableId={lead.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                            >
                              <Link
                                href={`/leads/${lead.id}`}
                                className={`block bg-white rounded-lg p-3 shadow-sm border border-gray-200 hover:shadow-md hover:border-primary-300 transition ${
                                  snapshot.isDragging
                                    ? 'shadow-xl ring-2 ring-primary-500 rotate-1'
                                    : ''
                                }`}
                              >
                                {/* Card Header: Photo + Address + Score */}
                                <div className="flex items-start gap-2 mb-2">
                                  <PropertyPhoto
                                    src={lead.primaryPhoto}
                                    scoreBand={lead.scoreBand}
                                    address={lead.propertyAddress}
                                    size="sm"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-sm truncate text-gray-900">
                                      {lead.propertyAddress}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                      {lead.propertyCity}, {lead.propertyState}
                                    </p>
                                  </div>
                                  <span
                                    className={`badge badge-${lead.scoreBand?.toLowerCase().replace('_', '-')} text-base font-bold flex-shrink-0`}
                                  >
                                    {lead.totalScore}
                                  </span>
                                </div>

                                {/* Seller Name + Assignee */}
                                <div className="flex items-center justify-between mb-2">
                                  {lead.sellerFirstName && (
                                    <p className="text-xs text-gray-600">
                                      {lead.sellerFirstName} {lead.sellerLastName}
                                    </p>
                                  )}
                                  {lead.assignedTo && (
                                    <span
                                      className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-[10px] font-bold flex-shrink-0"
                                      title={`Assigned: ${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`}
                                    >
                                      {lead.assignedTo.firstName?.[0]}{lead.assignedTo.lastName?.[0]}
                                    </span>
                                  )}
                                </div>

                                {/* Stats Row */}
                                <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                                  <span title="Last touched">
                                    {formatTimeAgo(lead.lastTouchedAt)}
                                  </span>
                                  <span title="Touch count">
                                    {lead.touchCount} touches
                                  </span>
                                  {lead.arv && (
                                    <span className="text-green-600 font-medium" title="ARV">
                                      ${lead.arv.toLocaleString()}
                                    </span>
                                  )}
                                </div>

                                {/* AI Recommendation */}
                                {lead.aiRecommendation && (
                                  <div className="bg-purple-50 border border-purple-100 rounded p-2">
                                    <p className="text-xs text-purple-800 leading-relaxed line-clamp-2">
                                      <span className="font-semibold">AI:</span>{' '}
                                      {lead.aiRecommendation}
                                    </p>
                                  </div>
                                )}
                              </Link>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            ))}
          </div>
        </DragDropContext>
      </main>
    </div>
  );
}
