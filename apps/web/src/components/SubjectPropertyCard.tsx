'use client';

interface Lead {
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  askingPrice?: number;
  conditionLevel?: string;
  yearBuilt?: number;
  effectiveYearBuilt?: number;
  stories?: number;
  wallType?: string;
  propertyQuality?: string;
  subdivision?: string;
  annualTaxAmount?: number;
}

interface SubjectPropertyCardProps {
  lead: Lead;
  compact?: boolean;
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-0.5">{value}</div>
    </div>
  );
}

export default function SubjectPropertyCard({
  lead,
  compact = false,
}: SubjectPropertyCardProps) {
  const sqftDisplay = (lead as any).sqftOverride
    ? `${(lead as any).sqftOverride.toLocaleString()} (override)`
    : lead.sqft?.toLocaleString() || '—';

  const hasFooterDetails = lead.yearBuilt || lead.stories || lead.wallType || lead.propertyQuality || lead.subdivision || lead.annualTaxAmount;

  if (compact) {
    return (
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Subject Property</h3>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <InfoItem label="Address" value={lead.propertyAddress} />
          <InfoItem label="Location" value={`${lead.propertyCity}, ${lead.propertyState}`} />
          <InfoItem label="Beds / Baths" value={`${lead.bedrooms || '?'}bd / ${lead.bathrooms || '?'}ba`} />
          <InfoItem label="Sq Ft" value={sqftDisplay} />
          <InfoItem label="Asking" value={lead.askingPrice ? `$${lead.askingPrice.toLocaleString()}` : '—'} />
          <InfoItem label="Condition" value={lead.conditionLevel || '—'} />
        </div>

        {hasFooterDetails && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500 dark:text-gray-400 border-t dark:border-gray-700 pt-2">
            {lead.yearBuilt && <span>Built {lead.yearBuilt}{lead.effectiveYearBuilt && lead.effectiveYearBuilt !== lead.yearBuilt ? ` (reno'd ${lead.effectiveYearBuilt})` : ''}</span>}
            {lead.stories && <span>{lead.stories} {lead.stories === 1 ? 'story' : 'stories'}</span>}
            {lead.wallType && <span>{lead.wallType}</span>}
            {lead.annualTaxAmount && <span>Taxes: ${Math.round(lead.annualTaxAmount).toLocaleString()}/yr</span>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold">Subject Property</h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <InfoItem label="Address" value={lead.propertyAddress} />
        <InfoItem label="Location" value={`${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}`} />
        <InfoItem label="Beds / Baths" value={`${lead.bedrooms || '?'} bd / ${lead.bathrooms || '?'} ba`} />
        <InfoItem label="Sq Ft" value={sqftDisplay} />
        <InfoItem label="Asking Price" value={lead.askingPrice ? `$${lead.askingPrice.toLocaleString()}` : '—'} />
        <InfoItem label="Condition" value={lead.conditionLevel || '—'} />
      </div>

      {hasFooterDetails && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400 border-t dark:border-gray-700 pt-3">
          {lead.yearBuilt && <span>Built {lead.yearBuilt}{lead.effectiveYearBuilt && lead.effectiveYearBuilt !== lead.yearBuilt ? ` · Reno&apos;d ${lead.effectiveYearBuilt}` : ''}</span>}
          {lead.stories && <span>{lead.stories} {lead.stories === 1 ? 'story' : 'stories'}</span>}
          {lead.wallType && <span>{lead.wallType}</span>}
          {lead.propertyQuality && <span>Quality: {lead.propertyQuality}</span>}
          {lead.subdivision && <span>Subdivision: {lead.subdivision}</span>}
          {lead.annualTaxAmount && <span>Taxes: ${Math.round(lead.annualTaxAmount).toLocaleString()}/yr</span>}
        </div>
      )}
    </div>
  );
}
