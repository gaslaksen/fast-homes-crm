import { CampaignEnrollmentService } from './campaign-enrollment.service';
import { CampaignExecutionService } from './campaign-execution.service';
import { PrismaService } from '../prisma/prisma.service';

const ENROLLED_AT = new Date('2020-08-05T15:17:00Z');
const STEPS = [
  { stepOrder: 1, delayDays: 0, delayHours: 0 },
  { stepOrder: 2, delayDays: 6, delayHours: 0 },
];

function stub(paused: any[]) {
  const updates: { id: string; data: any }[] = [];
  const prisma = {
    campaign: {
      findUnique: jest.fn(async () => ({ id: 'camp-1', name: 'Probate Email List', steps: STEPS })),
    },
    campaignEnrollment: {
      findMany: jest.fn(async () => paused),
      update: jest.fn(async ({ where, data }: any) => { updates.push({ id: where.id, data }); return {}; }),
    },
    activity: { create: jest.fn(async () => ({})) },
  } as unknown as PrismaService;

  const execution = new CampaignExecutionService(
    prisma, { get: () => undefined } as any, {} as any, {} as any, {} as any,
  );
  return { service: new CampaignEnrollmentService(prisma, execution), updates };
}

const enrollment = (over: any = {}) => ({
  id: over.id || 'enr-1',
  leadId: over.leadId || 'lead-1',
  enrolledAt: ENROLLED_AT,
  currentStepOrder: over.currentStepOrder ?? 0,
});

describe('resumeAllPaused', () => {
  it('puts a paused enrollment back on the step it stopped on', async () => {
    const { service, updates } = stub([enrollment({ currentStepOrder: 0 })]);
    const res = await service.resumeAllPaused('camp-1');

    expect(updates).toHaveLength(1);
    expect(updates[0].data.status).toBe('ACTIVE');
    // Step 1, delay 0: due at enrollment time, which is past, so due now.
    expect(updates[0].data.nextSendAt.toISOString()).toBe(ENROLLED_AT.toISOString());
    expect(res).toEqual({ resumed: 1, examined: 1 });
  });

  it('resumes a mid-campaign enrollment onto its own next step', async () => {
    const { service, updates } = stub([enrollment({ currentStepOrder: 1 })]);
    await service.resumeAllPaused('camp-1');
    // Step 2 is 6 days from enrollment, not from now.
    expect(updates[0].data.nextSendAt.toISOString()).toBe('2020-08-11T15:17:00.000Z');
  });

  it('completes rather than revives an enrollment with no step left', async () => {
    const { service, updates } = stub([enrollment({ currentStepOrder: 2 })]);
    const res = await service.resumeAllPaused('camp-1');

    expect(updates[0].data.status).toBe('COMPLETED');
    expect(updates[0].data.nextSendAt).toBeNull();
    // Counted as examined but not resumed, so the UI can say so.
    expect(res).toEqual({ resumed: 0, examined: 1 });
  });

  it('handles the whole outage in one call', async () => {
    const many = Array.from({ length: 38 }, (_, i) =>
      enrollment({ id: `enr-${i}`, leadId: `lead-${i}` }),
    );
    const { service, updates } = stub(many);
    const res = await service.resumeAllPaused('camp-1');

    expect(res.resumed).toBe(38);
    expect(updates.every((u) => u.data.status === 'ACTIVE')).toBe(true);
  });

  it('is a no-op when nothing is paused', async () => {
    const { service, updates } = stub([]);
    expect(await service.resumeAllPaused('camp-1')).toEqual({ resumed: 0, examined: 0 });
    expect(updates).toHaveLength(0);
  });

  it('refuses an unknown campaign', async () => {
    const prisma = { campaign: { findUnique: jest.fn(async () => null) } } as unknown as PrismaService;
    const execution = new CampaignExecutionService(prisma, { get: () => undefined } as any, {} as any, {} as any, {} as any);
    await expect(
      new CampaignEnrollmentService(prisma, execution).resumeAllPaused('nope'),
    ).rejects.toThrow(/not found/i);
  });
});
