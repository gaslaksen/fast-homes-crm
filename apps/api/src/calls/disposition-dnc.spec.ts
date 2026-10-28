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
function harness(toNumber: string) {
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
    surplusHeir: { update: record('surplusHeir', 'update') },
    campaignEnrollment: { updateMany: record('campaignEnrollment', 'updateMany') },
  } as any;

  const leadPhones = {
    heirIdForNumber: async (_leadId: string, number: string) => (number === SON_NUMBER ? 'heir-son' : null),
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
    const heir = writes.find((w) => w.model === 'surplusHeir');
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
});
