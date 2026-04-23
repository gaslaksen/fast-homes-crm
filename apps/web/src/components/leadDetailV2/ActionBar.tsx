'use client';

import { useState, useRef, useEffect } from 'react';
import type { PrimaryAction } from './actionMap';

interface Props {
  lead: any;
  primary: PrimaryAction;
  onPrimary: () => void;
  quickActions: {
    onSms: () => void;
    onCall: () => void;
    onAiCall: () => void;
    onFollowUp: () => void;
    onShare: () => void;
    onOffer: () => void;
    onMarkDead: () => void;
  };
  status: {
    autoRespond: boolean;
    onToggleAutoRespond: () => void;
    togglingAutoRespond: boolean;
    portalViewCount?: number;
  };
}

function IconBtn({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:opacity-40 transition-colors"
    >
      {children}
    </button>
  );
}

export default function ActionBar({ lead, primary, onPrimary, quickActions, status }: Props) {
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!secondaryOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setSecondaryOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [secondaryOpen]);

  const isDead = lead.status === 'DEAD' || lead.tier === 3;

  return (
    <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2 bg-white/90 dark:bg-gray-950/90 backdrop-blur border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Primary action */}
        <div className="relative flex" ref={menuRef}>
          <button
            onClick={onPrimary}
            className="px-4 py-2 rounded-l-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm transition-colors"
          >
            {primary.label}
          </button>
          <button
            onClick={() => setSecondaryOpen(!secondaryOpen)}
            className="px-2 py-2 rounded-r-lg bg-blue-600 hover:bg-blue-700 text-white border-l border-blue-500 shadow-sm"
            aria-label="More actions"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          {secondaryOpen && (
            <div className="absolute top-full left-0 mt-1 w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 z-30">
              <button onClick={() => { setSecondaryOpen(false); quickActions.onSms(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Send SMS</button>
              <button onClick={() => { setSecondaryOpen(false); quickActions.onCall(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Call seller</button>
              <button onClick={() => { setSecondaryOpen(false); quickActions.onAiCall(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Start AI call</button>
              <button onClick={() => { setSecondaryOpen(false); quickActions.onFollowUp(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Schedule follow-up</button>
              <button onClick={() => { setSecondaryOpen(false); quickActions.onOffer(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Send offer</button>
              <button onClick={() => { setSecondaryOpen(false); quickActions.onShare(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Share with partners</button>
              <div className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
              <button onClick={() => { setSecondaryOpen(false); quickActions.onMarkDead(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-red-600 dark:text-red-400">Mark dead</button>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-1.5">
          <IconBtn title="Send SMS" onClick={quickActions.onSms} disabled={isDead}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
          </IconBtn>
          <IconBtn title="Call seller" onClick={quickActions.onCall} disabled={isDead || !!lead.doNotContact}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
          </IconBtn>
          <IconBtn title="Start AI call" onClick={quickActions.onAiCall} disabled={isDead || !!lead.doNotContact}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
          </IconBtn>
          <IconBtn title="Schedule follow-up" onClick={quickActions.onFollowUp}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </IconBtn>
          <IconBtn title="Share with partners" onClick={quickActions.onShare}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
          </IconBtn>
          <IconBtn title="Send offer" onClick={quickActions.onOffer} disabled={isDead}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </IconBtn>
          <IconBtn title="Mark dead" onClick={quickActions.onMarkDead} disabled={isDead}>
            <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </IconBtn>
        </div>

        {/* Status indicators — pushed right */}
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <button
            onClick={status.onToggleAutoRespond}
            disabled={status.togglingAutoRespond}
            title={`Auto-Respond: ${status.autoRespond ? 'ON' : 'OFF'} — click to toggle`}
            className={`text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${
              status.autoRespond
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-300 dark:border-green-800'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-700'
            }`}
          >
            ✨ AI {status.autoRespond ? 'ON' : 'OFF'}
          </button>
          {typeof status.portalViewCount === 'number' && (
            <span
              title={status.portalViewCount > 0 ? `Portal viewed ${status.portalViewCount}×` : 'Portal not viewed yet'}
              className="text-[11px] font-medium px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-700"
            >
              👁 {status.portalViewCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
