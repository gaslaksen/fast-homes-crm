'use client';

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ScheduleFollowUpModal from '@/components/ScheduleFollowUpModal';

interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon?: ReactNode;
  run: () => void;
}

// Global Cmd+K / Ctrl+K command palette. Listens globally, renders a modal
// with a fuzzy-searchable action list + arrow-key navigation.
export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openPalette = useCallback(() => {
    setQuery('');
    setActiveIdx(0);
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => setOpen(false), []);

  // Global Cmd+K listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const actions = useMemo<CommandAction[]>(() => [
    {
      id: 'schedule-follow-up',
      label: 'Schedule follow-up',
      hint: 'Create a task for a lead',
      keywords: 'task reminder call',
      icon: '📅',
      run: () => {
        closePalette();
        setScheduleOpen(true);
      },
    },
    {
      id: 'new-lead',
      label: 'New lead',
      hint: 'Add a lead manually',
      keywords: 'create add',
      icon: '➕',
      run: () => {
        closePalette();
        router.push('/leads/new');
      },
    },
    {
      id: 'browse-leads',
      label: 'Browse leads',
      hint: 'Open the leads table',
      keywords: 'list search find',
      icon: '👥',
      run: () => {
        closePalette();
        router.push('/leads');
      },
    },
    {
      id: 'inbox',
      label: 'Open inbox',
      hint: 'Reply to waiting conversations',
      keywords: 'reply messages sms',
      icon: '✉️',
      run: () => {
        closePalette();
        router.push('/inbox');
      },
    },
    {
      id: 'dashboard',
      label: 'Go to dashboard',
      hint: 'Action queue + daily summary',
      keywords: 'home overview',
      icon: '🏠',
      run: () => {
        closePalette();
        router.push('/dashboard');
      },
    },
    {
      id: 'deal-search',
      label: 'Deal search',
      hint: 'Find off-market properties',
      keywords: 'find discover attom',
      icon: '🔍',
      run: () => {
        closePalette();
        router.push('/deal-search');
      },
    },
  ], [closePalette, router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => {
      const hay = `${a.label} ${a.hint || ''} ${a.keywords || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [actions, query]);

  // Keep activeIdx in range as the filtered list shrinks.
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, activeIdx]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % Math.max(filtered.length, 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const action = filtered[activeIdx];
      if (action) action.run();
    }
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4 bg-black/40 backdrop-blur-sm"
          onClick={closePalette}
        >
          <div
            className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <span className="text-gray-400">⌘</span>
              <input
                ref={inputRef}
                type="text"
                placeholder="Search commands…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIdx(0);
                }}
                className="flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
              />
              <kbd className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">
                esc
              </kbd>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto py-1">
              {filtered.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  No matching commands
                </li>
              )}
              {filtered.map((action, idx) => {
                const isActive = idx === activeIdx;
                return (
                  <li key={action.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => action.run()}
                      className={`w-full text-left flex items-center gap-3 px-4 py-2.5 transition-colors ${
                        isActive ? 'bg-teal-50 dark:bg-teal-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span className="text-lg flex-shrink-0 w-6 text-center">{action.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {action.label}
                        </div>
                        {action.hint && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {action.hint}
                          </div>
                        )}
                      </div>
                      {isActive && (
                        <kbd className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 flex-shrink-0">
                          ↵
                        </kbd>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-2 text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-4">
              <span>↑↓ navigate</span>
              <span>↵ select</span>
              <span>esc close</span>
            </div>
          </div>
        </div>
      )}
      <ScheduleFollowUpModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
      />
    </>
  );
}
