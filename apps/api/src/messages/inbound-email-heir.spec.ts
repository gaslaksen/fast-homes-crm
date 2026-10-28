import { MessagesService } from './messages.service';

/**
 * A daughter on a surplus case writes from her own address, which is on her
 * row, not the claimant's. Matching only Lead.sellerEmail dropped her email
 * as "Lead not found"; it now files under the case and marks her contacted.
 */
function build(heir: any) {
  const lead = { id: 'lead1', organizationId: 'org1', source: 'SURPLUS', status: 'NEW' };
  const prisma: any = {
    lead: {
      findUnique: jest.fn().mockResolvedValue(lead),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(lead),
    },
    email: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'email1' }) },
    surplusHeir: {
      findFirst: jest.fn().mockResolvedValue(heir),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    activity: { create: jest.fn().mockResolvedValue({}) },
  };
  const config: any = {
    get: (key: string, fallback?: any) => (key === 'ALLOW_SIMULATED_SMS' ? 'true' : fallback),
  };
  const none = {} as any;
  const push: any = { notifyNewMessage: jest.fn().mockResolvedValue(undefined) };
  const service = new MessagesService(prisma, none, config, none, none, none, none, push, none, none, none);
  jest.spyOn(service as any, 'syncThreadSummary').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'markSurplusTapped').mockResolvedValue(undefined);
  return { service, prisma };
}

const inbound = {
  from: 'Linda Morris <Linda.Morris@example.com>',
  to: 'deals@crm.digdeeperllc.com',
  subject: 'Re: my mother',
  bodyText: 'Please call me.',
};

describe('MessagesService inbound email from a person on a surplus case', () => {
  it('files the email under the case and marks that person contacted', async () => {
    const { service, prisma } = build({ id: 'heir1', surplusDetail: { leadId: 'lead1' } });
    const res = await service.handleInboundEmail(inbound);

    expect(res).toEqual({ success: true, leadId: 'lead1', emailId: 'email1' });
    const where = prisma.surplusHeir.findFirst.mock.calls[0][0].where;
    expect(where.OR[0].email1.equals).toBe('linda.morris@example.com');
    expect(prisma.email.create.mock.calls[0][0].data.leadId).toBe('lead1');
    expect(prisma.surplusHeir.update.mock.calls[0][0].where).toEqual({ id: 'heir1' });
    expect(prisma.surplusHeir.updateMany.mock.calls[0][0].data).toEqual({ contactStatus: 'contacted' });
  });

  it('still reports no lead when nobody holds the address', async () => {
    const { service, prisma } = build(null);
    const res = await service.handleInboundEmail(inbound);

    expect(res).toEqual({ success: false, reason: 'Lead not found' });
    expect(prisma.email.create).not.toHaveBeenCalled();
  });
});
