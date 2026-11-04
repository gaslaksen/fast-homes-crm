import { BadRequestException } from '@nestjs/common';
import { InboxService } from './inbox.service';

/**
 * Saving the number a call came from on the person it turned out to be. Four
 * slots per person: when full, nothing is dropped quietly; the answer lists
 * what is on file with how calling each went, and `replace` swaps one.
 */
const TINA = {
  id: 'tina',
  name: 'TINA LYNN DAVIS',
  phone1: '3524678379', phone1Type: null, phone1Dnc: null,
  phone2: '3528072150', phone2Type: null, phone2Dnc: null,
  phone3: '3528070993', phone3Type: 'Landline', phone3Dnc: 'DNC',
  phone4: '3524678424', phone4Type: 'Mobile', phone4Dnc: null,
  email1: null, email2: null,
};

function harness(heir: any = TINA, opts: { calls?: any[]; own?: any[]; setPhones?: any } = {}) {
  const prisma = {
    lead: {
      findFirst: jest.fn(async () => ({
        id: 'kelly', sellerFirstName: 'David G', sellerLastName: 'Kelly',
        badContacts: { phones: ['+13528072150'], emails: [] },
      })),
    },
    surplusHeir: { findFirst: jest.fn(async () => heir), update: jest.fn(async () => ({})) },
    callLog: { findMany: jest.fn(async () => opts.calls || []) },
  } as any;
  const leadPhones = {
    listForLead: jest.fn(async () => opts.own || []),
    setPhones: opts.setPhones || jest.fn(async () => []),
  } as any;
  return { svc: new InboxService(prisma, leadPhones), prisma, leadPhones };
}

describe('InboxService.saveCallerNumber on a person', () => {
  it('lists her four numbers with how each went when she is full', async () => {
    const { svc, prisma } = harness(TINA, {
      calls: [
        { toNumber: '+13524678379', type: 'twilio_browser', createdAt: new Date('2026-11-04T19:07:00Z'), outcome: null, disposition: null, endedReason: 'completed' },
        { toNumber: '+13528072150', type: 'twilio_browser', createdAt: new Date('2026-11-04T19:11:00Z'), outcome: null, disposition: 'No Answer', endedReason: 'completed' },
      ],
    });
    const out = await svc.saveCallerNumber({ leadId: 'kelly', heirId: 'tina', number: '+13524678427' });

    expect(prisma.surplusHeir.update).not.toHaveBeenCalled();
    expect(out).toMatchObject({ saved: false, reason: 'full', name: 'TINA LYNN DAVIS', capacity: 4 });
    const slots = (out as any).slots;
    expect(slots.map((p: any) => [p.number, p.calls, p.lastResult, p.bad, p.dnc])).toEqual([
      ['3524678379', 1, 'Connected', false, null],
      ['3528072150', 1, 'No Answer', true, null],
      ['3528070993', 0, null, false, 'DNC'],
      ['3524678424', 0, null, false, null],
    ]);
  });

  it('replaces the chosen number in place and keeps the others as they were', async () => {
    const { svc, prisma } = harness();
    const out = await svc.saveCallerNumber({ leadId: 'kelly', heirId: 'tina', number: '(352) 467-8427', replace: '3528072150' });

    expect(out).toEqual({ saved: true });
    const data = (prisma.surplusHeir.update.mock.calls[0] as any)[0].data;
    expect([data.phone1, data.phone2, data.phone3, data.phone4]).toEqual(['3524678379', '3524678427', '3528070993', '3524678424']);
    expect(data.phone2Type).toBeNull();
    // The landline keeps its own type and DNC result.
    expect([data.phone3Type, data.phone3Dnc]).toEqual(['Landline', 'DNC']);
  });

  it('adds to an open slot without asking', async () => {
    const { svc, prisma } = harness({ ...TINA, phone4: null, phone4Type: null });
    expect(await svc.saveCallerNumber({ leadId: 'kelly', heirId: 'tina', number: '+13524678427' })).toEqual({ saved: true });
    expect((prisma.surplusHeir.update.mock.calls[0] as any)[0].data.phone4).toBe('3524678427');
  });

  it('does nothing when she already has it', async () => {
    const { svc, prisma } = harness();
    expect(await svc.saveCallerNumber({ leadId: 'kelly', heirId: 'tina', number: '+13524678424' })).toEqual({ saved: true, already: true });
    expect(prisma.surplusHeir.update).not.toHaveBeenCalled();
  });
});

describe('InboxService.saveCallerNumber on a lead', () => {
  const own = [
    { number: '+13526084132', type: 'Mobile', isPrimary: true, heirId: null },
    { number: '+13525550001', type: null, isPrimary: false, heirId: null },
    { number: '+13524678424', type: null, isPrimary: false, heirId: 'tina' },
  ];

  it('reports full when the pipeline has no slot left, primary marked', async () => {
    const setPhones = jest.fn(async () => {
      throw new BadRequestException('This lead holds at most 2 numbers; remove one before adding another.');
    });
    const { svc } = harness(TINA, { own, setPhones });
    const out: any = await svc.saveCallerNumber({ leadId: 'kelly', number: '+13524678427' });
    expect(out).toMatchObject({ saved: false, reason: 'full', capacity: 2 });
    // The heir's number on the same lead is not one of the lead's own.
    expect(out.slots.map((p: any) => [p.number, p.isPrimary])).toEqual([
      ['3526084132', true],
      ['3525550001', false],
    ]);
  });

  it('never replaces the primary', async () => {
    const { svc, leadPhones } = harness(TINA, { own });
    await expect(
      svc.saveCallerNumber({ leadId: 'kelly', number: '+13524678427', replace: '3526084132' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(leadPhones.setPhones).not.toHaveBeenCalled();
  });

  it('replaces a second number in place', async () => {
    const { svc, leadPhones } = harness(TINA, { own });
    await svc.saveCallerNumber({ leadId: 'kelly', number: '+13524678427', replace: '+13525550001' });
    expect(leadPhones.setPhones).toHaveBeenCalledWith('kelly', [
      { number: '3526084132', type: 'Mobile' },
      { number: '3524678427', type: null },
    ]);
  });
});
