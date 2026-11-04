import { NotFoundException } from '@nestjs/common';
import { InboxService } from './inbox.service';

function harness(
  opts: {
    lead?: { id: string } | null;
    updated?: number;
    heir?: { id: string } | null;
    rows?: any[];
    users?: any[];
    near?: any[];
    leads?: any[];
    heirs?: any[];
  } = {},
) {
  const prisma = {
    lead: {
      findFirst: jest.fn(async () => (opts.lead === undefined ? { id: 'lead-1' } : opts.lead)),
      findMany: jest.fn(async () => opts.leads || []),
    },
    surplusHeir: {
      findFirst: jest.fn(async () => (opts.heir === undefined ? { id: 'heir-1' } : opts.heir)),
      findMany: jest.fn(async () => opts.heirs || []),
    },
    callLog: {
      updateMany: jest.fn(async () => ({ count: opts.updated ?? 1 })),
      findMany: jest.fn(async () => opts.rows || []),
    },
    user: { findMany: jest.fn(async () => opts.users || []) },
    partner: { findMany: jest.fn(async () => []) },
  } as any;
  const leadPhones = { nearNumberHolders: jest.fn(async () => opts.near || []) } as any;
  return { svc: new InboxService(prisma, leadPhones), prisma, leadPhones };
}

describe('InboxService voicemails from unknown callers', () => {
  it('attaches a voicemail to a lead and takes it off the list', async () => {
    const { svc, prisma } = harness();
    await svc.attachVoicemail('log-1', 'lead-1', 'org-1');

    expect(prisma.lead.findFirst).toHaveBeenCalledWith({
      where: { id: 'lead-1', organizationId: 'org-1' },
      select: { id: true },
    });
    expect(prisma.callLog.updateMany).toHaveBeenCalledWith({
      where: { id: 'log-1', type: 'twilio_inbound', leadId: null },
      data: { leadId: 'lead-1', heirId: null, voicemailReviewedAt: expect.any(Date) },
    });
  });

  it('refuses a lead outside the caller organization', async () => {
    const { svc, prisma } = harness({ lead: null });
    await expect(svc.attachVoicemail('log-1', 'lead-x', 'org-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.callLog.updateMany).not.toHaveBeenCalled();
  });

  it('will not move a voicemail that is already on a lead', async () => {
    const { svc } = harness({ updated: 0 });
    await expect(svc.attachVoicemail('log-1', 'lead-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('dismisses only inbound calls', async () => {
    const { svc, prisma } = harness();
    await svc.dismissVoicemail('log-1');
    expect(prisma.callLog.updateMany).toHaveBeenCalledWith({
      where: { id: 'log-1', type: 'twilio_inbound' },
      data: { voicemailReviewedAt: expect.any(Date) },
    });
  });

  it('files the call under the person on the case who made it', async () => {
    const { svc, prisma } = harness();
    await svc.attachVoicemail('log-1', 'lead-1', 'org-1', 'heir-1');
    expect(prisma.surplusHeir.findFirst).toHaveBeenCalledWith({
      where: { id: 'heir-1', surplusDetail: { leadId: 'lead-1' } },
      select: { id: true },
    });
    expect((prisma.callLog.updateMany.mock.calls[0] as any)[0].data.heirId).toBe('heir-1');
  });

  it('refuses a person from some other lead', async () => {
    const { svc, prisma } = harness({ heir: null });
    await expect(svc.attachVoicemail('log-1', 'lead-1', 'org-1', 'heir-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.callLog.updateMany).not.toHaveBeenCalled();
  });

  it('lists missed and answered calls as well as voicemails, and not teammates', async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000);
    const { svc, prisma } = harness({
      users: [{ phone: '(704) 681-2994' }],
      rows: [
        { id: 'a', fromNumber: '+13524678427', createdAt: recent, voicemail: false, status: 'completed', endedReason: 'completed', type: 'twilio_inbound', transcript: 'private call words', recordingUrl: '/r/1' },
        { id: 'b', fromNumber: '+13525550000', createdAt: recent, voicemail: false, status: 'completed', endedReason: 'caller-hangup', type: 'twilio_inbound', transcript: null, recordingUrl: null },
        { id: 'c', fromNumber: '+13525551111', createdAt: recent, voicemail: true, status: 'completed', endedReason: 'voicemail', type: 'twilio_inbound', transcript: 'call me back', recordingUrl: '/r/3' },
        { id: 'd', fromNumber: '+17046812994', createdAt: recent, voicemail: false, status: 'completed', endedReason: 'no-answer', type: 'twilio_inbound', transcript: null, recordingUrl: null },
      ],
    });
    const { items } = await svc.listOpenVoicemails();

    expect(items.map((i: any) => [i.id, i.kind])).toEqual([
      ['a', 'answered'],
      ['b', 'missed'],
      ['c', 'voicemail'],
    ]);
    // What was said is the quickest way to tell who rang, so it is shown.
    expect(items[0]).toMatchObject({ transcript: 'private call words', recordingUrl: '/r/1' });
    expect(items[2]).toMatchObject({ transcript: 'call me back', recordingUrl: '/r/3' });
    expect(prisma.callLog.findMany.mock.calls[0][0].where).toMatchObject({
      type: 'twilio_inbound',
      leadId: null,
      voicemailReviewedAt: null,
    });
  });

  it('suggests the person holding a number a few digits off the caller', async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000);
    const { svc } = harness({
      rows: [
        { id: 'a', fromNumber: '+13524678427', createdAt: recent, voicemail: false, status: 'completed', endedReason: 'completed', type: 'twilio_inbound', transcript: null, recordingUrl: null },
      ],
      near: [{ number: '3524678424', gap: 3, leadId: 'kelly', heirId: 'tina' }],
      leads: [{ id: 'kelly', sellerFirstName: 'David G', sellerLastName: 'Kelly', propertyAddress: '34132 HYATT RD', source: 'SURPLUS' }],
      heirs: [{ id: 'tina', name: 'TINA LYNN DAVIS', role: 'relative', relationship: 'other relative' }],
    });
    const { items } = await svc.listOpenVoicemails();
    expect(items[0].suggestions).toEqual([
      {
        leadId: 'kelly',
        heirId: 'tina',
        name: 'TINA LYNN DAVIS',
        label: 'Other relative',
        leadName: 'David G Kelly',
        propertyAddress: '34132 HYATT RD',
        source: 'SURPLUS',
        numberOnFile: '(352) 467-8424',
      },
    ]);
  });

  it('finds a relative by name when attaching, with the case she is on', async () => {
    const { svc, prisma } = harness({
      heirs: [
        {
          id: 'tina',
          name: 'TINA LYNN DAVIS',
          role: 'relative',
          relationship: 'other relative',
          deceased: false,
          surplusDetail: { lead: { id: 'kelly', sellerFirstName: 'David G', sellerLastName: 'Kelly', propertyAddress: '34132 HYATT RD', source: 'SURPLUS' } },
        },
      ],
    });
    const { results } = await svc.searchAttachTargets('tina davis', 'org-1');

    expect(results[0]).toMatchObject({ kind: 'person', leadId: 'kelly', heirId: 'tina', name: 'TINA LYNN DAVIS', leadName: 'David G Kelly' });
    const where = (prisma.surplusHeir.findMany.mock.calls[0] as any)[0].where;
    expect(where.AND).toEqual([
      { name: { contains: 'tina', mode: 'insensitive' } },
      { name: { contains: 'davis', mode: 'insensitive' } },
    ]);
    // Only people on this organization's leads.
    expect(where.surplusDetail).toEqual({ lead: { organizationId: 'org-1' } });
  });

  it('searches every number on file when the search is a phone number', async () => {
    const { svc, prisma } = harness({});
    await svc.searchAttachTargets('(352) 467-8424', 'org-1');
    const heirWhere = (prisma.surplusHeir.findMany.mock.calls[0] as any)[0].where;
    expect(heirWhere.OR[0]).toEqual({ phone1: { contains: '3524678424' } });
    const leadWhere = (prisma.lead.findMany.mock.calls[0] as any)[0].where;
    expect(leadWhere.OR[0]).toEqual({ sellerPhone: { contains: '3524678424' } });
    expect(leadWhere.organizationId).toBe('org-1');
  });
});
