'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface DealViewData {
  lead: {
    propertyAddress: string;
    propertyCity: string;
    propertyState: string;
    propertyZip: string;
    propertyType: string | null;
    bedrooms: number | null;
    bathrooms: number | null;
    sqft: number | null;
    yearBuilt: number | null;
    lotSize: number | null;
    stories: number | null;
    primaryPhoto: string | null;
    photos: any;
  };
  analysis: {
    arvEstimate: number | null;
    arvLow: number | null;
    arvHigh: number | null;
    repairCosts: number | null;
    repairFinishLevel: string | null;
    dealType: string;
    assignmentFee: number;
    maoPercent: number;
    mao: number;
    confidenceTier: string | null;
    aiSummary: string | null;
  } | null;
  comps: Array<{
    address: string;
    soldPrice: number;
    soldDate: string;
    sqft: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    yearBuilt: number | null;
    distance: number;
    photoUrl: string | null;
  }>;
  orgName: string;
  sharedAt: string;
  partnerName: string;
}

const fmt = (n: number | null | undefined) =>
  n != null ? `$${Math.round(n).toLocaleString('en-US')}` : 'N/A';

const DEAL_TYPE_LABELS: Record<string, string> = {
  wholesale: 'Wholesale',
  novation: 'Novation',
  retail: 'Retail Flip',
  'subject-to': 'Subject-To',
  'joint venture': 'Joint Venture',
};

const FINISH_LABELS: Record<string, string> = {
  'move-in-ready': 'Move-In Ready',
  light_cosmetic: 'Light Cosmetic',
  moderate: 'Moderate Rehab',
  heavy: 'Heavy Rehab',
  'full-gut': 'Full Gut Renovation',
};

export default function DealViewPage() {
  const params = useParams();
  const token = params.token as string;
  const [data, setData] = useState<DealViewData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/deal-view/${token}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'expired' : 'error');
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message === 'expired' ? 'This deal link has expired or is no longer available.' : 'Something went wrong loading this deal.'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400 text-sm">Loading deal...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-16 h-16 rounded-full bg-gray-100 mx-auto mb-4 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
          </div>
          <p className="text-gray-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const { lead, analysis, comps, orgName } = data;
  const photos = Array.isArray(lead.photos) ? lead.photos : [];
  const allPhotos = lead.primaryPhoto ? [lead.primaryPhoto, ...photos.filter((p: string) => p !== lead.primaryPhoto)] : photos;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gray-900 text-white">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-lg font-bold">{orgName}</p>
            <p className="text-sm text-gray-400">Investment Opportunity</p>
          </div>
          <p className="text-xs text-gray-500">Shared {new Date(data.sharedAt).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Hero Photo */}
        {allPhotos.length > 0 && (
          <div className="mb-6 rounded-xl overflow-hidden">
            <img
              src={allPhotos[0]}
              alt="Property"
              className="w-full h-72 object-cover"
            />
            {allPhotos.length > 1 && (
              <div className="flex gap-1 mt-1">
                {allPhotos.slice(1, 5).map((url: string, i: number) => (
                  <img key={i} src={url} alt="" className="flex-1 h-20 object-cover rounded" />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Property Address */}
        <h1 className="text-3xl font-bold text-gray-900 mb-1">{lead.propertyAddress}</h1>
        <p className="text-lg text-gray-500 mb-8">{lead.propertyCity}, {lead.propertyState} {lead.propertyZip}</p>

        {/* Property Details */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {[
            { label: 'Beds', value: lead.bedrooms ?? '-' },
            { label: 'Baths', value: lead.bathrooms ?? '-' },
            { label: 'Sqft', value: lead.sqft ? lead.sqft.toLocaleString() : '-' },
            { label: 'Year Built', value: lead.yearBuilt ?? '-' },
            { label: 'Lot Size', value: lead.lotSize ? (lead.lotSize >= 1 ? `${lead.lotSize.toFixed(2)} ac` : `${Math.round(lead.lotSize * 43560).toLocaleString()} sqft`) : '-' },
            { label: 'Type', value: lead.propertyType || '-' },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-lg p-4 border border-gray-200">
              <p className="text-xs text-gray-400 uppercase font-medium">{item.label}</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">{item.value}</p>
            </div>
          ))}
        </div>

        {/* Deal Numbers */}
        {analysis && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Deal Numbers</h2>
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div className="text-center">
                <p className="text-xs text-gray-400 uppercase font-semibold">After Repair Value</p>
                <p className="text-3xl font-bold text-green-600 mt-1">{fmt(analysis.arvEstimate)}</p>
                {analysis.arvLow && analysis.arvHigh && (
                  <p className="text-xs text-gray-400 mt-1">{fmt(analysis.arvLow)} - {fmt(analysis.arvHigh)}</p>
                )}
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400 uppercase font-semibold">Est. Repairs</p>
                <p className="text-3xl font-bold text-red-600 mt-1">{fmt(analysis.repairCosts)}</p>
                {analysis.repairFinishLevel && (
                  <p className="text-xs text-gray-400 mt-1">{FINISH_LABELS[analysis.repairFinishLevel] || analysis.repairFinishLevel}</p>
                )}
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400 uppercase font-semibold">Max Allowable Offer</p>
                <p className="text-3xl font-bold text-blue-600 mt-1">{fmt(analysis.mao)}</p>
                <p className="text-xs text-gray-400 mt-1">@ {analysis.maoPercent}% of ARV</p>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 pt-4 text-sm text-gray-600">
              <span>Deal Type: <strong className="text-gray-900">{DEAL_TYPE_LABELS[analysis.dealType] || analysis.dealType}</strong></span>
              <span>Assignment Fee: <strong className="text-gray-900">{fmt(analysis.assignmentFee)}</strong></span>
              {analysis.confidenceTier && (
                <span>Confidence: <strong className="text-gray-900">{analysis.confidenceTier}</strong></span>
              )}
            </div>
          </div>
        )}

        {/* AI Summary */}
        {analysis?.aiSummary && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
            <h2 className="text-lg font-bold text-gray-900 mb-3">Market Analysis</h2>
            <p className="text-sm text-gray-600 leading-relaxed">{analysis.aiSummary}</p>
          </div>
        )}

        {/* Comparable Sales */}
        {comps.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Comparable Sales</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Address</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">Sold Price</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">Date</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">Sqft</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">Bed/Bath</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {comps.map((c, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-2 px-3 text-gray-900">{c.address}</td>
                      <td className="py-2 px-3 text-right text-gray-900 font-medium">{fmt(c.soldPrice)}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{c.soldDate}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{c.sqft ? c.sqft.toLocaleString() : '-'}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{c.bedrooms ?? '-'}/{c.bathrooms ?? '-'}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{c.distance.toFixed(1)} mi</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-8 border-t border-gray-200">
          <p className="text-sm text-gray-500">{orgName} &mdash; Real estate deal intelligence</p>
          <p className="text-xs text-gray-400 mt-1">This deal package was shared privately. Please do not forward without permission.</p>
        </div>
      </div>
    </div>
  );
}
