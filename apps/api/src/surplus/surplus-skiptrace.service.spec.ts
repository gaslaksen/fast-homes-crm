import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SurplusSkiptraceService } from './surplus-skiptrace.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * The behaviours worth pinning are the ones that cost money or attach a wrong
 * number to a real person, so the vendor is stubbed and the database is a spy.
 */
function harness(leads: any[]) {
  const leadUpdates: any[] = [];
  const detailUpdates: any[] = [];
  const prisma: any = {
    lead: {
      findMany: jest.fn().mockResolvedValue(leads),
      update: jest.fn(async (a: any) => { leadUpdates.push(a); return {}; }),
    },
    surplusDetail: {
      findUnique: jest.fn().mockResolvedValue({ callNotes: null }),
      update: jest.fn(async (a: any) => { detailUpdates.push(a); return {}; }),
    },
  };
  const config = { get: (k: string) => (k === 'BATCHDATA_API_KEY' ? 'test-key' : undefined) };
  const svc = new SurplusSkiptraceService(prisma, config as unknown as ConfigService);
  return { svc, prisma, leadUpdates, detailUpdates };
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

  it('refuses the property fallback when the clerk\'s mail to it bounced', async () => {
    // Direct evidence the owner was gone before we started looking. Six of six
    // such submissions came back strangers on the first live run.
    const { svc } = harness([
      lead({
        street: '2817 EAVERSON ST',
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
    const { svc, detailUpdates } = harness([
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
    // Returned clerk mail means no address we hold is live. We decline to spend
    // the credit, and that decision is a fact about the claimant too.
    const { svc, detailUpdates } = harness([
      lead({ detailId: 'd7', mailVerdict: 'undeliverable', mailStreet: '72 SMITH DRIVE', mailCity: 'HARTFORD', mailState: 'CT', mailZip: '06118' }),
    ]);

    await svc.traceLeads({ organizationId: 'org' });

    expect(mockedAxios.post).not.toHaveBeenCalled();
    const u = detailUpdates.find((x) => x.where.id === 'd7');
    expect(u.data.traceOutcome).toBe('skipped');
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
    const prisma: any = {
      surplusHeir: {
        findMany: jest.fn().mockResolvedValue(heirs),
        findUnique: jest.fn().mockResolvedValue({ callNotes: null }),
        update: jest.fn(async (a: any) => { updates.push(a); return {}; }),
      },
    };
    const config = { get: (k: string) => (k === 'BATCHDATA_API_KEY' ? 'test-key' : undefined) };
    const svc = new SurplusSkiptraceService(prisma, config as unknown as ConfigService);
    return { svc, updates };
  }

  const heir = (over: any = {}) => ({
    id: over.id || 'h1',
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
    const { svc, updates } = heirHarness([heir()]);
    respond([person('Alfred', 'Spencer', ['9045551234'])]);

    const r = await svc.traceHeirs({ organizationId: 'org' });

    expect(r.contacted).toBe(1);
    expect(updates[0].data.phone1).toBe('9045551234');
    expect(updates[0].data.traceOutcome).toBe('matched');
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
