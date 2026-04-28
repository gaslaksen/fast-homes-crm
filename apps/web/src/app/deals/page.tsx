'use client';

// Deals top-level view. Gated behind NEXT_PUBLIC_DEALS_VIEW=true.
// When the flag is off, renders the existing placeholder so the sidebar
// item still leads somewhere.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { authAPI, dealsAPI } from '@/lib/api';
import { isDealsView } from '@/lib/flags';
import {
  exitStrategiesInGroup,
  type DealBucket,
  type DealStageId,
  type ExitStrategyGroup,
} from '@/lib/dealStages';
import PortfolioSummary from '@/components/deals/PortfolioSummary';
import DealsFilterBar from '@/components/deals/DealsFilterBar';
import DealsTable from '@/components/deals/DealsTable';
import DealsKanban from '@/components/deals/DealsKanban';
import EmptyState from '@/components/deals/EmptyState';
import TableSkeleton from '@/components/deals/TableSkeleton';
import { useDealsPrefs } from '@/components/deals/hooks/useDealsPrefs';
import { useDealsSummary } from '@/components/deals/hooks/useDealsSummary';
import { useDealsList } from '@/components/deals/hooks/useDealsList';
import {
  rangeForPeriod,
  type RealizedPeriodId,
} from '@/components/deals/lib/timeRanges';
import type { DealsSortKey } from '@/components/deals/types';

// ─── Placeholder (flag off) ────────────────────────────────────────────────

function DealsPlaceholder() {
  return (
    <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="max-w-xl mx-auto text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Deals
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Filtered view of Under Contract + Closed leads is coming soon.
        </p>
      </div>
    </main>
  );
}

// ─── Inner page (flag on) ──────────────────────────────────────────────────

function DealsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ─── User id (for prefs scoping) ────────────────────────────────────────
  const [userId, setUserId] = useState<string | undefined>(undefined);
  useEffect(() => {
    authAPI
      .getMe()
      .then((r) => setUserId(r.data?.id || r.data?.userId || 'anon'))
      .catch(() => setUserId('anon'));
  }, []);

  const prefs = useDealsPrefs(userId);

  // ─── URL state (filters, sort, view, bucket, period) ────────────────────
  // URL wins over prefs for bookmarkability.
  const urlStages = parseList(searchParams.get('stage')) as DealStageId[];
  const urlExitGroups = parseList(searchParams.get('exit')) as ExitStrategyGroup[];
  const urlBucket = (searchParams.get('bucket') as DealBucket | null) ?? null;
  const urlHasJv = searchParams.get('jv') === 'true';
  const urlSearch = searchParams.get('q') ?? '';
  const urlSort = (searchParams.get('sort') as DealsSortKey) || 'profit';
  const urlDir = (searchParams.get('dir') as 'asc' | 'desc') || 'desc';
  const urlView = (searchParams.get('view') as 'table' | 'kanban') || prefs.view;
  const urlPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const urlPeriod = (searchParams.get('period') as RealizedPeriodId) || prefs.period;

  // Keep view/period prefs in sync with URL changes.
  useEffect(() => {
    if (!prefs.hydrated) return;
    if (urlView !== prefs.view) prefs.setView(urlView);
    if (urlPeriod !== prefs.period) prefs.setPeriod(urlPeriod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlView, urlPeriod, prefs.hydrated]);

  // Local search state (debounced before pushing to URL).
  const [searchInput, setSearchInput] = useState(urlSearch);
  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const updateUrl = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '') params.delete(k);
        else params.set(k, v);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  useEffect(() => {
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      if (searchInput !== urlSearch) {
        updateUrl({ q: searchInput || null, page: null });
      }
    }, 300);
    return () => clearTimeout(searchDebounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // ─── Realized range derivation ──────────────────────────────────────────
  const realizedRange = useMemo(() => {
    if (urlPeriod === 'custom') {
      return {
        from: prefs.customRange.from ? new Date(prefs.customRange.from) : null,
        to: prefs.customRange.to ? new Date(prefs.customRange.to) : null,
      };
    }
    return rangeForPeriod(urlPeriod);
  }, [urlPeriod, prefs.customRange]);

  // ─── Data ────────────────────────────────────────────────────────────────
  const summary = useDealsSummary(realizedRange);

  // Expand exit-group filter into the canonical strategy values the API
  // expects.
  const exitStrategiesParam = useMemo(() => {
    if (!urlExitGroups.length) return undefined;
    const out = new Set<string>();
    for (const g of urlExitGroups) for (const s of exitStrategiesInGroup(g)) out.add(s);
    return Array.from(out);
  }, [urlExitGroups]);

  const list = useDealsList({
    status: urlStages.length ? urlStages : undefined,
    bucket: urlBucket ? [urlBucket] : undefined,
    exitStrategy: exitStrategiesParam,
    hasJvPartner: urlHasJv || undefined,
    search: urlSearch || undefined,
    sort: urlSort,
    dir: urlDir,
    page: urlPage,
    limit: 25,
  });

  // ─── CSV export ─────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    setExporting(true);
    try {
      const filters: Record<string, any> = {};
      if (urlStages.length) filters.status = urlStages;
      if (urlBucket) filters.bucket = [urlBucket];
      if (exitStrategiesParam) filters.exitStrategy = exitStrategiesParam;
      if (urlHasJv) filters.hasJvPartner = true;
      if (urlSearch) filters.search = urlSearch;
      filters.sort = urlSort;
      filters.dir = urlDir;
      const res = await dealsAPI.exportCsv(filters);
      const blob = new Blob([res.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `deals-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  // ─── Card-as-filter handler ─────────────────────────────────────────────
  const onBucketClick = (bucket: DealBucket) => {
    updateUrl({ bucket: urlBucket === bucket ? null : bucket, page: null });
  };

  const onClearFilters = () =>
    updateUrl({
      stage: null,
      exit: null,
      bucket: null,
      jv: null,
      q: null,
      page: null,
    });

  const totalDealsKnown = list.data?.total ?? null;
  const filtersActive =
    urlStages.length > 0 ||
    urlExitGroups.length > 0 ||
    urlBucket != null ||
    urlHasJv ||
    !!urlSearch;

  return (
    <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Page header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Deals
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Pipeline and profit at a glance
          </p>
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* Sticky portfolio summary */}
      <div className="sticky top-0 z-20 -mx-4 mb-3 bg-white/90 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:bg-gray-950/85 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <PortfolioSummary
          data={summary.data}
          loading={summary.loading}
          selectedBucket={urlBucket}
          onBucketClick={onBucketClick}
          period={urlPeriod}
          onPeriodChange={(p) => {
            prefs.setPeriod(p);
            updateUrl({ period: p });
          }}
          customRange={prefs.customRange}
          onCustomRangeChange={prefs.setCustomRange}
        />
      </div>

      {/* Filter bar */}
      <DealsFilterBar
        selectedStages={urlStages}
        onStagesChange={(s) =>
          updateUrl({
            stage: s.length ? s.join(',') : null,
            page: null,
          })
        }
        selectedExitGroups={urlExitGroups}
        onExitGroupsChange={(g) =>
          updateUrl({
            exit: g.length ? g.join(',') : null,
            page: null,
          })
        }
        hasJvPartner={urlHasJv}
        onHasJvPartnerChange={(v) =>
          updateUrl({ jv: v ? 'true' : null, page: null })
        }
        search={searchInput}
        onSearchChange={setSearchInput}
        sort={urlSort}
        onSortChange={(s) => updateUrl({ sort: s === 'profit' ? null : s })}
        dir={urlDir}
        onDirChange={(d) => updateUrl({ dir: d === 'desc' ? null : d })}
        view={urlView}
        onViewChange={(v) => {
          prefs.setView(v);
          updateUrl({ view: v });
        }}
        counts={list.data?.counts ?? null}
      />

      {/* Body */}
      <div className="mt-3">
        {list.loading && !list.data ? (
          <TableSkeleton rows={8} />
        ) : list.data && list.data.deals.length === 0 ? (
          totalDealsKnown === 0 && !filtersActive ? (
            <EmptyState variant="no-deals" />
          ) : (
            <EmptyState variant="no-matches" onClearFilters={onClearFilters} />
          )
        ) : urlView === 'kanban' ? (
          <DealsKanban deals={list.data?.deals ?? []} />
        ) : (
          <>
            <DealsTable deals={list.data?.deals ?? []} />
            {list.data && list.data.totalPages > 1 ? (
              <Pagination
                page={list.data.page}
                totalPages={list.data.totalPages}
                total={list.data.total}
                limit={list.data.limit}
                onPageChange={(p) =>
                  updateUrl({ page: p === 1 ? null : String(p) })
                }
              />
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

// ─── Pagination ────────────────────────────────────────────────────────────

function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (p: number) => void;
}) {
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
      <div>
        Showing {start.toLocaleString()}–{end.toLocaleString()} of{' '}
        {total.toLocaleString()} deals
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="rounded border border-gray-200 px-2 py-1 disabled:opacity-40 dark:border-gray-700"
        >
          Prev
        </button>
        <span className="px-2">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="rounded border border-gray-200 px-2 py-1 disabled:opacity-40 dark:border-gray-700"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseList(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── Default export with flag gate ─────────────────────────────────────────

export default function DealsPage() {
  if (!isDealsView()) {
    return (
      <AppShell>
        <DealsPlaceholder />
      </AppShell>
    );
  }
  return (
    <AppShell>
      <Suspense fallback={<DealsPageFallback />}>
        <DealsPageInner />
      </Suspense>
    </AppShell>
  );
}

function DealsPageFallback() {
  return (
    <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <TableSkeleton rows={6} />
    </main>
  );
}
