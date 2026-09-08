'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { surplusAPI } from '@/lib/api';

/**
 * A letter, ready to print.
 *
 * Built from the active template of the chosen kind with the merge fields
 * filled for this claimant or heir, laid out as a business letter, and
 * printed from the browser. Nothing is recorded until the person clicks
 * "Mailed", which writes the envelope to the letter history with the
 * template version that was on the page. That is what makes "the letter went
 * out" a fact on the file rather than a memory.
 */

interface RenderedLetter {
  kind: string;
  label: string;
  version: number;
  versionLabel: string;
  hasText: boolean;
  body: string;
  unfilled: string[];
  recipient: { heirId: string | null; name: string; address: string | null };
  sender: { companyName: string; phone: string; callerName: string; website: string | null };
  claimant: string;
  propertyAddress: string;
  today: string;
}

const MAIL_TYPES: [string, string][] = [
  ['standard', 'Standard mail'],
  ['priority', 'Priority Mail'],
  ['fedex', 'FedEx'],
];

function LetterPage() {
  const params = useSearchParams();
  const leadId = params.get('lead') || '';
  const kind = params.get('kind') || 'letter_claimant';
  const heirId = params.get('heir');

  const [letter, setLetter] = useState<RenderedLetter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mailType, setMailType] = useState('standard');
  const [tracking, setTracking] = useState('');
  const [recorded, setRecorded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!leadId) {
      setError('No claimant given.');
      return;
    }
    surplusAPI
      .letter(leadId, kind, heirId)
      .then((r) => setLetter(r.data))
      .catch((e) => setError(e?.response?.data?.message || 'The letter could not be built.'));
  }, [leadId, kind, heirId]);

  const record = async () => {
    if (!letter || busy) return;
    setBusy(true);
    try {
      await surplusAPI.letterMailed([leadId], {
        mailedAt: new Date().toISOString().slice(0, 10),
        address: letter.recipient.address,
        recipientName: letter.recipient.name,
        heirId: letter.recipient.heirId,
        templateKind: letter.kind,
        templateVersion: letter.version,
        mailType,
        trackingNumber: tracking.trim() || null,
      });
      setRecorded(true);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'The letter could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return <p className="p-8 text-sm text-red-600">{error}</p>;
  }
  if (!letter) {
    return <p className="p-8 text-sm text-gray-500">Building the letter...</p>;
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; min-height: 0 !important; }
          @page { margin: 1in; }
        }
      `}</style>

      {/* The controls. Hidden on paper. */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap items-center gap-3">
        <div className="text-sm">
          <span className="font-semibold text-gray-900">{letter.label}</span>
          <span className="text-gray-500"> · {letter.versionLabel} · to {letter.recipient.name}</span>
        </div>
        {!letter.hasText && (
          <span className="text-xs text-red-600">
            This letter kind has no text yet. Write it in Settings, Surplus Scripts and Letters.
          </span>
        )}
        {letter.unfilled.length > 0 && (
          <span className="text-xs text-amber-700">
            Could not fill: {letter.unfilled.join(', ')}. Fix the file before mailing.
          </span>
        )}
        {!letter.recipient.address && (
          <span className="text-xs text-amber-700">No mailing address on file for {letter.recipient.name}.</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => window.print()}
            disabled={!letter.hasText}
            className="h-9 px-4 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            Print
          </button>
          <select
            value={mailType}
            onChange={(e) => setMailType(e.target.value)}
            className="h-9 rounded-lg border border-gray-300 text-sm px-2"
            aria-label="Mail type"
          >
            {MAIL_TYPES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <input
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            placeholder="Tracking number"
            className="h-9 w-40 rounded-lg border border-gray-300 text-sm px-2"
          />
          {recorded ? (
            <span className="text-sm font-medium text-green-700">Recorded as mailed today</span>
          ) : (
            <button
              onClick={record}
              disabled={busy || !letter.hasText || letter.unfilled.length > 0}
              title="Write this letter to the claimant's history as mailed today"
              className="h-9 px-4 rounded-lg border border-primary-600 text-primary-700 text-sm font-medium hover:bg-primary-50 disabled:opacity-50"
            >
              {busy ? 'Saving...' : 'Mailed'}
            </button>
          )}
        </div>
      </div>

      {/* The letter itself, US Letter proportions on screen. */}
      <div className="sheet mx-auto my-8 bg-white shadow-lg w-[8.5in] min-h-[11in] px-[1in] py-[1in] text-[12.5pt] leading-[1.5] text-gray-900 font-serif">
        <div className="flex items-baseline justify-between border-b border-gray-300 pb-3 mb-8">
          <div>
            <div className="text-[16pt] font-semibold tracking-tight">{letter.sender.companyName}</div>
            <div className="text-[10pt] text-gray-600">
              {letter.sender.phone}
              {letter.sender.website ? ` · ${letter.sender.website}` : ''}
            </div>
          </div>
          <div className="text-[10pt] text-gray-600">Re: {letter.propertyAddress}</div>
        </div>

        <pre className="whitespace-pre-wrap font-serif text-[12.5pt] leading-[1.5]">{letter.body}</pre>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-gray-500">Building the letter...</p>}>
      <LetterPage />
    </Suspense>
  );
}
