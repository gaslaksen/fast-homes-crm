import { TwilioVoiceService } from './twilio-voice.service';
import { callOutcome, callerDisplayName, isMissedInbound } from './call-outcome.util';

/**
 * Missed inbound calls. Only the <Dial>'s own status says whether an agent
 * picked up, so the first dial outcome is kept, a caller who hangs up while it
 * rings is a missed call too, and a missed call from somebody on file marks
 * their lead's thread unread exactly once.
 */
function harness(row: { id: string; type: string; endedReason: string | null } | null, opts: {
  claimed?: number;
  call?: any;
  stuck?: { id: string }[];
} = {}) {
  const prisma = {
    callLog: {
      findUnique: jest.fn(async (args: any) => (args.where.twilioCallSid ? row : opts.call ?? null)),
      updateMany: jest.fn(async () => ({ count: opts.claimed ?? 1 })),
      findMany: jest.fn(async () => opts.stuck || []),
    },
    lead: { update: jest.fn(async () => ({})) },
  } as any;
  const svc = new TwilioVoiceService(
    { get: () => undefined } as any,
    prisma,
    null as any,
    { resolve: async () => '', defaultFor: async () => '' } as any,
    {} as any,
    { record: async () => {} } as any,
  );
  jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
  return { svc, prisma };
}

const INBOUND = { id: 'log-1', type: 'twilio_inbound', endedReason: null };
const TINA = { leadId: 'lead-kelly', fromNumber: '+13524678424', heir: { name: 'Tina Lynn Davis' } };

describe('TwilioVoiceService missed inbound calls', () => {
  it('marks the lead thread unread with who called when nobody answers', async () => {
    const { svc, prisma } = harness(INBOUND, { call: TINA });
    await svc.handleStatusCallback({ CallSid: 'CA1', DialCallStatus: 'no-answer' });

    expect(prisma.callLog.updateMany).toHaveBeenCalledWith({
      where: { id: 'log-1', endedReason: null },
      data: { status: 'completed', endedReason: 'no-answer' },
    });
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-kelly' },
      data: expect.objectContaining({
        lastMessagePreview: 'Missed call from Tina Lynn Davis at (352) 467-8424',
        lastMessageDirection: 'INBOUND',
        threadUnread: true,
      }),
    });
  });

  it('leaves the thread alone when an agent picked up', async () => {
    const { svc, prisma } = harness(INBOUND, { call: TINA });
    await svc.handleStatusCallback({ CallSid: 'CA1', DialCallStatus: 'completed', DialCallDuration: '145' });

    expect(prisma.callLog.updateMany).toHaveBeenCalledWith({
      where: { id: 'log-1', endedReason: null },
      data: { status: 'completed', endedReason: 'completed', duration: 145 },
    });
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it('never lets the parent CallStatus overwrite the dial outcome', async () => {
    const { svc, prisma } = harness({ ...INBOUND, endedReason: 'no-answer' });
    await svc.handleStatusCallback({ CallSid: 'CA1', CallStatus: 'completed', CallDuration: '40' });

    expect(prisma.callLog.updateMany).not.toHaveBeenCalled();
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it('reads a call that ended with no dial outcome as a caller who hung up while it rang', async () => {
    const { svc, prisma } = harness(INBOUND, { call: TINA });
    await svc.handleStatusCallback({ CallSid: 'CA1', CallStatus: 'completed' });

    expect(prisma.callLog.updateMany).toHaveBeenCalledWith({
      where: { id: 'log-1', endedReason: null },
      data: { status: 'completed', endedReason: 'caller-hangup' },
    });
    expect(prisma.lead.update).toHaveBeenCalled();
  });

  it('ignores ringing updates', async () => {
    const { svc, prisma } = harness(INBOUND);
    await svc.handleStatusCallback({ CallSid: 'CA1', CallStatus: 'ringing' });
    expect(prisma.callLog.updateMany).not.toHaveBeenCalled();
  });

  it('marks the thread only once when another callback already closed the call', async () => {
    const { svc, prisma } = harness(INBOUND, { call: TINA, claimed: 0 });
    await svc.handleStatusCallback({ CallSid: 'CA1', DialCallStatus: 'no-answer' });
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it('puts nothing on a thread for a caller not on file', async () => {
    const { svc, prisma } = harness(INBOUND, { call: { leadId: null, fromNumber: '+13524678427', heir: null } });
    await svc.handleStatusCallback({ CallSid: 'CA1', DialCallStatus: 'no-answer' });
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it('keeps the outbound dialer bookkeeping as it was', async () => {
    const { svc, prisma } = harness({ id: 'log-2', type: 'twilio_browser', endedReason: 'ringing' });
    await svc.handleStatusCallback({ CallSid: 'CA2', CallStatus: 'completed', CallDuration: '30' });
    expect(prisma.callLog.updateMany).toHaveBeenCalledWith({
      where: { twilioCallSid: 'CA2' },
      data: { status: 'completed', duration: 30, endedReason: 'completed' },
    });
  });

  it('sweeps inbound calls left ringing with no outcome as missed', async () => {
    const { svc, prisma } = harness(null, { stuck: [{ id: 'log-9' }], call: TINA });
    expect(await svc.sweepStuckInboundCalls()).toBe(1);
    expect(prisma.callLog.findMany.mock.calls[0][0].where).toMatchObject({
      type: 'twilio_inbound',
      status: 'in-progress',
      endedReason: null,
      voicemail: false,
    });
    expect(prisma.callLog.updateMany).toHaveBeenCalledWith({
      where: { id: 'log-9', endedReason: null },
      data: { status: 'completed', endedReason: 'caller-hangup' },
    });
    expect(prisma.lead.update).toHaveBeenCalled();
  });
});

describe('call outcome rules', () => {
  const now = new Date('2026-11-04T19:30:00Z');
  const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000);

  it('reads each inbound outcome', () => {
    expect(callOutcome({ type: 'twilio_inbound', endedReason: 'no-answer', createdAt: at(1) }, now)).toBe('missed');
    expect(callOutcome({ type: 'twilio_inbound', endedReason: 'caller-hangup', createdAt: at(1) }, now)).toBe('missed');
    expect(callOutcome({ type: 'twilio_inbound', endedReason: 'completed', createdAt: at(1) }, now)).toBe('answered');
    expect(callOutcome({ type: 'twilio_inbound', voicemail: true, endedReason: 'voicemail' }, now)).toBe('voicemail');
    expect(callOutcome({ type: 'twilio_browser', endedReason: 'no-answer' }, now)).toBe('outbound');
  });

  it('counts a row stuck ringing as missed only once it is old enough', () => {
    expect(isMissedInbound({ type: 'twilio_inbound', status: 'in-progress', createdAt: at(2) }, now)).toBe(false);
    expect(callOutcome({ type: 'twilio_inbound', status: 'in-progress', createdAt: at(2) }, now)).toBe('ringing');
    expect(isMissedInbound({ type: 'twilio_inbound', status: 'in-progress', createdAt: at(11) }, now)).toBe(true);
  });

  it('names the person and the claim only when they differ', () => {
    expect(callerDisplayName('Tina Lynn Davis', 'David G Kelly')).toBe('Tina Lynn Davis (re David G Kelly)');
    expect(callerDisplayName(null, 'David G Kelly')).toBe('David G Kelly');
    expect(callerDisplayName('DAVID G KELLY', 'David G Kelly')).toBe('DAVID G KELLY');
    expect(callerDisplayName('', '')).toBe('');
  });
});
