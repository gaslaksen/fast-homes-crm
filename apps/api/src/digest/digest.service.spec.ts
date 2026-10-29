import { DigestService } from './digest.service';

/**
 * Assembly against a stubbed database, shaped like the October 13 brief that
 * prompted the rewrite: one claimant on the board as three records across two
 * cases, a co-owner on one of them, and a bigger file that is only a likely
 * match. The brief must lead with surplus, list each person once, and rank by
 * the money.
 */

const NOW = new Date('2026-10-13T11:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function claimant(over: Record<string, any>) {
  return {
    county: 'Brevard',
    city: 'PALM BAY',
    noticeAge: 200,
    workScore: 150,
    cleanPhoneCount: 2,
    phones: [{ number: '3215550142', dnc: false }],
    doNotCall: false,
    deceased: false,
    heirsRequired: false,
    obituaryMatch: null,
    touches: 0,
    contactStatus: 'not_tapped',
    claimStatus: 'open',
    claimStatusLabel: 'Open, nothing filed',
    queue: 'call_now',
    claimantUpdate: { overdue: false },
    ...over,
  };
}

const BOARD = [
  claimant({ id: 'g1', claimant: 'Garcia, Douglas', caseNumber: '250809', address: '2480 KEEGAN CIR SW', grossSurplus: 8738, netToClaimant: 8738 }),
  claimant({ id: 'a1', claimant: 'Acuna, Janet', caseNumber: '250809', address: '2480 KEEGAN CIR SW', grossSurplus: 8738, netToClaimant: 8738, cleanPhoneCount: 4 }),
  claimant({ id: 'g2', claimant: 'Garcia, Douglas', caseNumber: '250772', address: '2402 IMURA RD SW', grossSurplus: 7676, netToClaimant: 7676 }),
  claimant({ id: 'g3', claimant: 'GARCIA, DOUGLAS', caseNumber: '250772', address: '2402 IMURA RD SW', grossSurplus: 7676, netToClaimant: 7676 }),
  claimant({
    id: 'p1', claimant: 'PRISCILLA A BURPEE', county: 'Citrus', caseNumber: '2026-0003TD',
    address: '9420 N MANASHEE DR', city: 'CITRUS SPRINGS, FL', grossSurplus: 36194, netToClaimant: 36194,
    cleanPhoneCount: 4, queue: 'likely', workScore: 120,
  }),
  // Already called: never on the list, however much money.
  claimant({ id: 'x1', claimant: 'Called Already', grossSurplus: 90000, netToClaimant: 90000, touches: 2 }),
  // Lien window still open: not callable yet, counted as coming up.
  claimant({ id: 's1', claimant: 'NANCY E ANDREWS', noticeAge: 120, grossSurplus: 20000, netToClaimant: 20000 }),
];

function makeService(over: { unread?: any[]; tasks?: any[]; recentKeys?: string[]; inFlight?: any[]; counties?: any[]; due?: any } = {}) {
  const prisma: any = {
    lead: {
      findMany: jest.fn().mockResolvedValue(over.unread ?? []),
      count: jest.fn().mockResolvedValue(0),
    },
    contract: { count: jest.fn().mockResolvedValue(4) },
    foreclosureDetail: { count: jest.fn().mockResolvedValue(6) },
    callLog: { findMany: jest.fn().mockResolvedValue([{ outcome: null, disposition: 'Voicemail' }]) },
    surplusDetail: {
      findMany: jest.fn().mockResolvedValue(over.inFlight ?? []),
      groupBy: jest.fn().mockImplementation((args: any) =>
        Promise.resolve(
          args.where.tracedAt === null
            ? [{ county: 'Citrus', _count: { _all: 28 } }, { county: 'Alachua', _count: { _all: 10 } }]
            : [],
        ),
      ),
    },
    task: { findMany: jest.fn().mockResolvedValue(over.tasks ?? []) },
    digestRun: {
      findMany: jest.fn().mockResolvedValue((over.recentKeys ?? []).map((k) => ({ bigThingKey: k }))),
    },
    surplusPollRun: { findMany: jest.fn().mockResolvedValue([]) },
    surplusCounty: { findMany: jest.fn().mockResolvedValue(over.counties ?? []) },
  };
  const config: any = { get: () => 'https://mydealcore.com' };
  const surplus: any = { list: jest.fn().mockResolvedValue({ data: [{ claimants: BOARD }] }) };
  const ingest: any = { adapters: () => [] };
  const outreach: any = { dueToday: jest.fn().mockResolvedValue(over.due ?? { caseCount: 0, peopleCount: 0, top: [] }) };
  return new DigestService(prisma, config, surplus, ingest, outreach);
}

describe('DigestService.build', () => {
  it('leads with the biggest callable claimant, likely match included and flagged', async () => {
    const b = await makeService().build({ organizationId: 'org1', now: NOW });
    expect(b.bigThing?.key).toBe('surplus-person:citrus|a burpee priscilla');
    expect(b.bigThing?.headline).toBe('Priscilla A Burpee is owed $36,194 by Citrus County and nobody has called.');
    expect(b.bigThing?.flag).toContain('Likely match');
    expect(b.bigThing?.phone).toBe('(321) 555-0142');
    expect(b.subject).toBe('Dealcore Daily: Call Priscilla A Burpee ($36.2K), 2 more to call');
  });

  it('lists each person once, with every case they are owed on', async () => {
    const b = await makeService().build({ organizationId: 'org1', now: NOW });
    expect(b.calls.map((c) => c.name)).toEqual(['Douglas Garcia', 'Janet Acuna']);
    expect(b.callsTotal).toBe(3);
    const garcia = b.calls[0];
    expect(garcia.amount).toBe('$16,414');
    expect(garcia.detail).toContain('2 Brevard County cases: 250809 ($8,738), 250772 ($7,676)');
    expect(garcia.detail).toContain('Open, nothing filed on either.');
    expect(garcia.detail).toContain('Shares the claim with Janet Acuna.');
    // The board's reason is not tacked on after facts already stated.
    expect(garcia.detail).not.toContain('lien window closed');
    expect(b.calls[1].detail).toContain('Shares the claim with Douglas Garcia.');
  });

  it('lets an unactioned big thing lead again and says for how long', async () => {
    const key = 'surplus-person:citrus|a burpee priscilla';
    const b = await makeService({ recentKeys: [key, key, 'lead:other'] }).build({ organizationId: 'org1', now: NOW });
    expect(b.bigThing?.key).toBe(key);
    expect(b.bigThing?.repeatNote).toBe('Led the last 2 briefs too and still has not been called.');
  });

  it('puts a waiting claimant reply ahead of every call, and keeps a seller reply on the wholesale line', async () => {
    const unread = [
      { id: 'w1', source: 'MANUAL', sellerFirstName: 'Geoff', sellerLastName: 'Aslaksen', lastMessageAt: new Date(NOW.getTime() - 7 * DAY), lastMessagePreview: 'Test inbound message' },
      { id: 'r1', source: 'SURPLUS', sellerFirstName: 'KELLY,', sellerLastName: 'DAVID G', lastMessageAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000), lastMessagePreview: 'Is this real?' },
    ];
    const b = await makeService({ unread }).build({ organizationId: 'org1', now: NOW });
    expect(b.bigThing?.key).toBe('lead:r1');
    expect(b.bigThing?.headline).toBe('David G Kelly replied 3h 00m ago and is still waiting on an answer.');
    expect(b.wholesale).toContain('1 reply waiting (oldest 7d 0h)');
    expect(b.wholesale).toContain('4 contracts past close date');
    expect(b.wholesale).toContain('6 foreclosures in the workable window');
    expect(JSON.stringify(b)).not.toContain('Test inbound message');
  });

  it('fills the scorecard, the trace count, and the coming-up note from surplus', async () => {
    const tasks = [{
      id: 't1', title: 'Check for a reply to the letter to DAVID G KELLY', dueDate: new Date(NOW.getTime() - 5 * DAY),
      lead: { id: 'k1' }, user: { firstName: 'Ian' },
    }];
    const b = await makeService({ tasks }).build({ organizationId: 'org1', now: NOW });
    const tile = (label: string) => b.scorecard.find((t) => t.label === label);
    expect(tile('Ready to call')?.value).toBe('3');
    expect(tile('Calls yesterday')).toMatchObject({ value: '1', subtext: '0 connected · target 25', urgency: 'critical' });
    expect(tile('Follow-ups due')).toMatchObject({ value: '1', subtext: 'oldest 5 days late' });
    expect(b.promises[0]).toMatchObject({ when: '5 days late · Ian' });
    expect(b.needsTrace).toEqual({ total: 38, byCounty: 'Citrus 28 · Alachua 10' });
    expect(b.surplusOpeningSoonNote).toBe('1 claimant clears the lien window in the next 30 days, $20.0K between them. First: Nancy E Andrews, tomorrow.');
  });

  it('says how many people are due a touch today, biggest file first', async () => {
    const due = {
      caseCount: 2,
      peopleCount: 3,
      top: [{ leadId: 'k1', claimant: 'DAVID G KELLY', county: 'Citrus', netToClaimant: 32000, daysLeft: 40, shortWindow: true, people: ['DAVID G KELLY'] }],
    };
    const b = await makeService({ due }).build({ organizationId: 'org1', now: NOW });
    expect(b.touchesDue).toEqual({
      people: 3,
      cases: 2,
      line: "3 people on 2 files with nothing tried in 7 days or more. Biggest first: DAVID G KELLY on DAVID G KELLY's file ($32.0K, 40 days left, short window).",
    });
    const none = await makeService().build({ organizationId: 'org1', now: NOW });
    expect(none.touchesDue).toBeNull();
  });

  it('lists a county whose list is due, asking only for dates up to today in this organization', async () => {
    const counties = [{
      name: 'Marion', listSource: 'email', listUpdateEveryDays: 30,
      listRequestedAt: new Date('2026-09-12T12:00:00Z'), listNextRequestAt: new Date('2026-10-12T12:00:00Z'), listUpdatedAt: null,
    }];
    const svc = makeService({ counties });
    const b = await svc.build({ organizationId: 'org1', now: NOW });
    const where = (svc as any).prisma.surplusCounty.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ organizationId: 'org1', listNextRequestAt: { not: null, lte: new Date('2026-10-13T12:00:00Z') } });
    expect(b.countyListsDue).toEqual([
      { label: 'Marion list', schedule: 'monthly, by email', detail: 'UPDATE DUE Mon 10/12, 1 day late. Last asked Sat 9/12.', urgency: 'warn' },
    ]);
  });
});

describe('DigestService helpers', () => {
  const svc = makeService();

  it('reads county names the way a person would say them', () => {
    expect(svc.displayName('Garcia, Douglas')).toBe('Douglas Garcia');
    expect(svc.displayName('PRISCILLA A BURPEE')).toBe('Priscilla A Burpee');
    expect(svc.displayName('Smith, Jr')).toBe('Smith, Jr');
    expect(svc.displayName('ACME HOLDINGS, LLC')).toBe('Acme Holdings, LLC');
  });

  it('flags a filed claim the county has sat on, and leaves a fresh one alone', () => {
    const filed = (days: number) => ({ stage: 'Claim Filed', submittedAt: new Date(NOW.getTime() - days * DAY) });
    expect(svc.inFlightBlocker(filed(10), NOW)).toBeNull();
    expect(svc.inFlightBlocker(filed(38), NOW)).toEqual({ note: 'Filed 38 days ago, the county has not acknowledged it', urgency: 'warn' });
    expect(svc.inFlightBlocker(filed(50), NOW)?.urgency).toBe('critical');
    expect(
      svc.inFlightBlocker({ stage: 'Check Received', clearingDueAt: new Date(NOW.getTime() - 2 * DAY), checkSentAt: null }, NOW)?.note,
    ).toContain("the claimant's share has not gone out");
  });
});
