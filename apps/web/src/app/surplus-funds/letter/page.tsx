'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { surplusAPI } from '@/lib/api';
import { todayLocal } from '@/lib/dates';

/**
 * A letter, ready to print.
 *
 * Built from the active template of the chosen kind with the merge fields
 * filled for this claimant or heir, laid out as a business letter, and
 * printed from the browser. Nothing is recorded until the person clicks
 * "Mailed", which writes the envelope to the letter history with the
 * template version that was on the page. That is what makes "the letter went
 * out" a fact on the file rather than a memory.
 *
 * Or, when Lob is set up, it goes through Lob: a test key makes a proof PDF
 * and records nothing, a live key mails it First Class and records it the
 * same way "Mailed" does. Priority and FedEx stay on paper.
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

interface LobState {
  configured: boolean;
  mode: 'test' | 'live' | null;
  monthlyLimit: number | null;
  remaining: number | null;
  cost: number | null;
}

interface LobSent {
  mode: 'test' | 'live';
  ok: boolean;
  lobLetterId: string;
  url?: string | null;
  expectedDeliveryDate?: string | null;
  alreadyRecorded?: boolean;
  error?: string;
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
  const [lob, setLob] = useState<LobState | null>(null);
  const [lobSent, setLobSent] = useState<LobSent | null>(null);

  useEffect(() => {
    surplusAPI
      .printRunLob()
      .then((r) => setLob(r.data))
      .catch(() => setLob(null));
  }, []);

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
        mailedAt: todayLocal(),
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

  const sendLob = async () => {
    if (!letter || busy || !lob?.configured) return;
    const live = lob.mode === 'live';
    const ok = window.confirm(
      live
        ? `Mail this letter to ${letter.recipient.name} through Lob now?\n\n` +
            `Lob prints and mails it First Class, black and white, at about $${(lob.cost ?? 0).toFixed(2)}. It is recorded on the file as mailed today with the postage, and Lob's tracking lands on it. ${lob.remaining ?? 0} of this month's ${lob.monthlyLimit ?? 0} are left.`
        : `Make a Lob test proof of this letter?\n\nThe key on the API is a TEST key: Lob renders the letter as a PDF to check and mails nothing. Nothing is recorded on the file.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await surplusAPI.letterViaLob(leadId, kind, heirId, mailType);
      const data: LobSent = r.data;
      setLobSent(data);
      if (data.mode === 'live' && (data.ok || data.lobLetterId)) setRecorded(data.ok);
    } catch (e: any) {
      setLobSent(null);
      window.alert(e?.response?.data?.message || 'Lob could not be reached. Nothing was sent.');
    } finally {
      setBusy(false);
    }
  };
  const lobLive = lob?.mode === 'live';
  const lobMailed = !!lobSent && lobSent.mode === 'live' && !!lobSent.lobLetterId;

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
        {lobSent?.mode === 'test' && lobSent.url && (
          <span className="text-xs text-amber-800">
            Test proof made, nothing mailed or recorded.{' '}
            <a href={lobSent.url} target="_blank" rel="noreferrer" className="underline font-medium">
              Open the Lob proof ↗
            </a>
          </span>
        )}
        {lobSent?.mode === 'live' && lobSent.ok && (
          <span className="text-xs font-medium text-green-700">
            {lobSent.alreadyRecorded ? 'Lob already has this letter and it is on the file.' : 'Lob is mailing it, and it is recorded on the file.'}
            {lobSent.expectedDeliveryDate ? ` Expected ${lobSent.expectedDeliveryDate}.` : ''}
          </span>
        )}
        {lobSent && !lobSent.ok && lobSent.error && <span className="text-xs text-red-600">{lobSent.error}</span>}
        <div className="ml-auto flex items-center gap-2">
          {lob?.configured && !recorded && !lobMailed && (
            <button
              type="button"
              onClick={sendLob}
              disabled={busy || !letter.hasText || letter.unfilled.length > 0 || !letter.recipient.address || mailType !== 'standard' || (lobLive && (lob.remaining ?? 0) === 0)}
              title={
                mailType !== 'standard'
                  ? 'Lob has no Priority Mail or FedEx. Print this one.'
                  : lobLive
                    ? `Lob prints and mails it First Class and it is recorded as mailed. ${lob.remaining ?? 0} of ${lob.monthlyLimit ?? 0} left this month.`
                    : 'Test key: Lob makes a proof PDF and mails nothing'
              }
              className={`h-9 px-4 rounded-lg text-sm font-medium disabled:opacity-50 ${
                lobLive ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'border border-amber-500 text-amber-800 bg-amber-50 hover:bg-amber-100'
              }`}
            >
              {busy ? 'Sending to Lob...' : lobLive ? 'Mail through Lob' : 'Lob test proof'}
            </button>
          )}
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
          {recorded || lobMailed ? (
            !lobMailed && <span className="text-sm font-medium text-green-700">Recorded as mailed today</span>
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
