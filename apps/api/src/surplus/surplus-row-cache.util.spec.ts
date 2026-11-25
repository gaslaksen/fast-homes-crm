import { SurplusRowCache, rowStamp } from './surplus-row-cache.util';

describe('SurplusRowCache', () => {
  let clock: number;
  const now = () => clock;
  beforeEach(() => {
    clock = 1_000_000;
  });

  it('reuses a row while its stamp matches and the window is open', () => {
    const cache = new SurplusRowCache<string>(20_000, now);
    cache.set('lead1', 'stamp-a', 'row');
    clock += 19_000;
    expect(cache.get('lead1', 'stamp-a')).toBe('row');
  });

  it('rebuilds as soon as the stamp changes', () => {
    const cache = new SurplusRowCache<string>(20_000, now);
    cache.set('lead1', 'stamp-a', 'row');
    expect(cache.get('lead1', 'stamp-b')).toBeUndefined();
  });

  it('rebuilds once the window closes, even with the same stamp', () => {
    const cache = new SurplusRowCache<string>(20_000, now);
    cache.set('lead1', 'stamp-a', 'row');
    clock += 20_000;
    expect(cache.get('lead1', 'stamp-a')).toBeUndefined();
  });

  it('peek ignores the window but never hands back a row under another stamp', () => {
    const cache = new SurplusRowCache<string>(20_000, now);
    cache.set('lead1', 'stamp-a', 'row');
    clock += 60_000;
    expect(cache.peek('lead1', 'stamp-a')).toBe('row');
    expect(cache.peek('lead1', 'stamp-b')).toBeUndefined();
    expect(cache.peek('nobody', 'stamp-a')).toBeUndefined();
  });

  it('prune drops only the rows past the window', () => {
    const cache = new SurplusRowCache<string>(20_000, now);
    cache.set('old', 's', 'row');
    clock += 15_000;
    cache.set('new', 's', 'row');
    clock += 6_000;
    cache.prune();
    expect(cache.size).toBe(1);
    expect(cache.get('new', 's')).toBe('row');
  });
});

describe('rowStamp', () => {
  const base = {
    id: 'lead1',
    updatedAt: new Date('2026-11-25T14:00:00Z'),
    surplusDetail: {
      updatedAt: new Date('2026-11-25T14:00:00Z'),
      heirs: [{ id: 'h1', updatedAt: new Date('2026-11-25T13:00:00Z') }],
      _count: { letters: 1, documents: 0, expenses: 0, traceAttempts: 2, socialProfiles: 0, addresses: 1, batchMembers: 0 },
    },
    _count: { callLogs: 0, messages: 3, emails: 0, surplusTouches: 0, tasks: 1 },
  };
  const variant = (f: (s: any) => void) => {
    const s = JSON.parse(JSON.stringify(base));
    f(s);
    return rowStamp(s);
  };

  it('is the same for the same data', () => {
    expect(rowStamp(base)).toBe(variant(() => undefined));
  });

  it.each([
    ['the claim is edited', (s: any) => (s.surplusDetail.updatedAt = '2026-11-25T14:00:01.000Z')],
    ['the lead is edited', (s: any) => (s.updatedAt = '2026-11-25T14:00:01.000Z')],
    ['an heir is edited', (s: any) => (s.surplusDetail.heirs[0].updatedAt = '2026-11-25T14:00:01.000Z')],
    ['an heir is added', (s: any) => s.surplusDetail.heirs.push({ id: 'h2', updatedAt: '2026-11-25T14:00:00.000Z' })],
    ['an heir is removed', (s: any) => (s.surplusDetail.heirs = [])],
    ['a text goes out', (s: any) => (s._count.messages = 4)],
    ['a letter is logged', (s: any) => (s.surplusDetail._count.letters = 2)],
    ['an IDI send is pending', (s: any) => (s.surplusDetail._count.batchMembers = 1)],
    ['a task is completed', (s: any) => (s._count.tasks = 0)],
  ])('changes when %s', (_label, change) => {
    expect(variant(change)).not.toBe(rowStamp(base));
  });
});
