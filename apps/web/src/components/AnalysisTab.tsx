'use client';

import { useEffect } from 'react';
import { pipelineAPI } from '@/lib/api';

export default function AnalysisTab({
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
