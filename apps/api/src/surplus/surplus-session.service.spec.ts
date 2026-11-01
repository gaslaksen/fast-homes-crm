import { SurplusStage } from '@fast-homes/shared';
import { SurplusSessionService, courseOrder, startOfDayEastern } from './surplus-session.service';

const NOW = new Date('2026-11-02T15:00:00Z'); // 10am Eastern on a Monday

function harness(rows: any[], onRifle: any[] = [], calls: any[] = []) {
  const writes: any[] = [];
  const list = jest.fn(async ({ page }: any) => ({ data: page === 1 ? rows : [], total: rows.length, pageSize: 200 }));
  const prisma: any = {
    surplusDetail: {
      findMany: jest.fn(async () => onRifle),
      updateMany: jest.fn(async (args: any) => {
        writes.push(args);
        return { count: 1 };
      }),
      count: jest.fn(async ({ where }: any) => {
        if (where.leadId?.in) return where.leadId.in.length;
        return onRifle.length;
      }),
    },
    callLog: { findMany: jest.fn(async () => calls) },
  };
  const svc = new SurplusSessionService(prisma, { list } as any);
  return { svc, list, prisma, writes };
}

const row = (id: string, over: any = {}) => ({
  id,
  claimant: `Claimant ${id}`,
  county: 'Hernando',
  caseNumber: `2025-${id}`,
  address: '1 Main St',
  grossSurplus: 30000,
  netToClaimant: 25000,
  shortWindow: false,
  daysToCutoff: 120,
  daysRemaining: 145,
  stage: SurplusStage.NEW,
  queue: 'call',
  queueLabel: 'Call now',
  queueReason: '2 callable numbers',
  ownerName: null,
  tappedAt: null,
  isDeceased: false,
  doNotCall: false,
  lastTouchedAt: null,
  rifleAt: null,
  phones: [{ number: '+13525550100', type: 'Mobile', dnc: null }, { number: '+13525550101', type: 'Landline', dnc: 'federal' }],
  heirs: [],
  ...over,
});

describe('the course order', () => {
  it('puts short-window cases first, then the biggest surplus, then the nearest cutoff', () => {
    const a: any = { shortWindow: false, netToClaimant: 90000, daysToCutoff: 200 };
    const b: any = { shortWindow: true, netToClaimant: 8000, daysToCutoff: 30 };
    const c: any = { shortWindow: false, netToClaimant: 90000, daysToCutoff: 100 };
    const d: any = { shortWindow: false, netToClaimant: 20000, daysToCutoff: 10 };
    expect([a, b, c, d].sort(courseOrder)).toEqual([b, c, a, d]);
  });
});

describe('SurplusSessionService.session', () => {
  it('asks the board for Call now and Likely match, early cases hidden, Dead hidden', async () => {
    const { svc, list } = harness([]);
    await svc.session({ organizationId: 'org1', size: 25, now: NOW });
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org1', queue: ['call', 'likely'], hideEarly: true, hideDead: true, group: 'lead', page: 1 }),
    );
  });

  it('splits the rifle list from the candidates and orders both the course way', async () => {
    const { svc } = harness([
      row('big', { netToClaimant: 90000 }),
      row('short', { shortWindow: true, netToClaimant: 9000, rifleAt: NOW }),
      row('mid', { netToClaimant: 40000, rifleAt: NOW }),
      row('small', { netToClaimant: 12000 }),
    ]);
    const s = await svc.session({ size: 25, now: NOW });
    expect(s.rifle.map((c) => c.id)).toEqual(['short', 'mid']);
    expect(s.candidates.map((c) => c.id)).toEqual(['big', 'small']);
    expect(s.target).toBe(25);
    expect(s.rifleMax).toBe(30);
  });

  it('lists each person with only dialable numbers, the claimant first, and leaves off people with none', async () => {
    const { svc } = harness([
      row('a', {
        heirs: [
          { id: 'h-neighbor', name: 'NEXT DOOR', role: 'neighbor', relationship: null, deceased: false, doNotCall: false, phones: [{ number: '+13525550900', type: null, dnc: null }] },
          { id: 'h-son', name: 'ROBERT', role: 'relative', relationship: 'son', deceased: false, doNotCall: false, phones: [{ number: '+13525550141', type: 'Mobile', dnc: null }] },
          { id: 'h-none', name: 'NOBODY', role: 'relative', relationship: 'niece', deceased: false, doNotCall: false, phones: [] },
          { id: 'h-dnc', name: 'STOPPED', role: 'relative', relationship: 'son', deceased: false, doNotCall: true, phones: [{ number: '+13525550999', type: null, dnc: null }] },
        ],
      }),
    ]);
    const s = await svc.session({ size: 25, now: NOW });
    const people = s.candidates[0].people;
    expect(people.map((p) => p.name)).toEqual(['Claimant a', 'ROBERT', 'NEXT DOOR']);
    expect(people[0].numbers).toEqual([{ number: '+13525550100', type: 'Mobile' }]);
    expect(people[1].relationship).toBe('son');
  });

  it("does not offer a dead claimant's own number", async () => {
    const { svc } = harness([
      row('a', {
        isDeceased: true,
        heirs: [{ id: 'h', name: 'HEIR', role: 'heir', relationship: 'daughter', deceased: false, doNotCall: false, phones: [{ number: '+13525550141', type: null, dnc: null }] }],
      }),
    ]);
    const s = await svc.session({ size: 25, now: NOW });
    expect(s.candidates[0].people.map((p) => p.name)).toEqual(['HEIR']);
  });

  it('takes a rifle case off the list when it is no longer callable, and says who left', async () => {
    const { svc, writes } = harness(
      [row('a', { rifleAt: NOW })],
      [
        { leadId: 'a', stage: 'New', heldAt: null, lead: { sellerFirstName: 'A', sellerLastName: 'One' } },
        { leadId: 'gone', stage: 'New', heldAt: null, lead: { sellerFirstName: 'Mary', sellerLastName: 'Left' } },
        { leadId: 'dead', stage: 'Dead', heldAt: null, lead: { sellerFirstName: 'D', sellerLastName: 'Ead' } },
      ],
    );
    const s = await svc.session({ size: 25, now: NOW });
    expect(s.retired.map((r) => r.claimant).sort()).toEqual(['D Ead', 'Mary Left']);
    expect(writes[0].where.leadId.in.sort()).toEqual(['dead', 'gone']);
    expect(writes[0].data).toEqual({ rifleAt: null });
    expect(s.rifle.map((c) => c.id)).toEqual(['a']);
  });

  it("counts today's dialer calls on surplus leads against the target", async () => {
    const { svc, prisma } = harness([], [], [{ outcome: 'spoke_claimant' }, { outcome: 'no_answer' }, { outcome: null }]);
    const s = await svc.session({ organizationId: 'org1', size: 25, now: NOW });
    expect(s.stats).toEqual({ calls: 3, connected: 1, withOutcome: 2, target: 25 });
    const where = prisma.callLog.findMany.mock.calls[0][0].where;
    expect(where.type).toBe('twilio_browser');
    expect(where.createdAt.gte.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(where.lead.organizationId).toBe('org1');
  });

  it('keeps the target between 5 and 100', async () => {
    const { svc } = harness([]);
    expect((await svc.session({ size: 1, now: NOW })).target).toBe(5);
    expect((await svc.session({ size: 500, now: NOW })).target).toBe(100);
    expect((await svc.session({ size: null, now: NOW })).target).toBe(25);
  });
});

describe('SurplusSessionService.setRifle', () => {
  it('adds and removes, scoped to surplus leads', async () => {
    const { svc, prisma } = harness([], []);
    prisma.surplusDetail.count = jest.fn(async ({ where }: any) => (where.leadId?.in ? where.leadId.in.length : 0));
    await svc.setRifle({ organizationId: 'org1', add: ['a', 'b'], remove: ['c'] });
    const calls = prisma.surplusDetail.updateMany.mock.calls.map((c: any) => c[0]);
    expect(calls[0]).toMatchObject({ where: { organizationId: 'org1', leadId: { in: ['c'] } }, data: { rifleAt: null } });
    expect(calls[1].where).toMatchObject({ organizationId: 'org1', leadId: { in: ['a', 'b'] }, rifleAt: null, lead: { source: 'SURPLUS' } });
    expect(calls[1].data.rifleAt).toBeInstanceOf(Date);
  });

  it('refuses to grow past thirty', async () => {
    const { svc, prisma } = harness([], []);
    prisma.surplusDetail.count = jest.fn(async ({ where }: any) => (where.leadId?.in ? where.leadId.in.length : 29));
    await expect(svc.setRifle({ add: ['a', 'b'] })).rejects.toThrow(/30 cases at most/);
  });
});

describe('startOfDayEastern', () => {
  it('is midnight New York on the same calendar day', () => {
    expect(startOfDayEastern(new Date('2026-11-02T15:00:00Z')).toISOString()).toBe('2026-11-02T05:00:00.000Z');
    // 11pm Eastern is 4am UTC the next day; the day is still the Eastern one.
    expect(startOfDayEastern(new Date('2026-07-15T03:30:00Z')).toISOString()).toBe('2026-07-14T04:00:00.000Z');
  });
});
