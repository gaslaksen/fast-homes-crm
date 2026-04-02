'use client';

import { useState } from 'react';

interface DealSearchFilters {
  zip?: string;
  state?: string;
  county?: string;
  city?: string;
  propertyType?: string[];
  bedsMin?: number;
  bedsMax?: number;
  bathsMin?: number;
  bathsMax?: number;
  sqftMin?: number;
  sqftMax?: number;
  yearBuiltMin?: number;
  yearBuiltMax?: number;
  lotSizeMin?: number;
  lotSizeMax?: number;
  hasGarage?: boolean;
  avmMin?: number;
  avmMax?: number;
  equityPercentMin?: number;
  equityPercentMax?: number;
  assessedValueMin?: number;
  assessedValueMax?: number;
  absenteeOwner?: boolean;
  preForeclosure?: boolean;
  foreclosure?: boolean;
  taxLien?: boolean;
  vacant?: boolean;
  bankruptcy?: boolean;
  probate?: boolean;
  highEquity?: boolean;
  freeClear?: boolean;
  corporateOwned?: boolean;
  outOfStateOwner?: boolean;
  ownershipYearsMin?: number;
}

interface SavedSearch {
  id: string;
  name: string;
  filters: any;
  lastRunAt?: string;
  resultCount?: number;
}

interface FilterPanelProps {
  filters: DealSearchFilters;
  onFilterChange: (filters: DealSearchFilters) => void;
  onSearch: () => void;
  onReset: () => void;
  loading?: boolean;
  savedSearches: SavedSearch[];
  onLoadSearch: (search: SavedSearch) => void;
  onSaveSearch: () => void;
  onDeleteSearch: (id: string) => void;
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const PROPERTY_TYPES = [
  { value: 'SFR', label: 'SFR' },
  { value: 'MULTI-FAMILY', label: 'Multi-Family' },
  { value: 'CONDO', label: 'Condo' },
  { value: 'TOWNHOUSE', label: 'Townhouse' },
  { value: 'LAND', label: 'Land' },
];

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-100 dark:border-gray-800 pb-3 mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full text-left text-sm font-semibold text-gray-700 dark:text-gray-300"
      >
        {title}
        <span className="text-gray-400 text-xs">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="mt-3 space-y-2">{children}</div>}
    </div>
  );
}

function MinMaxInput({ label, min, max, onMinChange, onMaxChange, placeholder }: {
  label: string;
  min?: number;
  max?: number;
  onMinChange: (v?: number) => void;
  onMaxChange: (v?: number) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{label}</label>
      <div className="flex gap-2">
        <input
          type="number"
          className="input w-full text-sm"
          placeholder={placeholder || 'Min'}
          value={min ?? ''}
          onChange={(e) => onMinChange(e.target.value ? Number(e.target.value) : undefined)}
        />
        <input
          type="number"
          className="input w-full text-sm"
          placeholder="Max"
          value={max ?? ''}
          onChange={(e) => onMaxChange(e.target.value ? Number(e.target.value) : undefined)}
        />
      </div>
    </div>
  );
}

export default function FilterPanel({
  filters,
  onFilterChange,
  onSearch,
  onReset,
  loading,
  savedSearches,
  onLoadSearch,
  onSaveSearch,
  onDeleteSearch,
}: FilterPanelProps) {
  const update = (partial: Partial<DealSearchFilters>) => {
    onFilterChange({ ...filters, ...partial });
  };

  const togglePropertyType = (type: string) => {
    const current = filters.propertyType || [];
    const updated = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    update({ propertyType: updated.length > 0 ? updated : undefined });
  };

  const toggleBool = (key: keyof DealSearchFilters) => {
    update({ [key]: filters[key] ? undefined : true } as any);
  };

  return (
    <div className="w-80 shrink-0 overflow-y-auto max-h-[calc(100vh-120px)] pr-2">
      {/* Saved Searches */}
      {savedSearches.length > 0 && (
        <div className="mb-4">
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Saved Searches</label>
          <select
            className="input w-full text-sm"
            value=""
            onChange={(e) => {
              const s = savedSearches.find((s) => s.id === e.target.value);
              if (s) onLoadSearch(s);
            }}
          >
            <option value="">Load a saved search...</option>
            {savedSearches.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.resultCount != null ? `(${s.resultCount})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Location */}
      <Section title="Location" defaultOpen={true}>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Zip Code</label>
          <input
            type="text"
            className="input w-full text-sm"
            placeholder="e.g. 33101"
            value={filters.zip || ''}
            onChange={(e) => update({ zip: e.target.value || undefined })}
          />
          <p className="text-xs text-gray-400 mt-1">Primary search parameter</p>
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">State</label>
          <select
            className="input w-full text-sm"
            value={filters.state || ''}
            onChange={(e) => update({ state: e.target.value || undefined })}
          >
            <option value="">Any state</option>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">City</label>
          <input
            type="text"
            className="input w-full text-sm"
            placeholder="City name"
            value={filters.city || ''}
            onChange={(e) => update({ city: e.target.value || undefined })}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">County</label>
          <input
            type="text"
            className="input w-full text-sm"
            placeholder="County name"
            value={filters.county || ''}
            onChange={(e) => update({ county: e.target.value || undefined })}
          />
        </div>
      </Section>

      {/* Property */}
      <Section title="Property" defaultOpen={true}>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Property Type</label>
          <div className="flex flex-wrap gap-1">
            {PROPERTY_TYPES.map((pt) => (
              <button
                key={pt.value}
                onClick={() => togglePropertyType(pt.value)}
                className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                  (filters.propertyType || []).includes(pt.value)
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                }`}
              >
                {pt.label}
              </button>
            ))}
          </div>
        </div>
        <MinMaxInput label="Bedrooms" min={filters.bedsMin} max={filters.bedsMax}
          onMinChange={(v) => update({ bedsMin: v })} onMaxChange={(v) => update({ bedsMax: v })} />
        <MinMaxInput label="Bathrooms" min={filters.bathsMin} max={filters.bathsMax}
          onMinChange={(v) => update({ bathsMin: v })} onMaxChange={(v) => update({ bathsMax: v })} />
        <MinMaxInput label="Sqft" min={filters.sqftMin} max={filters.sqftMax}
          onMinChange={(v) => update({ sqftMin: v })} onMaxChange={(v) => update({ sqftMax: v })} />
        <MinMaxInput label="Year Built" min={filters.yearBuiltMin} max={filters.yearBuiltMax}
          onMinChange={(v) => update({ yearBuiltMin: v })} onMaxChange={(v) => update({ yearBuiltMax: v })} />
        <MinMaxInput label="Lot Size (sqft)" min={filters.lotSizeMin} max={filters.lotSizeMax}
          onMinChange={(v) => update({ lotSizeMin: v })} onMaxChange={(v) => update({ lotSizeMax: v })} />
      </Section>

      {/* Financial */}
      <Section title="Financial" defaultOpen={false}>
        <MinMaxInput label="Estimated Value (AVM)" min={filters.avmMin} max={filters.avmMax}
          onMinChange={(v) => update({ avmMin: v })} onMaxChange={(v) => update({ avmMax: v })} placeholder="$0" />
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
            Min Equity %: {filters.equityPercentMin ?? 30}%
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={filters.equityPercentMin ?? 30}
            onChange={(e) => update({ equityPercentMin: Number(e.target.value) })}
            className="w-full accent-primary-600"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>
        <MinMaxInput label="Assessed Value" min={filters.assessedValueMin} max={filters.assessedValueMax}
          onMinChange={(v) => update({ assessedValueMin: v })} onMaxChange={(v) => update({ assessedValueMax: v })} placeholder="$0" />
      </Section>

      {/* Distress & Motivation */}
      <Section title="Distress & Motivation" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: 'absenteeOwner' as const, label: 'Absentee Owner' },
            { key: 'preForeclosure' as const, label: 'Pre-Foreclosure' },
            { key: 'foreclosure' as const, label: 'Foreclosure' },
            { key: 'taxLien' as const, label: 'Tax Lien' },
            { key: 'vacant' as const, label: 'Vacant' },
            { key: 'bankruptcy' as const, label: 'Bankruptcy' },
            { key: 'probate' as const, label: 'Probate' },
            { key: 'highEquity' as const, label: 'High Equity (50%+)' },
            { key: 'freeClear' as const, label: 'Free & Clear' },
          ].map((item) => (
            <label key={item.key} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={!!filters[item.key]}
                onChange={() => toggleBool(item.key)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              {item.label}
            </label>
          ))}
        </div>
      </Section>

      {/* Ownership */}
      <Section title="Ownership" defaultOpen={false}>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Min Years Owned</label>
          <input
            type="number"
            className="input w-full text-sm"
            placeholder="e.g. 10"
            value={filters.ownershipYearsMin ?? ''}
            onChange={(e) => update({ ownershipYearsMin: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={!!filters.corporateOwned}
              onChange={() => toggleBool('corporateOwned')}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            Corporate/LLC Owned
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={!!filters.outOfStateOwner}
              onChange={() => toggleBool('outOfStateOwner')}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            Out-of-State Owner
          </label>
        </div>
      </Section>

      {/* Actions */}
      <div className="space-y-2 pt-2">
        <button
          onClick={onSearch}
          disabled={loading || !filters.zip}
          className="btn btn-primary w-full"
        >
          {loading ? 'Searching...' : 'Search Properties'}
        </button>
        <div className="flex gap-2">
          <button onClick={onSaveSearch} className="btn btn-sm flex-1 text-xs">
            Save Search
          </button>
          <button onClick={onReset} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex-1 text-center">
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
