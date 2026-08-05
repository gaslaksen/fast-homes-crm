import { CampaignExecutionService } from './campaign-execution.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A domain on a probationary Mailgun account is held to 100 requests a day
 * plus a short-window recipient limit, and crossing either locks the domain
 * out, taking the daily brief and every reply down with the campaign. So the
 * interesting behaviour is what happens at each ceiling, and that a throttled
 * lead is not punished for arriving at one.
 */
function service(opts: { sentThisHour: number; oldestSentAt?: Date; limit?: string; dailyLimit?: string }) {
  const prisma = {
    email: {
      count: jest.fn(async () => opts.sentThisHour),
      findFirst: jest.fn(async () => (opts.oldestSentAt ? { sentAt: opts.oldestSentAt } : null)),
    },
  } as unknown as PrismaService;

  const config = {
    get: (k: string) =>
      k === 'EMAIL_HOURLY_LIMIT' ? opts.limit
      : k === 'EMAIL_DAILY_LIMIT' ? (opts.dailyLimit ?? '100000')
      : undefined,
  } as any;

  const svc = new CampaignExecutionService(prisma, config, {} as any, {} as any, {} as any);
  return { svc, prisma };
}

const throttle = (svc: any) => (svc as any).emailThrottle();

describe('email send throttle', () => {
  it('lets a send through with room to spare', async () => {
    const { svc } = service({ sentThisHour: 10, limit: '20' });
    expect(await throttle(svc)).toBeNull();
  });

  it('defers rather than fails once the hour is full', async () => {
    const { svc } = service({ sentThisHour: 80, limit: '80' });
    const out = await throttle(svc);

    // DEFERRED, not RETRY: nothing was attempted, so nothing should count
    // against the attempt budget that eventually pauses an enrollment.
    expect(out.kind).toBe('DEFERRED');
    expect(out.reason).toContain('hourly limit reached (80/80');
  });

  it('waits for the oldest send to age out of the window, not a flat guess', async () => {
    // Oldest send 20 minutes ago, so capacity frees 40 minutes from now.
    const oldest = new Date(Date.now() - 20 * 60 * 1000);
    const { svc } = service({ sentThisHour: 80, limit: '80', oldestSentAt: oldest });
    const out: any = await throttle(svc);

    const expected = oldest.getTime() + 60 * 60 * 1000 + 60 * 1000;
    expect(Math.abs(out.retryAt.getTime() - expected)).toBeLessThan(2000);
  });

  it('never schedules a retry sooner than the next cron tick', async () => {
    // Oldest send is 61 minutes old, so the naive answer is in the past.
    const { svc } = service({
      sentThisHour: 80,
      limit: '80',
      oldestSentAt: new Date(Date.now() - 61 * 60 * 1000),
    });
    const out: any = await throttle(svc);
    expect(out.retryAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 4 * 60 * 1000);
  });

  it('falls back to a fixed wait when the window somehow has no rows', async () => {
    const { svc } = service({ sentThisHour: 80, limit: '80', oldestSentAt: undefined });
    const out: any = await throttle(svc);
    expect(out.retryAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('honours EMAIL_HOURLY_LIMIT so the cap can rise off probation', async () => {
    const { svc } = service({ sentThisHour: 80, limit: '500' });
    expect(await throttle(svc)).toBeNull();

    const tight = service({ sentThisHour: 12, limit: '10' });
    expect((await throttle(tight.svc)).kind).toBe('DEFERRED');
  });

  it('treats a zero or junk limit as no throttle rather than blocking all email', async () => {
    expect(await throttle(service({ sentThisHour: 999, limit: '0' }).svc)).toBeNull();
    expect(await throttle(service({ sentThisHour: 999, limit: 'abc' }).svc)).toBeNull();
  });

  it('applies the daily ceiling, and reports which window bit', async () => {
    const { svc } = service({ sentThisHour: 95, limit: '100000', dailyLimit: '90' });
    const out: any = await throttle(svc);
    expect(out.kind).toBe('DEFERRED');
    expect(out.reason).toContain('daily limit reached (95/90');
  });

  it('checks the daily ceiling before the hourly one', async () => {
    // Over both. The daily wait is the longer and the one that matters.
    const { svc } = service({ sentThisHour: 95, limit: '20', dailyLimit: '90' });
    const out: any = await throttle(svc);
    expect(out.reason).toContain('daily');
  });

  it('counts every outbound email, not just this campaign or sender', async () => {
    const { svc, prisma } = service({ sentThisHour: 10, limit: '20' });
    await throttle(svc);

    // Mailgun's limit is per domain and all our senders share one, so the
    // daily brief and user replies have to count too.
    const where = (prisma as any).email.count.mock.calls[0][0].where;
    expect(where).toEqual({ direction: 'outbound', sentAt: { gte: expect.any(Date) } });
    expect(where.fromAddress).toBeUndefined();
  });
});
