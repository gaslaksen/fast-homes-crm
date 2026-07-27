import { TwilioVoiceService } from './twilio-voice.service';

/**
 * listCallerIds() / resolveCallerId() only read config, so a stub ConfigService
 * is enough. resolveCallerId is private but is the anti-spoofing gate for a
 * client-supplied caller ID, so it is worth testing directly.
 */
function svcWith(env: Record<string, string | undefined>) {
  const config = { get: (k: string) => env[k] } as any;
  return new TwilioVoiceService(config, null as any, null as any);
}

const MAIN = '+18885748121';
const CLT = '+17045299523';

describe('listCallerIds', () => {
  it('falls back to TWILIO_PHONE_NUMBER when the list is unset', () => {
    const svc = svcWith({ TWILIO_PHONE_NUMBER: MAIN });
    expect(svc.listCallerIds()).toEqual([{ number: MAIN, label: 'Main' }]);
  });

  it('returns nothing when neither var is set', () => {
    expect(svcWith({}).listCallerIds()).toEqual([]);
  });

  it('parses a labelled two-number list in order', () => {
    const svc = svcWith({ TWILIO_CALLER_IDS: `Main:${MAIN},Charlotte:${CLT}` });
    expect(svc.listCallerIds()).toEqual([
      { number: MAIN, label: 'Main' },
      { number: CLT, label: 'Charlotte' },
    ]);
  });

  it('labels unlabelled entries with their formatted number, not a shared word', () => {
    const svc = svcWith({ TWILIO_CALLER_IDS: `${MAIN},${CLT}` });
    expect(svc.listCallerIds()).toEqual([
      { number: MAIN, label: '(888) 574-8121' },
      { number: CLT, label: '(704) 529-9523' },
    ]);
  });

  it('tolerates whitespace around entries', () => {
    const svc = svcWith({ TWILIO_CALLER_IDS: `  Main : ${MAIN} ,  Charlotte:${CLT}  ` });
    expect(svc.listCallerIds().map((c) => c.number)).toEqual([MAIN, CLT]);
  });

  it('drops a duplicate number, keeping the first entry', () => {
    const svc = svcWith({ TWILIO_CALLER_IDS: `Main:${MAIN},Dup:${MAIN}` });
    expect(svc.listCallerIds()).toEqual([{ number: MAIN, label: 'Main' }]);
  });

  it('ignores TWILIO_PHONE_NUMBER once an explicit list exists', () => {
    const svc = svcWith({ TWILIO_PHONE_NUMBER: '+15550000000', TWILIO_CALLER_IDS: `Charlotte:${CLT}` });
    expect(svc.listCallerIds()).toEqual([{ number: CLT, label: 'Charlotte' }]);
  });
});

describe('resolveCallerId', () => {
  const svc = svcWith({ TWILIO_CALLER_IDS: `Main:${MAIN},Charlotte:${CLT}` });
  const resolve = (req?: string) => (svc as any).resolveCallerId(req);

  it('defaults to the first entry when the client sends nothing', () => {
    expect(resolve(undefined)).toBe(MAIN);
  });

  it('honours an allowlisted number', () => {
    expect(resolve(CLT)).toBe(CLT);
  });

  it('matches on the last ten digits regardless of formatting', () => {
    expect(resolve('(704) 529-9523')).toBe(CLT);
    expect(resolve('7045299523')).toBe(CLT);
  });

  it('rejects a number that is not on the allowlist', () => {
    // This is the spoofing guard: the browser can ask for anything.
    expect(resolve('+15551234567')).toBe(MAIN);
  });
});
