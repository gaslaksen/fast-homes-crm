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
