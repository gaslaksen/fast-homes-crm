import { TwilioVoiceService } from './twilio-voice.service';
import { VoicemailService } from './voicemail.service';
import { voicemailAudioPath, voicemailGreetingFor } from './voicemail.util';

const API = 'https://api.example.com';
const DIG_DEEPER = '+19045959620';
const QUICK_CASH = '+18885748121';

function config(extra: Record<string, string> = {}) {
  const values: Record<string, string> = { API_URL: API, ...extra };
  return { get: (k: string) => values[k] } as any;
}

function voiceService(opts: { users?: { id: string }[] } = {}) {
  const prisma = {
    callLog: { upsert: jest.fn(async () => ({})), updateMany: jest.fn(async () => ({ count: 1 })) },
    user: { findMany: async () => opts.users ?? [{ id: 'agent-1' }] },
    lead: { findUnique: async () => null },
    $queryRaw: async () => [],
  } as any;
  const svc = new TwilioVoiceService(
    config(),
    prisma,
    null as any,
    { resolve: async () => '', defaultFor: async () => '' } as any,
    { findLeadByPhone: async () => null } as any,
    { record: async () => {} } as any,
  );
  jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
  return svc;
}

describe('voicemail greeting lookup', () => {
  it('matches the D.I.G. Deeper line in any format', () => {
    expect(voicemailGreetingFor(DIG_DEEPER)?.brand.key).toBe('digdeeper');
    expect(voicemailGreetingFor('(904) 595-9620')?.brand.key).toBe('digdeeper');
  });

  it('leaves every other number alone', () => {
    expect(voicemailGreetingFor(QUICK_CASH)).toBeNull();
    expect(voicemailGreetingFor('')).toBeNull();
    expect(voicemailGreetingFor(undefined)).toBeNull();
  });

  it('serves only files a greeting names', () => {
    expect(voicemailAudioPath('../../.env')).toBeNull();
    expect(voicemailAudioPath('README.md')).toBeNull();
  });
});

describe('inbound call routing', () => {
  it('sends an unanswered call on the D.I.G. Deeper line to voicemail', async () => {
    const twiml = await voiceService().generateIncomingTwiml({
      From: '+17045550100',
      To: DIG_DEEPER,
      CallSid: 'CA1',
    });
    expect(twiml).toContain(`action="${API}/calls/twilio/voicemail"`);
  });

  it('keeps the old hang-up behavior on a number with no greeting', async () => {
    const twiml = await voiceService().generateIncomingTwiml({
      From: '+17045550100',
      To: QUICK_CASH,
      CallSid: 'CA1',
    });
    expect(twiml).toContain(`action="${API}/calls/twilio/status"`);
    expect(twiml).not.toContain('<Record');
  });

  it('goes straight to voicemail when there is nobody to ring', async () => {
    const twiml = await voiceService({ users: [] }).generateIncomingTwiml({
      From: '+17045550100',
      To: DIG_DEEPER,
      CallSid: 'CA1',
    });
    expect(twiml).not.toContain('<Dial');
    expect(twiml).toContain('<Record');
  });
});

function voicemailHarness(opts: { lead?: any; callLog?: any } = {}) {
  const callLogRow = opts.callLog ?? { id: 'log-1' };
  const prisma = {
    callLog: {
      findUnique: jest.fn(async (args: any) =>
        args.select?.lead
          ? {
              fromNumber: '+17045550100',
              toNumber: DIG_DEEPER,
              duration: 12,
              createdAt: new Date('2026-10-13T14:00:00Z'),
              lead: opts.lead ?? null,
            }
          : callLogRow,
      ),
      update: jest.fn(async () => ({})),
    },
    lead: { update: jest.fn(async () => ({})) },
  } as any;
  const twilioVoice = {
    handleStatusCallback: jest.fn(async () => {}),
    callbackBase: () => API,
    recordingPlaybackUrl: (sid: string) => `${API}/calls/twilio/recording-media/${sid}`,
    transcribeRecording: jest.fn(async () => 'Hi, this is Ruth, my reference number is 4471.'),
    ringIdentities: async () => ['agent-1', 'agent-2'],
  } as any;
  const push = { notifyNewMessage: jest.fn(async () => {}), notifyUsers: jest.fn(async () => {}) } as any;
  const mailer = { sendInternalHtml: jest.fn(async () => ({ mailgunId: 'm1' })) } as any;
  const svc = new VoicemailService(config(), prisma, twilioVoice, push, mailer);
  jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
  return { svc, prisma, twilioVoice, push, mailer };
}

describe('VoicemailService', () => {
  it('plays the greeting and records when nobody answered', async () => {
    const { svc, twilioVoice } = voicemailHarness();
    const twiml = await svc.afterDialTwiml({ CallSid: 'CA1', To: DIG_DEEPER, DialCallStatus: 'no-answer' });

    // The CallLog bookkeeping /status used to do still happens.
    expect(twilioVoice.handleStatusCallback).toHaveBeenCalled();
    expect(twiml).toContain('D. I. G. Deeper');
    expect(twiml).toContain(`action="${API}/calls/twilio/voicemail/done"`);
    expect(twiml).toContain(`recordingStatusCallback="${API}/calls/twilio/voicemail/recording"`);
    expect(twiml).toContain('maxLength="180"');
  });

  it('does nothing more once someone picked up', async () => {
    const { svc } = voicemailHarness();
    const twiml = await svc.afterDialTwiml({ CallSid: 'CA1', To: DIG_DEEPER, DialCallStatus: 'completed' });
    expect(twiml).not.toContain('<Record');
    expect(twiml).not.toContain('<Say');
  });

  it('marks the call as a voicemail with its recording and length', async () => {
    const { svc, prisma } = voicemailHarness();
    jest.spyOn(svc as any, 'transcribeAndNotify').mockResolvedValue(undefined);
    await svc.handleRecording({
      CallSid: 'CA1',
      RecordingSid: 'RE1',
      RecordingStatus: 'completed',
      RecordingDuration: '12',
    });
    expect(prisma.callLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: expect.objectContaining({
        voicemail: true,
        recordingUrl: `${API}/calls/twilio/recording-media/RE1`,
        duration: 12,
      }),
    });
  });

  it('ignores a recording with nothing on it', async () => {
    const { svc, prisma } = voicemailHarness();
    await svc.handleRecording({ CallSid: 'CA1', RecordingSid: 'RE1', RecordingDuration: '0' });
    expect(prisma.callLog.update).not.toHaveBeenCalled();
  });

  it('puts a known caller on their thread and tells the lead owner', async () => {
    const lead = {
      id: 'lead-1',
      organizationId: 'org-1',
      assignedToUserId: null,
      sellerFirstName: 'Ruth',
      sellerLastName: 'Spencer',
      propertyAddress: '1 Main St',
    };
    const { svc, prisma, push, mailer } = voicemailHarness({ lead });
    await (svc as any).transcribeAndNotify('log-1', 'RE1');

    expect(prisma.callLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: { transcript: 'Hi, this is Ruth, my reference number is 4471.' },
    });
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: expect.objectContaining({
        lastMessageDirection: 'INBOUND',
        threadUnread: true,
        lastMessagePreview: 'Voicemail: Hi, this is Ruth, my reference number is 4471.',
      }),
    });
    expect(push.notifyNewMessage).toHaveBeenCalledWith(lead, expect.stringContaining('Voicemail:'));
    expect(push.notifyUsers).not.toHaveBeenCalled();
    expect(mailer.sendInternalHtml).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'deals@digdeeperllc.com', subject: 'Voicemail from Ruth Spencer' }),
    );
  });

  it('alerts everyone the call rang about an unknown caller', async () => {
    const { svc, prisma, push, mailer } = voicemailHarness();
    await (svc as any).transcribeAndNotify('log-1', 'RE1');

    expect(prisma.lead.update).not.toHaveBeenCalled();
    expect(push.notifyUsers).toHaveBeenCalledWith(
      ['agent-1', 'agent-2'],
      expect.objectContaining({ title: 'Voicemail from (704) 555-0100' }),
    );
    const mail = mailer.sendInternalHtml.mock.calls[0][0];
    expect(mail.text).toContain('No lead on file for this number');
    expect(mail.text).toContain('my reference number is 4471');
  });

  it('still alerts when the transcript cannot be made', async () => {
    const { svc, twilioVoice, push, mailer } = voicemailHarness();
    twilioVoice.transcribeRecording.mockRejectedValue(new Error('timeout'));
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    await (svc as any).transcribeAndNotify('log-1', 'RE1');

    expect(push.notifyUsers).toHaveBeenCalled();
    expect(mailer.sendInternalHtml.mock.calls[0][0].text).toContain('No transcript');
  });
});
