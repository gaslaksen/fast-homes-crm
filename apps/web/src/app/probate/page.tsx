'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import { probateAPI, campaignAPI } from '@/lib/api';
import ProbateImportModal from '@/components/probate/ProbateImportModal';
import ProbateContactRow, {
  ProbateContact,
  WORK_STATUS_LABELS,
} from '@/components/probate/ProbateContactRow';

interface Stats {
  leads: number;
  contacts: number;
  primaryContacts: number;
  notContacted: number;
  doNotCall: number;
  tierCounts: Record<string, number>;
  totalValue: number;
  avgMonthsSinceDeath: number | null;
}

const EMPTY_STATS: Stats = {
  leads: 0, contacts: 0, primaryContacts: 0, notContacted: 0, doNotCall: 0,
  tierCounts: {}, totalValue: 0, avgMonthsSinceDeath: null,
};

const PAGE_SIZE = 40;

export default function ProbatePage() {
  const [contacts, setContacts] = useState<ProbateContact[]>([]);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [cities, setCities] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [leadTotal, setLeadTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [tier, setTier] = useState('');
  const [county, setCounty] = useState('');
  const [city, setCity] = useState('');
  const [workStatus, setWorkStatus] = useState('');
  const [deathWindow, setDeathWindow] = useState('');
  const [absentee, setAbsentee] = useState('');
  const [sort, setSort] = useState('rank');
  const [hideDead, setHideDead] = useState(true);
  const [hideDnc, setHideDnc] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [bulkCampaign, setBulkCampaign] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);

  const showToast = useCallback((text: string, bad?: boolean) => {
    setToast({ text, bad });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await probateAPI.list({
        search: search || undefined,
        tier: tier || undefined,
        county: county || undefined,
        city: city || undefined,
        workStatus: workStatus || undefined,
        deathWindow: deathWindow || undefined,
        absentee: absentee || undefined,
        hideDead: hideDead || undefined,
        hideDnc: hideDnc || undefined,
        sort,
        page,
        pageSize: PAGE_SIZE,
      });
      setContacts(res.data.groups || []);
      setTotal(res.data.total || 0);
      setLeadTotal(res.data.leadTotal || 0);
      setCities(res.data.cities || []);
    } catch {
      showToast('Could not load probate leads', true);
    } finally {
      setLoading(false);
    }
  }, [search, tier, county, city, workStatus, deathWindow, absentee, hideDead, hideDnc, sort, page, showToast]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await probateAPI.stats();
      setStats(res.data);
    } catch { /* stats are decoration; a failure here should not blank the list */ }
  }, []);

  // Debounce the search box; every other filter applies immediately.
  useEffect(() => {
    const t = setTimeout(fetchContacts, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchContacts, search]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  useEffect(() => {
    campaignAPI.list()
      .then((r) => setCampaigns((r.data || []).filter((c: any) => c.isActive)))
      .catch(() => {});
  }, []);

  // Any filter change puts you back on page 1.
  useEffect(() => { setPage(1); }, [search, tier, county, city, workStatus, deathWindow, absentee, hideDead, hideDnc, sort]);

  const toggleExpand = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const toggleSelect = (key: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const selectAllShown = () => setSelected((prev) => {
    const next = new Set(prev);
    const allOn = contacts.every((c) => next.has(c.contactKey));
    contacts.forEach((c) => (allOn ? next.delete(c.contactKey) : next.add(c.contactKey)));
    return next;
  });

  const setWorkStatusFor = async (contact: ProbateContact, status: string) => {
    setContacts((prev) => prev.map((c) => (c.contactKey === contact.contactKey ? { ...c, workStatus: status } : c)));
    try {
      await probateAPI.updateContact(contact.contactKey, { workStatus: status });
      fetchStats();
    } catch {
      showToast('Could not save that status', true);
      fetchContacts();
    }
  };

  const toggleDncFor = async (contact: ProbateContact) => {
    const next = !contact.doNotCall;
    setContacts((prev) => prev.map((c) => (c.contactKey === contact.contactKey ? { ...c, doNotCall: next } : c)));
    try {
      await probateAPI.updateContact(contact.contactKey, { doNotCall: next });
      fetchStats();
    } catch {
      showToast('Could not save that change', true);
      fetchContacts();
    }
  };

  /**
   * Enrol the PRIMARY lead of each selected contact, never every property.
   * Selecting an heir who inherited nine houses has to mean one enrollment, or
   * the campaign texts them nine times on the same schedule.
   */
  const selectedContacts = useMemo(
    () => contacts.filter((c) => selected.has(c.contactKey)),
    [contacts, selected],
  );

  const handleEnroll = async () => {
    if (!bulkCampaign || selectedContacts.length === 0) return;
    const campaign = campaigns.find((c) => c.id === bulkCampaign);
    const dnc = selectedContacts.filter((c) => c.doNotCall).length;

    if (!window.confirm(
      `Enrol ${selectedContacts.length} contact${selectedContacts.length === 1 ? '' : 's'} in "${campaign?.name}"?\n\n` +
      `One enrollment per person, not per property.` +
      (dnc ? `\n${dnc} of them are marked do-not-call and will be refused.` : '')
    )) return;

    setEnrolling(true);
    try {
      const res = await campaignAPI.enrollLeads(
        bulkCampaign,
        selectedContacts.map((c) => c.primaryLeadId),
      );
      const { enrolled = 0, skipped = [] } = res.data || {};
      showToast(
        skipped.length === 0
          ? `Enrolled ${enrolled} contact${enrolled === 1 ? '' : 's'}.`
          : `Enrolled ${enrolled}, skipped ${skipped.length} (${skipped[0]?.reason}).`,
        skipped.length > 0,
      );
      setSelected(new Set());
      setBulkCampaign('');
      fetchContacts();
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Enrollment failed', true);
    } finally {
      setEnrolling(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(search || tier || county || city || workStatus || deathWindow || absentee || hideDnc || !hideDead);

  const clearFilters = () => {
    setSearch(''); setTier(''); setCounty(''); setCity('');
    setWorkStatus(''); setDeathWindow(''); setAbsentee('');
    setHideDead(true); setHideDnc(false);
  };

  return (
    <AppShell>
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Probate</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Grouped by heir, because one estate can hold many properties. No automatic outreach -
              nothing sends until you enrol someone in a campaign.
            </p>
          </div>
          <button onClick={() => setShowImport(true)} className="btn btn-primary btn-sm">
            Import list
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
          <StatCard label="People to work" value={stats.contacts.toLocaleString()} accent />
          <StatCard label="Properties" value={stats.leads.toLocaleString()} />
          <StatCard label="Not contacted" value={stats.notContacted.toLocaleString()} />
          <StatCard
            label="Est. value"
            value={stats.totalValue ? `$${(stats.totalValue / 1e6).toFixed(1)}M` : '—'}
          />
          <StatCard
            label="Avg since death"
            value={stats.avgMonthsSinceDeath != null ? `${stats.avgMonthsSinceDeath.toFixed(1)} mo` : '—'}
          />
        </div>

        {/* Filters */}
        <div className="card px-4 py-3 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search heir, decedent, address, case..."
              className="input text-sm flex-1 min-w-[240px]"
            />
            <Select label="Tier" value={tier} onChange={setTier}>
              <option value="">All tiers</option>
              <option value="1">Tier 1</option>
              <option value="2">Tier 2</option>
              <option value="3">Tier 3</option>
              <option value="4">Tier 4</option>
            </Select>
            <Select label="Since death" value={deathWindow} onChange={setDeathWindow}>
              <option value="">Any</option>
              <option value="fresh">Under 3 months</option>
              <option value="sweet">3-9 months (prime)</option>
              <option value="stale">Over 9 months</option>
            </Select>
            <Select label="County" value={county} onChange={setCounty}>
              <option value="">All counties</option>
              <option value="Mecklenburg">Mecklenburg</option>
              <option value="Union">Union</option>
            </Select>
            <Select label="City" value={city} onChange={setCity}>
              <option value="">All cities</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select label="Status" value={workStatus} onChange={setWorkStatus}>
              <option value="">Any status</option>
              {Object.entries(WORK_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <Select label="Heir" value={absentee} onChange={setAbsentee}>
              <option value="">Anyone</option>
              <option value="yes">Absentee only</option>
              <option value="no">Lives at property</option>
            </Select>
            <Select label="Sort" value={sort} onChange={setSort}>
              <option value="rank">Best rank</option>
              <option value="properties">Most properties</option>
              <option value="value">Highest value</option>
              <option value="recent">Most recent death</option>
              <option value="name">Name</option>
            </Select>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={hideDead} onChange={(e) => setHideDead(e.target.checked)} />
              Hide dead
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={hideDnc} onChange={(e) => setHideDnc(e.target.checked)} />
              Hide DNC
            </label>
            {hasFilters && (
              <button onClick={clearFilters} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Selection bar */}
        {selected.size > 0 && (
          <div className="bg-primary-50 dark:bg-primary-950 border border-primary-200 dark:border-primary-800 rounded-xl px-4 py-2.5 flex items-center gap-4 flex-wrap mb-4">
            <span className="text-sm font-semibold text-primary-800 dark:text-primary-400">
              {selected.size} contact{selected.size === 1 ? '' : 's'} selected
            </span>
            <span className="text-xs text-primary-700/70 dark:text-primary-500">
              {selectedContacts.reduce((n, c) => n + c.propertyCount, 0)} properties · one enrollment each
            </span>
            {campaigns.length > 0 ? (
              <div className="flex items-center gap-2">
                <select
                  value={bulkCampaign}
                  onChange={(e) => setBulkCampaign(e.target.value)}
                  className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 dark:bg-gray-800 dark:text-gray-200"
                >
                  <option value="">Enrol in campaign...</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {bulkCampaign && (
                  <button
                    onClick={handleEnroll}
                    disabled={enrolling}
                    className="text-xs px-3 py-1 bg-primary-600 text-white rounded-lg font-medium disabled:opacity-50"
                  >
                    {enrolling ? 'Enrolling...' : 'Enrol'}
                  </button>
                )}
              </div>
            ) : (
              <span className="text-xs text-primary-700/70 dark:text-primary-500">
                No active campaigns yet - build one on Drip Campaigns first.
              </span>
            )}
            <button onClick={() => setSelected(new Set())} className="text-xs text-primary-500 hover:underline ml-auto">
              Deselect
            </button>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500 text-sm animate-pulse">
            Loading probate leads...
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-500 dark:text-gray-400 font-medium">
              {hasFilters ? 'Nothing matches those filters.' : 'No probate leads yet.'}
            </p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              {hasFilters ? 'Try clearing them.' : 'Import a probate list to get started.'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2 px-1">
              <button onClick={selectAllShown} className="text-xs text-gray-500 dark:text-gray-400 hover:underline">
                Select all on this page
              </button>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {total.toLocaleString()} contact{total === 1 ? '' : 's'} · {leadTotal.toLocaleString()} properties
              </span>
            </div>

            <div className="space-y-2">
              {contacts.map((c) => (
                <ProbateContactRow
                  key={c.contactKey}
                  contact={c}
                  expanded={expanded.has(c.contactKey)}
                  selected={selected.has(c.contactKey)}
                  onToggleExpand={() => toggleExpand(c.contactKey)}
                  onToggleSelect={() => toggleSelect(c.contactKey)}
                  onSetWorkStatus={(s) => setWorkStatusFor(c, s)}
                  onToggleDnc={() => toggleDncFor(c)}
                />
              ))}
            </div>

            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-3 mt-6">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn btn-secondary btn-sm disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Page {page} of {pageCount}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page === pageCount}
                  className="btn btn-secondary btn-sm disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showImport && (
        <ProbateImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { fetchContacts(); fetchStats(); }}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium z-50 ${
            toast.bad ? 'bg-red-600 text-white' : 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
          }`}
        >
          {toast.text}
        </div>
      )}
    </AppShell>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card px-4 py-3">
      <p className={`text-2xl font-bold ${accent ? 'text-primary-600 dark:text-primary-400' : 'text-gray-900 dark:text-gray-100'}`}>
        {value}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}

function Select({
  label, value, onChange, children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 dark:bg-gray-800 dark:text-gray-200"
    >
      {children}
    </select>
  );
}
