'use client';

import { useEffect, useState } from 'react';
import { settingsAPI } from '@/lib/api';

interface Compliance {
  optOutEnabled: boolean;
  optOutText: string;
  senderIdEnabled: boolean;
  senderIdText: string;
  periodicEnabled: boolean;
  periodicDays: number;
}

const DEFAULTS: Compliance = {
  optOutEnabled: true,
  optOutText: 'Reply STOP to stop texting',
  senderIdEnabled: true,
  senderIdText: 'Quick Cash Home Buyers',
  periodicEnabled: false,
  periodicDays: 30,
};

/**
 * Settings > Messaging Compliance.
 *
 * Twilio does not prepend a sender name or append opt-out language, so these
 * two lines are what keeps outbound SMS compliant. They are attached in the
 * send path (not written by the AI) to the first message to each lead, and
 * again on an interval when periodic re-send is on.
 */
export default function MessagingCompliancePanel() {
  const [settings, setSettings] = useState<Compliance>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    settingsAPI
      .getCompliance()
      .then((res) => setSettings({ ...DEFAULTS, ...res.data }))
      .catch(() => setError('Could not load compliance settings'))
      .finally(() => setLoading(false));
  }, []);

  const patch = (p: Partial<Compliance>) => {
    setSettings((s) => ({ ...s, ...p }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await settingsAPI.updateCompliance(settings);
      setSettings({ ...DEFAULTS, ...res.data });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // What a seller actually sees appended to the message.
  const preview = [
    settings.senderIdEnabled ? settings.senderIdText : '',
    settings.optOutEnabled ? settings.optOutText : '',
  ]
    .filter(Boolean)
    .join('\n');

  if (loading) {
    return (
      <div className="card max-w-2xl mt-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Messaging Compliance</h3>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="card max-w-2xl mt-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Messaging Compliance</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        Automatically add opt-out instructions and your sender name. These are added to the first
        text we send a contact, and again at the interval you choose.
      </p>

      <div className="space-y-5">
        {/* Opt-out */}
        <div>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.optOutEnabled}
              onChange={(e) => patch({ optOutEnabled: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Make SMS compliant by adding an opt-out message
            </span>
          </label>
          <input
            type="text"
            value={settings.optOutText}
            disabled={!settings.optOutEnabled}
            maxLength={160}
            onChange={(e) => patch({ optOutText: e.target.value })}
            placeholder="Reply STOP to stop texting"
            className="mt-2 ml-[26px] w-[calc(100%-26px)] px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white disabled:opacity-50 disabled:bg-gray-50 dark:disabled:bg-gray-950"
          />
        </div>

        {/* Sender ID */}
        <div>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.senderIdEnabled}
              onChange={(e) => patch({ senderIdEnabled: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Make SMS compliant by adding sender information
            </span>
          </label>
          <input
            type="text"
            value={settings.senderIdText}
            disabled={!settings.senderIdEnabled}
            maxLength={160}
            onChange={(e) => patch({ senderIdText: e.target.value })}
            placeholder="Quick Cash Home Buyers"
            className="mt-2 ml-[26px] w-[calc(100%-26px)] px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white disabled:opacity-50 disabled:bg-gray-50 dark:disabled:bg-gray-950"
          />
        </div>

        {/* Periodic re-send */}
        <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
          <label className="flex items-start gap-2.5 cursor-pointer mt-4">
            <input
              type="checkbox"
              checked={settings.periodicEnabled}
              onChange={(e) => patch({ periodicEnabled: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Enable periodic opt-out
            </span>
          </label>
          <div className="mt-2 ml-[26px] flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Include sender ID and opt-out message every
            </span>
            <input
              type="number"
              min={1}
              max={365}
              value={settings.periodicDays}
              disabled={!settings.periodicEnabled}
              onChange={(e) => patch({ periodicDays: parseInt(e.target.value, 10) || 30 })}
              className="w-20 px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white disabled:opacity-50 disabled:bg-gray-50 dark:disabled:bg-gray-950"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">days</span>
          </div>
          <p className="mt-2 ml-[26px] text-xs text-gray-500 dark:text-gray-500">
            When off, the footer is only added to the very first text we send a contact.
          </p>
        </div>

        {/* Preview */}
        <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
          <div className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            Appended to the message
          </div>
          {preview ? (
            <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2">
              {preview}
            </pre>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Nothing will be appended. Outbound texts will carry no sender name or opt-out
              instructions.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 mt-6">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
        {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </div>
  );
}
