'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { dispoAPI, boldSignAPI } from '@/lib/api';
import { format } from 'date-fns';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DispoSummary {
  arv: number | null;
  repairCost: number | null;
  mao: number | null;
  maoPercent: number | null;
  askingPrice: number | null;
  offerAmount: number | null;
  assignmentFee: number | null;
  leadAssignmentFee: number | null;
  buyerPrice: number | null;
  buyerSpread: number | null;
  projectedProfit: number | null;
  contract: Contract | null;
  offers: Offer[];
  latestCompAnalysis: {
    repairCosts: number | null;
    assignmentFee: number | null;
    arvEstimate: number | null;
    dealType: string;
    repairNotes: string | null;
  } | null;
}

interface Contract {
  id: string;
  contractStatus: string;
  exitStrategy: string;
  offerAmount: number | null;
  earnestMoney: number | null;
  inspectionPeriodDays: number | null;
  sellerFinancing: boolean;
  contractDate: string | null;
  buyerName: string | null;
  assignmentFee: number | null;
  titleCompany: string | null;
  expectedCloseDate: string | null;
  actualCloseDate: string | null;
  dispositionNotes: string | null;
  outcome: string | null;
  boldsignDocumentId?: string | null;
  boldsignStatus?: string | null;
  boldsignSigningUrl?: string | null;
  boldsignSentAt?: string | null;
}

interface Offer {
  id: string;
  offerAmount: number;
  offerDate: string;
  status: string;
  counterAmount: number | null;
  notes: string | null;
  createdAt: string;
}

const fmt = (n: number | null | undefined) =>
  n != null ? `$${Math.round(n).toLocaleString()}` : '—';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400',
  accepted: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400',
  rejected: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400',
  countered: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400',
  withdrawn: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  signed: 'Signed',
  inspection: 'In Inspection',
  'past-inspection': 'Past Inspection',
  'at-title': 'At Title',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DispoTab({
  leadId,
  leadAddress,
}: {
  leadId: string;
  leadAddress: string;
}) {
  const [summary, setSummary] = useState<DispoSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showContractForm, setShowContractForm] = useState(false);
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Contract form state
  const blankContract = {
    contractStatus: 'draft',
    exitStrategy: 'wholesale',
    offerAmount: '',
    earnestMoney: '',
    inspectionPeriodDays: '',
    sellerFinancing: false,
    contractDate: '',
    buyerName: '',
    assignmentFee: '',
    titleCompany: '',
    expectedCloseDate: '',
    dispositionNotes: '',
  };
  const [contractForm, setContractForm] = useState<any>(blankContract);

  // BoldSign state
  const [sendingDoc, setSendingDoc] = useState(false);
  const [docSent, setDocSent] = useState<{ documentId: string; signingUrl: string; title: string } | null>(null);

  // Offer form state
  const [offerForm, setOfferForm] = useState({ offerAmount: '', notes: '', offerDate: '', visibleOnPortal: false, terms: '' });

  const load = useCallback(async () => {
    try {
      const res = await dispoAPI.getSummary(leadId);
      setSummary(res.data);
      if (res.data.contract) {
        const c = res.data.contract;
        setContractForm({
          contractStatus: c.contractStatus ?? 'draft',
          exitStrategy: c.exitStrategy ?? 'wholesale',
          offerAmount: c.offerAmount ?? '',
          earnestMoney: c.earnestMoney ?? '',
          inspectionPeriodDays: c.inspectionPeriodDays ?? '',
          sellerFinancing: c.sellerFinancing ?? false,
          contractDate: c.contractDate ? c.contractDate.slice(0, 10) : '',
          buyerName: c.buyerName ?? '',
          assignmentFee: c.assignmentFee ?? '',
          titleCompany: c.titleCompany ?? '',
          expectedCloseDate: c.expectedCloseDate ? c.expectedCloseDate.slice(0, 10) : '',
          dispositionNotes: c.dispositionNotes ?? '',
        });
        setShowContractForm(true);
      }
    } catch (e) {
      console.error('Failed to load dispo summary', e);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const handleSaveContract = async () => {
    setSaving(true);
    try {
      const payload: any = {
        contractStatus: contractForm.contractStatus,
        exitStrategy: contractForm.exitStrategy,
        sellerFinancing: contractForm.sellerFinancing,
        buyerName: contractForm.buyerName || null,
        titleCompany: contractForm.titleCompany || null,
        dispositionNotes: contractForm.dispositionNotes || null,
      };
      if (contractForm.offerAmount !== '') payload.offerAmount = parseFloat(contractForm.offerAmount);
      if (contractForm.earnestMoney !== '') payload.earnestMoney = parseFloat(contractForm.earnestMoney);
      if (contractForm.inspectionPeriodDays !== '') payload.inspectionPeriodDays = parseInt(contractForm.inspectionPeriodDays);
      if (contractForm.assignmentFee !== '') payload.assignmentFee = parseFloat(contractForm.assignmentFee);
      if (contractForm.contractDate) payload.contractDate = new Date(contractForm.contractDate).toISOString();
      if (contractForm.expectedCloseDate) payload.expectedCloseDate = new Date(contractForm.expectedCloseDate).toISOString();

      await dispoAPI.upsertContract(leadId, payload);
      await load();
    } catch (e) {
      console.error('Failed to save contract', e);
      alert('Failed to save contract details');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateOffer = async () => {
    if (!offerForm.offerAmount) return;
    setSaving(true);
    try {
      await dispoAPI.createOffer(leadId, {
        offerAmount: parseFloat(offerForm.offerAmount),
        notes: offerForm.notes || null,
        offerDate: offerForm.offerDate || undefined,
        visibleOnPortal: offerForm.visibleOnPortal,
        terms: offerForm.terms || null,
      });
      setOfferForm({ offerAmount: '', notes: '', offerDate: '', visibleOnPortal: false, terms: '' });
      setShowOfferForm(false);
      await load();
    } catch (e) {
      console.error('Failed to create offer', e);
      alert('Failed to create offer');
    } finally {
      setSaving(false);
    }
  };

  const handleOfferAction = async (offerId: string, status: string) => {
    try {
      await dispoAPI.updateOffer(leadId, offerId, { status });
      await load();
    } catch (e) {
      alert('Failed to update offer');
    }
  };

  const handleDeleteOffer = async (offerId: string) => {
    if (!confirm('Delete this offer?')) return;
    try {
      await dispoAPI.deleteOffer(leadId, offerId);
      await load();
    } catch (e) {
      alert('Failed to delete offer');
    }
  };

  if (loading) {
    return <div className="card text-center py-12 text-gray-400 dark:text-gray-500">Loading dispo data...</div>;
  }

  const s = summary!;

  return (
    <div className="space-y-6">

      {/* ── Exit Strategy ─────────────────────────────────────────────────── */}
      <ExitStrategyCosts
        leadId={leadId}
        arv={s.arv}
        repairCost={s.repairCost}
        offerAmount={s.offerAmount}
        assignmentFee={s.assignmentFee}
        defaultStrategy={s.contract?.exitStrategy ?? 'wholesale'}
        onSaved={load}
      />

      {/* ── Offer Tracker ─────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Offer History</h2>
          <button
            onClick={() => setShowOfferForm((v) => !v)}
            className="btn btn-primary btn-sm"
          >
            {showOfferForm ? 'Cancel' : '+ Add Offer'}
          </button>
        </div>

        {/* Add offer inline form */}
        {showOfferForm && (
          <div className="mb-5 p-4 bg-gray-50 dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">New Offer</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Offer Amount *</label>
                <input
                  type="number"
                  value={offerForm.offerAmount}
                  onChange={(e) => setOfferForm((f) => ({ ...f, offerAmount: e.target.value }))}
                  className="input w-full"
                  placeholder="140000"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date</label>
                <input
                  type="date"
                  value={offerForm.offerDate}
                  onChange={(e) => setOfferForm((f) => ({ ...f, offerDate: e.target.value }))}
                  className="input w-full"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
              <input
                type="text"
                value={offerForm.notes}
                onChange={(e) => setOfferForm((f) => ({ ...f, notes: e.target.value }))}
                className="input w-full"
                placeholder="Any context about this offer..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Terms for Seller</label>
              <textarea
                value={offerForm.terms}
                onChange={(e) => setOfferForm((f) => ({ ...f, terms: e.target.value }))}
                className="input w-full"
                rows={3}
                placeholder="Cash offer, close in 30 days, no repairs needed..."
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="visibleOnPortal"
                checked={offerForm.visibleOnPortal}
                onChange={(e) => setOfferForm((f) => ({ ...f, visibleOnPortal: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="visibleOnPortal" className="text-xs text-gray-600 dark:text-gray-400">
                Show on Seller Portal (seller can accept/decline)
              </label>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleCreateOffer} disabled={saving || !offerForm.offerAmount} className="btn btn-primary btn-sm">
                {saving ? 'Saving...' : 'Save Offer'}
              </button>
              <button onClick={() => setShowOfferForm(false)} className="btn btn-secondary btn-sm">Cancel</button>
            </div>
          </div>
        )}

        {s.offers.length === 0 ? (
          <div className="py-8 text-center space-y-3">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              No offers yet.
            </div>
            {s.mao && s.mao > 0 ? (
              <button
                onClick={() => {
                  setOfferForm((f) => ({ ...f, offerAmount: String(Math.round(s.mao!)) }));
                  setShowOfferForm(true);
                }}
                className="btn btn-primary btn-sm"
              >
                Create offer at MAO {fmt(s.mao)}
              </button>
            ) : (
              <button onClick={() => setShowOfferForm(true)} className="btn btn-primary btn-sm">
                + Add offer
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {s.offers.map((offer) => (
              <div key={offer.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900 dark:text-gray-100">{fmt(offer.offerAmount)}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[offer.status] ?? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>
                      {offer.status}
                    </span>
                    {offer.counterAmount && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">Counter: {fmt(offer.counterAmount)}</span>
                    )}
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {format(new Date(offer.offerDate), 'MMM d, yyyy')}
                    </span>
                  </div>
                  {offer.notes && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{offer.notes}</p>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {offer.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleOfferAction(offer.id, 'accepted')}
                        className="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 hover:bg-green-200 font-medium"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleOfferAction(offer.id, 'rejected')}
                        className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 font-medium"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleDeleteOffer(offer.id)}
                    className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Contract Details ──────────────────────────────────────────────── */}
      {(() => {
        const hasAcceptedOffer = s.offers.some((o) => o.status === 'accepted');
        const canCreate = hasAcceptedOffer || !!s.contract;
        return (
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Contract Details</h2>
          {!showContractForm && (
            <button
              onClick={() => setShowContractForm(true)}
              disabled={!canCreate}
              title={canCreate ? undefined : 'Accept an offer first to create a contract'}
              className="btn btn-primary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Create Contract
            </button>
          )}
        </div>

        {!showContractForm ? (
          <div className="py-6 text-center space-y-2">
            <p className="text-sm text-gray-400 dark:text-gray-500">
              {hasAcceptedOffer
                ? 'No contract yet. Click "+ Create Contract" to start one.'
                : 'Accept an offer first — contract creation unlocks once a seller accepts.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Status */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Contract Status</label>
                <select
                  value={contractForm.contractStatus}
                  onChange={(e) => setContractForm((f: any) => ({ ...f, contractStatus: e.target.value }))}
                  className="input w-full"
                >
                  {Object.entries(CONTRACT_STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              {/* Exit Strategy */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Exit Strategy</label>
                <select
                  value={contractForm.exitStrategy}
                  onChange={(e) => setContractForm((f: any) => ({ ...f, exitStrategy: e.target.value }))}
                  className="input w-full"
                >
                  <option value="wholesale">Wholesale</option>
                  <option value="novation">Novation</option>
                  <option value="flip">Fix &amp; Flip</option>
                  <option value="wholetail">Wholetail</option>
                  <option value="subject-to">Subject-To</option>
                  <option value="creative">Creative Finance</option>
                  <option value="joint_venture">Joint Venture</option>
                  <option value="concierge_listing">Concierge Listing</option>
                </select>
              </div>
              {/* Offer Amount */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Offer to Seller ($)</label>
                <input
                  type="number"
                  value={contractForm.offerAmount}
                  onChange={(e) => setContractForm((f: any) => ({ ...f, offerAmount: e.target.value }))}
                  className="input w-full"
                  placeholder="140000"
                />
              </div>
              {/* Assignment Fee */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Assignment Fee ($)</label>
                <input
                  type="number"
                  value={contractForm.assignmentFee}
                  onChange={(e) => setContractForm((f: any) => ({ ...f, assignmentFee: e.target.value }))}
                  className="input w-full"
                  placeholder="15000"
                />
              </div>
              {/* EMD */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Earnest Money Deposit ($)</label>
                <input
                  type="number"
                  value={contractForm.earnestMoney}
                  onChange={(e) => setContractForm((f: any) => ({ ...f, earnestMoney: e.target.value }))}
                  className="input w-full"
                  placeholder="1000"
                />
              </div>
              {/* Inspection Period */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Inspection Period (days)</label>
                <input
                  type="number"
                  value={contractForm.inspectionPeriodDays}
                  onChange={(e) => setContractForm((f: any) => ({ ...f, inspectionPeriodDays: e.target.value }))}
                  className="input w-full"
                  placeholder="10"
                />
              </div>
              {/* Contract Date */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Contract Date</label>
                <input
                  type="date"
                  value={contractForm.contractDate}
                  onChange={(e) => setContractForm((f: any) => ({ ...f, contractDate: e.target.value }))}
                  className="input w-full"
                />
              </div>
              {/* Expected Close */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Expected Close Date</label>
                <input
                  type="date"
                  value={contractForm.expectedCloseDate}
                  onChange={(e) => setContractForm((f: any) => ({ ...f, expectedCloseDate: e.target.value }))}
                  className="input w-full"
                />
              </div>
              {/* Buyer Name */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Buyer Name</label>
                <input
                  type="text"
                  value={contractForm.buyerName}
                  onChange={(e) => setContractForm((f: any) => ({ ...f, buyerName: e.target.value }))}
                  className="input w-full"
                  placeholder="End buyer's name or company"
                />
              </div>
              {/* Title Company */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Title Company</label>
                <input
                  type="text"
                  value={contractForm.titleCompany}
                  onChange={(e) => setContractForm((f: any) => ({ ...f, titleCompany: e.target.value }))}
                  className="input w-full"
                  placeholder="Title company name"
                />
              </div>
            </div>

            {/* Seller Financing */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="sellerFinancing"
                checked={contractForm.sellerFinancing}
                onChange={(e) => setContractForm((f: any) => ({ ...f, sellerFinancing: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-primary-600"
              />
              <label htmlFor="sellerFinancing" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Seller Financing involved
              </label>
            </div>

            {/* Disposition Notes */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Disposition Notes</label>
              <textarea
                value={contractForm.dispositionNotes}
                onChange={(e) => setContractForm((f: any) => ({ ...f, dispositionNotes: e.target.value }))}
                className="input w-full"
                rows={3}
                placeholder="Notes about the deal, buyer details, title issues, etc."
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={handleSaveContract} disabled={saving} className="btn btn-primary">
                {saving ? 'Saving...' : 'Save Contract Details'}
              </button>
              {!s.contract && (
                <button onClick={() => setShowContractForm(false)} className="btn btn-secondary">
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>
        );
      })()}

      {/* ── E-Signature via BoldSign ──────────────────────────────────────── */}
      <div className="card border border-indigo-200 dark:border-indigo-800">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xl">✍️</span>
          <div>
            <h2 className="text-xl font-bold">Send for Signature</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Send documents for e-signature via BoldSign</p>
          </div>
          {s.contract?.boldsignStatus && (
            <span className={`ml-auto text-xs font-semibold px-2 py-1 rounded-full ${
              s.contract.boldsignStatus === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400' :
              s.contract.boldsignStatus === 'declined' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
              'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400'
            }`}>
              {s.contract.boldsignStatus === 'completed' ? '✓ Signed' :
               s.contract.boldsignStatus === 'declined' ? '✕ Declined' : '⏳ Pending Signature'}
            </span>
          )}
        </div>

        {/* Show previously sent doc info */}
        {s.contract?.boldsignDocumentId && (
          <div className="mb-4 p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-indigo-900">Document sent for signature</div>
                <div className="text-xs text-indigo-600 mt-0.5">
                  Sent {s.contract.boldsignSentAt ? new Date(s.contract.boldsignSentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                </div>
              </div>
              <button
                onClick={async () => {
                  await boldSignAPI.status(leadId);
                  await load();
                }}
                className="text-xs text-indigo-600 hover:underline"
              >
                Refresh Status
              </button>
            </div>
            {s.contract.boldsignSigningUrl && s.contract.boldsignStatus === 'pending' && (
              <a
                href={s.contract.boldsignSigningUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block text-xs text-indigo-700 hover:underline"
              >
                📎 Direct signing link →
              </a>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={async () => {
              setSendingDoc(true);
              try {
                const res = await boldSignAPI.send(leadId, 'purchase');
                setDocSent(res.data);
                await load();
              } catch (e: any) {
                alert('Failed to send: ' + (e.response?.data?.message || e.message));
              } finally {
                setSendingDoc(false);
              }
            }}
            disabled={sendingDoc}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {sendingDoc ? (
              <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Sending...</>
            ) : (
              <><span>📄</span> Send Purchase Contract</>
            )}
          </button>

          <button
            onClick={async () => {
              setSendingDoc(true);
              try {
                const res = await boldSignAPI.send(leadId, 'aif');
                setDocSent(res.data);
                await load();
              } catch (e: any) {
                alert('Failed to send: ' + (e.response?.data?.message || e.message));
              } finally {
                setSendingDoc(false);
              }
            }}
            disabled={sendingDoc}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-purple-600 text-white font-semibold hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {sendingDoc ? (
              <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Sending...</>
            ) : (
              <><span>📝</span> Send AIF w/ Notary</>
            )}
          </button>
        </div>

        {docSent && (
          <div className="mt-3 p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-400">
            ✓ <strong>{docSent.title}</strong> sent for signature! Seller will receive an email from BoldSign.
          </div>
        )}

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          Seller receives a BoldSign email with a secure signing link. Status updates automatically.
        </p>
      </div>
    </div>
  );
}

// ─── Exit Strategy Costs ─────────────────────────────────────────────────────

const EXIT_COSTS: Record<string, { label: string; agentPct: number; closingPct: number; holdingPct: number; financingPct: number; fixedCosts?: number }> = {
  wholesale:          { label: 'Wholesale',           agentPct: 0, closingPct: 1,   holdingPct: 0, financingPct: 0   },
  novation:           { label: 'Novation',            agentPct: 6, closingPct: 2.5, holdingPct: 2, financingPct: 0   },
  flip:               { label: 'Fix & Flip',          agentPct: 6, closingPct: 3,   holdingPct: 2, financingPct: 3.5 },
  wholetail:          { label: 'Wholetail',           agentPct: 3, closingPct: 2,   holdingPct: 1, financingPct: 1   },
  'subject-to':       { label: 'Subject-To',          agentPct: 6, closingPct: 2.5, holdingPct: 2, financingPct: 0   },
  creative:           { label: 'Creative Finance',    agentPct: 6, closingPct: 2.5, holdingPct: 2, financingPct: 1   },
  joint_venture:      { label: 'Joint Venture',       agentPct: 6, closingPct: 2.5, holdingPct: 2, financingPct: 0   },
  concierge_listing:  { label: 'Concierge Listing',   agentPct: 0, closingPct: 2,   holdingPct: 1, financingPct: 0, fixedCosts: 598 },
};

function ExitStrategyCosts({
  leadId,
  arv,
  repairCost,
  offerAmount,
  assignmentFee,
  defaultStrategy,
  onSaved,
}: {
  leadId: string;
  arv: number | null;
  repairCost: number | null;
  offerAmount: number | null;
  assignmentFee: number | null;
  defaultStrategy: string;
  onSaved: () => void;
}) {
  const [strategy, setStrategy] = React.useState(defaultStrategy);
  const defaults = EXIT_COSTS[strategy] ?? EXIT_COSTS.wholesale;

  const [rates, setRates] = React.useState({
    agentPct: defaults.agentPct,
    closingPct: defaults.closingPct,
    holdingPct: defaults.holdingPct,
    financingPct: defaults.financingPct,
  });

  // Editable assignment fee — use string so the input can be truly empty / zero
  const [feeInput, setFeeInput] = React.useState<string>(
    assignmentFee != null ? String(assignmentFee) : ''
  );
  const editableAssignmentFee = feeInput === '' ? 0 : parseFloat(feeInput) || 0;

  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  const handleStrategyChange = (newStrategy: string) => {
    setStrategy(newStrategy);
    const c = EXIT_COSTS[newStrategy] ?? EXIT_COSTS.wholesale;
    setRates({
      agentPct: c.agentPct,
      closingPct: c.closingPct,
      holdingPct: c.holdingPct,
      financingPct: c.financingPct,
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await dispoAPI.upsertContract(leadId, {
        exitStrategy: strategy,
        assignmentFee: editableAssignmentFee,
      });
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      console.error('Failed to save exit strategy', e);
      alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const fmtC = (n: number | null) => n != null ? `$${Math.round(n).toLocaleString()}` : '—';
  const pctOf = (pct: number) => arv != null ? arv * pct / 100 : null;

  const agentCost     = pctOf(rates.agentPct);
  const closingCost   = pctOf(rates.closingPct);
  const holdingCost   = pctOf(rates.holdingPct);
  const financingCost = pctOf(rates.financingPct);
  const totalPct      = rates.agentPct + rates.closingPct + rates.holdingPct + rates.financingPct;
  const fixedCosts    = EXIT_COSTS[strategy]?.fixedCosts ?? 0;
  const totalCost     = arv != null ? arv * totalPct / 100 + fixedCosts : null;

  // ── Net profit formula ────────────────────────────────────────────────────
  // Wholesale:     (ARV - Purchase Price - Transaction Costs) + Assignment Fee
  //   • Assignment fee is what you charge the end buyer on top of your purchase price
  //   • Spread = ARV - Purchase - Costs is your baseline; assignment fee is your cut
  //   • If you only want the assignment fee as profit, set ARV = Purchase + Costs + Fee
  // Non-wholesale: ARV - Purchase - Repairs - Transaction Costs
  let netProfit: number | null = null;
  if (strategy === 'wholesale') {
    // Wholesale profit = (ARV - purchase - transaction costs) + assignment fee
    // In practice: you lock the property at Purchase, sell the contract for
    // Purchase + AssignmentFee to an end buyer. Your profit IS the assignment fee.
    // But the table should also show that ARV - purchase - costs validates the deal.
    // We show the assignment fee as profit (what you actually pocket), and the ARV
    // spread as context in a sub-row.
    netProfit = editableAssignmentFee;
  } else {
    const purchase = offerAmount ?? 0;
    const repairs  = repairCost ?? 0;
    netProfit = arv != null && totalCost != null
      ? arv - totalCost - repairs - purchase
      : null;
  }

  // Wholesale equity spread (ARV - purchase - costs) shown as context
  const wholesaleSpread = strategy === 'wholesale' && arv != null && totalCost != null
    ? arv - (offerAmount ?? 0) - totalCost
    : null;

  const costRowDefs = [
    { key: 'agentPct'     as const, label: 'Agent Commissions', amount: agentCost },
    { key: 'closingPct'   as const, label: 'Closing Costs',     amount: closingCost },
    { key: 'holdingPct'   as const, label: 'Holding Costs',     amount: holdingCost },
    { key: 'financingPct' as const, label: 'Financing Costs',   amount: financingCost },
  ];

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Exit Strategy</h2>
        <div className="flex items-center gap-2">
          <select
            value={strategy}
            onChange={(e) => handleStrategyChange(e.target.value)}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-gray-800 dark:text-gray-100"
          >
            {Object.entries(EXIT_COSTS).map(([key, c]) => (
              <option key={key} value={key}>{c.label}</option>
            ))}
          </select>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary btn-sm"
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden text-sm mb-3">
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          <div className="col-span-5">Cost Item</div>
          <div className="col-span-3 text-center">Rate</div>
          <div className="col-span-4 text-right">Amount</div>
        </div>

        {/* ARV baseline */}
        {arv != null && (
          <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-blue-50 dark:bg-blue-950">
            <div className="col-span-5 text-blue-800 font-semibold">ARV (Base)</div>
            <div className="col-span-3 text-center text-blue-600">—</div>
            <div className="col-span-4 text-right font-bold text-blue-800">${arv.toLocaleString()}</div>
          </div>
        )}

        {/* Purchase price */}
        <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="col-span-5 text-gray-700 dark:text-gray-300">Purchase / Offer</div>
          <div className="col-span-3 text-center text-gray-400 dark:text-gray-500">—</div>
          <div className="col-span-4 text-right font-semibold text-gray-800 dark:text-gray-200">{fmtC(offerAmount)}</div>
        </div>

        {/* Repairs — non-wholesale only */}
        {strategy !== 'wholesale' && (
          <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <div className="col-span-5 text-gray-700 dark:text-gray-300">Repair Estimate</div>
            <div className="col-span-3 text-center text-gray-400 dark:text-gray-500">—</div>
            <div className="col-span-4 text-right font-semibold text-gray-800 dark:text-gray-200">{fmtC(repairCost)}</div>
          </div>
        )}

        {/* Wholesale Assignment Fee row */}
        {strategy === 'wholesale' && (
          <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-green-50 dark:bg-green-950">
            <div className="col-span-5 text-green-700 dark:text-green-400 font-medium">
              Wholesale Assignment Fee
              {wholesaleSpread != null && (
                <span className="ml-2 text-xs text-gray-400 dark:text-gray-500 font-normal">
                  (max spread: {fmtC(wholesaleSpread)})
                </span>
              )}
            </div>
            <div className="col-span-3 text-center text-gray-400 dark:text-gray-500">—</div>
            <div className="col-span-4 text-right">
              <input
                type="number"
                value={feeInput}
                onChange={(e) => { setFeeInput(e.target.value); setSaved(false); }}
                className="w-28 text-right text-sm border border-green-300 dark:border-green-800 rounded px-2 py-0.5 bg-white dark:bg-gray-900 dark:text-gray-100"
                placeholder="0"
                min="0"
              />
            </div>
          </div>
        )}

        {/* Cost rows — each has an editable rate input */}
        {costRowDefs.map((row) => (
          <div key={row.key} className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
            <div className="col-span-5 text-gray-700 dark:text-gray-300">{row.label}</div>
            <div className="col-span-3 text-center flex items-center justify-center gap-1">
              <input
                type="number"
                value={rates[row.key]}
                onChange={(e) => { setRates((r) => ({ ...r, [row.key]: parseFloat(e.target.value) || 0 })); setSaved(false); }}
                className="w-14 text-center text-sm border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5 dark:bg-gray-800 dark:text-gray-100"
                step="0.5"
                min="0"
                max="20"
              />
              <span className="text-xs text-gray-400 dark:text-gray-500">%</span>
            </div>
            <div className="col-span-4 text-right text-gray-800 dark:text-gray-200">{fmtC(row.amount)}</div>
          </div>
        ))}

        {/* Fixed platform costs — Concierge Listing only */}
        {fixedCosts > 0 && (
          <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <div className="col-span-5 text-gray-700 dark:text-gray-300">
              Platform &amp; Listing Fees
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Homejab photos $249 · Houzeo $249 · Lockbox $100</div>
            </div>
            <div className="col-span-3 text-center text-gray-400 dark:text-gray-500">fixed</div>
            <div className="col-span-4 text-right text-gray-800 dark:text-gray-200">{fmtC(fixedCosts)}</div>
          </div>
        )}

        {/* Total costs */}
        <div className="grid grid-cols-12 gap-2 px-4 py-3 border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-950">
          <div className="col-span-5 font-semibold text-gray-800 dark:text-gray-200">Total Transaction Costs</div>
          <div className="col-span-3 text-center font-semibold text-gray-600 dark:text-gray-400">{totalPct.toFixed(1)}%{fixedCosts > 0 ? ` + $${fixedCosts.toLocaleString()}` : ''}</div>
          <div className="col-span-4 text-right font-bold text-gray-900 dark:text-gray-100">{fmtC(totalCost)}</div>
        </div>

        {/* Net profit — non-JV */}
        {strategy !== 'joint_venture' && (
          <div className={`grid grid-cols-12 gap-2 px-4 py-4 border-t border-gray-200 dark:border-gray-700 ${
            netProfit == null ? 'bg-gray-50 dark:bg-gray-950' :
            netProfit > 0 ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
          }`}>
            <div className={`col-span-5 font-bold text-base ${netProfit == null ? 'text-gray-500 dark:text-gray-400' : netProfit > 0 ? 'text-green-800 dark:text-green-400' : 'text-red-800 dark:text-red-400'}`}>
              {strategy === 'wholesale' ? 'Your Profit (Assignment Fee)' : 'Net Profit'}
            </div>
            <div className="col-span-3 text-center">
              {netProfit != null && arv != null && (
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${netProfit > 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                  {((netProfit / arv) * 100).toFixed(1)}% of ARV
                </span>
              )}
            </div>
            <div className={`col-span-4 text-right font-bold text-lg tabular-nums ${
              netProfit == null ? 'text-gray-400 dark:text-gray-500' : netProfit > 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
            }`}>
              {netProfit != null ? `${netProfit >= 0 ? '+' : ''}$${Math.round(netProfit).toLocaleString()}` : '—'}
            </div>
          </div>
        )}

        {/* Joint Venture split rows */}
        {strategy === 'joint_venture' && (
          <>
            <div className="grid grid-cols-12 gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-purple-50 dark:bg-purple-950">
              <div className="col-span-5 text-purple-700 font-medium">Net Profit (before split)</div>
              <div className="col-span-3 text-center">
                {netProfit != null && arv != null && (
                  <span className="text-xs text-purple-500">{((netProfit / arv) * 100).toFixed(1)}% ARV</span>
                )}
              </div>
              <div className="col-span-4 text-right font-semibold text-purple-700">
                {netProfit != null ? `${netProfit >= 0 ? '+' : ''}$${Math.round(netProfit).toLocaleString()}` : '—'}
              </div>
            </div>
            <div className="grid grid-cols-12 gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-purple-50 dark:bg-purple-950">
              <div className="col-span-5 text-purple-600">JV Partner Share (50%)</div>
              <div className="col-span-3 text-center text-purple-400 text-xs">50%</div>
              <div className="col-span-4 text-right text-purple-700">{netProfit != null ? fmtC(netProfit / 2) : '—'}</div>
            </div>
            <div className={`grid grid-cols-12 gap-2 px-4 py-4 border-t border-purple-200 dark:border-purple-800 ${
              netProfit == null ? 'bg-gray-50 dark:bg-gray-950' : netProfit / 2 > 0 ? 'bg-green-50 dark:bg-green-950' : 'bg-red-50 dark:bg-red-950'
            }`}>
              <div className={`col-span-5 font-bold text-base ${netProfit == null ? 'text-gray-500 dark:text-gray-400' : netProfit / 2 > 0 ? 'text-green-800 dark:text-green-400' : 'text-red-800 dark:text-red-400'}`}>
                Your Share (50%)
              </div>
              <div className="col-span-3 text-center">
                {netProfit != null && arv != null && (
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${netProfit / 2 > 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
                    {((netProfit / 2 / arv) * 100).toFixed(1)}% of ARV
                  </span>
                )}
              </div>
              <div className={`col-span-4 text-right font-bold text-lg tabular-nums ${
                netProfit == null ? 'text-gray-400 dark:text-gray-500' : netProfit / 2 > 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
              }`}>
                {netProfit != null ? `${netProfit / 2 >= 0 ? '+' : ''}$${Math.round(netProfit / 2).toLocaleString()}` : '—'}
              </div>
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        💡 Typical investor costs: agent ~6%, closing 2–4%, holding 1–3%, financing 2–5% = <strong>10–12% of ARV</strong>. Wholesale avoids most of these. Edit any rate to recalculate live.
      </p>
    </div>
  );
}
