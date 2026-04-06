'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const fmt = (n: number | null | undefined) =>
  n != null ? `$${Math.round(n).toLocaleString('en-US')}` : 'N/A';
const fmtNum = (n: number | null | undefined) =>
  n != null ? n.toLocaleString('en-US') : 'N/A';

const DEAL_TYPE_LABELS: Record<string, string> = {
  wholesale: 'Wholesale', novation: 'Novation', retail: 'Retail Flip',
  'subject-to': 'Subject-To', 'joint venture': 'Joint Venture',
};
const FINISH_LABELS: Record<string, string> = {
  'move-in-ready': 'Move-In Ready', light_cosmetic: 'Light Cosmetic',
  moderate: 'Moderate Rehab', heavy: 'Heavy Rehab', 'full-gut': 'Full Gut',
  budget: 'Budget', flip: 'Flip Quality', 'high-end': 'High-End',
};
const CONDITION_COLORS: Record<string, string> = {
  Good: 'bg-green-100 text-green-800', Fair: 'bg-yellow-100 text-yellow-800',
  Poor: 'bg-red-100 text-red-800', Gut: 'bg-red-200 text-red-900',
};
const IMPACT_COLORS: Record<string, string> = {
  high: 'bg-red-100 text-red-700', medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-green-100 text-green-700',
};
const SYSTEM_ICONS: Record<string, string> = {
  roof: 'Roof', hvac: 'HVAC', electrical: 'Electrical',
  plumbing: 'Plumbing', foundation: 'Foundation',
};

export default function DealViewPage() {
  const params = useParams();
  const token = params.token as string;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

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

  const { lead, analysis, comps, orgName, senderName, senderEmail } = data;
  const di = analysis?.dealIntelligence;
  const pa = analysis?.photoAnalysis;
  const photos: string[] = [];
  if (lead.primaryPhoto) photos.push(lead.primaryPhoto);
  if (Array.isArray(lead.photos)) {
    for (const p of lead.photos) {
      const url = typeof p === 'string' ? p : p?.url;
      if (url && !photos.includes(url)) photos.push(url);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gray-900 text-white sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-lg font-bold">{orgName}</p>
            <p className="text-xs text-gray-400">Shared {new Date(data.sharedAt).toLocaleDateString()}</p>
          </div>
          {senderEmail && (
            <a href={`mailto:${senderEmail}`} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition">
              Contact Us
            </a>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* ── Hero + Address ─────────────────────────────────────────── */}
        {photos.length > 0 && (
          <div className="rounded-xl overflow-hidden">
            <img
              src={photos[0]}
              alt="Property"
              className="w-full h-80 object-cover cursor-pointer"
              onClick={() => setLightboxIdx(0)}
            />
          </div>
        )}

        <div>
          <h1 className="text-3xl font-bold text-gray-900">{lead.propertyAddress}</h1>
          <p className="text-lg text-gray-500 mt-1">{lead.propertyCity}, {lead.propertyState} {lead.propertyZip}</p>
        </div>

        {/* ── Property Details ────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Beds', value: lead.bedrooms ?? '-' },
            { label: 'Baths', value: lead.bathrooms ?? '-' },
            { label: 'Sqft', value: lead.sqft ? fmtNum(lead.sqft) : '-' },
            { label: 'Year Built', value: lead.yearBuilt ?? '-' },
            { label: 'Lot', value: lead.lotSize ? (lead.lotSize >= 1 ? `${lead.lotSize.toFixed(2)} ac` : `${Math.round(lead.lotSize * 43560).toLocaleString()} sf`) : '-' },
            { label: 'Type', value: lead.propertyType || '-' },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-lg p-4 border border-gray-200 text-center">
              <p className="text-xs text-gray-400 uppercase font-medium">{item.label}</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">{item.value}</p>
            </div>
          ))}
        </div>

        {/* ── Photo Gallery ──────────────────────────────────────────── */}
        {photos.length > 1 && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-3">Property Photos</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {photos.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`Photo ${i + 1}`}
                  className="w-full h-40 object-cover rounded-lg cursor-pointer hover:opacity-90 transition"
                  onClick={() => setLightboxIdx(i)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Deal Numbers ───────────────────────────────────────────── */}
        {analysis && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Deal Numbers</h2>
            <div className="grid grid-cols-3 gap-6 mb-4">
              <div className="text-center">
                <p className="text-xs text-gray-400 uppercase font-semibold">After Repair Value</p>
                <p className="text-3xl font-bold text-green-600 mt-1">{fmt(analysis.arvEstimate)}</p>
                {analysis.arvLow && analysis.arvHigh && (
                  <p className="text-xs text-gray-400 mt-1">{fmt(analysis.arvLow)} &ndash; {fmt(analysis.arvHigh)}</p>
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
              {analysis.pricePerSqft && <span>$/Sqft: <strong className="text-gray-900">${Math.round(analysis.pricePerSqft)}</strong></span>}
              {analysis.confidenceTier && <span>Confidence: <strong className="text-gray-900">{analysis.confidenceTier}</strong></span>}
            </div>
          </div>
        )}

        {/* ── Why This Deal (AI Bottom Line) ─────────────────────────── */}
        {di?.bottomLine && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
            <h2 className="text-sm font-bold text-amber-800 uppercase tracking-wide mb-2">Why This Deal</h2>
            <p className="text-base text-gray-900 leading-relaxed">{di.bottomLine}</p>
          </div>
        )}

        {/* ── Exit Scenarios ─────────────────────────────────────────── */}
        {di?.exitScenarios?.length > 0 && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-3">Exit Scenarios</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {di.exitScenarios.map((s: any, i: number) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-xs text-gray-400 uppercase font-semibold">{s.name}</p>
                  <p className="text-2xl font-bold text-green-600 mt-2">{fmt(s.estimatedSalePrice)}</p>
                  {s.saleRange && <p className="text-xs text-gray-400">{fmt(s.saleRange.low)} &ndash; {fmt(s.saleRange.high)}</p>}
                  {s.estimatedRepairCost > 0 && <p className="text-sm text-gray-600 mt-2">Repairs: {fmt(s.estimatedRepairCost)}</p>}
                  {s.timeToSell && <p className="text-sm text-gray-500">{s.timeToSell}</p>}
                  {s.notes && <p className="text-xs text-gray-400 mt-2 leading-relaxed">{s.notes}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Property Condition ──────────────────────────────────────── */}
        {pa && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-lg font-bold text-gray-900">Property Condition</h2>
              {pa.overallCondition && (
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${CONDITION_COLORS[pa.overallCondition] || 'bg-gray-100 text-gray-700'}`}>
                  {pa.overallCondition}
                </span>
              )}
            </div>

            {pa.wholesalerNotes && (
              <p className="text-sm text-gray-600 mb-4 leading-relaxed">{pa.wholesalerNotes}</p>
            )}

            {/* Systems */}
            {pa.systems && (
              <div className="mb-4">
                <p className="text-xs text-gray-400 uppercase font-semibold mb-2">Major Systems</p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {Object.entries(SYSTEM_ICONS).map(([key, label]) => {
                    const sys = pa.systems?.[key];
                    if (!sys) return null;
                    return (
                      <div key={key} className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500 font-medium">{label}</p>
                        <p className={`text-sm font-bold mt-1 ${
                          sys.condition === 'Good' ? 'text-green-600' :
                          sys.condition === 'Fair' ? 'text-yellow-600' :
                          sys.condition === 'Poor' ? 'text-red-600' : 'text-gray-500'
                        }`}>{sys.condition}</p>
                        {sys.notes && <p className="text-xs text-gray-400 mt-1">{sys.notes}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Rooms */}
            {pa.rooms?.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-gray-400 uppercase font-semibold mb-2">Room-by-Room</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {pa.rooms.map((r: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-2 bg-gray-50 rounded-lg">
                      <span className={`mt-0.5 px-2 py-0.5 rounded text-xs font-bold ${CONDITION_COLORS[r.condition] || 'bg-gray-100 text-gray-700'}`}>
                        {r.condition}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{r.name}</p>
                        {r.issues?.length > 0 && (
                          <p className="text-xs text-gray-500">{r.issues.join(', ')}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Red Flags */}
            {pa.redFlags?.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-xs text-red-700 font-bold uppercase mb-1">Red Flags</p>
                <ul className="space-y-1">
                  {pa.redFlags.map((f: string, i: number) => (
                    <li key={i} className="text-sm text-red-700">&bull; {f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ── Repair Estimate ────────────────────────────────────────── */}
        {analysis?.repairItems?.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-3">Repair Estimate</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 font-medium text-gray-500">Item</th>
                  <th className="text-right py-2 font-medium text-gray-500">Est. Range</th>
                  <th className="text-right py-2 font-medium text-gray-500">Priority</th>
                </tr>
              </thead>
              <tbody>
                {analysis.repairItems.map((item: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-900">{item.item || item.name || item.label || 'Item'}</td>
                    <td className="py-2 text-right text-gray-600">
                      {item.estimateLow != null && item.estimateHigh != null
                        ? `${fmt(item.estimateLow)} – ${fmt(item.estimateHigh)}`
                        : item.cost ? fmt(item.cost) : '-'}
                    </td>
                    <td className="py-2 text-right">
                      {item.priority && (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${IMPACT_COLORS[item.priority] || 'bg-gray-100 text-gray-600'}`}>
                          {item.priority}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
              <span className="text-sm text-gray-500">Total Estimated Repairs</span>
              <span className="text-lg font-bold text-red-600">{fmt(analysis.repairCosts)}</span>
            </div>
            {analysis.repairFinishLevel && (
              <p className="text-xs text-gray-400 mt-1 text-right">Finish level: {FINISH_LABELS[analysis.repairFinishLevel] || analysis.repairFinishLevel}</p>
            )}
          </div>
        )}

        {/* ── Market Analysis ────────────────────────────────────────── */}
        {analysis?.aiSummary && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-lg font-bold text-gray-900">Market Analysis</h2>
              {di?.marketVelocity?.verdict && di.marketVelocity.verdict !== 'unknown' && (
                <span className={`px-3 py-1 rounded-full text-xs font-bold text-white ${
                  di.marketVelocity.verdict === 'hot' ? 'bg-green-600' :
                  di.marketVelocity.verdict === 'slow' ? 'bg-red-500' : 'bg-blue-600'
                }`}>{di.marketVelocity.verdict.toUpperCase()} MARKET</span>
              )}
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">{analysis.aiSummary}</p>
            {di?.marketVelocity?.summary && (
              <p className="text-sm text-gray-500 mt-3 leading-relaxed">{di.marketVelocity.summary}</p>
            )}
            {di?.ppsfAnalysis?.avgPpsf && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex gap-6 text-sm text-gray-600">
                <span>Avg $/sqft: <strong className="text-gray-900">${Math.round(di.ppsfAnalysis.avgPpsf)}</strong></span>
                {di.ppsfAnalysis.asIsPpsf && <span>As-Is: <strong className="text-gray-900">${Math.round(di.ppsfAnalysis.asIsPpsf)}</strong></span>}
                {di.ppsfAnalysis.remodledPpsf && <span>Remodeled: <strong className="text-gray-900">${Math.round(di.ppsfAnalysis.remodledPpsf)}</strong></span>}
              </div>
            )}
          </div>
        )}

        {/* ── Risk Assessment ────────────────────────────────────────── */}
        {di?.riskFactors?.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-3">Risk Assessment</h2>
            <div className="space-y-2">
              {di.riskFactors.map((r: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className={`mt-0.5 px-2 py-0.5 rounded text-xs font-bold ${IMPACT_COLORS[r.impact] || 'bg-gray-100 text-gray-600'}`}>
                    {r.impact}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{r.factor}</p>
                    <p className="text-xs text-gray-500">{r.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Comparable Sales ────────────────────────────────────────── */}
        {comps.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Comparable Sales</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 px-3 font-medium text-gray-500">Address</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">Sold Price</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">Date</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">Sqft</th>
                    <th className="text-center py-2 px-3 font-medium text-gray-500">Bd/Ba</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">Year</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500">Dist</th>
                  </tr>
                </thead>
                <tbody>
                  {comps.map((c: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition">
                      <td className="py-2.5 px-3">
                        <a
                          href={`https://www.google.com/maps/search/${encodeURIComponent(c.address)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {c.address}
                        </a>
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-gray-900">{fmt(c.soldPrice)}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500">{c.soldDate}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500">{c.sqft ? fmtNum(c.sqft) : '-'}</td>
                      <td className="py-2.5 px-3 text-center text-gray-500">{c.bedrooms ?? '-'}/{c.bathrooms ?? '-'}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500">{c.yearBuilt ?? '-'}</td>
                      <td className="py-2.5 px-3 text-right text-gray-500">{c.distance.toFixed(1)} mi</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Contact CTA ────────────────────────────────────────────── */}
        {senderEmail && (
          <div className="bg-blue-600 rounded-xl p-8 text-center">
            <h2 className="text-xl font-bold text-white mb-2">Interested in this deal?</h2>
            <p className="text-blue-100 text-sm mb-5">
              {senderName ? `Reach out to ${senderName} to discuss this opportunity.` : 'Get in touch to discuss this opportunity.'}
            </p>
            <a
              href={`mailto:${senderEmail}?subject=Re: ${lead.propertyAddress}&body=I'm interested in the deal at ${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState}.%0A%0A`}
              className="inline-block bg-white text-blue-600 font-semibold text-sm px-6 py-3 rounded-lg hover:bg-blue-50 transition"
            >
              Contact {senderName || 'Us'}
            </a>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div className="text-center py-6 border-t border-gray-200">
          <p className="text-sm text-gray-500">{orgName} &mdash; Real estate deal intelligence</p>
          <p className="text-xs text-gray-400 mt-1">This deal package was shared privately. Please do not forward without permission.</p>
        </div>
      </div>

      {/* ── Lightbox ─────────────────────────────────────────────────── */}
      {lightboxIdx !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxIdx(null)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setLightboxIdx(null); }}
            className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl font-light"
          >
            &times;
          </button>
          {lightboxIdx > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx - 1); }}
              className="absolute left-4 text-white/70 hover:text-white text-3xl"
            >
              &lsaquo;
            </button>
          )}
          {lightboxIdx < photos.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx + 1); }}
              className="absolute right-4 text-white/70 hover:text-white text-3xl"
            >
              &rsaquo;
            </button>
          )}
          <img
            src={photos[lightboxIdx]}
            alt=""
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="absolute bottom-4 text-white/50 text-sm">{lightboxIdx + 1} / {photos.length}</p>
        </div>
      )}
    </div>
  );
}
