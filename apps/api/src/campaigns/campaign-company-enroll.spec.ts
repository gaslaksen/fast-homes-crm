import { CampaignEnrollmentService } from './campaign-enrollment.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A campaign that belongs to a company only takes that company's leads. The
 * lead's company comes from which company runs its pipeline (brand_modules).
 */
const QCHB = { legalName: 'Quick Cash Home Buyers', shortName: null };
const DIG = { legalName: 'D.I.G. Deeper LLC', shortName: 'D.I.G. Deeper' };

// org1: surplus funds is D.I.G. Deeper, everything else Quick Cash.
const RUNS: Record<string, { brandId: string; brand: typeof QCHB }> = {
  SURPLUS_FUNDS: { brandId: 'brand_digdeeper_org1', brand: DIG },
  PROPERTY_LEADS: { brandId: 'brand_qchb_org1', brand: QCHB },
  PROBATE: { brandId: 'brand_qchb_org1', brand: QCHB },
};

function stub(campaign: { brandId: string | null; brand?: any; name?: string }, lead: any) {
  const created: any[] = [];
  const full = {
    id: 'camp-1',
    name: campaign.name ?? 'SMS',
    steps: [{ stepOrder: 1, channel: 'TEXT', delayDays: 0, delayHours: 0 }],
    ...campaign,
  };
  const prisma = {
    campaign: {
      findUnique: jest.fn(async () => full),
      findMany: jest.fn(async () => [full]),
    },
    lead: { findUnique: jest.fn(async () => lead) },
    brandModule: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where.organizationId_module;
        return k.organizationId === 'org1' ? RUNS[k.module] ?? null : null;
      }),
    },
    campaignEnrollment: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        created.push(data);
        return { id: 'enr-1', ...data };
      }),
    },
    activity: { create: jest.fn(async () => ({})) },
  } as unknown as PrismaService;
  return { service: new CampaignEnrollmentService(prisma, {} as any), created, prisma: prisma as any };
}

const lead = (over: any = {}) => ({
  id: 'lead-1',
  source: 'SURPLUS',
  organizationId: 'org1',
  sellerPhone: '+19045551234',
  sellerEmail: null,
  doNotContact: false,
  ...over,
});

describe('campaign company on enrollment', () => {
  it('refuses a surplus claimant on a Quick Cash campaign, in plain words', async () => {
    const { service, created } = stub({ brandId: 'brand_qchb_org1', brand: QCHB, name: 'SMS' }, lead());
    await expect(service.enrollLead('lead-1', 'camp-1')).rejects.toThrow(
      'This is a D.I.G. Deeper lead, and "SMS" is a Quick Cash Home Buyers campaign.',
    );
    expect(created).toHaveLength(0);
  });

  it('refuses a property lead on a D.I.G. Deeper campaign', async () => {
    const { service, created } = stub(
      { brandId: 'brand_digdeeper_org1', brand: DIG, name: 'Surplus Text' },
      lead({ source: 'PROPERTY_LEADS' }),
    );
    await expect(service.enrollLead('lead-1', 'camp-1')).rejects.toThrow(/Quick Cash Home Buyers lead/);
    expect(created).toHaveLength(0);
  });

  it("enrolls a lead on its own company's campaign", async () => {
    const { service, created } = stub({ brandId: 'brand_qchb_org1', brand: QCHB }, lead({ source: 'PROBATE' }));
    await service.enrollLead('lead-1', 'camp-1');
    expect(created).toHaveLength(1);
  });

  it('does not check a campaign with no company', async () => {
    const { service, created, prisma } = stub({ brandId: null }, lead());
    await service.enrollLead('lead-1', 'camp-1');
    expect(created).toHaveLength(1);
    expect(prisma.brandModule.findUnique).not.toHaveBeenCalled();
  });

  it('does not block an account that has no companies set up', async () => {
    const { service, created } = stub({ brandId: 'brand_qchb_org2', brand: QCHB }, lead({ organizationId: 'org2' }));
    await service.enrollLead('lead-1', 'camp-1');
    expect(created).toHaveLength(1);
  });

  it('lists a mismatch as a skip in a bulk enroll instead of failing the batch', async () => {
    const { service } = stub({ brandId: 'brand_qchb_org1', brand: QCHB, name: 'SMS' }, lead());
    const out = await service.enrollLeads(['lead-1'], 'camp-1');
    expect(out.enrolled).toBe(0);
    expect(out.skipped[0].reason).toMatch(/D\.I\.G\. Deeper lead/);
  });
});
