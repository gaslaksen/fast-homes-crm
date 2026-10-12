import { CampaignEnrollmentService } from './campaign-enrollment.service';
import { CampaignExecutionService } from './campaign-execution.service';
import { campaignEmailFor, knownEmails } from './campaign-recipient';
import { PrismaService } from '../prisma/prisma.service';

const CLAIMANT = 'james@example.com';
const DAUGHTER = 'laura@example.com';

describe('knownEmails', () => {
  it('lists the primary first, then the detail row, without repeats or blanks', () => {
    expect(
      knownEmails({ sellerEmail: CLAIMANT, surplusDetail: { email2: DAUGHTER }, probateDetail: { email2: ' ' } }),
    ).toEqual([CLAIMANT, DAUGHTER]);
    expect(knownEmails({ sellerEmail: CLAIMANT, surplusDetail: { email2: CLAIMANT.toUpperCase() } })).toEqual([CLAIMANT]);
    expect(knownEmails(null)).toEqual([]);
  });
});

describe('campaignEmailFor', () => {
  it('uses the chosen address while it is on the lead', () => {
    expect(campaignEmailFor(DAUGHTER, [CLAIMANT, DAUGHTER])).toBe(DAUGHTER);
    expect(campaignEmailFor(DAUGHTER.toUpperCase(), [CLAIMANT, DAUGHTER])).toBe(DAUGHTER);
  });

  it('falls back to the first email once the chosen one is removed from the lead', () => {
    expect(campaignEmailFor(DAUGHTER, [CLAIMANT])).toBe(CLAIMANT);
  });

  it('uses the first email when nothing was chosen, and nothing when there is none', () => {
    expect(campaignEmailFor(null, [CLAIMANT, DAUGHTER])).toBe(CLAIMANT);
    expect(campaignEmailFor(DAUGHTER, [])).toBeNull();
  });
});

const EMAIL_CAMPAIGN = {
  id: 'camp-email',
  name: 'Surplus Email',
  steps: [{ stepOrder: 1, channel: 'EMAIL', delayDays: 0, delayHours: 0 }],
};

function enrollStub(existing: any = null) {
  const created: any[] = [];
  const updated: any[] = [];
  const prisma = {
    campaign: { findUnique: jest.fn(async () => EMAIL_CAMPAIGN) },
    lead: {
      findUnique: jest.fn(async () => ({
        id: 'lead-1',
        sellerPhone: '',
        doNotContact: false,
        sellerEmail: CLAIMANT,
        surplusDetail: { email2: DAUGHTER },
      })),
    },
    campaignEnrollment: {
      findUnique: jest.fn(async () => existing),
      create: jest.fn(async ({ data }: any) => { created.push(data); return data; }),
      update: jest.fn(async ({ data }: any) => { updated.push(data); return { ...existing, ...data }; }),
    },
    activity: { create: jest.fn(async () => ({})) },
  } as unknown as PrismaService;
  return { service: new CampaignEnrollmentService(prisma, {} as any), created, updated };
}

describe('enrolling with a chosen email', () => {
  it('stores the chosen address on a new enrollment', async () => {
    const { service, created } = enrollStub();
    await service.enrollLead('lead-1', 'camp-email', { toEmail: DAUGHTER });
    expect(created[0].toEmail).toBe(DAUGHTER);
  });

  it('refuses an address that is not on the lead', async () => {
    const { service, created } = enrollStub();
    await expect(
      service.enrollLead('lead-1', 'camp-email', { toEmail: 'someone@else.com' }),
    ).rejects.toThrow(/not one of this lead's email addresses/);
    expect(created).toHaveLength(0);
  });

  it('changes the recipient of an active enrollment without restarting it', async () => {
    const { service, updated } = enrollStub({ id: 'enr-1', status: 'ACTIVE', toEmail: null, currentStepOrder: 3 });
    await service.enrollLead('lead-1', 'camp-email', { toEmail: DAUGHTER });
    expect(updated).toEqual([{ toEmail: DAUGHTER }]);
  });

  it('leaves an active enrollment alone when no address is given', async () => {
    const { service, updated } = enrollStub({ id: 'enr-1', status: 'ACTIVE', toEmail: DAUGHTER });
    await service.enrollLead('lead-1', 'camp-email');
    expect(updated).toHaveLength(0);
  });
});

describe('sending to the chosen email', () => {
  function sendStub(leadEmails: any) {
    const sent: any[] = [];
    const prisma = {
      lead: { findUnique: jest.fn(async () => leadEmails) },
      email: { count: jest.fn(async () => 0), findFirst: jest.fn(async () => null) },
    } as unknown as PrismaService;
    const mailer = {
      buildUnsubscribeUrl: () => 'https://unsub',
      sendAsDeals: jest.fn(async (o: any) => { sent.push(o); return { mailgunId: 'mg-1' }; }),
    };
    const leads = { recordTouch: jest.fn(async () => ({})) };
    const svc = new CampaignExecutionService(
      prisma, { get: () => undefined } as any, {} as any, leads as any, mailer as any,
    );
    return { svc, sent };
  }
  const dispatch = (svc: any, toEmail: string | null) =>
    svc.dispatch(
      { id: 'enr-1', toEmail, campaign: {} },
      { id: 'lead-1', organizationId: 'org-1', source: 'SURPLUS', sellerEmail: CLAIMANT },
      { channel: 'EMAIL' },
      'Hello',
      'Subject',
    );

  it('emails the address picked at enrollment', async () => {
    const { svc, sent } = sendStub({ sellerEmail: CLAIMANT, surplusDetail: { email2: DAUGHTER } });
    const out = await dispatch(svc, DAUGHTER);
    expect(out.kind).toBe('SENT');
    expect(sent[0].to).toBe(DAUGHTER);
  });

  it('never emails an address that has since been removed from the lead', async () => {
    const { svc, sent } = sendStub({ sellerEmail: DAUGHTER, surplusDetail: { email2: null } });
    await dispatch(svc, CLAIMANT);
    expect(sent[0].to).toBe(DAUGHTER);
  });
});
