'use client';

import { useEffect, useState } from 'react';
import { settingsAPI } from '@/lib/api';
import { formatPhoneDisplay } from '@/lib/format';

interface PhoneNumber {
  id: string;
  number: string;
  label: string;
  smsEnabled: boolean;
  voiceEnabled: boolean;
  isDefault: boolean;
  active: boolean;
}

const pretty = (raw: string) => (raw ? formatPhoneDisplay(raw) : '');

/**
 * Settings > Phone Numbers.
 *
 * One list drives both the dialer's "Calling From" picker and the SMS
 * composer's "From" picker. Adding a number here does not buy it from Twilio;
 * it has to already exist on the account, with its webhooks pointed at this API.
 */
export default function PhoneNumbersPanel() {
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newNumber, setNewNumber] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const load = async () => {
    try {
      const res = await settingsAPI.listPhoneNumbers();
      setNumbers(res.data || []);
    } catch {
      setError('Could not load phone numbers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const patch = async (id: string, data: Partial<PhoneNumber>) => {
    setBusyId(id);
    setError(null);
    try {
      await settingsAPI.updatePhoneNumber(id, data as any);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not update that number');
    } finally {
      setBusyId(null);
    }
  };

  const add = async () => {
    setError(null);
    try {
      await settingsAPI.addPhoneNumber({ number: newNumber, label: newLabel || undefined });
      setNewNumber('');
      setNewLabel('');
      setAdding(false);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not add that number');
    }
  };

  const remove = async (n: PhoneNumber) => {
    if (!confirm(`Remove ${pretty(n.number)} from Dealcore? This does not release it in Twilio.`)) return;
    setBusyId(n.id);
    setError(null);
    try {
      await settingsAPI.deletePhoneNumber(n.id);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not remove that number');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="card max-w-2xl mt-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Phone Numbers</h3>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="card max-w-2xl mt-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Phone Numbers</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        The numbers you can call and text from. The default is used for the first contact with a new
        lead; replies always go back out from whichever number that seller already knows.
      </p>

      {numbers.length === 0 && (
        <p className="text-sm text-amber-600 dark:text-amber-400 mb-4">
          No numbers configured. Calling and texting will fall back to the number in
          TWILIO_PHONE_NUMBER.
        </p>
      )}

      <div className="divide-y divide-gray-100 dark:divide-gray-800 border-y border-gray-100 dark:border-gray-800">
        {numbers.map((n) => (
          <div key={n.id} className={`py-3 ${n.active ? '' : 'opacity-50'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {pretty(n.number)}
                  </span>
                  {n.isDefault && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 font-semibold">
                      Default
                    </span>
                  )}
                  {!n.active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">
                      Inactive
                    </span>
                  )}
                </div>
                <input
                  value={n.label}
                  disabled={busyId === n.id}
                  onChange={(e) =>
                    setNumbers((list) =>
                      list.map((x) => (x.id === n.id ? { ...x, label: e.target.value } : x)),
                    )
                  }
                  onBlur={(e) => patch(n.id, { label: e.target.value })}
                  className="mt-1 text-xs text-gray-500 dark:text-gray-400 bg-transparent border-b border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-teal-400 outline-none"
                />
              </div>

              <div className="flex items-center gap-3 shrink-0 pt-0.5">
                <Toggle
                  label="SMS"
                  checked={n.smsEnabled}
                  disabled={busyId === n.id}
                  onChange={(v) => patch(n.id, { smsEnabled: v })}
                />
                <Toggle
                  label="Voice"
                  checked={n.voiceEnabled}
                  disabled={busyId === n.id}
                  onChange={(v) => patch(n.id, { voiceEnabled: v })}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 mt-2 text-xs">
              {!n.isDefault && n.active && (
                <button
                  onClick={() => patch(n.id, { isDefault: true })}
                  disabled={busyId === n.id}
                  className="text-teal-700 dark:text-teal-400 hover:underline disabled:opacity-50"
                >
                  Make default
                </button>
              )}
              {!n.isDefault && (
                <button
                  onClick={() => patch(n.id, { active: !n.active })}
                  disabled={busyId === n.id}
                  className="text-gray-500 hover:underline disabled:opacity-50"
                >
                  {n.active ? 'Deactivate' : 'Reactivate'}
                </button>
              )}
              {!n.isDefault && (
                <button
                  onClick={() => remove(n)}
                  disabled={busyId === n.id}
                  className="text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="mt-4 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
              placeholder="(704) 529-9523"
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label (optional)"
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </div>
          <p className="text-xs text-gray-400">
            The number must already exist in your Twilio account with its webhooks pointed at
            Dealcore.
          </p>
          <div className="flex gap-2">
            <button
              onClick={add}
              disabled={!newNumber.trim()}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={() => { setAdding(false); setNewNumber(''); setNewLabel(''); setError(null); }}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-4 text-sm font-medium text-teal-700 dark:text-teal-400 hover:underline"
        >
          + Add a number
        </button>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function Toggle({
  label, checked, disabled, onChange,
}: {
  label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
    </label>
  );
}
