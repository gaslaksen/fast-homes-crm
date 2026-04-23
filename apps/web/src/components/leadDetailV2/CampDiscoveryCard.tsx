'use client';

import { useState } from 'react';

interface Props {
  lead: any;
  onAskCampField: (field: 'priority' | 'money' | 'challenge' | 'authority') => void;
}

function CampCell({ label, subtitle, complete, value, isNext, field, onAsk }: {
  label: string;
  subtitle: string;
  complete: boolean;
  value: string | null;
  isNext: boolean;
  field: 'priority' | 'money' | 'challenge' | 'authority';
  onAsk: (f: typeof field) => void;
}) {
  return (
    <div
      id={`camp-${field}`}
      className={`p-3 rounded-lg border-2 ${
        complete
          ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950'
          : isNext
          ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 ring-2 ring-blue-300 dark:ring-blue-700'
          : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{label}</span>
        {complete ? (
          <span className="text-green-600 dark:text-green-400 text-xs font-bold">Done</span>
        ) : isNext ? (
          <span className="text-blue-600 dark:text-blue-400 text-xs font-bold">Next</span>
        ) : (
          <span className="text-gray-400 dark:text-gray-500 text-xs">Pending</span>
        )}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</div>
      {value ? (
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-1">{value}</div>
      ) : (
        <button onClick={() => onAsk(field)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1">
          Ask →
        </button>
      )}
    </div>
  );
}

export default function CampDiscoveryCard({ lead, onAskCampField }: Props) {
  const done = [lead.campPriorityComplete, lead.campMoneyComplete, lead.campChallengeComplete, lead.campAuthorityComplete].filter(Boolean).length;
  const allDone = done === 4;
  const [expanded, setExpanded] = useState(!allDone);

  const nextField: 'priority' | 'money' | 'challenge' | 'authority' | null =
    !lead.campPriorityComplete ? 'priority' :
    !lead.campMoneyComplete ? 'money' :
    !lead.campChallengeComplete ? 'challenge' :
    !lead.campAuthorityComplete ? 'authority' : null;

  if (allDone && !expanded) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">CAMP Complete</div>
            <div className="text-sm text-gray-700 dark:text-gray-300 mt-1">
              Timeline {lead.timeline ?? '?'} days • Asking {lead.askingPrice ? `$${lead.askingPrice.toLocaleString()}` : '?'} • {lead.conditionLevel ?? '?'} condition • {lead.ownershipStatus?.replace('_', ' ') ?? '?'}
            </div>
          </div>
          <button onClick={() => setExpanded(true)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Expand</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">CAMP Discovery</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">{done}/4 complete</span>
          {allDone && (
            <button onClick={() => setExpanded(false)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Collapse</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CampCell label="Priority" subtitle="Timeline" complete={!!lead.campPriorityComplete} value={lead.timeline ? `${lead.timeline} days` : null} isNext={nextField === 'priority'} field="priority" onAsk={onAskCampField} />
        <CampCell label="Money" subtitle="Asking Price" complete={!!lead.campMoneyComplete} value={lead.askingPrice ? `$${lead.askingPrice.toLocaleString()}` : null} isNext={nextField === 'money'} field="money" onAsk={onAskCampField} />
        <CampCell label="Challenge" subtitle="Condition" complete={!!lead.campChallengeComplete} value={lead.conditionLevel || null} isNext={nextField === 'challenge'} field="challenge" onAsk={onAskCampField} />
        <CampCell label="Authority" subtitle="Ownership" complete={!!lead.campAuthorityComplete} value={lead.ownershipStatus?.replace('_', ' ') || null} isNext={nextField === 'authority'} field="authority" onAsk={onAskCampField} />
      </div>

      {!allDone && nextField && (
        <button
          onClick={() => onAskCampField(nextField)}
          className="mt-4 w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
        >
          Ask about {nextField === 'priority' ? 'timeline' : nextField === 'money' ? 'asking price' : nextField === 'challenge' ? 'condition' : 'ownership'} →
        </button>
      )}
    </div>
  );
}
