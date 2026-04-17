'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppNav from '@/components/AppNav';
import { campaignAPI } from '@/lib/api';

interface Campaign {
  id: string;
  name: string;
  description?: string;
  triggerDays: number;
  enrollmentMode: 'manual' | 'auto';
  isActive: boolean;
  isDefault: boolean;
  steps: any[];
  _count: { enrollments: number };
  enrollmentStats: Record<string, number>;
}

export default function DripCampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadCampaigns();
  }, []);

  async function loadCampaigns() {
    try {
      const res = await campaignAPI.list();
      setCampaigns(res.data || []);
    } catch (err) {
      console.error('Failed to load campaigns', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(campaign: Campaign) {
    setTogglingId(campaign.id);
    try {
      await campaignAPI.toggle(campaign.id, !campaign.isActive);
      setCampaigns((prev) =>
        prev.map((c) => (c.id === campaign.id ? { ...c, isActive: !c.isActive } : c)),
      );
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDuplicate(campaign: Campaign) {
    try {
      const res = await campaignAPI.duplicate(campaign.id);
      setCampaigns((prev) => [res.data, ...prev]);
    } catch (err) {
      console.error('Failed to duplicate campaign', err);
    }
  }

  async function handleDelete(campaign: Campaign) {
    if (!confirm(`Delete "${campaign.name}"? This cannot be undone.`)) return;
    setDeletingId(campaign.id);
    try {
      await campaignAPI.delete(campaign.id);
      setCampaigns((prev) => prev.filter((c) => c.id !== campaign.id));
    } finally {
      setDeletingId(null);
    }
  }

  // Aggregate stats
  const totalCampaigns = campaigns.length;
  const totalEnrolled = campaigns.reduce(
    (sum, c) =>
      sum +
      Object.entries(c.enrollmentStats || {})
        .filter(([s]) => ['ACTIVE', 'PAUSED'].includes(s))
        .reduce((a, [, v]) => a + v, 0),
    0,
  );
  const totalReplied = campaigns.reduce(
    (sum, c) => sum + (c.enrollmentStats?.REPLIED || 0),
    0,
  );
  const totalCompleted = campaigns.reduce(
    (sum, c) =>
      sum +
      (c.enrollmentStats?.REPLIED || 0) +
      (c.enrollmentStats?.COMPLETED || 0),
    0,
  );
  const totalSent = campaigns.reduce(
    (sum, c) => sum + (c._count?.enrollments || 0),
    0,
  );
  const responseRate =
    totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AppNav />
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">🔁 Drip Campaigns</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Re-engage stale leads with automated multi-step campaigns
            </p>
          </div>
          <Link
            href="/drip-campaigns/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <span>+</span> New Campaign
          </Link>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Campaigns', value: totalCampaigns },
            { label: 'Currently Enrolled', value: totalEnrolled },
            { label: 'Replied', value: totalReplied },
            { label: 'Response Rate', value: `${responseRate}%` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Campaign cards */}
        {loading ? (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">Loading campaigns...</div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🔁</div>
            <div className="text-lg font-medium text-gray-900 dark:text-gray-100">No campaigns yet</div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-6">
              Create your first drip campaign to start re-engaging stale leads.
            </p>
            <Link
              href="/drip-campaigns/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Create Campaign
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((campaign) => {
              const active = campaign.enrollmentStats?.ACTIVE || 0;
              const replied = campaign.enrollmentStats?.REPLIED || 0;
              const completed = campaign.enrollmentStats?.COMPLETED || 0;
              const total = campaign._count?.enrollments || 0;
              const rate = total > 0 ? Math.round((replied / total) * 100) : 0;

              return (
                <div
                  key={campaign.id}
                  className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 flex flex-col gap-3"
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/drip-campaigns/${campaign.id}`}
                          className="font-semibold text-gray-900 dark:text-gray-100 hover:text-blue-600 transition-colors truncate"
                        >
                          {campaign.name}
                        </Link>
                        {campaign.isDefault && (
                          <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded-full">
                            Template
                          </span>
                        )}
                      </div>
                      {campaign.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                          {campaign.description}
                        </p>
                      )}
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                        campaign.isActive
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {campaign.isActive ? 'Active' : 'Paused'}
                    </span>
                  </div>

                  {/* Metrics */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: 'Steps', value: campaign.steps?.length || 0 },
                      { label: 'Enrolled', value: active },
                      { label: 'Reply Rate', value: `${rate}%` },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-gray-50 dark:bg-gray-950 rounded-lg p-2">
                        <div className="font-bold text-gray-900 dark:text-gray-100 text-sm">{value}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {(campaign.enrollmentMode || 'manual') === 'auto'
                      ? 'Auto-enroll on first reply'
                      : 'Manual enrollment'}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1 border-t border-gray-100 dark:border-gray-800">
                    <Link
                      href={`/drip-campaigns/${campaign.id}/edit`}
                      className="flex-1 text-center text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium"
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => handleDuplicate(campaign)}
                      className="flex-1 text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium"
                    >
                      Duplicate
                    </button>
                    <button
                      onClick={() => handleToggle(campaign)}
                      disabled={togglingId === campaign.id}
                      className={`flex-1 text-xs px-3 py-1.5 rounded-lg transition-colors font-medium ${
                        campaign.isActive
                          ? 'bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/30'
                          : 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30'
                      }`}
                    >
                      {togglingId === campaign.id
                        ? '...'
                        : campaign.isActive
                        ? 'Pause'
                        : 'Activate'}
                    </button>
                    <button
                      onClick={() => handleDelete(campaign)}
                      disabled={deletingId === campaign.id}
                      className="text-xs px-2 py-1.5 text-red-400 dark:text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition-colors"
                    >
                      {deletingId === campaign.id ? '...' : '🗑'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
