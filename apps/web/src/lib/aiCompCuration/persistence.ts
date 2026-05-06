// Per-user persistence for the AI curation view toggle.
// Plain localStorage keyed by a stable string. SSR-safe (returns the
// default when window is undefined).

import type { CurationView } from '@/components/aiCompCuration/ViewToggle';

const KEY = 'dealcore.curation.view';

export function readCurationView(): CurationView {
  if (typeof window === 'undefined') return 'curated';
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === 'curated' || v === 'all') return v;
  } catch {
    // localStorage may throw in private mode; ignore and fall through.
  }
  return 'curated';
}

export function writeCurationView(v: CurationView): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, v);
  } catch {
    // Ignore quota / private-mode failures — non-essential persistence.
  }
}
