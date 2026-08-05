import { describeMailgunError } from './mailer.service';

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
