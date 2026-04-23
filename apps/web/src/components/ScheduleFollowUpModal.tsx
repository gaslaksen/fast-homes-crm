'use client';

import { useEffect, useMemo, useState } from 'react';
import { leadsAPI } from '@/lib/api';

type ActionType = 'call' | 'text' | 'email' | 'custom';

interface LeadSummary {
  id: string;
  propertyAddress: string;
  propertyCity?: string;
  propertyState?: string;
  sellerFirstName?: string;
  sellerLastName?: string;
}

interface ScheduleFollowUpModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  /** If provided, skip the lead picker and pre-fill. */
  lead?: LeadSummary;
}

function quickOption(label: string, date: Date) {
  return { label, date };
}

function buildQuickOptions(): Array<{ label: string; date: Date }> {
  const now = new Date();
  const in1h = new Date(now.getTime() + 60 * 60 * 1000);
  const tomorrow9 = new Date(now);
  tomorrow9.setDate(tomorrow9.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);
  const in3Days = new Date(now);
  in3Days.setDate(in3Days.getDate() + 3);
  in3Days.setHours(9, 0, 0, 0);
  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  nextWeek.setHours(9, 0, 0, 0);
  return [
    quickOption('In 1 hour', in1h),
    quickOption('Tomorrow 9am', tomorrow9),
    quickOption('In 3 days', in3Days),
    quickOption('Next week', nextWeek),
  ];
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function leadLabel(lead: LeadSummary): string {
  const name = [lead.sellerFirstName, lead.sellerLastName].filter(Boolean).join(' ');
  const loc = [lead.propertyCity, lead.propertyState].filter(Boolean).join(', ');
  return [name, lead.propertyAddress, loc].filter(Boolean).join(' — ');
}

export default function ScheduleFollowUpModal({
  open,
  onClose,
  onCreated,
  lead: preLead,
}: ScheduleFollowUpModalProps) {
  const [selectedLead, setSelectedLead] = useState<LeadSummary | null>(preLead || null);
  const [query, setQuery] = useState('');
  const [allLeads, setAllLeads] = useState<LeadSummary[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);

  const [scheduledAt, setScheduledAt] = useState<string>(() =>
    toDatetimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)),
  );
  const [actionType, setActionType] = useState<ActionType>('call');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedLead(preLead || null);
    setQuery('');
    setNotes('');
    setActionType('call');
    setScheduledAt(toDatetimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)));
    setError(null);
  }, [open, preLead]);

  useEffect(() => {
    if (!open || preLead) return;
    setLeadsLoading(true);
    leadsAPI
      .list({ limit: 100 })
      .then((res) => {
        const data = res.data;
        const arr: LeadSummary[] = Array.isArray(data) ? data : data?.leads || [];
        setAllLeads(arr);
      })
      .catch(() => setAllLeads([]))
      .finally(() => setLeadsLoading(false));
  }, [open, preLead]);

  const filteredLeads = useMemo(() => {
    if (!query.trim()) return allLeads.slice(0, 10);
    const q = query.toLowerCase();
    return allLeads
      .filter((l) => {
        const hay = [
          l.propertyAddress,
          l.propertyCity,
          l.propertyState,
          l.sellerFirstName,
          l.sellerLastName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 10);
  }, [query, allLeads]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) {
      setError('Pick a lead first');
      return;
    }
    const date = new Date(scheduledAt);
    if (Number.isNaN(date.getTime())) {
      setError('Invalid date');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await leadsAPI.createTask(selectedLead.id, {
        title: `Follow up: ${actionType}`,
        description: notes || undefined,
        dueDate: date.toISOString(),
      });
      onCreated?.();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to schedule');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Schedule follow-up
          </h2>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Lead picker */}
          {preLead ? (
            <div className="text-sm bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
              <div className="text-[10px] font-semibold uppercase text-gray-400 mb-0.5">Lead</div>
              <div className="truncate">{leadLabel(preLead)}</div>
            </div>
          ) : selectedLead ? (
            <div className="text-sm bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 flex items-center justify-between">
              <div className="truncate flex-1">{leadLabel(selectedLead)}</div>
              <button
                type="button"
                className="text-xs text-teal-600 hover:underline ml-2"
                onClick={() => setSelectedLead(null)}
              >
                Change
              </button>
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Lead
              </label>
              <input
                type="text"
                className="input w-full mt-1"
                placeholder="Search by address or seller name…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              {leadsLoading ? (
                <div className="text-xs text-gray-400 mt-2 animate-pulse">Loading…</div>
              ) : (
                <ul className="mt-2 max-h-52 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredLeads.length === 0 && (
                    <li className="text-xs text-gray-400 px-3 py-2">No matches</li>
                  )}
                  {filteredLeads.map((l) => (
                    <li key={l.id}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                        onClick={() => setSelectedLead(l)}
                      >
                        <div className="font-medium text-gray-800 dark:text-gray-200 truncate">
                          {[l.sellerFirstName, l.sellerLastName].filter(Boolean).join(' ') || l.propertyAddress}
                        </div>
                        <div className="text-gray-400 truncate">{l.propertyAddress}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Quick options */}
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              When
            </label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {buildQuickOptions().map((q) => (
                <button
                  key={q.label}
                  type="button"
                  className="text-xs px-2 py-1 rounded-full border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => setScheduledAt(toDatetimeLocalValue(q.date))}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <input
              type="datetime-local"
              className="input w-full mt-2"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>

          {/* Action type */}
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Action
            </label>
            <div className="grid grid-cols-4 gap-1.5 mt-1">
              {(['call', 'text', 'email', 'custom'] as ActionType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`text-xs py-1.5 rounded-md border capitalize ${
                    actionType === t
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                  onClick={() => setActionType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Notes (optional)
            </label>
            <textarea
              className="input w-full mt-1 text-sm"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error && (
            <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
          )}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
              {submitting ? 'Scheduling…' : 'Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
