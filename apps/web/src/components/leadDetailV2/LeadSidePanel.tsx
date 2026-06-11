'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import NotesPanel from '@/components/communications/NotesPanel';
import type { NoteItem } from '@/components/communications/types';
import LeadRail from '@/components/leadDetailV2/LeadRail';

export type SidePanelMode = 'contact' | 'notes' | 'activity';

const MODE_LABELS: Record<SidePanelMode, string> = {
  contact: 'Contact',
  notes: 'Notes',
  activity: 'Activity',
};

// Lightweight icon + color cues for the Activity Log. Disposition-v2 events
// (PROFIT_BUCKET_CHANGED, COST_*, LEAD_ACQUIRED, FINAL_SALE_RECORDED,
// DISPOSITION_PLAN_UPDATED) get a money/calendar visual; legacy events stay
// uncolored so the change doesn't perturb existing rows.
const ACTIVITY_TYPE_META: Record<string, { icon?: string; color?: string }> = {
  PROFIT_BUCKET_CHANGED:    { icon: '📊', color: 'text-blue-600 dark:text-blue-400' },
  COST_ADDED:               { icon: '💸', color: 'text-amber-600 dark:text-amber-400' },
  COST_UPDATED:             { icon: '💸', color: 'text-amber-600 dark:text-amber-400' },
  COST_DELETED:             { icon: '💸', color: 'text-gray-400 dark:text-gray-500' },
  LEAD_ACQUIRED:            { icon: '🏷️', color: 'text-cyan-600 dark:text-cyan-400' },
  FINAL_SALE_RECORDED:      { icon: '🏁', color: 'text-green-600 dark:text-green-400' },
  DISPOSITION_PLAN_UPDATED: { icon: '🗺️', color: 'text-purple-600 dark:text-purple-400' },
  OFFER_MADE:               { icon: '✉️', color: 'text-orange-600 dark:text-orange-400' },
  OFFER_ACCEPTED:           { icon: '✅', color: 'text-green-600 dark:text-green-400' },
  STATUS_CHANGED:           { icon: '🔄', color: 'text-blue-500 dark:text-blue-400' },
  DOCUMENT_SENT:            { icon: '📄', color: 'text-indigo-600 dark:text-indigo-400' },
  CAMPAIGN_ENROLLED:        { icon: '🔁', color: 'text-blue-600 dark:text-blue-400' },
  CAMPAIGN_UNENROLLED:      { icon: '🔁', color: 'text-gray-400 dark:text-gray-500' },
  CAMPAIGN_PAUSED:          { icon: '⏸️', color: 'text-yellow-600 dark:text-yellow-400' },
  CAMPAIGN_RESUMED:         { icon: '▶️', color: 'text-green-600 dark:text-green-400' },
};

interface Props {
  /** Which panes to offer; the first entry is the default mode. */
  modes: SidePanelMode[];
  /** localStorage namespace, e.g. 'dealcore:leadPane' or 'dealcore:inboxPane'. */
  storagePrefix: string;
  /** Label on the collapsed edge button. */
  collapsedLabel?: string;
  lead: any | null;
  notes: NoteItem[];
  currentUser: any;
  onAddNote: (text: string) => Promise<void>;
  /** Required when 'contact' is offered; merged into the host's lead state. */
  onLeadPatch?: (patch: any) => void;
  onMarkDead?: () => void;
  /** Hide LeadRail's back-to-queue header when hosted outside the lead page. */
  hideRailNav?: boolean;
}

// Desktop right pane shared by the lead workspace and the inbox: a
// Contact / Notes / Activity switcher that collapses to an edge tab.
export default function LeadSidePanel({
  modes,
  storagePrefix,
  collapsedLabel = 'Details',
  lead,
  notes,
  currentUser,
  onAddNote,
  onLeadPatch,
  onMarkDead,
  hideRailNav,
}: Props) {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<SidePanelMode>(modes[0]);

  useEffect(() => {
    try {
      const storedOpen = window.localStorage.getItem(`${storagePrefix}:open`);
      if (storedOpen !== null) setOpen(storedOpen === 'true');
      const storedMode = window.localStorage.getItem(`${storagePrefix}:mode`);
      if (storedMode && (modes as string[]).includes(storedMode)) {
        setMode(storedMode as SidePanelMode);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storagePrefix]);

  const toggleOpen = () => {
    setOpen((prev) => {
      try { window.localStorage.setItem(`${storagePrefix}:open`, String(!prev)); } catch {}
      return !prev;
    });
  };

  const switchMode = (m: SidePanelMode) => {
    setMode(m);
    try { window.localStorage.setItem(`${storagePrefix}:mode`, m); } catch {}
  };

  if (!open) {
    return (
      <div className="hidden lg:block shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <button
          type="button"
          onClick={toggleOpen}
          title={`Show ${collapsedLabel.toLowerCase()}`}
          className="h-full px-1.5 py-4 text-[11px] font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors [writing-mode:vertical-rl]"
        >
          {collapsedLabel}
        </button>
      </div>
    );
  }

  return (
    <aside className="hidden lg:flex w-80 xl:w-96 shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex-col lg:min-h-0">
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-1">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                mode === m
                  ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={toggleOpen}
          title="Collapse pane"
          className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <div className={`flex-1 overflow-y-auto ${mode === 'contact' ? '' : 'p-4'}`}>
        {mode === 'contact' ? (
          lead ? (
            <LeadRail
              lead={lead}
              hideNav={hideRailNav}
              onLeadPatch={onLeadPatch || (() => {})}
              onMarkDead={onMarkDead || (() => {})}
            />
          ) : (
            <div className="p-4 text-xs text-gray-400 dark:text-gray-500">
              Select a conversation to see contact details.
            </div>
          )
        ) : mode === 'notes' ? (
          <NotesPanel notes={notes} canAdd={!!currentUser} onAddNote={onAddNote} />
        ) : (
          <PaneActivityLog activities={lead?.activities || []} />
        )}
      </div>
    </aside>
  );
}

// Compact activity log for the right pane.
function PaneActivityLog({ activities }: { activities: any[] }) {
  if (activities.length === 0) {
    return <p className="text-xs text-gray-400 dark:text-gray-500">No activity yet.</p>;
  }
  return (
    <div className="space-y-2">
      {activities.map((activity: any) => {
        const meta = ACTIVITY_TYPE_META[activity.type] ?? {};
        return (
          <div key={activity.id} className="flex items-start gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-950">
            {meta.icon && (
              <span className={`shrink-0 text-sm leading-none mt-0.5 ${meta.color ?? ''}`}>{meta.icon}</span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs text-gray-800 dark:text-gray-200">{activity.description}</div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                {activity.user ? `${activity.user.firstName} ${activity.user.lastName} · ` : ''}
                {format(new Date(activity.createdAt), 'MMM d, h:mm a')}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
