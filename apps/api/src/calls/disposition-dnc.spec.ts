import { LeadSource, SurplusCallOutcome, SurplusStage } from '@fast-homes/shared';
import { TwilioVoiceService } from './twilio-voice.service';

const CALL_SID = 'CAagent';
const CLAIMANT_NUMBER = '+13525550100';
const SON_NUMBER = '+13525550141';

/**
 * "Do not call" on a surplus call is a legal instruction for whoever was on
 * the line. A son saying it opts out the son, the way his STOP would, and
 * leaves the claimant reachable.
 */
function harness(toNumber: string, heirId: string | null = null, progress?: any, numbers?: any) {
  const writes: { model: string; op: string; args: any }[] = [];
  const record = (model: string, op: string) => async (args: any) => {
    writes.push({ model, op, args });
    return { count: 1 };
  };

  const prisma = {
    callLog: {
      findUnique: async () => ({
        id: 'log1',
        leadId: 'lead1',
        toNumber,
        heirId,
        lead: {
          id: 'lead1',
          source: LeadSource.SURPLUS,
          sellerFirstName: 'Dorothy',
          sellerLastName: 'Kessler',
          surplusDetail: { id: 'sd1', stage: SurplusStage.NEW, doNotCall: false },
        },
      }),
      updateMany: record('callLog', 'updateMany'),
    },
    activity: { create: record('activity', 'create') },
    task: { create: record('task', 'create') },
    lead: { update: record('lead', 'update') },
    surplusDetail: { update: record('surplusDetail', 'update'), updateMany: record('surplusDetail', 'updateMany') },
    surplusHeir: {
      update: record('surplusHeir', 'update'),
      updateMany: record('surplusHeir', 'updateMany'),
      findUnique: async ({ where }: any) => (where.id === 'heir-son' ? { name: 'ROBERT KESSLER' } : null),
    },
    campaignEnrollment: { updateMany: record('campaignEnrollment', 'updateMany') },
  } as any;

  const leadPhones = {
    heirIdForNumber: async (_leadId: string, number: string) => (number === SON_NUMBER ? 'heir-son' : null),
    flagContact: async (leadId: string, value: string, bad: boolean) => {
      writes.push({ model: 'badContacts', op: 'flag', args: { leadId, value, bad } });
      return { phones: [], emails: [] };
    },
  } as any;

  const svc = new TwilioVoiceService(
    { get: () => undefined } as any,
    prisma,
    null as any,
    {} as any,
    leadPhones,
    { record: async () => {} } as any,
    progress,
    numbers,
  );
  return { svc, writes };
}

describe('TwilioVoiceService.setDisposition who answered', () => {
  it('moves the number to the person who picked up and files the call and the contact under them', async () => {
    const progress = progressFake();
    const numbers = { reassign: jest.fn().mockResolvedValue({ moved: true, heirId: 'heir-son', name: 'ROBERT KESSLER', reattributed: { messages: 6, calls: 1 } }) };
    // The claimant's own number was dialled, and the son answered.
    const { svc, writes } = harness(CLAIMANT_NUMBER, null, progress, numbers);
    await svc.setDisposition(
      CALL_SID,
      { disposition: 'Follow Up', outcome: SurplusCallOutcome.SPOKE_RELATIVE, followUpAt: '2026-11-03T14:00:00Z', answeredBy: { heirId: 'heir-son' } },
      'u1',
    );
    expect(numbers.reassign).toHaveBeenCalledWith({ leadId: 'lead1', number: CLAIMANT_NUMBER, to: { heirId: 'heir-son' }, userId: 'u1' });
    const refiled = writes.find((w) => w.model === 'callLog' && w.args.data?.heirId !== undefined);
    expect(refiled?.args.data).toEqual({ heirId: 'heir-son' });
    expect(progress.contacted).toHaveBeenCalledWith('lead1', expect.objectContaining({ heirId: 'heir-son' }));
    const task = writes.find((w) => w.model === 'task');
    expect(task?.args.data.heirId).toBe('heir-son');
    expect(task?.args.data.title).toContain('ROBERT KESSLER');
  });

  it('leaves the number alone when the person it is filed under answered', async () => {
    const numbers = { reassign: jest.fn() };
    const { svc } = harness(SON_NUMBER, null, progressFake(), numbers);
    await svc.setDisposition(
      CALL_SID,
      { disposition: 'Follow Up', outcome: SurplusCallOutcome.SPOKE_RELATIVE, followUpAt: '2026-11-03T14:00:00Z', answeredBy: { heirId: 'heir-son' } },
      'u1',
    );
    expect(numbers.reassign).not.toHaveBeenCalled();
  });
});

function progressFake() {
  return {
    owned: jest.fn().mockResolvedValue(undefined),
    contacted: jest.fn().mockResolvedValue(undefined),
    closedByOutcome: jest.fn().mockResolvedValue(false),
    countyRetired: jest.fn().mockResolvedValue(undefined),
  };
}

describe('TwilioVoiceService.setDisposition moves the four fields', () => {
  it('a connected call claims the owner and marks the case contacted, in the name of who picked up', async () => {
    const progress = progressFake();
    const { svc } = harness(SON_NUMBER, null, progress);
    await svc.setDisposition(
      CALL_SID,
      { disposition: 'Follow Up', outcome: SurplusCallOutcome.SPOKE_RELATIVE, followUpAt: '2026-11-03T14:00:00Z' },
      'u1',
    );
    expect(progress.owned).toHaveBeenCalledWith('lead1', 'u1', 'first call outcome');
    expect(progress.closedByOutcome).toHaveBeenCalledWith(
      'lead1',
      SurplusCallOutcome.SPOKE_RELATIVE,
      expect.objectContaining({ heirId: 'heir-son', userId: 'u1' }),
    );
    expect(progress.contacted).toHaveBeenCalledWith(
      'lead1',
      expect.objectContaining({ heirId: 'heir-son', userId: 'u1', how: expect.stringContaining('picked up') }),
    );
  });

  it('"not interested" from the claimant closes the case instead of marking it contacted', async () => {
    const progress = progressFake();
    progress.closedByOutcome.mockResolvedValue(true);
    const { svc } = harness(CLAIMANT_NUMBER, null, progress);
    await svc.setDisposition(CALL_SID, { disposition: 'Not Interested', outcome: SurplusCallOutcome.NOT_INTERESTED }, 'u1');
    expect(progress.closedByOutcome).toHaveBeenCalledWith(
      'lead1',
      SurplusCallOutcome.NOT_INTERESTED,
      expect.objectContaining({ heirId: null }),
    );
    expect(progress.contacted).not.toHaveBeenCalled();
  });

  it('no answer moves nothing but the owner', async () => {
    const progress = progressFake();
    const { svc } = harness(CLAIMANT_NUMBER, null, progress);
    await svc.setDisposition(CALL_SID, { disposition: 'No Answer', outcome: SurplusCallOutcome.NO_ANSWER }, 'u1');
    expect(progress.owned).toHaveBeenCalled();
    expect(progress.contacted).not.toHaveBeenCalled();
    expect(progress.closedByOutcome).not.toHaveBeenCalled();
  });
});

describe('TwilioVoiceService.setDisposition do not call', () => {
  it("opts out only the relative whose number was dialed", async () => {
    const { svc, writes } = harness(SON_NUMBER);
    await svc.setDisposition(CALL_SID, { disposition: 'Not Interested', outcome: SurplusCallOutcome.DO_NOT_CALL });

    expect(writes.find((w) => w.model === 'lead')).toBeUndefined();
    const heir = writes.find((w) => w.model === 'surplusHeir' && w.args.data?.doNotCall);
    expect(heir?.args).toEqual({ where: { id: 'heir-son' }, data: { doNotCall: true } });
    const drips = writes.find((w) => w.model === 'campaignEnrollment');
    expect(drips?.args.where.heirId).toBe('heir-son');
    expect(drips?.args.data.status).toBe('OPTED_OUT');
  });

  it("still opts out the whole case on the claimant's own number", async () => {
    const { svc, writes } = harness(CLAIMANT_NUMBER);
    await svc.setDisposition(CALL_SID, { disposition: 'Not Interested', outcome: SurplusCallOutcome.DO_NOT_CALL });

    const lead = writes.find((w) => w.model === 'lead');
    expect(lead?.args.data).toEqual({ doNotContact: true, surplusDetail: { update: { doNotCall: true } } });
    expect(writes.find((w) => w.model === 'surplusHeir')).toBeUndefined();
  });

  it('files a follow-up under the relative the call rang, in their name', async () => {
    const { svc, writes } = harness(SON_NUMBER, 'heir-son');
    await svc.setDisposition(CALL_SID, {
      disposition: 'Follow Up',
      outcome: SurplusCallOutcome.CALLBACK_SCHEDULED,
      followUpAt: '2026-11-02T15:00:00Z',
    });
    const task = writes.find((w) => w.model === 'task');
    expect(task?.args.data.heirId).toBe('heir-son');
    expect(task?.args.data.title).toContain('ROBERT KESSLER');
  });

  it('marks a wrong or disconnected number bad, whoever holds it', async () => {
    for (const outcome of [SurplusCallOutcome.WRONG_NUMBER, SurplusCallOutcome.DISCONNECTED]) {
      const { svc, writes } = harness(SON_NUMBER, 'heir-son');
      await svc.setDisposition(CALL_SID, { disposition: 'Wrong Number', outcome });
      expect(writes.find((w) => w.model === 'badContacts')?.args).toEqual({ leadId: 'lead1', value: SON_NUMBER, bad: true });
    }
  });

  it('marks the relative reached when they picked up and talked', async () => {
    const { svc, writes } = harness(SON_NUMBER, 'heir-son');
    await svc.setDisposition(CALL_SID, {
      disposition: 'Spoke',
      outcome: SurplusCallOutcome.SPOKE_RELATIVE,
      followUpAt: '2026-11-02T15:00:00Z',
    });
    expect(writes.find((w) => w.model === 'surplusHeir' && w.op === 'update')?.args.where).toEqual({ id: 'heir-son' });
    expect(writes.find((w) => w.model === 'surplusHeir' && w.op === 'updateMany')?.args.data).toEqual({ contactStatus: 'contacted' });
    expect(writes.find((w) => w.model === 'badContacts')).toBeUndefined();
  });

  it('marks nobody reached on a voicemail', async () => {
    const { svc, writes } = harness(SON_NUMBER, 'heir-son');
    await svc.setDisposition(CALL_SID, { disposition: 'Voicemail', outcome: SurplusCallOutcome.NO_ANSWER_VOICEMAIL });
    expect(writes.find((w) => w.model === 'surplusHeir')).toBeUndefined();
  });
});
