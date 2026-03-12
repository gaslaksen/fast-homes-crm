'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { leadsAPI } from '@/lib/api';

export default function LeadManagementPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const res = await leadsAPI.stats();
      setStats(res.data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const purgeByFilter = async (label: string, filterFn: (leads: any[]) => string[]) => {
    if (!window.confirm(`Are you sure you want to delete all ${label} leads? This cannot be undone.`)) return;
    setActing(true);
    try {
      // Fetch all matching leads, then bulk delete their IDs
      const res = await leadsAPI.list({ limit: 10000 });
      const ids = filterFn(res.data.leads);
      if (ids.length === 0) {
        alert(`No ${label} leads found.`);
        return;
      }
      if (!window.confirm(`This will permanently delete ${ids.length} leads. Continue?`)) return;
      await leadsAPI.bulkDelete(ids);
      await loadStats();
    } catch (error) {
      console.error('Purge failed:', error);
      alert('Failed to purge leads');
    } finally {
      setActing(false);
    }
  };

  const purgeByStatus = async (status: string) => {
    setActing(true);
    try {
      const res = await leadsAPI.list({ status, limit: 10000 });
      const ids = res.data.leads.map((l: any) => l.id);
      if (ids.length === 0) {
        alert(`No leads with status ${status.replace(/_/g, ' ')}.`);
        setActing(false);
        return;
      }
      if (!window.confirm(`Delete ${ids.length} leads with status ${status.replace(/_/g, ' ')}?`)) {
        setActing(false);
        return;
      }
      await leadsAPI.bulkDelete(ids);
      await loadStats();
    } catch (error) {
      console.error('Purge failed:', error);
      alert('Failed to purge leads');
    } finally {
      setActing(false);
    }
  };

  const purgeByBand = async (band: string) => {
    setActing(true);
    try {
      const res = await leadsAPI.list({ scoreBand: band, limit: 10000 });
      const ids = res.data.leads.map((l: any) => l.id);
      if (ids.length === 0) {
        alert(`No leads in ${band.replace(/_/g, ' ')} band.`);
        setActing(false);
        return;
      }
      if (!window.confirm(`Delete ${ids.length} leads in ${band.replace(/_/g, ' ')} band?`)) {
        setActing(false);
        return;
      }
      await leadsAPI.bulkDelete(ids);
      await loadStats();
    } catch (error) {
      console.error('Purge failed:', error);
      alert('Failed to purge leads');
    } finally {
      setActing(false);
    }
  };

  const statusLabels: Record<string, string> = {
    NEW: 'New',
    ATTEMPTING_CONTACT: 'Attempting Contact',
    CONTACT_MADE: 'Contact Made',
    QUALIFYING: 'Qualifying',
    OFFER_SENT: 'Offer Made',
    UNDER_CONTRACT: 'Under Contract',
    CLOSING: 'Closing',
    CLOSED_WON: 'Closed Won',
    CLOSED_LOST: 'Closed Lost',
  };

  const sourceLabels: Record<string, string> = {
    PROPERTY_LEADS: 'Property Leads',
    GOOGLE_ADS: 'Google Ads',
    MANUAL: 'Manual',
    OTHER: 'Other',
  };

  const bandLabels: Record<string, string> = {
    STRIKE_ZONE: 'Strike Zone',
    HOT: 'Hot',
    WORKABLE: 'Workable',
    DEAD_COLD: 'Cold',
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">Fast Homes CRM</h1>
            <nav className="flex gap-4">
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">Dashboard</Link>
              <Link href="/leads" className="text-gray-600 hover:text-gray-900">Leads</Link>
              <Link href="/settings" className="text-primary-600 font-medium">Settings</Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/settings" className="text-primary-600 hover:text-primary-800 text-sm">
            &larr; Settings
          </Link>
          <h2 className="text-xl font-bold text-gray-900">Lead Management</h2>
        </div>

        {/* Lead Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* By Status */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-3">By Status</h3>
            <div className="space-y-2">
              {Object.entries(statusLabels).map(([key, label]) => (
                <div key={key} className="flex justify-between items-center text-sm">
                  <span className="text-gray-700">{label}</span>
                  <span className="font-medium">{stats?.byStatus?.[key] || 0}</span>
                </div>
              ))}
              <div className="border-t pt-2 flex justify-between items-center text-sm font-bold">
                <span>Total</span>
                <span>{stats?.total || 0}</span>
              </div>
            </div>
          </div>

          {/* By Source */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-3">By Source</h3>
            <div className="space-y-2">
              {Object.entries(sourceLabels).map(([key, label]) => (
                <div key={key} className="flex justify-between items-center text-sm">
                  <span className="text-gray-700">{label}</span>
                  <span className="font-medium">{stats?.bySource?.[key] || 0}</span>
                </div>
              ))}
            </div>
          </div>

          {/* By Score Band */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-3">By Score Band</h3>
            <div className="space-y-2">
              {Object.entries(bandLabels).map(([key, label]) => (
                <div key={key} className="flex justify-between items-center text-sm">
                  <span className="text-gray-700">{label}</span>
                  <span className="font-medium">{stats?.byBand?.[key] || 0}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Cleanup Actions */}
        <div className="card max-w-2xl">
          <h3 className="text-lg font-semibold mb-2">Cleanup Actions</h3>
          <p className="text-sm text-gray-600 mb-6">
            Permanently delete leads in bulk. These actions cannot be undone.
          </p>

          <div className="space-y-4">
            {/* Delete by Status */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Delete by Status</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(statusLabels).map(([key, label]) => (
                  <button
                    key={key}
                    disabled={acting || !(stats?.byStatus?.[key])}
                    onClick={() => purgeByStatus(key)}
                    className="btn btn-sm btn-secondary"
                  >
                    {label} ({stats?.byStatus?.[key] || 0})
                  </button>
                ))}
              </div>
            </div>

            {/* Delete by Score Band */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Delete by Score Band</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(bandLabels).map(([key, label]) => (
                  <button
                    key={key}
                    disabled={acting || !(stats?.byBand?.[key])}
                    onClick={() => purgeByBand(key)}
                    className="btn btn-sm btn-secondary"
                  >
                    {label} ({stats?.byBand?.[key] || 0})
                  </button>
                ))}
              </div>
            </div>

            {/* Delete Demo Leads */}
            <div className="border-t pt-4">
              <button
                disabled={acting}
                onClick={() =>
                  purgeByFilter('demo/test', (leads) =>
                    leads
                      .filter(
                        (l: any) =>
                          l.sellerFirstName?.toLowerCase().includes('demo') ||
                          l.sellerFirstName?.toLowerCase().includes('test') ||
                          l.sellerLastName?.toLowerCase().includes('demo') ||
                          l.sellerLastName?.toLowerCase().includes('test') ||
                          l.propertyAddress?.toLowerCase().includes('demo') ||
                          l.propertyAddress?.toLowerCase().includes('test')
                      )
                      .map((l: any) => l.id)
                  )
                }
                className="btn btn-sm"
                style={{ backgroundColor: '#ef4444', color: 'white' }}
              >
                {acting ? 'Deleting...' : 'Delete All Demo/Test Leads'}
              </button>
              <p className="text-xs text-gray-500 mt-1">
                Finds leads where name or address contains &quot;demo&quot; or &quot;test&quot;.
              </p>
            </div>

            {/* Nuclear option */}
            <div className="border-t pt-4">
              <button
                disabled={acting || !stats?.total}
                onClick={async () => {
                  if (!window.confirm('DELETE ALL LEADS? This will permanently remove every lead in the system.')) return;
                  if (!window.confirm('Are you absolutely sure? This CANNOT be undone.')) return;
                  setActing(true);
                  try {
                    const res = await leadsAPI.list({ limit: 10000 });
                    const ids = res.data.leads.map((l: any) => l.id);
                    await leadsAPI.bulkDelete(ids);
                    await loadStats();
                  } catch (error) {
                    console.error('Purge all failed:', error);
                    alert('Failed to delete leads');
                  } finally {
                    setActing(false);
                  }
                }}
                className="btn btn-sm"
                style={{ backgroundColor: '#991b1b', color: 'white' }}
              >
                {acting ? 'Deleting...' : `Delete ALL Leads (${stats?.total || 0})`}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
