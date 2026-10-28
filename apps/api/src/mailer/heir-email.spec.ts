import { MailerService } from './mailer.service';

/**
 * An email to a relative on a surplus case is filed under that relative, so
 * the conversation can say who it went to. The claimant's own address wins.
 */
function build(lead: any, heir: any) {
  const prisma: any = {
    lead: { findUnique: jest.fn().mockResolvedValue(lead) },
    surplusHeir: { findFirst: jest.fn().mockResolvedValue(heir) },
  };
  const svc = new MailerService({ get: () => undefined } as any, prisma);
  const heirIdForEmail = (leadId: string, to: string) => (svc as any).heirIdForEmail(leadId, to);
  return { prisma, heirIdForEmail };
}

describe('MailerService person on an outbound email', () => {
  it('names the relative whose address it went to', async () => {
    const { prisma, heirIdForEmail } = build({ source: 'SURPLUS', sellerEmail: 'mom@example.com' }, { id: 'heir1' });
    expect(await heirIdForEmail('lead1', 'Linda Morris <Linda@Example.com>')).toBe('heir1');
    const where = prisma.surplusHeir.findFirst.mock.calls[0][0].where;
    expect(where.surplusDetail).toEqual({ leadId: 'lead1' });
    expect(where.OR[0].email1.equals).toBe('linda@example.com');
  });

  it('leaves the claimant\'s own address unattributed', async () => {
    const { prisma, heirIdForEmail } = build({ source: 'SURPLUS', sellerEmail: 'mom@example.com' }, { id: 'heir1' });
    expect(await heirIdForEmail('lead1', 'MOM@example.com')).toBeNull();
    expect(prisma.surplusHeir.findFirst).not.toHaveBeenCalled();
  });

  it('does nothing for a lead that is not surplus', async () => {
    const { heirIdForEmail } = build({ source: 'PROPERTY_LEADS', sellerEmail: null }, { id: 'heir1' });
    expect(await heirIdForEmail('lead1', 'someone@example.com')).toBeNull();
  });
});
