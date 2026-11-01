import { BadRequestException } from '@nestjs/common';
import { SurplusCredibilityService } from './surplus-credibility.service';

/**
 * The packet goes to whoever is on the line: the claimant by default, a
 * person on the case when named or when the number is theirs. The person's
 * own record moves; the case's "packet sent" stamp is the claimant's alone.
 */
const SON = {
  id: 'h-son',
  name: 'J PATRICK BROWN',
  role: 'relative',
  relationship: 'In-law',
  deceased: false,
  doNotCall: false,
  contactStatus: 'not_contacted',
  phone1: '6108121266',
  phone2: '6104899705',
  phone3: null,
  phone4: null,
  phone1Dnc: 'litigator',
  phone2Dnc: null,
  phone3Dnc: null,
  phone4Dnc: null,
  email1: 'pat@example.com',
};

function harness(over: { heir?: any; lead?: any } = {}) {
  const heir = over.heir === undefined ? SON : over.heir;
  const lead = {
    id: 'L1',
    sellerPhone: '+13525550100',
    sellerEmail: 'margaret@example.com',
    doNotContact: false,
    sellerFirstName: 'Margaret',
    sellerLastName: 'Gonzales',
    surplusDetail: { id: 'D1', doNotCall: false, credibilityChannels: '' },
    ...(over.lead || {}),
  };
  const prisma: any = {
    lead: { findFirst: jest.fn().mockResolvedValue(lead) },
    surplusHeir: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(heir && heir.id === where.id ? heir : null)),
      findMany: jest.fn().mockResolvedValue(heir ? [heir] : []),
      update: jest.fn().mockResolvedValue({}),
    },
    surplusDetail: { update: jest.fn().mockResolvedValue({}) },
    activity: { create: jest.fn().mockResolvedValue({}) },
  };
  const messages: any = {
    sendMessage: jest.fn().mockResolvedValue({}),
    sendEmailReply: jest.fn().mockResolvedValue({}),
  };
  const templates: any = {
    credibilityFor: jest.fn().mockImplementation((_leadId: string, _org: any, _user: any, heirId: string | null) =>
      Promise.resolve({
        ready: true,
        missing: [],
        items: ['website', 'Sunbiz filing', 'one-pager', 'callback number'],
        recipient: { heirId: heirId || null, name: heirId ? SON.name : 'Margaret Gonzales' },
        sms: { body: `${heirId ? 'J' : 'Margaret'}, this is Ian with Dig Deeper.`, unfilled: [], versionLabel: 'built-in' },
        email: { subject: 'Who we are', body: 'Hi', unfilled: [], versionLabel: 'built-in' },
      }),
    ),
  };
  const svc = new SurplusCredibilityService(prisma, messages, templates);
  return { svc, prisma, messages, templates };
}

describe('SurplusCredibilityService.send', () => {
  it('still goes to the claimant by default and stamps the case', async () => {
    const { svc, prisma, messages, templates } = harness();
    const r = await svc.send('L1', { channels: ['sms'] }, 'org', 'u1');
    expect(r.sent).toEqual(['sms']);
    expect(r.recipient).toEqual({ heirId: null, name: 'Margaret Gonzales' });
    expect(templates.credibilityFor).toHaveBeenCalledWith('L1', 'org', 'u1', null);
    expect(messages.sendMessage).toHaveBeenCalledWith('L1', expect.stringContaining('Margaret'), 'u1', undefined, '+13525550100');
    expect(prisma.surplusDetail.update).toHaveBeenCalled();
    expect(prisma.surplusHeir.update).not.toHaveBeenCalled();
  });

  it('goes to a named person on their own number, addressed as themselves, and moves their record not the case', async () => {
    const { svc, prisma, messages, templates } = harness();
    const r = await svc.send('L1', { channels: ['sms', 'email'], heirId: 'h-son' }, 'org', 'u1');
    expect(r.sent).toEqual(['sms', 'email']);
    expect(r.recipient.heirId).toBe('h-son');
    expect(templates.credibilityFor).toHaveBeenCalledWith('L1', 'org', 'u1', 'h-son');
    // The first number is on a litigator list, so the second is used.
    expect(messages.sendMessage).toHaveBeenCalledWith('L1', expect.stringContaining('J,'), 'u1', undefined, '6104899705');
    expect(messages.sendEmailReply).toHaveBeenCalledWith('L1', 'u1', expect.objectContaining({ to: 'pat@example.com' }));
    expect(prisma.surplusDetail.update).not.toHaveBeenCalled();
    expect(prisma.surplusHeir.update).toHaveBeenCalledWith({
      where: { id: 'h-son' },
      data: expect.objectContaining({ contactStatus: 'contacted', lastContactedAt: expect.any(Date) }),
    });
    const activity = prisma.activity.create.mock.calls[0][0].data;
    expect(activity.description).toContain('J PATRICK BROWN (In-law)');
    expect(activity.metadata.heirId).toBe('h-son');
  });

  it('finds the person from the number the dialer rang', async () => {
    const { svc, templates, messages } = harness();
    await svc.send('L1', { channels: ['sms'], phone: '(610) 489-9705' }, 'org', 'u1');
    expect(templates.credibilityFor).toHaveBeenCalledWith('L1', 'org', 'u1', 'h-son');
    expect(messages.sendMessage).toHaveBeenCalledWith('L1', expect.any(String), 'u1', undefined, '(610) 489-9705');
  });

  it('refuses a person marked deceased or do not call, and somebody not on the claim', async () => {
    const dead = harness({ heir: { ...SON, deceased: true } });
    await expect(dead.svc.send('L1', { channels: ['sms'], heirId: 'h-son' }, 'org', 'u1')).rejects.toThrow(/deceased/);
    const dnc = harness({ heir: { ...SON, doNotCall: true } });
    await expect(dnc.svc.send('L1', { channels: ['sms'], heirId: 'h-son' }, 'org', 'u1')).rejects.toThrow(/do not call/);
    const stranger = harness();
    await expect(stranger.svc.send('L1', { channels: ['sms'], heirId: 'h-other' }, 'org', 'u1')).rejects.toThrow(BadRequestException);
  });

  it('a do-not-call claimant blocks the claimant send only', async () => {
    const { svc, messages } = harness({ lead: { surplusDetail: { id: 'D1', doNotCall: true, credibilityChannels: '' } } });
    await expect(svc.send('L1', { channels: ['sms'] }, 'org', 'u1')).rejects.toThrow(/do not contact/);
    await svc.send('L1', { channels: ['sms'], heirId: 'h-son' }, 'org', 'u1');
    expect(messages.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('says whose number is missing', async () => {
    const { svc } = harness({ heir: { ...SON, phone1: null, phone2: null, email1: null } });
    await expect(svc.send('L1', { channels: ['sms'], heirId: 'h-son' }, 'org', 'u1')).rejects.toThrow(/No number on file for J PATRICK BROWN/);
  });
});
