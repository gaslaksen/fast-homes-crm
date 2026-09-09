'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { surplusAPI } from '@/lib/api';

/**
 * One of our standard documents, ready to print.
 *
 * Rendered from the active template with this claim's names filled in.
 * "Mark drafted" records on the claim which template version the copy was
 * built from, which is what lets the panel flag it stale once the wording
 * is revised. Legal kinds carry a reminder that the text is counsel's and
 * the page only fills names in.
 */

interface Draft {
  docKind: string;
  kind: string;
  label: string;
  version: number;
  versionLabel: string;
  hasText: boolean;
  legal: boolean;
  body: string;
  unfilled: string[];
  claimant: string;
  propertyAddress: string;
  sender: { companyName: string; phone: string; website: string | null };
  today: string;
}

function DocumentPage() {
  const params = useSearchParams();
  const leadId = params.get('lead') || '';
  const kind = params.get('kind') || '';

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!leadId || !kind) {
      setError('No claimant or document kind given.');
      return;
    }
    surplusAPI
      .documentDraft(leadId, kind)
      .then((r) => setDraft(r.data))
      .catch((e) => setError(e?.response?.data?.message || 'The document could not be built.'));
  }, [leadId, kind]);

  const record = async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      await surplusAPI.setDocumentStatus(leadId, draft.docKind, {
        status: 'drafted',
        templateKind: draft.kind,
        templateVersion: draft.version,
      });
      setRecorded(true);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'The document could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="p-8 text-sm text-red-600">{error}</p>;
  if (!draft) return <p className="p-8 text-sm text-gray-500">Building the document...</p>;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; min-height: 0 !important; }
          @page { margin: 1in; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap items-center gap-3">
        <div className="text-sm">
          <span className="font-semibold text-gray-900">{draft.label}</span>
          <span className="text-gray-500"> · {draft.versionLabel} · {draft.claimant}</span>
        </div>
        {!draft.hasText && (
          <span className="text-xs text-red-600">
            {draft.legal
              ? 'No approved text yet. Paste the version from counsel in Settings, Surplus Scripts and Letters.'
              : 'This document has no text yet. Write it in Settings, Surplus Scripts and Letters.'}
          </span>
        )}
        {draft.unfilled.length > 0 && (
          <span className="text-xs text-amber-700">Could not fill: {draft.unfilled.join(', ')}. Fix the file before using this.</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => window.print()}
            disabled={!draft.hasText}
            className="h-9 px-4 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            Print
          </button>
          {recorded ? (
            <span className="text-sm font-medium text-green-700">Recorded as drafted from {draft.versionLabel}</span>
          ) : (
            <button
              onClick={record}
              disabled={busy || !draft.hasText || draft.unfilled.length > 0}
              title="Record on the claim that this document was drafted from the template version on the page"
              className="h-9 px-4 rounded-lg border border-primary-600 text-primary-700 text-sm font-medium hover:bg-primary-50 disabled:opacity-50"
            >
              {busy ? 'Saving...' : 'Mark drafted'}
            </button>
          )}
        </div>
      </div>

      <div className="sheet mx-auto my-8 bg-white shadow-lg w-[8.5in] min-h-[11in] px-[1in] py-[1in] text-[12pt] leading-[1.5] text-gray-900 font-serif">
        <div className="flex items-baseline justify-between border-b border-gray-300 pb-3 mb-8">
          <div>
            <div className="text-[16pt] font-semibold tracking-tight">{draft.sender.companyName}</div>
            <div className="text-[10pt] text-gray-600">
              {draft.sender.phone}
              {draft.sender.website ? ` · ${draft.sender.website}` : ''}
            </div>
          </div>
          <div className="text-[10pt] text-gray-600 text-right">
            <div>{draft.label}</div>
            <div>{draft.propertyAddress}</div>
          </div>
        </div>
        <pre className="whitespace-pre-wrap font-serif text-[12pt] leading-[1.5]">{draft.body}</pre>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-gray-500">Building the document...</p>}>
      <DocumentPage />
    </Suspense>
  );
}
