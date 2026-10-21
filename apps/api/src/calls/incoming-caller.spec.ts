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
    // The iPhone's native ring screen reads this one.
    expect(twiml).toContain('name="DisplayName" value="Pat Seller"');
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
    // Never missing: the app's ring screen template would show it raw.
    expect(twiml).toContain('name="DisplayName" value="(704) 681-2994"');
    expect(log.mock.calls[0][0]).toContain('no lead, user or partner on file');
  });

  it('names a caller with no number at all', async () => {
    const { svc } = harness({});
    const twiml = await svc.generateIncomingTwiml({ ...params, From: '' });

    expect(twiml).toContain('name="DisplayName" value="Unknown caller"');
  });

  it('still rings when the user or partner lookup fails', async () => {
    const { svc, queryRaw } = harness({});
    queryRaw.mockRejectedValueOnce(new Error('db down'));
    const twiml = await svc.generateIncomingTwiml(params);

    expect(twiml).toContain('<Client>');
  });
});

describe('TwilioVoiceService inbound claimant with several claims', () => {
  function claimantHarness(match: { leadId: string; isPrimary: boolean; heirId?: string; heirRole?: string }) {
    const tapped = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      callLog: { upsert: jest.fn(async () => ({})) },
      user: { findMany: async () => [{ id: 'agent-1' }] },
      lead: {
        findUnique: async () => ({ id: match.leadId, sellerFirstName: 'Jean', sellerLastName: 'Fleurinor', source: 'SURPLUS' }),
      },
      surplusDetail: { updateMany: tapped },
      surplusHeir: { update: jest.fn(async () => ({})), updateMany: jest.fn(async () => ({})) },
      $queryRaw: jest.fn(async () => []),
    } as any;
    const liveClaimIdsOnNumber = jest.fn(async () => ['claim-1319', 'claim-1321']);
    const leadPhones = { findLeadByPhone: async () => match, liveClaimIdsOnNumber } as any;
    const svc = new TwilioVoiceService(
      { get: () => undefined } as any,
      prisma,
      null as any,
      { resolve: async () => '', defaultFor: async () => '' } as any,
      leadPhones,
      { record: async () => {} } as any,
    );
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
    return { svc, tapped, liveClaimIdsOnNumber };
  }

  it('marks every live claim on the number as reached, not just the one the call is filed on', async () => {
    const { svc, tapped } = claimantHarness({ leadId: 'claim-1319', isPrimary: true });
    await svc.generateIncomingTwiml({ From: '+19548054423', To: '+19045959620', CallSid: 'CAjean' });

    expect((tapped.mock.calls[0] as any)[0].where).toEqual({
      leadId: { in: ['claim-1319', 'claim-1321'] },
      tappedAt: null,
    });
  });

  it("marks only the matched claim when the caller is an heir, not the claimant", async () => {
    const { svc, tapped, liveClaimIdsOnNumber } = claimantHarness({
      leadId: 'claim-1319',
      isPrimary: false,
      heirId: 'heir-1',
      heirRole: 'heir',
    });
    await svc.generateIncomingTwiml({ From: '+19548054423', To: '+19045959620', CallSid: 'CAheir' });

    expect(liveClaimIdsOnNumber).not.toHaveBeenCalled();
    expect((tapped.mock.calls[0] as any)[0].where.leadId).toEqual({ in: ['claim-1319'] });
  });
});
