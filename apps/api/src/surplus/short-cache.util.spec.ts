import { ShortCache } from './short-cache.util';

describe('ShortCache', () => {
  let clock: number;
  const now = () => clock;
  beforeEach(() => {
    clock = 1_000_000;
  });

  it('serves a cached value inside the window and recomputes after it', async () => {
    const cache = new ShortCache<number>(30_000, now);
    let calls = 0;
    const compute = async () => ++calls;

    expect(await cache.get('org1', compute)).toBe(1);
    clock += 29_000;
    expect(await cache.get('org1', compute)).toBe(1);
    clock += 2_000;
    expect(await cache.get('org1', compute)).toBe(2);
    expect(calls).toBe(2);
  });

  it('shares one computation between callers who ask at the same moment', async () => {
    const cache = new ShortCache<string>(30_000, now);
    let calls = 0;
    let release!: (v: string) => void;
    const compute = () => {
      calls++;
      return new Promise<string>((r) => (release = r));
    };

    const a = cache.get('org1', compute);
    const b = cache.get('org1', compute);
    const c = cache.get('org1', compute);
    release('counts');
    expect(await Promise.all([a, b, c])).toEqual(['counts', 'counts', 'counts']);
    expect(calls).toBe(1);
  });

  it('keeps organizations apart', async () => {
    const cache = new ShortCache<string>(30_000, now);
    expect(await cache.get('org1', async () => 'one')).toBe('one');
    expect(await cache.get('org2', async () => 'two')).toBe('two');
    expect(await cache.get('org1', async () => 'other')).toBe('one');
  });

  it('never caches a failure, so the next caller tries again', async () => {
    const cache = new ShortCache<string>(30_000, now);
    await expect(cache.get('org1', async () => { throw new Error('db down'); })).rejects.toThrow('db down');
    expect(await cache.get('org1', async () => 'recovered')).toBe('recovered');
  });

  it('dates the entry from when the work started, not when it finished', async () => {
    const cache = new ShortCache<number>(30_000, now);
    let calls = 0;
    await cache.get('org1', async () => {
      clock += 10_000; // a slow ten-second computation
      return ++calls;
    });
    clock += 21_000; // 31s after it started, 21s after it finished
    expect(await cache.get('org1', async () => ++calls)).toBe(2);
  });

  it('clear drops a key so the next call computes fresh', async () => {
    const cache = new ShortCache<number>(30_000, now);
    let calls = 0;
    await cache.get('org1', async () => ++calls);
    cache.clear('org1');
    expect(await cache.get('org1', async () => ++calls)).toBe(2);
  });
});
