'use client';

import { useState } from 'react';
import { formatPhoneDisplay } from '@/lib/format';
import { format } from 'date-fns';

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
  const hasDetails = !!(lead.apn || lead.subdivision || lead.taxAssessedValue || lead.annualTaxAmount || lead.coolingType || lead.heatingType || lead.stories || lead.ownerName || lead.lastSaleDate || lead.reapiMortgageData || lead.attomMortgageData);

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
              <button onClick={onCall} disabled={!!lead.doNotContact} className="text-xs px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900 disabled:opacity-50">Call</button>
              <button onClick={onText} disabled={!!lead.doNotContact} className="text-xs px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900 disabled:opacity-50">Text</button>
            </div>
          )}
          {lead.sellerEmail && (
            <div className="flex items-center gap-2">
              <span className="text-gray-600 dark:text-gray-300 truncate">{lead.sellerEmail}</span>
              <button onClick={onEmail} className="text-xs px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900">Email</button>
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
            <span>Full property details</span>
            <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          {expanded && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-xs">
              {lead.stories != null && (<div><span className="text-gray-500 dark:text-gray-400">Stories:</span> <span className="font-medium">{lead.stories}</span></div>)}
              {lead.coolingType && (<div><span className="text-gray-500 dark:text-gray-400">Cooling:</span> <span className="font-medium">{lead.coolingType}</span></div>)}
              {lead.heatingType && (<div><span className="text-gray-500 dark:text-gray-400">Heating:</span> <span className="font-medium">{lead.heatingType}</span></div>)}
              {lead.apn && (<div><span className="text-gray-500 dark:text-gray-400">APN:</span> <span className="font-medium">{lead.apn}</span></div>)}
              {lead.subdivision && (<div><span className="text-gray-500 dark:text-gray-400">Subdivision:</span> <span className="font-medium">{lead.subdivision}</span></div>)}
              {lead.ownerName && (<div className="md:col-span-3"><span className="text-gray-500 dark:text-gray-400">Recorded owner:</span> <span className="font-medium">{lead.ownerName}</span></div>)}
              {lead.taxAssessedValue != null && (<div><span className="text-gray-500 dark:text-gray-400">Assessed:</span> <span className="font-medium">${lead.taxAssessedValue.toLocaleString()}</span></div>)}
              {lead.marketAssessedValue != null && (<div><span className="text-gray-500 dark:text-gray-400">Market assessed:</span> <span className="font-medium">${lead.marketAssessedValue.toLocaleString()}</span></div>)}
              {lead.annualTaxAmount != null && (<div><span className="text-gray-500 dark:text-gray-400">Annual tax:</span> <span className="font-medium">${lead.annualTaxAmount.toLocaleString()}</span></div>)}
              {lead.lastSaleDate && lead.lastSalePrice && (
                <div className="md:col-span-3">
                  <span className="text-gray-500 dark:text-gray-400">Last sale:</span>{' '}
                  <span className="font-medium">${lead.lastSalePrice.toLocaleString()} on {format(new Date(lead.lastSaleDate), 'MMM d, yyyy')}</span>
                </div>
              )}
              {lead.hoaFee != null && lead.hoaFee > 0 && (<div><span className="text-gray-500 dark:text-gray-400">HOA:</span> <span className="font-medium">${lead.hoaFee.toLocaleString()}/yr</span></div>)}
              {lead.propertyCondition && (<div><span className="text-gray-500 dark:text-gray-400">Condition:</span> <span className="font-medium">{lead.propertyCondition}</span></div>)}
              {lead.propertyQuality && (<div><span className="text-gray-500 dark:text-gray-400">Quality:</span> <span className="font-medium">{lead.propertyQuality}</span></div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
