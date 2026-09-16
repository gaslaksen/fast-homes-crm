import {
  SurplusObituaryService,
  isDirectSurvivor,
  obituaryCost,
  parseObituaryVerdict,
} from './surplus-obituary.service';

/**
 * The obituary search. The live behaviour was measured by hand on 2026-09-16
 * against four claimants Endato already knew were dead; these pin what each
 * verdict writes, the budget, and the criteria.
 */

const BEAVER = {
  verdict: 'strong',
  url: 'https://www.legacy.com/us/obituaries/dispatch/name/dewey-beaver-obituary?id=10155627',
  nameInObituary: 'Dewey Raymond Beaver',
  dateOfDeath: '2020-10-27',
  place: 'Wellston, Ohio',
  evidence: 'Middle initial matches and a son lives in Lancaster, Ohio, the clerk mailing address.',
  survivors: [
    { name: 'Marge (Blackburn) Beaver', relationship: 'wife', city: 'Wellston, OH' },
    { name: 'Scott (Rhonda) Beaver', relationship: 'son', city: 'Lancaster, OH' },
    { name: 'Andrew Beaver', relationship: 'grandchild', city: null },
    { name: 'Sue Beaver', relationship: 'daughter-in-law', city: null },
  ],
};

function reply(verdict: any, stop = 'end_turn') {
  return {
    stop_reason: stop,
    model: 'claude-opus-5',
    usage: { input_tokens: 40000, output_tokens: 1000, server_tool_use: { web_search_requests: 4 } },
    content: [{ type: 'text', text: `Searched.\n${JSON.stringify(verdict)}` }],
  };
}

function lead(over: any = {}) {
  const { detail, ...rest } = over;
  return {
    id: 'lead1',
    organizationId: 'org',
    sellerFirstName: 'DEWEY R',
    sellerLastName: 'BEAVER',
    sellerPhone: '',
    propertyAddress: '517 HINES AVE',
    propertyCity: 'LEHIGH ACRES',
    propertyState: 'FL',
    propertyZip: '33936',
    ...rest,
    surplusDetail: {
      id: 'd1',
      county: 'Lee',
      caseNumber: '2025000123',
      grossSurplus: 39872,
      claimStatus: 'open',
      noticeDate: new Date(Date.now() - 60 * 86400000),
      deceased: false,
      heirsRequired: false,
      deathSource: null,
      dateOfDeath: null,
      callNotes: null,
      ownerMailingStreet: '417 REESE AVE',
      ownerMailingCity: 'LANCASTER',
      ownerMailingState: 'OH',
      ownerMailingZip: '43130',
      heirs: [],
      ...detail,
    },
  };
}

function harness(leads: any[], env: Record<string, string> = { OBITUARY_MONTHLY_BUDGET: '50' }, spent = 0) {
  const detailUpdates: any[] = [];
  const heirCreates: any[] = [];
  let spend = spent;
  const prisma: any = {
    lead: {
      findMany: jest.fn().mockResolvedValue(leads),
      findFirst: jest.fn(async () => leads[0] || null),
    },
    vendorUsage: {
      findUnique: jest.fn(async () => ({ calls: 0, spend })),
      upsert: jest.fn(async (a: any) => { spend += a.update.spend.increment; return {}; }),
    },
    surplusDetail: { update: jest.fn(async (a: any) => { detailUpdates.push(a); return {}; }) },
    surplusHeir: { create: jest.fn(async (a: any) => { heirCreates.push(a.data); return a.data; }) },
  };
  const skiptrace: any = { lookupSurvivors: jest.fn().mockResolvedValue({ looked: 2, withContact: 1 }) };
  const config: any = { get: (k: string) => ({ ANTHROPIC_API_KEY: 'k', ...env } as any)[k] };
  const svc = new SurplusObituaryService(config, prisma, skiptrace);
  const create = jest.fn();
  (svc as any).anthropic = { beta: { messages: { create } } };
  return { svc, prisma, skiptrace, create, detailUpdates, heirCreates, spent: () => spend };
}

describe('parseObituaryVerdict', () => {
  it('reads the JSON after the prose, and drops a date that is not a date', () => {
    const v = parseObituaryVerdict(`I searched legacy.com.\n${JSON.stringify({ ...BEAVER, dateOfDeath: 'October 2020' })}`);
    expect(v.verdict).toBe('strong');
    expect(v.dateOfDeath).toBeNull();
    expect(v.survivors).toHaveLength(4);
  });
  it('anything unreadable is none, never a guess', () => {
    expect(parseObituaryVerdict('no json here').verdict).toBe('none');
    expect(parseObituaryVerdict('{"verdict":"maybe"}').verdict).toBe('none');
    expect(parseObituaryVerdict(JSON.stringify({ ...BEAVER, verdict: 'none' })).survivors).toEqual([]);
  });
});

describe('isDirectSurvivor', () => {
  it('takes a spouse or a child, never an in-law, a grandchild or a sibling', () => {
    for (const r of ['wife', 'husband', 'son', 'daughter', 'stepson', 'Beloved Wife', 'children']) expect(isDirectSurvivor(r)).toBe(true);
    for (const r of ['son-in-law', 'daughter in law', 'grandson', 'grandchild', 'sister', 'brother', 'niece']) expect(isDirectSurvivor(r)).toBe(false);
  });
});

describe('obituaryCost', () => {
  it('prices tokens by model and adds the searches', () => {
    expect(obituaryCost({ input: 40000, output: 1000, searches: 4 }, 'claude-opus-5')).toBeCloseTo(0.265, 3);
    expect(obituaryCost({ input: 40000, output: 1000, searches: 4 }, 'claude-sonnet-5')).toBeCloseTo(0.13, 3);
  });
});

describe('SurplusObituaryService', () => {
  it('an unset budget pauses it: nothing is sent', async () => {
    const { svc, create } = harness([lead()], {});
    const r = await svc.run({ organizationId: 'org' });
    expect(svc.available).toBe(false);
    expect(r.message).toMatch(/paused until OBITUARY_MONTHLY_BUDGET/);
    expect(create).not.toHaveBeenCalled();
  });

  it('stops before a check the month cannot cover', async () => {
    const { svc, create } = harness([lead(), lead({ id: 'lead2', detail: { id: 'd2' } })], { OBITUARY_MONTHLY_BUDGET: '10' }, 9.6);
    const r = await svc.run({ organizationId: 'org' });
    expect(r.checked).toBe(0);
    expect(r.message).toMatch(/budget of \$10 reached/);
    expect(create).not.toHaveBeenCalled();
  });

  it('a strong match marks a living claimant dead, files only the spouse and children, looks them up, and records the spend', async () => {
    const { svc, create, detailUpdates, heirCreates, skiptrace, spent } = harness([lead()]);
    create.mockResolvedValue(reply(BEAVER));

    const r = await svc.run({ organizationId: 'org' });

    expect(r).toMatchObject({ checked: 1, strong: 1, survivorsFiled: 2, survivorsLooked: 2, survivorsWithContact: 1 });
    const person = JSON.parse(create.mock.calls[0][0].messages[0].content);
    expect(person.name).toBe('DEWEY R BEAVER');
    expect(person.knownPlaces[1]).toMatch(/LANCASTER, OH 43130 \(the clerk's mailing address\)/);
    expect(create.mock.calls[0][0].tools.map((t: any) => t.type)).toEqual(['web_search_20260209', 'web_fetch_20260209']);

    const d = detailUpdates[0].data;
    expect(d).toMatchObject({ deceased: true, heirsRequired: true, claimantType: 'heir_estate', deathSource: 'obituary', obituaryMatch: 'strong' });
    expect(d.dateOfDeath.toISOString().slice(0, 10)).toBe('2020-10-27');
    expect(d.callNotes).toMatch(/^Obituary \(strong match\): Dewey Raymond Beaver died October 27, 2020/);

    expect(heirCreates.map((h) => [h.name, h.relationship, h.city, h.state])).toEqual([
      ['Marge Beaver', 'Wife', 'Wellston', 'OH'],
      ['Scott Beaver', 'Son', 'Lancaster', 'OH'],
    ]);
    expect(heirCreates.every((h) => h.role === 'relative' && h.sourceKind === 'obituary' && h.sourceDocument === BEAVER.url)).toBe(true);
    expect(skiptrace.lookupSurvivors).toHaveBeenCalledWith('d1', 'DEWEY R BEAVER', { property: '517 HINES|33936', mailing: '417 REESE|43130' });
    expect(spent()).toBeCloseTo(0.265, 3);
  });

  it('a possible match marks nothing dead and files nobody until a person confirms it', async () => {
    const { svc, create, detailUpdates, heirCreates, skiptrace } = harness([lead()]);
    create.mockResolvedValue(reply({ ...BEAVER, verdict: 'possible' }));

    const r = await svc.run({ organizationId: 'org' });

    expect(r).toMatchObject({ possible: 1, survivorsFiled: 0 });
    const d = detailUpdates[0].data;
    expect(d.deceased).toBeUndefined();
    expect(d.obituaryMatch).toBe('possible');
    expect(d.obituary.url).toBe(BEAVER.url);
    expect(d.callNotes).toMatch(/^Possible obituary, check before calling/);
    expect(heirCreates).toHaveLength(0);
    expect(skiptrace.lookupSurvivors).not.toHaveBeenCalled();
  });

  it('confirming a possible match applies it as strong; rejecting clears it', async () => {
    const saved = lead({ detail: { obituaryMatch: 'possible', obituary: { ...BEAVER, verdict: 'possible' } } });
    const a = harness([saved]);
    const r = await a.svc.resolve('lead1', 'org', 'confirm');
    expect(r.obituaryMatch).toBe('confirmed');
    expect(a.detailUpdates[0].data).toMatchObject({ deceased: true, obituaryMatch: 'confirmed' });
    expect(a.heirCreates).toHaveLength(2);
    expect(a.create).not.toHaveBeenCalled();

    const b = harness([saved]);
    await b.svc.resolve('lead1', 'org', 'reject');
    expect(b.detailUpdates[0].data.obituaryMatch).toBe('rejected');
    expect(b.heirCreates).toHaveLength(0);
  });

  it('only checks claims that meet the criteria, and never an entity or an estate with an heir on file', async () => {
    const { svc } = harness([
      lead({ id: 'a', detail: { id: 'da', claimStatus: 'pending' } }),
      lead({ id: 'b', detail: { id: 'db', noticeDate: new Date(Date.now() - 400 * 86400000) } }),
      lead({ id: 'c', sellerFirstName: 'SUNSHINE', sellerLastName: 'HOLDINGS LLC', detail: { id: 'dc' } }),
      lead({ id: 'd', detail: { id: 'dd', deceased: true, heirs: [{ role: 'heir', deceased: false }] } }),
      lead({ id: 'e', detail: { id: 'de', deceased: true } }),
      lead({ id: 'f', detail: { id: 'df' } }),
    ]);

    const r = await svc.run({ organizationId: 'org', dryRun: true });

    // The estate with no heir (e) and the living claimant (f).
    expect(r.candidates).toBe(2);
    expect(r.estimatedCost).toBe(0.9);
  });

  it('an estate is searched for its survivors, not for whether they died', async () => {
    const { svc, create } = harness([lead({ detail: { deceased: true, dateOfDeath: new Date('2020-10-27T12:00:00Z') } })]);
    create.mockResolvedValue(reply({ ...BEAVER, verdict: 'none', survivors: [] }));
    await svc.run({ organizationId: 'org' });
    const person = JSON.parse(create.mock.calls[0][0].messages[0].content);
    expect(person.status).toBe('Known to have died on 2020-10-27. Find the obituary to learn who survives them.');
  });
});
