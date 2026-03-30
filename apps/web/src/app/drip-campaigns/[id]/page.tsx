'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AppNav from '@/components/AppNav';
import { campaignAPI, leadsAPI } from '@/lib/api';
import { format } from 'date-fns';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  PAUSED: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  COMPLETED: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  REPLIED: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
  OPTED_OUT: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  REMOVED: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};

export default function CampaignDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [campaign, setCampaign] = useState<any>(null);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [enrollLeadSearch, setEnrollLeadSearch] = useState('');
  const [allLeads, setAllLeads] = useState<any[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState('');

  useEffect(() => {
    loadAll();
    leadsAPI.list({ limit: 200 }).then((res) => setAllLeads(res.data?.leads || [])).catch(() => {});
  }, [id]);

  async function loadAll() {
    setLoading(true);
    try {
      const [campRes, enrollRes] = await Promise.all([
        campaignAPI.get(id),
        campaignAPI.enrollments(id),
      ]);
      setCampaign(campRes.data);
      setEnrollments(enrollRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleEnrollLead() {
    if (!selectedLeadId) return;
    setEnrolling(true);
    try {
      await campaignAPI.enrollLead(id, selectedLeadId);
      setSelectedLeadId('');
      setEnrollLeadSearch('');
      await loadAll();
    } catch (err) {
      console.error(err);
    } finally {
      setEnrolling(false);
    }
  }

  async function handlePause(enrollmentId: string) {
    await campaignAPI.pause(enrollmentId);
    setEnrollments((prev) =>
      prev.map((e) => (e.id === enrollmentId ? { ...e, status: 'PAUSED' } : e)),
    );
  }

  async function handleResume(enrollmentId: string) {
    await campaignAPI.resume(enrollmentId);
    setEnrollments((prev) =>
      prev.map((e) => (e.id === enrollmentId ? { ...e, status: 'ACTIVE' } : e)),
    );
  }

  async function handleRemove(enrollmentId: string) {
    if (!confirm('Remove this lead from the campaign?')) return;
    await campaignAPI.unenroll(enrollmentId);
    setEnrollments((prev) => prev.filter((e) => e.id !== enrollmentId));
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <AppNav />
        <div className="text-center py-24 text-gray-400 dark:text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <AppNav />
        <div className="text-center py-24 text-gray-400 dark:text-gray-500">Campaign not found.</div>
      </div>
    );
  }

  const stats = campaign.enrollmentStats || {};
  const statCards = [
    { label: 'Enrolled', value: campaign._count?.enrollments || 0, color: 'text-gray-900 dark:text-gray-100' },
    { label: 'Active', value: stats.ACTIVE || 0, color: 'text-green-700 dark:text-green-400' },
    { label: 'Replied', value: stats.REPLIED || 0, color: 'text-purple-700 dark:text-purple-400' },
    { label: 'Completed', value: stats.COMPLETED || 0, color: 'text-blue-700 dark:text-blue-400' },
    { label: 'Opted Out', value: stats.OPTED_OUT || 0, color: 'text-red-600 dark:text-red-400' },
  ];

  const filteredEnrollments = statusFilter
    ? enrollments.filter((e) => e.status === statusFilter)
    : enrollments;

  const matchingLeads = enrollLeadSearch.trim()
    ? allLeads.filter(
        (l) =>
          `${l.sellerFirstName} ${l.sellerLastName} ${l.propertyAddress}`
            .toLowerCase()
            .includes(enrollLeadSearch.toLowerCase()),
      ).slice(0, 8)
    : [];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AppNav />
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-8">
        {/* Breadcrumb */}
        <div className="mb-4">
          <Link href="/drip-campaigns" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
            ← Drip Campaigns
          </Link>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{campaign.name}</h1>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  campaign.isActive
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                }`}
              >
                {campaign.isActive ? 'Active' : 'Paused'}
              </span>
            </div>
            {campaign.description && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{campaign.description}</p>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Triggers at {campaign.triggerDays} days no contact ·{' '}
              {campaign.steps?.length || 0} steps
            </p>
          </div>
          <Link
            href={`/drip-campaigns/${id}/edit`}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex-shrink-0"
          >
            Edit Campaign
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
          {statCards.map(({ label, value, color }) => (
            <div key={label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Step funnel */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-8">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Step Funnel</h2>
          {campaign.steps?.length === 0 ? (
            <div className="text-sm text-gray-400 dark:text-gray-500">No steps configured.</div>
          ) : (
            <div className="space-y-2">
              {campaign.steps?.map((step: any) => {
                const sent = campaign.stepSentMap?.[step.id] || 0;
                const maxSent = Math.max(
                  ...(Object.values(campaign.stepSentMap || {}) as number[]),
                  1,
                );
                const pct = Math.round((sent / maxSent) * 100);

                return (
                  <div key={step.id} className="flex items-center gap-3">
                    <div className="w-20 text-xs text-gray-500 dark:text-gray-400 text-right flex-shrink-0">
                      Step {step.stepOrder}
                    </div>
                    <div className="flex-1">
                      <div className="h-6 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-400 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <div className="w-24 text-xs text-gray-500 dark:text-gray-400">
                      {sent} sent · {step.channel === 'TEXT' ? '📱' : '✉️'}{' '}
                      {step.channel === 'TEXT' ? 'SMS' : 'Email'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Enroll a lead */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Enroll a Lead</h2>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Search lead by name or address..."
                value={enrollLeadSearch}
                onChange={(e) => {
                  setEnrollLeadSearch(e.target.value);
                  setSelectedLeadId('');
                }}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100"
              />
              {matchingLeads.length > 0 && !selectedLeadId && (
                <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
                  {matchingLeads.map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => {
                        setSelectedLeadId(lead.id);
                        setEnrollLeadSearch(
                          `${lead.sellerFirstName} ${lead.sellerLastName} — ${lead.propertyAddress}`,
                        );
                      }}
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800 last:border-0"
                    >
                      <span className="font-medium">
                        {lead.sellerFirstName} {lead.sellerLastName}
                      </span>
                      <span className="text-gray-400 dark:text-gray-500 ml-2">{lead.propertyAddress}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={handleEnrollLead}
              disabled={!selectedLeadId || enrolling}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {enrolling ? 'Enrolling...' : 'Enroll'}
            </button>
          </div>
        </div>

        {/* Enrollments table */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Enrolled Leads ({enrollments.length})
            </h2>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="">All statuses</option>
              {['ACTIVE', 'PAUSED', 'COMPLETED', 'REPLIED', 'OPTED_OUT', 'REMOVED'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {filteredEnrollments.length === 0 ? (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
              No enrollments yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-950 border-b border-gray-100 dark:border-gray-800">
                    <th className="text-left px-5 py-3 font-medium">Lead</th>
                    <th className="text-left px-4 py-3 font-medium">Address</th>
                    <th className="text-left px-4 py-3 font-medium">Step</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Last Contact</th>
                    <th className="text-left px-4 py-3 font-medium">Next Send</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {filteredEnrollments.map((enrollment) => (
                    <tr key={enrollment.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <td className="px-5 py-3 font-medium text-gray-900 dark:text-gray-100">
                        <Link
                          href={`/leads/${enrollment.lead?.id}`}
                          className="hover:text-blue-600 transition-colors"
                        >
                          {enrollment.lead?.sellerFirstName} {enrollment.lead?.sellerLastName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                        {enrollment.lead?.propertyAddress}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        Step {enrollment.currentStepOrder} / {campaign.steps?.length || '?'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                            STATUS_COLORS[enrollment.status] || 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                          }`}
                        >
                          {enrollment.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                        {enrollment.lastContactAt
                          ? format(new Date(enrollment.lastContactAt), 'MMM d, yyyy')
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                        {enrollment.nextSendAt
                          ? format(new Date(enrollment.nextSendAt), 'MMM d, h:mm a')
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {enrollment.status === 'ACTIVE' && (
                            <button
                              onClick={() => handlePause(enrollment.id)}
                              className="text-xs px-2 py-1 text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 rounded-md transition-colors"
                            >
                              Pause
                            </button>
                          )}
                          {enrollment.status === 'PAUSED' && (
                            <button
                              onClick={() => handleResume(enrollment.id)}
                              className="text-xs px-2 py-1 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-md transition-colors"
                            >
                              Resume
                            </button>
                          )}
                          <button
                            onClick={() => handleRemove(enrollment.id)}
                            className="text-xs px-2 py-1 text-red-400 dark:text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 rounded-md transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
