'use client';

import { useState, useEffect } from 'react';
import { partnersAPI } from '@/lib/api';

interface Partner {
  id: string;
  name: string;
  email: string;
  company: string | null;
  type: string;
}

interface Props {
  leadId: string;
  propertyAddress?: string;
  isOpen: boolean;
  onClose: () => void;
  onShared?: () => void;
}

const CHANNEL_OPTIONS = [
  { value: 'resend', label: 'DealCore Email', desc: 'Send from noreply@mydealcore.com' },
  { value: 'gmail', label: 'My Gmail', desc: 'Send from your connected Gmail' },
  { value: 'org-gmail', label: 'Team Gmail', desc: 'Send from shared team Gmail' },
];

export default function ShareDealModal({ leadId, propertyAddress, isOpen, onClose, onShared }: Props) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState('resend');
  const [subject, setSubject] = useState('');
  const [personalNote, setPersonalNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
  const [error, setError] = useState('');

  // Inline add partner
  const [showAddPartner, setShowAddPartner] = useState(false);
  const [newPartner, setNewPartner] = useState({ name: '', email: '', company: '', type: 'buyer' });
  const [addingPartner, setAddingPartner] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedIds(new Set());
      setChannel('resend');
      setSubject(propertyAddress ? `Deal Opportunity: ${propertyAddress}` : '');
      setPersonalNote('');
      setResult(null);
      setError('');
      setShowAddPartner(false);
      fetchPartners();
    }
  }, [isOpen]);

  const fetchPartners = async () => {
    setLoading(true);
    try {
      const { data } = await partnersAPI.list({ limit: 100 });
      setPartners(data.partners);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const togglePartner = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddPartner = async () => {
    if (!newPartner.name.trim() || !newPartner.email.trim()) return;
    setAddingPartner(true);
    try {
      const { data } = await partnersAPI.create(newPartner);
      setPartners((prev) => [...prev, data]);
      setSelectedIds((prev) => new Set(prev).add(data.id));
      setShowAddPartner(false);
      setNewPartner({ name: '', email: '', company: '', type: 'buyer' });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to add partner');
    }
    setAddingPartner(false);
  };

  const handleSend = async () => {
    if (selectedIds.size === 0) {
      setError('Select at least one partner');
      return;
    }
    setSending(true);
    setError('');
    try {
      const { data } = await partnersAPI.shareDeal({
        leadId,
        partnerIds: Array.from(selectedIds),
        channel,
        personalNote: personalNote.trim() || undefined,
        emailSubject: subject.trim() || undefined,
      });
      setResult({ sent: data.sent, failed: data.failed });
      onShared?.();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to share deal');
    }
    setSending(false);
  };

  if (!isOpen) return null;

  const filteredPartners = search
    ? partners.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.email.toLowerCase().includes(search.toLowerCase()) ||
        (p.company && p.company.toLowerCase().includes(search.toLowerCase()))
      )
    : partners;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Share Deal</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
            Send a deal package to your buyer partners
          </p>

          {result ? (
            /* Success state */
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 mx-auto mb-4 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="text-lg font-medium text-gray-900 dark:text-white">
                Deal shared with {result.sent} partner{result.sent !== 1 ? 's' : ''}
              </p>
              {result.failed > 0 && (
                <p className="text-sm text-red-500 mt-1">{result.failed} failed to send</p>
              )}
              <button
                onClick={onClose}
                className="mt-6 px-6 py-2 text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Partner selection */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Select Partners</label>
                <input
                  type="text"
                  placeholder="Search partners..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white mb-2"
                />
                <div className="max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
                  {loading ? (
                    <div className="p-3 text-sm text-gray-400 text-center">Loading...</div>
                  ) : filteredPartners.length === 0 ? (
                    <div className="p-3 text-sm text-gray-400 text-center">No partners found</div>
                  ) : (
                    filteredPartners.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(p.id)}
                          onChange={() => togglePartner(p.id)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{p.name}</p>
                            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              p.type === 'jv_partner' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' :
                              p.type === 'hedge_fund' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                              p.type === 'fix_and_flip' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' :
                              'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                            }`}>
                              {p.type === 'jv_partner' ? 'JV' : p.type === 'hedge_fund' ? 'Fund' : p.type === 'fix_and_flip' ? 'Flip' : p.type === 'other' ? 'Other' : 'Buyer'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{p.email}{p.company ? ` - ${p.company}` : ''}</p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
                {selectedIds.size > 0 && (
                  <p className="mt-1 text-xs text-blue-600">{selectedIds.size} selected</p>
                )}

                {/* Add new partner inline */}
                {!showAddPartner ? (
                  <button
                    onClick={() => setShowAddPartner(true)}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    + Add new partner
                  </button>
                ) : (
                  <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Name *"
                        value={newPartner.name}
                        onChange={(e) => setNewPartner({ ...newPartner, name: e.target.value })}
                        className="px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                      />
                      <input
                        type="email"
                        placeholder="Email *"
                        value={newPartner.email}
                        onChange={(e) => setNewPartner({ ...newPartner, email: e.target.value })}
                        className="px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Company"
                        value={newPartner.company}
                        onChange={(e) => setNewPartner({ ...newPartner, company: e.target.value })}
                        className="flex-1 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                      />
                      <button
                        onClick={handleAddPartner}
                        disabled={addingPartner}
                        className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        {addingPartner ? '...' : 'Add'}
                      </button>
                      <button
                        onClick={() => setShowAddPartner(false)}
                        className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Channel */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Send Via</label>
                <div className="grid grid-cols-3 gap-2">
                  {CHANNEL_OPTIONS.map((ch) => (
                    <button
                      key={ch.value}
                      onClick={() => setChannel(ch.value)}
                      className={`p-2 text-left rounded-lg border text-xs transition ${
                        channel === ch.value
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                          : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                      }`}
                    >
                      <p className="font-medium">{ch.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Email Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>

              {/* Personal Note */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Personal Note (optional)</label>
                <textarea
                  value={personalNote}
                  onChange={(e) => setPersonalNote(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none"
                  placeholder="This one matches your buy box — 3/2 under $200k ARV in your target area..."
                />
              </div>

              {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSend}
                  disabled={sending || selectedIds.size === 0}
                  className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {sending ? 'Sending...' : `Share with ${selectedIds.size || 0} Partner${selectedIds.size !== 1 ? 's' : ''}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
