import { TwilioVoiceService } from './twilio-voice.service';

const AGENT_SID = 'CAagent';
const CUSTOMER_SID = 'CAcustomer';
const CONF_SID = 'CFconf';
const CONF_NAME = `dc-${AGENT_SID}`;

type Log = {
  twilioCallSid: string;
  conferenceName: string;
  customerCallSid: string | null;
  transferState: string | null;
};

/**
 * Records what the service asked Twilio to do, so the assertions are about
 * real API calls rather than internal state.
 */
function harness(log: Partial<Log> = {}) {
  const calls: { sid: string; status: string }[] = [];
  const conferences: { sid: string; status: string }[] = [];

  const callLog: Log = {
    twilioCallSid: AGENT_SID,
    conferenceName: CONF_NAME,
    customerCallSid: CUSTOMER_SID,
    transferState: null,
    ...log,
  };

  const prisma = {
    callLog: {
      findFirst: async () => callLog,
      updateMany: async () => ({ count: 1 }),
      update: async () => callLog,
    },
  } as any;

  const twilioClient = {
    calls: (sid: string) => ({
      update: async ({ status }: any) => {
        // Twilio rejects 'completed' on a leg that has not been answered.
        if (status === 'completed' && (twilioClient as any)._ringing) {
          throw new Error('Cannot complete a ringing call');
        }
        calls.push({ sid, status });
        return {};
      },
    }),
    conferences: (sid: string) => ({
      update: async ({ status }: any) => {
        conferences.push({ sid, status });
        return {};
      },
    }),
    _ringing: false,
  };

  const svc = new TwilioVoiceService(
    { get: () => undefined } as any,
    prisma,
    null as any,
    { resolve: async () => '', defaultFor: async () => '' } as any,
    { findLeadByPhone: async () => null } as any,
  );
  (svc as any).client = () => twilioClient;

  return { svc, calls, conferences, twilioClient };
}

const leaveEvent = (over: Record<string, string> = {}) => ({
  StatusCallbackEvent: 'participant-leave',
  FriendlyName: CONF_NAME,
  ConferenceSid: CONF_SID,
  CallSid: AGENT_SID,
  ParticipantLabel: 'agent',
  ...over,
});

describe('hanging up in the browser', () => {
  it('ends the seller leg, not just the conference', async () => {
    // The bug this covers: the browser call ended but the seller's phone kept
    // ringing, and answering it dropped them into wait audio on their own.
    const { svc, calls, conferences } = harness();
    await svc.handleConferenceStatus(leaveEvent());

    expect(calls).toEqual([{ sid: CUSTOMER_SID, status: 'completed' }]);
    expect(conferences).toEqual([{ sid: CONF_SID, status: 'completed' }]);
  });

  it('cancels a seller leg that is still ringing', async () => {
    const { svc, calls, twilioClient } = harness();
    twilioClient._ringing = true;

    await svc.handleConferenceStatus(leaveEvent());

    // 'completed' is refused before answer, so it must fall back to 'canceled'.
    expect(calls).toEqual([{ sid: CUSTOMER_SID, status: 'canceled' }]);
  });

  it('identifies the agent by CallSid when the label is missing', async () => {
    const { svc, calls } = harness();
    await svc.handleConferenceStatus(leaveEvent({ ParticipantLabel: '' }));
    expect(calls).toHaveLength(1);
  });

  it('ignores the seller leaving, which already ends the conference itself', async () => {
    const { svc, calls, conferences } = harness();
    await svc.handleConferenceStatus(
      leaveEvent({ CallSid: CUSTOMER_SID, ParticipantLabel: 'customer' }),
    );
    expect(calls).toEqual([]);
    expect(conferences).toEqual([]);
  });

  it('leaves the call up when the agent left because of a transfer', async () => {
    // Otherwise completing a transfer would hang up on the seller.
    const { svc, calls, conferences } = harness({ transferState: 'transferred' });
    await svc.handleConferenceStatus(leaveEvent());
    expect(calls).toEqual([]);
    expect(conferences).toEqual([]);
  });

  it('still tears down mid-consult, when the agent gives up on a warm transfer', async () => {
    const { svc, calls } = harness({ transferState: 'warm_consulting' });
    await svc.handleConferenceStatus(leaveEvent());
    expect(calls).toEqual([{ sid: CUSTOMER_SID, status: 'completed' }]);
  });

  it('ends the conference even with no seller leg recorded', async () => {
    const { svc, calls, conferences } = harness({ customerCallSid: null });
    await svc.handleConferenceStatus(leaveEvent());
    expect(calls).toEqual([]);
    expect(conferences).toEqual([{ sid: CONF_SID, status: 'completed' }]);
  });
});

/**
 * Ending the last leg usually empties the conference, and Twilio removes an
 * empty conference itself. The explicit close that follows then 404s. That is
 * the success path, so it must not look like a failure in the logs.
 */
describe('conference already gone', () => {
  it('treats a 404 from ending the conference as success', async () => {
    const { svc, calls } = harness();
    const notFound: any = new Error('The requested resource ... was not found');
    notFound.status = 404;
    notFound.code = 20404;
    (svc as any).client = () => ({
      calls: () => ({ update: async () => { calls.push({ sid: CUSTOMER_SID, status: 'completed' }); return {}; } }),
      conferences: () => ({ update: async () => { throw notFound; } }),
    });

    const warnSpy = jest.spyOn((svc as any).logger, 'warn');
    await expect(svc.handleConferenceStatus(leaveEvent())).resolves.toBeUndefined();

    // The seller leg still ended; only the redundant conference close 404'd.
    expect(calls).toEqual([{ sid: CUSTOMER_SID, status: 'completed' }]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('still warns on a real failure', async () => {
    const { svc } = harness();
    (svc as any).client = () => ({
      calls: () => ({ update: async () => ({}) }),
      conferences: () => ({ update: async () => { throw new Error('503 upstream'); } }),
    });
    const warnSpy = jest.spyOn((svc as any).logger, 'warn');
    await svc.handleConferenceStatus(leaveEvent());
    expect(warnSpy).toHaveBeenCalled();
  });
});
