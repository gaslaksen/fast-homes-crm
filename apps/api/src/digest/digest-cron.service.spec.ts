import { DigestCronService } from './digest-cron.service';

/**
 * The Daily Brief is off unless DAILY_BRIEF_ENABLED is exactly "true". Off
 * means the 7:00 AM cron touches nothing: no lock, no recipients, no email.
 */
function setup(flag: string | undefined) {
  const config = { get: jest.fn(() => flag) };
  const prisma = { user: { findMany: jest.fn(async () => []) }, digestRun: { create: jest.fn() } };
  const lock = { run: jest.fn(async (_key: string, fn: () => Promise<any>) => fn()) };
  const mailer = { sendInternalHtml: jest.fn() };
  const svc = new DigestCronService(
    config as any,
    prisma as any,
    { build: jest.fn() } as any,
    {} as any,
    mailer as any,
    lock as any,
  );
  return { svc, prisma, lock, mailer };
}

describe('DigestCronService switch', () => {
  it.each([[undefined], ['false'], [''], ['TRUE'], ['1']])('does nothing when the flag is %p', async (flag) => {
    const { svc, prisma, lock, mailer } = setup(flag);
    expect(svc.enabled).toBe(false);
    await svc.sendDailyBrief();
    expect(lock.run).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(mailer.sendInternalHtml).not.toHaveBeenCalled();
  });

  it('runs the send when the flag is exactly "true"', async () => {
    const { svc, prisma, lock } = setup('true');
    expect(svc.enabled).toBe(true);
    await svc.sendDailyBrief();
    expect(lock.run).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
  });
});
