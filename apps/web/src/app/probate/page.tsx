'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import { agoLabel, agoDays } from '@/components/pipelines/format';
import { probateAPI, campaignAPI } from '@/lib/api';
import ProbateImportModal from '@/components/probate/ProbateImportModal';
import {
  ProbateContact,
  WORK_STATUS_LABELS,
} from '@/components/probate/ProbateContactRow';
import PipelineBoard, {
  type PipelineView,
  type PipelineColumn,
  type PipelineStage,
} from '@/components/pipelines/PipelineBoard';
import PipelineWorkPanel from '@/components/pipelines/PipelineWorkPanel';
import ProbateCard, { PROBATE_ACCENT } from '@/components/pipelines/ProbateCard';
import ProbateDetail from '@/components/pipelines/ProbateDetail';
import '@/components/pipelines/pipeline-board.css';

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

/**
 * The table, in the order a probate lead is triaged: how long since the death,
 * how much is inherited, who is the heir, can we reach them.
 */
const PROBATE_COLUMNS: PipelineColumn<ProbateContact>[] = [
  {
    key: 'status',
    label: 'Status',
    width: '140px',
    sortValue: (c) => c.bestRank ?? 9999,
    render: (c) => (
      <span className="dc-tag" style={{ background: 'var(--surface3)', color: 'var(--text)' }}>
        {WORK_STATUS_LABELS[c.workStatus || 'NOT_CONTACTED'] || 'Not contacted'}
      </span>
    ),
  },
  {
    key: 'months',
    label: 'Months since death',
    align: 'right',
    width: '130px',
    sortValue: (c) => c.monthsSinceDeath ?? 9999,
    render: (c) =>
      c.monthsSinceDeath == null ? (
        <span style={{ color: 'var(--faint)' }}>unknown</span>
      ) : (
        // Under three months is too soon to approach, not a hot lead.
        <span style={{ color: c.monthsSinceDeath < 3 ? 'var(--amber)' : 'var(--dim)', fontWeight: 600 }}>
          {c.monthsSinceDeath}
        </span>
      ),
  },
  {
    key: 'value',
    label: 'Inherited value',
    align: 'right',
    width: '125px',
    sortValue: (c) => c.totalValue ?? 0,
    render: (c) => <b>{money(c.totalValue)}</b>,
  },
  {
    key: 'heir',
    label: 'Heir',
    sortValue: (c) => c.heirName || '',
    render: (c) => (
      <div>
        <div style={{ fontWeight: 600 }}>{c.heirName}</div>
        <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
          {c.heirCity || 'city unknown'}
          {c.absenteeHeir ? ' · absentee' : ''}
        </div>
      </div>
    ),
  },
  {
    key: 'estate',
    label: 'Estate',
    sortValue: (c) => c.deceasedNames[0] || '',
    render: (c) => (
      <div>
        <div>{c.deceasedNames.slice(0, 2).join(', ') || 'unknown'}</div>
        <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
          {c.propertyCount} propert{c.propertyCount === 1 ? 'y' : 'ies'}
        </div>
      </div>
    ),
  },
  {
    // The record of what actually went out: every call placed, text and email,
    // written by the channel that sent it. Distinct from the weekly touch-day
    // boxes, which are a plan rather than a log.
    key: 'touches',
    label: 'Touches',
    align: 'right',
    width: '112px',
    nowrap: true,
    // Most neglected first, so the column answers "who has nobody been calling".
    sortValue: (r) => -agoDays(r.lastTouchedAt),
    // One line, not a stack. Two short values stacked set the row height for
    // every other cell in the table and read as a wrap rather than a design.
    render: (r) => (
      <span style={{ fontSize: 12, color: r.touches ? 'var(--text)' : 'var(--faint)' }}>
        <b>{r.touches || 0}</b>
        <span style={{ color: 'var(--faint)' }}> · {agoLabel(r.lastTouchedAt)}</span>
      </span>
    ),
  },
  {
    key: 'contact',
    label: 'Reach',
    width: '120px',
    sortValue: (c) => (c.doNotCall ? -1 : c.phone ? 1 : 0),
    render: (c) =>
      c.doNotCall ? (
        <span style={{ color: 'var(--red)', fontSize: 12 }}>do not call</span>
      ) : c.phone ? (
        <span style={{ color: 'var(--mint)', fontSize: 12 }}>☏ on file</span>
      ) : (
        <span style={{ color: 'var(--faint)', fontSize: 12 }}>no number</span>
      ),
  },
];

const PROBATE_KANBAN: PipelineStage[] = Object.keys(WORK_STATUS_LABELS).map((k) => ({
  key: k,
  label: WORK_STATUS_LABELS[k],
}));

/** Local money format, matching the rest of the pipeline boards. */
function money(n: number | null): string {
  return n || n === 0 ? `$${Math.round(n).toLocaleString('en-US')}` : '-';
}

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

  /** Table by default: a probate list is scanned before any of it is worked. */
  const [view, setView] = useState<PipelineView>('table');
  const [openKey, setOpenKey] = useState<string | null>(null);
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

  const openContact = openKey ? contacts.find((c) => c.contactKey === openKey) || null : null;
  /**
   * Step through the filtered list from inside the panel.
   *
   * Indexed off the SAME array the board renders, so the arrows follow whatever
   * filter and sort is on screen rather than some separate order. Null at the
   * ends instead of wrapping, which is what disables the button and makes the
   * end of the list visible.
   */
  const openIndex = contacts.findIndex((c) => c.contactKey === openKey);
  const goTo = (i: number) => setOpenKey(contacts[i] ? (contacts[i] as any).contactKey : null);


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

  const [bulkBusy, setBulkBusy] = useState(false);

  /**
   * Bulk actions on the checked heirs. Both act on the PERSON, so an heir with
   * three properties is retired or removed in one go rather than left half on
   * the board.
   */
  const bulkStatus = async (status: string, label: string) => {
    const keys = Array.from(selected);
    if (!keys.length) return;
    setBulkBusy(true);
    try {
      const res = await probateAPI.bulkStatus(keys, status);
      showToast(`${label} ${keys.length} contact${keys.length === 1 ? '' : 's'} (${res.data.updated} propert${res.data.updated === 1 ? 'y' : 'ies'}).`);
      setSelected(new Set());
      fetchContacts();
    } catch (e: any) {
      showToast(e?.response?.data?.message || `${label} failed`, true);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    const keys = Array.from(selected);
    if (!keys.length) return;
    const props = selectedContacts.reduce((n, c) => n + c.propertyCount, 0);
    if (!window.confirm(
      `Delete ${keys.length} contact${keys.length === 1 ? '' : 's'} and all ${props} of their propert${props === 1 ? 'y' : 'ies'}? This cannot be undone.`,
    )) return;
    setBulkBusy(true);
    try {
      const res = await probateAPI.bulkDeleteContacts(keys);
      showToast(`Deleted ${res.data.deleted} lead${res.data.deleted === 1 ? '' : 's'}.`);
      setSelected(new Set());
      fetchContacts();
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Delete failed', true);
    } finally {
      setBulkBusy(false);
    }
  };

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
            {/* Wrapped in .dc-board so the shared board's colour tokens
                resolve; they are scoped to that class on purpose. */}
            <div className="dc-board">
              <PipelineBoard
                rows={contacts}
                keyOf={(c) => c.contactKey}
                columns={PROBATE_COLUMNS}
                stages={PROBATE_KANBAN}
                stageOf={(c) => c.workStatus || 'NOT_CONTACTED'}
                onStageChange={(c, status) => setWorkStatusFor(c, status)}
                view={view}
                onViewChange={setView}
                selected={Object.fromEntries([...selected].map((k) => [k, true]))}
                onSelect={(k, on) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(k);
                    else next.delete(k);
                    return next;
                  })
                }
                onSelectAll={(on) =>
                  setSelected(on ? new Set(contacts.map((c) => c.contactKey)) : new Set())
                }
                onOpen={(c) => setOpenKey(c.contactKey)}
                accentOf={(c) => PROBATE_ACCENT[c.workStatus || 'NOT_CONTACTED'] || 'var(--border2)'}
                loading={loading}
                renderCard={(c) => (
                  <ProbateCard
                    c={c}
                    picked={selected.has(c.contactKey)}
                    onPick={(on) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(c.contactKey);
                        else next.delete(c.contactKey);
                        return next;
                      })
                    }
                    onOpen={() => setOpenKey(c.contactKey)}
                  />
                )}
                toolbarLeft={
                  <span>
                    {total.toLocaleString()} heir{total === 1 ? '' : 's'} ·{' '}
                    {leadTotal.toLocaleString()} properties
                    {selected.size > 0 && (
                      <>
                        {' '}· <b style={{ color: 'var(--mint)' }}>{selected.size} selected</b>
                      </>
                    )}
                  </span>
                }
                /* Selection actions live in the board toolbar, beside the count
                   they act on, the same as every other pipeline. They used to
                   be a full-width banner above the board, which pushed the rows
                   down every time somebody ticked a box. */
                toolbarRight={
                  selected.size > 0 ? (
                    <>
                      <span style={{ fontSize: 12, color: 'var(--faint)' }}>
                        {selectedContacts.reduce((n, c) => n + c.propertyCount, 0)} properties · one
                        enrollment each
                      </span>
                      {campaigns.length > 0 && (
                        <>
                          <select
                            value={bulkCampaign}
                            onChange={(e) => setBulkCampaign(e.target.value)}
                            className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 dark:bg-gray-800 dark:text-gray-200"
                          >
                            <option value="">Enrol in campaign...</option>
                            {campaigns.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                          {bulkCampaign && (
                            <button className="dc-btn sm" disabled={enrolling} onClick={handleEnroll}>
                              {enrolling ? 'Enrolling...' : 'Enrol'}
                            </button>
                          )}
                        </>
                      )}
                      <button
                        className="dc-btn sm"
                        disabled={bulkBusy}
                        onClick={() => bulkStatus('DEAD', 'Marked dead')}
                      >
                        Mark dead
                      </button>
                    </>
                  ) : null
                }
              />
            </div>

            {openContact && (
              <PipelineWorkPanel
                onPrev={openIndex > 0 ? () => goTo(openIndex - 1) : null}
                onNext={openIndex >= 0 && openIndex < contacts.length - 1 ? () => goTo(openIndex + 1) : null}
                position={openIndex >= 0 ? { index: openIndex, total: contacts.length } : null}
                title={openContact.heirName}
                subtitle={`${openContact.heirCity || 'city unknown'} · ${openContact.propertyCount} propert${openContact.propertyCount === 1 ? 'y' : 'ies'}`}
                meta={openContact.deceasedNames.join(', ')}
                detailLabel="Estate"
                detail={<ProbateDetail c={openContact} />}
                subjects={[
                  {
                    leadId: openContact.primaryLeadId,
                    name: openContact.heirName,
                    phones: openContact.phone
                      ? [{ number: openContact.phone, type: openContact.phoneType }]
                      : [],
                    emails: openContact.email ? [openContact.email] : [],
                  },
                ]}
                onClose={() => setOpenKey(null)}
                onChanged={fetchContacts}
                say={() => {}}
              />
            )}

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
