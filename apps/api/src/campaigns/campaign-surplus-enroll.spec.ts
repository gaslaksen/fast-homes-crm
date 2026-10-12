import { CampaignEnrollmentService } from './campaign-enrollment.service';
import { PrismaService } from '../prisma/prisma.service';

const EMAIL_CAMPAIGN = {
  id: 'camp-email',
  name: 'Surplus Email Drip',
  steps: [{ stepOrder: 1, channel: 'EMAIL', delayDays: 0, delayHours: 0 }],
};

function stub(lead: any) {
  const created: any[] = [];
  const prisma = {
    campaign: {
      findUnique: jest.fn(async () => EMAIL_CAMPAIGN),
      findMany: jest.fn(async () => [EMAIL_CAMPAIGN]),
    },
    lead: { findUnique: jest.fn(async () => lead) },
    campaignEnrollment: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => { created.push(data); return { id: 'enr-1', ...data }; }),
    },
    activity: { create: jest.fn(async () => ({})) },
  } as unknown as PrismaService;
  return { service: new CampaignEnrollmentService(prisma, {} as any), created };
}

const claimant = (over: any = {}) => ({
  id: 'lead-1',
  source: 'SURPLUS',
  sellerEmail: 'miles@example.com',
  sellerPhone: '',
  doNotContact: false,
  ...over,
});

describe('surplus claimants and drip campaigns', () => {
  it('enrolls a surplus claimant a person adds to an email campaign', async () => {
    const { service, created } = stub(claimant());
    await service.enrollLead('lead-1', 'camp-email');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ leadId: 'lead-1', campaignId: 'camp-email', status: 'ACTIVE' });
  });

  it('still refuses a claimant with no email for an email campaign', async () => {
    const { service, created } = stub(claimant({ sellerEmail: null }));
    await expect(service.enrollLead('lead-1', 'camp-email')).rejects.toThrow(/no email/i);
    expect(created).toHaveLength(0);
  });

  it('never auto-enrolls a surplus claimant in the default campaigns', async () => {
    const { service, created } = stub(claimant());
    await service.autoEnrollInDefaults('lead-1');
    expect(created).toHaveLength(0);
  });

  it('still auto-enrolls a seller lead in the default campaigns', async () => {
    const { service, created } = stub(claimant({ source: 'MANUAL' }));
    await service.autoEnrollInDefaults('lead-1');
    expect(created).toHaveLength(1);
  });
});
