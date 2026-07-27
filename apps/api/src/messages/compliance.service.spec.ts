import { ComplianceService, ComplianceSettings } from './compliance.service';

const base: ComplianceSettings = {
  optOutEnabled: true,
  optOutText: 'Reply STOP to stop texting',
  senderIdEnabled: true,
  senderIdText: 'Quick Cash Home Buyers',
  periodicEnabled: false,
  periodicDays: 30,
};

// The service only touches Prisma in get()/update(); the footer logic under
// test here is pure, so a null client is enough.
const svc = new ComplianceService(null as any);

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('buildFooter', () => {
  it('puts sender ID above the opt-out line', () => {
    expect(svc.buildFooter(base)).toBe('Quick Cash Home Buyers\nReply STOP to stop texting');
  });

  it('omits a disabled part', () => {
    expect(svc.buildFooter({ ...base, senderIdEnabled: false })).toBe('Reply STOP to stop texting');
    expect(svc.buildFooter({ ...base, optOutEnabled: false })).toBe('Quick Cash Home Buyers');
  });

  it('is empty when both are off', () => {
    expect(svc.buildFooter({ ...base, senderIdEnabled: false, optOutEnabled: false })).toBe('');
  });

  it('treats blank custom text as nothing to add', () => {
    expect(svc.buildFooter({ ...base, senderIdText: '', optOutText: '' })).toBe('');
  });
});

describe('shouldAttachFooter', () => {
  it('attaches on the first message to a lead', async () => {
    await expect(svc.shouldAttachFooter(base, null)).resolves.toBe(true);
  });

  it('does not attach again when periodic re-send is off', async () => {
    await expect(svc.shouldAttachFooter(base, daysAgo(400))).resolves.toBe(false);
  });

  it('re-attaches once the interval has elapsed', async () => {
    const periodic = { ...base, periodicEnabled: true, periodicDays: 30 };
    await expect(svc.shouldAttachFooter(periodic, daysAgo(31))).resolves.toBe(true);
  });

  it('holds off inside the interval', async () => {
    const periodic = { ...base, periodicEnabled: true, periodicDays: 30 };
    await expect(svc.shouldAttachFooter(periodic, daysAgo(10))).resolves.toBe(false);
  });

  it('never attaches when there is no footer to attach', async () => {
    const off = { ...base, senderIdEnabled: false, optOutEnabled: false };
    await expect(svc.shouldAttachFooter(off, null)).resolves.toBe(false);
  });
});

describe('applyFooter', () => {
  const footer = 'Quick Cash Home Buyers\nReply STOP to stop texting';

  it('appends after a blank line', () => {
    expect(svc.applyFooter('Hey Russ, got it.', footer)).toBe(
      'Hey Russ, got it.\n\nQuick Cash Home Buyers\nReply STOP to stop texting',
    );
  });

  it('leaves the body alone when there is no footer', () => {
    expect(svc.applyFooter('Hey Russ', '')).toBe('Hey Russ');
  });

  it('skips a line the AI already wrote, keeping the rest', () => {
    // The live prompt does not forbid signing off, so this happens in practice.
    const body = 'Talk soon!\n\nQuick Cash Home Buyers';
    expect(svc.applyFooter(body, footer)).toBe(
      'Talk soon!\n\nQuick Cash Home Buyers\n\nReply STOP to stop texting',
    );
  });

  it('returns the body unchanged when every line is already present', () => {
    const body = 'Thanks!\n\nQuick Cash Home Buyers\nReply STOP to stop texting';
    expect(svc.applyFooter(body, footer)).toBe(body);
  });

  it('matches case-insensitively', () => {
    const body = 'Thanks!\n\nquick cash home buyers\nreply stop to stop texting';
    expect(svc.applyFooter(body, footer)).toBe(body);
  });

  it('trims trailing whitespace before appending', () => {
    expect(svc.applyFooter('Hey Russ   \n\n', 'Reply STOP to stop texting')).toBe(
      'Hey Russ\n\nReply STOP to stop texting',
    );
  });
});
