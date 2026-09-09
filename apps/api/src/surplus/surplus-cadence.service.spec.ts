import { ConfigService } from '@nestjs/config';
import { SurplusCadenceService, recheckTitle, remailTitle } from './surplus-cadence.service';

/**
 * The rechecks on unreached claimants. The database is a spy: what matters
 * is which tasks get created, and for whom.
 */
const DAY = 86_400_000;
const now = new Date('2026-09-09T10:15:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

function harness(leads: any[]) {
  const created: { leadId: string; title: string }[] = [];
  const prisma: any = {
    lead: { findMany: jest.fn().mockResolvedValue(leads) },
    task: { create: jest.fn(async (a: any) => { created.push({ leadId: a.data.leadId, title: a.data.title }); return a.data; }) },
    activity: { create: jest.fn().mockResolvedValue({}) },
  };
  const config = { get: () => undefined } as unknown as ConfigService;
  const lock = { run: (_k: string, fn: () => Promise<any>) => fn() } as any;
  const svc = new SurplusCadenceService(prisma, config, lock);
  return { svc, created };
}

const lead = (over: any = {}) => ({
  id: over.id || 'l1',
  sellerFirstName: 'Myrtis',
  sellerLastName: 'Griffin',
  sellerPhone: over.phone ?? null,
  surplusDetail: {
    phone2: null,
    phone3: null,
    phone4: null,
    phone1Dnc: over.phone1Dnc ?? null,
    phone2Dnc: null,
    phone3Dnc: null,
    phone4Dnc: null,
    ownerMailingStreet: over.street ?? null,
    letterMailedTo: null,
    letters: over.lastLetter ? [{ mailedAt: over.lastLetter }] : [],
    traceAttempts: over.lastTier1 ? [{ ranAt: over.lastTier1 }] : [],
  },
  tasks: over.tasks || [],
});

describe('the recheck cadence', () => {
  it('re-runs the free searches at sixty days for somebody with no number', async () => {
    const { svc, created } = harness([lead({ lastTier1: daysAgo(61) })]);
    const r = await svc.rechecks(now);
    expect(r.recheckTasks).toBe(1);
    expect(created).toEqual([{ leadId: 'l1', title: recheckTitle('Myrtis Griffin') }]);
  });

  it('waits until the searches are actually old', async () => {
    const { svc, created } = harness([lead({ lastTier1: daysAgo(30) })]);
    await svc.rechecks(now);
    expect(created).toEqual([]);
  });

  it('leaves a claimant with a live number alone: the work there is calling', async () => {
    const { svc, created } = harness([lead({ phone: '+19045551234', lastTier1: daysAgo(90) })]);
    await svc.rechecks(now);
    expect(created).toEqual([]);
  });

  it('a number on the do-not-call list is not a live number', async () => {
    const { svc, created } = harness([lead({ phone: '+19045551234', phone1Dnc: 'federal', lastTier1: daysAgo(90) })]);
    await svc.rechecks(now);
    expect(created).toHaveLength(1);
  });

  it('never asks for a first search: that is the tracing queue', async () => {
    const { svc, created } = harness([lead({})]);
    await svc.rechecks(now);
    expect(created).toEqual([]);
  });

  it('does not stack a recheck on one already open or just done', async () => {
    const title = recheckTitle('Myrtis Griffin');
    const open = lead({ lastTier1: daysAgo(90), tasks: [{ title, completed: false, completedAt: null }] });
    const justDone = lead({ id: 'l2', lastTier1: daysAgo(90), tasks: [{ title, completed: true, completedAt: daysAgo(5) }] });
    const longDone = lead({ id: 'l3', lastTier1: daysAgo(90), tasks: [{ title, completed: true, completedAt: daysAgo(80) }] });
    const { svc, created } = harness([open, justDone, longDone]);
    await svc.rechecks(now);
    expect(created.map((c) => c.leadId)).toEqual(['l3']);
  });

  it('writes again at ninety days when there is an address and the last letter went unanswered', async () => {
    const { svc, created } = harness([
      lead({ street: '1624 W 35th St', lastLetter: daysAgo(91) }),
      lead({ id: 'l2', street: '1 Main St', lastLetter: daysAgo(40) }),
      lead({ id: 'l3', lastLetter: daysAgo(120) }),
    ]);
    const r = await svc.rechecks(now);
    expect(r.remailTasks).toBe(1);
    expect(created).toEqual([{ leadId: 'l1', title: remailTitle('Myrtis Griffin') }]);
  });
});
