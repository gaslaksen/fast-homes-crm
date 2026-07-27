import { PhoneNumbersService, numberKey, prettyNumber, toE164 } from './phone-numbers.service';

const MAIN = '+18885748121';
const CLT = '+17045299523';

type Row = {
  id: string;
  number: string;
  label: string;
  smsEnabled: boolean;
  voiceEnabled: boolean;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
};

const row = (over: Partial<Row> & { number: string }): Row => ({
  id: over.number,
  label: 'x',
  smsEnabled: true,
  voiceEnabled: true,
  isDefault: false,
  active: true,
  sortOrder: 0,
  createdAt: new Date(0),
  ...over,
});

/**
 * Stub Prisma: findMany applies the same where-clause fields the service uses,
 * and message.findFirst is driven by a per-lead script so the sticky-number
 * rules can be exercised without a database.
 */
function svcWith(
  numbers: Row[],
  messages: { outbound?: { from: string }; inbound?: { to: string } } = {},
  env: Record<string, string | undefined> = {},
) {
  const prisma = {
    phoneNumber: {
      findMany: async ({ where, orderBy }: any) => {
        let out = numbers.filter((n) => {
          if (where?.active !== undefined && n.active !== where.active) return false;
          if (where?.smsEnabled !== undefined && n.smsEnabled !== where.smsEnabled) return false;
          if (where?.voiceEnabled !== undefined && n.voiceEnabled !== where.voiceEnabled) return false;
          return true;
        });
        out = [...out].sort((a, b) => a.sortOrder - b.sortOrder);
        return out;
      },
    },
    message: {
      findFirst: async ({ where }: any) =>
        where.direction === 'OUTBOUND' ? (messages.outbound ?? null) : (messages.inbound ?? null),
    },
  } as any;
  const config = { get: (k: string) => env[k] } as any;
  return new PhoneNumbersService(prisma, config);
}

describe('helpers', () => {
  it('numberKey reduces any spelling to the last ten digits', () => {
    expect(numberKey('+17045299523')).toBe('7045299523');
    expect(numberKey('(704) 529-9523')).toBe('7045299523');
    expect(numberKey('7045299523')).toBe('7045299523');
  });

  it('prettyNumber formats 10 and 11 digit forms', () => {
    expect(prettyNumber('+17045299523')).toBe('(704) 529-9523');
    expect(prettyNumber('7045299523')).toBe('(704) 529-9523');
  });

  it('prettyNumber leaves unrecognised input alone', () => {
    expect(prettyNumber('12345')).toBe('12345');
  });

  it('toE164 normalises US input and rejects junk', () => {
    expect(toE164('704 529 9523')).toBe('+17045299523');
    expect(toE164('17045299523')).toBe('+17045299523');
    expect(toE164('529-9523')).toBeNull();
    expect(toE164('')).toBeNull();
  });
});

describe('list', () => {
  it('filters by channel', async () => {
    const svc = svcWith([
      row({ number: MAIN, smsEnabled: true, voiceEnabled: false, sortOrder: 0 }),
      row({ number: CLT, smsEnabled: false, voiceEnabled: true, sortOrder: 1 }),
    ]);
    expect((await svc.list({ channel: 'sms' })).map((n) => n.number)).toEqual([MAIN]);
    expect((await svc.list({ channel: 'voice' })).map((n) => n.number)).toEqual([CLT]);
  });

  it('hides inactive numbers unless asked', async () => {
    const svc = svcWith([row({ number: MAIN, active: false })]);
    expect(await svc.list()).toEqual([]);
    expect((await svc.list({ includeInactive: true })).map((n) => n.number)).toEqual([MAIN]);
  });
});

describe('defaultFor', () => {
  it('prefers the flagged default over list order', async () => {
    const svc = svcWith([
      row({ number: MAIN, sortOrder: 0 }),
      row({ number: CLT, sortOrder: 1, isDefault: true }),
    ]);
    expect(await svc.defaultFor('sms')).toBe(CLT);
  });

  it('falls back to the first number when none is flagged', async () => {
    const svc = svcWith([row({ number: MAIN, sortOrder: 0 }), row({ number: CLT, sortOrder: 1 })]);
    expect(await svc.defaultFor('sms')).toBe(MAIN);
  });

  it('falls back to TWILIO_PHONE_NUMBER when the table is empty', async () => {
    const svc = svcWith([], {}, { TWILIO_PHONE_NUMBER: MAIN });
    expect(await svc.defaultFor('sms')).toBe(MAIN);
  });
});

describe('resolve', () => {
  const svc = () =>
    svcWith([row({ number: MAIN, isDefault: true, sortOrder: 0 }), row({ number: CLT, sortOrder: 1 })]);

  it('honours an allowlisted number in any spelling', async () => {
    expect(await svc().resolve('(704) 529-9523', 'sms')).toBe(CLT);
  });

  it('falls back to the default for a number we do not own', async () => {
    // The spoofing guard: the browser can ask for anything.
    expect(await svc().resolve('+15551234567', 'sms')).toBe(MAIN);
  });

  it('falls back when the number exists but not for this channel', async () => {
    const s = svcWith([
      row({ number: MAIN, isDefault: true }),
      row({ number: CLT, smsEnabled: false, sortOrder: 1 }),
    ]);
    expect(await s.resolve(CLT, 'sms')).toBe(MAIN);
  });

  it('returns the default when nothing is requested', async () => {
    expect(await svc().resolve(undefined, 'sms')).toBe(MAIN);
  });
});

describe('resolveForLead', () => {
  const numbers = [row({ number: MAIN, isDefault: true, sortOrder: 0 }), row({ number: CLT, sortOrder: 1 })];

  it('uses the default for a brand-new lead', async () => {
    expect(await svcWith(numbers).resolveForLead('lead1')).toBe(MAIN);
  });

  it('sticks to the number we last texted this lead from', async () => {
    const svc = svcWith(numbers, { outbound: { from: CLT } });
    expect(await svc.resolveForLead('lead1')).toBe(CLT);
  });

  it('uses the number the seller texted us on when we have never texted them', async () => {
    const svc = svcWith(numbers, { inbound: { to: CLT } });
    expect(await svc.resolveForLead('lead1')).toBe(CLT);
  });

  it('prefers our last outbound over their last inbound', async () => {
    const svc = svcWith(numbers, { outbound: { from: MAIN }, inbound: { to: CLT } });
    expect(await svc.resolveForLead('lead1')).toBe(MAIN);
  });

  it('abandons a sticky number that has since been deactivated', async () => {
    const svc = svcWith(
      [row({ number: MAIN, isDefault: true }), row({ number: CLT, active: false, sortOrder: 1 })],
      { outbound: { from: CLT } },
    );
    expect(await svc.resolveForLead('lead1')).toBe(MAIN);
  });

  it('lets an explicit choice override the sticky number', async () => {
    const svc = svcWith(numbers, { outbound: { from: CLT } });
    expect(await svc.resolveForLead('lead1', MAIN)).toBe(MAIN);
  });

  it('ignores an explicit choice we do not own, keeping the default', async () => {
    const svc = svcWith(numbers, { outbound: { from: CLT } });
    expect(await svc.resolveForLead('lead1', '+15551234567')).toBe(MAIN);
  });
});
