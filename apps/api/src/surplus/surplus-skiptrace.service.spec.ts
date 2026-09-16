import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { batchDeath, estateName, SurplusSkiptraceService } from './surplus-skiptrace.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * The behaviours worth pinning are the ones that cost money or attach a wrong
 * number to a real person, so the vendor is stubbed and the database is a spy.
 */
function harness(leads: any[], endato: any = null, env: Record<string, string> = {}) {
  const leadUpdates: any[] = [];
  const detailUpdates: any[] = [];
  const attempts: any[] = [];
  const heirCreates: any[] = [];
  // The heir table as a small store, so a filed relative can be found and
  // looked up in the same run. Only the where-shapes the service uses.
  const heirs: any[] = [];
  const matches = (h: any, where: any = {}) =>
    Object.entries(where).every(([k, v]: [string, any]) =>
      v && typeof v === 'object' && 'not' in v ? (v.not === null ? h[k] != null : h[k] !== v.not) : (h[k] ?? null) === v,
    );
  const prisma: any = {
    surplusHeir: {
      findMany: jest.fn(async (a: any = {}) => heirs.filter((h) => matches(h, a.where))),
      count: jest.fn(async (a: any = {}) => heirs.filter((h) => matches(h, a.where)).length),
      create: jest.fn(async (a: any) => {
        const row = { id: `h${heirs.length + 1}`, tracedAt: null, deceased: false, doNotCall: false, street: null, vendorPersonId: null, ...a.data };
        heirs.push(row);
        heirCreates.push(a.data);
        return row;
      }),
      update: jest.fn(async (a: any) => Object.assign(heirs.find((h) => h.id === a.where.id), a.data)),
    },
    lead: {
      findMany: jest.fn().mockResolvedValue(leads),
      update: jest.fn(async (a: any) => { leadUpdates.push(a); return {}; }),
    },
    surplusDetail: {
      findUnique: jest.fn().mockResolvedValue({ callNotes: null, organizationId: 'org' }),
      update: jest.fn(async (a: any) => { detailUpdates.push(a); return {}; }),
      updateMany: jest.fn(async (a: any) => { detailUpdates.push(a); return { count: 1 }; }),
    },
    surplusTraceAttempt: {
      create: jest.fn(async (a: any) => { attempts.push(a.data); return a.data; }),
    },
  };
  const config = { get: (k: string) => (k === 'BATCHDATA_API_KEY' ? 'test-key' : env[k]) };
  const svc = new SurplusSkiptraceService(prisma, config as unknown as ConfigService, endato as any);
  return { svc, prisma, leadUpdates, detailUpdates, attempts, heirCreates, heirs };
}

/**
 * A stand-in for the Endato rung. `people` is what a search returns, in the
 * parsed shape; absent means the rung is not configured and stays silent.
 */
function endatoStub(people: any[] | null = null, byId: Record<string, any> = {}) {
  return {
    available: people !== null,
    costPerSearch: 0.25,
    search: jest.fn().mockResolvedValue(people || []),
    lookup: jest.fn(async (id: string) => byId[id] ?? null),
  };
}

const lead = (over: any = {}) => ({
  id: over.id || 'lead1',
  sellerFirstName: over.first ?? 'Myrtis',
  sellerLastName: over.last ?? 'Griffin',
  sellerPhone: '',
  propertyAddress: over.street ?? '2817 EAVERSON ST',
  propertyCity: 'JACKSONVILLE',
  propertyState: 'FL',
  propertyZip: '32209',
  surplusDetail: {
    id: over.detailId || 'd1',
    caseNumber: over.caseNumber ?? '2025-0023TD',
    grossSurplus: over.surplus ?? 10000,
    nameSearchedAt: over.nameSearchedAt ?? null,
    mailVerdict: over.mailVerdict ?? null,
    ownerMailingStreet: over.mailStreet ?? null,
    ownerMailingCity: over.mailCity ?? null,
    ownerMailingState: over.mailState ?? null,
    ownerMailingZip: over.mailZip ?? null,
  },
});

const person = (
  first: string,
  last: string,
  phones: string[] = ['9045551234'],
  over: any = {},
) => ({
  propertyOwner: true,
  name: { first, last, akas: over.akas || [] },
  addresses: over.addresses || [],
  phones: phones.map((n) => ({ number: n, type: 'Mobile', dnc: false, tcpa: false, ...over.phoneFlags })),
  emails: [],
  litigator: !!over.litigator,
  deceased: !!over.deceased,
});

/** The V3 envelope: result.data[] with a persons[] array per property. */
function respond(persons: any[], meta: any = { matched: true, error: false }) {
  mockedAxios.post.mockResolvedValue({
    data: { result: { data: [{ persons, meta }] } },
  } as any);
}

beforeEach(() => jest.clearAllMocks());

describe('SurplusSkiptraceService', () => {
  it('submits ONE call for co-owners at the same address', async () => {
    // BatchData matches on address and ignores names, so the second co-owner
    // would return the identical row. The second credit buys nothing.
    const { svc } = harness([
      lead({ id: 'a', detailId: 'da', first: 'Myrtis', last: 'Griffin' }),
      lead({ id: 'b', detailId: 'db', first: 'Jessie', last: 'Hall' }),
    ]);
    respond([person('Myrtis', 'Griffin'), person('Jessie', 'Hall', ['9045559999'])]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(r.submitted).toBe(1);
    expect(r.candidates).toBe(2);
  });

  it('gives each co-owner their OWN returned person, not persons[0]', async () => {
    // The foreclosure tracer takes persons[0] and drops the rest. Here that
    // would give Jessie Hall's lead Myrtis Griffin's phone number.
    const { svc, leadUpdates } = harness([
      lead({ id: 'a', detailId: 'da', first: 'Myrtis', last: 'Griffin' }),
      lead({ id: 'b', detailId: 'db', first: 'Jessie', last: 'Hall' }),
    ]);
    respond([
      person('Myrtis', 'Griffin', ['9045551111']),
      person('Jessie', 'Hall', ['9045552222']),
    ]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(r.contacted).toBe(2);
    const byLead = Object.fromEntries(
      leadUpdates.map((u) => [u.where.id, u.data.sellerPhone]),
    );
    expect(byLead.a).toBe('+19045551111');
    expect(byLead.b).toBe('+19045552222');
  });

  it('discards a stranger rather than attaching their number', async () => {
    // The common case on a sold property: the trace returns the new occupant.
    const { svc, leadUpdates, detailUpdates } = harness([lead({ first: 'Susan', last: 'Wright' })]);
    respond([person('Marcus', 'Delgado', ['9045557777'])]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(r.mismatched).toBe(1);
    expect(r.contacted).toBe(0);
    expect(leadUpdates).toHaveLength(0); // no phone written anywhere
    expect(detailUpdates[0].data.contactMismatch).toBe(true);
    expect(detailUpdates[0].data.mismatchedName).toBe('Marcus Delgado');
  });

  it('keeps a relative and says so', async () => {
    // The surviving spouse is often the fastest route to the claimant, so this
    // is kept, but it must never be presented as the claimant.
    const { svc, leadUpdates, detailUpdates } = harness([
      lead({ first: 'Dannie', last: 'Stewart' }),
    ]);
    respond([person('Bertha', 'Stewart', ['9043881280'])]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(r.contacted).toBe(1);
    expect(leadUpdates[0].data.sellerPhone).toBe('+19043881280');
    expect(detailUpdates[0].data.contactMismatch).toBe(false);
    expect(detailUpdates[0].data.callNotes).toMatch(/Bertha Stewart, not the claimant/);
  });

  it('prefers the claimant over a relative when both come back', async () => {
    const { svc, leadUpdates } = harness([lead({ first: 'Dannie', last: 'Stewart' })]);
    respond([
      person('Bertha', 'Stewart', ['9043881280']),
      person('Dannie', 'Stewart', ['9045550000']),
    ]);

    await svc.traceLeads({ organizationId: 'org' });
    expect(leadUpdates[0].data.sellerPhone).toBe('+19045550000');
  });

  it('never submits an entity', async () => {
    const { svc } = harness([lead({ first: 'HEAVENLY HANDS FUNDING,', last: 'LLC' })]);
    respond([person('Someone', 'Else')]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(r.skipped.entity).toBe(1);
  });

  it('never submits a street with no house number', async () => {
    // Duval 2026-0004TD lists "BROADWAY AVE" with no number.
    const { svc } = harness([lead({ street: 'BROADWAY AVE' })]);
    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(r.skipped.no_house_number).toBe(1);
  });

  it('never submits an address shared across different cases', async () => {
    // A professional address: attorney, tax service, registered agent.
    const { svc } = harness([
      lead({ id: 'a', detailId: 'da', caseNumber: '2025-0001TD', first: 'Ann', last: 'Alpha' }),
      lead({ id: 'b', detailId: 'db', caseNumber: '2025-0002TD', first: 'Bob', last: 'Beta' }),
    ]);
    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(r.skipped.shared_address).toBe(2);
  });

  it('caps spending on ADDRESSES, not leads', async () => {
    const { svc } = harness([
      lead({ id: 'a', detailId: 'da', street: '1 FIRST ST', caseNumber: 'c1' }),
      lead({ id: 'b', detailId: 'db', street: '2 SECOND ST', caseNumber: 'c2' }),
      lead({ id: 'c', detailId: 'dc', street: '3 THIRD ST', caseNumber: 'c3' }),
    ]);
    respond([person('Myrtis', 'Griffin')]);

    const r = await svc.traceLeads({ organizationId: 'org', limit: 2 });

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(r.submitted).toBe(2);
  });

  it('reports WHAT the vendor said, not just that something failed', async () => {
    // A bare "errors: 1" is not actionable when the run costs money and the
    // fix might be a one word path change.
    const { svc } = harness([lead()]);
    mockedAxios.post.mockRejectedValue({
      response: { status: 404, data: { message: 'Not Found' } },
    });

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(r.errors).toBe(1);
    expect(r.message).toMatch(/404/);
    expect(r.message).toMatch(/Not Found/);
    expect(r.message).toMatch(/api\/v3/);
  });

  it('stops the batch on a refusal instead of repeating it per address', async () => {
    const { svc } = harness([
      lead({ id: 'a', detailId: 'da', street: '1 FIRST ST', caseNumber: 'c1' }),
      lead({ id: 'b', detailId: 'db', street: '2 SECOND ST', caseNumber: 'c2' }),
      lead({ id: 'c', detailId: 'dc', street: '3 THIRD ST', caseNumber: 'c3' }),
    ]);
    mockedAxios.post.mockRejectedValue({ response: { status: 403 } });

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(r.message).toMatch(/403/);
  });

  it('stops immediately when the account runs out of credits', async () => {
    const { svc } = harness([
      lead({ id: 'a', detailId: 'da', street: '1 FIRST ST', caseNumber: 'c1' }),
      lead({ id: 'b', detailId: 'db', street: '2 SECOND ST', caseNumber: 'c2' }),
      lead({ id: 'c', detailId: 'dc', street: '3 THIRD ST', caseNumber: 'c3' }),
    ]);
    mockedAxios.post.mockRejectedValue({ response: { status: 402 } });

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(r.message).toMatch(/credits/i);
  });

  it('does nothing at all without an API key', async () => {
    const prisma: any = { lead: { findMany: jest.fn() } };
    const config = { get: () => undefined };
    const svc = new SurplusSkiptraceService(prisma, config as unknown as ConfigService);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(prisma.lead.findMany).not.toHaveBeenCalled();
    expect(r.message).toMatch(/BATCHDATA_API_KEY/);
  });

  it('records a reason when the address matched nobody', async () => {
    const { svc, detailUpdates } = harness([lead()]);
    respond([]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(r.contacted).toBe(0);
    expect(detailUpdates[0].data.callNotes).toMatch(/no matched person/i);
  });
});

describe('choosing which address to submit', () => {
  it('submits the OWNER mailing address from the notice, not the property', async () => {
    // The case that proved this matters: a vacant Jacksonville lot whose owner
    // was noticed in Hartford, Connecticut.
    const { svc } = harness([
      lead({
        first: 'Myrtis', last: 'Griffin',
        street: '0 HARDEE ST',
        mailStreet: '72 SMITH DRIVE', mailCity: 'HARTFORD', mailState: 'CT', mailZip: '06118',
      }),
    ]);
    respond([person('Myrtis', 'Griffin', ['8605551234'])]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(r.contacted).toBe(1);
    // V3 carries both: the parcel that sold in propertyAddress, and where the
    // owner actually is in mailingAddress. V1 could only take one, so the
    // mailing address had to masquerade as the property.
    const req: any = (mockedAxios.post as jest.Mock).mock.calls[0][1].requests[0];
    expect(req.mailingAddress).toEqual({
      street: '72 SMITH DRIVE', city: 'HARTFORD', state: 'CT', zip: '06118',
    });
    expect(req.propertyAddress.street).toBe('0 HARDEE ST');
  });

  it('does not apply the placeholder rule to a real mailing address', async () => {
    // "0 HARDEE ST" would be refused as a placeholder, but the mailing address
    // is what gets submitted, so the case is still workable.
    const { svc } = harness([
      lead({ street: '0 HARDEE ST', mailStreet: '72 SMITH DRIVE', mailCity: 'HARTFORD', mailState: 'CT', mailZip: '06118' }),
    ]);
    respond([person('Myrtis', 'Griffin')]);

    const r = await svc.traceLeads({ organizationId: 'org' });
    expect(r.submitted).toBe(1);
    expect(r.skipped.placeholder_address).toBeUndefined();
  });

  it('traces by name and property when the clerk\'s mail bounced, and leaves the dead address out', async () => {
    // Under the v1 address-only query every such submission came back a
    // stranger, so the gate refused them. The v3 query confirms the NAME
    // against the property that sold, so the dead mailing address is dropped
    // from the request and the claimant is still worked. Polk carries a
    // returned surplus letter on 116 of 141 properties.
    const { svc } = harness([
      lead({
        street: '2817 EAVERSON ST',
        mailStreet: '1228 ADEE AVENUE', mailCity: 'BRONX', mailState: 'NY', mailZip: '10469',
        mailVerdict: 'undeliverable',
      }),
    ]);
    respond([person('Myrtis', 'Griffin')]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(r.submitted).toBe(1);
    expect(r.skipped.mail_returned).toBeUndefined();
    const req = (mockedAxios.post.mock.calls[0][1] as any).requests[0];
    expect(req.name).toEqual({ first: 'Myrtis', last: 'Griffin' });
    expect(req.propertyAddress.street).toBe('2817 EAVERSON ST');
    expect(req.mailingAddress).toBeUndefined();
  });

  it('still refuses a bounced address when there is no name to match on', async () => {
    const { svc } = harness([
      lead({
        first: '', last: 'ESTATE',
        mailStreet: '1228 ADEE AVENUE', mailCity: 'BRONX', mailState: 'NY', mailZip: '10469',
        mailVerdict: 'undeliverable',
      }),
    ]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(r.skipped.mail_returned).toBe(1);
  });

  it('still allows the property fallback when the mail was delivered', async () => {
    const { svc } = harness([lead({ street: '2817 EAVERSON ST', mailVerdict: 'delivered' })]);
    respond([person('Myrtis', 'Griffin')]);

    const r = await svc.traceLeads({ organizationId: 'org' });
    expect(r.submitted).toBe(1);
  });
});

describe('BatchData V3', () => {
  it('calls the v3 endpoint and asks for TCPA numbers to be returned', async () => {
    const { svc } = harness([lead()]);
    respond([person('Myrtis', 'Griffin')]);

    await svc.traceLeads({ organizationId: 'org' });

    const [url, body] = (mockedAxios.post as jest.Mock).mock.calls[0];
    expect(url).toContain('/api/v3/property/skip-trace');
    expect(body.options.includeTCPABlacklistedPhones).toBe(true);
  });

  it('sends the claimant name and both addresses in one request', async () => {
    // Name plus property plus mailing address is a far better query than any
    // one alone, and the vendor confirms the name against the property itself.
    const { svc } = harness([
      lead({
        first: 'Myrtis', last: 'Griffin', street: '0 HARDEE ST',
        mailStreet: '72 SMITH DRIVE', mailCity: 'HARTFORD', mailState: 'CT', mailZip: '06118',
      }),
    ]);
    respond([person('Myrtis', 'Griffin')]);

    await svc.traceLeads({ organizationId: 'org' });

    const req = (mockedAxios.post as jest.Mock).mock.calls[0][1].requests[0];
    expect(req.name).toEqual({ first: 'Myrtis', last: 'Griffin' });
    expect(req.propertyAddress.street).toBe('0 HARDEE ST');
    expect(req.mailingAddress).toEqual({
      street: '72 SMITH DRIVE', city: 'HARTFORD', state: 'CT', zip: '06118',
    });
  });

  it('reaches BOTH co-owners now that a property returns several persons', async () => {
    // The thing V1 could not do. Its persons[] was one entry per REQUEST, so
    // every co-owner past the first was unreachable and looked like a miss.
    const { svc, leadUpdates } = harness([
      lead({ id: 'a', detailId: 'da', first: 'Myrtis', last: 'Griffin' }),
      lead({ id: 'b', detailId: 'db', first: 'Jessie', last: 'Hall' }),
    ]);
    respond([
      person('Myrtis', 'Griffin', ['9045551111']),
      person('Jessie', 'Hall', ['9045552222']),
    ]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(r.contacted).toBe(2);
    const byLead = Object.fromEntries(leadUpdates.map((u) => [u.where.id, u.data.sellerPhone]));
    expect(byLead.a).toBe('+19045551111');
    expect(byLead.b).toBe('+19045552222');
  });

  it('flags a restricted number rather than hiding it', async () => {
    // V1 dropped TCPA numbers silently, so a number existed and nobody knew.
    const { svc, detailUpdates } = harness([lead()]);
    respond([person('Myrtis', 'Griffin', ['9045551234'], { phoneFlags: { tcpa: true } })]);

    await svc.traceLeads({ organizationId: 'org' });
    expect(detailUpdates[0].data.phone1Dnc).toBe('tcpa');
  });

  it('marks a litigator ahead of any other reason', async () => {
    // The most expensive number in the list to get wrong.
    const { svc, detailUpdates } = harness([lead()]);
    respond([person('Myrtis', 'Griffin', ['9045551234'], { litigator: true, phoneFlags: { dnc: true } })]);

    await svc.traceLeads({ organizationId: 'org' });
    expect(detailUpdates[0].data.phone1Dnc).toBe('litigator');
  });

  it('matches on an alias the vendor holds for the same person', async () => {
    const { svc } = harness([lead({ first: 'Myrtis', last: 'Griffin' })]);
    respond([
      person('M', 'Griffin', ['9045551234'], {
        akas: [{ first: 'Myrtis', last: 'Griffin' }],
      }),
    ]);

    const r = await svc.traceLeads({ organizationId: 'org' });
    expect(r.contacted).toBe(1);
    expect(r.mismatched).toBe(0);
  });

  it('records the property tie as evidence but does NOT call a relative the claimant', async () => {
    // Living at the property does not identify WHICH person you are. Promoting
    // on it handed Ruth M Johnson her co-owner Calvin's phone numbers: both
    // lived at 4117 Santee Rd, which is exactly why they are co-claimants.
    const { svc, detailUpdates } = harness([
      lead({
        first: 'Myrtis', last: 'Griffin',
        street: '2817 EAVERSON ST',
        mailStreet: '72 SMITH DRIVE', mailCity: 'HARTFORD', mailState: 'CT', mailZip: '06118',
      }),
    ]);
    respond([
      person('Bertha', 'Griffin', ['9045551234'], {
        addresses: [{ street: '2817 EAVERSON ST', city: 'JACKSONVILLE', zip: '32209' }],
      }),
    ]);

    const r = await svc.traceLeads({ organizationId: 'org' });
    expect(r.contacted).toBe(1);
    // Kept and usable, but labelled as the household rather than the claimant.
    expect(detailUpdates[0].data.callNotes).toMatch(/not the claimant/i);
    expect(detailUpdates[0].data.callNotes).toMatch(/address history includes the property/i);
  });

  it('never hands the same returned person to two claimants', async () => {
    // The Santee Rd failure. One person came back for a property with two
    // co-owners, and both leads were given his numbers, hers labelled a
    // confirmed match.
    const { svc, leadUpdates, detailUpdates } = harness([
      lead({ id: 'a', detailId: 'da', first: 'Calvin', last: 'Johnson' }),
      lead({ id: 'b', detailId: 'db', first: 'Ruth', last: 'Johnson' }),
    ]);
    respond([person('Calvin', 'Johnson', ['9043181919'])]);

    await svc.traceLeads({ organizationId: 'org' });

    // Calvin gets the person. Ruth gets nothing rather than his numbers.
    const phones = leadUpdates.map((u) => u.data.sellerPhone).filter(Boolean);
    expect(phones).toEqual(['+19043181919']);
    expect(leadUpdates.map((u) => u.where.id)).toEqual(['a']);
    const ruth = detailUpdates.find((u) => u.where.id === 'db');
    expect(ruth.data.callNotes).toMatch(/no matched person|returned no/i);
  });

  it('pairs each co-owner with their own person when both come back', async () => {
    const { svc, leadUpdates } = harness([
      lead({ id: 'a', detailId: 'da', first: 'Calvin', last: 'Johnson' }),
      lead({ id: 'b', detailId: 'db', first: 'Ruth', last: 'Johnson' }),
    ]);
    respond([
      person('Calvin', 'Johnson', ['9045551111']),
      person('Ruth', 'Johnson', ['9045552222']),
    ]);

    await svc.traceLeads({ organizationId: 'org' });

    const byLead = Object.fromEntries(leadUpdates.map((u) => [u.where.id, u.data.sellerPhone]));
    expect(byLead.a).toBe('+19045551111');
    expect(byLead.b).toBe('+19045552222');
  });

  it('treats an unmatched property as no persons at all', async () => {
    const { svc } = harness([lead()]);
    respond([], { matched: false, error: false });

    const r = await svc.traceLeads({ organizationId: 'org' });
    expect(r.contacted).toBe(0);
  });
});

describe('trace notes', () => {
  it('replaces the previous trace result instead of stacking a contradiction', async () => {
    // A re-trace left Calvin Johnson saying both "matched Calvin Johnson" and
    // "returned no matched person". Only the latest trace is true.
    const { svc, prisma, detailUpdates } = harness([lead()]);
    prisma.surplusDetail.findUnique.mockResolvedValue({
      callNotes: 'Skip trace returned no matched person at 4117 SANTEE RD.',
    });
    respond([person('Myrtis', 'Griffin', ['9045551234'])]);

    await svc.traceLeads({ organizationId: 'org' });

    const note = detailUpdates[0].data.callNotes;
    expect(note).not.toMatch(/no matched person/i);
    expect(note).toMatch(/matched Myrtis Griffin/);
  });

  it('keeps a note a human wrote', async () => {
    const { svc, prisma, detailUpdates } = harness([lead()]);
    prisma.surplusDetail.findUnique.mockResolvedValue({
      callNotes: 'Spoke to the neighbour, said she moved to Georgia.',
    });
    respond([]);

    await svc.traceLeads({ organizationId: 'org' });

    expect(detailUpdates[0].data.callNotes).toMatch(/neighbour/);
  });
});

describe('recording that a trace happened', () => {
  /**
   * The panel now says outright whether a claimant has been traced, so the
   * stamp has to survive every branch. Before this, the only record was a
   * sentence in the notes, and a claimant nothing had run for looked identical
   * to one whose trace came back empty.
   */
  it('stamps the outcome per claimant, not per address', async () => {
    // Two co-owners, one submission, opposite outcomes: the trace returns only
    // Calvin, so Ruth is left with nothing found.
    const { svc, detailUpdates, attempts } = harness([
      lead({ id: 'l1', detailId: 'd1', first: 'Calvin', last: 'Johnson' }),
      lead({ id: 'l2', detailId: 'd2', first: 'Ruth', last: 'Johnson' }),
    ]);
    respond([person('Calvin', 'Johnson')]);

    await svc.traceLeads({ organizationId: 'org' });

    const byDetail = Object.fromEntries(
      detailUpdates.map((u) => [u.where.id, u.data]),
    );
    expect(byDetail.d1.traceOutcome).toBe('matched');
    expect(byDetail.d1.tracedAt).toBeInstanceOf(Date);
    expect(byDetail.d2.traceOutcome).toBe('no_person');
    expect(byDetail.d2.tracedAt).toBeInstanceOf(Date);
    // Both runs land in the search log as paid-database attempts, one per claimant.
    const byAttempt = Object.fromEntries(attempts.map((a) => [a.surplusDetailId, a]));
    expect(byAttempt.d1).toMatchObject({ heirId: null, channel: 'paid_db', source: 'batchdata', result: 'found' });
    expect(byAttempt.d2).toMatchObject({ heirId: null, channel: 'paid_db', result: 'nothing' });
  });

  it('stamps a stranger as a mismatch rather than leaving it untraced', async () => {
    const { svc, detailUpdates } = harness([lead({ detailId: 'd9' })]);
    respond([person('Wanda', 'Pettiford')]);

    await svc.traceLeads({ organizationId: 'org' });

    const u = detailUpdates.find((x) => x.where.id === 'd9');
    expect(u.data.traceOutcome).toBe('mismatch');
    expect(u.data.contactMismatch).toBe(true);
  });

  it('stamps a refusal to submit, so it does not read as never tried', async () => {
    // An entity has no consumer identity to trace. We decline to spend the
    // credit, and that decision is a fact about the claimant too.
    const { svc, detailUpdates } = harness([
      lead({ detailId: 'd7', first: 'HEAVENLY HANDS', last: 'FUNDING LLC', mailStreet: '72 SMITH DRIVE', mailCity: 'HARTFORD', mailState: 'CT', mailZip: '06118' }),
    ]);

    await svc.traceLeads({ organizationId: 'org' });

    expect(mockedAxios.post).not.toHaveBeenCalled();
    const u = detailUpdates.find((x) => x.where.id === 'd7');
    expect(u.data.traceOutcome).toBe('skipped');
  });
});

describe('the name-first rung (Endato)', () => {
  /** Endato's parsed shape for a person tied to the property. */
  const zumsteg = (over: any = {}) => ({
    first: 'Bernhard',
    last: 'Zumsteg',
    age: 61,
    akas: [],
    addresses: [{ street: '256 Treu', city: 'Palm Bay', state: 'FL', zip: '32907', lastSeen: '2026-08-01' }],
    phones: [{ num: '3215550101', type: 'Mobile', connected: true }],
    emails: [],
    deceased: false,
    relatives: [{ name: 'Anita Zumsteg', type: 'Spouse' }],
    ...over,
  });

  it('runs on a claimant the address rung returned a stranger for, and takes only a verified person', async () => {
    // BatchData at the property returns whoever lives there now. Endato,
    // searched by name, returns the owner, whose history includes the parcel.
    // The lead helper files every property in Jacksonville 32209; the vendor's
    // history must carry the same place for the address key to meet it.
    const endato = endatoStub([
      zumsteg({ addresses: [{ street: '256 Treu', city: 'Jacksonville', state: 'FL', zip: '32209', lastSeen: '2026-08-01' }] }),
    ]);
    const { svc, leadUpdates, detailUpdates, attempts } = harness(
      [lead({ street: '256 TREU TER NW', first: 'ZUMSTEG,', last: 'BERNHARD F', mailVerdict: 'undeliverable', mailStreet: 'VOR DEN HALDENSTR 1', mailCity: 'EIKEN' })],
      endato,
    );
    respond([person('Lazaro', 'Perez', ['3215559999'])]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(r.mismatched).toBe(1);
    expect(endato.search).toHaveBeenCalledWith({ first: 'BERNHARD', last: 'ZUMSTEG', city: 'JACKSONVILLE', state: 'FL' });
    expect(r.nameSearch).toEqual({ searched: 1, verified: 1, namesakes: 0 });
    expect(r.contacted).toBe(1);
    expect(leadUpdates.at(-1).data.sellerPhone).toBe('+13215550101');
    // The last write is the death-check stamp; the match is the one before it.
    const patch = detailUpdates.filter((u) => u.data?.traceOutcome).at(-1).data;
    expect(patch.traceOutcome).toBe('matched');
    expect(detailUpdates.at(-1).data.deathCheckedAt).toBeInstanceOf(Date);
    expect(patch.dncScrubbedAt).toBeNull();
    expect(patch.callNotes).toMatch(/^Name search matched Bernhard Zumsteg\./);
    expect(patch.callNotes).toContain("Endato's latest address for them is 256 Treu, Jacksonville FL 32209 (2026-08-01)");
    expect(patch.callNotes).toContain('Relatives on file: Anita Zumsteg (spouse)');
    expect(patch.callNotes).toContain('not DNC scrubbed');
    expect(attempts.at(-1)).toMatchObject({ source: 'endato', result: 'found', cost: 0.25 });
  });

  it('refuses namesakes and says both vendors have been tried', async () => {
    // Five James Simses, none of whom ever lived at 630 S Kentucky Ave.
    const endato = endatoStub([
      zumsteg({ first: 'James', last: 'Sims', addresses: [{ street: '529 20th', city: 'Bradenton', state: 'FL', zip: '34205', lastSeen: '2004-09-07' }] }),
    ]);
    const { svc, detailUpdates, attempts } = harness(
      [lead({ street: '630 S KENTUCKY AVE', first: 'JAMES MICHAEL', last: 'SIMS' })],
      endato,
    );
    respond([]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(r.nameSearch).toEqual({ searched: 1, verified: 0, namesakes: 1 });
    expect(r.contacted).toBe(0);
    const patch = detailUpdates.at(-1).data;
    expect(patch.traceOutcome).toBe('no_person');
    expect(patch.callNotes).toMatch(/^Name search found 1 person named JAMES SIMS, none with the property/);
    expect(attempts.at(-1)).toMatchObject({ source: 'endato', result: 'nothing' });
  });

  it('runs on a lot the address rung refused, once per person however many spellings', async () => {
    // Three spellings of one man on one lot. The address rung refuses the
    // placeholder parcel; the name rung verifies him through the address the
    // clerk wrote to, and every spelling gets his numbers. A lot with NO
    // verifiable address is refused by design: nothing ties a namesake to it.
    const endato = endatoStub([zumsteg()]);
    const mailing = { mailStreet: '256 TREU TER NW', mailCity: 'PALM BAY', mailState: 'FL', mailZip: '32907', mailVerdict: 'undeliverable' };
    const { svc, leadUpdates } = harness(
      [
        lead({ id: 'a', detailId: 'da', street: '0 UNKNOWN', first: 'ZUMSTEG,', last: 'BERNHARD F', caseNumber: '250285', ...mailing }),
        lead({ id: 'b', detailId: 'db', street: '0 UNKNOWN', first: 'ZUMSTEG,', last: 'BERNARD F', caseNumber: '250285', ...mailing }),
        lead({ id: 'c', detailId: 'dc', street: '0 UNKNOWN', first: 'BERNHARD F', last: 'ZUMSTEG', caseNumber: '250285', ...mailing }),
      ],
      endato,
    );

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(r.skipped.placeholder_address).toBe(3);
    // BERNHARD and BERNARD are two spellings of one man to us but two names
    // to the vendor, so they cost two searches; the third row shares the first.
    expect(endato.search).toHaveBeenCalledTimes(2);
    expect(leadUpdates.filter((u) => u.data.sellerPhone === '+13215550101')).toHaveLength(3);
  });

  it('stays silent when Endato is not configured', async () => {
    const { svc } = harness([lead({ street: '0 UNKNOWN' })], endatoStub(null));
    const r = await svc.traceLeads({ organizationId: 'org' });
    expect(r.nameSearch).toEqual({ searched: 0, verified: 0, namesakes: 0 });
  });

  it('can skip the address rung entirely and spends the cap on the biggest surplus first', async () => {
    const endato = endatoStub([]);
    const { svc } = harness(
      [
        lead({ id: 'small', detailId: 'ds', first: 'JOHN', last: 'KISH', caseNumber: '1', surplus: 5000 }),
        lead({ id: 'big', detailId: 'db', first: 'JULIET', last: 'ABE', caseNumber: '2', surplus: 47000 }),
      ],
      endato,
    );

    const r = await svc.traceLeads({ organizationId: 'org', addressSearch: false, nameSearchLimit: 1 });

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(r.submitted).toBe(0);
    expect(endato.search).toHaveBeenCalledTimes(1);
    expect(endato.search.mock.calls[0][0]).toMatchObject({ first: 'JULIET', last: 'ABE' });
  });

  it('stamps every spelling it searched and skips a stamped miss next time', async () => {
    const endato = endatoStub([]);
    const { svc, detailUpdates } = harness(
      [lead({ id: 'a', detailId: 'da', street: '0 UNKNOWN', first: 'JOHN', last: 'KISH', caseNumber: '1' })],
      endato,
    );

    await svc.traceLeads({ organizationId: 'org' });

    expect(endato.search).toHaveBeenCalledTimes(1);
    const stamp = detailUpdates.find((u) => u.data?.nameSearchedAt);
    expect(stamp.where.id.in).toEqual(['da']);

    // The same miss a week later costs nothing.
    const again = harness(
      [lead({ id: 'a', detailId: 'da', street: '0 UNKNOWN', first: 'JOHN', last: 'KISH', caseNumber: '1', nameSearchedAt: new Date('2026-09-12') })],
      endatoStub([]),
    );
    const r = await again.svc.traceLeads({ organizationId: 'org' });
    expect(r.nameSearch.searched).toBe(0);
    expect(r.skipped.name_searched).toBe(1);

    // Unless somebody asks for it.
    const forced = endatoStub([]);
    const third = harness(
      [lead({ id: 'a', detailId: 'da', street: '0 UNKNOWN', first: 'JOHN', last: 'KISH', caseNumber: '1', nameSearchedAt: new Date('2026-09-12') })],
      forced,
    );
    await third.svc.traceLeads({ organizationId: 'org', includeTraced: true });
    expect(forced.search).toHaveBeenCalledTimes(1);
  });

  it('honours the name-search cap', async () => {
    const endato = endatoStub([]);
    const { svc } = harness(
      [
        lead({ id: 'a', detailId: 'da', street: '0 UNKNOWN', first: 'JOHN', last: 'KISH', caseNumber: '1' }),
        lead({ id: 'b', detailId: 'db', street: '0 UNKNOWN', first: 'KATERINA', last: 'KISH', caseNumber: '1' }),
      ],
      endato,
    );
    const r = await svc.traceLeads({ organizationId: 'org', nameSearchLimit: 1 });
    expect(endato.search).toHaveBeenCalledTimes(1);
    expect(r.nameSearch.searched).toBe(1);
  });
});

describe('tracing heirs', () => {
  /**
   * The bug this whole block exists for.
   *
   * An heir never owned the parcel; they inherited a remainder interest in it.
   * Submitting the parcel returns whoever lives there NOW, and because every
   * heir on a case shares that parcel, every one of them comes back as the same
   * stranger. The first live run did exactly that: both Spencer heirs, at
   * addresses eleven miles apart, came back as one Odell Landeros who lives at
   * the house that sold.
   */
  function heirHarness(heirs: any[]) {
    const updates: any[] = [];
    const attempts: any[] = [];
    const prisma: any = {
      surplusHeir: {
        findMany: jest.fn().mockResolvedValue(heirs),
        findUnique: jest.fn().mockResolvedValue({ callNotes: null, surplusDetailId: 'd1' }),
        update: jest.fn(async (a: any) => { updates.push(a); return {}; }),
      },
      surplusDetail: {
        findUnique: jest.fn().mockResolvedValue({ organizationId: 'org' }),
      },
      surplusTraceAttempt: {
        create: jest.fn(async (a: any) => { attempts.push(a.data); return a.data; }),
      },
    };
    const config = { get: (k: string) => (k === 'BATCHDATA_API_KEY' ? 'test-key' : undefined) };
    const svc = new SurplusSkiptraceService(prisma, config as unknown as ConfigService);
    return { svc, updates, attempts };
  }

  const heir = (over: any = {}) => ({
    id: over.id || 'h1',
    surplusDetailId: 'd1',
    name: over.name ?? 'Alfred J. Spencer',
    street: over.street ?? '7789 Andes Drive',
    city: 'JACKSONVILLE',
    state: 'FL',
    zip: '32244',
    deceased: !!over.deceased,
    doNotCall: !!over.doNotCall,
    surplusDetail: {
      caseNumber: '2025-0439TD',
      lead: {
        propertyAddress: '1624 W 35TH ST',
        propertyCity: 'JACKSONVILLE',
        propertyState: 'FL',
        propertyZip: '32209',
      },
    },
    ...over,
  });

  it('submits the HEIR\'s address, not the property that sold', async () => {
    const { svc } = heirHarness([heir()]);
    respond([person('Alfred', 'Spencer')]);

    await svc.traceHeirs({ organizationId: 'org' });

    const body = mockedAxios.post.mock.calls[0][1] as any;
    // The address the vendor keys on must be the heir's own.
    expect(body.requests[0].propertyAddress.street).toBe('7789 Andes Drive');
    expect(body.requests[0].propertyAddress.zip).toBe('32244');
    // And not the parcel, which every heir on the case shares.
    expect(JSON.stringify(body)).not.toContain('1624 W 35TH ST');
  });

  it('gives two heirs two different addresses', async () => {
    // The symptom that exposed the bug: one submission per heir, but both
    // carrying the same parcel, so both returned the same occupant.
    const { svc } = heirHarness([
      heir({ id: 'h1', name: 'Alfred J. Spencer', street: '7789 Andes Drive' }),
      heir({ id: 'h2', name: 'Helen F. Sherman', street: '5407 Turkey Creek Road' }),
    ]);
    respond([person('Alfred', 'Spencer')]);

    await svc.traceHeirs({ organizationId: 'org' });

    const streets = mockedAxios.post.mock.calls.map(
      (c: any) => (c[1] as any).requests[0].propertyAddress.street,
    );
    expect(streets).toEqual(['7789 Andes Drive', '5407 Turkey Creek Road']);
  });

  it('refuses a deceased heir rather than spending a credit', async () => {
    // Their share needs its own estate opened. There is nobody at that address
    // to find, and the filing already said so.
    const { svc } = heirHarness([heir({ deceased: true })]);
    const r = await svc.traceHeirs({ organizationId: 'org' });
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(r.skipped.heir_deceased).toBe(1);
  });

  it('refuses a do-not-call heir', async () => {
    const { svc } = heirHarness([heir({ doNotCall: true })]);
    const r = await svc.traceHeirs({ organizationId: 'org' });
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(r.skipped.do_not_call).toBe(1);
  });

  it('refuses an heir with no street number to submit', async () => {
    const { svc, updates } = heirHarness([heir({ street: 'Andes Drive' })]);
    const r = await svc.traceHeirs({ organizationId: 'org' });
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(r.skipped.no_house_number).toBe(1);
    expect(updates[0].data.traceOutcome).toBe('skipped');
  });

  it('attaches contacts when the name matches', async () => {
    const { svc, updates, attempts } = heirHarness([heir()]);
    respond([person('Alfred', 'Spencer', ['9045551234'])]);

    const r = await svc.traceHeirs({ organizationId: 'org' });

    expect(r.contacted).toBe(1);
    expect(updates[0].data.phone1).toBe('9045551234');
    expect(updates[0].data.traceOutcome).toBe('matched');
    // The paid database logs itself in the search log, against the heir.
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ surplusDetailId: 'd1', heirId: 'h1', channel: 'paid_db', source: 'batchdata', result: 'found' });
  });

  it('discards a stranger instead of attaching them to the heir', async () => {
    const { svc, updates } = heirHarness([heir()]);
    respond([person('Odell', 'Landeros', ['9045559999'])]);

    const r = await svc.traceHeirs({ organizationId: 'org' });

    expect(r.mismatched).toBe(1);
    expect(updates[0].data.contactMismatch).toBe(true);
    expect(updates[0].data.mismatchedName).toBe('Odell Landeros');
    expect(updates[0].data.phone1).toBeUndefined();
  });

  it('treats an empty heirIds array as no heirs, not every heir', async () => {
    // The same mistake on the claimant path once traced a whole board from a
    // liveness probe.
    const { svc } = heirHarness([]);
    const r = await svc.traceHeirs({ organizationId: 'org', heirIds: [] });
    expect(r.candidates).toBe(0);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

describe('deaths the trace finds', () => {
  /** Endato's parsed shape: Juliet Abe, verified by the property that sold. */
  const abe = (over: any = {}) => ({
    first: 'Juliet',
    last: 'Abe',
    age: 82,
    akas: [],
    addresses: [{ street: '256 Treu', city: 'Jacksonville', state: 'FL', zip: '32209', lastSeen: '2026-08-01' }],
    phones: [{ num: '9144233422', type: 'LandLine/Services', connected: true }],
    emails: [],
    deceased: true,
    dateOfDeath: '2021-03-22',
    relatives: [
      { name: 'Mary Lee Abe', type: 'Spouse', deceased: false, city: 'Yonkers', state: 'NY' },
      { name: 'Robert Abe', type: 'Family', deceased: true, city: null, state: null },
    ],
    ...over,
  });

  it('Brevard 250921: a verified person with a death record is marked deceased, not handed out as a contact', async () => {
    // Endato held a 2021 date of death on the record that gave the board her
    // landline. The lead goes to Find the heirs with the date and the vendor
    // named, and the vendor's living relatives are filed as the place to start.
    const endato = endatoStub([abe()]);
    const { svc, detailUpdates, heirCreates, attempts } = harness(
      [lead({ street: '256 TREU TER NW', first: 'JULIET R', last: 'ABE' })],
      endato,
    );
    respond([]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(r.deceased).toBe(1);
    expect(r.contacted).toBe(0);
    const death = detailUpdates.find((u) => u.data?.deceased === true)?.data;
    expect(death).toMatchObject({
      deceased: true,
      heirsRequired: true,
      claimantType: 'heir_estate',
      deathSource: 'endato',
    });
    expect(death.dateOfDeath.toISOString().slice(0, 10)).toBe('2021-03-22');
    expect(death.deathCheckedAt).toBeInstanceOf(Date);
    expect(death.callNotes).toMatch(/Death record \(Endato\): JULIET R ABE died 22 March 2021\. Marked deceased/);
    expect(death.callNotes).toContain('Mary Lee Abe (spouse)');
    // Living relatives only, filed as relatives and never as heirs.
    expect(heirCreates).toHaveLength(1);
    expect(heirCreates[0]).toMatchObject({ name: 'Mary Lee Abe', relationship: 'Spouse', role: 'relative', sourceKind: 'endato', city: 'Yonkers' });
    expect(attempts.at(-1)).toMatchObject({ source: 'endato', result: 'found' });
  });

  it('a relative\'s death is theirs, never pinned on the claimant', async () => {
    // BatchData returned the claimant's husband, deceased. That is a surname
    // match and a relative verdict: the claimant is still alive as far as
    // anybody knows.
    const { svc, detailUpdates } = harness([lead({ first: 'JULIET R', last: 'ABE', mailStreet: '30 POST ST', mailCity: 'YONKERS', mailState: 'NY', mailZip: '10705' })]);
    // Not Robert: his initial is her middle initial, and the matcher rightly
    // reads "Juliet R" and "Robert" as possibly one person.
    respond([person('Kenneth', 'Abe', ['9145550000'], { deceased: true })]);

    const r = await svc.traceLeads({ organizationId: 'org', nameSearch: false });

    expect(r.deceased).toBe(0);
    expect(detailUpdates.some((u) => u.data?.deceased === true)).toBe(false);
  });

  it('a death matched only through a middle initial is not recorded against the claimant', async () => {
    // "Robert Abe" is same_person for "JULIET R ABE" by her middle initial,
    // which is fine for handing over a household number and wrong for a death:
    // it would mark a living widow dead because her husband died.
    const endato = endatoStub([
      {
        first: 'Robert', last: 'Abe', age: 84, akas: [],
        addresses: [{ street: '256 Treu', city: 'Jacksonville', state: 'FL', zip: '32209', lastSeen: '2020-01-01' }],
        phones: [{ num: '9145550000', type: 'LandLine/Services', connected: true }],
        emails: [], deceased: true, dateOfDeath: '2019-01-01', relatives: [],
      },
    ]);
    const { svc, detailUpdates } = harness([lead({ street: '256 TREU TER NW', first: 'JULIET R', last: 'ABE' })], endato);
    respond([]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(r.deceased).toBe(0);
    expect(detailUpdates.some((u) => u.data?.deceased === true)).toBe(false);
  });

  it('reads BatchData\'s nested death field as well as the flat one', async () => {
    expect(batchDeath({ death: { deceased: true, date: '2019-05-01' } })).toEqual({ deceased: true, dateOfDeath: '2019-05-01' });
    expect(batchDeath({ deceased: true })).toEqual({ deceased: true, dateOfDeath: null });
    expect(batchDeath({ death: { deceased: false } })).toEqual({ deceased: false, dateOfDeath: null });
    expect(batchDeath({ name: { first: 'A' } })).toEqual({ deceased: false, dateOfDeath: null });

    const { svc, detailUpdates } = harness([lead({ first: 'MYRTIS', last: 'GRIFFIN', mailStreet: '72 SMITH DR', mailCity: 'HARTFORD', mailState: 'CT', mailZip: '06120' })]);
    const p: any = person('Myrtis', 'Griffin');
    delete p.deceased;
    p.death = { deceased: true, date: '2019-05-01' };
    respond([p]);

    const r = await svc.traceLeads({ organizationId: 'org', nameSearch: false });

    expect(r.deceased).toBe(1);
    expect(detailUpdates.find((u) => u.data?.deceased === true)?.data).toMatchObject({ deathSource: 'batchdata' });
  });

  it('stamps a verified identity with no death record as checked', async () => {
    const endato = endatoStub([abe({ deceased: false, dateOfDeath: null })]);
    const { svc, detailUpdates } = harness([lead({ street: '256 TREU TER NW', first: 'JULIET R', last: 'ABE' })], endato);
    respond([]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(r.contacted).toBe(1);
    expect(r.deceased).toBe(0);
    expect(detailUpdates.some((u) => u.data?.deathCheckedAt instanceof Date && u.data?.deceased === undefined)).toBe(true);
  });
});

describe('rechecking claimants traced before the death fix', () => {
  const abe = {
    first: 'Juliet', last: 'Abe', age: 82, akas: [],
    addresses: [{ street: '256 Treu', city: 'Jacksonville', state: 'FL', zip: '32209', lastSeen: '2026-08-01' }],
    phones: [{ num: '9144233422', type: 'LandLine/Services', connected: true }],
    emails: [], deceased: true, dateOfDeath: '2021-03-22', relatives: [],
  };
  const traced = (over: any = {}) => ({ ...lead({ street: '256 TREU TER NW', first: 'JULIET R', last: 'ABE', ...over }), sellerPhone: '+19144233422' });

  it('a dry run counts one search per person and spends nothing', async () => {
    const endato = endatoStub([abe]);
    const { svc } = harness([traced({ id: 'a', detailId: 'da' }), traced({ id: 'b', detailId: 'db', first: 'JULIET', last: 'ABE' })], endato);

    const r = await svc.recheckDeaths({ organizationId: 'org', dryRun: true });

    expect(r).toMatchObject({ candidates: 2, searches: 1, searched: 0 });
    expect(endato.search).not.toHaveBeenCalled();
  });

  it('marks the dead, stamps everyone searched, and never writes a phone number', async () => {
    const endato = endatoStub([abe]);
    const { svc, leadUpdates, detailUpdates, attempts } = harness([traced()], endato);

    const r = await svc.recheckDeaths({ organizationId: 'org' });

    expect(r).toMatchObject({ searched: 1, verified: 1, deceased: 1, errors: 0 });
    expect(leadUpdates).toHaveLength(0);
    expect(detailUpdates.some((u) => u.data?.phone2 !== undefined)).toBe(false);
    expect(detailUpdates.find((u) => u.data?.deceased === true)?.data).toMatchObject({ deathSource: 'endato' });
    expect(detailUpdates.some((u) => u.where?.id?.in && u.data?.deathCheckedAt)).toBe(true);
    expect(attempts.at(-1)).toMatchObject({ source: 'endato', result: 'found' });
    expect(attempts.at(-1).summary).toMatch(/^Death check: Endato holds a death record/);
  });
});

describe('looking up a dead claimant\'s relatives', () => {
  const rel = (id: string, name: string, type: string, over: any = {}) => ({ id, name, type, deceased: false, city: null, state: null, dob: null, ...over });
  const abe = (relatives: any[]) => ({
    first: 'Juliet', last: 'Abe', age: 82, akas: [],
    addresses: [{ street: '256 Treu', city: 'Jacksonville', state: 'FL', zip: '32209', lastSeen: '2026-08-01' }],
    phones: [{ num: '9144233422', type: 'LandLine/Services', connected: true }],
    emails: [], deceased: true, dateOfDeath: '2021-03-22', relatives,
  });
  /** A relative as Endato's lookup by id returns them. */
  const found = (first: string, last: string, over: any = {}) => ({
    first, last, age: 55, akas: [],
    addresses: [{ street: '436 Wildwood', line: '436 Wildwood Ave', city: 'Verona', state: 'PA', zip: '15147', lastSeen: '2026-08-01' }],
    phones: [
      { num: '9049556600', type: 'Wireless', connected: true },
      { num: '9042688459', type: 'LandLine/Services', connected: true },
      { num: '9040000000', type: 'LandLine/Services', connected: false },
    ],
    emails: ['kin@example.com'], deceased: false, dateOfDeath: null, relatives: [], ...over,
  });

  it('looks up only the spouse and the likely children, within the cap, and never a minor', async () => {
    // Juliet Abe is 82 by Endato, born about 1944. Thomas, born 1970, is a
    // likely child; Ann, born 1946, a likely sibling: filed, never paid for.
    const endato = endatoStub(
      [abe([
        rel('R3', 'Ann B Holbrook', 'Family', { dob: '1946-02-01' }),
        rel('R2', 'Thomas Abe', 'Family', { dob: '1970-05-01' }),
        rel('R1', 'Mary Lee Abe', 'Spouse'),
        rel('R4', 'Kid Abe', 'Family', { dob: '2015-06-01' }),
      ])],
      { R1: found('Mary', 'Abe'), R2: null },
    );
    const { svc, heirs, attempts } = harness(
      [lead({ street: '256 TREU TER NW', first: 'JULIET R', last: 'ABE' })],
      endato,
      { SURPLUS_RELATIVE_LOOKUPS: '2' },
    );
    respond([]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    // A minor is not filed at all: nothing they can tell anybody, and a search spent on nothing.
    expect(heirs.map((h) => h.name).sort()).toEqual(['Ann B Holbrook', 'Mary Lee Abe', 'Thomas Abe']);
    expect(heirs.every((h) => h.role === 'relative' && h.vendorPersonId)).toBe(true);
    expect(Object.fromEntries(heirs.map((h) => [h.name, h.relationship]))).toEqual({
      'Ann B Holbrook': 'Likely sibling',
      'Thomas Abe': 'Likely child',
      'Mary Lee Abe': 'Spouse',
    });
    expect(endato.lookup.mock.calls.map((c: any[]) => c[0])).toEqual(['R1', 'R2']);
    expect(r.relatives).toEqual({ looked: 2, withContact: 1 });

    const mary = heirs.find((h) => h.name === 'Mary Lee Abe');
    expect(mary).toMatchObject({
      street: '436 Wildwood Ave', city: 'Verona', state: 'PA', zip: '15147',
      phone1: '9049556600', phone2: '9042688459', phone3: null, phone1Dnc: null,
      email1: 'kin@example.com', traceOutcome: 'matched',
    });
    expect(mary.traceDetail).toMatch(/^Looked up by Endato's id for Mary Lee Abe, so this is exactly that person\. Current address 436 Wildwood Ave, Verona PA 15147/);
    const thomas = heirs.find((h) => h.name === 'Thomas Abe');
    expect(thomas.traceOutcome).toBe('no_person');
    expect(thomas.traceDetail).toMatch(/opted out/);
    expect(heirs.find((h) => h.name === 'Ann B Holbrook').tracedAt).toBeNull();
    expect(attempts.filter((a) => a.heirId).map((a) => a.result)).toEqual(['found', 'nothing']);
  });

  it('marks a relative Endato holds a death record for as dead, with no numbers', async () => {
    const endato = endatoStub([abe([rel('R1', 'Mary Lee Abe', 'Spouse')])], {
      R1: found('Mary', 'Abe', { deceased: true, dateOfDeath: '2023-01-05' }),
    });
    const { svc, heirs } = harness([lead({ street: '256 TREU TER NW', first: 'JULIET R', last: 'ABE' })], endato);
    respond([]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(r.relatives).toEqual({ looked: 1, withContact: 0 });
    expect(heirs[0]).toMatchObject({ deceased: true, traceOutcome: 'no_contact' });
    expect(heirs[0].phone1).toBeUndefined();
    expect(heirs[0].dateOfDeath.toISOString().slice(0, 10)).toBe('2023-01-05');
  });

  it('SURPLUS_RELATIVE_LOOKUPS=0 files the relatives and looks nobody up', async () => {
    const endato = endatoStub([abe([rel('R1', 'Mary Lee Abe', 'Spouse')])], { R1: found('Mary', 'Abe') });
    const { svc, heirs } = harness([lead({ street: '256 TREU TER NW', first: 'JULIET R', last: 'ABE' })], endato, { SURPLUS_RELATIVE_LOOKUPS: '0' });
    respond([]);

    const r = await svc.traceLeads({ organizationId: 'org' });

    expect(heirs).toHaveLength(1);
    expect(endato.lookup).not.toHaveBeenCalled();
    expect(r.relatives).toEqual({ looked: 0, withContact: 0 });
  });

  describe('the backlog of claimants already found dead', () => {
    const dead = (heirRows: any[]) => ({
      ...lead({ street: '256 TREU TER NW', first: 'JULIET R', last: 'ABE' }),
      organizationId: 'org',
      surplusDetail: {
        ...lead({ street: '256 TREU TER NW' }).surplusDetail,
        deceased: true,
        deathSource: 'endato',
        heirs: heirRows,
      },
    });

    it('a dry run counts one search to recover the ids and the lookups after it', async () => {
      const endato = endatoStub([]);
      const filed = [
        { id: 'x1', name: 'Mary Lee Abe', role: 'relative', sourceKind: 'endato', vendorPersonId: null, tracedAt: null, deceased: false, doNotCall: false },
        { id: 'x2', name: 'Thomas Abe', role: 'relative', sourceKind: 'endato', vendorPersonId: null, tracedAt: null, deceased: false, doNotCall: false },
      ];
      const { svc } = harness([dead(filed)], endato);

      const r = await svc.relativeBacklog({ organizationId: 'org', dryRun: true });

      expect(r).toMatchObject({ deceasedClaimants: 1, recoverSearches: 1, lookups: 2, looked: 0 });
      expect(endato.search).not.toHaveBeenCalled();
    });

    it('recovers the ids onto the rows already there, then looks them up', async () => {
      const endato = endatoStub(
        [abe([rel('R1', 'Mary Lee Abe', 'Spouse'), rel('R2', 'Thomas Abe', 'Family', { dob: '1970-05-01' })])],
        { R1: found('Mary', 'Abe'), R2: found('Thomas', 'Abe') },
      );
      const { svc, heirs } = harness([], endato);
      // The two rows the 2026-09-14 backfill filed, by name only.
      for (const name of ['Mary Lee Abe', 'Thomas Abe']) {
        heirs.push({ id: `x${heirs.length + 1}`, surplusDetailId: 'd1', name, role: 'relative', sourceKind: 'endato', vendorPersonId: null, tracedAt: null, deceased: false, doNotCall: false, street: null });
      }
      (svc as any).prisma.lead.findMany.mockResolvedValue([dead(heirs)]);

      const r = await svc.relativeBacklog({ organizationId: 'org' });

      expect(r).toMatchObject({ recovered: 1, looked: 2, withContact: 2, errors: 0 });
      expect(heirs).toHaveLength(2);
      expect(heirs.map((h) => h.vendorPersonId)).toEqual(['R1', 'R2']);
      expect(heirs.every((h) => h.phone1)).toBe(true);
    });
  });
});

describe('estate claimants the county marked dead', () => {
  it('reads the person out of the docket\'s estate forms', () => {
    expect(estateName('ESTATE OF THERESA MCPARLIN, DECEASED')).toBe('THERESA MCPARLIN');
    expect(estateName('THE ESTATE OF JOHN DOE')).toBe('JOHN DOE');
    expect(estateName('JIMMY DON BERGER ESTATE')).toBe('JIMMY DON BERGER');
    expect(estateName('MCGRATH, HARRY A III EST')).toBe('HARRY A III MCGRATH');
    expect(estateName('VIVIAN A DOWNEY (DECEASED)')).toBe('VIVIAN A DOWNEY');
    expect(estateName('DANNIE LESTER STEWART')).toBe('DANNIE LESTER STEWART');
  });

  const rel = (id: string, name: string, type: string, over: any = {}) => ({ id, name, type, deceased: false, city: null, state: null, dob: null, ...over });
  const mcparlin = (over: any = {}) => ({
    first: 'Theresa', last: 'Mcparlin', age: 88, akas: [],
    addresses: [{ street: '256 Treu', city: 'Jacksonville', state: 'FL', zip: '32209', lastSeen: '2024-01-01' }],
    phones: [], emails: [], deceased: true, dateOfDeath: '2025-11-02',
    relatives: [rel('R1', 'Kevin Mcparlin', 'Family', { dob: '1966-01-01' })],
    ...over,
  });
  const estate = (over: any = {}) => {
    const l: any = lead({ street: '256 TREU TER NW', first: 'ESTATE OF THERESA', last: 'MCPARLIN, DECEASED', ...over });
    l.organizationId = 'org';
    l.surplusDetail = { ...l.surplusDetail, deceased: true, heirsRequired: true, claimStatus: 'open', heirs: over.heirs || [] };
    return l;
  };

  it('a dry run counts one search per estate and skips any with a living heir or Endato relatives', async () => {
    const endato = endatoStub([]);
    const { svc } = harness(
      [
        estate({ id: 'a', detailId: 'da' }),
        estate({ id: 'b', detailId: 'db', caseNumber: 'X2', heirs: [{ role: 'heir', deceased: false }] }),
        estate({ id: 'c', detailId: 'dc', caseNumber: 'X3', heirs: [{ role: 'relative', sourceKind: 'endato' }] }),
      ],
      endato,
    );

    const r = await svc.estateRelatives({ organizationId: 'org', dryRun: true });

    expect(r).toMatchObject({ candidates: 1, searches: 1, searched: 0 });
    expect(endato.search).not.toHaveBeenCalled();
  });

  it('on a verified match files the relatives, looks them up, and takes the date the docket lacked', async () => {
    const endato = endatoStub([mcparlin()], {
      R1: { first: 'Kevin', last: 'Mcparlin', age: 60, akas: [], addresses: [{ street: '9 Elm', line: '9 Elm St', city: 'Ocala', state: 'FL', zip: '34470', lastSeen: '2026-08-01' }], phones: [{ num: '3525550101', type: 'Wireless', connected: true }], emails: [], deceased: false, dateOfDeath: null, relatives: [] },
    });
    const { svc, heirs, detailUpdates } = harness([estate()], endato);

    const r = await svc.estateRelatives({ organizationId: 'org' });

    expect(endato.search).toHaveBeenCalledWith({ first: 'THERESA', last: 'MCPARLIN', city: 'JACKSONVILLE', state: 'FL' });
    expect(r).toMatchObject({ searched: 1, matched: 1, relativesFiled: 1, looked: 1, withContact: 1 });
    expect(heirs[0]).toMatchObject({ name: 'Kevin Mcparlin', relationship: 'Likely child', role: 'relative', vendorPersonId: 'R1', phone1: '3525550101', street: '9 Elm St' });
    const dated = detailUpdates.find((u) => u.data?.dateOfDeath)?.data;
    expect(dated.dateOfDeath.toISOString().slice(0, 10)).toBe('2025-11-02');
    expect(dated.deathSource).toBe('endato');
    expect(dated.callNotes).toMatch(/Estate search \(Endato\): matched THERESA MCPARLIN by address history\. Endato dates the death 2 November 2025\. 1 relative filed/);
    expect(detailUpdates.some((u) => u.where?.id?.in && u.data?.deathCheckedAt)).toBe(true);
  });

  it('files nothing on a namesake, and says so on the lead', async () => {
    const endato = endatoStub([mcparlin({ addresses: [{ street: '1 Other', city: 'Tampa', state: 'FL', zip: '33601', lastSeen: '2020-01-01' }] })]);
    const { svc, heirs, detailUpdates } = harness([estate()], endato);

    const r = await svc.estateRelatives({ organizationId: 'org' });

    expect(r).toMatchObject({ searched: 1, matched: 0, relativesFiled: 0 });
    expect(heirs).toHaveLength(0);
    expect(detailUpdates.at(-1).data.callNotes).toMatch(/^Estate search \(Endato\): 1 person named THERESA MCPARLIN, none with the property/);
  });
});

describe('the criteria for a paid lookup', () => {
  const day = 86400000;
  const ago = (days: number) => new Date(Date.now() - days * day);

  it('refuses a competing claim on file, a notice over a year old, and a dead claimant, and says why', async () => {
    const make = (id: string, over: any) => {
      const l: any = lead({ id, detailId: `d${id}`, caseNumber: `C${id}`, street: `${id}00 MAIN ST`, first: 'JANE', last: `DOE${id}` });
      Object.assign(l.surplusDetail, over);
      return l;
    };
    const { svc } = harness([
      make('1', { claimStatus: 'pending', noticeDate: ago(30) }),
      make('2', { claimStatus: 'open', noticeDate: ago(400) }),
      make('3', { claimStatus: 'open', saleDate: ago(500) }),
      make('4', { claimStatus: 'open', noticeDate: ago(30), deceased: true }),
      make('5', { claimStatus: 'assigned' }),
    ]);
    respond([]);

    const r = await svc.traceLeads({ organizationId: 'org', nameSearch: false });

    expect(r.candidates).toBe(0);
    expect(r.skipped).toMatchObject({ claim_on_file: 1, over_a_year: 2, estate: 1, closed: 1 });
    expect(r.message).toMatch(/^Not traced: somebody else has a claim on file/);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('still traces a denied claim, a government-lien-only case, and one with no date yet', async () => {
    const make = (id: string, over: any) => {
      const l: any = lead({ id, detailId: `d${id}`, caseNumber: `C${id}`, street: `${id}00 MAIN ST`, first: 'JANE', last: `DOE${id}` });
      Object.assign(l.surplusDetail, over);
      return l;
    };
    const { svc } = harness([
      make('1', { claimStatus: 'denied', noticeDate: ago(200) }),
      make('2', { claimStatus: 'gov_lien', noticeDate: ago(364) }),
      make('3', { claimStatus: 'open' }),
    ]);
    respond([]);

    const r = await svc.traceLeads({ organizationId: 'org', nameSearch: false });

    expect(r.candidates).toBe(3);
    expect(r.skipped.claim_on_file).toBeUndefined();
    expect(r.skipped.over_a_year).toBeUndefined();
  });

  it('SURPLUS_TRACE_MAX_AGE_DAYS moves the line', async () => {
    const l: any = lead({ street: '100 MAIN ST' });
    Object.assign(l.surplusDetail, { claimStatus: 'open', noticeDate: ago(200) });
    const { svc } = harness([l], null, { SURPLUS_TRACE_MAX_AGE_DAYS: '180' });
    respond([]);

    const r = await svc.traceLeads({ organizationId: 'org', nameSearch: false });

    expect(r.skipped.over_a_year).toBe(1);
  });

  it('the heir trace refuses a claim that no longer meets the criteria', async () => {
    // Heirs of an estate are exactly who works it, so only the claim's own
    // state and age are checked.
    const heirs = [
      {
        id: 'h1', name: 'Kevin Mcparlin', street: '9 ELM ST', city: 'OCALA', state: 'FL', zip: '34470', deceased: false, doNotCall: false,
        surplusDetail: { caseNumber: 'C1', claimStatus: 'open', noticeDate: ago(500), saleDate: null, lead: {} },
      },
    ];
    const { svc, prisma } = harness([]);
    prisma.surplusHeir.findMany = jest.fn().mockResolvedValue(heirs);

    const r = await svc.traceHeirs({ organizationId: 'org' });

    expect(r.skipped.over_a_year).toBe(1);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

describe('looking up the survivors an obituary named', () => {
  const kin = (id: string, name: string, relationship: string, city: string, state: string) => ({
    id, surplusDetailId: 'd1', name, relationship, city, state, role: 'relative', sourceKind: 'obituary',
    tracedAt: null, deceased: false, doNotCall: false, street: null,
  });
  const endatoPerson = (first: string, last: string, over: any = {}) => ({
    first, last, age: 60, akas: [], addresses: [], phones: [{ num: '7405550101', type: 'Wireless', connected: true }],
    emails: [], deceased: false, dateOfDeath: null, relatives: [], ...over,
  });

  it('takes a namesake only when Endato lists the claimant among their relatives', async () => {
    const endato = endatoStub([
      endatoPerson('Scott', 'Beaver', { relatives: [{ id: null, name: 'Tom Beaver', type: 'Family', deceased: false, city: null, state: null, dob: null }] }),
      endatoPerson('Scott', 'Beaver', { phones: [{ num: '7405550199', type: 'Wireless', connected: true }], relatives: [{ id: null, name: 'Dewey Raymond Beaver', type: 'Family', deceased: true, city: null, state: null, dob: null }] }),
    ]);
    const { svc, heirs } = harness([], endato);
    heirs.push(kin('h1', 'Scott Beaver', 'Son', 'Lancaster', 'OH'));

    const r = await svc.lookupSurvivors('d1', 'DEWEY R BEAVER', { property: null, mailing: null });

    expect(endato.search).toHaveBeenCalledWith({ first: 'SCOTT', last: 'BEAVER', city: 'Lancaster', state: 'OH' });
    expect(r).toEqual({ looked: 1, withContact: 1 });
    expect(heirs[0]).toMatchObject({ phone1: '7405550199', traceOutcome: 'matched' });
    expect(heirs[0].traceDetail).toMatch(/^Found by name search and tied to DEWEY R BEAVER/);
  });

  it('refuses every namesake with no tie, and says so', async () => {
    const endato = endatoStub([endatoPerson('Scott', 'Beaver')]);
    const { svc, heirs } = harness([], endato);
    heirs.push(kin('h1', 'Scott Beaver', 'Son', 'Lancaster', 'OH'));

    const r = await svc.lookupSurvivors('d1', 'DEWEY R BEAVER', { property: null, mailing: null });

    expect(r).toEqual({ looked: 1, withContact: 0 });
    expect(heirs[0].phone1).toBeUndefined();
    expect(heirs[0]).toMatchObject({ traceOutcome: 'no_person' });
  });
});
