import { CampaignExecutionService } from './campaign-execution.service';

/**
 * The campaign cron logs one summary line per run, not a line per enrollment,
 * and says nothing about enrollments another replica already claimed.
 */
function setup(enrollments: any[], claimedByOther: string[] = []) {
  const queries: any[] = [];
  const prisma = {
    campaignEnrollment: {
      findMany: jest.fn(async (args: any) => {
        queries.push(args);
        return enrollments;
      }),
      updateMany: jest.fn(async ({ where }: any) => ({ count: claimedByOther.includes(where.id) ? 0 : 1 })),
      update: jest.fn(async () => ({})),
    },
  };
  const svc = new CampaignExecutionService(prisma as any, { get: () => undefined } as any, {} as any, {} as any, {} as any);
  const log = jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
  const debug = jest.spyOn((svc as any).logger, 'debug').mockImplementation(() => undefined);
  return { svc, queries, log, debug };
}

const enrollment = (id: string) => ({ id, leadId: `lead-${id}`, nextSendAt: new Date('2026-11-25T16:00:00Z'), lead: { status: 'NEW' } });

describe('processScheduledMessages logging', () => {
  it('takes the longest waiting enrollments first', async () => {
    const { svc, queries } = setup([]);
    await svc.processScheduledMessages();
    expect(queries[0].orderBy).toEqual([{ nextSendAt: 'asc' }, { id: 'asc' }]);
  });

  it('logs nothing when nothing is due', async () => {
    const { svc, log } = setup([]);
    await svc.processScheduledMessages();
    expect(log).not.toHaveBeenCalled();
  });

  it('folds a run into one line and stays silent about the other replica', async () => {
    const list = ['a', 'b', 'c', 'd'].map(enrollment);
    const { svc, log, debug } = setup(list, ['d']);
    jest
      .spyOn(svc, 'executeStep')
      .mockResolvedValueOnce({ kind: 'SENT' })
      .mockResolvedValueOnce({ kind: 'DEFERRED', reason: 'email daily limit reached (90/90 in the last day)', retryAt: new Date('2026-11-25T17:00:00Z') })
      .mockResolvedValueOnce({ kind: 'DEFERRED', reason: 'email daily limit reached (90/90 in the last day)', retryAt: new Date('2026-11-25T17:01:00Z') });
    await svc.processScheduledMessages();

    expect(svc.executeStep).toHaveBeenCalledTimes(3);
    expect(debug).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(
      /Campaign run: 1 sent, 2 deferred until 2026-11-25T17:00:00.000Z \(email daily limit reached\)$/,
    );
  });
});
