'use client';

import { useState, useEffect } from 'react';

interface DealSearchResult {
  attomId: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  county: string;
  propertyType: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  lotSize: number | null;
  yearBuilt: number | null;
  stories: number | null;
  hasGarage: boolean;
  estimatedValue: number | null;
  estimatedValueLow: number | null;
  estimatedValueHigh: number | null;
  assessedValue: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  estimatedEquity: number | null;
  equityPercent: number | null;
  annualTaxAmount: number | null;
  mortgageBalance: number | null;
  ownerName: string | null;
  ownerMailingAddress: string | null;
  isAbsenteeOwner: boolean;
  isOwnerOccupied: boolean;
  ownerType: string;
  distressFlags: string[];
  foreclosureStatus: string | null;
  avmPoorHigh: number | null;
  avmExcellentHigh: number | null;
}

interface PropertyDetailFlyoutProps {
  property: DealSearchResult | null;
  onClose: () => void;
  onAddToPipeline: (result: DealSearchResult) => void;
  onSkipTrace: (attomId: string) => void;
  isAdded: boolean;
}

function fmt(val: number | null | undefined, prefix = '') {
  if (val == null) return '—';
  return prefix + Math.round(val).toLocaleString();
}

function StatBox({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="text-center">
      <div className={`text-lg font-bold ${className || 'text-gray-900 dark:text-gray-100'}`}>{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}

export default function PropertyDetailFlyout({
  property,
  onClose,
  onAddToPipeline,
  onSkipTrace,
  isAdded,
}: PropertyDetailFlyoutProps) {
  // Deal analysis editable fields
  const [repairs, setRepairs] = useState(40000);
  const [assignmentFee, setAssignmentFee] = useState(15000);
  const [maoPercent, setMaoPercent] = useState(70);

  useEffect(() => {
    // Reset defaults when property changes
    setRepairs(40000);
    setAssignmentFee(15000);
    setMaoPercent(70);
  }, [property?.attomId]);

  if (!property) return null;

  const arv = property.avmExcellentHigh || property.estimatedValue || 0;
  const mao = arv * (maoPercent / 100) - repairs - assignmentFee;
  const spread = mao - (property.lastSalePrice || property.avmPoorHigh || 0);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-[480px] z-50 bg-white dark:bg-gray-900 shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-start justify-between z-10">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {property.propertyAddress}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {property.propertyCity}, {property.propertyState} {property.propertyZip}
            </p>
            <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
              {property.propertyType}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Property Grid */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Property Details</h3>
            <div className="grid grid-cols-3 gap-4">
              <StatBox label="Beds" value={String(property.bedrooms ?? '—')} />
              <StatBox label="Baths" value={String(property.bathrooms ?? '—')} />
              <StatBox label="Sqft" value={fmt(property.sqft)} />
              <StatBox label="Year Built" value={String(property.yearBuilt ?? '—')} />
              <StatBox label="Lot Size" value={fmt(property.lotSize)} />
              <StatBox label="Stories" value={String(property.stories ?? '—')} />
            </div>
            <div className="flex gap-3 mt-3 text-xs text-gray-500 dark:text-gray-400">
              {property.hasGarage && <span>Garage</span>}
              {property.county && <span>County: {property.county}</span>}
            </div>
          </div>

          {/* Valuation Card */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Valuation</h3>
            <div className="grid grid-cols-3 gap-4">
              <StatBox
                label="AVM Low"
                value={fmt(property.estimatedValueLow, '$')}
                className="text-gray-500"
              />
              <StatBox
                label="AVM Estimate"
                value={fmt(property.estimatedValue, '$')}
                className="text-primary-600 dark:text-primary-400"
              />
              <StatBox
                label="AVM High"
                value={fmt(property.estimatedValueHigh, '$')}
                className="text-gray-500"
              />
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
              <StatBox label="Assessed Value" value={fmt(property.assessedValue, '$')} />
              <StatBox label="Last Sale" value={fmt(property.lastSalePrice, '$')} />
              <StatBox
                label="Equity"
                value={property.equityPercent != null ? `${property.equityPercent}%` : '—'}
                className={
                  (property.equityPercent ?? 0) >= 50
                    ? 'text-green-600'
                    : (property.equityPercent ?? 0) >= 20
                    ? 'text-yellow-600'
                    : 'text-red-600'
                }
              />
            </div>
            {property.lastSaleDate && (
              <p className="text-xs text-gray-400 mt-2">
                Last sold: {new Date(property.lastSaleDate).toLocaleDateString()}
              </p>
            )}
            {property.annualTaxAmount && (
              <p className="text-xs text-gray-400">
                Annual tax: {fmt(property.annualTaxAmount, '$')}
              </p>
            )}
          </div>

          {/* Deal Analysis Card */}
          <div className="card border-2 border-primary-200 dark:border-primary-800">
            <h3 className="text-sm font-semibold text-primary-700 dark:text-primary-400 mb-3">
              Deal Analysis
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600 dark:text-gray-400">ARV (After Repair Value)</span>
                <span className="font-bold text-gray-900 dark:text-gray-100">{fmt(arv, '$')}</span>
              </div>

              <div className="flex justify-between items-center text-sm">
                <label className="text-gray-600 dark:text-gray-400">Estimated Repairs</label>
                <input
                  type="number"
                  value={repairs}
                  onChange={(e) => setRepairs(Number(e.target.value))}
                  className="input w-28 text-right text-sm"
                />
              </div>

              <div className="flex justify-between items-center text-sm">
                <label className="text-gray-600 dark:text-gray-400">Assignment Fee</label>
                <input
                  type="number"
                  value={assignmentFee}
                  onChange={(e) => setAssignmentFee(Number(e.target.value))}
                  className="input w-28 text-right text-sm"
                />
              </div>

              <div className="flex justify-between items-center text-sm">
                <label className="text-gray-600 dark:text-gray-400">MAO %</label>
                <input
                  type="number"
                  value={maoPercent}
                  onChange={(e) => setMaoPercent(Number(e.target.value))}
                  className="input w-20 text-right text-sm"
                  min={0}
                  max={100}
                />
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">MAO (Max Allowable Offer)</span>
                  <span className={`font-bold text-lg ${mao > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmt(mao, '$')}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm mt-1">
                  <span className="text-gray-500 dark:text-gray-400">Potential Spread</span>
                  <span className={`font-semibold ${spread > 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {spread > 0 ? '+' : ''}{fmt(spread, '$')}
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-400">
                MAO = ARV x {maoPercent}% - Repairs - Fee
              </p>
            </div>
          </div>

          {/* Owner Info */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Owner Information</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Name</span>
                <span className="text-gray-900 dark:text-gray-100 font-medium">{property.ownerName || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Occupancy</span>
                <span className={property.isAbsenteeOwner ? 'text-yellow-600' : 'text-gray-700 dark:text-gray-300'}>
                  {property.isAbsenteeOwner ? 'Absentee' : 'Owner Occupied'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Owner Type</span>
                <span className="text-gray-700 dark:text-gray-300">{property.ownerType}</span>
              </div>
              {property.ownerMailingAddress && (
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Mailing Address</span>
                  <span className="text-gray-700 dark:text-gray-300 text-right max-w-[200px]">{property.ownerMailingAddress}</span>
                </div>
              )}
            </div>
          </div>

          {/* Distress Flags */}
          {property.distressFlags.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Distress Indicators</h3>
              <div className="space-y-2">
                {property.distressFlags.map((flag) => (
                  <div key={flag} className="flex items-center gap-2 text-sm">
                    <span className="text-red-500">!</span>
                    <span className="text-gray-700 dark:text-gray-300">{flag}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2 pb-6">
            <button
              onClick={() => onAddToPipeline(property)}
              disabled={isAdded}
              className={`w-full ${isAdded ? 'btn bg-green-600 text-white cursor-default' : 'btn btn-primary'}`}
            >
              {isAdded ? 'Added to Pipeline' : 'Add to Pipeline'}
            </button>
            <button
              onClick={() => onSkipTrace(property.attomId)}
              className="btn w-full"
            >
              Skip Trace Owner
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
