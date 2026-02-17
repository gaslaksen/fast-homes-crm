'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { dashboardAPI } from '@/lib/api';
import { format } from 'date-fns';

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [hotLeads, setHotLeads] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const [statsRes, hotLeadsRes, tasksRes] = await Promise.all([
          dashboardAPI.stats(),
          dashboardAPI.hotLeads(10),
          dashboardAPI.tasks(),
        ]);
        setStats(statsRes.data);
        setHotLeads(hotLeadsRes.data);
        setTasks(tasksRes.data);
      } catch (error) {
        console.error('Failed to load dashboard:', error);
      } finally {
        setLoading(false);
      }
    };
    loadDashboard();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">Fast Homes CRM</h1>
            <nav className="flex gap-4">
              <Link href="/dashboard" className="text-primary-600 font-medium">
                Dashboard
              </Link>
              <Link href="/leads" className="text-gray-600 hover:text-gray-900">
                Leads
              </Link>
              <button
                onClick={() => {
                  localStorage.removeItem('auth_token');
                  router.push('/login');
                }}
                className="text-gray-600 hover:text-gray-900"
              >
                Logout
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="card">
            <div className="text-sm font-medium text-gray-600">Total Leads</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">
              {stats?.totalLeads || 0}
            </div>
          </div>
          <div className="card">
            <div className="text-sm font-medium text-gray-600">Strike Zone</div>
            <div className="text-3xl font-bold text-red-600 mt-2">
              {stats?.leadsByBand?.STRIKE_ZONE || 0}
            </div>
          </div>
          <div className="card">
            <div className="text-sm font-medium text-gray-600">Conversion Rate</div>
            <div className="text-3xl font-bold text-green-600 mt-2">
              {stats?.conversionRate?.toFixed(1)}%
            </div>
          </div>
          <div className="card">
            <div className="text-sm font-medium text-gray-600">Total Revenue</div>
            <div className="text-3xl font-bold text-primary-600 mt-2">
              ${stats?.totalRevenue?.toLocaleString() || 0}
            </div>
          </div>
        </div>

        {/* Hot Leads */}
        <div className="card mb-8">
          <h2 className="text-xl font-bold mb-4">🔥 Hot Leads</h2>
          <div className="space-y-3">
            {hotLeads.map((lead) => (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                className="block p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium text-gray-900">
                      {lead.propertyAddress}, {lead.propertyCity}
                    </div>
                    <div className="text-sm text-gray-600">
                      {lead.sellerFirstName} {lead.sellerLastName}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`badge badge-${lead.scoreBand.toLowerCase().replace('_', '-')}`}>
                      {lead.scoreBand.replace('_', ' ')}
                    </span>
                    <span className="text-2xl font-bold text-primary-600">
                      {lead.totalScore}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <Link href="/leads?scoreBand=STRIKE_ZONE,HOT" className="btn btn-primary mt-4">
            View All Hot Leads
          </Link>
        </div>

        {/* Upcoming Tasks */}
        <div className="card">
          <h2 className="text-xl font-bold mb-4">📋 Upcoming Tasks</h2>
          <div className="space-y-3">
            {tasks.slice(0, 5).map((task) => (
              <div key={task.id} className="p-4 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium text-gray-900">{task.title}</div>
                    <div className="text-sm text-gray-600">
                      {task.lead.propertyAddress} - {task.lead.sellerFirstName} {task.lead.sellerLastName}
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    {task.dueDate && format(new Date(task.dueDate), 'MMM d')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
