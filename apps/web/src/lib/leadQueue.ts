// Morning-queue context shared between the leads list and the lead detail page.
// The list page writes the currently visible (filtered + sorted) lead ids here;
// the detail page reads it to offer prev/next navigation through that exact list.

export interface LeadQueue {
  ids: string[];
  label: string;
  returnUrl: string;
  ts: number;
}

const KEY = 'dealcore:leadQueue';
// A queue older than this is stale (yesterday's session) and ignored.
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function writeLeadQueue(queue: Omit<LeadQueue, 'ts'>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...queue, ts: Date.now() }));
  } catch {
    // sessionStorage unavailable (SSR, private mode) — queue nav simply won't show
  }
}

export function readLeadQueue(): LeadQueue | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const queue = JSON.parse(raw) as LeadQueue;
    if (!Array.isArray(queue.ids) || queue.ids.length === 0) return null;
    if (typeof queue.ts !== 'number' || Date.now() - queue.ts > MAX_AGE_MS) return null;
    return queue;
  } catch {
    return null;
  }
}
