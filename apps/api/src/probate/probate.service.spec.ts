import { ProbateService } from './probate.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProbateLeadInput } from './probate.types';

/**
 * Prisma stub that records what would be written and answers the two lookups
 * createProbateLead makes: the dedupe check and the primary-contact count.
 */
function stubPrisma(opts: { existing?: any; priorPrimaries?: number } = {}) {
  const created: any[] = [];
  const prisma = {
    probateDetail: {
      findFirst: jest.fn(async () => opts.existing ?? null),
      count: jest.fn(async () => opts.priorPrimaries ?? 0),
    },
    lead: {
      create: jest.fn(async ({ data }: any) => {
        created.push(data);
        return { id: `lead-${created.length}` };
      }),
    },
  } as unknown as PrismaService;
  return { prisma, created };
}

const BASE: ProbateLeadInput = {
  address: '7316 S Providence Rd',
  city: 'Waxhaw',
  zip: '28173',
  heirFirstName: 'Cindy',
  heirLastName: 'Starnes Hildreth',
  heirCity: 'Monroe',
  phone1: '(704) 651-4821',
  phone1Type: 'Mobile',
  phone2: '(919) 758-2440',
  email: 'childbirth58@gmail.com',
  email2: 'clhildreth@windstream.net',
  caseNumber: '26E000342-890',
  caseFiledDate: '2026-03-24',
  deceasedName: 'Albert Joseph Starnes',
  monthsSinceDeath: 4.5,
  consensusRank: 1,
  consensusTier: 'Tier 1 - Attack First',
  absenteeHeir: true,
};

describe('ProbateService.createProbateLead', () => {
  it('holds all AI messaging: no initial outreach, no auto-response', async () => {
    const { prisma, created } = stubPrisma();
    await new ProbateService(prisma).createProbateLead(BASE, { organizationId: 'org-1' });

    expect(created[0].autoRespond).toBe(false);
    expect(created[0].doNotContact).toBe(false);
    expect(created[0].status).toBe('NEW');
    expect(created[0].source).toBe('PROBATE');
  });

  it('puts the heir, not the decedent, in the seller fields', async () => {
    const { prisma, created } = stubPrisma();
    await new ProbateService(prisma).createProbateLead(BASE, { organizationId: 'org-1' });

    expect(created[0].sellerFirstName).toBe('Cindy');
    expect(created[0].sellerLastName).toBe('Starnes Hildreth');
    expect(created[0].sellerPhone).toBe('+17046514821');
    expect(created[0].probateDetail.create.deceasedName).toBe('Albert Joseph Starnes');
  });

  it('derives state and county from the city', async () => {
    const { prisma, created } = stubPrisma();
    await new ProbateService(prisma).createProbateLead(BASE, { organizationId: 'org-1' });

    expect(created[0].propertyState).toBe('NC');
    expect(created[0].probateDetail.create.county).toBe('Union');
  });

  it('trusts the list\'s absentee flag over a city comparison', async () => {
    const { prisma, created } = stubPrisma();
    // Heir lives in the same city as the property, but the list compared full
    // addresses and still called it absentee.
    await new ProbateService(prisma).createProbateLead(
      { ...BASE, city: 'Charlotte', heirCity: 'Charlotte', absenteeHeir: true },
      { organizationId: 'org-1' },
    );
    expect(created[0].probateDetail.create.absenteeHeir).toBe(true);
  });

  it('falls back to the city comparison only when there is no flag', async () => {
    const { prisma, created } = stubPrisma();
    await new ProbateService(prisma).createProbateLead(
      { ...BASE, absenteeHeir: null },
      { organizationId: 'org-1' },
    );
    expect(created[0].probateDetail.create.absenteeHeir).toBe(true);

    const second = stubPrisma();
    await new ProbateService(second.prisma).createProbateLead(
      { ...BASE, city: 'Waxhaw', heirCity: 'Waxhaw', absenteeHeir: null },
      { organizationId: 'org-1' },
    );
    expect(second.created[0].probateDetail.create.absenteeHeir).toBe(false);
  });

  it('marks the first lead on a contact primary and the rest not', async () => {
    const first = stubPrisma({ priorPrimaries: 0 });
    const firstRes = await new ProbateService(first.prisma).createProbateLead(BASE, {
      organizationId: 'org-1',
    });
    expect(firstRes.primaryContact).toBe(true);
    expect(first.created[0].probateDetail.create.primaryContact).toBe(true);
    expect(first.created[0].probateDetail.create.contactKey).toBe('p:7046514821');

    // Second property on the same estate, same heir, same phone.
    const second = stubPrisma({ priorPrimaries: 1 });
    const secondRes = await new ProbateService(second.prisma).createProbateLead(
      { ...BASE, address: '4115 Dunwoody Dr' },
      { organizationId: 'org-1' },
    );
    expect(secondRes.created).toBe(true);
    expect(secondRes.primaryContact).toBe(false);
    expect(second.created[0].probateDetail.create.primaryContact).toBe(false);
  });

  it('is idempotent on case + address', async () => {
    const { prisma, created } = stubPrisma({
      existing: { leadId: 'lead-existing', primaryContact: true },
    });
    const res = await new ProbateService(prisma).createProbateLead(BASE, {
      organizationId: 'org-1',
    });

    expect(res).toEqual({
      leadId: 'lead-existing',
      created: false,
      primaryContact: true,
      reason: 'duplicate',
    });
    expect(created).toHaveLength(0);
  });

  it('refuses a row with no address or no usable phone', async () => {
    const { prisma, created } = stubPrisma();
    const service = new ProbateService(prisma);

    expect(await service.createProbateLead({ ...BASE, address: '' }, {})).toMatchObject({
      created: false,
      reason: 'no property address',
    });
    expect(await service.createProbateLead({ ...BASE, phone1: '704-651' }, {})).toMatchObject({
      created: false,
      reason: 'no usable phone',
    });
    expect(created).toHaveLength(0);
  });
});
