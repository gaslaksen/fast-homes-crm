'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { settingsAPI } from '@/lib/api';
import AppNav from '@/components/AppNav';

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [initialDelaySec, setInitialDelaySec] = useState(60);
  const [nextQuestionDelaySec, setNextQuestionDelaySec] = useState(30);
  const [retryDelayHours, setRetryDelayHours] = useState(24);
  const [maxRetries, setMaxRetries] = useState(2);
  const [demoMode, setDemoMode] = useState(false);
  const [togglingDemo, setTogglingDemo] = useState(false);
  const [sendingDemo, setSendingDemo] = useState(false);
  const [aiSmsEnabled, setAiSmsEnabled] = useState(false);
  const [aiCallEnabled, setAiCallEnabled] = useState(false);
  const [callDelaySec, setCallDelaySec] = useState(120);
  const [togglingAiSms, setTogglingAiSms] = useState(false);
  const [togglingAiCall, setTogglingAiCall] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await settingsAPI.getDrip();
        const s = res.data;
        setInitialDelaySec(s.initialDelayMs / 1000);
        setNextQuestionDelaySec(s.nextQuestionDelayMs / 1000);
        setRetryDelayHours(s.retryDelayMs / 3600000);
        setMaxRetries(s.maxRetries);
        setDemoMode(s.demoMode ?? false);
        setAiSmsEnabled(s.aiSmsEnabled ?? false);
        setAiCallEnabled(s.aiCallEnabled ?? false);
        setCallDelaySec((s.callDelayMs ?? 120000) / 1000);
      } catch (error) {
        console.error('Failed to load drip settings:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await settingsAPI.updateDrip({
        initialDelayMs: Math.round(initialDelaySec * 1000),
        nextQuestionDelayMs: Math.round(nextQuestionDelaySec * 1000),
        retryDelayMs: Math.round(retryDelayHours * 3600000),
        maxRetries,
        demoMode,
        callDelayMs: Math.round(callDelaySec * 1000),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save drip settings:', error);
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav />
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Settings</h2>

        {/* AI Prompts Link */}
        <Link
          href="/settings/prompts"
          className="card max-w-2xl mb-6 flex items-center justify-between hover:shadow-md transition-shadow"
        >
          <div>
            <h3 className="text-lg font-semibold text-gray-900">AI Prompt Templates</h3>
            <p className="text-sm text-gray-600 mt-1">
              Manage the prompts that control how AI generates messages for different scenarios.
            </p>
          </div>
          <span className="text-primary-600 font-medium text-sm">Manage AI Prompts &rarr;</span>
        </Link>

        {/* Lead Management Link */}
        <Link
          href="/settings/leads"
          className="card max-w-2xl mb-6 flex items-center justify-between hover:shadow-md transition-shadow"
        >
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Lead Management</h3>
            <p className="text-sm text-gray-600 mt-1">
              Bulk delete leads, view stats by status/source/band, and clean up demo data.
            </p>
          </div>
          <span className="text-primary-600 font-medium text-sm">Manage Leads &rarr;</span>
        </Link>

        {/* Drip Sequence Card */}
        <div className="card max-w-2xl">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Drip Sequence</h3>
          <p className="text-sm text-gray-600 mb-6">
            Configure timing and retry behavior for automated CAMP question sequences.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Initial Delay (seconds)
              </label>
              <p className="text-xs text-gray-500 mb-1">
                How long to wait after a new lead arrives before sending the first message.
              </p>
              <input
                type="number"
                min={0}
                value={initialDelaySec}
                onChange={(e) => setInitialDelaySec(Number(e.target.value))}
                className="input w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Next Question Delay (seconds)
              </label>
              <p className="text-xs text-gray-500 mb-1">
                How long to wait after a seller replies before asking the next question.
              </p>
              <input
                type="number"
                min={0}
                value={nextQuestionDelaySec}
                onChange={(e) => setNextQuestionDelaySec(Number(e.target.value))}
                className="input w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Retry Delay (hours)
              </label>
              <p className="text-xs text-gray-500 mb-1">
                How long to wait with no reply before retrying the same question.
              </p>
              <input
                type="number"
                min={0}
                step={0.5}
                value={retryDelayHours}
                onChange={(e) => setRetryDelayHours(Number(e.target.value))}
                className="input w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Retries
              </label>
              <p className="text-xs text-gray-500 mb-1">
                Maximum number of retry attempts before giving up on a non-responsive seller.
              </p>
              <input
                type="number"
                min={0}
                max={10}
                value={maxRetries}
                onChange={(e) => setMaxRetries(Number(e.target.value))}
                className="input w-full"
              />
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn btn-primary"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            {saved && (
              <span className="text-sm text-green-600 font-medium">
                Settings saved successfully
              </span>
            )}
          </div>
        </div>

        {/* AI Outreach Card */}
        <div className="card max-w-2xl mt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">AI Outreach</h3>
          <p className="text-sm text-gray-600 mb-5">
            Control whether AI automatically contacts new leads. Turn both off to receive leads without any outreach firing.
            <span className="block mt-1 text-amber-600 font-medium">
              ⚠️ Keep both OFF until you&apos;re ready — only test numbers will receive messages while TEST_MODE is active.
            </span>
          </p>

          {/* AI SMS Toggle */}
          <div className="flex items-start justify-between py-4 border-b border-gray-100">
            <div className="flex-1 mr-6">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">AI Text Messages (SMS)</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${aiSmsEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {aiSmsEnabled ? 'ON' : 'OFF'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                When a new lead arrives, AI sends the first text and handles the CAMP qualification conversation via SmrtPhone.
              </p>
            </div>
            <button
              type="button"
              disabled={togglingAiSms}
              onClick={async () => {
                setTogglingAiSms(true);
                const newValue = !aiSmsEnabled;
                try {
                  const res = await settingsAPI.updateDrip({ aiSmsEnabled: newValue });
                  setAiSmsEnabled(res.data.aiSmsEnabled);
                } catch (err: any) {
                  alert('Failed to update: ' + (err.response?.data?.message || err.message));
                } finally {
                  setTogglingAiSms(false);
                }
              }}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                aiSmsEnabled ? 'bg-green-500' : 'bg-gray-300'
              } ${togglingAiSms ? 'opacity-50' : ''}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${aiSmsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* AI Call Toggle */}
          <div className="flex items-start justify-between py-4 border-b border-gray-100">
            <div className="flex-1 mr-6">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">AI Phone Calls (Vapi)</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${aiCallEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {aiCallEnabled ? 'ON' : 'OFF'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                After the call delay below, &ldquo;Alex&rdquo; calls the seller to gather CAMP details. Call results sync back to the lead record automatically.
              </p>
            </div>
            <button
              type="button"
              disabled={togglingAiCall}
              onClick={async () => {
                setTogglingAiCall(true);
                const newValue = !aiCallEnabled;
                try {
                  const res = await settingsAPI.updateDrip({ aiCallEnabled: newValue });
                  setAiCallEnabled(res.data.aiCallEnabled);
                } catch (err: any) {
                  alert('Failed to update: ' + (err.response?.data?.message || err.message));
                } finally {
                  setTogglingAiCall(false);
                }
              }}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                aiCallEnabled ? 'bg-green-500' : 'bg-gray-300'
              } ${togglingAiCall ? 'opacity-50' : ''}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${aiCallEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Call Delay */}
          <div className="pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Call Delay (seconds)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              How long after a new lead arrives before the AI call fires. Default is 120s (2 minutes) — gives the seller time to see your text first.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                value={callDelaySec}
                onChange={(e) => setCallDelaySec(Number(e.target.value))}
                className="input w-32"
              />
              <span className="text-sm text-gray-500">seconds ({Math.round(callDelaySec / 60 * 10) / 10} min)</span>
            </div>
            <div className="mt-3">
              <button onClick={handleSave} disabled={saving} className="btn btn-secondary text-sm">
                {saving ? 'Saving...' : 'Save Call Delay'}
              </button>
            </div>
          </div>
        </div>

        {/* Demo Mode Card */}
        <div className="card max-w-2xl mt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Demo Mode</h3>
          <p className="text-sm text-gray-600 mb-4">
            Demo mode overrides all delays to ~2 seconds so you can test the full drip sequence without waiting.
            Messages still simulate when Twilio isn&apos;t configured.
          </p>

          <div className="flex items-center gap-3 mb-6">
            <button
              type="button"
              disabled={togglingDemo}
              onClick={async () => {
                setTogglingDemo(true);
                const newValue = !demoMode;
                try {
                  const res = await settingsAPI.updateDrip({ demoMode: newValue });
                  setDemoMode(res.data.demoMode);
                } catch (err: any) {
                  alert('Failed to toggle demo mode: ' + (err.response?.data?.message || err.message));
                } finally {
                  setTogglingDemo(false);
                }
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                demoMode ? 'bg-primary-600' : 'bg-gray-300'
              } ${togglingDemo ? 'opacity-50' : ''}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  demoMode ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-sm font-medium text-gray-700">
              {togglingDemo ? 'Updating...' : 'Enable Demo Mode'}
            </span>
          </div>

          {demoMode && (
            <button
              onClick={async () => {
                setSendingDemo(true);
                try {
                  const res = await settingsAPI.sendDemoLead();
                  router.push(`/leads/${res.data.leadId}`);
                } catch (error) {
                  console.error('Failed to create demo lead:', error);
                  alert('Failed to create demo lead');
                } finally {
                  setSendingDemo(false);
                }
              }}
              disabled={sendingDemo}
              className="btn btn-primary"
            >
              {sendingDemo ? 'Creating...' : 'Send Test Lead'}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
