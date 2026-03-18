'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { dispoAPI } from '@/lib/api';
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

  // Deal Numbers edit mode
  const [editingNumbers, setEditingNumbers] = useState(false);
  const [numbersForm, setNumbersForm] = useState({ arv: '', repairCosts: '', askingPrice: '', assignmentFee: '', maoPercent: '' });
  const [savingNumbers, setSavingNumbers] = useState(false);

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

  const startEditingNumbers = () => {
    const s = summary!;
    setNumbersForm({
      arv: s.arv != null ? String(s.arv) : '',
      repairCosts: s.repairCost != null ? String(s.repairCost) : '',
      askingPrice: s.askingPrice != null ? String(s.askingPrice) : '',
      assignmentFee: s.leadAssignmentFee != null ? String(s.leadAssignmentFee) : '',
      maoPercent: s.maoPercent != null ? String(s.maoPercent) : '70',
    });
    setEditingNumbers(true);
  };

  const handleSaveDealNumbers = async () => {
    setSavingNumbers(true);
    try {
      const payload: { arv?: number | null; repairCosts?: number | null; askingPrice?: number | null; assignmentFee?: number | null; maoPercent?: number | null } = {};
      payload.arv = numbersForm.arv !== '' ? parseFloat(numbersForm.arv) : null;
      payload.repairCosts = numbersForm.repairCosts !== '' ? parseFloat(numbersForm.repairCosts) : null;
      payload.askingPrice = numbersForm.askingPrice !== '' ? parseFloat(numbersForm.askingPrice) : null;
      payload.assignmentFee = numbersForm.assignmentFee !== '' ? parseFloat(numbersForm.assignmentFee) : null;
      payload.maoPercent = numbersForm.maoPercent !== '' ? parseFloat(numbersForm.maoPercent) : null;
      await dispoAPI.updateDealNumbers(leadId, payload);
      setEditingNumbers(false);
      await load();
    } catch (e) {
      console.error('Failed to save deal numbers', e);
      alert('Failed to save deal numbers');
    } finally {
      setSavingNumbers(false);
    }
  };

  // Live-compute derived values while editing
  const liveArv = numbersForm.arv !== '' ? parseFloat(numbersForm.arv) : null;
  const liveRepairs = numbersForm.repairCosts !== '' ? parseFloat(numbersForm.repairCosts) : null;
  const liveAsking = numbersForm.askingPrice !== '' ? parseFloat(numbersForm.askingPrice) : null;
  const liveMaoFactor = numbersForm.maoPercent !== '' ? parseFloat(numbersForm.maoPercent) / 100 : ((summary?.maoPercent ?? 70) / 100);
  const liveFee = numbersForm.assignmentFee !== '' ? parseFloat(numbersForm.assignmentFee) : 0;
  const liveMao = liveArv != null && liveRepairs != null ? liveArv * liveMaoFactor - liveRepairs : null;
  const liveOfferAmount = summary?.offerAmount ?? null;
  const liveAssignmentFee = summary?.assignmentFee ?? null;
  const liveBuyerPrice = liveOfferAmount != null && liveAssignmentFee != null ? liveOfferAmount + liveAssignmentFee : null;
  const liveBuyerSpread = liveArv != null && liveBuyerPrice != null ? liveArv - liveBuyerPrice : null;

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
          <div className="flex items-center gap-2">
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
            {!editingNumbers && (
              <button
                onClick={startEditingNumbers}
                className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors flex items-center gap-1"
              >
                ✏️ Edit
              </button>
            )}
          </div>
        </div>

        {/* Edit mode banner */}
        {editingNumbers && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800 flex items-center justify-between gap-3">
            <span>Editing deal numbers — changes save to this lead and override comps analysis values.</span>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={handleSaveDealNumbers}
                disabled={savingNumbers}
                className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:opacity-50"
              >
                {savingNumbers ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setEditingNumbers(false)}
                disabled={savingNumbers}
                className="text-xs px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!s.arv && !editingNumbers && (
          <div className="mb-5 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
            ⚠️ No ARV on file. Enter it above or{' '}
            <Link href={`/leads/${leadId}/comps-analysis`} className="font-semibold underline">
              run comps analysis
            </Link>{' '}
            to auto-populate.
          </div>
        )}

        {editingNumbers ? (
          /* ── Editable rows ──────────────────────────────────────────────── */
          <div className="space-y-4">
            {/* Input fields for the three source values */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">ARV — After Repair Value ($)</label>
                <input
                  type="number"
                  value={numbersForm.arv}
                  onChange={(e) => setNumbersForm((f) => ({ ...f, arv: e.target.value }))}
                  className="input w-full"
                  placeholder="e.g. 250000"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Repair Estimate ($)</label>
                <input
                  type="number"
                  value={numbersForm.repairCosts}
                  onChange={(e) => setNumbersForm((f) => ({ ...f, repairCosts: e.target.value }))}
                  className="input w-full"
                  placeholder="e.g. 35000"
                />
                {s.latestCompAnalysis?.repairNotes && (
                  <p className="text-xs text-gray-400 mt-1 truncate">{s.latestCompAnalysis.repairNotes}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Seller Asking Price ($)</label>
                <input
                  type="number"
                  value={numbersForm.askingPrice}
                  onChange={(e) => setNumbersForm((f) => ({ ...f, askingPrice: e.target.value }))}
                  className="input w-full"
                  placeholder="e.g. 180000"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Assignment Fee ($)</label>
                <input
                  type="number"
                  value={numbersForm.assignmentFee}
                  onChange={(e) => setNumbersForm((f) => ({ ...f, assignmentFee: e.target.value }))}
                  className="input w-full"
                  placeholder="e.g. 15000"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">MAO % (e.g. 70)</label>
                <input
                  type="number"
                  value={numbersForm.maoPercent}
                  onChange={(e) => setNumbersForm((f) => ({ ...f, maoPercent: e.target.value }))}
                  className="input w-full"
                  placeholder="70"
                  min="50"
                  max="95"
                />
                <p className="text-xs text-gray-400 mt-1">Default 70 — adjust for seller motivation</p>
              </div>
            </div>

            {/* Live-computed preview */}
            <div className="rounded-xl border border-gray-200 overflow-hidden text-sm">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Live Preview
              </div>
              <DealRow
                label={`MAO (${Math.round(liveMaoFactor * 100)}% Rule)`}
                value={fmt(liveMao)}
                muted={liveMao == null}
                highlight={
                  liveMao != null && liveOfferAmount != null
                    ? liveOfferAmount <= liveMao ? 'green' : 'red'
                    : undefined
                }
                sub={`ARV × ${Math.round(liveMaoFactor * 100)}% − repairs`}
              />
              <DealRow label="Offer to Seller" value={fmt(liveOfferAmount)} bold muted={!liveOfferAmount}
                sub="Set in Contract Details below" />
              <DealRow label="Assignment Fee" value={liveFee > 0 ? fmt(liveFee) : fmt(liveAssignmentFee)} bold muted={!liveFee && !liveAssignmentFee}
                sub="From deal numbers or Contract Details" />
              <DealRow label="Buyer's All-In Price" value={fmt(liveBuyerPrice)} muted={liveBuyerPrice == null} divider />
              <DealRow label="Buyer's Spread" value={fmt(liveBuyerSpread)}
                highlight={liveBuyerSpread != null ? (liveBuyerSpread > 0 ? 'green' : 'red') : undefined} />
              <DealRow
                label="Your Profit"
                value={fmt(liveAssignmentFee)}
                bold
                highlight={liveAssignmentFee != null ? (liveAssignmentFee > 0 ? 'green' : 'red') : undefined}
              />
            </div>
            <p className="text-xs text-gray-400">
              💡 <Link href={`/leads/${leadId}/comps-analysis`} className="underline hover:text-gray-600">Comps Analysis</Link> can auto-fill ARV and repairs from comparable sales.
            </p>
          </div>
        ) : (
          /* ── Read-only rows ─────────────────────────────────────────────── */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 rounded-xl border border-gray-200 overflow-hidden text-sm">
            <DealRow label="ARV (After Repair Value)" value={fmt(s.arv)} muted={!s.arv} />
            <DealRow label="Repair Estimate" value={fmt(s.repairCost)} muted={!s.repairCost}
              sub={s.latestCompAnalysis?.repairNotes ?? undefined} />
            <DealRow
              label={`MAO (${s.maoPercent ?? 70}% Rule)`}
              value={fmt(s.mao)}
              highlight={
                s.mao != null && s.offerAmount != null
                  ? s.offerAmount <= s.mao ? 'green' : 'red'
                  : undefined
              }
              sub={s.mao != null ? `ARV × ${s.maoPercent ?? 70}% − repairs` : undefined}
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
        )}
      </div>

      {/* ── Exit Strategy Costs ───────────────────────────────────────────── */}
      <ExitStrategyCosts
        arv={s.arv}
        repairCost={s.repairCost}
        offerAmount={s.offerAmount}
        assignmentFee={s.assignmentFee}
        defaultStrategy={s.contract?.exitStrategy ?? 'wholesale'}
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

// ─── Exit Strategy Costs ─────────────────────────────────────────────────────

const EXIT_COSTS: Record<string, { label: string; agentPct: number; closingPct: number; holdingPct: number; financingPct: number }> = {
  wholesale:    { label: 'Wholesale',        agentPct: 0, closingPct: 1,   holdingPct: 0, financingPct: 0   },
  novation:     { label: 'Novation',         agentPct: 6, closingPct: 2.5, holdingPct: 2, financingPct: 0   },
  flip:         { label: 'Fix & Flip',       agentPct: 6, closingPct: 3,   holdingPct: 2, financingPct: 3.5 },
  wholetail:    { label: 'Wholetail',        agentPct: 3, closingPct: 2,   holdingPct: 1, financingPct: 1   },
  'subject-to': { label: 'Subject-To',      agentPct: 6, closingPct: 2.5, holdingPct: 2, financingPct: 0   },
  creative:     { label: 'Creative Finance', agentPct: 6, closingPct: 2.5, holdingPct: 2, financingPct: 1   },
};

function ExitStrategyCosts({
  arv,
  repairCost,
  offerAmount,
  assignmentFee,
  defaultStrategy,
}: {
  arv: number | null;
  repairCost: number | null;
  offerAmount: number | null;
  assignmentFee: number | null;
  defaultStrategy: string;
}) {
  const [strategy, setStrategy] = React.useState(defaultStrategy);
  const costs = EXIT_COSTS[strategy] ?? EXIT_COSTS.wholesale;
  const fmtC = (n: number | null) => n != null ? `$${Math.round(n).toLocaleString()}` : '—';
  const pctOf = (pct: number) => arv != null ? arv * pct / 100 : null;

  const agentCost     = pctOf(costs.agentPct);
  const closingCost   = pctOf(costs.closingPct);
  const holdingCost   = pctOf(costs.holdingPct);
  const financingCost = pctOf(costs.financingPct);
  const totalPct      = costs.agentPct + costs.closingPct + costs.holdingPct + costs.financingPct;
  const totalCost     = arv != null ? arv * totalPct / 100 : null;

  // Net profit: ARV - all costs - repairs - purchase price (offer or assignment fee)
  const purchase = offerAmount ?? 0;
  const repairs  = repairCost ?? 0;
  const netProfit = arv != null && totalCost != null
    ? arv - totalCost - repairs - purchase
    : null;

  const costRows = [
    { label: 'Agent Commissions', pct: costs.agentPct,     range: '~6%',   value: agentCost,     show: costs.agentPct > 0 },
    { label: 'Closing Costs',     pct: costs.closingPct,   range: '2–4%',  value: closingCost,   show: true },
    { label: 'Holding Costs',     pct: costs.holdingPct,   range: '1–3%',  value: holdingCost,   show: costs.holdingPct > 0 },
    { label: 'Financing Costs',   pct: costs.financingPct, range: '2–5%',  value: financingCost, show: costs.financingPct > 0 },
  ].filter(r => r.show);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold">Exit Strategy Costs</h2>
          <p className="text-xs text-gray-400 mt-0.5">Estimate costs based on your exit strategy</p>
        </div>
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          {Object.entries(EXIT_COSTS).map(([key, c]) => (
            <option key={key} value={key}>{c.label}</option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-gray-200 overflow-hidden text-sm mb-3">
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
          <div className="col-span-5">Cost Item</div>
          <div className="col-span-3 text-center">Rate</div>
          <div className="col-span-4 text-right">Amount</div>
        </div>

        {/* ARV baseline */}
        {arv != null && (
          <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-100 bg-blue-50">
            <div className="col-span-5 text-blue-800 font-semibold">ARV (Base)</div>
            <div className="col-span-3 text-center text-blue-600">—</div>
            <div className="col-span-4 text-right font-bold text-blue-800">${arv.toLocaleString()}</div>
          </div>
        )}

        {/* Purchase price */}
        <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-100">
          <div className="col-span-5 text-gray-700">Purchase / Offer</div>
          <div className="col-span-3 text-center text-gray-400">—</div>
          <div className="col-span-4 text-right font-semibold text-gray-800">{fmtC(offerAmount)}</div>
        </div>

        {/* Repairs */}
        <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-100">
          <div className="col-span-5 text-gray-700">Repair Estimate</div>
          <div className="col-span-3 text-center text-gray-400">—</div>
          <div className="col-span-4 text-right font-semibold text-gray-800">{fmtC(repairCost)}</div>
        </div>

        {/* Cost rows */}
        {costRows.map((row) => (
          <div key={row.label} className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-100 last:border-b-0">
            <div className="col-span-5 text-gray-700">{row.label}</div>
            <div className="col-span-3 text-center text-gray-500">{row.pct}%</div>
            <div className="col-span-4 text-right text-gray-800">{fmtC(row.value)}</div>
          </div>
        ))}

        {/* Total costs */}
        <div className="grid grid-cols-12 gap-2 px-4 py-3 border-t-2 border-gray-300 bg-gray-50">
          <div className="col-span-5 font-semibold text-gray-800">Total Transaction Costs</div>
          <div className="col-span-3 text-center font-semibold text-gray-600">{totalPct}%</div>
          <div className="col-span-4 text-right font-bold text-gray-900">{fmtC(totalCost)}</div>
        </div>

        {/* Net profit */}
        <div className={`grid grid-cols-12 gap-2 px-4 py-4 border-t border-gray-200 ${
          netProfit == null ? 'bg-gray-50' :
          netProfit > 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}>
          <div className={`col-span-5 font-bold text-base ${netProfit == null ? 'text-gray-500' : netProfit > 0 ? 'text-green-800' : 'text-red-800'}`}>
            Net Profit
          </div>
          <div className="col-span-3 text-center">
            {netProfit != null && arv != null && (
              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${netProfit > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {((netProfit / arv) * 100).toFixed(1)}% of ARV
              </span>
            )}
          </div>
          <div className={`col-span-4 text-right font-bold text-lg tabular-nums ${
            netProfit == null ? 'text-gray-400' : netProfit > 0 ? 'text-green-700' : 'text-red-700'
          }`}>
            {netProfit != null ? `${netProfit >= 0 ? '+' : ''}$${Math.round(netProfit).toLocaleString()}` : '—'}
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        💡 Typical investor costs: agent ~6%, closing 2–4%, holding 1–3%, financing 2–5% = <strong>10–12% of ARV</strong>. Wholesale avoids most of these.
      </p>
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
