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
function harness(toNumber: string, heirId: string | null = null) {
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
  );
  return { svc, writes };
}

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
