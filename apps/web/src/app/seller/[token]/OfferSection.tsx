'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Offer {
  id: string;
  offerAmount: number;
  offerDate: string;
  status: string;
  terms: string | null;
  sellerRespondedAt: string | null;
}

interface OfferSectionProps {
  offers: Offer[];
  token: string;
  onResponse: () => void;
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export default function OfferSection({ offers, token, onResponse }: OfferSectionProps) {
  const [confirming, setConfirming] = useState<{ offerId: string; action: 'accepted' | 'declined' } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleRespond = async (offerId: string, response: 'accepted' | 'declined') => {
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/seller-portal/${token}/offers/${offerId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Failed to submit response');
      }

      setConfirming(null);
      onResponse();
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (offers.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-gray-900">Our Offer</h2>

      {offers.map((offer) => {
        const isPending = offer.status === 'pending';
        const isAccepted = offer.status === 'accepted';
        const isDeclined = offer.status === 'rejected';
        const isConfirmingThis = confirming?.offerId === offer.id;

        return (
          <div key={offer.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Offer Header */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-gray-500">Offer Amount</p>
                  <p className="text-3xl font-bold text-gray-900">{fmt(offer.offerAmount)}</p>
                </div>
                <div>
                  {isAccepted && (
                    <span className="px-4 py-2 bg-green-100 text-green-800 text-sm font-bold rounded-full">
                      Accepted
                    </span>
                  )}
                  {isDeclined && (
                    <span className="px-4 py-2 bg-red-100 text-red-800 text-sm font-bold rounded-full">
                      Declined
                    </span>
                  )}
                  {isPending && (
                    <span className="px-4 py-2 bg-blue-100 text-blue-800 text-sm font-bold rounded-full">
                      Pending Your Response
                    </span>
                  )}
                </div>
              </div>

              <p className="text-xs text-gray-400">
                Offered on {new Date(offer.offerDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>

              {/* Terms */}
              {offer.terms && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 font-semibold uppercase mb-2">Terms</p>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{offer.terms}</p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {isPending && (
              <div className="border-t border-gray-100 p-4">
                {isConfirmingThis ? (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-700 text-center font-medium">
                      {confirming.action === 'accepted'
                        ? `Are you sure you want to accept this offer of ${fmt(offer.offerAmount)}?`
                        : 'Are you sure you want to decline this offer?'}
                    </p>
                    {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                    <div className="flex gap-3">
                      <button
                        onClick={() => setConfirming(null)}
                        disabled={submitting}
                        className="flex-1 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
                      >
                        Go Back
                      </button>
                      <button
                        onClick={() => handleRespond(offer.id, confirming.action)}
                        disabled={submitting}
                        className={`flex-1 py-2.5 text-sm font-medium text-white rounded-lg transition disabled:opacity-50 ${
                          confirming.action === 'accepted'
                            ? 'bg-green-600 hover:bg-green-700'
                            : 'bg-red-600 hover:bg-red-700'
                        }`}
                      >
                        {submitting
                          ? 'Submitting...'
                          : confirming.action === 'accepted'
                            ? 'Yes, Accept Offer'
                            : 'Yes, Decline Offer'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <button
                      onClick={() => setConfirming({ offerId: offer.id, action: 'accepted' })}
                      className="flex-1 py-3 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 transition"
                    >
                      Accept Offer
                    </button>
                    <button
                      onClick={() => setConfirming({ offerId: offer.id, action: 'declined' })}
                      className="flex-1 py-3 text-sm font-semibold text-red-600 bg-white border-2 border-red-200 rounded-lg hover:bg-red-50 transition"
                    >
                      Decline Offer
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Response timestamp */}
            {offer.sellerRespondedAt && (
              <div className="border-t border-gray-100 px-6 py-3 bg-gray-50">
                <p className="text-xs text-gray-400">
                  Responded on {new Date(offer.sellerRespondedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
