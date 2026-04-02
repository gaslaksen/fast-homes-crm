'use client';

import { useState, useEffect, useCallback } from 'react';
import AppNav from '@/components/AppNav';
import FilterPanel from '@/components/deal-search/FilterPanel';
import ResultsTable from '@/components/deal-search/ResultsTable';
import DealSearchMap from '@/components/deal-search/DealSearchMap';
import PropertyDetailFlyout from '@/components/deal-search/PropertyDetailFlyout';
import SaveSearchModal from '@/components/deal-search/SaveSearchModal';
import { dealSearchAPI } from '@/lib/api';

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

const DEFAULT_FILTERS: DealSearchFilters = {
  propertyType: ['SFR'],
};

function countActiveFilters(filters: DealSearchFilters): number {
  let count = 0;
  Object.entries(filters).forEach(([_key, value]) => {
    if (value === undefined || value === null || value === '' || value === false) return;
    if (Array.isArray(value) && value.length === 0) return;
    count++;
  });
  return count;
}

export default function DealSearchPage() {
  const [filters, setFilters] = useState<DealSearchFilters>(DEFAULT_FILTERS);
  const [results, setResults] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const [viewMode, setViewMode] = useState<'table' | 'map'>('table');
  const [selectedProperty, setSelectedProperty] = useState<any | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const [savedSearches, setSavedSearches] = useState<any[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const [sortKey, setSortKey] = useState('equityPercent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Load saved searches on mount
  useEffect(() => {
    dealSearchAPI.listSavedSearches()
      .then((res) => setSavedSearches(res.data || []))
      .catch(() => {});
  }, []);

  // Search
  const handleSearch = useCallback(async (p = 1) => {
    if (!filters.zip) {
      setError('Please enter a zip code to search. City/county/state searches coming soon.');
      return;
    }

    setLoading(true);
    setError(null);
    setPage(p);

    try {
      const res = await dealSearchAPI.search(filters, p, pageSize);
      const data = res.data;
      setResults(data.results || []);
      setTotal(data.total || 0);
      setHasSearched(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Search failed. Please try again.');
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filters, pageSize]);

  // Sort handler
  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // Sort results client-side
  const sortedResults = [...results].sort((a, b) => {
    let aVal = a[sortKey];
    let bVal = b[sortKey];
    if (sortKey === 'address') {
      aVal = a.propertyAddress || '';
      bVal = b.propertyAddress || '';
    }
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal) : aVal - bVal;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Add to pipeline
  const handleAddToPipeline = async (result: any) => {
    if (addedIds.has(result.attomId)) return;
    try {
      await dealSearchAPI.addToPipeline({
        attomId: result.attomId,
        propertyAddress: result.propertyAddress,
        propertyCity: result.propertyCity,
        propertyState: result.propertyState,
        propertyZip: result.propertyZip,
        propertyType: result.propertyType,
        bedrooms: result.bedrooms,
        bathrooms: result.bathrooms,
        sqft: result.sqft,
        yearBuilt: result.yearBuilt,
        lotSize: result.lotSize,
        latitude: result.latitude,
        longitude: result.longitude,
        estimatedValue: result.estimatedValue,
        estimatedValueLow: result.estimatedValueLow,
        estimatedValueHigh: result.estimatedValueHigh,
        assessedValue: result.assessedValue,
        lastSaleDate: result.lastSaleDate,
        lastSalePrice: result.lastSalePrice,
        ownerName: result.ownerName,
        isOwnerOccupied: result.isOwnerOccupied,
        avmPoorHigh: result.avmPoorHigh,
        avmExcellentHigh: result.avmExcellentHigh,
        annualTaxAmount: result.annualTaxAmount,
      });
      setAddedIds((prev) => new Set([...prev, result.attomId]));
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to add to pipeline');
    }
  };

  // Save search
  const handleSaveSearch = async (name: string) => {
    try {
      const res = await dealSearchAPI.saveSearch(name, filters);
      setSavedSearches((prev) => [res.data, ...prev]);
    } catch {
      alert('Failed to save search');
    }
  };

  // Load saved search
  const handleLoadSearch = (search: any) => {
    setFilters(search.filters);
    setHasSearched(false);
    setResults([]);
  };

  // Delete saved search
  const handleDeleteSearch = async (id: string) => {
    try {
      await dealSearchAPI.deleteSavedSearch(id);
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
    } catch {
      alert('Failed to delete search');
    }
  };

  // Export CSV
  const handleExport = async () => {
    try {
      const res = await dealSearchAPI.exportCsv(filters);
      const blob = new Blob([res.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `deal-search-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to export');
    }
  };

  // Reset
  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    setResults([]);
    setTotal(0);
    setHasSearched(false);
    setError(null);
  };

  // Skip trace
  const handleSkipTrace = async (attomId: string) => {
    try {
      const res = await dealSearchAPI.skipTrace(attomId);
      alert(res.data.message);
    } catch {
      alert('Skip trace failed');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AppNav />

      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Deal Search</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Mine ATTOM property data for wholesale deals
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Mobile filter toggle */}
            <button
              className="md:hidden btn btn-sm"
              onClick={() => setShowMobileFilters(!showMobileFilters)}
            >
              Filters ({countActiveFilters(filters)})
            </button>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Filter sidebar - desktop */}
          <div className={`hidden md:block`}>
            <FilterPanel
              filters={filters}
              onFilterChange={setFilters}
              onSearch={() => handleSearch(1)}
              onReset={handleReset}
              loading={loading}
              savedSearches={savedSearches}
              onLoadSearch={handleLoadSearch}
              onSaveSearch={() => setShowSaveModal(true)}
              onDeleteSearch={handleDeleteSearch}
            />
          </div>

          {/* Mobile filter drawer */}
          {showMobileFilters && (
            <div className="fixed inset-0 z-40 md:hidden">
              <div className="absolute inset-0 bg-black/30" onClick={() => setShowMobileFilters(false)} />
              <div className="absolute inset-y-0 left-0 w-80 bg-white dark:bg-gray-900 shadow-xl overflow-y-auto p-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100">Filters</h3>
                  <button onClick={() => setShowMobileFilters(false)} className="text-gray-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <FilterPanel
                  filters={filters}
                  onFilterChange={setFilters}
                  onSearch={() => { handleSearch(1); setShowMobileFilters(false); }}
                  onReset={handleReset}
                  loading={loading}
                  savedSearches={savedSearches}
                  onLoadSearch={handleLoadSearch}
                  onSaveSearch={() => setShowSaveModal(true)}
                  onDeleteSearch={handleDeleteSearch}
                />
              </div>
            </div>
          )}

          {/* Results area */}
          <div className="flex-1 min-w-0">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {hasSearched ? (
                  loading ? 'Searching...' : `${total.toLocaleString()} properties found`
                ) : (
                  'Configure your search and click "Search Properties"'
                )}
              </div>

              <div className="flex items-center gap-2">
                {hasSearched && results.length > 0 && (
                  <button onClick={handleExport} className="btn btn-sm text-xs">
                    Export CSV
                  </button>
                )}

                {/* View toggle */}
                <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <button
                    onClick={() => setViewMode('table')}
                    className={`px-3 py-1.5 text-xs font-medium ${
                      viewMode === 'table'
                        ? 'bg-primary-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    Table
                  </button>
                  <button
                    onClick={() => setViewMode('map')}
                    className={`px-3 py-1.5 text-xs font-medium ${
                      viewMode === 'map'
                        ? 'bg-primary-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    Map
                  </button>
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-3"></div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Searching ATTOM property data...
                  </p>
                  <p className="text-xs text-gray-400 mt-1">This may take a moment for large areas</p>
                </div>
              </div>
            )}

            {/* Empty state */}
            {!loading && !hasSearched && (
              <div className="card text-center py-16">
                <div className="text-5xl mb-4">🏠</div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Find Your Next Deal
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
                  Search millions of properties for motivated sellers, distressed assets, and high-equity opportunities.
                  Start by entering a zip code in the filter panel.
                </p>
                <div className="flex justify-center gap-4 text-sm text-gray-400">
                  <div className="text-center">
                    <div className="text-2xl mb-1">📍</div>
                    <div>Search by Zip</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl mb-1">🎯</div>
                    <div>Filter Distress</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl mb-1">📊</div>
                    <div>Analyze Deals</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl mb-1">🚀</div>
                    <div>Add to Pipeline</div>
                  </div>
                </div>
              </div>
            )}

            {/* No results */}
            {!loading && hasSearched && results.length === 0 && !error && (
              <div className="card text-center py-16">
                <div className="text-4xl mb-3">🔍</div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  No Properties Found
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Try adjusting your filters or searching a different area.
                </p>
              </div>
            )}

            {/* Results */}
            {!loading && results.length > 0 && viewMode === 'table' && (
              <div className="card p-0 overflow-hidden">
                <ResultsTable
                  results={sortedResults}
                  total={total}
                  page={page}
                  pageSize={pageSize}
                  onPageChange={(p) => handleSearch(p)}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  onSelectProperty={setSelectedProperty}
                  onAddToPipeline={handleAddToPipeline}
                  addedIds={addedIds}
                />
              </div>
            )}

            {!loading && results.length > 0 && viewMode === 'map' && (
              <div className="h-[600px]">
                <DealSearchMap
                  results={sortedResults}
                  onSelectProperty={setSelectedProperty}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Property Detail Flyout */}
      {selectedProperty && (
        <PropertyDetailFlyout
          property={selectedProperty}
          onClose={() => setSelectedProperty(null)}
          onAddToPipeline={handleAddToPipeline}
          onSkipTrace={handleSkipTrace}
          isAdded={addedIds.has(selectedProperty.attomId)}
        />
      )}

      {/* Save Search Modal */}
      <SaveSearchModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onSave={handleSaveSearch}
        activeFilterCount={countActiveFilters(filters)}
      />
    </div>
  );
}
