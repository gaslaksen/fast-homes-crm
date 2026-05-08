import {
  normalizeSmsBodyForCompare,
  sanitizeOutboundSmsBody,
} from './sms-body-normalize.util';

describe('sanitizeOutboundSmsBody', () => {
  it('returns empty string for empty/null input', () => {
    expect(sanitizeOutboundSmsBody('')).toBe('');
    expect(sanitizeOutboundSmsBody(null as any)).toBe('');
  });

  it('replaces em dashes with hyphens', () => {
    expect(sanitizeOutboundSmsBody('Got it — that helps')).toBe('Got it - that helps');
  });

  it('replaces en dashes with hyphens', () => {
    expect(sanitizeOutboundSmsBody('A – B')).toBe('A - B');
  });

  it('replaces curly double quotes with straight', () => {
    expect(sanitizeOutboundSmsBody('She said “hi”')).toBe('She said "hi"');
  });

  it('replaces curly apostrophes with straight', () => {
    expect(sanitizeOutboundSmsBody("don’t worry")).toBe("don't worry");
  });

  it('replaces ellipsis char with three dots', () => {
    expect(sanitizeOutboundSmsBody('hold on…')).toBe('hold on...');
  });

  it('preserves newlines (paragraph breaks for portal URLs etc.)', () => {
    const portal = 'Check this page:\nhttps://mydealcore.com/seller/abc\n\nThanks!';
    expect(sanitizeOutboundSmsBody(portal)).toBe(portal);
  });

  it('strips zero-width spaces', () => {
    expect(sanitizeOutboundSmsBody('foo​bar')).toBe('foobar');
  });

  it('replaces non-breaking spaces with regular spaces', () => {
    expect(sanitizeOutboundSmsBody('foo bar')).toBe('foo bar');
  });

  it('leaves clean ASCII text untouched', () => {
    const clean = "Hi Meghan, this is Dax. How's it going?";
    expect(sanitizeOutboundSmsBody(clean)).toBe(clean);
  });
});

describe('normalizeSmsBodyForCompare', () => {
  it('returns empty string for empty/null input', () => {
    expect(normalizeSmsBodyForCompare('')).toBe('');
    expect(normalizeSmsBodyForCompare(null as any)).toBe('');
    expect(normalizeSmsBodyForCompare(undefined as any)).toBe('');
  });

  it('treats em dash and hyphen as equal (the Meghan Kinee bug)', () => {
    const aiBody = 'Got it, $300k and flexible timing — that helps.';
    const carrierBody = 'Got it, $300k and flexible timing - that helps.';
    expect(normalizeSmsBodyForCompare(aiBody)).toBe(
      normalizeSmsBodyForCompare(carrierBody),
    );
  });

  it('treats en dash and hyphen as equal', () => {
    expect(normalizeSmsBodyForCompare('A – B')).toBe(normalizeSmsBodyForCompare('A - B'));
  });

  it('treats curly and straight double quotes as equal', () => {
    expect(normalizeSmsBodyForCompare('She said “hi”')).toBe(
      normalizeSmsBodyForCompare('She said "hi"'),
    );
  });

  it('treats curly and straight apostrophes as equal', () => {
    expect(normalizeSmsBodyForCompare("don’t worry")).toBe(
      normalizeSmsBodyForCompare("don't worry"),
    );
  });

  it('treats single ellipsis char and three dots as equal', () => {
    expect(normalizeSmsBodyForCompare('hold on…')).toBe(
      normalizeSmsBodyForCompare('hold on...'),
    );
  });

  it('collapses whitespace and normalizes line endings', () => {
    expect(normalizeSmsBodyForCompare('foo\r\nbar  \tbaz')).toBe('foo bar baz');
  });

  it('strips non-breaking spaces and zero-width spaces', () => {
    expect(normalizeSmsBodyForCompare('foo bar​baz')).toBe('foo barbaz');
  });

  it('leaves identical ASCII-only text unchanged (modulo trim)', () => {
    expect(normalizeSmsBodyForCompare('  hello world  ')).toBe('hello world');
  });
});
