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

/**
 * Several people on one surplus case: each text, call and email says who it
 * was with, an inbound one is labelled with whoever wrote in, and the thread
 * lists everybody it was with so it can be filtered.
 */
describe('CommunicationsService people on a surplus case', () => {
  const at = (s: string) => new Date(s);
  function build() {
    const prisma = {
      lead: {
        findUnique: async () => ({
          id: 'lead1',
          sellerFirstName: 'Dorothy',
          sellerLastName: 'Kessler',
          sellerPhone: '+13525550100',
          sellerEmail: 'dorothy@example.com',
          source: 'SURPLUS',
          surplusDetail: {
            email2: null,
            heirs: [
              { id: 'h-linda', name: 'Linda Morris', relationship: 'Daughter', role: 'relative', phone1: '3525550141', email1: 'linda@example.com' },
              { id: 'h-rob', name: 'Robert Kessler', relationship: null, role: 'relative', phone1: '4045550102' },
            ],
          },
        }),
      },
      message: {
        findMany: async () => [
          // Filed since heirId existed.
          { id: 'm1', direction: 'OUTBOUND', from: '+19045550000', to: '+13525550141', heirId: 'h-linda', createdAt: at('2026-10-01T10:00:00Z') },
          // From before: read off the number.
          { id: 'm2', direction: 'INBOUND', from: '+14045550102', to: '+19045550000', heirId: null, createdAt: at('2026-10-02T10:00:00Z') },
          { id: 'm3', direction: 'INBOUND', from: '+13525550100', to: '+19045550000', heirId: null, createdAt: at('2026-10-03T10:00:00Z') },
        ],
      },
      email: {
        findMany: async () => [
          { id: 'e1', direction: 'inbound', fromAddress: 'Linda <linda@example.com>', toAddress: 'deals@x', heirId: null, sentAt: at('2026-10-04T10:00:00Z') },
        ],
      },
      callLog: { findMany: async () => [] },
      activity: { findMany: async () => [] },
      note: { findMany: async () => [] },
      user: { findMany: async () => [] },
    } as any;
    const leadPhones = {
      listForLead: async () => [
        { number: '+13525550100', label: 'Primary', heirId: null },
        { number: '3525550141', label: 'Heir: Linda Morris', heirId: 'h-linda' },
      ],
    } as any;
    return new CommunicationsService(prisma, leadPhones);
  }

  it('names the person on every text and email, from the row or its number', async () => {
    const { timeline } = await build().getCommunications('lead1');
    expect(timeline.map((t: any) => [t.id, t.person?.name, t.person?.label])).toEqual([
      ['sms_m1', 'Linda Morris', 'Daughter'],
      ['sms_m2', 'Robert Kessler', 'Relative'],
      ['sms_m3', 'Dorothy Kessler', 'Claimant'],
      ['email_e1', 'Linda Morris', 'Daughter'],
    ]);
  });

  it('labels an inbound text with whoever sent it, not the claimant', async () => {
    const { timeline } = await build().getCommunications('lead1');
    expect(timeline.find((t: any) => t.id === 'sms_m2').actor).toEqual({ type: 'seller', name: 'Robert Kessler' });
    expect(timeline.find((t: any) => t.id === 'sms_m3').actor).toEqual({ type: 'seller', name: 'Dorothy Kessler' });
  });

  it('lists everybody the thread was with, claimant first, with counts', async () => {
    const { people } = (await build().getCommunications('lead1')) as any;
    expect(people.map((p: any) => [p.id, p.count])).toEqual([
      [null, 1],
      ['h-linda', 2],
      ['h-rob', 1],
    ]);
  });
});
