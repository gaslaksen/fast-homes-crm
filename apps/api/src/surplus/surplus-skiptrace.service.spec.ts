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

const person = (first: string, last: string, phones: string[] = ['9045551234']) => ({
  meta: { matched: true },
  name: { first, last },
  phoneNumbers: phones.map((n) => ({ number: n, type: 'Mobile' })),
  emails: [],
});

function respond(persons: any[]) {
  mockedAxios.post.mockResolvedValue({ data: { results: { persons } } } as any);
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
    const body: any = (mockedAxios.post as jest.Mock).mock.calls[0][1];
    expect(body.requests[0].propertyAddress).toEqual({
      street: '72 SMITH DRIVE', city: 'HARTFORD', state: 'CT', zip: '06118',
    });
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
