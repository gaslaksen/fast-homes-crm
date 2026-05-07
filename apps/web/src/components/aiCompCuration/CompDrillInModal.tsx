'use client';

import { useEffect, useMemo, useState } from 'react';
import { compsAPI } from '@/lib/api';
import { zillowUrl, realtorUrl, googleMapsUrl } from '@/lib/externalLinks';
import LightboxOverlay, {
  type LightboxPhoto,
} from '@/components/LightboxOverlay';
import type { CurationRanking } from '@/lib/aiCompCuration/types';
import type { CuratedCompCardComp } from './CuratedCompCard';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
function resolveUrl(url: string): string {
  return url.startsWith('http') || url.startsWith('data:') ? url : `${API_URL}${url}`;
}

type Tab = 'details' | 'description' | 'history';

interface MlsEvent {
  type: string;
  date: string;
  price: number | null;
  source: string | null;
  daysOnMarket: number | null;
  agentName?: string;
  agentOffice?: string;
}

interface MlsDetailResponse {
  events: MlsEvent[];
  cachedAt: string | null;
  source: 'cache' | 'fresh' | 'unavailable';
  boardCode?: string | null;
  listingUrl?: string | null;
}

interface Props {
  leadId: string;
  comp: CuratedCompCardComp;
  ranking?: CurationRanking;
  selected: boolean;
  onToggle: () => void;
  onClose: () => void;
}

// Drill-in modal opened by clicking a comp's photo (cards mode) or
// address/thumbnail (table/map mode). Read-only view of all available
// data: photos (carousel + lightbox), property details grid, full MLS
// listing description, and the price-history timeline.
//
// Selection toggle in the header writes through to the same
// toggleCompSelection endpoint as the inline checkbox — state stays
// in sync across modal + cards.
export default function CompDrillInModal({
  leadId,
  comp,
  ranking,
  selected,
  onToggle,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>('details');
  const [heroIndex, setHeroIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [mlsDetail, setMlsDetail] = useState<MlsDetailResponse | null>(null);
  const [mlsDetailLoading, setMlsDetailLoading] = useState(false);
  const [mlsDetailError, setMlsDetailError] = useState<string | null>(null);

  const photos = useMemo<LightboxPhoto[]>(() => {
    const featurePhotos = (comp.features as any)?.photoUrls;
    const list: string[] =
      Array.isArray(featurePhotos) && featurePhotos.length > 0
        ? featurePhotos.filter((u): u is string => typeof u === 'string' && u.length > 0)
        : comp.photoUrl
          ? [comp.photoUrl]
          : [];
    return list.map((url) => ({ url, source: comp.source ?? undefined }));
  }, [comp]);
  const heroPhoto = photos[heroIndex];
  const hasMultiple = photos.length > 1;

  const description = useMemo<string | null>(() => {
    const f = (comp.features as any) ?? {};
    return (f.publicRemarks as string | undefined) ?? null;
  }, [comp]);

  const externalLinks = useMemo(() => {
    return {
      zillow: zillowUrl({ address: comp.address }),
      realtor: realtorUrl({ address: comp.address }),
      googleMaps: googleMapsUrl({ address: comp.address }),
    };
  }, [comp.address]);

  // Fetch MLS detail lazily when the user opens the History tab.
  // Cached server-side 24h so this is a no-op-ish on subsequent opens.
  useEffect(() => {
    if (tab !== 'history') return;
    if (mlsDetail || mlsDetailLoading) return;
    setMlsDetailLoading(true);
    setMlsDetailError(null);
    compsAPI
      .mlsDetail(leadId, comp.id)
      .then((res) => setMlsDetail(res.data as MlsDetailResponse))
      .catch((err) => {
        setMlsDetailError(err?.message ?? 'Failed to load price history.');
      })
      .finally(() => setMlsDetailLoading(false));
  }, [tab, mlsDetail, mlsDetailLoading, leadId, comp.id]);

  // Body scroll lock + Escape close.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (lightboxIndex !== null) return; // lightbox handles its own ESC
      if (e.key === 'Escape') onClose();
      if (e.key === ' ' && (e.target as HTMLElement)?.tagName !== 'BUTTON') {
        e.preventDefault();
        onToggle();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, onToggle, lightboxIndex]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Comp details — ${comp.address}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-[1024px] max-h-[90vh] bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
        style={{ animation: 'compDrillInSlideUp 200ms ease-out' }}
      >
        {/* Header zone (pinned) */}
        <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700">
          <PhotoCarousel
            photos={photos}
            heroIndex={heroIndex}
            onSetHeroIndex={setHeroIndex}
            onHeroClick={() => heroPhoto && setLightboxIndex(heroIndex)}
            externalLinks={externalLinks}
            onClose={onClose}
          />

          <div className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  ${comp.soldPrice.toLocaleString()}
                </div>
                <div className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                  {comp.address}
                </div>
                <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                  {compactFacts(comp)}
                </div>
              </div>
              <button
                type="button"
                onClick={onToggle}
                className={`text-xs px-3 py-1.5 rounded font-medium transition ${
                  selected
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
                aria-pressed={selected}
              >
                {selected ? '✓ Selected' : '☐ Select'}
              </button>
            </div>

            {ranking && (
              <div className="mt-3 px-3 py-2 rounded border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-900/10">
                <div className="text-xs text-gray-700 dark:text-gray-300">
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                    ✨ AI:
                  </span>{' '}
                  {ranking.reasoning}
                </div>
                {ranking.adjustmentNotes && (
                  <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
                    Adjustment: {ranking.adjustmentNotes}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex border-t border-gray-200 dark:border-gray-700">
            <TabBtn active={tab === 'details'} onClick={() => setTab('details')}>
              Details
            </TabBtn>
            <TabBtn
              active={tab === 'description'}
              onClick={() => setTab('description')}
            >
              Description
            </TabBtn>
            <TabBtn active={tab === 'history'} onClick={() => setTab('history')}>
              Price History
            </TabBtn>
          </div>
        </div>

        {/* Tab content (scrolls) */}
        <div className="flex-1 overflow-y-auto px-5 py-5 text-sm">
          {tab === 'details' && <DetailsTab comp={comp} />}
          {tab === 'description' && (
            <DescriptionTab
              description={description}
              boardCode={(comp.features as any)?.mlsBoardCode ?? null}
              listDate={(comp.features as any)?.listDate ?? null}
            />
          )}
          {tab === 'history' && (
            <HistoryTab
              detail={mlsDetail}
              loading={mlsDetailLoading}
              error={mlsDetailError}
              onRetry={() => {
                setMlsDetail(null);
                setMlsDetailError(null);
              }}
              fallbackBoard={(comp.features as any)?.mlsBoardCode ?? null}
            />
          )}
        </div>

        {/* Close (X) — pinned at top-right inside the modal */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center backdrop-blur-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Lightbox — opened by clicking the modal hero photo */}
      <LightboxOverlay
        photos={photos}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onIndexChange={setLightboxIndex}
      />
    </div>
  );
}

// ── Photo carousel (modal header) ─────────────────────────────────────

function PhotoCarousel({
  photos,
  heroIndex,
  onSetHeroIndex,
  onHeroClick,
  externalLinks,
  onClose: _onClose, // close handler is on the X button outside
}: {
  photos: LightboxPhoto[];
  heroIndex: number;
  onSetHeroIndex: (i: number) => void;
  onHeroClick: () => void;
  externalLinks: { zillow: string; realtor: string; googleMaps: string };
  onClose: () => void;
}) {
  const hero = photos[heroIndex];
  const hasMultiple = photos.length > 1;

  return (
    <div>
      <div className="relative aspect-[16/10] bg-gray-100 dark:bg-gray-800 overflow-hidden">
        {hero ? (
          <img
            src={resolveUrl(hero.url)}
            alt={hero.caption || 'Property photo'}
            className="w-full h-full object-cover cursor-zoom-in"
            onClick={onHeroClick}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 dark:text-gray-600 gap-2">
            <svg
              className="w-16 h-16"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12 12 3l9.75 9M4.5 9.75v10.5h15V9.75" />
            </svg>
            <span className="text-xs">No photos available</span>
          </div>
        )}

        {/* Always-visible nav arrows when multiple photos */}
        {hasMultiple && heroIndex > 0 && (
          <button
            type="button"
            onClick={() => onSetHeroIndex(heroIndex - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center backdrop-blur-sm"
            aria-label="Previous photo"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        {hasMultiple && heroIndex < photos.length - 1 && (
          <button
            type="button"
            onClick={() => onSetHeroIndex(heroIndex + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center backdrop-blur-sm"
            aria-label="Next photo"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* Thumbnail strip + counter + Zillow link */}
      <div className="px-3 py-2 flex items-center gap-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
        <div className="flex-1 flex gap-1.5 overflow-x-auto">
          {photos.map((p, i) => (
            <button
              key={`${i}-${p.url}`}
              type="button"
              onClick={() => onSetHeroIndex(i)}
              className={`flex-shrink-0 w-[64px] h-[48px] rounded overflow-hidden border-2 transition ${
                i === heroIndex
                  ? 'border-emerald-500'
                  : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
              }`}
              aria-label={`Show photo ${i + 1}`}
            >
              <img
                src={resolveUrl(p.url)}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
        {hasMultiple && (
          <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
            {heroIndex + 1} / {photos.length}
          </span>
        )}
        <a
          href={externalLinks.zillow}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap ml-1"
        >
          Zillow ↗
        </a>
      </div>
    </div>
  );
}

// ── Tab button ────────────────────────────────────────────────────────

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex-1 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
        active
          ? 'border-emerald-500 text-emerald-700 dark:text-emerald-400'
          : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
    >
      {children}
    </button>
  );
}

// ── Details tab ───────────────────────────────────────────────────────

function DetailsTab({ comp }: { comp: CuratedCompCardComp }) {
  const f = (comp.features as any) ?? {};
  return (
    <div className="space-y-5">
      <Section title="Property">
        <Field label="Property Type" value={comp.propertyType ?? null} />
        <Field label="Year Built" value={comp.yearBuilt} />
        <Field label="Bedrooms" value={comp.bedrooms} />
        <Field label="Bathrooms" value={comp.bathrooms} />
        <Field label="Living Area" value={comp.sqft} format={(n) => `${Math.round(n).toLocaleString()} sqft`} />
        <Field label="Lot Size" value={comp.lotSize} format={(n) => `${n.toFixed(2)} ac`} />
        <Field label="Garage" value={renderBool(f.hasGarage ?? null)} />
        <Field label="Pool" value={renderBool(f.hasPool ?? null)} />
      </Section>

      <Section title="Sale & Financial">
        <Field label="Sold Price" value={comp.soldPrice} format={formatMoney} />
        <Field
          label="Sold Date"
          value={comp.soldDate ? formatLongDate(comp.soldDate) : null}
        />
        <Field
          label="$/sqft"
          value={comp.sqft ? Math.round(comp.soldPrice / comp.sqft) : null}
          format={(n) => `$${n}`}
        />
        <Field label="Days on Market" value={comp.daysOnMarket ?? null} />
        <Field label="List Price" value={f.listPrice ?? null} format={formatMoney} />
        <Field
          label="List Date"
          value={f.listDate ? formatLongDate(f.listDate) : null}
        />
        <Field label="AVM" value={f.avm ?? null} format={formatMoney} />
        <Field
          label="AVM Range"
          value={
            f.avmLow && f.avmHigh
              ? `${formatMoney(f.avmLow)} – ${formatMoney(f.avmHigh)}`
              : null
          }
        />
      </Section>

      <Section title="Identifiers & Source">
        <Field label="MLS Number" value={f.mlsNumber ?? null} />
        <Field label="MLS Board" value={f.mlsBoardCode ?? null} />
        <Field label="MLS Status" value={f.mlsStatus ?? null} />
        <Field label="Provider" value={comp.source ?? null} />
        <Field label="Sale Type" value={f.saleType ?? null} />
        <Field label="Document Type" value={f.documentType ?? null} />
        <Field label="Subdivision" value={f.subdivision ?? null} />
        <Field label="School District" value={comp.schoolDistrict ?? null} />
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-500 mb-2">
        {title}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
        {children}
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
  value: string | number | null | undefined | React.ReactNode;
  format?: (n: number) => string;
}) {
  let display: React.ReactNode;
  if (value === null || value === undefined || value === '') {
    display = '—';
  } else if (typeof value === 'number' && format) {
    display = format(value);
  } else if (typeof value === 'number') {
    display = String(value);
  } else if (typeof value === 'string') {
    display = value;
  } else {
    display = value; // ReactNode (e.g. boolean badge)
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

function renderBool(v: boolean | null | undefined): React.ReactNode {
  if (v === null || v === undefined) return '—';
  return v ? (
    <span className="text-emerald-600 dark:text-emerald-400">✓ Yes</span>
  ) : (
    <span className="text-gray-500">✕ No</span>
  );
}

// ── Description tab ──────────────────────────────────────────────────

function DescriptionTab({
  description,
  boardCode,
  listDate,
}: {
  description: string | null;
  boardCode: string | null;
  listDate: string | null;
}) {
  if (!description) {
    return (
      <div className="text-center py-12">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          No listing description available
        </div>
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto leading-relaxed">
          This property may be off-market or sold via direct transaction
          without an MLS listing.
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-500">
        Listing Description
      </div>
      <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line">
        {description}
      </p>
      {(boardCode || listDate) && (
        <div className="text-[11px] text-gray-500 dark:text-gray-500 pt-1 border-t border-gray-200 dark:border-gray-700">
          Source: {boardCode ?? 'MLS'}
          {listDate ? ` · Listed ${formatLongDate(listDate)}` : ''}
        </div>
      )}
    </div>
  );
}

// ── Price History tab ────────────────────────────────────────────────

function HistoryTab({
  detail,
  loading,
  error,
  onRetry,
  fallbackBoard,
}: {
  detail: MlsDetailResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  fallbackBoard: string | null;
}) {
  if (loading && !detail) {
    return (
      <div className="space-y-3 animate-pulse">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="w-3 h-3 rounded-full bg-gray-200 dark:bg-gray-700 mt-1.5" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 w-48 rounded bg-gray-200 dark:bg-gray-800" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Failed to load price history
        </div>
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {error}
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 text-xs px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!detail || detail.events.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          No price history available
        </div>
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto leading-relaxed">
          Last known sale information may appear in the Details tab.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {detail.source === 'unavailable' && (
        <div className="text-[11px] text-yellow-700 dark:text-yellow-400 mb-2">
          Limited price history available — full MLS detail could not be
          fetched. Showing what's stored locally.
        </div>
      )}
      <ol className="relative border-l border-gray-200 dark:border-gray-700 pl-4 ml-1.5">
        {detail.events.map((e, i) => {
          const prevPrice = i < detail.events.length - 1 ? detail.events[i + 1].price : null;
          const delta =
            prevPrice != null && e.price != null && prevPrice !== e.price
              ? e.price - prevPrice
              : null;
          return (
            <li key={`${e.date}-${e.type}-${i}`} className="mb-4 last:mb-0">
              <span
                className={`absolute -left-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 ${dotColor(e.type)}`}
                aria-hidden
              />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {formatLongDate(e.date)}
                  </span>
                  <span className="ml-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                    {e.type}
                  </span>
                </div>
                {e.price != null && (
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                    ${e.price.toLocaleString()}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                {[e.source ?? fallbackBoard, e.daysOnMarket != null ? `${e.daysOnMarket} days on market` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {(e.agentName || e.agentOffice) && (
                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                  {[e.agentName, e.agentOffice].filter(Boolean).join(' · ')}
                </div>
              )}
              {delta != null && (
                <div
                  className={`text-[11px] mt-0.5 ${delta < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}
                >
                  {delta < 0 ? '↘' : '↗'} ${Math.abs(delta).toLocaleString()} (
                  {prevPrice ? `${((delta / prevPrice) * 100).toFixed(1)}%` : ''}) from previous
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {detail.cachedAt && (
        <div className="text-[10px] text-gray-400 dark:text-gray-500 pt-2">
          MLS detail {detail.source === 'cache' ? 'cached' : 'fetched'}{' '}
          {formatLongDate(detail.cachedAt)}
        </div>
      )}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function compactFacts(comp: CuratedCompCardComp): string {
  const parts: string[] = [];
  if (comp.bedrooms != null) parts.push(`${comp.bedrooms} beds`);
  if (comp.bathrooms != null) parts.push(`${comp.bathrooms} baths`);
  if (comp.sqft) parts.push(`${comp.sqft.toLocaleString()} sqft`);
  if (comp.lotSize) parts.push(`${comp.lotSize.toFixed(2)} ac`);
  if (comp.yearBuilt) parts.push(`Built ${comp.yearBuilt}`);
  return parts.join(' · ');
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function dotColor(type: string): string {
  const k = type.toLowerCase();
  if (k === 'sold') return 'bg-emerald-500';
  if (k === 'listed') return 'bg-blue-500';
  if (k === 'pending') return 'bg-gray-400';
  if (k === 'removed') return 'bg-amber-500';
  if (k === 'price change') return 'bg-purple-500';
  return 'bg-gray-400';
}
