import { TwilioVoiceService } from './twilio-voice.service';

/**
 * The dialer opens on the first caller ID the API hands it, so the number
 * Settings > Phone Numbers marks as the default has to come back first and
 * flagged. It did not, and every call went out from the oldest number on the
 * list however the team set the default.
 */
function svc(numbers: any[]) {
  const phoneNumbers: any = { list: async () => numbers };
  return new TwilioVoiceService({} as any, {} as any, {} as any, phoneNumbers, {} as any, {} as any);
}

const num = (number: string, label: string, isDefault = false) => ({
  number,
  label,
  isDefault,
  smsEnabled: true,
  voiceEnabled: true,
  active: true,
  sortOrder: 0,
});

describe('the caller IDs the dialer is offered', () => {
  it('puts the default first and says which one it is', async () => {
    const list = await svc([
      num('+18885748121', 'Main'),
      num('+17045299523', 'Charlotte, NC'),
      num('+19045959620', 'Jacksonville, FL', true),
    ]).listCallerIds();

    expect(list[0]).toEqual({ number: '+19045959620', label: 'Jacksonville, FL', isDefault: true });
    expect(list.map((n) => n.number)).toEqual(['+19045959620', '+18885748121', '+17045299523']);
  });

  it('keeps the settings order among the rest', async () => {
    const list = await svc([
      num('+18885748121', 'Main', true),
      num('+17045299523', 'Charlotte, NC'),
      num('+19045959620', 'Jacksonville, FL'),
    ]).listCallerIds();

    expect(list.map((n) => n.label)).toEqual(['Main', 'Charlotte, NC', 'Jacksonville, FL']);
  });

  it('marks nothing as default when settings has no default', async () => {
    const list = await svc([num('+18885748121', 'Main')]).listCallerIds();

    expect(list).toEqual([{ number: '+18885748121', label: 'Main', isDefault: false }]);
  });
});
