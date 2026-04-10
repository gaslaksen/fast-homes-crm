'use client';

import { useEffect, useState } from 'react';
import { sellerPortalAPI } from '@/lib/api';

interface SellerPortalPanelProps {
  leadId: string;
}

export default function SellerPortalPanel({ leadId }: SellerPortalPanelProps) {
  const [portal, setPortal] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const fetchPortal = () => {
    sellerPortalAPI.getInfo(leadId)
      .then((res) => setPortal(res.data))
      .catch(() => setPortal(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchPortal(); }, [leadId]);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const res = await sellerPortalAPI.create(leadId);
      setPortal(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create portal');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = () => {
    if (portal?.portalUrl) {
      navigator.clipboard.writeText(portal.portalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSendLink = async () => {
    setSending(true);
    setError('');
    try {
      await sellerPortalAPI.sendLink(leadId);
      fetchPortal();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to send portal link');
    } finally {
      setSending(false);
    }
  };

  const handleToggle = async () => {
    if (!portal) return;
    const newStatus = portal.status === 'active' ? 'disabled' : 'active';
    try {
      await sellerPortalAPI.updateStatus(leadId, newStatus);
      fetchPortal();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update portal');
    }
  };

  if (loading) return null;

  // No portal exists — show create button
  if (!portal) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Seller Portal</h3>
        <p className="text-xs text-gray-500 mb-3">
          Create a branded property page for this seller where they can view details, upload photos, and respond to offers.
        </p>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="w-full px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create Seller Portal'}
        </button>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>
    );
  }

  const isActive = portal.status === 'active';

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Seller Portal</h3>
        <button
          onClick={handleToggle}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            isActive ? 'bg-green-500' : 'bg-gray-300'
          }`}
          title={isActive ? 'Disable portal' : 'Enable portal'}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              isActive ? 'translate-x-4.5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {isActive ? (
        <>
          {/* URL with copy */}
          <div className="flex items-center gap-2 mb-3">
            <input
              readOnly
              value={portal.portalUrl || ''}
              className="flex-1 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 truncate"
            />
            <button
              onClick={handleCopy}
              className="px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200 transition whitespace-nowrap"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
            <span>Opened: <strong className="text-gray-700">{portal.openCount || 0}</strong> times</span>
            {portal.lastOpenedAt && (
              <span>Last: <strong className="text-gray-700">{new Date(portal.lastOpenedAt).toLocaleDateString()}</strong></span>
            )}
            {portal.portalLinkSentAt && (
              <span className="text-green-600">Link sent {new Date(portal.portalLinkSentAt).toLocaleDateString()}</span>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleSendLink}
              disabled={sending}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition disabled:opacity-50"
            >
              {sending ? 'Sending...' : portal.portalLinkSentAt ? 'Resend Portal Link' : 'Send Portal Link'}
            </button>
            <a
              href={portal.portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200 transition"
            >
              View Portal
            </a>
          </div>

          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </>
      ) : (
        <p className="text-xs text-gray-400">Portal is disabled. Toggle to enable.</p>
      )}
    </div>
  );
}
