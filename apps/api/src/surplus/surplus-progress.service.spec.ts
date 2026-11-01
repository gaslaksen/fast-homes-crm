import { LeadSource, SurplusCallOutcome, SurplusDeadReason, SurplusStage } from '@fast-homes/shared';
import { SurplusProgressService } from './surplus-progress.service';

/**
 * The four fields filling themselves. Each test seeds one case and checks
 * exactly what was written, because these run as side effects of a text, a
 * call or the pull and nobody is watching them.
 */
function harness(over: { stage?: string; assignedToUserId?: string | null; source?: string; heirRole?: string } = {}) {
  const writes: { model: string; op: string; args: any }[] = [];
  const record = (model: string, op: string) => async (args: any) => {
    writes.push({ model, op, args });
    return { count: 1 };
  };
  const lead = {
    id: 'lead1',
    source: over.source ?? LeadSource.SURPLUS,
    sellerFirstName: 'Dorothy',
    sellerLastName: 'Kessler',
    assignedToUserId: over.assignedToUserId ?? null,
    surplusDetail: { id: 'sd1', stage: over.stage ?? SurplusStage.NEW },
  };
  const prisma = {
    lead: {
      findFirst: async ({ where }: any) => (where.source === lead.source ? lead : null),
      update: record('lead', 'update'),
    },
    user: { findUnique: async () => ({ firstName: 'Ian', lastName: 'Shaw' }) },
    note: { create: record('note', 'create') },
    activity: { create: record('activity', 'create') },
    task: { updateMany: record('task', 'updateMany') },
    surplusDetail: { update: record('surplusDetail', 'update') },
    surplusHeir: {
      findUnique: async ({ where }: any) =>
        where.id === 'heir-son' ? { name: 'ROBERT KESSLER', role: over.heirRole ?? 'relative' } : null,
    },
    campaignEnrollment: { updateMany: record('campaignEnrollment', 'updateMany') },
  } as any;
  return { svc: new SurplusProgressService(prisma), writes };
}

describe('SurplusProgressService.contacted', () => {
  it('moves a New case to Contacted when the claimant texts back', async () => {
    const { svc, writes } = harness();
    await svc.contacted('lead1', { how: 'texted back' });
    const stage = writes.find((w) => w.model === 'surplusDetail');
    expect(stage?.args).toEqual({ where: { id: 'sd1' }, data: { stage: SurplusStage.CONTACTED } });
    const act = writes.find((w) => w.model === 'activity');
    expect(act?.args.data.type).toBe('STAGE_CHANGED');
    expect(act?.args.data.description).toBe('Stage New to Contacted: Dorothy Kessler texted back.');
  });

  it('a relative getting back to us also counts as contact, in their name', async () => {
    const { svc, writes } = harness();
    await svc.contacted('lead1', { heirId: 'heir-son', how: 'called us' });
    expect(writes.find((w) => w.model === 'surplusDetail')).toBeDefined();
    expect(writes.find((w) => w.model === 'activity')?.args.data.description).toContain('ROBERT KESSLER called us');
  });

  it('completes the letter follow-up for that person and nobody else', async () => {
    const { svc, writes } = harness();
    await svc.contacted('lead1', { heirId: 'heir-son', how: 'texted back' });
    const task = writes.find((w) => w.model === 'task');
    expect(task?.args.where).toEqual({
      leadId: 'lead1',
      completed: false,
      title: { startsWith: 'Check for a reply to the letter to ' },
      heirId: 'heir-son',
    });
    expect(task?.args.data.completed).toBe(true);
  });

  it('leaves a Contacted or later stage where it is', async () => {
    const { svc, writes } = harness({ stage: SurplusStage.AGREEMENT_SIGNED });
    await svc.contacted('lead1', { how: 'texted back' });
    expect(writes.find((w) => w.model === 'surplusDetail')).toBeUndefined();
    expect(writes.find((w) => w.model === 'activity')).toBeUndefined();
  });

  it('does nothing on a wholesale lead', async () => {
    const { svc, writes } = harness({ source: 'WEBSITE' });
    await svc.contacted('lead1', { how: 'texted back' });
    expect(writes).toEqual([]);
  });
});

describe('SurplusProgressService.owned', () => {
  it('gives an unowned case to the teammate who touched it first, and says so', async () => {
    const { svc, writes } = harness();
    await svc.owned('lead1', 'u1', 'first call');
    expect(writes.find((w) => w.model === 'lead')?.args).toEqual({
      where: { id: 'lead1' },
      data: { assignedToUserId: 'u1' },
    });
    expect(writes.find((w) => w.model === 'note')?.args.data.content).toBe('Owner set to Ian Shaw (first call).');
  });

  it('never takes a case off its owner', async () => {
    const { svc, writes } = harness({ assignedToUserId: 'u2' });
    await svc.owned('lead1', 'u1', 'first text');
    expect(writes).toEqual([]);
  });

  it('does nothing without a user, as on an inbound reply', async () => {
    const { svc, writes } = harness();
    await svc.owned('lead1', null, 'texted back');
    expect(writes).toEqual([]);
  });
});

describe('SurplusProgressService.closedByOutcome', () => {
  it('"not interested" from the claimant closes the case with the reason and stops the drips', async () => {
    const { svc, writes } = harness({ stage: SurplusStage.CONTACTED });
    const closed = await svc.closedByOutcome('lead1', SurplusCallOutcome.NOT_INTERESTED, { userId: 'u1' });
    expect(closed).toBe(true);
    const d = writes.find((w) => w.model === 'surplusDetail')?.args.data;
    expect(d.stage).toBe(SurplusStage.DEAD);
    expect(d.deadReason).toBe(SurplusDeadReason.NOT_INTERESTED);
    expect(d.deadAt).toBeInstanceOf(Date);
    expect(writes.find((w) => w.model === 'lead')?.args.data).toEqual({ status: 'DEAD' });
    expect(writes.find((w) => w.model === 'task')?.args.data.completed).toBe(true);
    expect(writes.find((w) => w.model === 'campaignEnrollment')?.args.data.status).toBe('REMOVED');
  });

  it('"already signed elsewhere" is recorded as already assigned', async () => {
    const { svc, writes } = harness();
    await svc.closedByOutcome('lead1', SurplusCallOutcome.ALREADY_SIGNED, {});
    expect(writes.find((w) => w.model === 'surplusDetail')?.args.data.deadReason).toBe(
      SurplusDeadReason.ALREADY_ASSIGNED,
    );
  });

  it('a relative saying no is passed along, not acted on', async () => {
    const { svc, writes } = harness();
    const closed = await svc.closedByOutcome('lead1', SurplusCallOutcome.NOT_INTERESTED, { heirId: 'heir-son' });
    expect(closed).toBe(false);
    expect(writes).toEqual([]);
  });

  it('an heir who can sign does close it', async () => {
    const { svc } = harness({ heirRole: 'heir' });
    expect(await svc.closedByOutcome('lead1', SurplusCallOutcome.NOT_INTERESTED, { heirId: 'heir-son' })).toBe(true);
  });

  it('never closes a case a client has signed', async () => {
    const { svc, writes } = harness({ stage: SurplusStage.CLAIM_FILED });
    expect(await svc.closedByOutcome('lead1', SurplusCallOutcome.NOT_INTERESTED, {})).toBe(false);
    expect(writes).toEqual([]);
  });

  it('other outcomes close nothing', async () => {
    const { svc, writes } = harness();
    expect(await svc.closedByOutcome('lead1', SurplusCallOutcome.SPOKE_CLAIMANT, {})).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe('SurplusProgressService.countyRetired', () => {
  it('after the pull retires a case: lead Dead, timeline entry, tasks closed, drips removed', async () => {
    const { svc, writes } = harness();
    await svc.countyRetired('lead1', 'distributed', SurplusStage.CONTACTED);
    expect(writes.find((w) => w.model === 'lead')?.args.data).toEqual({ status: 'DEAD' });
    const act = writes.find((w) => w.model === 'activity')?.args.data;
    expect(act.type).toBe('STAGE_CHANGED');
    expect(act.metadata.deadReason).toBe(SurplusDeadReason.PAID_OUT);
    expect(writes.find((w) => w.model === 'task')).toBeDefined();
    expect(writes.find((w) => w.model === 'campaignEnrollment')).toBeDefined();
  });

  it('on a signed case writes only a timeline note to check the filing', async () => {
    const { svc, writes } = harness();
    await svc.countyRetired('lead1', 'assigned', SurplusStage.CLAIM_FILED);
    expect(writes.map((w) => w.model)).toEqual(['activity']);
    expect(writes[0].args.data.type).toBe('DOCKET_CHANGED');
    expect(writes[0].args.data.description).toContain('Claim Filed');
  });

  it('writes nothing for a case already Dead', async () => {
    const { svc, writes } = harness();
    await svc.countyRetired('lead1', 'distributed', SurplusStage.DEAD);
    expect(writes).toEqual([]);
  });
});
