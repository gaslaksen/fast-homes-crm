import { SurplusOutreachService } from './surplus-outreach.service';
import { daysLeftToWork, outreachGroup, outreachRank, personReachable } from './surplus-outreach.util';

describe('outreachRank', () => {
  it('puts the claimant first, then spouse, children, heirs, family and the rest', () => {
    const people = [
      { relationship: 'Neighbor', role: 'neighbor' },
      { relationship: 'Brother', role: 'relative' },
      { relationship: 'Son', role: 'heir' },
      { isClaimant: true },
      { relationship: null, role: 'heir' },
      { relationship: 'Wife', role: 'relative' },
      { relationship: 'Possible relative', role: 'relative' },
      { relationship: 'Coworker', role: 'associate' },
    ];
    const order = people
      .map((p) => outreachRank(p))
      .sort((a, b) => a.rank - b.rank)
      .map((r) => r.label);
    expect(order).toEqual(['Claimant', 'Spouse', 'Child', 'Heir', 'Sibling', 'Relative', 'Neighbor', 'Associate']);
  });

  it('sinks the dead and the do-not-call below everyone, even a claimant', () => {
    expect(outreachRank({ isClaimant: true, deceased: true }).rank).toBeGreaterThan(outreachRank({ role: 'neighbor' }).rank);
    expect(outreachRank({ relationship: 'Son', doNotCall: true }).label).toBe('Do not contact');
  });
});

describe('outreach grouping', () => {
  it('counts down to a year off the notice, the sale standing in', () => {
    expect(daysLeftToWork(340, 400)).toBe(25);
    expect(daysLeftToWork(null, 300)).toBe(65);
    expect(daysLeftToWork(null, null)).toBeNull();
  });

  it('bands by days left, with hold and no contact path at the bottom whatever the date', () => {
    expect(outreachGroup({ queue: 'call', daysLeft: 10, reachable: true })).toBe('soon');
    expect(outreachGroup({ queue: 'call', daysLeft: 60, reachable: true })).toBe('month');
    expect(outreachGroup({ queue: 'call', daysLeft: 200, reachable: true })).toBe('later');
    expect(outreachGroup({ queue: 'call', daysLeft: -3, reachable: true })).toBe('past');
    expect(outreachGroup({ queue: 'call', daysLeft: 10, reachable: false })).toBe('no_path');
    expect(outreachGroup({ queue: 'hold', daysLeft: 10, reachable: true })).toBe('hold');
  });

  it('calls a person reachable by a working number, an email, or an address that has not bounced', () => {
    const base = { phones: [], emails: [], address: null };
    expect(personReachable({ ...base, phones: [{ dnc: null, bad: true }] })).toBe(false);
    expect(personReachable({ ...base, phones: [{ dnc: null, bad: false }] })).toBe(true);
    expect(personReachable({ ...base, emails: ['a@example.com'] })).toBe(true);
    expect(personReachable({ ...base, address: '1 Main St' })).toBe(true);
    expect(personReachable({ ...base, address: '1 Main St', mailReturned: true })).toBe(false);
    expect(personReachable({ ...base, emails: ['a@example.com'], deceased: true })).toBe(false);
  });
});

function build(rows: any[], extra: { touches?: any[]; calls?: any[]; texts?: any[]; emails?: any[] } = {}) {
  const prisma: any = {
    surplusBatch: { findFirst: jest.fn().mockResolvedValue({ id: 'b1', number: 3 }) },
    surplusTouch: {
      findMany: jest.fn().mockResolvedValue(extra.touches || []),
      create: jest.fn(async ({ data }) => ({ id: 't1', ...data })),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    callLog: { groupBy: jest.fn().mockResolvedValue(extra.calls || []) },
    message: { groupBy: jest.fn().mockResolvedValue(extra.texts || []) },
    email: { groupBy: jest.fn().mockResolvedValue(extra.emails || []) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', firstName: 'Ian', lastName: 'Tester', email: 'i@example.com' }]) },
    lead: {
      findFirst: jest.fn().mockResolvedValue({ id: 'L1', sellerFirstName: 'Ada', sellerLastName: 'Quill', surplusDetail: { id: 'd1' } }),
      update: jest.fn().mockResolvedValue({}),
    },
    surplusHeir: { findFirst: jest.fn().mockResolvedValue({ name: 'Bea Quill' }) },
    note: { create: jest.fn().mockResolvedValue({}) },
  };
  const surplus: any = {
    list: jest.fn().mockResolvedValue({ data: rows, total: rows.length, pageSize: 200 }),
  };
  return { prisma, surplus, svc: new SurplusOutreachService(prisma, surplus) };
}

const row = (over: any = {}) => ({
  id: 'L1',
  claimant: 'Ada Quill',
  address: '1 Test Rd',
  city: 'Testville',
  county: 'Lee',
  caseNumber: 'TD-1',
  stage: 'new',
  queue: 'call',
  queueLabel: 'Call now',
  queueReason: 'A number to ring',
  netToClaimant: 20000,
  noticeAge: 350,
  daysSinceSale: 400,
  isDeceased: false,
  doNotCall: false,
  phones: [{ number: '5550100001', dnc: null, bad: false }],
  emails: [],
  ownerMailingStreet: '9 Mail St',
  ownerMailingCity: 'Testville',
  ownerMailingState: 'FL',
  ownerMailingZip: '33900',
  letters: [{ heirId: 'h1', mailedAt: '2026-10-01T12:00:00Z', returnedAt: null }],
  heirs: [
    {
      id: 'h1',
      name: 'Bea Quill',
      role: 'heir',
      relationship: 'Daughter',
      deceased: false,
      doNotCall: false,
      phones: [],
      emails: ['bea@example.com'],
      address: null,
      contactStatusLabel: 'Not contacted',
    },
  ],
  ...over,
});

describe('SurplusOutreachService.list', () => {
  it('lists the claimant then the people on the case, with what Dealcore sent ticked per person', async () => {
    const { svc, surplus } = build([row()], {
      calls: [{ leadId: 'L1', heirId: null, _max: { createdAt: new Date('2026-10-20T15:00:00Z') } }],
      texts: [{ leadId: 'L1', heirId: 'h1', _max: { createdAt: new Date('2026-10-21T15:00:00Z') } }],
      touches: [{ leadId: 'L1', heirId: 'h1', kind: 'done', note: null, userId: 'u1', createdAt: new Date('2026-10-22T15:00:00Z') }],
    });
    const out = await svc.list({}, 'org1');

    expect(surplus.list.mock.calls[0][0]).toMatchObject({ queue: 'call', hideEarly: true, group: 'lead', organizationId: 'org1' });
    expect(out.label).toBe('Call now');
    expect(out.groups.map((g) => g.key)).toEqual(['soon']);
    const [ada, bea] = out.groups[0].cases[0].people;
    expect(ada.name).toBe('Ada Quill');
    expect(ada.ticks.called?.via).toBe('dealcore');
    expect(ada.ticks.texted).toBeNull();
    expect(ada.address).toBe('9 Mail St, Testville, FL 33900');
    expect(bea.rankLabel).toBe('Child');
    expect(bea.ticks.texted?.via).toBe('dealcore');
    expect(bea.ticks.letter).not.toBeNull();
    expect(bea.done?.by).toBe('Ian Tester');
    expect(out.groups[0].cases[0].openCount).toBe(1);
  });

  it('takes a hand-logged call when it is newer than anything Dealcore placed', async () => {
    const { svc } = build([row()], {
      calls: [{ leadId: 'L1', heirId: null, _max: { createdAt: new Date('2026-10-01T15:00:00Z') } }],
      touches: [{ leadId: 'L1', heirId: null, kind: 'called', note: 'left a message', userId: 'u1', createdAt: new Date('2026-10-25T15:00:00Z') }],
    });
    const out = await svc.list({}, 'org1');
    const ada = out.groups[0].cases[0].people[0];
    expect(ada.ticks.called?.via).toBe('logged');
    expect(ada.notes[0]).toMatchObject({ kind: 'called', note: 'left a message', by: 'Ian Tester' });
  });

  it('scopes to a batch with the board filters a batch uses, and labels it by code', async () => {
    const { svc, surplus } = build([row({ queue: 'hold', holdReason: 'checking a claim' })]);
    const out = await svc.list({ batchId: 'b1' }, 'org1');
    expect(surplus.list.mock.calls[0][0]).toMatchObject({ batchId: 'b1' });
    expect(surplus.list.mock.calls[0][0].hideEarly).toBeUndefined();
    expect(out.label).toBe('Batch B003');
    expect(out.groups.map((g) => g.key)).toEqual(['hold']);
  });

  it('puts a case nobody on it can be reached at under no contact path', async () => {
    const { svc } = build([
      row({
        phones: [{ number: '5550100001', dnc: null, bad: true }],
        ownerMailingStreet: null,
        ownerMailingCity: null,
        ownerMailingState: null,
        ownerMailingZip: null,
        heirs: [],
      }),
    ]);
    const out = await svc.list({}, 'org1');
    expect(out.groups.map((g) => g.key)).toEqual(['no_path']);
  });
});

describe('SurplusOutreachService marks', () => {
  it('logs a call made elsewhere as a touch on the claim and a note on the timeline', async () => {
    const { svc, prisma } = build([]);
    await svc.addTouch('L1', { heirId: 'h1', kind: 'called', note: 'no answer' }, 'org1', 'u1');
    expect(prisma.surplusTouch.create.mock.calls[0][0].data).toMatchObject({ leadId: 'L1', heirId: 'h1', kind: 'called', note: 'no answer' });
    expect(prisma.lead.update.mock.calls[0][0].data.touchCount).toEqual({ increment: 1 });
    expect(prisma.note.create.mock.calls[0][0].data.content).toBe('Called Bea Quill outside Dealcore: no answer');
  });

  it('marks done without a note or a touch, and refuses a note with no text', async () => {
    const { svc, prisma } = build([]);
    await svc.addTouch('L1', { kind: 'done' }, 'org1', 'u1');
    expect(prisma.lead.update).not.toHaveBeenCalled();
    expect(prisma.note.create).not.toHaveBeenCalled();
    await expect(svc.addTouch('L1', { kind: 'note', note: '  ' }, 'org1', 'u1')).rejects.toThrow('Write the note first.');
    await expect(svc.addTouch('L1', { kind: 'sang' }, 'org1', 'u1')).rejects.toThrow('Unknown mark.');
  });

  it('refuses a person who is not on the case', async () => {
    const { svc, prisma } = build([]);
    prisma.surplusHeir.findFirst.mockResolvedValue(null);
    await expect(svc.addTouch('L1', { heirId: 'other', kind: 'texted' }, 'org1', 'u1')).rejects.toThrow('not on this case');
    expect(prisma.surplusTouch.create).not.toHaveBeenCalled();
  });

  it('clears done for just that person', async () => {
    const { svc, prisma } = build([]);
    await svc.clearDone('L1', null, 'org1');
    expect(prisma.surplusTouch.deleteMany.mock.calls[0][0].where).toEqual({ leadId: 'L1', heirId: null, kind: 'done' });
  });
});
