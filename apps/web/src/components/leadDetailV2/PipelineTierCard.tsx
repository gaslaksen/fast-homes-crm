'use client';

import { leadsAPI } from '@/lib/api';

interface Props {
  lead: any;
  leadId: string;
  setLead: (updater: any) => void;
  teamMembers: any[];
  assignUserId: string;
  setAssignUserId: (v: string) => void;
  assignStage: string;
  setAssignStage: (v: string) => void;
  assignSaving: boolean;
  onAssign: () => void;
  onUnassign: () => void;
  onSetTier: (tier: number | null) => void;
  settingTier: boolean;
}

const STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'NEW', label: 'New' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'QUALIFIED', label: 'Qualified' },
  { value: 'OFFER_MADE', label: 'Offer Made' },
  { value: 'UNDER_CONTRACT', label: 'Under Contract' },
  { value: 'CLOSED_WON', label: 'Closed Won' },
  { value: 'CLOSED_LOST', label: 'Closed Lost' },
  { value: 'DEAD', label: 'Dead' },
];

const TIERS: { value: 1 | 2 | 3; label: string; desc: string; cls: string }[] = [
  { value: 1, label: 'T1', desc: 'Contract now', cls: 'border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300' },
  { value: 2, label: 'T2', desc: 'Keep pursuing', cls: 'border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-300' },
  { value: 3, label: 'T3', desc: 'Cold / unlikely', cls: 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400' },
];

export default function PipelineTierCard({
  lead, leadId, setLead, teamMembers,
  assignUserId, setAssignUserId, assignStage, setAssignStage, assignSaving,
  onAssign, onUnassign, onSetTier, settingTier,
}: Props) {
  const onStageChange = async (newStatus: string) => {
    try {
      await leadsAPI.update(leadId, { status: newStatus });
      setLead((prev: any) => prev ? { ...prev, status: newStatus } : prev);
    } catch (err) {
      console.error('Failed to update stage', err);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-4">
      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Pipeline & Tier</h3>

      {/* Stage */}
      <div>
        <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500 mb-1">Stage</div>
        <select
          value={lead.status}
          onChange={(e) => onStageChange(e.target.value)}
          className="w-full text-sm px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
        >
          {STAGE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Tier */}
      <div>
        <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500 mb-1">Deal Tier</div>
        <div className="grid grid-cols-3 gap-1.5">
          {TIERS.map((t) => (
            <button
              key={t.value}
              onClick={() => onSetTier(lead.tier === t.value ? null : t.value)}
              disabled={settingTier}
              title={t.desc}
              className={`px-2 py-1.5 rounded-lg border-2 text-xs font-bold transition-colors ${
                lead.tier === t.value ? t.cls : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:border-gray-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Assignment */}
      <div>
        <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500 mb-1">Assigned to</div>
        {lead.assignedTo ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-gray-800 dark:text-gray-200 truncate">
              {lead.assignedTo.firstName} {lead.assignedTo.lastName}
              {lead.assignedStage && <span className="text-gray-400 dark:text-gray-500"> · {lead.assignedStage}</span>}
            </span>
            <button onClick={onUnassign} disabled={assignSaving} className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50">
              Unassign
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <select
              value={assignUserId}
              onChange={(e) => setAssignUserId(e.target.value)}
              className="w-full text-sm px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
            >
              <option value="">— Select member —</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
              ))}
            </select>
            <input
              value={assignStage}
              onChange={(e) => setAssignStage(e.target.value)}
              placeholder="Stage (optional)"
              className="w-full text-sm px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
            />
            <button
              onClick={onAssign}
              disabled={!assignUserId || assignSaving}
              className="w-full text-xs px-2 py-1.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {assignSaving ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
