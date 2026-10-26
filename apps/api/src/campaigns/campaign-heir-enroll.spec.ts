import { CampaignEnrollmentService } from './campaign-enrollment.service';
import { CampaignExecutionService } from './campaign-execution.service';
import { heirTextNumber } from './campaign-recipient';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A person on a surplus case (a son, a neighbor, an heir) on a drip campaign
 * of their own: their number, their email, their name in the greeting, and
 * the claimant left exactly as they were.
 */

const TEXT_CAMPAIGN = {
  id: 'camp-text',
  name: 'Surplus Relatives',
  steps: [{ stepOrder: 1, channel: 'TEXT', delayDays: 0, delayHours: 0 }],
};
const EMAIL_CAMPAIGN = {
  id: 'camp-email',
  name: 'Surplus Email',
  steps: [{ stepOrder: 1, channel: 'EMAIL', delayDays: 0, delayHours: 0 }],
};

const son = (over: any = {}) => ({
  id: 'heir-1',
  name: 'Ricardo Berrios',
  deceased: false,
  doNotCall: false,
  phone1: '2036684030',
  phone1Dnc: null,
  email1: 'ricardo@example.com',
  email2: null,
  surplusDetail: { leadId: 'lead-1' },
  ...over,
});

function enrollStub({ campaign = TEXT_CAMPAIGN, heir = son(), existing = null as any } = {}) {
  const created: any[] = [];
  const lookups: any[] = [];
  const prisma = {
    campaign: { findUnique: jest.fn(async () => campaign) },
    lead: {
      findUnique: jest.fn(async () => ({
        id: 'lead-1',
        // The claimant has no number at all: the son's is the only route.
        sellerPhone: '',
        doNotContact: false,
        sellerEmail: 'teodoro@example.com',
      })),
    },
    surplusHeir: { findUnique: jest.fn(async () => heir) },
    campaignEnrollment: {
      findUnique: jest.fn(async (q: any) => { lookups.push(q.where); return existing; }),
      create: jest.fn(async ({ data }: any) => { created.push(data); return data; }),
    },
    activity: { create: jest.fn(async () => ({})) },
  } as unknown as PrismaService;
  return { service: new CampaignEnrollmentService(prisma, {} as any), created, lookups, prisma };
}

describe('enrolling a person on the case', () => {
  it('enrolls the son on his own number when the claimant has none', async () => {
    const { service, created, lookups } = enrollStub();
    await service.enrollLead('lead-1', 'camp-text', { heirId: 'heir-1' });
    expect(created[0]).toMatchObject({ leadId: 'lead-1', heirId: 'heir-1', recipientKey: 'heir-1' });
    // Looked up as his own enrollment, not the claimant's.
    expect(lookups[0].campaignId_leadId_recipientKey.recipientKey).toBe('heir-1');
  });

  it('keeps the claimant on the empty recipient key', async () => {
    const { service, created } = enrollStub({ campaign: EMAIL_CAMPAIGN });
    await service.enrollLead('lead-1', 'camp-email');
    expect(created[0]).toMatchObject({ heirId: null, recipientKey: '' });
  });

  it('refuses a person who belongs to another case', async () => {
    const { service, created } = enrollStub({ heir: son({ surplusDetail: { leadId: 'lead-2' } }) });
    await expect(service.enrollLead('lead-1', 'camp-text', { heirId: 'heir-1' })).rejects.toThrow(/not on this case/);
    expect(created).toHaveLength(0);
  });

  it('refuses a person marked deceased or do not call', async () => {
    for (const heir of [son({ deceased: true }), son({ doNotCall: true })]) {
      const { service, created } = enrollStub({ heir });
      await expect(service.enrollLead('lead-1', 'camp-text', { heirId: 'heir-1' })).rejects.toThrow(/cannot be enrolled/);
      expect(created).toHaveLength(0);
    }
  });

  it('refuses a text campaign when every number the person has is flagged', async () => {
    const { service } = enrollStub({ heir: son({ phone1Dnc: 'federal' }) });
    await expect(service.enrollLead('lead-1', 'camp-text', { heirId: 'heir-1' })).rejects.toThrow(/clear to text/);
  });

  it("only takes one of the person's own emails, never the claimant's", async () => {
    const { service } = enrollStub({ campaign: EMAIL_CAMPAIGN });
    await expect(
      service.enrollLead('lead-1', 'camp-email', { heirId: 'heir-1', toEmail: 'teodoro@example.com' }),
    ).rejects.toThrow(/Ricardo Berrios's email addresses/);
  });
});

describe('heirTextNumber', () => {
  it('skips a flagged number for the next clean one', () => {
    expect(heirTextNumber({ id: 'h', name: 'R', phone1: '1', phone1Dnc: 'federal', phone2: '2' })).toBe('2');
    expect(heirTextNumber({ id: 'h', name: 'R', phone1: '1', phone1Dnc: 'litigator' })).toBeNull();
  });
});

describe('sending to a person on the case', () => {
  function sendStub(heir: any) {
    const texts: any[] = [];
    const emails: any[] = [];
    const prisma = {
      surplusHeir: { findUnique: jest.fn(async () => heir) },
      lead: { findUnique: jest.fn(async () => ({ sellerEmail: 'teodoro@example.com' })) },
      email: { count: jest.fn(async () => 0), findFirst: jest.fn(async () => null) },
    } as unknown as PrismaService;
    const messages = {
      sendMessage: jest.fn(async (...args: any[]) => { texts.push(args); return { id: 'm-1' }; }),
    };
    const mailer = {
      buildUnsubscribeUrl: jest.fn(() => 'https://unsub'),
      sendAsDeals: jest.fn(async (o: any) => { emails.push(o); return { mailgunId: 'mg-1' }; }),
    };
    const leads = { recordTouch: jest.fn(async () => ({})) };
    const svc = new CampaignExecutionService(
      prisma, { get: () => undefined } as any, messages as any, leads as any, mailer as any,
    );
    return { svc, texts, emails, mailer };
  }
  const lead = { id: 'lead-1', organizationId: 'org-1', source: 'SURPLUS', sellerPhone: '+19045550000', doNotContact: false };
  const dispatch = (svc: any, channel: string, toEmail: string | null = null) =>
    svc.dispatch({ id: 'enr-1', heirId: 'heir-1', toEmail, campaign: {} }, lead, { channel }, 'Hello', 'Subject');

  it("texts the son's number, not the claimant's", async () => {
    const { svc, texts } = sendStub(son());
    const out = await dispatch(svc, 'TEXT');
    expect(out.kind).toBe('SENT');
    expect(texts[0][0]).toBe('lead-1');
    expect(texts[0][4]).toBe('2036684030');
  });

  it("emails the son's address with an unsubscribe link that names him", async () => {
    const { svc, emails, mailer } = sendStub(son());
    await dispatch(svc, 'EMAIL');
    expect(emails[0].to).toBe('ricardo@example.com');
    expect(mailer.buildUnsubscribeUrl).toHaveBeenCalledWith('lead-1', 'heir-1');
  });

  it('skips a person marked do not call since enrollment', async () => {
    const { svc, texts } = sendStub(son({ doNotCall: true }));
    const out = await dispatch(svc, 'TEXT');
    expect(out.kind).toBe('SKIPPED');
    expect(texts).toHaveLength(0);
  });

  it("greets the person by their own name and can still name the claimant", () => {
    const { svc } = sendStub(son());
    const out = svc.renderTemplate(
      'Hi {{firstName}}, we are trying to reach {{claimantName}}.',
      { sellerFirstName: 'Teodoro', sellerLastName: 'R Berrios', source: 'SURPLUS' },
      null,
      { name: 'Ricardo Berrios' },
    );
    expect(out).toBe('Hi Ricardo, we are trying to reach Teodoro R Berrios.');
  });

  it('greets the claimant as before when the enrollment is theirs', () => {
    const { svc } = sendStub(null);
    const out = svc.renderTemplate('Hi {{firstName}}', { sellerFirstName: 'Teodoro', source: 'SURPLUS' });
    expect(out).toBe('Hi Teodoro');
  });
});

describe('unsubscribe tokens', () => {
  const mailer = Object.create(MailerService.prototype) as MailerService;
  (mailer as any).config = { get: (k: string) => (k === 'JWT_SECRET' ? 'test-secret' : undefined) };
  const tokenOf = (url: string) => decodeURIComponent(url.split('token=')[1]);

  it('names the person on the case when the email went to them', () => {
    const token = tokenOf(mailer.buildUnsubscribeUrl('lead-1', 'heir-1'));
    expect(mailer.verifyUnsubscribeToken(token)).toEqual({ leadId: 'lead-1', heirId: 'heir-1' });
  });

  it('still verifies a token minted for the lead alone', () => {
    const token = tokenOf(mailer.buildUnsubscribeUrl('lead-1'));
    expect(mailer.verifyUnsubscribeToken(token)).toEqual({ leadId: 'lead-1', heirId: null });
  });

  it('rejects a token whose person was swapped after signing', () => {
    const token = tokenOf(mailer.buildUnsubscribeUrl('lead-1', 'heir-1'));
    const forged = token.replace('heir-1', 'heir-2');
    expect(mailer.verifyUnsubscribeToken(forged)).toBeNull();
  });
});
