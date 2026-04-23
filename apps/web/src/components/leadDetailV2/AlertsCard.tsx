'use client';

import type { Contradiction } from './useContradictions';

interface Props {
  contradictions: Contradiction[];
  onDismiss: (ruleId: string, fingerprint: string) => void;
}

export default function AlertsCard({ contradictions, onDismiss }: Props) {
  if (contradictions.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4">
      <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200 mb-2 flex items-center gap-2">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.485 3.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 3.495zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
        {contradictions.length} {contradictions.length === 1 ? 'alert' : 'alerts'}
      </h3>
      <div className="space-y-3">
        {contradictions.map((c) => (
          <div key={c.id} className="rounded-lg bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900 p-3">
            <div className="text-sm text-gray-800 dark:text-gray-200 mb-2">{c.message}</div>
            <div className="flex flex-wrap gap-2">
              {c.actions.map((a) => (
                <button
                  key={a.label}
                  onClick={a.onClick}
                  className="text-xs font-semibold px-2 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700"
                >
                  {a.label}
                </button>
              ))}
              <button
                onClick={() => onDismiss(c.id, c.fingerprint)}
                className="text-xs text-gray-500 dark:text-gray-400 hover:underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
