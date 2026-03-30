'use client';

import { useState } from 'react';
import { pipelineAPI } from '@/lib/api';

interface AiSummaryBoxProps {
  lead: any;
  onRefresh: () => void;
  onViewAnalysis: () => void;
}

export default function AiSummaryBox({ lead, onRefresh, onViewAnalysis }: AiSummaryBoxProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleGenerate = async () => {
    setRefreshing(true);
    try {
      await pipelineAPI.refreshLeadAnalysis(lead.id);
      onRefresh();
    } catch (error) {
      console.error('Failed to generate analysis:', error);
      alert('Failed to generate AI analysis');
    } finally {
      setRefreshing(false);
    }
  };

  // No analysis yet — show generate button
  if (!lead.aiDealRating) {
    return (
      <div className="card border-2 border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold flex items-center gap-2">
            AI Analysis
          </h3>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Get AI-powered insights on deal quality, missing data, and next actions.
        </p>
        <button
          onClick={handleGenerate}
          disabled={refreshing}
          className="btn btn-primary w-full"
        >
          {refreshing ? 'Analyzing...' : 'Generate AI Analysis'}
        </button>
      </div>
    );
  }

  return (
    <div className="card border-2 border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950 dark:to-blue-950">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold flex items-center gap-2">
          AI Analysis
        </h3>
        <button
          onClick={handleGenerate}
          disabled={refreshing}
          className="text-xs text-purple-600 hover:text-purple-800"
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Deal Rating */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">Deal Rating</span>
          <span className={`text-2xl font-bold ${
            lead.aiDealRating >= 7 ? 'text-green-600' :
            lead.aiDealRating >= 4 ? 'text-yellow-600' :
            'text-red-600'
          }`}>
            {lead.aiDealRating}/10
          </span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              lead.aiDealRating >= 7 ? 'bg-green-500' :
              lead.aiDealRating >= 4 ? 'bg-yellow-500' :
              'bg-red-500'
            }`}
            style={{ width: `${(lead.aiDealRating / 10) * 100}%` }}
          />
        </div>
      </div>

      {/* Deal Worthiness */}
      <div className={`rounded-lg p-3 mb-3 ${
        lead.aiDealWorthiness === 'YES' ? 'bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-800' :
        lead.aiDealWorthiness === 'NO' ? 'bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800' :
        'bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-800'
      }`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">
            {lead.aiDealWorthiness === 'YES' ? '✅' :
             lead.aiDealWorthiness === 'NO' ? '❌' : '⚠️'}
          </span>
          <span className={`font-bold text-sm ${
            lead.aiDealWorthiness === 'YES' ? 'text-green-900' :
            lead.aiDealWorthiness === 'NO' ? 'text-red-900' :
            'text-yellow-900'
          }`}>
            {lead.aiDealWorthiness === 'YES' ? 'Worth Pursuing' :
             lead.aiDealWorthiness === 'NO' ? 'Not Recommended' : 'Need More Data'}
          </span>
        </div>
        {lead.aiSummary && (
          <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
            {lead.aiSummary.replace(/^[✅❌⚠️]\s*/, '')}
          </p>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {lead.aiProfitPotential && (
          <div className="bg-white dark:bg-gray-900 rounded-lg p-2 border border-purple-100 dark:border-purple-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">Profit Potential</p>
            <p className={`font-bold text-sm ${
              lead.aiProfitPotential === 'HIGH' ? 'text-green-600' :
              lead.aiProfitPotential === 'MEDIUM' ? 'text-yellow-600' :
              lead.aiProfitPotential === 'LOW' ? 'text-red-600' : 'text-gray-600 dark:text-gray-400'
            }`}>
              {lead.aiProfitPotential}
            </p>
          </div>
        )}
        {lead.aiConfidence != null && (
          <div className="bg-white dark:bg-gray-900 rounded-lg p-2 border border-purple-100 dark:border-purple-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">Confidence</p>
            <p className="font-bold text-sm text-blue-600">
              {lead.aiConfidence}%
            </p>
          </div>
        )}
      </div>

      {/* Last Updated */}
      {lead.aiLastUpdated && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
          Updated {new Date(lead.aiLastUpdated).toLocaleString()}
        </p>
      )}

      {/* View Full Analysis */}
      <button
        onClick={onViewAnalysis}
        className="btn btn-secondary btn-sm w-full text-center"
      >
        View Full Analysis
      </button>
    </div>
  );
}
