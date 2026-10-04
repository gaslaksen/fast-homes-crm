import { TwilioVoiceService } from './twilio-voice.service';

/**
 * Who the ring screen names on an inbound call. The name rides on the
 * <Client> as a callerName parameter, which the web dialer and the mobile app
 * both show in place of the bare number.
 */
function harness(opts: {
  lead?: { id: string; sellerFirstName: string; sellerLastName: string } | null;
  users?: any[];
  partners?: any[];
}) {
  const queryRaw = jest.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('"users"')) return opts.users || [];
    if (sql.includes('"partners"')) return opts.partners || [];
    return [];
  });
  const upsert = jest.fn(async () => ({}));
  const prisma = {
    callLog: { upsert },
    user: { findMany: async () => [{ id: 'agent-1' }] },
    lead: {
      findUnique: async () =>
        opts.lead ? { ...opts.lead, source: 'MANUAL' } : null,
    },
    $queryRaw: queryRaw,
  } as any;
  const leadPhones = {
    findLeadByPhone: async () => (opts.lead ? { leadId: opts.lead.id, isPrimary: true } : null),
  } as any;

  const svc = new TwilioVoiceService(
    { get: () => undefined } as any,
    prisma,
    null as any,
    { resolve: async () => '', defaultFor: async () => '' } as any,
    leadPhones,
    { record: async () => {} } as any,
  );
  const log = jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
  return { svc, queryRaw, upsert, log };
}

const params = { From: '+17046812994', To: '+19045959620', CallSid: 'CAin' };

describe('TwilioVoiceService inbound caller name', () => {
  it('names a lead and attaches it', async () => {
    const { svc, queryRaw, log } = harness({
      lead: { id: 'lead-1', sellerFirstName: 'Pat', sellerLastName: 'Seller' },
    });
    const twiml = await svc.generateIncomingTwiml(params);

    expect(twiml).toContain('name="callerName" value="Pat Seller"');
    expect(twiml).toContain('name="leadId" value="lead-1"');
    // A lead match never falls through to the user or partner tables.
    expect(queryRaw).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toContain('matched lead lead-1 (Pat Seller)');
  });

  it('names a teammate without attaching a lead', async () => {
    const { svc, upsert } = harness({
      users: [{ id: 'user-1', firstName: 'Terry', lastName: 'Agent' }],
    });
    const twiml = await svc.generateIncomingTwiml(params);

    expect(twiml).toContain('name="callerName" value="Terry Agent (team)"');
    expect(twiml).not.toContain('name="leadId"');
    expect((upsert.mock.calls[0] as any)[0].create.leadId).toBeNull();
  });

  it('names a partner with their company', async () => {
    const { svc } = harness({
      partners: [{ id: 'p-1', name: 'Bo Buyer', company: 'Acme Homes', type: 'buyer' }],
    });
    const twiml = await svc.generateIncomingTwiml(params);

    expect(twiml).toContain('name="callerName" value="Bo Buyer (Acme Homes)"');
  });

  it('still rings with just the number, and logs the miss', async () => {
    const { svc, log } = harness({});
    const twiml = await svc.generateIncomingTwiml(params);

    expect(twiml).toContain('<Client>');
    expect(twiml).not.toContain('callerName');
    expect(log.mock.calls[0][0]).toContain('no lead, user or partner on file');
  });

  it('still rings when the user or partner lookup fails', async () => {
    const { svc, queryRaw } = harness({});
    queryRaw.mockRejectedValueOnce(new Error('db down'));
    const twiml = await svc.generateIncomingTwiml(params);

    expect(twiml).toContain('<Client>');
  });
});
