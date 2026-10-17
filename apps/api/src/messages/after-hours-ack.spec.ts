import { MessagesService } from './messages.service';

/**
 * The after-hours acknowledgement promises a reply in the morning, so it may
 * only go to a lead the morning auto-response will actually answer. It used to
 * go to everyone, which meant claimants (auto-respond off) got a bot text at
 * 3am and then nothing.
 */
function build(lead: any, canAutoRespond: boolean) {
  const prisma: any = {
    dripSettings: { findUnique: jest.fn().mockResolvedValue({ demoMode: false }) },
    lead: { findUnique: jest.fn().mockResolvedValue(lead) },
  };
  const config: any = {
    get: (key: string, fallback?: any) => (key === 'ALLOW_SIMULATED_SMS' ? 'true' : fallback),
  };
  const none = {} as any;
  const service = new MessagesService(
    prisma, none, config, none, none, none, none, none, none, none, none,
  );
  jest.spyOn(service as any, 'canAutoRespond').mockResolvedValue(canAutoRespond);
  jest.spyOn(service as any, 'replyToFor').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'sendAutoResponse').mockResolvedValue(null);
  const send = jest.spyOn(service, 'sendMessage').mockResolvedValue({} as any);
  return { service, send };
}

describe('MessagesService after-hours acknowledgement', () => {
  beforeEach(() => {
    // 3am Eastern, inside quiet hours.
    jest.useFakeTimers({ now: new Date('2026-10-17T07:00:00Z') });
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('is not sent to a lead with auto-respond off, such as a surplus claimant', async () => {
    const { service, send } = build(
      { id: 'lead-claimant', source: 'SURPLUS', sellerFirstName: 'Ann', autoRespond: false },
      false,
    );
    await (service as any).scheduleAutoResponse('lead-claimant', {});
    expect(send).not.toHaveBeenCalled();
  });

  it('is still sent to a seller the morning reply will answer', async () => {
    const { service, send } = build(
      { id: 'lead-seller', source: 'PROPERTY_LEADS', sellerFirstName: 'Bob', autoRespond: true },
      true,
    );
    await (service as any).scheduleAutoResponse('lead-seller', {});
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('lead-seller');
  });

  it('holds the full reply until 6am Eastern instead of sending it at once', async () => {
    const { service } = build(
      { id: 'lead-seller', source: 'PROPERTY_LEADS', sellerFirstName: 'Bob', autoRespond: true },
      true,
    );
    const reply = (service as any).sendAutoResponse as jest.Mock;
    await (service as any).scheduleAutoResponse('lead-seller', {});

    await jest.advanceTimersByTimeAsync(60_000);
    expect(reply).not.toHaveBeenCalled();

    // 3am to 6am Eastern.
    await jest.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
    expect(reply).toHaveBeenCalledTimes(1);
  });
});
