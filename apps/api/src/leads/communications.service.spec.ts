import { CommunicationsService } from './communications.service';

/**
 * A claimant with several claims rings in on one number. The call is filed on
 * one claim, and every other claim of theirs shows it too.
 */
function build(source: string, ownCalls: any[], siblingCalls: any[]) {
  const callLogFindMany = jest.fn(async ({ where }: any) => (where.leadId === 'claim-1321' ? ownCalls : siblingCalls));
  const prisma = {
    lead: {
      findUnique: async () => ({ id: 'claim-1321', sellerFirstName: 'Jean', sellerLastName: 'Fleurinor', sellerPhone: '+19548054423', source }),
    },
    message: { findMany: async () => [] },
    email: { findMany: async () => [] },
    callLog: { findMany: callLogFindMany },
    activity: { findMany: async () => [] },
    note: { findMany: async () => [] },
    user: { findMany: async () => [] },
  } as any;
  const leadPhones = {
    listForLead: async () => [{ number: '+19548054423', label: 'Primary', type: null, isPrimary: true, dnc: null, bad: false }],
  } as any;
  return { svc: new CommunicationsService(prisma, leadPhones), callLogFindMany };
}

const call = (id: string, at: string) => ({
  id,
  type: 'twilio_inbound',
  fromNumber: '+19548054423',
  toNumber: '+19045959620',
  status: 'completed',
  createdAt: new Date(at),
});

describe('CommunicationsService sibling claim calls', () => {
  it("shows a callback filed on the claimant's other claim, in time order", async () => {
    const { svc, callLogFindMany } = build(
      'SURPLUS',
      [call('own', '2026-09-16T20:12:00Z')],
      [call('sibling', '2026-10-21T16:01:26Z')],
    );
    const { timeline } = await svc.getCommunications('claim-1321');

    expect(timeline.filter((t: any) => t.kind === 'call').map((t: any) => t.id)).toEqual(['call_own', 'call_sibling']);
    expect(callLogFindMany.mock.calls[1][0].where).toMatchObject({
      type: 'twilio_inbound',
      leadId: { not: 'claim-1321' },
      fromNumber: { in: ['+19548054423'] },
      lead: { source: 'SURPLUS' },
    });
  });

  it('leaves a non-surplus lead to its own calls', async () => {
    const { svc, callLogFindMany } = build('PROPERTY_LEADS', [], [call('sibling', '2026-10-21T16:01:26Z')]);
    const { timeline } = await svc.getCommunications('claim-1321');

    expect(timeline.filter((t: any) => t.kind === 'call')).toEqual([]);
    expect(callLogFindMany).toHaveBeenCalledTimes(1);
  });
});
