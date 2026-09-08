'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { surplusAPI } from '@/lib/api';

/**
 * The surplus scripts and letters, one active version per kind.
 *
 * Saving never overwrites: it creates the next version and makes it active,
 * because the call log stamps "phone script v3" on every call and that has to
 * keep meaning one exact set of words. Older versions stay in the list and can
 * be brought back.
 */

interface TemplateKind {
  kind: string;
  label: string;
  version: number;
  name: string | null;
  subject: string | null;
  body: string;
  builtIn: boolean;
  hasText: boolean;
  lastReviewedAt: string | null;
  updatedAt: string | null;
  versionCount: number;
}

interface Version {
  version: number;
  name: string | null;
  active: boolean;
  notes: string | null;
  body: string;
  subject: string | null;
  createdAt: string;
}

const EMAIL_KINDS = new Set(['credibility_email']);

export default function SurplusTemplatesPage() {
  const [kinds, setKinds] = useState<TemplateKind[]>([]);
  const [mergeFields, setMergeFields] = useState<{ key: string; meaning: string }[]>([]);
  const [selected, setSelected] = useState<string>('phone_script');
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<Version[]>([]);
  const [body, setBody] = useState('');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const say = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    try {
      const r = await surplusAPI.templates();
      setKinds(r.data?.kinds || []);
      setMergeFields(r.data?.mergeFields || []);
    } catch {
      say('The templates could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const current = kinds.find((k) => k.kind === selected) || null;

  // Selecting a kind loads its text into the editor and its history below.
  useEffect(() => {
    if (!current) return;
    setBody(current.body);
    setName(current.name || '');
    setSubject(current.subject || '');
    setNotes('');
    setDirty(false);
    surplusAPI
      .templateVersions(current.kind)
      .then((r) => setVersions(r.data?.versions || []))
      .catch(() => setVersions([]));
    // Only when the kind or its active version changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.kind, current?.version]);

  const save = async () => {
    if (!current || !body.trim() || saving) return;
    setSaving(true);
    try {
      const r = await surplusAPI.saveTemplate(current.kind, {
        body,
        name: name || undefined,
        subject: EMAIL_KINDS.has(current.kind) ? subject || undefined : undefined,
        notes: notes || undefined,
      });
      say(`Saved ${current.label} as v${r.data?.version}. It is now what the dialer shows.`);
      await load();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const activate = async (version: number) => {
    if (!current) return;
    const what = version === 0 ? 'the built-in text' : `v${version}`;
    if (!window.confirm(`Make ${what} the active ${current.label.toLowerCase()}?`)) return;
    try {
      await surplusAPI.activateTemplate(current.kind, version);
      say(`${current.label} is now ${what}.`);
      await load();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That version could not be activated.');
    }
  };

  return (
    <AppShell>
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link href="/settings" className="text-sm text-primary-600 hover:underline">
            &larr; Settings
          </Link>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-2">Surplus Scripts and Letters</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">
            What the dialer shows during a Dig Deeper call, and the letters the team sends. Saving makes a new
            version; every call records the version that was on screen, so wording can be tested against
            connect and close rates.
          </p>
        </div>

        {toast && (
          <div className="mb-4 max-w-2xl rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-800 dark:text-primary-200 text-sm px-4 py-2">
            {toast}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_260px] gap-6 items-start">
            {/* Kinds */}
            <div className="card p-0 overflow-hidden">
              {kinds.map((k) => (
                <button
                  key={k.kind}
                  onClick={() => {
                    if (dirty && !window.confirm('Discard the unsaved edit?')) return;
                    setSelected(k.kind);
                  }}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-b-0 ${
                    k.kind === selected
                      ? 'bg-primary-50 dark:bg-primary-900/20'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                  }`}
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{k.label}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {k.hasText ? (k.builtIn ? 'Built-in text' : `v${k.version}`) : 'Not written yet'}
                    {k.versionCount ? ` · ${k.versionCount} saved` : ''}
                  </div>
                </button>
              ))}
            </div>

            {/* Editor */}
            {current && (
              <div className="card">
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{current.label}</h3>
                  <span className="text-xs text-gray-500">
                    Active: {current.builtIn ? 'built-in text' : `v${current.version}`}
                  </span>
                </div>

                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Version name
                </label>
                <input
                  className="input w-full mb-3"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="For the history list, e.g. Softer opening"
                />

                {EMAIL_KINDS.has(current.kind) && (
                  <>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Subject
                    </label>
                    <input
                      className="input w-full mb-3"
                      value={subject}
                      onChange={(e) => {
                        setSubject(e.target.value);
                        setDirty(true);
                      }}
                    />
                  </>
                )}

                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Text</label>
                <textarea
                  className="input w-full font-mono text-[13px] leading-relaxed"
                  rows={22}
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    setDirty(true);
                  }}
                  placeholder={`Write the ${current.label.toLowerCase()}. Merge fields go in double braces, like {{claimantFirstName}}.`}
                />

                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 mt-3">
                  What changed and why
                </label>
                <input
                  className="input w-full mb-4"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional. Shown in the version history."
                />

                <div className="flex items-center gap-3">
                  <button
                    onClick={save}
                    disabled={saving || !body.trim() || !dirty}
                    className="btn-primary disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : `Save as v${(versions[0]?.version || 0) + 1}`}
                  </button>
                  {dirty && <span className="text-xs text-gray-500">Unsaved edit</span>}
                </div>

                {versions.length > 0 && (
                  <div className="mt-6">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">History</h4>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-100 dark:border-gray-800 rounded-lg">
                      {versions.map((v) => (
                        <div key={v.version} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <span className="font-medium text-gray-900 dark:text-gray-100">v{v.version}</span>
                            {v.name && <span className="text-gray-600 dark:text-gray-400"> · {v.name}</span>}
                            <span className="text-gray-400 text-xs"> · {new Date(v.createdAt).toLocaleDateString()}</span>
                            {v.notes && <div className="text-xs text-gray-500 truncate">{v.notes}</div>}
                          </div>
                          {v.active ? (
                            <span className="text-xs font-semibold text-green-700 dark:text-green-400 whitespace-nowrap">
                              Active
                            </span>
                          ) : (
                            <button
                              onClick={() => activate(v.version)}
                              className="text-xs text-primary-600 hover:underline whitespace-nowrap"
                            >
                              Make active
                            </button>
                          )}
                        </div>
                      ))}
                      {!current.builtIn && (
                        <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="text-gray-600 dark:text-gray-400">Built-in text</span>
                          <button
                            onClick={() => activate(0)}
                            className="text-xs text-primary-600 hover:underline whitespace-nowrap"
                          >
                            Make active
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Merge fields */}
            <div className="card">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Merge fields</h4>
              <p className="text-xs text-gray-500 mb-3">
                Filled per claimant when the script opens. A field the app cannot fill is left as written so the
                gap is seen, not hidden.
              </p>
              <dl className="space-y-2">
                {mergeFields.map((f) => (
                  <div key={f.key}>
                    <dt className="font-mono text-[12px] text-gray-900 dark:text-gray-100">{`{{${f.key}}}`}</dt>
                    <dd className="text-[11.5px] text-gray-500 leading-snug">{f.meaning}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
