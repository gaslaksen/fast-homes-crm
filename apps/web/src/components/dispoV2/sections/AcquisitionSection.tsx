'use client';

import React, { useState } from 'react';
import { dispoAPI, dispositionAPI, boldSignAPI } from '@/lib/api';
import { DispoSummaryV2, FUNDING_SOURCES } from '../types';
import { fmtCurrency, fmtDate, numOrNull } from '../utils';

interface Props {
  leadId: string;
  summary: DispoSummaryV2;
  onChanged: () => Promise<void> | void;
}

const STATUS_CLS: Record<string, string> = {
  pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400',
  accepted: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400',
  rejected: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400',
  countered: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400',
  withdrawn: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};

// Section A: full acquisition lifecycle.
// 1. Current offer summary (drives bug #1 fix — pending offers show here).
// 2. Offer history with quick accept/reject/withdraw actions.
// 3. Contract details (extends legacy fields with new acq closing costs,
//    funding source, acquiredAt; assignmentFee uses numOrNull to fix
//    bug #2 — blank field used to write NaN silently).
// 4. Mark Acquired button (server validates contract.contractStatus = 'signed').
// 5. BoldSign send/sync passthrough — same endpoints as legacy.
export default function AcquisitionSection({ leadId, summary, onChanged }: Props) {
  const contract = summary.contract ?? {};
  const acceptedOffer = summary.acceptedOffer;
  const pendingOffer = summary.pendingOffer;
  const currentOffer = acceptedOffer ?? pendingOffer ?? null;

  // ── Offer form ──────────────────────────────────────────────────────────
  const [showOfferForm, setShowOfferForm] = useState(summary.offers.length === 0);
  const [offerAmount, setOfferAmount] = useState('');
  const [offerNotes, setOfferNotes] = useState('');
  const [visibleOnPortal, setVisibleOnPortal] = useState(true);
  const [savingOffer, setSavingOffer] = useState(false);
  const [offerErr, setOfferErr] = useState<string | null>(null);

  const addOffer = async () => {
    setOfferErr(null);
    const amt = numOrNull(offerAmount);
    if (amt == null || amt <= 0) { setOfferErr('Offer amount required'); return; }
    setSavingOffer(true);
    try {
      await dispoAPI.createOffer(leadId, { offerAmount: amt, notes: offerNotes || null, visibleOnPortal });
      setOfferAmount('');
      setOfferNotes('');
      setVisibleOnPortal(true);
      setShowOfferForm(false);
      await onChanged();
    } catch (e: any) {
      setOfferErr(e.response?.data?.message || 'Failed to add offer');
    } finally {
      setSavingOffer(false);
    }
  };

  const setOfferStatus = async (offerId: string, status: string) => {
    try {
      await dispoAPI.updateOffer(leadId, offerId, { status });
      await onChanged();
    } catch {
      // ignore
    }
  };

  const setOfferPortalVisible = async (offerId: string, next: boolean) => {
    try {
      await dispoAPI.updateOffer(leadId, offerId, { visibleOnPortal: next });
      await onChanged();
    } catch {
      // ignore
    }
  };

  // ── Contract form ───────────────────────────────────────────────────────
  const [contractStatus, setContractStatus] = useState<string>(contract.contractStatus ?? 'draft');
  const [cOfferAmount, setCOfferAmount] = useState(contract.offerAmount != null ? String(contract.offerAmount) : '');
  const [earnestMoney, setEarnestMoney] = useState(contract.earnestMoney != null ? String(contract.earnestMoney) : '');
  const [assignmentFee, setAssignmentFee] = useState(contract.assignmentFee != null ? String(contract.assignmentFee) : '');
  const [titleCompany, setTitleCompany] = useState(contract.titleCompany ?? '');
  const [contractDate, setContractDate] = useState(contract.contractDate ? contract.contractDate.slice(0, 10) : '');
  const [expectedCloseDate, setExpectedCloseDate] = useState(contract.expectedCloseDate ? contract.expectedCloseDate.slice(0, 10) : '');
  // New disposition v2 fields
  const [acquisitionClosingCosts, setAcquisitionClosingCosts] = useState(
    contract.acquisitionClosingCosts != null ? String(contract.acquisitionClosingCosts) : '',
  );
  const [fundingSource, setFundingSource] = useState<string>(contract.fundingSource ?? 'cash');
  const [savingContract, setSavingContract] = useState(false);
  const [contractErr, setContractErr] = useState<string | null>(null);

  const saveContract = async () => {
    setContractErr(null);
    setSavingContract(true);
    try {
      await dispoAPI.upsertContract(leadId, {
        contractStatus,
        offerAmount: numOrNull(cOfferAmount),
        earnestMoney: numOrNull(earnestMoney),
        assignmentFee: numOrNull(assignmentFee),       // ← bug #2 fix: '' → null instead of NaN
        titleCompany: titleCompany || null,
        contractDate: contractDate || null,
        expectedCloseDate: expectedCloseDate || null,
        acquisitionClosingCosts: numOrNull(acquisitionClosingCosts),
        fundingSource,
      });
      await onChanged();
    } catch (e: any) {
      setContractErr(e.response?.data?.message || 'Failed to save contract');
    } finally {
      setSavingContract(false);
    }
  };

  // ── Mark Acquired ───────────────────────────────────────────────────────
  const [marking, setMarking] = useState(false);
  const canMarkAcquired = contract.contractStatus === 'signed' && !summary.acquiredDate;
  const markAcquired = async () => {
    setMarking(true);
    try {
      await dispositionAPI.markAcquired(leadId);
      await onChanged();
    } catch (e: any) {
      setContractErr(e.response?.data?.message || 'Failed to mark acquired');
    } finally {
      setMarking(false);
    }
  };

  // ── BoldSign ────────────────────────────────────────────────────────────
  const [boldSending, setBoldSending] = useState(false);
  const [boldSyncing, setBoldSyncing] = useState(false);
  const sendForSignature = async () => {
    setBoldSending(true);
    try {
      await boldSignAPI.send(leadId, 'purchase');
      await onChanged();
    } catch (e: any) {
      setContractErr(e.response?.data?.message || 'Failed to send for signature');
    } finally {
      setBoldSending(false);
    }
  };
  const syncSignatureStatus = async () => {
    setBoldSyncing(true);
    try {
      await boldSignAPI.status(leadId);
      await onChanged();
    } catch {
      // ignore
    } finally {
      setBoldSyncing(false);
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white">Acquisition</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {summary.acquiredDate ? `Acquired ${fmtDate(summary.acquiredDate)}` : contract.contractStatus ? `Contract: ${contract.contractStatus}` : 'No contract yet'}
        </span>
      </div>

      {/* Current offer summary — surfaces pending offers per bug #1 */}
      {currentOffer ? (
        <div className="mb-4 flex items-center gap-3">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Current Offer</div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {fmtCurrency(currentOffer.offerAmount)}
              <span className={`ml-2 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full ${STATUS_CLS[currentOffer.status] ?? STATUS_CLS.pending}`}>
                {currentOffer.status}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">No offers yet.</div>
      )}

      {/* Offer history */}
      {summary.offers.length > 0 && (
        <div className="mb-4 border border-gray-100 dark:border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-950 text-gray-500 dark:text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Amount</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {summary.offers.map((o) => (
                <tr key={o.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2 font-mono text-gray-900 dark:text-white">{fmtCurrency(o.offerAmount)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full ${STATUS_CLS[o.status] ?? STATUS_CLS.pending}`}>
                      {o.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{fmtDate(o.offerDate)}</td>
                  <td className="px-3 py-2 text-right space-x-2">
                    {o.status === 'pending' && (
                      <>
                        <button
                          onClick={() => setOfferPortalVisible(o.id, !o.visibleOnPortal)}
                          className="text-xs text-blue-600 hover:text-blue-800"
                          title={o.visibleOnPortal ? 'Hide this offer from the seller portal' : 'Show this offer on the seller portal'}
                        >
                          {o.visibleOnPortal ? 'Hide from portal' : 'Show on portal'}
                        </button>
                        <button onClick={() => setOfferStatus(o.id, 'accepted')} className="text-xs text-green-600 hover:text-green-800">Accept</button>
                        <button onClick={() => setOfferStatus(o.id, 'rejected')} className="text-xs text-red-500 hover:text-red-700">Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add offer */}
      {showOfferForm ? (
        <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-3 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              type="number"
              placeholder="Offer amount"
              value={offerAmount}
              onChange={(e) => setOfferAmount(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
            <input
              type="text"
              placeholder="Notes (optional)"
              value={offerNotes}
              onChange={(e) => setOfferNotes(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={visibleOnPortal}
              onChange={(e) => setVisibleOnPortal(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Show on Seller Portal (seller can accept/decline)
          </label>
          {offerErr && <div className="text-xs text-red-600 dark:text-red-400">{offerErr}</div>}
          <div className="flex gap-2">
            <button onClick={addOffer} disabled={savingOffer} className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
              {savingOffer ? 'Adding…' : 'Add Offer'}
            </button>
            <button onClick={() => setShowOfferForm(false)} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowOfferForm(true)} className="mb-4 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          + Add offer
        </button>
      )}

      {/* Contract details */}
      <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-4">
        <h4 className="font-medium text-gray-900 dark:text-white mb-3">Contract Details</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">Status</span>
            <select
              value={contractStatus}
              onChange={(e) => setContractStatus(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              <option value="draft">Draft</option>
              <option value="signed">Signed</option>
              <option value="inspection">In Inspection</option>
              <option value="past-inspection">Past Inspection</option>
              <option value="at-title">At Title</option>
              <option value="closed">Closed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">Purchase Price (offer to seller)</span>
            <input
              type="number"
              value={cOfferAmount}
              onChange={(e) => setCOfferAmount(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">Earnest Money</span>
            <input
              type="number"
              value={earnestMoney}
              onChange={(e) => setEarnestMoney(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">Assignment Fee (wholesale)</span>
            <input
              type="number"
              value={assignmentFee}
              onChange={(e) => setAssignmentFee(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">Acquisition Closing Costs</span>
            <input
              type="number"
              value={acquisitionClosingCosts}
              onChange={(e) => setAcquisitionClosingCosts(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">Funding Source</span>
            <select
              value={fundingSource}
              onChange={(e) => setFundingSource(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              {FUNDING_SOURCES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">Title Company</span>
            <input
              type="text"
              value={titleCompany}
              onChange={(e) => setTitleCompany(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">Contract Date</span>
            <input
              type="date"
              value={contractDate}
              onChange={(e) => setContractDate(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-600 dark:text-gray-400">Expected Close Date</span>
            <input
              type="date"
              value={expectedCloseDate}
              onChange={(e) => setExpectedCloseDate(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </label>
        </div>

        {contractErr && <div className="mt-3 text-sm text-red-600 dark:text-red-400">{contractErr}</div>}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={saveContract}
            disabled={savingContract}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {savingContract ? 'Saving…' : 'Save Contract'}
          </button>
          {canMarkAcquired && (
            <button
              onClick={markAcquired}
              disabled={marking}
              className="px-3 py-1.5 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 rounded-lg disabled:opacity-50"
            >
              {marking ? 'Marking…' : 'Mark Acquired'}
            </button>
          )}
          {!contract.boldsignDocumentId ? (
            <button
              onClick={sendForSignature}
              disabled={boldSending}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              {boldSending ? 'Sending…' : 'Send for Signature (BoldSign)'}
            </button>
          ) : (
            <button
              onClick={syncSignatureStatus}
              disabled={boldSyncing}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              {boldSyncing ? 'Syncing…' : `Sync Signature Status (${contract.boldsignStatus ?? 'pending'})`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
