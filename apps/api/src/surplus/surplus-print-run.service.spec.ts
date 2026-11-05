import { SurplusTemplateKind } from '@fast-homes/shared';
import { SurplusPrintRunService, claimantLetterKind, envelopesFor } from './surplus-print-run.service';

const NOW = new Date('2026-11-02T15:00:00Z');
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

const row = (id: string, over: any = {}) => ({
  id,
  claimant: `Claimant ${id}`,
  county: 'Hernando',
  caseNumber: `2025-${id}`,
  ownerMailingStreet: '1 Main St',
  ownerMailingCity: 'Brooksville',
  ownerMailingState: 'FL',
  ownerMailingZip: '34601',
  isDeceased: false,
  letterDue: true,
  escalateMail: false,
  letterCadenceDays: null,
  letters: [],
  heirs: [],
  heldAt: null,
  ...over,
});

const heir = (id: string, over: any = {}) => ({
  id,
  name: `Person ${id}`,
  role: 'relative',
  priority: 2,
  priorityLabel: 'Child',
  address: '9 Side St, Tampa, FL 33601',
  deceased: false,
  doNotCall: false,
  ...over,
});

describe('claimantLetterKind', () => {
  it('rotates through the three claimant texts by letter number and starts over on the fourth', () => {
    expect(claimantLetterKind(1)).toBe(SurplusTemplateKind.LETTER_CLAIMANT);
    expect(claimantLetterKind(2)).toBe(SurplusTemplateKind.LETTER_CLAIMANT_2);
    expect(claimantLetterKind(3)).toBe(SurplusTemplateKind.LETTER_CLAIMANT_3);
    expect(claimantLetterKind(4)).toBe(SurplusTemplateKind.LETTER_CLAIMANT);
  });
});

describe('envelopesFor', () => {
  it('writes to the claimant first, then the relatives closest first', () => {
    const r = row('a', {
      heirs: [heir('h2', { priority: 6, priorityLabel: 'Neighbor', role: 'neighbor' }), heir('h1', { priority: 1, priorityLabel: 'Spouse' })],
    });
    const env = envelopesFor(r, NOW);
    expect(env.map((e) => e.heirId)).toEqual([null, 'h1', 'h2']);
    expect(env[0]).toMatchObject({ letterNumber: 1, kind: SurplusTemplateKind.LETTER_CLAIMANT, mailType: 'standard', address: '1 Main St, Brooksville, FL 34601' });
    expect(env[1].kind).toBe(SurplusTemplateKind.LETTER_FAMILY);
    expect(env[2].kind).toBe(SurplusTemplateKind.LETTER_ASSOCIATE);
  });

  it('numbers the claimant letter off the history and escalates to Priority after three unanswered', () => {
    const r = row('a', {
      escalateMail: true,
      letters: [
        { heirId: null, mailedAt: daysAgo(20), mailType: 'standard' },
        { heirId: null, mailedAt: daysAgo(40), mailType: 'standard' },
        { heirId: null, mailedAt: daysAgo(60), mailType: 'standard' },
      ],
    });
    const [c] = envelopesFor(r, NOW);
    expect(c).toMatchObject({ letterNumber: 4, kind: SurplusTemplateKind.LETTER_CLAIMANT, mailType: 'priority' });
  });

  it('skips a relative written to inside the cadence and one whose letter came back', () => {
    const r = row('a', {
      letterCadenceDays: 7,
      heirs: [heir('recent'), heir('returned'), heir('due')],
      letters: [
        { heirId: 'recent', mailedAt: daysAgo(3) },
        { heirId: 'returned', mailedAt: daysAgo(30), returnedAt: daysAgo(10) },
        { heirId: 'due', mailedAt: daysAgo(9) },
      ],
    });
    const env = envelopesFor(r, NOW);
    expect(env.map((e) => e.heirId)).toEqual([null, 'due']);
    expect(env[1].letterNumber).toBe(2);
  });

  it('never writes to the dead claimant, the dead, do-not-call, the addressless or the clerk', () => {
    const r = row('a', {
      isDeceased: true,
      heirs: [
        heir('dead', { deceased: true }),
        heir('dnc', { doNotCall: true }),
        heir('nowhere', { address: null }),
        heir('clerk', { role: 'clerk', priority: 70 }),
        heir('ok'),
      ],
    });
    expect(envelopesFor(r, NOW).map((e) => e.heirId)).toEqual(['ok']);
  });

  it('holds back a file on hold and a claimant whose own mail came back', () => {
    expect(envelopesFor(row('a', { heldAt: NOW }), NOW)).toEqual([]);
    const r = row('b', { letters: [{ heirId: null, mailedAt: daysAgo(30), returnedAt: daysAgo(5) }], heirs: [heir('h')] });
    expect(envelopesFor(r, NOW).map((e) => e.heirId)).toEqual(['h']);
  });
});

function harness(rows: any[], env: Record<string, string> = {}) {
  const list = jest.fn(async ({ page }: any) => ({ data: page === 1 ? rows : [], total: rows.length, pageSize: 200 }));
  const markLetterMailed = jest.fn(async (ids: string[]) => ({ updated: ids[0] === 'gone' ? 0 : 1 }));
  const addExpense = jest.fn(async () => ({}));
  const letterFor = jest.fn(async (leadId: string, kind: string, heirId: string | null) => ({
    kind,
    label: kind,
    version: 3,
    versionLabel: 'v3',
    hasText: true,
    body: `Dear ${heirId || leadId}`,
    unfilled: [],
    recipient: { heirId, name: heirId ? `Person ${heirId}` : `Claimant ${leadId}`, address: '1 Main St' },
    sender: { companyName: 'D.I.G. Deeper', phone: '555', callerName: 'Ian', website: null },
    claimant: `Claimant ${leadId}`,
    propertyAddress: '1 Main St',
    today: 'November 2, 2026',
  }));
  const config = { get: (k: string) => env[k] };
  const svc = new SurplusPrintRunService(config as any, { list, markLetterMailed, addExpense } as any, { letterFor } as any);
  return { svc, list, markLetterMailed, addExpense, letterFor };
}

describe('SurplusPrintRunService', () => {
  it('reads the letters-due rows, renders the first max, and reports the whole count', async () => {
    const { svc, list, letterFor } = harness([row('a', { heirs: [heir('h')] }), row('b')]);
    const run = await svc.build({ organizationId: 'org1', county: 'Hernando', max: 2, now: NOW });
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org1', group: 'lead', letterDue: true, hideEarly: true, hideDead: true, county: 'Hernando', page: 1 }),
    );
    expect(run.total).toBe(3);
    expect(run.cases).toBe(2);
    expect(run.toClaimants).toBe(2);
    expect(run.toRelatives).toBe(1);
    expect(run.letters.map((l) => [l.leadId, l.heirId])).toEqual([
      ['a', null],
      ['a', 'h'],
    ]);
    expect(run.truncated).toBe(true);
    expect(letterFor).toHaveBeenCalledTimes(2);
    expect(run.postage).toEqual({ standard: 0.78, priority: 10.4, fedex: null });
  });

  it('plans every envelope due without rendering one, carrying what the chooser filters on', async () => {
    const { svc, letterFor } = harness([
      row('a', { reviewRating: 'a', netToClaimant: 41000, daysToCutoff: 40, shortWindow: true, heirs: [heir('h')] }),
      row('b', { reviewRating: null, netToClaimant: 9000, daysToCutoff: 200 }),
    ]);
    const plan = await svc.plan({ organizationId: 'org1', now: NOW });
    expect(letterFor).not.toHaveBeenCalled();
    expect(plan.total).toBe(3);
    expect(plan.cases).toBe(2);
    expect(plan.maxPerRun).toBe(200);
    expect(plan.envelopes[0]).toMatchObject({
      leadId: 'a',
      heirId: null,
      rating: 'A',
      netToClaimant: 41000,
      daysToCutoff: 40,
      shortWindow: true,
      kindLabel: 'Letter to the claimant',
    });
    // The relative carries the case's rating, so an A Tier filter keeps the family letters too.
    expect(plan.envelopes[1]).toMatchObject({ heirId: 'h', rating: 'A', kindLabel: 'Letter to a family member' });
    expect(plan.envelopes[2]).toMatchObject({ leadId: 'b', rating: null, shortWindow: false });
  });

  it('renders only the envelopes picked, and names the ones no longer due instead of printing them', async () => {
    const { svc, letterFor } = harness([row('a', { heirs: [heir('h')] }), row('b')]);
    const run = await svc.render(
      {
        items: [
          { leadId: 'b', heirId: null },
          { leadId: 'a', heirId: 'h' },
          { leadId: 'a', heirId: 'h' },
          { leadId: 'gone', heirId: null },
        ],
      },
      'org1',
      'u1',
      NOW,
    );
    expect(run.letters.map((l) => [l.leadId, l.heirId])).toEqual([
      ['b', null],
      ['a', 'h'],
    ]);
    expect(run.notDue).toEqual([{ leadId: 'gone', heirId: null }]);
    expect(letterFor).toHaveBeenCalledTimes(2);
    expect(run.toClaimants).toBe(1);
    expect(run.toRelatives).toBe(1);
  });

  it('refuses an empty pick and a pick over one run', async () => {
    const { svc } = harness([]);
    await expect(svc.render({ items: [] }, 'org1')).rejects.toThrow('Pick at least one');
    const many = Array.from({ length: 201 }, (_, i) => ({ leadId: `l${i}` }));
    await expect(svc.render({ items: many }, 'org1')).rejects.toThrow('at most 200');
  });

  it('reads the postage from the settings', () => {
    const { svc } = harness([], { SURPLUS_POSTAGE_STANDARD: '0.80', SURPLUS_POSTAGE_FEDEX: '12.5', SURPLUS_POSTAGE_PRIORITY: 'nonsense' });
    expect(svc.postage()).toEqual({ standard: 0.8, priority: 10.4, fedex: 12.5 });
  });

  it('records every envelope with its template version and logs the postage by mail type', async () => {
    const { svc, markLetterMailed, addExpense } = harness([]);
    const out = await svc.mailed(
      {
        mailedAt: '2026-11-02',
        postage: { priority: 10 },
        items: [
          { leadId: 'a', heirId: null, kind: 'letter_claimant_2', version: 3, recipientName: 'Claimant a', address: '1 Main St', mailType: 'priority', trackingNumber: '9400', letterNumber: 2 },
          { leadId: 'a', heirId: 'h', kind: 'letter_family', version: 1, recipientName: 'Person h', address: '9 Side St', mailType: 'standard', letterNumber: 1 },
          { leadId: 'gone', heirId: null, kind: 'letter_claimant', version: 1, mailType: 'fedex' },
        ],
      },
      'org1',
      'user1',
    );
    expect(out).toMatchObject({ mailed: 2, byType: { priority: 1, standard: 1 }, postageTotal: 10.78 });
    expect(out.failed).toEqual([{ leadId: 'gone', recipientName: null, error: 'not a surplus lead' }]);
    expect(markLetterMailed).toHaveBeenCalledWith(
      ['a'],
      expect.objectContaining({ heirId: null, templateKind: 'letter_claimant_2', templateVersion: 3, mailType: 'priority', trackingNumber: '9400', mailedAt: '2026-11-02' }),
      'user1',
      'org1',
    );
    expect(addExpense).toHaveBeenCalledTimes(2);
    expect(addExpense).toHaveBeenCalledWith('a', expect.objectContaining({ kind: 'postage', amount: 10, note: expect.stringContaining('letter 2 to Claimant a by Priority Mail') }), 'org1', 'user1');
    expect(addExpense).toHaveBeenCalledWith('a', expect.objectContaining({ kind: 'postage', amount: 0.78, note: expect.stringContaining('letter 1 to Person h') }), 'org1', 'user1');
  });

  it('refuses an empty run and a bad postage figure', async () => {
    const { svc } = harness([]);
    await expect(svc.mailed({ items: [] })).rejects.toThrow('Nothing to mark mailed.');
    await expect(svc.mailed({ items: [{ leadId: 'a', kind: 'letter_claimant' }], postage: { standard: -1 } })).rejects.toThrow('postage is not a number');
  });

  it('writes one line for the brief, and nothing when nothing is due', async () => {
    const { svc } = harness([row('a', { escalateMail: true, heirs: [heir('h')] }), row('b')]);
    expect(await svc.briefLine('org1')).toEqual({
      letters: 3,
      cases: 2,
      line: '3 letters due across 2 cases, 2 to claimants and 1 to relatives, 1 go Priority Mail after three unanswered. Print the run and mark it mailed in one click.',
    });
    expect(await harness([]).svc.briefLine('org1')).toBeNull();
  });
});

function lobHarness(
  rows: any[],
  opts: { mode?: 'test' | 'live' | null; sentThisMonth?: number; limit?: number; markFails?: boolean; lettersBefore?: number } = {},
) {
  const list = jest.fn(async ({ page }: any) => ({ data: page === 1 ? rows : [], total: rows.length, pageSize: 200 }));
  const markLetterMailed = jest.fn(async () => {
    if (opts.markFails) throw new Error('db down');
    return { updated: 1 };
  });
  const addExpense = jest.fn(async () => ({}));
  const markLetterReturned = jest.fn(async () => ({}));
  const removeLetter = jest.fn(async () => ({ removed: 1 }));
  const addresses: Record<string, string> = {
    a: '12 Oak St, Tampa, FL 33602',
    b: '1 Main St',
    c: '9 Elm Rd, Ocala, FL 34470',
    h: '4 Pine Ave, Apt 2, Orlando, FL 32801',
  };
  const letterFor = jest.fn(async (leadId: string, kind: string, heirId: string | null) => ({
    kind,
    label: kind,
    version: 3,
    versionLabel: 'v3',
    templateCounty: null,
    hasText: true,
    body: `Dear ${heirId || leadId}`,
    unfilled: [],
    recipient: { heirId, name: heirId ? `Person ${heirId}` : `Claimant ${leadId}`, address: addresses[heirId || leadId] },
    sender: { companyName: 'D.I.G. Deeper LLC', phone: '(904) 595-9620', callerName: 'Ian', website: 'digdeeperllc.com' },
    claimant: `Claimant ${leadId}`,
    propertyAddress: '1 Main St',
    today: 'November 5, 2026',
  }));
  let n = 0;
  const createLetter = jest.fn(async (_req: any) => ({ id: `ltr_${++n}`, url: `https://lob.test/${n}.pdf`, expectedDeliveryDate: '2026-11-12', sendDate: null }));
  const lob = {
    mode: () => (opts.mode === undefined ? 'test' : opts.mode),
    monthlyLimit: () => opts.limit ?? 500,
    letterCost: () => 1.07,
    createLetter,
  };
  const letters = new Map<string, any>();
  const prisma = {
    surplusLetter: {
      // The month's live letters, or (by person) the letters already sent to someone.
      count: jest.fn(async ({ where }: any) => (where?.lobLetterId ? opts.sentThisMonth ?? 0 : opts.lettersBefore ?? 0)),
      findUnique: jest.fn(async ({ where }: any) => letters.get(where.lobLetterId) || null),
      update: jest.fn(async ({ where, data }: any) => {
        for (const l of letters.values()) if (l.id === where.id) Object.assign(l, data);
        return {};
      }),
    },
    note: { create: jest.fn(async () => ({})) },
    activity: { create: jest.fn(async () => ({})) },
  };
  const config = { get: () => undefined };
  const svc = new SurplusPrintRunService(
    config as any,
    { list, markLetterMailed, addExpense, markLetterReturned, removeLetter } as any,
    { letterFor } as any,
    lob as any,
    prisma as any,
  );
  return { svc, createLetter, markLetterMailed, addExpense, markLetterReturned, removeLetter, prisma, letters };
}

describe('SurplusPrintRunService.sendViaLob', () => {
  const NOW_LOB = new Date('2026-11-05T15:00:00Z');
  const picks = [{ leadId: 'a' }, { leadId: 'b' }, { leadId: 'c' }, { leadId: 'a', heirId: 'h' }];
  const rows = () => [row('a', { heirs: [heir('h', { address: '4 Pine Ave, Apt 2, Orlando, FL 32801' })] }), row('b'), row('c', { escalateMail: true })];

  it('refuses when Lob is not set up', async () => {
    const { svc } = lobHarness(rows(), { mode: null });
    await expect(svc.sendViaLob({ items: picks }, 'org1', 'user1', NOW_LOB)).rejects.toThrow('Lob is not set up');
  });

  it('with a test key makes proofs, records nothing, and keeps Priority and bad addresses on paper', async () => {
    const { svc, createLetter, markLetterMailed, addExpense } = lobHarness(rows());
    const out = await svc.sendViaLob({ items: picks }, 'org1', 'user1', NOW_LOB);
    expect(out.mode).toBe('test');
    expect(out.sent.map((s) => `${s.leadId}:${s.heirId || ''}`).sort()).toEqual(['a:', 'a:h']);
    expect(out.sent[0].url).toMatch(/^https:\/\/lob\.test\//);
    expect(out.heldBack).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ leadId: 'b', reason: expect.stringMatching(/not a US/) }),
        expect.objectContaining({ leadId: 'c', reason: expect.stringMatching(/Priority Mail stays on paper/) }),
      ]),
    );
    expect(markLetterMailed).not.toHaveBeenCalled();
    expect(addExpense).not.toHaveBeenCalled();
    const req = createLetter.mock.calls.map((c) => c[0]).find((r: any) => r.to.name === 'Person h');
    expect(req.to).toMatchObject({ address_line1: '4 Pine Ave', address_line2: 'Apt 2', address_city: 'Orlando', address_state: 'FL', address_zip: '32801' });
    expect(req.from).toMatchObject({ name: 'D.I.G. Deeper LLC', address_state: 'FL', address_zip: '33702' });
    expect(req.idempotencyKey).toBe('dealcore:test:a:h:1:letter_family:3:2026-11-05');
    expect(req.metadata).toEqual({ leadId: 'a', heirId: 'h', letter: '1', kind: 'letter_family' });
  });

  it('with a live key records each letter with its Lob id and the cost, up to the monthly cap', async () => {
    const { svc, markLetterMailed, addExpense } = lobHarness(rows(), { mode: 'live', sentThisMonth: 499, limit: 500 });
    const out = await svc.sendViaLob({ items: picks }, 'org1', 'user1', NOW_LOB);
    expect(out.sent).toHaveLength(1);
    expect(out.heldBack.filter((h) => /a month Lob allows/.test(h.reason))).toHaveLength(1);
    expect(markLetterMailed).toHaveBeenCalledWith(
      ['a'],
      expect.objectContaining({
        mailType: 'standard',
        templateVersion: 3,
        lob: { letterId: 'ltr_1', expectedDeliveryAt: new Date('2026-11-12T12:00:00Z') },
      }),
      'user1',
      'org1',
    );
    expect(addExpense).toHaveBeenCalledWith('a', expect.objectContaining({ kind: 'postage', amount: 1.07 }), 'org1', 'user1');
    expect(out.postageTotal).toBe(1.07);
  });

  it('says so when Lob took a letter that could not be recorded', async () => {
    const { svc } = lobHarness([row('a')], { mode: 'live', markFails: true });
    const out = await svc.sendViaLob({ items: [{ leadId: 'a' }] }, 'org1', 'user1', NOW_LOB);
    expect(out.sent).toEqual([]);
    expect(out.failed).toEqual([expect.objectContaining({ leadId: 'a', lobLetterId: 'ltr_1', error: expect.stringContaining('Lob is mailing it (ltr_1)') })]);
  });
});

describe('SurplusPrintRunService.applyLobEvent', () => {
  const ev = (id: string, ref: string, at: string) => ({ id: 'evt_1', event_type: { id }, reference_id: ref, date_created: at });
  const letter = (over: any = {}) => ({
    id: 'sl1',
    lobLetterId: 'ltr_9',
    recipientName: 'Jane',
    sentByUserId: 'user1',
    returnedAt: null,
    deliveredAt: null,
    lobStatus: 'created',
    lobEventAt: new Date('2026-11-05T10:00:00Z'),
    surplusDetail: { leadId: 'a' },
    ...over,
  });

  it('moves the step forward, dates a delivery, and never goes backwards', async () => {
    const h = lobHarness([]);
    h.letters.set('ltr_9', letter());
    await h.svc.applyLobEvent(ev('letter.in_transit', 'ltr_9', '2026-11-06T10:00:00Z'));
    expect(h.letters.get('ltr_9').lobStatus).toBe('in_transit');
    await h.svc.applyLobEvent(ev('letter.delivered', 'ltr_9', '2026-11-09T10:00:00Z'));
    expect(h.letters.get('ltr_9')).toMatchObject({ lobStatus: 'delivered', deliveredAt: new Date('2026-11-09T10:00:00Z') });
    await h.svc.applyLobEvent(ev('letter.in_local_area', 'ltr_9', '2026-11-08T10:00:00Z'));
    expect(h.letters.get('ltr_9').lobStatus).toBe('delivered');
  });

  it('marks a return the way the Returned button does, and takes a cancelled letter out', async () => {
    const h = lobHarness([]);
    h.letters.set('ltr_9', letter());
    await h.svc.applyLobEvent(ev('letter.returned_to_sender', 'ltr_9', '2026-11-10T10:00:00Z'));
    expect(h.markLetterReturned).toHaveBeenCalledWith('sl1', true, null, 'user1');
    expect(h.letters.get('ltr_9').lobStatus).toBe('returned_to_sender');
    await h.svc.applyLobEvent(ev('letter.deleted', 'ltr_9', '2026-11-05T11:00:00Z'));
    expect(h.removeLetter).toHaveBeenCalledWith('sl1', null);
    expect(h.prisma.note.create).toHaveBeenCalledWith({ data: expect.objectContaining({ leadId: 'a', content: expect.stringContaining('cancelled') }) });
  });

  it('ignores test proofs and other events', async () => {
    const h = lobHarness([]);
    expect(await h.svc.applyLobEvent(ev('letter.mailed', 'ltr_unknown', '2026-11-05T11:00:00Z'))).toEqual({ applied: false, reason: 'letter not in Dealcore' });
    expect((await h.svc.applyLobEvent(ev('postcard.mailed', 'psc_1', '2026-11-05T11:00:00Z'))).applied).toBe(false);
  });
});

describe('SurplusPrintRunService.sendOneViaLob', () => {
  const NOW_ONE = new Date('2026-11-05T15:00:00Z');

  it('with a test key makes one proof for the person picked and records nothing', async () => {
    const { svc, createLetter, markLetterMailed } = lobHarness([], { lettersBefore: 2 });
    const out: any = await svc.sendOneViaLob('a', { kind: 'letter_family', heirId: 'h' }, 'org1', 'user1', NOW_ONE);
    expect(out).toMatchObject({ mode: 'test', ok: true, lobLetterId: 'ltr_1', url: 'https://lob.test/1.pdf', letterNumber: 3, recipientName: 'Person h' });
    expect(markLetterMailed).not.toHaveBeenCalled();
    const req = createLetter.mock.calls[0][0];
    expect(req.to).toMatchObject({ name: 'Person h', address_line1: '4 Pine Ave', address_line2: 'Apt 2' });
    expect(req.idempotencyKey).toBe('dealcore:test:a:h:3:letter_family:3:2026-11-05');
  });

  it('refuses what Lob cannot take, with the reason', async () => {
    const { svc, createLetter } = lobHarness([]);
    await expect(svc.sendOneViaLob('a', { kind: 'letter_claimant', mailType: 'priority' }, 'org1', 'user1', NOW_ONE)).rejects.toThrow('Priority Mail stays on paper');
    await expect(svc.sendOneViaLob('b', { kind: 'letter_claimant' }, 'org1', 'user1', NOW_ONE)).rejects.toThrow('not a US street');
    await expect(svc.sendOneViaLob('a', { kind: 'voicemail' }, 'org1', 'user1', NOW_ONE)).rejects.toThrow('Pick a letter');
    expect(createLetter).not.toHaveBeenCalled();
  });

  it('with a live key records it with its Lob id, and stops at the monthly cap', async () => {
    const live = lobHarness([], { mode: 'live' });
    const out: any = await live.svc.sendOneViaLob('a', { kind: 'letter_claimant' }, 'org1', 'user1', NOW_ONE);
    expect(out).toMatchObject({ mode: 'live', ok: true, postage: 1.07, alreadyRecorded: false });
    expect(live.markLetterMailed).toHaveBeenCalledWith(['a'], expect.objectContaining({ heirId: null, lob: expect.objectContaining({ letterId: 'ltr_1' }) }), 'user1', 'org1');
    const full = lobHarness([], { mode: 'live', sentThisMonth: 500, limit: 500 });
    await expect(full.svc.sendOneViaLob('a', { kind: 'letter_claimant' }, 'org1', 'user1', NOW_ONE)).rejects.toThrow('Lob letters are used');
  });

  it('does not record a letter twice when Lob hands back one already in the history', async () => {
    const h = lobHarness([], { mode: 'live' });
    h.letters.set('ltr_1', { id: 'sl1', lobLetterId: 'ltr_1' });
    const out: any = await h.svc.sendOneViaLob('a', { kind: 'letter_claimant' }, 'org1', 'user1', NOW_ONE);
    expect(out).toMatchObject({ ok: true, alreadyRecorded: true, postage: 0 });
    expect(h.markLetterMailed).not.toHaveBeenCalled();
    expect(h.addExpense).not.toHaveBeenCalled();
  });
});
