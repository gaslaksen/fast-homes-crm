'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { surplusAPI } from '@/lib/api';

/**
 * The mobile notary packet, ready to print.
 *
 * Page one is the instruction sheet with the signing order and exactly what
 * is in the envelope. Each document that belongs in this appointment follows
 * on its own page, rendered from its template. What is in and what is
 * withheld follows the course's rule: retention before the fund source.
 */

interface PacketItem {
  step: number;
  kind: string;
  label: string;
  note: string;
  status: string;
  included: boolean;
  reason: string;
  versionLabel: string | null;
  hasText: boolean;
  body: string | null;
  unfilled: string[];
  attachCountyForm: boolean;
}

interface Packet {
  claimant: string;
  propertyAddress: string;
  county: string | null;
  retentionConfirmed: boolean;
  includeAll: boolean;
  notary: {
    name: string | null;
    phone: string | null;
    email: string | null;
    agreementSignedAt: string | null;
    appointmentAt: string | null;
    appointmentPlace: string | null;
  };
  cover: { versionLabel: string; body: string; unfilled: string[] };
  items: PacketItem[];
  contents: string[];
  sender: { companyName: string; phone: string; website: string | null };
  today: string;
}

function fmtWhen(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;
}

function NotaryPacketPage() {
  const params = useSearchParams();
  const leadId = params.get('lead') || '';
  const [includeAll, setIncludeAll] = useState(params.get('all') === 'true');
  const [packet, setPacket] = useState<Packet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leadId) {
      setError('No claimant given.');
      return;
    }
    setPacket(null);
    surplusAPI
      .notaryPacket(leadId, includeAll)
      .then((r) => setPacket(r.data))
      .catch((e) => setError(e?.response?.data?.message || 'The packet could not be built.'));
  }, [leadId, includeAll]);

  if (error) return <p className="p-8 text-sm text-red-600">{error}</p>;
  if (!packet) return <p className="p-8 text-sm text-gray-500">Building the packet...</p>;

  const included = packet.items.filter((i) => i.included);
  const problems = included.filter((i) => !i.hasText || i.unfilled.length > 0 || (i.attachCountyForm && !i.body));

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; min-height: 0 !important; page-break-after: always; }
          .sheet:last-child { page-break-after: auto; }
          @page { margin: 1in; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap items-center gap-3">
        <div className="text-sm">
          <span className="font-semibold text-gray-900">Notary packet</span>
          <span className="text-gray-500"> · {packet.claimant} · {included.length} document{included.length === 1 ? '' : 's'} enclosed</span>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded ${
            packet.retentionConfirmed ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {packet.retentionConfirmed ? 'Retention confirmed: the assignment is enclosed' : 'Retention not yet signed: the assignment is withheld'}
        </span>
        <label className="text-xs text-gray-600 flex items-center gap-1.5">
          <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
          One appointment, whole set in order
        </label>
        {!packet.notary.agreementSignedAt && (
          <span className="text-xs text-red-600">The notary has not signed the instruction sheet yet. Send that first.</span>
        )}
        {problems.length > 0 && (
          <span className="text-xs text-amber-700">
            Not ready: {problems.map((p) => `${p.label}${!p.hasText ? ' (no text)' : p.unfilled.length ? ` (unfilled: ${p.unfilled.join(', ')})` : ''}`).join('; ')}
          </span>
        )}
        <button
          onClick={() => window.print()}
          className="ml-auto h-9 px-4 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700"
        >
          Print
        </button>
      </div>

      {/* Page one: the instruction sheet, with what is actually in the envelope. */}
      <div className="sheet mx-auto my-8 bg-white shadow-lg w-[8.5in] min-h-[11in] px-[1in] py-[1in] text-[12pt] leading-[1.5] text-gray-900 font-serif">
        <div className="flex items-baseline justify-between border-b border-gray-300 pb-3 mb-6">
          <div>
            <div className="text-[16pt] font-semibold tracking-tight">{packet.sender.companyName}</div>
            <div className="text-[10pt] text-gray-600">
              {packet.sender.phone}
              {packet.sender.website ? ` · ${packet.sender.website}` : ''}
            </div>
          </div>
          <div className="text-[10pt] text-gray-600 text-right">
            <div>Mobile notary packet · {packet.cover.versionLabel}</div>
            <div>{packet.propertyAddress}</div>
          </div>
        </div>

        <div className="mb-6 text-[11pt] border border-gray-300 rounded p-3">
          <div className="font-semibold mb-1">Appointment</div>
          <div>Notary: {packet.notary.name || 'not yet assigned'}{packet.notary.phone ? `, ${packet.notary.phone}` : ''}</div>
          <div>When: {fmtWhen(packet.notary.appointmentAt) || 'not yet booked'}</div>
          <div>Where: {packet.notary.appointmentPlace || 'to be confirmed'}</div>
          <div className="mt-2 font-semibold">Enclosed, in signing order</div>
          {packet.contents.length ? (
            <ol className="list-none">
              {packet.contents.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
          ) : (
            <div>Nothing to sign at this appointment.</div>
          )}
          {packet.items
            .filter((i) => !i.included)
            .map((i) => (
              <div key={i.kind} className="text-gray-600">
                {i.step}. {i.label}: {i.reason}
              </div>
            ))}
        </div>

        <pre className="whitespace-pre-wrap font-serif text-[11.5pt] leading-[1.5]">{packet.cover.body}</pre>
      </div>

      {/* Then each enclosed document on its own page. */}
      {included.map((i) => (
        <div
          key={i.kind}
          className="sheet mx-auto my-8 bg-white shadow-lg w-[8.5in] min-h-[11in] px-[1in] py-[1in] text-[12pt] leading-[1.5] text-gray-900 font-serif"
        >
          <div className="flex items-baseline justify-between border-b border-gray-300 pb-3 mb-8">
            <div className="text-[13pt] font-semibold">
              {i.step}. {i.label}
              {i.versionLabel ? <span className="text-[10pt] font-normal text-gray-600"> · {i.versionLabel}</span> : null}
            </div>
            <div className="text-[10pt] text-gray-600">{packet.claimant}</div>
          </div>
          {i.attachCountyForm ? (
            <p className="text-gray-700">
              Attach the {packet.county || 'county'} County claim form here, completed for {packet.claimant}. The stored
              county copy is on the Surplus Counties settings page.
            </p>
          ) : i.body ? (
            <pre className="whitespace-pre-wrap font-serif text-[12pt] leading-[1.5]">{i.body}</pre>
          ) : (
            <p className="text-red-600">No approved text for this document yet. Paste it in Settings, Surplus Scripts and Letters.</p>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-gray-500">Building the packet...</p>}>
      <NotaryPacketPage />
    </Suspense>
  );
}
