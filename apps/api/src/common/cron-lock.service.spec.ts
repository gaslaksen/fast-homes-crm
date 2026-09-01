import { CronLockService } from './cron-lock.service';

/**
 * The lock decides whether a scheduled job runs at all, so the case that
 * matters most is the one where it cannot answer: it must fail OPEN. A
 * duplicate poll costs some wasted work; a silently skipped one costs a day of
 * leads and looks exactly like a broken feed.
 */
function harness(queryImpl: (...args: any[]) => any) {
  const $queryRaw = jest.fn(queryImpl);
  return { svc: new CronLockService({ $queryRaw } as any), $queryRaw };
}

const locked = (v: boolean) => async () => [{ locked: v }];

describe('CronLockService', () => {
  it('runs the job when it wins the lock, and releases it after', async () => {
    const { svc, $queryRaw } = harness(locked(true));
    const ran = await svc.run('job', async () => 'done');
    expect(ran).toBe('done');
    // Take, then release.
    expect($queryRaw).toHaveBeenCalledTimes(2);
  });

  it('skips the job when another replica holds the lock', async () => {
    const fn = jest.fn();
    const { svc } = harness(locked(false));
    expect(await svc.run('job', fn as any)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('runs the job anyway when the lock query itself fails', async () => {
    // Fail open. A lock we cannot take must never be the reason a daily
    // ingest stops, because that failure is invisible.
    const { svc } = harness(() => {
      throw new Error('connection reset');
    });
    expect(await svc.run('job', async () => 'done')).toBe('done');
  });

  it('releases the lock even when the job throws', async () => {
    const calls: string[] = [];
    const { svc } = harness((q: any) => {
      calls.push(String(q?.strings ? q.strings.join('') : q));
      return [{ locked: true }];
    });
    await expect(
      svc.run('job', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(calls.length).toBe(2);
    expect(calls[1]).toContain('unlock');
  });

  it('gives different names different locks, and one name a stable lock', async () => {
    const ids: bigint[] = [];
    const { svc } = harness((_q: any, id: bigint) => {
      ids.push(id);
      return [{ locked: true }];
    });
    await svc.run('surplus-poll', async () => null);
    await svc.run('daily-brief-2026-09-01', async () => null);
    await svc.run('surplus-poll', async () => null);
    // Take calls are at 0, 2, 4; the odd ones are releases.
    expect(ids[0]).not.toBe(ids[2]);
    expect(ids[0]).toBe(ids[4]);
    // Must land in the positive half of a signed 64-bit integer, which is what
    // Postgres keys advisory locks by. A negative id still works but cannot be
    // matched against a logged value by eye.
    for (const id of ids) {
      expect(id).toBeGreaterThan(0n);
      expect(id).toBeLessThan(1n << 63n);
    }

    // And it must stay a BigInt the whole way. Passing a JS number would
    // truncate above 2^53 and two names could collide into one lock.
    for (const id of ids) expect(typeof id).toBe('bigint');
  });
});
