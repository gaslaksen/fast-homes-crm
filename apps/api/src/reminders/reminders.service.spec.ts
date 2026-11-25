import { RemindersService } from './reminders.service';

/**
 * Production runs two API replicas and the cron fires on both. These pin the
 * claim that keeps a task to one email, the query that leaves unassigned
 * tasks alone, and the retry after a failed send.
 */
function task(id: string, overrides: any = {}) {
  return {
    id,
    title: `Call back ${id}`,
    description: null,
    dueDate: new Date('2026-11-25T14:00:00Z'),
    user: { email: `${id}@example.test` },
    lead: { id: `lead-${id}`, sellerFirstName: 'Pat', sellerLastName: 'Doe', propertyAddress: '1 Main St' },
    ...overrides,
  };
}

function setup(opts: { tasks?: any[]; sendFails?: boolean } = {}) {
  // Shared between "replicas": a claim is won only while the flag is false.
  const reminded = new Set<string>();
  const queries: any[] = [];
  const prisma = {
    task: {
      findMany: jest.fn(async (args: any) => {
        queries.push(args);
        return opts.tasks ?? [];
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (data.reminderSent === true) {
          if (where.reminderSent !== false || reminded.has(where.id)) return { count: 0 };
          reminded.add(where.id);
          return { count: 1 };
        }
        reminded.delete(where.id);
        return { count: 1 };
      }),
    },
  };
  const mailer = {
    sendDealPackage: jest.fn(async () => {
      if (opts.sendFails) throw new Error('Mailgun down');
    }),
  };
  const config = { get: () => 'https://app.example.test' };
  const make = () => new RemindersService(prisma as any, mailer as any, config as any);
  return { make, prisma, mailer, queries, reminded };
}

describe('RemindersService', () => {
  it('only asks for due, open, unreminded tasks that someone is assigned to', async () => {
    const { make, queries } = setup();
    await make().processReminders();
    expect(queries).toHaveLength(1);
    expect(queries[0].where).toMatchObject({
      completed: false,
      reminderSent: false,
      userId: { not: null },
    });
    expect(queries[0].where.dueDate.lte).toBeInstanceOf(Date);
    expect(queries[0].take).toBeGreaterThan(0);
  });

  it('sends one email per task when both replicas run at once', async () => {
    const { make, mailer } = setup({ tasks: [task('a'), task('b')] });
    const [x, y] = await Promise.all([make().processReminders(), make().processReminders()]);
    expect(x + y).toBe(2);
    expect(mailer.sendDealPackage).toHaveBeenCalledTimes(2);
    const to = (mailer.sendDealPackage.mock.calls as any[]).map((c) => c[0]).sort();
    expect(to).toEqual(['a@example.test', 'b@example.test']);
  });

  it('marks the task reminded after a send', async () => {
    const { make, reminded } = setup({ tasks: [task('a')] });
    await make().processReminders();
    expect(reminded.has('a')).toBe(true);
  });

  it('gives the claim back when the email fails, so the next run retries', async () => {
    const { make, reminded } = setup({ tasks: [task('a')], sendFails: true });
    expect(await make().processReminders()).toBe(0);
    expect(reminded.has('a')).toBe(false);
  });

  it('skips a task whose user has no email without claiming it', async () => {
    const { make, prisma, mailer } = setup({ tasks: [task('a', { user: { email: null } })] });
    await make().processReminders();
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
    expect(mailer.sendDealPackage).not.toHaveBeenCalled();
  });

  it('does nothing and logs nothing when no task is due', async () => {
    const { make, prisma } = setup();
    const svc = make();
    const log = jest.spyOn((svc as any).logger, 'log');
    expect(await svc.processReminders()).toBe(0);
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
