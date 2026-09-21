import { BadRequestException, HttpException } from '@nestjs/common';
import { WebInquiriesService, normalizeUsPhone } from './web-inquiries.service';
import { DIGDEEPER_CONSENT_TEXT, DIGDEEPER_CONSENT_VERSION, INQUIRY_RATE_LIMIT } from './web-inquiries.constants';

function build() {
  const create = jest.fn(async ({ data }: any) => ({ id: 'inq_1', createdAt: new Date('2026-09-21T12:00:00Z'), ...data }));
  const prisma: any = { webInquiry: { create } };
  const mailer: any = { sendInternalHtml: jest.fn(async () => ({ mailgunId: 'm1' })) };
  const config: any = { get: jest.fn(() => undefined) };
  const svc = new WebInquiriesService(prisma, mailer, config);
  return { svc, create, mailer, config };
}

const base = {
  fullName: 'Pat Example',
  smsMarketingConsent: false,
  smsServiceConsent: false,
  consentVersion: DIGDEEPER_CONSENT_VERSION,
};
const ctx = { ip: '203.0.113.9', userAgent: 'jest' };

describe('normalizeUsPhone', () => {
  it('accepts 10 digits and 11 digits starting with 1, in any punctuation', () => {
    expect(normalizeUsPhone('(904) 595-9620')).toBe('+19045959620');
    expect(normalizeUsPhone('1-904-595-9620')).toBe('+19045959620');
  });
  it('rejects anything else', () => {
    expect(normalizeUsPhone('595-9620')).toBeNull();
    expect(normalizeUsPhone('2904595962011')).toBeNull();
    expect(normalizeUsPhone('')).toBeNull();
  });
});

describe('WebInquiriesService', () => {
  it('stores an inquiry with no consent and tells the team not to text', async () => {
    const { svc, create, mailer } = build();
    const out = await svc.createDigDeeperInquiry({ ...base, phone: '904 595 9620' } as any, ctx);
    expect(out).toEqual({ ok: true });
    const data = create.mock.calls[0][0].data;
    expect(data.phone).toBe('+19045959620');
    expect(data.smsMarketingConsent).toBe(false);
    expect(data.consentText).toBeNull();
    expect(data.consentedAt).toBeNull();
    expect(data.ipAddress).toBe('203.0.113.9');
    await new Promise((r) => setImmediate(r));
    expect(mailer.sendInternalHtml).toHaveBeenCalledTimes(1);
    const mail = mailer.sendInternalHtml.mock.calls[0][0];
    expect(mail.to).toBe('deals@digdeeperllc.com');
    expect(mail.text).toContain('Do not text this person');
  });

  it('records the exact wording for each box that was ticked, and only those', async () => {
    const { svc, create } = build();
    await svc.createDigDeeperInquiry({ ...base, phone: '9045959620', smsServiceConsent: true } as any, ctx);
    const data = create.mock.calls[0][0].data;
    const wording = DIGDEEPER_CONSENT_TEXT[DIGDEEPER_CONSENT_VERSION];
    expect(data.consentText).toBe(wording.service);
    expect(data.consentText).not.toContain(wording.marketing);
    expect(data.consentVersion).toBe(DIGDEEPER_CONSENT_VERSION);
    expect(data.consentedAt).toBeInstanceOf(Date);
  });

  it('refuses consent with no phone number to attach it to', async () => {
    const { svc, create } = build();
    await expect(
      svc.createDigDeeperInquiry({ ...base, email: 'pat@example.com', smsMarketingConsent: true } as any, ctx),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses consent against a form version it holds no wording for', async () => {
    const { svc, create } = build();
    await expect(
      svc.createDigDeeperInquiry(
        { ...base, phone: '9045959620', smsMarketingConsent: true, consentVersion: '1999-01-01' } as any,
        ctx,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('needs a phone or an email, and rejects a malformed phone', async () => {
    const { svc } = build();
    await expect(svc.createDigDeeperInquiry({ ...base } as any, ctx)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createDigDeeperInquiry({ ...base, phone: '12345' } as any, ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('drops a honeypot submission silently: same answer, nothing stored or sent', async () => {
    const { svc, create, mailer } = build();
    const out = await svc.createDigDeeperInquiry({ ...base, phone: '9045959620', website: 'http://spam' } as any, ctx);
    expect(out).toEqual({ ok: true });
    expect(create).not.toHaveBeenCalled();
    expect(mailer.sendInternalHtml).not.toHaveBeenCalled();
  });

  it('keeps the inquiry when the team email fails', async () => {
    const { svc, create, mailer } = build();
    mailer.sendInternalHtml.mockRejectedValueOnce(new Error('mailgun down'));
    await expect(svc.createDigDeeperInquiry({ ...base, email: 'pat@example.com' } as any, ctx)).resolves.toEqual({
      ok: true,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rate limits one network address and leaves others alone', async () => {
    const { svc } = build();
    for (let i = 0; i < INQUIRY_RATE_LIMIT; i++) {
      await svc.createDigDeeperInquiry({ ...base, email: 'pat@example.com' } as any, ctx);
    }
    await expect(svc.createDigDeeperInquiry({ ...base, email: 'pat@example.com' } as any, ctx)).rejects.toBeInstanceOf(
      HttpException,
    );
    await expect(
      svc.createDigDeeperInquiry({ ...base, email: 'pat@example.com' } as any, { ip: '198.51.100.4', userAgent: null }),
    ).resolves.toEqual({ ok: true });
  });

  it('sends the notification to the configured address when one is set', async () => {
    const { svc, mailer, config } = build();
    config.get.mockImplementation((k: string) => (k === 'DIGDEEPER_INQUIRY_NOTIFY_TO' ? 'ian@example.com' : undefined));
    await svc.createDigDeeperInquiry({ ...base, email: 'pat@example.com' } as any, ctx);
    await new Promise((r) => setImmediate(r));
    expect(mailer.sendInternalHtml.mock.calls[0][0].to).toBe('ian@example.com');
  });
});
