import { NotFoundException } from '@nestjs/common';
import { InboxService } from './inbox.service';

function harness(
  opts: { lead?: { id: string } | null; updated?: number; heir?: { id: string } | null; rows?: any[]; users?: any[] } = {},
) {
  const prisma = {
    lead: { findFirst: jest.fn(async () => (opts.lead === undefined ? { id: 'lead-1' } : opts.lead)) },
    surplusHeir: { findFirst: jest.fn(async () => (opts.heir === undefined ? { id: 'heir-1' } : opts.heir)) },
    callLog: {
      updateMany: jest.fn(async () => ({ count: opts.updated ?? 1 })),
      findMany: jest.fn(async () => opts.rows || []),
    },
    user: { findMany: jest.fn(async () => opts.users || []) },
    partner: { findMany: jest.fn(async () => []) },
  } as any;
  return { svc: new InboxService(prisma), prisma };
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
    // An answered call's recording belongs on the lead, not in a shared list.
    expect(items[0]).toMatchObject({ transcript: null, recordingUrl: null });
    expect(items[2]).toMatchObject({ transcript: 'call me back', recordingUrl: '/r/3' });
    expect(prisma.callLog.findMany.mock.calls[0][0].where).toMatchObject({
      type: 'twilio_inbound',
      leadId: null,
      voicemailReviewedAt: null,
    });
  });
});
