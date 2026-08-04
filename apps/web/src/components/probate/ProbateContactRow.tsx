'use client';

import Link from 'next/link';
import { formatPhoneDisplay } from '@/lib/format';

export interface ProbateProperty {
  leadId: string;
  address: string;
  city: string;
  zip: string;
  estValue: number | null;
  consensusRank: number | null;
  consensusScore: number | null;
  consensusTier: string | null;
  caseNumber: string | null;
  caseFiledDate: string | null;
  deceasedName: string | null;
  whyThisLead: string | null;
  status: string;
  primaryContact: boolean;
}

export interface ProbateContact {
  contactKey: string;
  primaryLeadId: string;
  heirName: string;
  heirCity: string | null;
  phone: string;
  phoneType: string | null;
  email: string | null;
  absenteeHeir: boolean;
  deceasedNames: string[];
  caseNumbers: string[];
  monthsSinceDeath: number | null;
  earliestFiled: string | null;
  propertyCount: number;
  totalValue: number;
  bestRank: number | null;
  bestTier: string | null;
  workStatus: string | null;
  doNotCall: boolean;
  enrolledCampaigns: string[];
  properties: ProbateProperty[];
}

export const WORK_STATUS_LABELS: Record<string, string> = {
  NOT_CONTACTED: 'Not contacted',
  IN_CONVERSATION: 'In conversation',
  APPOINTMENT_SET: 'Appointment set',
  UNDER_CONTRACT: 'Under contract',
  DEAD: 'Dead',
};

const money = (n: number | null) =>
  n == null ? '—' : `$${Math.round(n).toLocaleString()}`;

function tierNumber(label: string | null): number | null {
  const m = /tier\s*(\d+)/i.exec(label || '');
  return m ? Number(m[1]) : null;
}

const TIER_CLASS: Record<number, string> = {
  1: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  2: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  3: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
  4: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

/**
 * How long since the death, in the terms the list scores on. The 3-9 month
 * band is the window worth leading with: past the rawest grief, before the
 * estate has signed with an agent.
 */
function deathWindow(months: number | null): { text: string; className: string } {
  if (months == null) return { text: 'Date unknown', className: 'text-gray-400' };
  const rounded = months < 10 ? months.toFixed(1) : Math.round(months).toString();
  if (months < 3) {
    return { text: `${rounded} mo - very recent`, className: 'text-gray-500 dark:text-gray-400' };
  }
  if (months <= 9) {
    return { text: `${rounded} mo - prime window`, className: 'text-emerald-600 dark:text-emerald-400 font-medium' };
  }
  return { text: `${rounded} mo`, className: 'text-gray-500 dark:text-gray-400' };
}

export default function ProbateContactRow({
  contact,
  expanded,
  selected,
  onToggleExpand,
  onToggleSelect,
  onSetWorkStatus,
  onToggleDnc,
}: {
  contact: ProbateContact;
  expanded: boolean;
  selected: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onSetWorkStatus: (status: string) => void;
  onToggleDnc: () => void;
}) {
  const tier = tierNumber(contact.bestTier);
  const death = deathWindow(contact.monthsSinceDeath);
  const multi = contact.propertyCount > 1;

  return (
    <div
      className={`rounded-xl border transition-colors ${
        selected
          ? 'border-primary-300 dark:border-primary-800 bg-primary-50/40 dark:bg-primary-950/30'
          : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900'
      }`}
    >
      {/* ── Contact summary ── */}
      <div className="flex items-start gap-3 px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1 shrink-0"
          aria-label={`Select ${contact.heirName}`}
        />

        <button onClick={onToggleExpand} className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {contact.heirName || 'Unnamed heir'}
            </span>
            {tier != null && (
              <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${TIER_CLASS[tier] || TIER_CLASS[4]}`}>
                Tier {tier}
              </span>
            )}
            {multi && (
              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400">
                {contact.propertyCount} properties
              </span>
            )}
            {contact.absenteeHeir && (
              <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                Absentee
              </span>
            )}
            {contact.doNotCall && (
              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400">
                Do not call
              </span>
            )}
            {contact.enrolledCampaigns.map((name) => (
              <span key={name} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                {name}
              </span>
            ))}
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Estate of {contact.deceasedNames.join(', ') || 'unknown'}
            {contact.heirCity ? ` · heir in ${contact.heirCity}` : ''}
          </p>

          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-1.5 text-xs">
            <span className="text-gray-600 dark:text-gray-300">
              {formatPhoneDisplay(contact.phone)}
              {contact.phoneType ? (
                <span className="text-gray-400"> · {contact.phoneType}</span>
              ) : null}
            </span>
            {contact.email ? (
              <span className="text-gray-500 dark:text-gray-400 truncate max-w-[220px]">{contact.email}</span>
            ) : (
              <span className="text-amber-600 dark:text-amber-500">No email</span>
            )}
            <span className={death.className}>{death.text}</span>
            <span className="text-gray-500 dark:text-gray-400">
              {money(contact.totalValue)}
              {multi ? ' total' : ''}
            </span>
          </div>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <select
            value={contact.workStatus || 'NOT_CONTACTED'}
            onChange={(e) => onSetWorkStatus(e.target.value)}
            className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 dark:bg-gray-800 dark:text-gray-200"
          >
            {Object.entries(WORK_STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <button
            onClick={onToggleDnc}
            title={contact.doNotCall ? 'Allow calls again' : 'Mark do not call'}
            className={`text-xs px-2 py-1 rounded-md border ${
              contact.doNotCall
                ? 'border-red-200 text-red-600 dark:border-red-900 dark:text-red-400'
                : 'border-gray-200 text-gray-400 dark:border-gray-700 hover:text-gray-600 dark:hover:text-gray-200'
            }`}
          >
            DNC
          </button>
          <button
            onClick={onToggleExpand}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-1"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '▾' : '▸'}
          </button>
        </div>
      </div>

      {/* ── Properties ── */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-2">
          {multi && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 py-1.5">
              One conversation, {contact.propertyCount} properties
              {contact.caseNumbers.length > 1 ? ` across ${contact.caseNumbers.length} estates` : ''}.
              Only the highlighted lead is enrolled in drips.
            </p>
          )}
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {contact.properties.map((p) => (
              <div key={p.leadId} className="flex items-center gap-3 py-2">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/leads/${p.leadId}`}
                    className="text-sm text-gray-800 dark:text-gray-200 hover:text-primary-600 dark:hover:text-primary-400 font-medium"
                  >
                    {p.address}
                  </Link>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {p.city} {p.zip}
                    {p.caseNumber ? ` · case ${p.caseNumber}` : ''}
                    {contact.deceasedNames.length > 1 && p.deceasedName ? ` · ${p.deceasedName}` : ''}
                  </p>
                </div>
                {p.primaryContact && (
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-400 shrink-0">
                    Drip contact
                  </span>
                )}
                <span className="text-xs text-gray-500 dark:text-gray-400 w-20 text-right shrink-0">
                  {money(p.estValue)}
                </span>
                <span className="text-xs text-gray-400 w-12 text-right shrink-0">
                  {p.consensusRank != null ? `#${p.consensusRank}` : '—'}
                </span>
              </div>
            ))}
          </div>
          {contact.properties[0]?.whyThisLead && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 italic pt-2 pb-1">
              {contact.properties[0].whyThisLead}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
