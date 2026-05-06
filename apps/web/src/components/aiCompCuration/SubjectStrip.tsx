'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { photosAPI } from '@/lib/api';
import SubjectStripExpanded from './SubjectStripExpanded';

// The minimum data the strip needs from the lead. Loosely typed so it
// composes with both the page-level Lead interface and any narrower
// shape callers want to pass.
export interface SubjectStripLead {
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
  sellerPhone?: string | null;
  doNotContact?: boolean | null;
  status?: string | null;
  // Optional richer fields surfaced in the expanded panel.
  taxAssessedValue?: number | null;
  lastSaleDate?: string | null;
  lastSalePrice?: number | null;
  askingPrice?: number | null;
  hoaFee?: number | null;
  ownerOccupied?: boolean | null;
  // Allow additional fields to flow through without typing here.
  [key: string]: unknown;
}

interface Props {
  lead: SubjectStripLead;
  taxesAnnual?: number | null;
}

// Persistent anchor at the top of the Comps tab: photo + address + key
// facts on the left, Call/Text/Expand on the right. Sticky on lg+ so
// the user always has property context while scrolling the curation
// panel below.
export default function SubjectStrip({ lead, taxesAnnual }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(
    lead.primaryPhoto ?? null,
  );

  // Lazy Street View fallback when no primary photo exists. Kicks the
  // request once on mount; non-blocking — strip renders the placeholder
  // until the URL lands.
  useEffect(() => {
    let cancelled = false;
    if (lead.primaryPhoto || photoUrl) return;
    photosAPI
      .fetchStreetView(lead.id)
      .then((res: any) => {
        if (cancelled) return;
        const url =
          res?.data?.url ?? res?.data?.streetViewUrl ?? res?.data?.photoUrl ?? null;
        if (url) setPhotoUrl(url);
      })
      .catch(() => {
        // Silent — the placeholder is fine.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  const isDead = lead.status === 'DEAD';
  const noPhone = !lead.sellerPhone;
  const dnc = !!lead.doNotContact;
  const callDisabled = noPhone || dnc || isDead;

  const callTooltip = noPhone
    ? 'No phone number on file'
    : dnc
      ? 'Marked Do Not Contact'
      : isDead
        ? 'Lead is marked Dead'
        : 'Call seller';
  const textTooltip = callTooltip; // same disabled conditions

  const addressFull = [
    lead.propertyAddress,
    lead.propertyCity,
    lead.propertyState,
    lead.propertyZip,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <section
      aria-label="Subject property"
      className="lg:sticky lg:top-0 z-20 bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur border-b border-gray-200 dark:border-gray-700"
    >
      <div className="px-3 sm:px-4 py-3 flex flex-col sm:flex-row gap-3 sm:items-center">
        {/* Photo */}
        <div className="flex-shrink-0 relative w-[120px] h-[80px] rounded-md overflow-hidden bg-gray-200 dark:bg-gray-800 shadow-sm">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={lead.propertyAddress}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300 dark:text-gray-600">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-8 h-8"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 12 12 3l9.75 9M4.5 9.75v10.5h15V9.75"
                />
              </svg>
            </div>
          )}
        </div>

        {/* Facts */}
        <div className="min-w-0 flex-1 text-sm text-gray-700 dark:text-gray-300">
          <div className="font-semibold text-gray-900 dark:text-gray-100 text-[15px] truncate">
            {addressFull || lead.propertyAddress || 'Unknown address'}
          </div>
          <div className="mt-0.5 truncate">
            {factOrDash(lead.sqft, formatSqft)} ·{' '}
            {factOrDash(lead.bedrooms, (n) => `${n}bd`)}/
            {factOrDash(lead.bathrooms, (n) => `${n}ba`)} ·{' '}
            {factOrDash(lead.yearBuilt, (n) => `Built ${n}`)}
          </div>
          <div className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-400">
            {factOrDash(lead.lotSize, (n) => `${n.toFixed(2)} ac`)} ·{' '}
            {lead.conditionLevel || '— condition'}
          </div>
          <div className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-400">
            Taxes:{' '}
            {factOrDash(
              taxesAnnual,
              (n) => `$${Math.round(n).toLocaleString()}/yr`,
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
          <ActionButton
            kind="call"
            disabled={callDisabled}
            tooltip={callTooltip}
            href={callDisabled ? undefined : `tel:${lead.sellerPhone}`}
          />
          <ActionButton
            kind="text"
            disabled={callDisabled}
            tooltip={textTooltip}
            href={
              callDisabled
                ? undefined
                : `/leads/${lead.id}?tab=communications`
            }
            isInternal
          />
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 px-2 py-1.5 inline-flex items-center gap-1"
            aria-expanded={expanded}
            aria-controls="subject-strip-expanded"
          >
            {expanded ? 'Less details' : '+ More details'}
            <span
              aria-hidden
              className="inline-block transition-transform"
              style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              ↓
            </span>
          </button>
        </div>
      </div>

      {expanded && (
        <div id="subject-strip-expanded" className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <SubjectStripExpanded lead={lead} />
        </div>
      )}
    </section>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

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

// Inline action button mirrors the LeadDetailHeader style without
// importing from there — keeps the strip self-contained and avoids
// coupling header internals to the Comps tab.
function ActionButton({
  kind,
  disabled,
  tooltip,
  href,
  isInternal,
}: {
  kind: 'call' | 'text';
  disabled: boolean;
  tooltip: string;
  href?: string;
  isInternal?: boolean;
}) {
  const label = kind === 'call' ? 'Call' : 'Text';
  const icon =
    kind === 'call' ? (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
        />
      </svg>
    ) : (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
        />
      </svg>
    );

  const baseClasses =
    kind === 'call'
      ? 'bg-primary-600 hover:bg-primary-700 text-white border border-primary-600'
      : 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600';
  const className = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${baseClasses}`;

  if (disabled || !href) {
    return (
      <button type="button" disabled title={tooltip} className={className}>
        {icon}
        {label}
      </button>
    );
  }
  if (isInternal) {
    return (
      <Link href={href} title={tooltip} className={className}>
        {icon}
        {label}
      </Link>
    );
  }
  return (
    <a href={href} title={tooltip} className={className}>
      {icon}
      {label}
    </a>
  );
}
