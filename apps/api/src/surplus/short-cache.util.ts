/**
 * A per-key result cache with a short life, that also shares one in-flight
 * computation between callers who ask at the same moment.
 *
 * Built for the surplus board's headline counts. Each one loads and shapes
 * every surplus lead, about four seconds of a single-process API, and the
 * board asks for them on load and after most saves. On 2026-11-24 three agent
 * browsers working the board at once called it 491 times in four hours; the
 * process stalled for 20 to 55 seconds at a time, every other request (saves
 * and sign-in checks included) waited behind it, and the agent read the
 * resulting reloads as being signed out.
 *
 * A failed computation is never cached, so the next caller tries again.
 */
export class ShortCache<T> {
  private readonly done = new Map<string, { value: T; at: number }>();
  private readonly pending = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string, compute: () => Promise<T>): Promise<T> {
    const hit = this.done.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;

    const running = this.pending.get(key);
    if (running) return running;

    const started = this.now();
    const p = compute()
      .then((value) => {
        // Stamped with when the work STARTED, so a slow computation does not
        // buy itself a longer life than the window promises.
        this.done.set(key, { value, at: started });
        return value;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, p);
    return p;
  }

  /** Drop one key, or everything, so the next call computes fresh. */
  clear(key?: string) {
    if (key === undefined) this.done.clear();
    else this.done.delete(key);
  }
}
