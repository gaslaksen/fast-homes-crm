import { SurplusDeadReason, SurplusStage } from '@fast-homes/shared';
import { SurplusPruneService } from './surplus-prune.service';

const NOW = new Date('2026-11-02T13:00:00Z');

function harness(rows: any[]) {
  const list = jest.fn(async ({ page }: any) => ({ data: page === 1 ? rows : [], total: rows.length, pageSize: 200 }));
  const setHold = jest.fn(async (id: string) => {
    if (id === 'bad') throw new Error('Surplus lead not found');
    return {};
  });
  const svc = new SurplusPruneService({ list, setHold } as any);
  return { svc, list, setHold };
}

const row = (id: string, over: any = {}) => ({
  id,
  claimant: `Claimant ${id}`,
  county: 'Hernando',
  caseNumber: `2025-${id}`,
  address: '1 Main St',
  grossSurplus: 20000,
  stage: SurplusStage.NEW,
  queueLabel: 'Call now',
  ownerName: null,
  lastTouchedAt: null,
  daysToCutoff: 100,
  pauseOffer: null,
  claimStatus: 'open',
  heldAt: null,
  ...over,
});

describe('SurplusPruneService.list', () => {
  it('reads the whole board with Dead hidden and the floor filter off', async () => {
    const { svc, list } = harness([]);
    await svc.list('org1', NOW);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org1', group: 'lead', hideDead: true, includeBelowFloor: true, page: 1 }),
    );
  });

  it('sorts each case into one bucket, biggest surplus first, with the course action', async () => {
    const { svc } = harness([
      row('effort', { pauseOffer: { since: NOW, days: 75, until: NOW } }),
      row('cutoff', { daysToCutoff: -3 }),
      row('floor', { grossSurplus: 2500 }),
      row('docket', { claimStatus: 'assigned' }),
      row('docket2', { claimStatus: 'distributed', grossSurplus: 90000 }),
      row('fine'),
    ]);
    const l = await svc.list(null, NOW);
    const by = Object.fromEntries(l.buckets.map((b) => [b.key, b]));
    expect(by.fullEffort.rows.map((r) => r.id)).toEqual(['effort']);
    expect(by.fullEffort.rows[0].effortDays).toBe(75);
    expect(by.fullEffort.action.kind).toBe('pause');
    expect(by.pastCutoff.rows.map((r) => r.id)).toEqual(['cutoff']);
    expect(by.pastCutoff.action).toMatchObject({ kind: 'close', deadReason: SurplusDeadReason.PAST_CUTOFF });
    expect(by.belowFloor.rows.map((r) => r.id)).toEqual(['floor']);
    expect(by.belowFloor.action).toMatchObject({ kind: 'close', deadReason: SurplusDeadReason.BELOW_FLOOR });
    expect(by.docketClosed.rows.map((r) => r.id)).toEqual(['docket2', 'docket']);
    expect(by.docketClosed.action).toMatchObject({ kind: 'close', deadReason: SurplusDeadReason.PAID_OUT });
    expect(l.total).toBe(5);
  });

  it('never offers a signed, held or Dead case', async () => {
    const { svc } = harness([
      row('signed', { stage: SurplusStage.AGREEMENT_SIGNED, daysToCutoff: -10 }),
      row('held', { heldAt: NOW, daysToCutoff: -10 }),
      row('dead', { stage: SurplusStage.DEAD, claimStatus: 'assigned' }),
    ]);
    const l = await svc.list(null, NOW);
    expect(l.total).toBe(0);
  });

  it('the docket wins over the floor and the cutoff, so a case is in one bucket only', async () => {
    const { svc } = harness([row('x', { claimStatus: 'assigned', grossSurplus: 100, daysToCutoff: -1 })]);
    const l = await svc.list(null, NOW);
    expect(l.buckets.find((b) => b.key === 'docketClosed')?.rows).toHaveLength(1);
    expect(l.total).toBe(1);
  });

  it('pauses six months out at noon UTC', async () => {
    const { svc } = harness([row('effort', { pauseOffer: { since: NOW, days: 61, until: NOW } })]);
    const l = await svc.list(null, NOW);
    const a = l.buckets[0].action;
    expect(a.kind === 'pause' && a.until.toISOString()).toBe('2027-05-02T12:00:00.000Z');
  });
});

describe('SurplusPruneService.briefLine', () => {
  it('is one sentence naming the buckets that have cases', async () => {
    const { svc } = harness([row('cutoff', { daysToCutoff: -3 }), row('floor', { grossSurplus: 2500 }), row('floor2', { grossSurplus: 10 })]);
    const l = await svc.briefLine(null);
    expect(l?.total).toBe(3);
    expect(l?.line).toBe('3 cases waiting on the weekly prune: 1 past the cutoff, 2 below the floor.');
  });

  it('is null when nothing is waiting', async () => {
    const { svc } = harness([row('fine')]);
    expect(await svc.briefLine(null)).toBeNull();
  });
});

describe('SurplusPruneService.bulkHold', () => {
  it('pauses each case with the one reason and date, and names the ones it could not', async () => {
    const { svc, setHold } = harness([]);
    const r = await svc.bulkHold(['a', 'bad', 'c'], { reason: 'Full effort, pausing', until: '2027-05-02' }, 'org1', 'u1');
    expect(r.updated).toBe(2);
    expect(r.failed).toEqual([{ id: 'bad', message: 'Surplus lead not found' }]);
    expect(setHold).toHaveBeenCalledWith('a', { on: true, reason: 'Full effort, pausing', until: '2027-05-02' }, 'org1', 'u1');
  });

  it('needs a reason and at least one case', async () => {
    const { svc } = harness([]);
    await expect(svc.bulkHold([], { reason: 'x' })).rejects.toThrow(/at least one/);
    await expect(svc.bulkHold(['a'], { reason: '' })).rejects.toThrow(/why/);
  });
});
