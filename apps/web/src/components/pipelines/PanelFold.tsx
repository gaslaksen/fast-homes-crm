'use client';

import { ReactNode, useCallback, useEffect, useState } from 'react';

/**
 * A collapsible section of the work panel.
 *
 * The panel used to render fifteen sections flat, top to bottom, for every
 * lead at every stage: six screens of scrolling, with the notary and the
 * filing form above "Who inherited" on a lead nobody had reached. A fold
 * carries its state in its header, so a closed section still says what
 * happened ("Replied 30 Aug, 5 touches"), and the stage decides which one
 * opens. Everything is still one click away; nothing is removed.
 *
 * A native <details> rather than a hand-rolled toggle: keyboard, screen
 * readers and find-in-page all work without any code here.
 */
export type FoldState = 'open' | 'done' | 'wait';

export function Fold({
  title,
  status,
  state,
  open,
  onToggle,
  children,
}: {
  title: string;
  /** One line of state for the closed header. */
  status?: ReactNode;
  /** open: the work right now. done: finished, folded with a check. wait: not the work yet. */
  state: FoldState;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      className={`dc-fold ${state}`}
      open={open}
      onToggle={(e) => {
        // The toggle event also fires when React sets the attribute. Only a
        // change away from the current prop is the person clicking.
        const now = (e.target as HTMLDetailsElement).open;
        if (now !== open) onToggle(now);
      }}
    >
      <summary>
        <span className="dc-fold-mark" aria-hidden="true">
          {state === 'done' ? '✓' : ''}
        </span>
        <span className="dc-fold-title">{title}</span>
        {status ? <span className="dc-fold-status">{status}</span> : <span />}
        <span className="dc-fold-chev" aria-hidden="true">
          ›
        </span>
      </summary>
      <div className="dc-fold-body">{children}</div>
    </details>
  );
}

const STORE_KEY = 'dc-surplus-folds';
const STORE_MAX = 300;

type Stored = Record<string, { open: boolean; stage: string; at: number }>;

function read(): Stored {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function write(s: Stored) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* private mode or full: the defaults are fine */
  }
}

/**
 * What this person opened or closed on this lead, remembered in the browser
 * and forgotten the moment the stage moves. The default always matches the
 * work; a hand-set override survives only while the work is the same.
 */
export function useFolds(leadId: string, stage: string) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const s = read();
    const prefix = `${leadId}|`;
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(s)) {
      if (k.startsWith(prefix) && v && v.stage === stage) out[k.slice(prefix.length)] = v.open;
    }
    setOverrides(out);
  }, [leadId, stage]);

  const set = useCallback(
    (key: string, open: boolean) => {
      setOverrides((o) => ({ ...o, [key]: open }));
      const s = read();
      s[`${leadId}|${key}`] = { open, stage, at: Date.now() };
      const keys = Object.keys(s);
      if (keys.length > STORE_MAX) {
        keys
          .sort((a, b) => (s[a]?.at || 0) - (s[b]?.at || 0))
          .slice(0, keys.length - STORE_MAX)
          .forEach((k) => delete s[k]);
      }
      write(s);
    },
    [leadId, stage],
  );

  return { overrides, set };
}
