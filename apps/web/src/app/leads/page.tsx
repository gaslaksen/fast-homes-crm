'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { leadsAPI } from '@/lib/api';
import { LeadStatus, ScoreBand } from '@fast-homes/shared';

export default function LeadsPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: '',
    scoreBand: '',
    search: '',
  });

  useEffect(() => {
    loadLeads();
  }, [filters]);

  const loadLeads = async () => {
    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([_, v]) => v !== '')
      );
      const response = await leadsAPI.list(params);
      setLeads(response.data.leads);
    } catch (error) {
      console.error('Failed to load leads:', error);
    } finally {
      setLoading(false);
    }
  };

  const getBadgeClass = (band: string) => {
    const classes: Record<string, string> = {
      STRIKE_ZONE: 'badge-strike-zone',
      HOT: 'badge-hot',
      WORKABLE: 'badge-workable',
      DEAD_COLD: 'badge-dead-cold',
    };
    return `badge ${classes[band] || ''}`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">Fast Homes CRM</h1>
            <nav className="flex gap-4">
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
                Dashboard
              </Link>
              <Link href="/leads" className="text-primary-600 font-medium">
                Leads
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <div className="card mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search
              </label>
              <input
                type="text"
                placeholder="Name, address, phone..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="input"
              >
                <option value="">All Statuses</option>
                <option value="NEW">New</option>
                <option value="ATTEMPTING_CONTACT">Attempting Contact</option>
                <option value="QUALIFIED">Qualified</option>
                <option value="OFFER_SENT">Offer Sent</option>
                <option value="UNDER_CONTRACT">Under Contract</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Score Band
              </label>
              <select
                value={filters.scoreBand}
                onChange={(e) => setFilters({ ...filters, scoreBand: e.target.value })}
                className="input"
              >
                <option value="">All Bands</option>
                <option value="STRIKE_ZONE">Strike Zone (10-12)</option>
                <option value="HOT">Hot (7-9)</option>
                <option value="WORKABLE">Workable (4-6)</option>
                <option value="DEAD_COLD">Dead/Cold (0-3)</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={() => setFilters({ status: '', scoreBand: '', search: '' })}
                className="btn btn-secondary w-full"
              >
                Clear Filters
              </button>
            </div>
          </div>
        </div>

        {/* Leads List */}
        <div className="card">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">Leads ({leads.length})</h2>
            <Link href="/leads/new" className="btn btn-primary btn-sm">
              + New Lead
            </Link>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : leads.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No leads found</div>
          ) : (
            <div className="space-y-3">
              {leads.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="block p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className={getBadgeClass(lead.scoreBand)}>
                          {lead.scoreBand.replace('_', ' ')}
                        </span>
                        <span className="text-2xl font-bold text-primary-600">
                          {lead.totalScore}
                        </span>
                        <span className="text-xs text-gray-500 uppercase">
                          {lead.status.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="font-medium text-gray-900">
                        {lead.propertyAddress}
                      </div>
                      <div className="text-sm text-gray-600">
                        {lead.propertyCity}, {lead.propertyState} {lead.propertyZip}
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        {lead.sellerFirstName} {lead.sellerLastName} • {lead.sellerPhone}
                      </div>
                    </div>
                    <div className="text-right">
                      {lead.arv && (
                        <div className="text-sm text-gray-600">
                          ARV: ${lead.arv.toLocaleString()}
                        </div>
                      )}
                      {lead.askingPrice && (
                        <div className="text-sm text-gray-600">
                          Asking: ${lead.askingPrice.toLocaleString()}
                        </div>
                      )}
                      {lead.timeline && (
                        <div className="text-sm text-orange-600 font-medium">
                          {lead.timeline} days
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
