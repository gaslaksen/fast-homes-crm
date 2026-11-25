/**
 * Built board rows, kept between requests and reused while nothing they were
 * built from has changed.
 *
 * The board list loads every matching lead with eleven related tables and
 * builds the full row for each (about 26 KB, the whole work panel), then
 * returns one page. On 3,000 leads that is about 800 ms locally and several
 * seconds in production, on every load, and the board reloads after every
 * save. On 2026-11-24 that stalled the API for 20 to 55 seconds at a time.
 *
 * Each request now asks the database only for a stamp per lead (its own and
 * its claim's updatedAt, each heir's id and updatedAt, and counts of the
 * calls, texts, emails, touches, open tasks, letters, documents, traces,
 * addresses, profiles, expenses and pending IDI sends), which is about 60 ms.
 * A row whose stamp matches is reused; the rest are rebuilt.
 *
 * Some inputs carry no stamp: an edit to an existing letter, document, trace
 * or task, the county settings, a teammate's name, and the date itself (claim
 * ages and the week's touch boxes). So a row is also rebuilt once it is older
 * than the TTL, and those changes reach the board within that window.
 */
export class SurplusRowCache<V> {
  private readonly entries = new Map<string, { stamp: string; at: number; value: V }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** The value built for this stamp, if it is still inside the TTL. */
  get(id: string, stamp: string): V | undefined {
    const e = this.entries.get(id);
    if (!e || e.stamp !== stamp || this.now() - e.at >= this.ttlMs) return undefined;
    return e.value;
  }

  /**
   * The value held for this stamp, ignoring the TTL. For reading back what
   * this request just checked or built: a row reused a moment before its
   * window closed must not drop out of the response it was checked for.
   */
  peek(id: string, stamp: string): V | undefined {
    const e = this.entries.get(id);
    return e && e.stamp === stamp ? e.value : undefined;
  }

  set(id: string, stamp: string, value: V, builtAt: number = this.now()) {
    this.entries.set(id, { stamp, at: builtAt, value });
  }

  /**
   * Drop everything past the TTL. Such entries would be rebuilt anyway, so
   * this costs nothing and keeps memory to the rows used in the last window,
   * including leads that were deleted or left the org.
   */
  prune() {
    const now = this.now();
    for (const [id, e] of this.entries) if (now - e.at >= this.ttlMs) this.entries.delete(id);
  }

  get size() {
    return this.entries.size;
  }
}

/**
 * One fingerprint string for a stamp row. Key order is fixed by the select and
 * heirs come ordered by id, so the same data always gives the same string.
 */
export function rowStamp(stampRow: unknown): string {
  return JSON.stringify(stampRow);
}
