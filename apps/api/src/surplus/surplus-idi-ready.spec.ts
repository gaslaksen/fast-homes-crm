import { SurplusIdiService } from './surplus-idi.service';

/**
 * "Ready for IDI" is the board's own Send to IDI queue, inside the trace
 * window and not already waiting on a batch. Pinned so the Monday export
 * and the pull's run note can never disagree with the board.
 */
const NOW = new Date('2026-11-02T13:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);

function harness(rows: any[], env: Record<string, string> = {}) {
  const list = jest.fn(async ({ page }: any) => ({
    data: page === 1 ? rows : [],
    total: rows.length,
    pageSize: 200,
  }));
  const config: any = { get: (k: string) => env[k] };
  const prisma: any = {};
  const svc = new SurplusIdiService(prisma, config, { list } as any);
  return { svc, list };
}

const row = (id: string, over: any = {}) => ({
  id,
  claimStatus: 'open',
  stage: 'New',
  noticeDate: daysAgo(150),
  saleDate: null,
  isDeceased: false,
  idiPendingBatch: null,
  ...over,
});

describe('SurplusIdiService.readyForIdi', () => {
  it('asks the board for the Send to IDI queue, one lead per row, in the county asked for', async () => {
    const { svc, list } = harness([row('a'), row('b')]);
    const r = await svc.readyForIdi({ organizationId: 'org1', county: 'Hernando', now: NOW });
    expect(r.leadIds).toEqual(['a', 'b']);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org1', queue: 'trace', group: 'lead', county: 'Hernando', pageSize: 200, page: 1 }),
    );
  });

  it('leaves out claimants already sitting in a batch that has not come back, and counts them', async () => {
    const { svc } = harness([row('a'), row('b', { idiPendingBatch: 'B014' })]);
    const r = await svc.readyForIdi({ now: NOW });
    expect(r.leadIds).toEqual(['a']);
    expect(r.waiting).toBe(1);
  });

  it('holds the ones too young or too old for a paid lookup', async () => {
    const { svc } = harness([
      row('young', { noticeDate: daysAgo(40) }),
      row('old', { noticeDate: daysAgo(400) }),
      row('ok', { noticeDate: daysAgo(200) }),
    ]);
    const r = await svc.readyForIdi({ now: NOW });
    expect(r.leadIds).toEqual(['ok']);
    expect(r.overAge).toBe(2);
  });

  it('honours the trace window settings', async () => {
    const { svc } = harness([row('a', { noticeDate: daysAgo(40) })], { SURPLUS_TRACE_MIN_AGE_DAYS: '0' });
    const r = await svc.readyForIdi({ now: NOW });
    expect(r.leadIds).toEqual(['a']);
  });

  it('is empty, not an error, without the board service', async () => {
    const svc = new SurplusIdiService({} as any, { get: () => undefined } as any);
    expect(await svc.readyForIdi({})).toEqual({ leadIds: [], waiting: 0, overAge: 0 });
  });
});

describe('SurplusIdiService.exportReady', () => {
  it('says nobody is ready rather than building an empty file', async () => {
    const { svc } = harness([row('b', { idiPendingBatch: 'B014' })]);
    const r = await svc.exportReady({ now: NOW } as any);
    expect(r.included).toBe(0);
    expect(r.batch).toBeNull();
    expect(r.waiting).toBe(1);
  });

  it('exports exactly the ready ids as one batch', async () => {
    const { svc } = harness([row('a'), row('b')]);
    const exportBatch = jest.spyOn(svc, 'exportBatch').mockResolvedValue({
      csv: 'x', fileName: 'f.csv', included: 2, skipped: [], batch: { id: 'bt', number: 15, code: 'B015' },
    } as any);
    const r = await svc.exportReady({ organizationId: 'org1', userId: 'u1', now: NOW } as any);
    expect(exportBatch).toHaveBeenCalledWith({ organizationId: 'org1', leadIds: ['a', 'b'], userId: 'u1' });
    expect(r.included).toBe(2);
    expect(r.batch?.code).toBe('B015');
  });
});
