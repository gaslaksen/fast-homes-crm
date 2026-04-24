'use client';

import { useState } from 'react';
import { formatPhoneDisplay } from '@/lib/format';
import PropertyDetailsExpanded from './PropertyDetailsExpanded';

interface Props {
  lead: any;
  onCall: () => void;
  onText: () => void;
  onEmail: () => void;
}

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === '' || value === 0) {
    return (
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500">{label}</div>
        <div className="text-sm text-gray-300 dark:text-gray-600">—</div>
      </div>
    );
  }
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

export default function SellerPropertyCard({ lead, onCall, onText, onEmail }: Props) {
  const [expanded, setExpanded] = useState(false);
  const ownershipLabel = lead.ownershipStatus ? lead.ownershipStatus.replace('_', ' ') : null;
  const hasDetails = !!(
    lead.apn || lead.subdivision || lead.taxAssessedValue || lead.marketAssessedValue ||
    lead.annualTaxAmount || lead.coolingType || lead.heatingType || lead.stories ||
    lead.ownerName || lead.lastSaleDate || lead.lastSalePrice || lead.hoaFee ||
    lead.propertyCondition || lead.propertyQuality ||
    lead.reapiMortgageData || lead.attomMortgageData ||
    (lead.reapiSaleHistory && lead.reapiSaleHistory.length > 0) ||
    (lead.attomSaleHistory && lead.attomSaleHistory.length > 0)
  );

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
      {/* Seller section */}
      <div className="mb-4">
        <div className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {lead.sellerFirstName} {lead.sellerLastName}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {lead.sellerPhone && (
            <div className="flex items-center gap-2">
              <span className="text-gray-600 dark:text-gray-300">{formatPhoneDisplay(lead.sellerPhone)}</span>
              <button onClick={onCall} disabled={!!lead.doNotContact} className="text-xs px-2 py-0.5 rounded-md bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900 disabled:opacity-50">Call</button>
              <button onClick={onText} disabled={!!lead.doNotContact} className="text-xs px-2 py-0.5 rounded-md bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900 disabled:opacity-50">Text</button>
            </div>
          )}
          {lead.sellerEmail && (
            <div className="flex items-center gap-2">
              <span className="text-gray-600 dark:text-gray-300 truncate">{lead.sellerEmail}</span>
              <button onClick={onEmail} className="text-xs px-2 py-0.5 rounded-md bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900">Email</button>
            </div>
          )}
        </div>
        {(ownershipLabel || lead.ownerOccupied != null) && (
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            {ownershipLabel && (
              <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">{ownershipLabel}</span>
            )}
            {lead.ownerOccupied != null && (
              <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                {lead.ownerOccupied ? 'Owner-occupied' : 'Non-owner-occupied'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Property facts strip */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Fact label="Type" value={lead.propertyType || null} />
        <Fact label="Beds" value={lead.bedrooms} />
        <Fact label="Baths" value={lead.bathrooms} />
        <Fact label="Sqft" value={(lead.sqftOverride || lead.sqft) ? Number(lead.sqftOverride || lead.sqft).toLocaleString() : null} />
        <Fact label="Year" value={lead.yearBuilt} />
        <Fact label="Lot" value={lead.lotSize ? `${lead.lotSize} ac` : null} />
      </div>

      {/* Accordion */}
      {hasDetails && (
        <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-between text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <span>Full property details (taxes, sale history, mortgage)</span>
            <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          {expanded && <PropertyDetailsExpanded lead={lead} />}
        </div>
      )}
    </div>
  );
}
