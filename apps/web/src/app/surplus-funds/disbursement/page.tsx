'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { surplusAPI } from '@/lib/api';
import { usd } from '@/lib/surplus-money';

/**
 * The disbursement report, ready to print and sign.
 *
 * The course's rule: every expense itemized, the claimant's share and the
 * company's share shown plainly, and the claimant signs it before any money
 * moves. The numbers are live until the claimant's check goes out, then
 * frozen on the claim, so a report printed later matches what was paid.
 */

interface Report {
  claimant: string;
  propertyAddress: string;
  county: string | null;
  caseNumber: string | null;
  checkReceivedAt: string | null;
  checkAmount: number | null;
  feePercentOverride: number | null;
  feePercent: number;
  feeScheduled: boolean;
  feeLabel: string;
  feeSchedule: string;
  capPct: number | null;
  capBasis: string | null;
  expenses: { id: string; kind: string; label: string; amount: number; incurredAt: string; note: string | null }[];
  expensesFromClaimantShare: boolean;
  gross: number;
  fee: number;
  expensesTotal: number;
  claimantShare: number;
  companyShare: number;
  companyNet: number;
  considerationPct: number;
  overCap: boolean;
  frozen: boolean;
  reportSignedAt: string | null;
  clearingDueAt: string | null;
  checkSentAt: string | null;
  company: { name: string; phone: string };
  today: string;
}

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
}

function DisbursementPage() {
  const params = useSearchParams();
  const leadId = params.get('lead') || '';
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedRecorded, setSignedRecorded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!leadId) {
      setError('No claimant given.');
      return;
    }
    surplusAPI
      .disbursementReport(leadId)
      .then((res) => setR(res.data))
      .catch((e) => setError(e?.response?.data?.message || 'The report could not be built.'));
  }, [leadId]);

  const recordSigned = async () => {
    if (!r || busy) return;
    setBusy(true);
    try {
      await surplusAPI.update(leadId, { disbursementReportSignedAt: new Date().toISOString() });
      setSignedRecorded(true);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not record the signature.');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="p-8 text-sm text-red-600">{error}</p>;
  if (!r) return <p className="p-8 text-sm text-gray-500">Building the report...</p>;

  const rows: [string, string][] = [
    ['Surplus received from the county', usd(r.gross)],
    [r.feeScheduled ? `Contingency fee under section 3(d), ${r.feeLabel}` : `Contingency fee, ${r.feePercent}% of the surplus`, `(${usd(r.fee)})`],
  ];

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
          <span className="font-semibold text-gray-900">Disbursement report</span>
          <span className="text-gray-500"> · {r.claimant}{r.frozen ? ' · final' : ' · draft, live numbers'}</span>
        </div>
        {!r.checkAmount && <span className="text-xs text-red-600">No check amount recorded yet.</span>}
        {r.overCap && (
          <span className="text-xs text-red-600">
            Fee plus expenses passed to the claimant is {r.considerationPct}% of the check, over the {r.capPct}% cap. Fix this before it is signed.
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => window.print()} className="h-9 px-4 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700">
            Print
          </button>
          {r.reportSignedAt || signedRecorded ? (
            <span className="text-sm font-medium text-green-700">Signed by the claimant {r.reportSignedAt ? fmt(r.reportSignedAt) : 'today'}</span>
          ) : (
            <button
              onClick={recordSigned}
              disabled={busy || !r.checkAmount || r.overCap}
              title="Record that the claimant signed this report today"
              className="h-9 px-4 rounded-lg border border-primary-600 text-primary-700 text-sm font-medium hover:bg-primary-50 disabled:opacity-50"
            >
              {busy ? 'Saving...' : 'Claimant signed'}
            </button>
          )}
        </div>
      </div>

      <div className="sheet mx-auto my-8 bg-white shadow-lg w-[8.5in] min-h-[11in] px-[1in] py-[1in] text-[12pt] leading-[1.5] text-gray-900 font-serif">
        <div className="flex items-baseline justify-between border-b border-gray-300 pb-3 mb-6">
          <div>
            <div className="text-[16pt] font-semibold tracking-tight">{r.company.name}</div>
            <div className="text-[10pt] text-gray-600">{r.company.phone}</div>
          </div>
          <div className="text-[10pt] text-gray-600 text-right">
            <div>Disbursement report</div>
            <div>{r.today}</div>
          </div>
        </div>

        <div className="text-[11pt] mb-6">
          <div><span className="text-gray-600">Claimant:</span> {r.claimant}</div>
          <div><span className="text-gray-600">Property:</span> {r.propertyAddress}</div>
          <div>
            <span className="text-gray-600">Matter:</span> {r.county ? `${r.county} County` : ''}{r.caseNumber ? `, case ${r.caseNumber}` : ''}
          </div>
          <div><span className="text-gray-600">Surplus received:</span> {fmt(r.checkReceivedAt) || 'not yet'}</div>
        </div>

        <table className="w-full text-[11.5pt] border-collapse">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b border-gray-200">
                <td className="py-1.5">{k}</td>
                <td className="py-1.5 text-right tabular-nums">{v}</td>
              </tr>
            ))}
            {r.expenses.length > 0 && (
              <tr>
                <td colSpan={2} className="pt-3 pb-1 text-[10pt] uppercase tracking-wide text-gray-600">
                  Expenses{r.expensesFromClaimantShare ? ', deducted from the claimant’s share' : ', borne by the company'}
                </td>
              </tr>
            )}
            {r.expenses.map((e) => (
              <tr key={e.id} className="border-b border-gray-100">
                <td className="py-1 pl-4">
                  {e.label}
                  {e.note ? <span className="text-gray-600"> ({e.note})</span> : null}
                  <span className="text-gray-500 text-[10pt]"> {fmt(e.incurredAt)}</span>
                </td>
                <td className="py-1 text-right tabular-nums">{r.expensesFromClaimantShare ? `(${usd(e.amount)})` : usd(e.amount)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-800">
              <td className="py-2 font-semibold">Paid to {r.claimant}</td>
              <td className="py-2 text-right font-semibold tabular-nums">{usd(r.claimantShare)}</td>
            </tr>
            <tr>
              <td className="py-1">Retained by {r.company.name}</td>
              <td className="py-1 text-right tabular-nums">{usd(r.companyShare)}</td>
            </tr>
          </tbody>
        </table>

        <p className="mt-6 text-[10.5pt] text-gray-700">
          Total consideration to {r.company.name} is {r.considerationPct}% of the surplus
          {r.capPct != null ? `, within the ${r.capPct}% permitted by Florida law` : ', under the schedule in section 3(d) of the agreement'}.
          {r.clearingDueAt ? ` Funds are released after the county’s check clears, on or after ${fmt(r.clearingDueAt)}.` : ''}
        </p>

        <div className="mt-12 grid grid-cols-2 gap-12 text-[11pt]">
          <div>
            <div className="border-b border-gray-800 h-8" />
            <div className="mt-1">{r.claimant}, claimant</div>
            <div className="text-gray-600 text-[10pt]">Date</div>
          </div>
          <div>
            <div className="border-b border-gray-800 h-8" />
            <div className="mt-1">For {r.company.name}</div>
            <div className="text-gray-600 text-[10pt]">Date</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-gray-500">Building the report...</p>}>
      <DisbursementPage />
    </Suspense>
  );
}
