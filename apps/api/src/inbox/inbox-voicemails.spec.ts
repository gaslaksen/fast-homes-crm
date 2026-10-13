import { NotFoundException } from '@nestjs/common';
import { InboxService } from './inbox.service';

function harness(opts: { lead?: { id: string } | null; updated?: number } = {}) {
  const prisma = {
    lead: { findFirst: jest.fn(async () => (opts.lead === undefined ? { id: 'lead-1' } : opts.lead)) },
    callLog: { updateMany: jest.fn(async () => ({ count: opts.updated ?? 1 })) },
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
      where: { id: 'log-1', voicemail: true, leadId: null },
      data: { leadId: 'lead-1', voicemailReviewedAt: expect.any(Date) },
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

  it('dismisses only voicemails', async () => {
    const { svc, prisma } = harness();
    await svc.dismissVoicemail('log-1');
    expect(prisma.callLog.updateMany).toHaveBeenCalledWith({
      where: { id: 'log-1', voicemail: true },
      data: { voicemailReviewedAt: expect.any(Date) },
    });
  });
});
