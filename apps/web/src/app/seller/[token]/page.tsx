'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import PhotoUpload from './PhotoUpload';
import OfferSection from './OfferSection';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const fmt = (n: number | null | undefined) =>
  n != null ? `$${Math.round(n).toLocaleString('en-US')}` : 'N/A';
const fmtNum = (n: number | null | undefined) =>
  n != null ? n.toLocaleString('en-US') : '-';

export default function SellerPortalPage() {
  const params = useParams();
  const token = params.token as string;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const fetchData = useCallback(() => {
    fetch(`${API_URL}/seller-portal/${token}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'not_found' : 'error');
        return res.json();
      })
      .then(setData)
      .catch((err) =>
        setError(
          err.message === 'not_found'
            ? 'This page is no longer available.'
            : 'Something went wrong loading your property details.',
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400 text-sm">Loading your property...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-16 h-16 rounded-full bg-gray-100 mx-auto mb-4 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </div>
          <p className="text-gray-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const { property, sellerFirstName, comps, offers, agent, orgName } = data;

  // Build photos array for gallery
  const photos: { url: string; thumbnailUrl?: string; source?: string }[] = [];
  if (Array.isArray(property.photos)) {
    for (const p of property.photos) {
      if (typeof p === 'string') {
        photos.push({ url: p });
      } else if (p?.url) {
        photos.push(p);
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gray-900 text-white sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <p className="text-lg font-bold">{orgName}</p>
            <p className="text-xs text-gray-400">Your Property Portal</p>
          </div>
          {agent && (
            <a
              href={agent.phone ? `tel:${agent.phone}` : `mailto:${agent.email}`}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
            >
              Contact Us
            </a>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* Welcome */}
        {sellerFirstName && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-sm text-blue-800">
              Hi {sellerFirstName}! Here are the details we have on file for your property. Please review the information and upload any photos that would help us get a better understanding of the condition.
            </p>
          </div>
        )}

        {/* Hero Photo */}
        {property.primaryPhoto && (
          <div className="rounded-xl overflow-hidden">
            <img
              src={property.primaryPhoto}
              alt="Property"
              className="w-full h-64 sm:h-80 object-cover cursor-pointer"
              onClick={() => setLightboxIdx(0)}
            />
          </div>
        )}

        {/* Address */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{property.address}</h1>
          <p className="text-base text-gray-500 mt-1">{property.city}, {property.state} {property.zip}</p>
        </div>

        {/* Property Details Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Bedrooms', value: property.bedrooms ?? '-' },
            { label: 'Bathrooms', value: property.bathrooms ?? '-' },
            { label: 'Square Feet', value: property.sqft ? fmtNum(property.sqft) : '-' },
            { label: 'Year Built', value: property.yearBuilt ?? '-' },
            { label: 'Lot Size', value: property.lotSize ? (property.lotSize >= 1 ? `${property.lotSize.toFixed(2)} acres` : `${Math.round(property.lotSize * 43560).toLocaleString()} sqft`) : '-' },
            { label: 'Property Type', value: property.type || '-' },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-lg p-4 border border-gray-200 text-center">
              <p className="text-xs text-gray-400 uppercase font-medium">{item.label}</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">{item.value}</p>
            </div>
          ))}
        </div>

        {/* Photo Gallery */}
        {photos.length > 0 && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-3">Property Photos</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {photos.map((photo, i) => (
                <img
                  key={i}
                  src={photo.thumbnailUrl || photo.url}
                  alt={`Photo ${i + 1}`}
                  className="w-full h-36 object-cover rounded-lg cursor-pointer hover:opacity-90 transition"
                  onClick={() => setLightboxIdx(i)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Photo Upload */}
        <div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Upload Photos</h2>
          <p className="text-sm text-gray-500 mb-3">
            Help us understand your property better by uploading photos of the interior, exterior, and any areas that may need repair.
          </p>
          <PhotoUpload token={token} onUploadComplete={fetchData} />
        </div>

        {/* Comparable Sales */}
        {comps.length > 0 && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-3">Recent Sales Near Your Property</h2>
            <p className="text-sm text-gray-500 mb-4">
              These are homes similar to yours that have recently sold in your area.
            </p>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Mobile card view */}
              <div className="sm:hidden divide-y divide-gray-100">
                {comps.map((c: any, i: number) => (
                  <div key={i} className="p-4">
                    <p className="text-sm font-medium text-gray-900">{c.address}</p>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-lg font-bold text-green-600">{fmt(c.soldPrice)}</p>
                      <p className="text-xs text-gray-400">{c.soldDate}</p>
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-gray-500">
                      <span>{c.bedrooms ?? '-'} bd / {c.bathrooms ?? '-'} ba</span>
                      <span>{c.sqft ? fmtNum(c.sqft) + ' sqft' : '-'}</span>
                      <span>{c.distance.toFixed(1)} mi away</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table view */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Address</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Sold Price</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Date</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Sqft</th>
                      <th className="text-center py-3 px-4 font-medium text-gray-500">Bd/Ba</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Distance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comps.map((c: any, i: number) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="py-3 px-4 text-gray-900">{c.address}</td>
                        <td className="py-3 px-4 text-right font-medium text-green-600">{fmt(c.soldPrice)}</td>
                        <td className="py-3 px-4 text-right text-gray-500">{c.soldDate}</td>
                        <td className="py-3 px-4 text-right text-gray-500">{c.sqft ? fmtNum(c.sqft) : '-'}</td>
                        <td className="py-3 px-4 text-center text-gray-500">{c.bedrooms ?? '-'}/{c.bathrooms ?? '-'}</td>
                        <td className="py-3 px-4 text-right text-gray-500">{c.distance.toFixed(1)} mi</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Offers */}
        <OfferSection offers={offers} token={token} onResponse={fetchData} />

        {/* Contact Section */}
        {agent && (
          <div className="bg-blue-600 rounded-xl p-6 text-center">
            <h2 className="text-lg font-bold text-white mb-2">Have Questions?</h2>
            <p className="text-blue-100 text-sm mb-4">
              {agent.name} is here to help. Feel free to reach out anytime.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {agent.phone && (
                <a
                  href={`tel:${agent.phone}`}
                  className="inline-block bg-white text-blue-600 font-semibold text-sm px-6 py-3 rounded-lg hover:bg-blue-50 transition"
                >
                  Call {agent.name.split(' ')[0]}
                </a>
              )}
              <a
                href={`mailto:${agent.email}?subject=Question about ${property.address}`}
                className="inline-block bg-white/20 text-white font-semibold text-sm px-6 py-3 rounded-lg hover:bg-white/30 transition"
              >
                Send Email
              </a>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-6 border-t border-gray-200">
          <p className="text-sm text-gray-500">{orgName}</p>
          <p className="text-xs text-gray-400 mt-1">This page is private to you. Please do not share this link.</p>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && photos.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxIdx(null)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setLightboxIdx(null); }}
            className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl font-light z-10"
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
            src={photos[lightboxIdx].url}
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
