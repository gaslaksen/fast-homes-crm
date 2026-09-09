'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { surplusAPI } from '@/lib/api';

/**
 * What each county requires to file a surplus claim, once per county.
 *
 * The course keeps this at the county level because every case filed there
 * reuses the same answer. Each row carries a last-verified date and goes
 * amber after 180 days, so a clerk changing its form or its mailing rule
 * gets noticed on the next look rather than on a rejected filing.
 */

interface County {
  id: string;
  name: string;
  state: string;
  active: boolean;
  feedKey: string | null;
  courtRecordsUrl: string | null;
  surplusListUrl: string | null;
  claimFormUrl: string | null;
  /** The stored copy of the county's form, when one has been uploaded. */
  claimFormFile: { name: string } | null;
  assignmentPreference: string | null;
  acceptedMethods: string[];
  signatureRequired: boolean | null;
  attorneyRequired: boolean | null;
  clerkContactName: string | null;
  clerkContactPhone: string | null;
  clerkContactEmail: string | null;
  clerkAddress: string | null;
  notes: string | null;
  practiceRunAt: string | null;
  lastVerifiedAt: string | null;
  stale: boolean;
  unknowns: string[];
}

const METHODS: [string, string][] = [
  ['usps', 'USPS'],
  ['fedex', 'FedEx'],
  ['ups', 'UPS'],
  ['in_person', 'In person'],
  ['efile', 'E-file'],
];

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
}

/** Yes / No / Not asked, for the two booleans that can be null. */
function TriState({
  value,
  onChange,
  label,
}: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  label: string;
}) {
  const opts: [boolean | null, string][] = [
    [null, 'Not asked'],
    [true, 'Yes'],
    [false, 'No'],
  ];
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <div className="flex gap-1.5">
        {opts.map(([v, l]) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            className={`px-2.5 py-1 text-xs rounded-md border ${
              value === v
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 font-semibold'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SurplusCountiesPage() {
  const [counties, setCounties] = useState<County[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<County>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const say = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    try {
      const r = await surplusAPI.counties();
      const rows: County[] = r.data?.counties || [];
      setCounties(rows);
      setSelectedId((cur) => cur || rows[0]?.id || null);
    } catch {
      say('The counties could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const current = counties.find((c) => c.id === selectedId) || null;

  useEffect(() => {
    if (!current) return;
    setForm({ ...current });
    setDirty(false);
    // Only when the selection or the saved row changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.lastVerifiedAt, current?.notes]);

  const set = (patch: Partial<County>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  const save = async () => {
    if (!current || saving) return;
    setSaving(true);
    try {
      await surplusAPI.updateCounty(current.id, {
        active: form.active,
        courtRecordsUrl: form.courtRecordsUrl || null,
        surplusListUrl: form.surplusListUrl || null,
        claimFormUrl: form.claimFormUrl || null,
        assignmentPreference: form.assignmentPreference || null,
        acceptedMethods: form.acceptedMethods || [],
        signatureRequired: form.signatureRequired ?? null,
        attorneyRequired: form.attorneyRequired ?? null,
        clerkContactName: form.clerkContactName || null,
        clerkContactPhone: form.clerkContactPhone || null,
        clerkContactEmail: form.clerkContactEmail || null,
        clerkAddress: form.clerkAddress || null,
        notes: form.notes || null,
        practiceRunAt: form.practiceRunAt || null,
      });
      say(`${current.name} saved.`);
      await load();
    } catch (err: any) {
      say(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const verify = async () => {
    if (!current) return;
    if (dirty && !window.confirm('Save your edits first? Verifying records the answers as they are saved.')) return;
    try {
      if (dirty) await save();
      await surplusAPI.verifyCounty(current.id);
      say(`${current.name} verified today.`);
      await load();
    } catch (err: any) {
      say(err?.response?.data?.message || 'Could not mark verified.');
    }
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const r = await surplusAPI.createCounty(name);
      setNewName('');
      say(`${name} added as a candidate county.`);
      await load();
      setSelectedId(r.data?.id || null);
    } catch (err: any) {
      say(err?.response?.data?.message || 'That county could not be added.');
    }
  };

  const formFileRef = useRef<HTMLInputElement>(null);
  const [uploadingForm, setUploadingForm] = useState(false);
  const [storageOk, setStorageOk] = useState(false);
  useEffect(() => {
    surplusAPI
      .storageStatus()
      .then((r) => setStorageOk(!!r.data?.configured))
      .catch(() => setStorageOk(false));
  }, []);

  const onFormFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !current) return;
    setUploadingForm(true);
    try {
      await surplusAPI.uploadCountyForm(current.id, f);
      say(`${f.name} stored for ${current.name}.`);
      await load();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The form could not be uploaded.');
    } finally {
      setUploadingForm(false);
    }
  };

  const openForm = async () => {
    if (!current) return;
    try {
      const r = await surplusAPI.countyFormUrl(current.id);
      window.open(r.data?.url, '_blank', 'noopener');
    } catch (err: any) {
      say(err?.response?.data?.message || 'The form could not be opened.');
    }
  };

  const removeForm = async () => {
    if (!current || !window.confirm(`Remove the stored claim form for ${current.name}?`)) return;
    try {
      await surplusAPI.removeCountyForm(current.id);
      say('Stored form removed.');
      await load();
    } catch (err: any) {
      say(err?.response?.data?.message || 'The form could not be removed.');
    }
  };

  const toggleMethod = (m: string) => {
    const cur = new Set(form.acceptedMethods || []);
    if (cur.has(m)) cur.delete(m);
    else cur.add(m);
    set({ acceptedMethods: Array.from(cur) });
  };

  return (
    <AppShell>
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link href="/settings" className="text-sm text-primary-600 hover:underline">
            &larr; Settings
          </Link>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-2">Surplus Counties</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">
            What each clerk requires to file a claim. Answers come from asking the clerk, not from guessing, and
            each county goes amber 180 days after it was last checked.
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
          <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
            <div>
              <div className="card p-0 overflow-hidden">
                {counties.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      if (dirty && !window.confirm('Discard the unsaved edit?')) return;
                      setSelectedId(c.id);
                    }}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-b-0 ${
                      c.id === selectedId ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.name}</span>
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          c.stale
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'
                            : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                        }`}
                      >
                        {c.lastVerifiedAt ? (c.stale ? 'Recheck' : 'Verified') : 'Not checked'}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {c.active ? 'Active' : 'Candidate'}
                      {c.feedKey ? ' · automated feed' : ''}
                      {c.unknowns.length ? ` · ${c.unknowns.length} unanswered` : ' · complete'}
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  className="input flex-1"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Add a county"
                  onKeyDown={(e) => e.key === 'Enter' && add()}
                />
                <button onClick={add} disabled={!newName.trim()} className="btn-primary disabled:opacity-50">
                  Add
                </button>
              </div>
            </div>

            {current && (
              <div className="card">
                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{current.name} County</h3>
                    <p className="text-xs text-gray-500">
                      {current.lastVerifiedAt
                        ? `Last checked with the clerk ${fmt(current.lastVerifiedAt)}${current.stale ? '. Older than 180 days, recheck before the next filing.' : '.'}`
                        : 'Never checked with the clerk. Ask before the first filing.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                      <input type="checkbox" checked={!!form.active} onChange={(e) => set({ active: e.target.checked })} />
                      Active county
                    </label>
                    <button onClick={verify} className="text-xs px-3 py-1.5 rounded-md border border-green-600 text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20">
                      Checked with the clerk today
                    </button>
                  </div>
                </div>

                {current.unknowns.length > 0 && (
                  <div className="mb-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                    Still to find out: {current.unknowns.join(', ')}.
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">County claim form (link to the clerk's copy)</label>
                    <input className="input w-full" value={form.claimFormUrl || ''} onChange={(e) => set({ claimFormUrl: e.target.value })} placeholder="https://" />
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <input ref={formFileRef} type="file" accept=".pdf" className="hidden" onChange={onFormFile} />
                      {current.claimFormFile ? (
                        <>
                          <span className="text-gray-600 dark:text-gray-400">Stored copy: {current.claimFormFile.name}</span>
                          <button type="button" onClick={openForm} className="text-primary-600 hover:underline">
                            Open
                          </button>
                          <button type="button" onClick={() => formFileRef.current?.click()} className="text-primary-600 hover:underline">
                            Replace
                          </button>
                          <button type="button" onClick={removeForm} className="text-red-600 hover:underline">
                            Remove
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => formFileRef.current?.click()}
                          disabled={!storageOk}
                          title={storageOk ? 'Upload the county form as a PDF' : 'Document storage is not configured on the API'}
                          className="px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                        >
                          {uploadingForm ? 'Uploading...' : 'Upload a stored copy (PDF)'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Court records search</label>
                    <input className="input w-full" value={form.courtRecordsUrl || ''} onChange={(e) => set({ courtRecordsUrl: e.target.value })} placeholder="https://" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Surplus list</label>
                    <input className="input w-full" value={form.surplusListUrl || ''} onChange={(e) => set({ surplusListUrl: e.target.value })} placeholder="https://" />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Assignment of rights</label>
                    <div className="flex gap-1.5">
                      {([
                        [null, 'Not asked'],
                        ['full', 'Full'],
                        ['partial', 'Partial'],
                      ] as [string | null, string][]).map(([v, l]) => (
                        <button
                          key={String(v)}
                          type="button"
                          onClick={() => set({ assignmentPreference: v })}
                          className={`px-2.5 py-1 text-xs rounded-md border ${
                            (form.assignmentPreference || null) === v
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 font-semibold'
                              : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Accepted submission methods</label>
                    <div className="flex flex-wrap gap-1.5">
                      {METHODS.map(([k, l]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => toggleMethod(k)}
                          className={`px-2.5 py-1 text-xs rounded-md border ${
                            (form.acceptedMethods || []).includes(k)
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 font-semibold'
                              : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>

                  <TriState label="Signature required on delivery" value={form.signatureRequired ?? null} onChange={(v) => set({ signatureRequired: v })} />
                  <TriState label="Attorney required to file" value={form.attorneyRequired ?? null} onChange={(v) => set({ attorneyRequired: v })} />

                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Clerk contact</label>
                    <input className="input w-full mb-2" value={form.clerkContactName || ''} onChange={(e) => set({ clerkContactName: e.target.value })} placeholder="Name" />
                    <input className="input w-full mb-2" value={form.clerkContactPhone || ''} onChange={(e) => set({ clerkContactPhone: e.target.value })} placeholder="Phone" />
                    <input className="input w-full" value={form.clerkContactEmail || ''} onChange={(e) => set({ clerkContactEmail: e.target.value })} placeholder="Email" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Where a claim package is mailed</label>
                    <textarea className="input w-full" rows={4} value={form.clerkAddress || ''} onChange={(e) => set({ clerkAddress: e.target.value })} placeholder="Clerk of Court, Attn: ..., street, city, state zip" />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes from the clerk, anything unusual</label>
                    <textarea className="input w-full" rows={4} value={form.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
                  </div>

                  <div className="md:col-span-2 flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                      <input
                        type="checkbox"
                        checked={!!form.practiceRunAt}
                        onChange={(e) => set({ practiceRunAt: e.target.checked ? new Date().toISOString() : null })}
                      />
                      Practice run done: every document in the set filled out once for this county
                      {form.practiceRunAt ? ` (${fmt(form.practiceRunAt)})` : ''}
                    </label>
                  </div>
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <button onClick={save} disabled={saving || !dirty} className="btn-primary disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  {dirty && <span className="text-xs text-gray-500">Unsaved edit</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </AppShell>
  );
}
