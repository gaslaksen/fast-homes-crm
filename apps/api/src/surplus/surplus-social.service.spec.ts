import { SurplusSocialService } from './surplus-social.service';

/**
 * The social profile search and the profile list. These pin what a search
 * files, what a hand-entered profile does, that a rejection is remembered,
 * that a message is a touch, and the budget.
 */

const CLARK = {
  profiles: [
    { platform: 'facebook', url: 'https://www.facebook.com/aleric.clark', displayName: 'Aleric Clark', confidence: 'strong', evidence: 'Lives in San Antonio, Texas.' },
    { platform: 'instagram', url: 'https://www.instagram.com/presley.clark/', displayName: 'Presley', confidence: 'possible', evidence: 'Shares the surname.' },
  ],
  searched: 'Searched Facebook and Instagram for Aleric Clark in San Antonio.',
  note: null,
};

function reply(verdict: any, stop = 'end_turn') {
  return {
    stop_reason: stop,
    model: 'claude-opus-5',
    usage: { input_tokens: 40000, output_tokens: 1000, server_tool_use: { web_search_requests: 5 } },
    content: [{ type: 'text', text: `Searched.\n${JSON.stringify(verdict)}` }],
  };
}

function lead(over: any = {}) {
  const { detail, ...rest } = over;
  return {
    id: 'lead1',
    organizationId: 'org',
    sellerFirstName: 'ALERIC T',
    sellerLastName: 'CLARK',
    sellerPhone: '',
    propertyAddress: '100 MAIN ST',
    propertyCity: 'MELBOURNE',
    propertyState: 'FL',
    propertyZip: '32901',
    ...rest,
    surplusDetail: {
      id: 'd1',
      county: 'Brevard',
      caseNumber: '250888',
      grossSurplus: 12545.94,
      claimStatus: 'open',
      noticeDate: new Date(Date.now() - 60 * 86400000),
      deceased: false,
      heirsRequired: false,
      callNotes: 'Relatives on file: Leticia N Clark (spouse), Presley Clark (family).',
      ownerMailingStreet: '12 OAK LN',
      ownerMailingCity: 'SAN ANTONIO',
      ownerMailingState: 'TX',
      ownerMailingZip: '78201',
      heirs: [],
      socialProfiles: [],
      ...detail,
    },
  };
}

function harness(leads: any[], env: Record<string, string> = {}, spent = 0) {
  const profileCreates: any[] = [];
  const attempts: any[] = [];
  const activities: any[] = [];
  const detailUpdates: any[] = [];
  const heirUpdates: any[] = [];
  const leadUpdates: any[] = [];
  let spend = spent;
  const prisma: any = {
    lead: {
      findMany: jest.fn().mockResolvedValue(leads),
      findFirst: jest.fn(async () => leads[0] || null),
      update: jest.fn(async (a: any) => { leadUpdates.push(a); return {}; }),
    },
    vendorUsage: {
      findUnique: jest.fn(async () => ({ calls: 0, spend })),
      upsert: jest.fn(async (a: any) => { spend += a.update.spend.increment; return {}; }),
    },
    surplusDetail: {
      findFirst: jest.fn(async () => ({ id: 'd1', organizationId: 'org' })),
      update: jest.fn(async (a: any) => { detailUpdates.push(a); return {}; }),
    },
    surplusHeir: {
      findFirst: jest.fn(async () => null),
      update: jest.fn(async (a: any) => { heirUpdates.push(a); return {}; }),
    },
    surplusSocialProfile: {
      create: jest.fn(async (a: any) => { profileCreates.push(a.data); return { id: `p${profileCreates.length}`, ...a.data }; }),
      upsert: jest.fn(async (a: any) => ({ id: 'p1', heir: null, ...a.create })),
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async (a: any) => ({ id: a.where.id, platform: 'facebook', url: 'u', heir: null, ...a.data })),
      delete: jest.fn(),
    },
    surplusTraceAttempt: { create: jest.fn(async (a: any) => { attempts.push(a.data); return a.data; }) },
    activity: { create: jest.fn(async (a: any) => { activities.push(a.data); return a.data; }) },
  };
  const config: any = { get: (k: string) => ({ ANTHROPIC_API_KEY: 'k', ...env } as any)[k] };
  const svc = new SurplusSocialService(config, prisma);
  const create = jest.fn();
  (svc as any).anthropic = { beta: { messages: { create } } };
  return { svc, prisma, create, profileCreates, attempts, activities, detailUpdates, heirUpdates, leadUpdates, spent: () => spend };
}

describe('SurplusSocialService', () => {
  it('needs no budget variable: with nothing set it runs, uncapped', async () => {
    const { svc, create } = harness([lead()], {}, 500);
    create.mockResolvedValue(reply(CLARK));
    expect(svc.available).toBe(true);
    const r = await svc.run({ organizationId: 'org' });
    expect(r).toMatchObject({ checked: 1, found: 1, errors: 0 });
    expect(await svc.usage()).toMatchObject({ budget: 0, left: null, paused: false });
  });

  it('SOCIAL_SEARCH_ENABLED=false turns it off: nothing is sent', async () => {
    const { svc, create } = harness([lead()], { SOCIAL_SEARCH_ENABLED: 'false' });
    const r = await svc.run({ organizationId: 'org' });
    expect(svc.available).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(r.message).toMatch(/turned off/);
  });

  it('a dry run counts the living claimants with no number and estimates the cost', async () => {
    const { svc, create } = harness([lead(), lead({ id: 'lead2', sellerPhone: '5551234567' })]);
    const r = await svc.run({ organizationId: 'org', dryRun: true });
    expect(r.candidates).toBe(1);
    expect(r.estimatedCost).toBeCloseTo(0.45, 2);
    expect(create).not.toHaveBeenCalled();
  });

  it('a number on a registry does not make the claimant reachable', async () => {
    const { svc } = harness([lead({ sellerPhone: '5551234567', detail: { phone1Dnc: 'federal' } })]);
    const r = await svc.run({ organizationId: 'org', dryRun: true });
    expect(r.candidates).toBe(1);
  });

  it('files what it finds as candidates, stamps the claimant, and logs the attempt with its cost', async () => {
    const { svc, create, profileCreates, attempts, detailUpdates } = harness([lead()]);
    create.mockResolvedValue(reply(CLARK));
    const r = await svc.run({ organizationId: 'org' });
    expect(r).toMatchObject({ checked: 1, found: 1, profiles: 2, errors: 0 });
    expect(r.spent).toBeGreaterThan(0.2);

    // The person the search was told about: name, both places, the relatives.
    const sent = JSON.parse(create.mock.calls[0][0].messages[0].content);
    expect(sent.name).toBe('ALERIC T CLARK');
    expect(sent.knownPlaces).toHaveLength(2);
    expect(sent.knownPlaces[1]).toContain('SAN ANTONIO');
    expect(sent.knownRelatives).toEqual(['Leticia N Clark (spouse)', 'Presley Clark (family)']);
    expect(create.mock.calls[0][0].tools.map((t: any) => t.name)).toEqual(['web_search', 'web_fetch']);

    expect(profileCreates).toHaveLength(2);
    expect(profileCreates[0]).toMatchObject({ platform: 'facebook', handle: 'aleric.clark', status: 'candidate', confidence: 'strong', foundBy: 'search', heirId: null });
    expect(detailUpdates[0].data.socialSearchedAt).toBeInstanceOf(Date);
    expect(detailUpdates[0].data.socialSearch.profiles).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ channel: 'social', source: 'Claude web search', result: 'found' });
    expect(attempts[0].summary).toContain('2 profiles to check');
    expect(attempts[0].cost).toBeGreaterThan(0);
  });

  it('a miss with leads saves them on the card and in the notes, for the hand search on Facebook', async () => {
    const { svc, create, attempts, detailUpdates } = harness([lead()]);
    create.mockResolvedValue(reply({
      profiles: [],
      leads: [{ kind: 'spouse', value: 'Yvette Hinojosa', detail: 'people-search listing' }, { kind: 'business', value: 'Devonwood Enterprizes Inc', detail: null }],
      searched: 'Searched.',
      note: null,
    }));
    await svc.run({ organizationId: 'org' });
    expect(detailUpdates[0].data.socialSearch.leads).toHaveLength(2);
    expect(detailUpdates[0].data.callNotes).toContain('Relatives on file');
    expect(detailUpdates[0].data.callNotes).toMatch(/Web research on ALERIC T CLARK \(\d{4}-\d{2}-\d{2}\): spouse Yvette Hinojosa \(people-search listing\); business Devonwood Enterprizes Inc\. Unverified/);
    expect(attempts[0].summary).toContain('2 leads to search Facebook with');
  });

  it('a miss is stamped and logged as nothing, so the search is not bought twice', async () => {
    const { svc, create, profileCreates, attempts, detailUpdates } = harness([lead()]);
    create.mockResolvedValue(reply({ profiles: [], searched: 'Searched Facebook for Aleric Clark in Texas and Florida.', note: 'Only namesakes in Georgia.' }));
    const r = await svc.run({ organizationId: 'org' });
    expect(r).toMatchObject({ checked: 1, found: 0, profiles: 0 });
    expect(profileCreates).toHaveLength(0);
    expect(detailUpdates[0].data.socialSearchedAt).toBeInstanceOf(Date);
    expect(attempts[0]).toMatchObject({ result: 'nothing' });
    expect(attempts[0].summary).toContain('Only namesakes');
  });

  it('a URL already on the claim is not filed again, and a rejection is passed to the search', async () => {
    const rejected = { id: 'p0', url: 'https://www.facebook.com/aleric.clark', status: 'rejected', heirId: null };
    const { svc, create, profileCreates } = harness([lead({ detail: { socialProfiles: [rejected] } })]);
    create.mockResolvedValue(reply(CLARK));
    const r = await svc.run({ organizationId: 'org' });
    expect(r.profiles).toBe(1);
    expect(profileCreates.map((p) => p.platform)).toEqual(['instagram']);
    const sent = JSON.parse(create.mock.calls[0][0].messages[0].content);
    expect(sent.alreadyRejected).toEqual(['https://www.facebook.com/aleric.clark']);
  });

  it('searching for a heir from the card tells the search who they are to the claimant', async () => {
    const heir = { id: 'h1', name: 'Leticia N Clark', relationship: 'Spouse', street: null, city: 'San Antonio', state: 'TX', zip: null };
    const { svc, create, profileCreates, prisma, attempts } = harness([lead({ detail: { heirs: [heir] } })]);
    create.mockResolvedValue(reply({ profiles: [CLARK.profiles[1]], searched: 'Searched.', note: null }));
    const r = await svc.findFor('lead1', { heirId: 'h1', organizationId: 'org', userId: 'u1' });
    expect(r.added).toBe(1);
    const sent = JSON.parse(create.mock.calls[0][0].messages[0].content);
    expect(sent.name).toBe('Leticia N Clark');
    expect(sent.status).toMatch(/Spouse of ALERIC T CLARK/);
    expect(profileCreates[0].heirId).toBe('h1');
    expect(prisma.surplusHeir.update).toHaveBeenCalledWith({ where: { id: 'h1' }, data: { socialSearchedAt: expect.any(Date) } });
    expect(attempts[0]).toMatchObject({ heirId: 'h1', byUserId: 'u1' });
  });

  it('an optional ceiling still stops the run when the month cannot cover a check', async () => {
    const { svc, create } = harness([lead(), lead({ id: 'lead2' })], { SOCIAL_SEARCH_MONTHLY_BUDGET: '1' }, 0.5);
    create.mockResolvedValue(reply(CLARK));
    const r = await svc.run({ organizationId: 'org' });
    expect(r.checked).toBe(0);
    expect(r.message).toMatch(/out of budget/);
    expect(create).not.toHaveBeenCalled();
  });

  it('a profile added by hand is confirmed on arrival and logs the social channel as tried', async () => {
    const { svc, prisma, attempts, activities } = harness([lead()]);
    const row = await svc.add('lead1', { url: 'm.facebook.com/aleric.clark?mibextid=x', displayName: 'Aleric Clark' }, 'org', 'u1');
    expect(prisma.surplusSocialProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { surplusDetailId_url: { surplusDetailId: 'd1', url: 'https://www.facebook.com/aleric.clark' } },
        create: expect.objectContaining({ platform: 'facebook', handle: 'aleric.clark', status: 'confirmed', foundBy: 'manual', createdByUserId: 'u1' }),
      }),
    );
    expect(row.messageUrl).toBe('https://m.me/aleric.clark');
    expect(attempts[0]).toMatchObject({ channel: 'social', source: 'Facebook', result: 'found', cost: 0 });
    expect(activities[0].type).toBe('SOCIAL_PROFILE');
    await expect(svc.add('lead1', { url: 'aleric clark' }, 'org')).rejects.toThrow(/not a web address/);
  });

  it('a message sent through a profile is a touch on the lead and moves an associate to contacted', async () => {
    const { svc, prisma, leadUpdates, heirUpdates, activities } = harness([lead()]);
    prisma.surplusSocialProfile.findFirst.mockResolvedValue({
      id: 'p1', platform: 'facebook', url: 'https://www.facebook.com/leticia', handle: 'leticia', heirId: 'h1',
      surplusDetail: { id: 'd1', leadId: 'lead1' },
      heir: { id: 'h1', name: 'Leticia N Clark', contactStatus: 'not_contacted' },
    });
    await svc.messaged('p1', 'Sent the opener', 'org', 'u1');
    expect(prisma.surplusSocialProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { messageCount: { increment: 1 }, lastMessagedAt: expect.any(Date) } }),
    );
    expect(leadUpdates[0]).toEqual({ where: { id: 'lead1' }, data: { touchCount: { increment: 1 }, lastTouchedAt: expect.any(Date) } });
    expect(heirUpdates[0].data).toMatchObject({ contactStatus: 'contacted', lastContactedAt: expect.any(Date) });
    expect(activities[0]).toMatchObject({ type: 'SOCIAL_MESSAGE', description: 'Facebook message sent to Leticia N Clark: Sent the opener' });
  });

  it('the status is confirmed, rejected or candidate, nothing else', async () => {
    const { svc, prisma } = harness([lead()]);
    prisma.surplusSocialProfile.findFirst.mockResolvedValue({
      id: 'p1', platform: 'facebook', url: 'u', heirId: null, surplusDetail: { id: 'd1', leadId: 'lead1' }, heir: null,
    });
    await expect(svc.setStatus('p1', 'maybe', 'org')).rejects.toThrow(/candidate, confirmed, or rejected/);
    const r = await svc.setStatus('p1', 'rejected', 'org');
    expect(r.status).toBe('rejected');
  });
});
