'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { formatPhoneDisplay } from '@/lib/format';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'NEW', label: 'New Lead' },
  { value: 'ATTEMPTING_CONTACT', label: 'Attempting Contact' },
  { value: 'QUALIFYING', label: 'Qualifying' },
  { value: 'QUALIFIED', label: 'Qualified' },
  { value: 'OFFER_SENT', label: 'Offer Made' },
  { value: 'NEGOTIATING', label: 'Negotiating' },
  { value: 'UNDER_CONTRACT', label: 'Under Contract' },
  { value: 'CLOSING', label: 'Closing' },
  { value: 'ACQUIRED', label: 'Acquired' },
  { value: 'SOLD', label: 'Sold' },
  { value: 'SOLD_LOSS', label: 'Sold (Loss)' },
  { value: 'HELD_LONG_TERM', label: 'Held (Long Term)' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'CLOSED_LOST', label: 'Closed / Lost' },
  { value: 'NURTURE', label: 'Nurture' },
  { value: 'DEAD', label: 'Dead' },
];

interface Props {
  lead: any;
  leadId: string;
  leadTasks: any[];
  saving: { status: boolean; tier: boolean; autoRespond: boolean };
  onStatusChange: (status: string) => void;
  onSetTier: (tier: number | null) => void;
  onToggleAutoRespond: () => void;
  onOpenFollowUp: () => void;
  onCompleteTask: (taskId: string) => void;
}

// Persistent left rail on the lead detail page: the at-a-glance context that
// stays visible while the center pane switches between conversation and tabs.
export default function LeadSummaryRail({
  lead,
  leadId,
  leadTasks,
  saving,
  onStatusChange,
  onSetTier,
  onToggleAutoRespond,
  onOpenFollowUp,
  onCompleteTask,
}: Props) {
  const mao = (() => {
    if (!lead.arv) return null;
    const pct = (lead.maoPercent ?? 70) / 100;
    return Math.round(lead.arv * pct - (lead.repairCosts ?? 0) - (lead.assignmentFee ?? 0));
  })();
  const openTasks = leadTasks.filter((t: any) => !t.completed);

  return (
    <div className="p-4 space-y-4 text-sm">
      {/* Stage + tier + AI mode */}
      <section className="space-y-3">
        <div>
          <RailLabel>Pipeline Stage</RailLabel>
          <select
            value={lead.status}
            disabled={saving.status}
            onChange={(e) => onStatusChange(e.target.value)}
            className="mt-1 w-full text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div>
          <RailLabel>Deal Tier</RailLabel>
          <div className="mt-1 grid grid-cols-3 gap-1.5">
            {[
              { tier: 1, active: 'border-green-500 bg-green-500 text-white', idle: 'border-green-300 dark:border-green-800 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950' },
              { tier: 2, active: 'border-yellow-500 bg-yellow-500 text-white', idle: 'border-yellow-300 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-950' },
              { tier: 3, active: 'border-gray-500 bg-gray-500 text-white', idle: 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800' },
            ].map(({ tier, active, idle }) => {
              const isActive = lead.tier === tier;
              return (
                <button
                  key={tier}
                  type="button"
                  disabled={saving.tier}
                  onClick={() => onSetTier(isActive ? null : tier)}
                  title={tier === 1 ? 'Send a contract now' : tier === 2 ? 'Opportunity, keep pursuing' : 'Low chance, dead/no go'}
                  className={`px-2 py-1 rounded-lg border-2 text-xs font-semibold transition-colors disabled:opacity-50 ${isActive ? active : idle}`}
                >
                  T{tier}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <RailLabel>AI Auto-Respond</RailLabel>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {lead.autoRespond ? 'AI replies automatically' : 'Manual mode'}
            </div>
          </div>
          <button
            type="button"
            disabled={saving.autoRespond}
            onClick={onToggleAutoRespond}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              lead.autoRespond ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
            } ${saving.autoRespond ? 'opacity-50' : ''}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                lead.autoRespond ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </section>

      <RailSection title="Valuation">
        <div className="space-y-1.5">
          <RailStat
            label="ARV"
            value={lead.arv ? `$${lead.arv.toLocaleString()}` : null}
            valueClass="text-green-700 dark:text-green-400"
            hint={lead.arvConfidence ? `${lead.arvConfidence}% conf` : undefined}
          />
          <RailStat
            label="Asking"
            value={lead.askingPrice ? `$${lead.askingPrice.toLocaleString()}` : null}
            hint={lead.arv && lead.askingPrice ? `${((lead.askingPrice / lead.arv) * 100).toFixed(0)}% of ARV` : undefined}
          />
          <RailStat
            label={`MAO (${Math.round(((lead.maoPercent ?? 70) / 100) * 100)}%)`}
            value={mao !== null ? `$${Math.max(mao, 0).toLocaleString()}` : null}
            valueClass="text-blue-700 dark:text-blue-400"
            hint={
              mao !== null && lead.askingPrice
                ? lead.askingPrice <= mao
                  ? 'Under MAO ✓'
                  : `$${(lead.askingPrice - mao).toLocaleString()} over`
                : undefined
            }
          />
        </div>
        <Link
          href={`/leads/${leadId}/comps-analysis`}
          className="mt-2 block text-center text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
        >
          Full comps analysis →
        </Link>
      </RailSection>

      <RailSection title="CAMP Discovery">
        <div className="grid grid-cols-2 gap-1.5">
          <CampChip label="Priority" value={lead.timeline ? `${lead.timeline} days` : null} complete={lead.campPriorityComplete} />
          <CampChip label="Money" value={lead.askingPrice ? `$${lead.askingPrice.toLocaleString()}` : null} complete={lead.campMoneyComplete} />
          <CampChip label="Challenge" value={lead.conditionLevel || null} complete={lead.campChallengeComplete} />
          <CampChip label="Authority" value={lead.ownershipStatus?.replace(/_/g, ' ') || null} complete={lead.campAuthorityComplete} />
        </div>
      </RailSection>

      <RailSection title="Seller">
        <dl className="space-y-1.5">
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500 dark:text-gray-400">Name</dt>
            <dd className="text-gray-900 dark:text-gray-100 text-right truncate">
              {[lead.sellerFirstName, lead.sellerLastName].filter(Boolean).join(' ') || '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500 dark:text-gray-400">Phone</dt>
            <dd className="text-gray-900 dark:text-gray-100 text-right">
              {lead.sellerPhone ? (
                lead.doNotContact ? formatPhoneDisplay(lead.sellerPhone) : (
                  <a href={`tel:${lead.sellerPhone}`} className="hover:text-primary-600 hover:underline">
                    {formatPhoneDisplay(lead.sellerPhone)}
                  </a>
                )
              ) : '—'}
            </dd>
          </div>
          {lead.sellerEmail && (
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500 dark:text-gray-400">Email</dt>
              <dd className="text-gray-900 dark:text-gray-100 text-right truncate" title={lead.sellerEmail}>{lead.sellerEmail}</dd>
            </div>
          )}
          {lead.source && (
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500 dark:text-gray-400">Source</dt>
              <dd className="text-gray-900 dark:text-gray-100 text-right">{lead.source}</dd>
            </div>
          )}
        </dl>
        {lead.doNotContact && (
          <div className="mt-2 px-2 py-1.5 rounded bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
            Do Not Contact
          </div>
        )}
      </RailSection>

      <RailSection title={`Follow-Ups${openTasks.length ? ` (${openTasks.length})` : ''}`}>
        {openTasks.length > 0 ? (
          <div className="space-y-1.5">
            {openTasks.map((task: any) => (
              <div key={task.id} className="flex items-start gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-950">
                <button
                  type="button"
                  onClick={() => onCompleteTask(task.id)}
                  className="mt-0.5 w-3.5 h-3.5 rounded border-2 border-gray-300 dark:border-gray-600 hover:border-primary-500 flex-shrink-0 transition-colors"
                  title="Mark complete"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{task.title}</div>
                  {task.dueDate && (
                    <div className="text-[11px] text-gray-400 dark:text-gray-500">
                      {format(new Date(task.dueDate), 'MMM d · h:mm a')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 dark:text-gray-500">No follow-ups scheduled.</p>
        )}
        <button
          type="button"
          onClick={onOpenFollowUp}
          className="mt-2 w-full text-center text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
        >
          + Schedule follow-up
        </button>
      </RailSection>
    </div>
  );
}

function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
      {children}
    </div>
  );
}

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="border-t border-gray-100 dark:border-gray-800 pt-3 group">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5 mb-2">
        <svg
          className="w-3 h-3 text-gray-400 transition-transform group-open:rotate-90"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">{title}</span>
      </summary>
      {children}
    </details>
  );
}

function RailStat({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string | null;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-right">
        <span className={`font-semibold ${value ? valueClass || 'text-gray-900 dark:text-gray-100' : 'text-gray-300 dark:text-gray-600'}`}>
          {value || '—'}
        </span>
        {hint && <span className="block text-[11px] text-gray-400 dark:text-gray-500">{hint}</span>}
      </span>
    </div>
  );
}

function CampChip({ label, value, complete }: { label: string; value: string | null; complete: boolean }) {
  return (
    <div
      className={`px-2 py-1.5 rounded-lg border text-xs ${
        complete
          ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950'
          : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-gray-600 dark:text-gray-300">{label}</span>
        {complete && <span className="text-green-600 dark:text-green-400">✓</span>}
      </div>
      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{value || 'Pending'}</div>
    </div>
  );
}
