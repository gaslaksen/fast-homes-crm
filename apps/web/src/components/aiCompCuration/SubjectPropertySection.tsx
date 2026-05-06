'use client';

import { buildExternalLinks } from '@/lib/externalLinks';
import HeroPhotoCarousel, { type HeroPhoto } from './HeroPhotoCarousel';

// Loose lead shape — the page already passes the full Lead, we just
// pull whatever fields are present without coupling to a strict type.
export interface SubjectPropertySectionLead {
  id: string;
  propertyAddress: string;
  propertyCity?: string | null;
  propertyState?: string | null;
  propertyZip?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  lotSize?: number | null;
  conditionLevel?: string | null;
  primaryPhoto?: string | null;
  photos?: HeroPhoto[] | null;
  taxAssessedValue?: number | null;
  lastSaleDate?: string | null;
  lastSalePrice?: number | null;
  askingPrice?: number | null;
  ownerOccupied?: boolean | null;
  // Optional richer fields from REAPI / BatchData enrichment.
  [key: string]: unknown;
}

interface Props {
  lead: SubjectPropertySectionLead;
  onLeadRefresh?: () => void;
}

export default function SubjectPropertySection({ lead, onLeadRefresh }: Props) {
  const photos = Array.isArray(lead.photos) ? lead.photos : [];

  const links = buildExternalLinks({
    address: lead.propertyAddress,
    city: lead.propertyCity,
    state: lead.propertyState,
    zip: lead.propertyZip,
  });

  const addressFull = [
    lead.propertyAddress,
    lead.propertyCity,
    lead.propertyState,
    lead.propertyZip,
  ]
    .filter(Boolean)
    .join(', ');

  // Pull aux fields that may or may not be on the lead. Stays loose so
  // we don't have to thread types through the page.
  const ownerName = (lead.ownerName as string | undefined) ?? null;
  const equity = (lead.equity as number | undefined) ?? null;
  const mortgageBalance = (lead.mortgageBalance as number | undefined) ?? null;
  const listingStatus = (lead.listingStatus as string | undefined) ?? null;
  const schoolDistrict = (lead.schoolDistrict as string | undefined) ?? null;
  const subdivision = (lead.subdivision as string | undefined) ?? null;
  const propertyType = (lead.propertyType as string | undefined) ?? null;

  return (
    <section
      aria-label="Subject property"
      className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700"
    >
      <div className="max-w-screen-2xl mx-auto px-3 sm:px-4 lg:px-6 py-5">
        {/* Section heading */}
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">
          Subject Property
        </h2>

        {/* 50/50 split on lg+; stack on smaller */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
          {/* Left: hero + thumbnails */}
          <div>
            <HeroPhotoCarousel
              leadId={lead.id}
              photos={photos}
              primaryPhotoUrl={lead.primaryPhoto ?? null}
              onStreetViewFetched={onLeadRefresh}
            />
          </div>

          {/* Right: address + facts + data grid + external links */}
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {addressFull || lead.propertyAddress || 'Unknown address'}
              </div>
              <div className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                {factOrDash(lead.sqft, formatSqft)} ·{' '}
                {factOrDash(lead.bedrooms, (n) => `${n}bd`)}/
                {factOrDash(lead.bathrooms, (n) => `${n}ba`)} ·{' '}
                {factOrDash(lead.yearBuilt, (n) => `Built ${n}`)}
              </div>
              <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                {factOrDash(lead.lotSize, (n) => `${n.toFixed(2)} ac`)} ·{' '}
                {lead.conditionLevel || '—'}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
              <Field label="Owner" value={ownerName} />
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
                value={mortgageBalance}
                format={formatMoney}
              />
              <Field label="Listing status" value={listingStatus} />

              <Field label="School" value={schoolDistrict} />
              <Field label="Subdivision" value={subdivision} />
              <Field label="Property type" value={propertyType} />
              <Field label="Year built" value={lead.yearBuilt} />
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1 text-[12px]">
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
        </div>
      </div>
    </section>
  );
}

// ── helpers ───────────────────────────────────────────────────────────

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
  } else if (typeof value === 'number') {
    display = String(value);
  } else {
    display = String(value);
  }
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-500">
        {label}
      </div>
      <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
        {display}
      </div>
    </div>
  );
}

function factOrDash<T>(
  value: T | null | undefined,
  format: (v: T) => string,
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number' && !Number.isFinite(value)) return '—';
  return format(value);
}

function formatSqft(n: number): string {
  return `${Math.round(n).toLocaleString()} sqft`;
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function formatYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 4);
  return String(d.getFullYear());
}
