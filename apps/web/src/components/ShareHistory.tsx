'use client';

import { useState, useEffect } from 'react';
import { partnersAPI } from '@/lib/api';

interface DealShareRecord {
  id: string;
  channel: string;
  status: string;
  openCount: number;
  createdAt: string;
  openedAt: string | null;
  snapshotArv: number | null;
  partner: {
    id: string;
    name: string;
    email: string;
    company: string | null;
    type: string;
  };
}

const STATUS_STYLES: Record<string, string> = {
  sent: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  opened: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  expired: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  error: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
};

const CHANNEL_LABELS: Record<string, string> = {
  resend: 'Email',
  gmail: 'Gmail',
  'org-gmail': 'Team',
};

export default function ShareHistory({ leadId }: { leadId: string }) {
  const [shares, setShares] = useState<DealShareRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [resending, setResending] = useState<string | null>(null);

  useEffect(() => {
    fetchShares();
  }, [leadId]);

  const fetchShares = async () => {
    try {
      const { data } = await partnersAPI.getLeadShares(leadId);
      setShares(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleResend = async (shareId: string) => {
    setResending(shareId);
    try {
      await partnersAPI.resend(shareId);
      fetchShares();
    } catch { /* ignore */ }
    setResending(null);
  };

  if (loading) return null;
  if (shares.length === 0) return null;

  return (
    <div className="mt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
      >
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-medium">
          Shared {shares.length}x
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {shares.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-sm"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 dark:text-white truncate">
                  {s.partner.name}
                  {s.partner.company ? <span className="text-gray-400 font-normal"> - {s.partner.company}</span> : ''}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(s.createdAt).toLocaleDateString()} via {CHANNEL_LABELS[s.channel] || s.channel}
                  {s.openCount > 0 && ` · Opened ${s.openCount}x`}
                </p>
              </div>
              <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[s.status] || STATUS_STYLES.sent}`}>
                {s.status}
              </span>
              <button
                onClick={() => handleResend(s.id)}
                disabled={resending === s.id}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
              >
                {resending === s.id ? '...' : 'Resend'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
