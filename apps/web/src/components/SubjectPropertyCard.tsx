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
}

interface SubjectPropertyCardProps {
  lead: Lead;
  attomData: any;
  attomLoading: boolean;
  onAttomEnrich: () => void;
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
  attomData,
  attomLoading,
  onAttomEnrich,
  compact = false,
}: SubjectPropertyCardProps) {
  const condition = (attomData?.propertyCondition && attomData.propertyCondition !== lead.conditionLevel)
    ? `${lead.conditionLevel || '—'} (ATTOM: ${attomData.propertyCondition})`
    : (lead.conditionLevel || '—');

  const sqftDisplay = (lead as any).sqftOverride
    ? `${(lead as any).sqftOverride.toLocaleString()} (override)`
    : lead.sqft?.toLocaleString() || '—';

  // ATTOM discrepancy warnings
  const warnings: string[] = [];
  if (attomData?.attomId) {
    if (attomData.sqft && lead.sqft && Math.abs(attomData.sqft - lead.sqft) / lead.sqft > 0.1)
      warnings.push(`Sqft mismatch: lead shows ${lead.sqft.toLocaleString()}, ATTOM records ${attomData.sqft.toLocaleString()}`);
    if (attomData.bedrooms && lead.bedrooms && attomData.bedrooms !== lead.bedrooms)
      warnings.push(`Bed count mismatch: lead shows ${lead.bedrooms}, ATTOM records ${attomData.bedrooms}`);
    if (attomData.bathrooms && lead.bathrooms && Math.abs(attomData.bathrooms - lead.bathrooms) >= 1)
      warnings.push(`Bath count mismatch: lead shows ${lead.bathrooms}, ATTOM records ${attomData.bathrooms}`);
  }

  if (compact) {
    return (
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Subject Property</h3>
          <div className="flex items-center gap-2">
            {attomData?.attomId ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium">
                ATTOM
              </span>
            ) : (
              <button onClick={onAttomEnrich} disabled={attomLoading}
                className="text-[10px] text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 font-medium">
                {attomLoading ? '...' : 'Enrich'}
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <InfoItem label="Address" value={lead.propertyAddress} />
          <InfoItem label="Location" value={`${lead.propertyCity}, ${lead.propertyState}`} />
          <InfoItem label="Beds / Baths" value={`${lead.bedrooms || '?'}bd / ${lead.bathrooms || '?'}ba`} />
          <InfoItem label="Sq Ft" value={sqftDisplay} />
          <InfoItem label="Asking" value={lead.askingPrice ? `$${lead.askingPrice.toLocaleString()}` : '—'} />
          <InfoItem label="Condition" value={condition} />
        </div>

        {warnings.length > 0 && (
          <div className="rounded bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-2 py-1.5 space-y-0.5">
            {warnings.map((w, i) => (
              <div key={i} className="text-[10px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
                <span>!</span> {w}
              </div>
            ))}
          </div>
        )}

        {attomData?.attomId && (attomData.yearBuilt || attomData.stories || attomData.wallType) && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500 dark:text-gray-400 border-t dark:border-gray-700 pt-2">
            {attomData.yearBuilt && <span>Built {attomData.yearBuilt}{attomData.effectiveYearBuilt && attomData.effectiveYearBuilt !== attomData.yearBuilt ? ` (reno'd ${attomData.effectiveYearBuilt})` : ''}</span>}
            {attomData.stories && <span>{attomData.stories} {attomData.stories === 1 ? 'story' : 'stories'}</span>}
            {attomData.wallType && <span>{attomData.wallType}</span>}
            {attomData.annualTaxAmount && <span>Taxes: ${Math.round(attomData.annualTaxAmount).toLocaleString()}/yr</span>}
          </div>
        )}
      </div>
    );
  }

  // Full version (for mobile stacked layout)
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold">Subject Property</h2>
        <div className="flex items-center gap-2">
          {attomData?.attomId && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium">
              ATTOM Verified
            </span>
          )}
          {!attomData?.attomId && (
            <button onClick={onAttomEnrich} disabled={attomLoading}
              className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 font-medium">
              {attomLoading ? '...' : 'Enrich with ATTOM'}
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <InfoItem label="Address" value={lead.propertyAddress} />
        <InfoItem label="Location" value={`${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}`} />
        <InfoItem label="Beds / Baths" value={`${lead.bedrooms || '?'} bd / ${lead.bathrooms || '?'} ba`} />
        <InfoItem label="Sq Ft" value={sqftDisplay} />
        <InfoItem label="Asking Price" value={lead.askingPrice ? `$${lead.askingPrice.toLocaleString()}` : '—'} />
        <InfoItem label="Condition" value={condition} />
      </div>

      {warnings.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2 space-y-1">
          {warnings.map((w, i) => (
            <div key={i} className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <span>!</span> {w} — <span className="font-medium">verify before calculating ARV</span>
            </div>
          ))}
        </div>
      )}

      {attomData?.attomId && (attomData.yearBuilt || attomData.effectiveYearBuilt || attomData.stories || attomData.wallType || attomData.propertyQuality || attomData.subdivision) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400 border-t dark:border-gray-700 pt-3">
          {attomData.yearBuilt && <span>Built {attomData.yearBuilt}{attomData.effectiveYearBuilt && attomData.effectiveYearBuilt !== attomData.yearBuilt ? ` · Reno&apos;d ${attomData.effectiveYearBuilt}` : ''}</span>}
          {attomData.stories && <span>{attomData.stories} {attomData.stories === 1 ? 'story' : 'stories'}</span>}
          {attomData.wallType && <span>{attomData.wallType}</span>}
          {attomData.propertyQuality && <span>Quality: {attomData.propertyQuality}</span>}
          {attomData.subdivision && <span>Subdivision: {attomData.subdivision}</span>}
          {attomData.annualTaxAmount && <span>Taxes: ${Math.round(attomData.annualTaxAmount).toLocaleString()}/yr</span>}
        </div>
      )}
    </div>
  );
}
