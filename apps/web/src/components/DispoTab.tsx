'use client';

import { useState, useEffect, useCallback } from 'react';
import { dispoAPI } from '@/lib/api';
import { format } from 'date-fns';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DispoSummary {
  arv: number | null;
  repairCost: number | null;
  mao: number | null;
  askingPrice: number | null;
  offerAmount: number | null;
  assignmentFee: number | null;
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
  pending: 'bg-yellow-100 text-yellow-800',
  accepted: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  countered: 'bg-blue-100 text-blue-800',
  withdrawn: 'bg-gray-100 text-gray-500',
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

  // Offer form state
  const [offerForm, setOfferForm] = useState({ offerAmount: '', notes: '', offerDate: '' });

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
      });
      setOfferForm({ offerAmount: '', notes: '', offerDate: '' });
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
    return <div className="card text-center py-12 text-gray-400">Loading dispo data...</div>;
  }

  const s = summary!;

  return (
    <div className="space-y-6">

      {/* ── Deal Numbers ─────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold">Deal Numbers</h2>
          {s.contract && (
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
              s.contract.contractStatus === 'closed' ? 'bg-green-100 text-green-800' :
              s.contract.contractStatus === 'cancelled' ? 'bg-red-100 text-red-700' :
              s.contract.contractStatus === 'signed' ? 'bg-blue-100 text-blue-800' :
              'bg-yellow-100 text-yellow-800'
            }`}>
              {CONTRACT_STATUS_LABELS[s.contract.contractStatus] ?? s.contract.contractStatus}
            </span>
          )}
        </div>

        {!s.arv && (
          <div className="mb-5 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
            ⚠️ No ARV on file.{' '}
            <Link href={`/leads/${leadId}/comps-analysis`} className="font-semibold underline">
              Run comps analysis
            </Link>{' '}
            to populate deal numbers.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 rounded-xl border border-gray-200 overflow-hidden text-sm">
          <DealRow label="ARV (After Repair Value)" value={fmt(s.arv)} muted={!s.arv} />
          <DealRow label="Repair Estimate" value={fmt(s.repairCost)} muted={!s.repairCost}
            sub={s.latestCompAnalysis?.repairNotes ?? undefined} />
          <DealRow
            label="MAO (70% Rule)"
            value={fmt(s.mao)}
            highlight={
              s.mao != null && s.offerAmount != null
                ? s.offerAmount <= s.mao ? 'green' : 'red'
                : undefined
            }
            sub={s.mao != null ? `ARV × 70% − repairs` : undefined}
          />
          <DealRow label="Seller Asking Price" value={fmt(s.askingPrice)} muted={!s.askingPrice} divider />
          <DealRow label="Offer to Seller" value={fmt(s.offerAmount)} bold muted={!s.offerAmount} />
          <DealRow label="Assignment Fee" value={fmt(s.assignmentFee)} bold muted={!s.assignmentFee} />
          <DealRow label="Buyer's All-In Price" value={fmt(s.buyerPrice)} divider />
          <DealRow label="Buyer's Spread" value={fmt(s.buyerSpread)}
            highlight={s.buyerSpread != null ? (s.buyerSpread > 0 ? 'green' : 'red') : undefined} />
          <DealRow
            label="Your Profit"
            value={fmt(s.projectedProfit)}
            bold
            highlight={s.projectedProfit != null ? (s.projectedProfit > 0 ? 'green' : 'red') : undefined}
          />
        </div>
      </div>

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
          <div className="mb-5 p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
            <h4 className="text-sm font-semibold text-gray-700">New Offer</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Offer Amount *</label>
                <input
                  type="number"
                  value={offerForm.offerAmount}
                  onChange={(e) => setOfferForm((f) => ({ ...f, offerAmount: e.target.value }))}
                  className="input w-full"
                  placeholder="140000"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                <input
                  type="date"
                  value={offerForm.offerDate}
                  onChange={(e) => setOfferForm((f) => ({ ...f, offerDate: e.target.value }))}
                  className="input w-full"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <input
                type="text"
                value={offerForm.notes}
                onChange={(e) => setOfferForm((f) => ({ ...f, notes: e.target.value }))}
                className="input w-full"
                placeholder="Any context about this offer..."
              />
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
          <p className="text-sm text-gray-400 text-center py-6">No offers yet. Click "+ Add Offer" to track your first offer.</p>
        ) : (
          <div className="space-y-2">
            {s.offers.map((offer) => (
              <div key={offer.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-200">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900">{fmt(offer.offerAmount)}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[offer.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {offer.status}
                    </span>
                    {offer.counterAmount && (
                      <span className="text-xs text-gray-500">Counter: {fmt(offer.counterAmount)}</span>
                    )}
                    <span className="text-xs text-gray-400">
                      {format(new Date(offer.offerDate), 'MMM d, yyyy')}
                    </span>
                  </div>
                  {offer.notes && <p className="text-xs text-gray-500 mt-1">{offer.notes}</p>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {offer.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleOfferAction(offer.id, 'accepted')}
                        className="text-xs px-2 py-1 rounded bg-green-100 text-green-800 hover:bg-green-200 font-medium"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleOfferAction(offer.id, 'rejected')}
                        className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 font-medium"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleDeleteOffer(offer.id)}
                    className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500 hover:bg-gray-200"
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
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Contract Details</h2>
          {!showContractForm && (
            <button onClick={() => setShowContractForm(true)} className="btn btn-primary btn-sm">
              + Create Contract
            </button>
          )}
        </div>

        {!showContractForm ? (
          <p className="text-sm text-gray-400 text-center py-6">
            No contract yet. Click "+ Create Contract" once an offer is accepted.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Status */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Contract Status</label>
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Exit Strategy</label>
                <select
                  value={contractForm.exitStrategy}
                  onChange={(e) => setContractForm((f: any) => ({ ...f, exitStrategy: e.target.value }))}
                  className="input w-full"
                >
                  <option value="wholesale">Wholesale</option>
                  <option value="novation">Novation</option>
                  <option value="subject-to">Subject-To</option>
                  <option value="creative">Creative Finance</option>
                  <option value="retail">Retail / Fix &amp; Flip</option>
                </select>
              </div>
              {/* Offer Amount */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Offer to Seller ($)</label>
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Assignment Fee ($)</label>
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Earnest Money Deposit ($)</label>
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Inspection Period (days)</label>
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Contract Date</label>
                <input
                  type="date"
                  value={contractForm.contractDate}
                  onChange={(e) => setContractForm((f: any) => ({ ...f, contractDate: e.target.value }))}
                  className="input w-full"
                />
              </div>
              {/* Expected Close */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Expected Close Date</label>
                <input
                  type="date"
                  value={contractForm.expectedCloseDate}
                  onChange={(e) => setContractForm((f: any) => ({ ...f, expectedCloseDate: e.target.value }))}
                  className="input w-full"
                />
              </div>
              {/* Buyer Name */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Buyer Name</label>
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Title Company</label>
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
              <label htmlFor="sellerFinancing" className="text-sm font-medium text-gray-700">
                Seller Financing involved
              </label>
            </div>

            {/* Disposition Notes */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Disposition Notes</label>
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
    </div>
  );
}

// ─── Helper: Deal Row ─────────────────────────────────────────────────────────

function DealRow({
  label,
  value,
  sub,
  bold,
  muted,
  highlight,
  divider,
}: {
  label: string;
  value: string;
  sub?: string;
  bold?: boolean;
  muted?: boolean;
  highlight?: 'green' | 'red';
  divider?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-b-0 ${divider ? 'border-t-2 border-t-gray-300 mt-0' : ''}`}>
      <div>
        <div className={`text-sm ${muted ? 'text-gray-400' : 'text-gray-700'} ${bold ? 'font-semibold' : ''}`}>
          {label}
        </div>
        {sub && <div className="text-xs text-gray-400">{sub}</div>}
      </div>
      <div className={`text-sm font-bold tabular-nums ${
        highlight === 'green' ? 'text-green-600' :
        highlight === 'red' ? 'text-red-600' :
        muted ? 'text-gray-400' : 'text-gray-900'
      } ${bold ? 'text-base' : ''}`}>
        {value}
      </div>
    </div>
  );
}
