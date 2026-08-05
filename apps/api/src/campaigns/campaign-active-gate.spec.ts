import { CampaignExecutionService } from './campaign-execution.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The Active/Paused control on a campaign is the one obvious way to halt a
 * campaign that is misfiring. It only halts anything if the cron's own query
 * refuses to pick up enrollments belonging to a switched-off campaign, so
 * that is what these assert.
 */
function service(enrollments: any[] = []) {
  const queries: any[] = [];
  const prisma = {
    campaignEnrollment: {
      findMany: jest.fn(async (args: any) => { queries.push(args.where); return enrollments; }),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
    },
  } as unknown as PrismaService;

  const svc = new CampaignExecutionService(
    prisma, { get: () => undefined } as any, {} as any, {} as any, {} as any,
  );
  return { svc, queries, prisma };
}

describe('processScheduledMessages campaign gate', () => {
  it('only ever asks for enrollments on an active campaign', async () => {
    const { svc, queries } = service();
    await svc.processScheduledMessages();

    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({
      status: 'ACTIVE',
      campaign: { isActive: true },
    });
    expect(queries[0].nextSendAt).toHaveProperty('lte');
  });

  it('still requires the enrollment itself to be active and due', async () => {
    const { svc, queries } = service();
    await svc.processScheduledMessages();

    // Toggling the campaign is a hold on top of the existing conditions, not
    // a replacement for them: a paused enrollment stays paused either way.
    expect(queries[0].status).toBe('ACTIVE');
    expect(queries[0].nextSendAt.lte).toBeInstanceOf(Date);
  });

  it('does no work at all when the query comes back empty', async () => {
    const { svc, prisma } = service([]);
    await svc.processScheduledMessages();
    expect((prisma as any).campaignEnrollment.updateMany).not.toHaveBeenCalled();
  });
});
