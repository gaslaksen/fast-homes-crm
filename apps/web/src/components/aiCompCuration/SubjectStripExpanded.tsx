'use client';

import { buildExternalLinks } from '@/lib/externalLinks';
import type { SubjectStripLead } from './SubjectStrip';

interface Props {
  lead: SubjectStripLead;
}

// Inline expanded panel for "+ More details". Phase B replaces this
// with a multi-tab drill-in modal; this is the placeholder. Renders
// whatever existing data is on the lead in a dense grid; missing
// fields show "—" rather than collapsing.
export default function SubjectStripExpanded({ lead }: Props) {
  const links = buildExternalLinks({
    address: lead.propertyAddress,
    city: lead.propertyCity,
    state: lead.propertyState,
    zip: lead.propertyZip,
  });

  // Pull any auxiliary fields the page may attach without a strict
  // schema — kept untyped so callers don't have to wire every one.
  const owner = (lead.ownerName as string | undefined) ?? null;
  const equity = (lead.equity as number | undefined) ?? null;
  const mortgage = (lead.mortgageBalance as number | undefined) ?? null;
  const listingStatus = (lead.listingStatus as string | undefined) ?? null;
  const schoolDistrict = (lead.schoolDistrict as string | undefined) ?? null;
  const subdivision = (lead.subdivision as string | undefined) ?? null;
  const propertyType = (lead.propertyType as string | undefined) ?? null;

  return (
    <div className="px-3 sm:px-4 py-3 text-xs text-gray-700 dark:text-gray-300">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
        <Field label="Owner" value={owner} />
        <Field
          label="Tax assessed"
          value={lead.taxAssessedValue}
          format={formatMoney}
        />
        <Field
          label="Last sale"
          value={
            lead.lastSalePrice
              ? `${formatMoney(lead.lastSalePrice)}${lead.lastSaleDate ? ` (${formatYear(lead.lastSaleDate)})` : ''}`
              : null
          }
        />
        <Field
          label="Asking"
          value={lead.askingPrice}
          format={formatMoney}
        />

        <Field
          label="Owner type"
          value={
            lead.ownerOccupied === true
              ? 'Owner-occupied'
              : lead.ownerOccupied === false
                ? 'Non-owner-occupied'
                : null
          }
        />
        <Field label="Equity" value={equity} format={formatMoney} />
        <Field
          label="Mortgage"
          value={mortgage}
          format={formatMoney}
        />
        <Field label="Listing status" value={listingStatus} />

        <Field label="School" value={schoolDistrict} />
        <Field label="Subdivision" value={subdivision} />
        <Field label="Property type" value={propertyType} />
        <Field label="Year built" value={lead.yearBuilt} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-3 text-[11px]">
        <a
          href={links.zillow}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          Zillow ↗
        </a>
        <a
          href={links.realtor}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          Realtor ↗
        </a>
        <a
          href={links.googleMaps}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          Maps ↗
        </a>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  format,
}: {
  label: string;
  value: string | number | null | undefined;
  format?: (n: number) => string;
}) {
  let display: string;
  if (value === null || value === undefined || value === '') {
    display = '—';
  } else if (typeof value === 'number' && format) {
    display = format(value);
  } else {
    display = String(value);
  }
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-500">
        {label}
      </div>
      <div className="text-sm text-gray-800 dark:text-gray-200 truncate">
        {display}
      </div>
    </div>
  );
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function formatYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 4);
  return String(d.getFullYear());
}
