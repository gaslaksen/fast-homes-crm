'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { partnersAPI } from '@/lib/api';

const PARTNER_TYPES = [
  { value: 'buyer', label: 'Cash Buyer' },
  { value: 'jv', label: 'JV Partner' },
  { value: 'title', label: 'Title Company' },
  { value: 'lender', label: 'Lender' },
  { value: 'agent', label: 'Agent' },
  { value: 'other', label: 'Other' },
];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(PARTNER_TYPES.map((t) => [t.value, t.label]));

interface Partner {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  type: string;
  needsTypeReview?: boolean;
  notes: string | null;
  shareCount: number;
  lastSharedAt: string | null;
  createdAt: string;
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [form, setForm] = useState({ name: '', email: '', company: '', phone: '', type: 'buyer', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchPartners = async () => {
    try {
      const { data } = await partnersAPI.list({ search: search || undefined, type: typeFilter || undefined });
      setPartners(data.partners);
      setTotal(data.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPartners();
  }, [search, typeFilter]);

  const openAdd = () => {
    setEditingPartner(null);
    setForm({ name: '', email: '', company: '', phone: '', type: 'buyer', notes: '' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (p: Partner) => {
    setEditingPartner(p);
    setForm({ name: p.name, email: p.email, company: p.company || '', phone: p.phone || '', type: p.type, notes: p.notes || '' });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      setError('Name and email are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editingPartner) {
        await partnersAPI.update(editingPartner.id, form);
      } else {
        await partnersAPI.create(form);
      }
      setShowModal(false);
      fetchPartners();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save partner');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this partner? Their share history will be preserved.')) return;
    try {
      await partnersAPI.delete(id);
      fetchPartners();
    } catch {
      // ignore
    }
  };

  const markReviewed = async (id: string) => {
    try {
      await partnersAPI.update(id, { needsTypeReview: false });
      fetchPartners();
    } catch {
      // ignore
    }
  };

  const reviewCount = partners.filter((p) => p.needsTypeReview).length;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Buyer Partners</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage your buyer network for deal disposition</p>
          </div>
          <button
            onClick={openAdd}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
          >
            + Add Partner
          </button>
        </div>

        {reviewCount > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            <strong>{reviewCount} partner{reviewCount === 1 ? '' : 's'} need{reviewCount === 1 ? 's' : ''} a type review.</strong>{' '}
            We migrated legacy "Hedge Fund" and "Fix &amp; Flip" types to "Cash Buyer" — please reclassify any that should be Lender, Title, or Agent.
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 mb-4">
          <input
            type="text"
            placeholder="Search partners..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 max-w-xs px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          >
            <option value="">All Types</option>
            {PARTNER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400 animate-pulse">Loading...</div>
          ) : partners.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                No partners yet.
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500">
                Add buyer partners so you can disposition deals when an offer is accepted.
              </div>
              <button
                onClick={openAdd}
                className="btn btn-primary btn-sm"
              >
                + Add your first partner
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 text-left">
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Name</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Email</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Company</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Type</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">Shares</th>
                  <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 text-right">Last Shared</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{p.name}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{p.email}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{p.company || '-'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                        {TYPE_LABELS[p.type] || p.type}
                      </span>
                      {p.needsTypeReview && (
                        <span
                          title="Migrated from a legacy type — please reclassify if needed."
                          className="ml-2 inline-flex px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300"
                        >
                          Review
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">{p.shareCount}</td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-500 text-xs">
                      {p.lastSharedAt ? new Date(p.lastSharedAt).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.needsTypeReview && (
                        <button onClick={() => markReviewed(p.id)} className="text-amber-600 hover:text-amber-800 text-xs font-medium mr-3">Mark reviewed</button>
                      )}
                      <button onClick={() => openEdit(p)} className="text-blue-600 hover:text-blue-800 text-xs font-medium mr-3">Edit</button>
                      <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:text-red-700 text-xs font-medium">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {total > 0 && <p className="mt-3 text-xs text-gray-400">{total} partner{total !== 1 ? 's' : ''}</p>}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowModal(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {editingPartner ? 'Edit Partner' : 'Add Partner'}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder="John Smith"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder="john@example.com"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Company</label>
                  <input
                    type="text"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    placeholder="ABC Investments"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                >
                  {PARTNER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none"
                  placeholder="Buy criteria, preferred areas, budget range..."
                />
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {saving ? 'Saving...' : editingPartner ? 'Save Changes' : 'Add Partner'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
