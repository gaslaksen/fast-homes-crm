import {
  describeMailgunError,
  isMailgunRateLimit,
  parseMailgunRetryAfter,
} from './mailer.service';

describe('describeMailgunError', () => {
  it('surfaces the API explanation behind a bare status text', () => {
    // The shape mailgun.js throws: message is only the status text, and the
    // reason that actually tells you what to fix is on details.
    const err = Object.assign(new Error('Forbidden'), {
      status: 403,
      details: 'Free accounts are for test purposes only. Please upgrade or add the address to authorized recipients.',
    });
    const out = describeMailgunError(err);

    expect(out).toContain('HTTP 403');
    expect(out).toContain('Forbidden');
    expect(out).toContain('authorized recipients');
  });

  it('reads the explanation off body.message when that is where it landed', () => {
    const err = Object.assign(new Error('Forbidden'), {
      status: 403,
      body: { message: 'Domain crm.example.com is not allowed to send' },
    });
    expect(describeMailgunError(err)).toContain('not allowed to send');
  });

  it('reads it off response.body.message too', () => {
    const err = Object.assign(new Error('Too Many Requests'), {
      status: 429,
      response: { body: { message: 'Rate limit exceeded' } },
    });
    const out = describeMailgunError(err);
    expect(out).toContain('HTTP 429');
    expect(out).toContain('Rate limit exceeded');
  });

  it('serializes a structured detail rather than printing [object Object]', () => {
    const err = Object.assign(new Error('Bad Request'), {
      status: 400,
      details: { message: 'to parameter is not a valid address' },
    });
    const out = describeMailgunError(err);
    expect(out).toContain('not a valid address');
    expect(out).not.toContain('[object Object]');
  });

  it('degrades gracefully for a plain error, a bare status, and nothing at all', () => {
    expect(describeMailgunError(new Error('socket hang up'))).toBe('socket hang up');
    expect(describeMailgunError(Object.assign(new Error('Forbidden'), { statusCode: 403 })))
      .toBe('HTTP 403 Forbidden');
    expect(describeMailgunError(undefined)).toBe('unknown error');
    expect(describeMailgunError({})).toBe('unknown error');
  });
});

describe('isMailgunRateLimit', () => {
  // Both of these are verbatim from production.
  const recipientLimit = Object.assign(new Error('status code 420'), {
    status: 420,
    details: 'Domain crm.quickcashhomebuyers.com is not allowed to send: recipient limit (26) exceeded, try again after Wed, 05 Aug 2026 18:40:30 UTC',
  });
  const dailyLimit = Object.assign(new Error('Too Many Requests'), {
    status: 429,
    details: 'Domain crm.quickcashhomebuyers.com is not allowed to send: daily request limit (100) exceeded, try again after Thu, 06 Aug 2026 14:05:00 UTC',
  });

  it('recognises the statuses Mailgun actually uses for limits', () => {
    expect(isMailgunRateLimit(recipientLimit)).toBe(true);
    expect(isMailgunRateLimit(dailyLimit)).toBe(true);
  });

  it('recognises a limit by its wording even on an unfamiliar status', () => {
    expect(isMailgunRateLimit(Object.assign(new Error('Forbidden'), {
      status: 403,
      details: 'hourly request limit (100) exceeded, try again after Thu, 06 Aug 2026 14:05:00 UTC',
    }))).toBe(true);
  });

  it('does not mistake a real failure for throttling', () => {
    expect(isMailgunRateLimit(Object.assign(new Error('Bad Request'), {
      status: 400, details: 'to parameter is not a valid address',
    }))).toBe(false);
    expect(isMailgunRateLimit(new Error('socket hang up'))).toBe(false);
    expect(isMailgunRateLimit(undefined)).toBe(false);
  });

  it('reads the retry time Mailgun quotes, in preference to guessing', () => {
    const now = new Date('2026-08-05T18:40:25Z');
    expect(parseMailgunRetryAfter(recipientLimit, now)?.toISOString())
      .toBe('2026-08-05T18:40:30.000Z');
    expect(parseMailgunRetryAfter(dailyLimit, now)?.toISOString())
      .toBe('2026-08-06T14:05:00.000Z');
  });

  it('prefers a Retry-After header when one is present', () => {
    const now = new Date('2026-08-05T18:40:25Z');
    const err = Object.assign(new Error('Too Many Requests'), {
      status: 429, headers: { 'retry-after': '120' },
    });
    expect(parseMailgunRetryAfter(err, now)?.toISOString()).toBe('2026-08-05T18:42:25.000Z');
  });

  it('returns null when there is no usable time, so the caller falls back', () => {
    const now = new Date('2026-08-05T18:40:25Z');
    expect(parseMailgunRetryAfter(new Error('Too Many Requests'), now)).toBeNull();
    // A quoted time already in the past tells us nothing.
    expect(parseMailgunRetryAfter(recipientLimit, new Date('2026-08-06T00:00:00Z'))).toBeNull();
  });
});
