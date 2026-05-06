// Per-user persistence for the AI curation view + display mode.
// Plain localStorage keyed by stable strings. SSR-safe (returns the
// default when window is undefined).

import type { CurationView } from '@/components/aiCompCuration/ViewToggle';
import type { DisplayMode } from '@/components/aiCompCuration/DisplayModeToggle';

const VIEW_KEY = 'dealcore.curation.view';
const DISPLAY_MODE_KEY = 'dealcore.curation.displayMode';

export function readCurationView(): CurationView {
  if (typeof window === 'undefined') return 'curated';
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    if (v === 'curated' || v === 'all') return v;
  } catch {
    // localStorage may throw in private mode; ignore and fall through.
  }
  return 'curated';
}

export function writeCurationView(v: CurationView): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    // Ignore quota / private-mode failures — non-essential persistence.
  }
}

export function readDisplayMode(): DisplayMode {
  if (typeof window === 'undefined') return 'cards';
  try {
    const v = window.localStorage.getItem(DISPLAY_MODE_KEY);
    if (v === 'cards' || v === 'table' || v === 'map') return v;
  } catch {
    // ignore
  }
  return 'cards';
}

export function writeDisplayMode(v: DisplayMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISPLAY_MODE_KEY, v);
  } catch {
    // ignore
  }
}
