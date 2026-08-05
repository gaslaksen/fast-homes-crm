import { CampaignEnrollmentService } from './campaign-enrollment.service';
import { CampaignExecutionService } from './campaign-execution.service';
import { PrismaService } from '../prisma/prisma.service';

// Fixed dates well either side of any real clock, so "is this due now?"
// never depends on when the suite happens to run.
const ENROLLED_AT = new Date('2020-08-05T15:17:00Z');
const FAR_FUTURE = new Date('2099-01-01T00:00:00Z');

/**
 * Prisma stub holding a fixed set of enrollments and recording every
 * conditional update the resync attempts.
 */
function stub(opts: {
  steps: any[];
  enrollments: any[];
  /** ids the cron "claims" mid-resync, so their conditional write matches 0 rows. */
  claimedDuringResync?: string[];
}) {
  const writes: { id: string; nextSendAt: Date }[] = [];
  const queried: any[] = [];

  const prisma = {
    campaign: {
      findUnique: jest.fn(async () => ({
        id: 'camp-1',
        name: 'Probate SMS List',
        steps: opts.steps,
      })),
    },
    campaignEnrollment: {
      findMany: jest.fn(async (args: any) => {
        queried.push(args.where);
        return opts.enrollments;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (opts.claimedDuringResync?.includes(where.id)) return { count: 0 };
        writes.push({ id: where.id, nextSendAt: data.nextSendAt });
        return { count: 1 };
      }),
    },
  } as unknown as PrismaService;

  const execution = new CampaignExecutionService(
    prisma, { get: () => undefined } as any, {} as any, {} as any, {} as any,
  );
  return { service: new CampaignEnrollmentService(prisma, execution), writes, queried };
}

function enrollment(over: any = {}) {
  return {
    id: over.id || 'enr-1',
    enrolledAt: over.enrolledAt || ENROLLED_AT,
    currentStepOrder: over.currentStepOrder ?? 0,
    nextSendAt: 'nextSendAt' in over ? over.nextSendAt : new Date('2020-08-07T15:17:00Z'),
  };
}

const STEPS_DAY2 = [{ stepOrder: 1, delayDays: 2, delayHours: 0 }, { stepOrder: 2, delayDays: 4, delayHours: 0 }];
const STEPS_NOW = [{ stepOrder: 1, delayDays: 0, delayHours: 0 }, { stepOrder: 2, delayDays: 4, delayHours: 0 }];

describe('CampaignEnrollmentService.resyncSchedule', () => {
  it('pulls a day-2 first step back to enrollment time when the delay is set to 0', async () => {
    const { service, writes } = stub({ steps: STEPS_NOW, enrollments: [enrollment()] });
    const res = await service.resyncSchedule('camp-1');

    expect(writes).toHaveLength(1);
    // Step 1 at delay 0 anchors on enrolledAt, which is already past: due now.
    expect(writes[0].nextSendAt.toISOString()).toBe(ENROLLED_AT.toISOString());
    expect(res).toMatchObject({ rescheduled: 1, dueNow: 1, unchanged: 0 });
  });

  it('moves nobody when the delays are unchanged, so a copy-only edit is inert', async () => {
    const { service, writes } = stub({ steps: STEPS_DAY2, enrollments: [enrollment()] });
    const res = await service.resyncSchedule('camp-1');

    expect(writes).toHaveLength(0);
    expect(res).toMatchObject({ rescheduled: 0, dueNow: 0, unchanged: 1 });
  });

  it('pushes sends later as readily as earlier', async () => {
    const { service, writes } = stub({
      steps: [{ stepOrder: 1, delayDays: 5, delayHours: 0 }],
      enrollments: [enrollment()],
    });
    await service.resyncSchedule('camp-1');
    expect(writes[0].nextSendAt.toISOString()).toBe('2020-08-10T15:17:00.000Z');
  });

  it('anchors mid-flight enrollments on their own next step, not step 1', async () => {
    const { service, writes } = stub({
      steps: STEPS_NOW,
      enrollments: [enrollment({ currentStepOrder: 1, nextSendAt: new Date('2020-08-20T15:17:00Z') })],
    });
    await service.resyncSchedule('camp-1');
    // Step 2, delay 4 days from enrollment.
    expect(writes[0].nextSendAt.toISOString()).toBe('2020-08-09T15:17:00.000Z');
  });

  it('leaves an enrollment past its last step alone', async () => {
    const { service, writes } = stub({
      steps: STEPS_NOW,
      enrollments: [enrollment({ currentStepOrder: 2 })],
    });
    const res = await service.resyncSchedule('camp-1');
    expect(writes).toHaveLength(0);
    expect(res).toMatchObject({ rescheduled: 0, unchanged: 1 });
  });

  it('only ever queries ACTIVE enrollments that are not mid-send', async () => {
    const { service, queried } = stub({ steps: STEPS_NOW, enrollments: [] });
    await service.resyncSchedule('camp-1');

    // A null nextSendAt is the cron's in-flight claim. Resyncing one would
    // hand the same step to the next tick and send the message twice.
    expect(queried[0]).toEqual({
      campaignId: 'camp-1',
      status: 'ACTIVE',
      nextSendAt: { not: null },
    });
  });

  it('yields to the cron when it claims an enrollment mid-resync', async () => {
    const { service, writes } = stub({
      steps: STEPS_NOW,
      enrollments: [enrollment({ id: 'enr-1' }), enrollment({ id: 'enr-2' })],
      claimedDuringResync: ['enr-1'],
    });
    const res = await service.resyncSchedule('camp-1');

    expect(writes.map((w) => w.id)).toEqual(['enr-2']);
    expect(res).toMatchObject({ rescheduled: 1, unchanged: 1 });
  });

  it('reports how many became due immediately, for the confirmation the UI shows', async () => {
    const { service } = stub({
      steps: STEPS_NOW,
      enrollments: [
        enrollment({ id: 'a' }),
        enrollment({ id: 'b' }),
        // Enrolled far enough in the future that delay 0 is still ahead of now.
        enrollment({ id: 'c', enrolledAt: FAR_FUTURE, nextSendAt: new Date('2099-01-03T00:00:00Z') }),
      ],
    });
    const res = await service.resyncSchedule('camp-1');
    expect(res).toMatchObject({ rescheduled: 3, dueNow: 2 });
  });

  it('refuses an unknown campaign', async () => {
    const prisma = { campaign: { findUnique: jest.fn(async () => null) } } as unknown as PrismaService;
    const execution = new CampaignExecutionService(prisma, { get: () => undefined } as any, {} as any, {} as any, {} as any);
    await expect(
      new CampaignEnrollmentService(prisma, execution).resyncSchedule('nope'),
    ).rejects.toThrow(/not found/i);
  });
});
