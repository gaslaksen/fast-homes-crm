import { LeadSource } from '@fast-homes/shared';
import { SurplusNumbersService } from './surplus-numbers.service';

const SON = '3525550141';
const DAD = '3525550100';

/**
 * The Hernando case from the 2026-10-31 review: the son's cell sat on the
 * father's row, so six of the son's texts were logged as the father replying.
 */
function harness(over: { claimantDeceased?: boolean; sonPhones?: string[] } = {}) {
  const writes: { model: string; op: string; args: any }[] = [];
  const record = (model: string, op: string, result: any = { count: 2 }) =>
    jest.fn(async (args: any) => {
      writes.push({ model, op, args });
      return result;
    });
  const son = {
    id: 'heir-son',
    name: 'ROBERT KESSLER',
    deceased: false,
    phone1: over.sonPhones?.[0] || null,
    phone1Type: over.sonPhones?.[0] ? 'Mobile' : null,
    phone1Dnc: null,
    phone2: over.sonPhones?.[1] || null, phone2Type: null, phone2Dnc: null,
    phone3: over.sonPhones?.[2] || null, phone3Type: null, phone3Dnc: null,
    phone4: over.sonPhones?.[3] || null, phone4Type: null, phone4Dnc: null,
  };
  const lead = {
    id: 'lead1',
    sellerPhone: `+1${SON}`,
    sellerFirstName: 'Dorothy',
    sellerLastName: 'Kessler',
    surplusDetail: {
      id: 'sd1',
      organizationId: 'org1',
      deceased: !!over.claimantDeceased,
      phone1Type: 'Mobile', phone1Dnc: 'clean',
      phone2: DAD, phone2Type: 'Landline', phone2Dnc: null,
      phone3: null, phone3Type: null, phone3Dnc: null,
      phone4: null, phone4Type: null, phone4Dnc: null,
      heirs: [son],
    },
  };
  const prisma = {
    lead: { findFirst: jest.fn(async () => lead), update: record('lead', 'update') },
    surplusDetail: { update: record('surplusDetail', 'update') },
    surplusHeir: {
      update: record('surplusHeir', 'update'),
      create: record('surplusHeir', 'create', { id: 'heir-new', name: 'LINDA MORRIS' }),
    },
    message: { updateMany: record('message', 'updateMany', { count: 6 }) },
    callLog: { updateMany: record('callLog', 'updateMany', { count: 1 }) },
    activity: { create: record('activity', 'create') },
  } as any;
  return { svc: new SurplusNumbersService(prisma), writes, source: LeadSource.SURPLUS };
}

describe('SurplusNumbersService.reassign', () => {
  it("moves the son's number off the father's row onto the son's, keeping its line type and DNC result", async () => {
    const { svc, writes } = harness();
    const r = await svc.reassign({ leadId: 'lead1', number: `+1${SON}`, to: { heirId: 'heir-son' }, userId: 'u1' });

    expect(r).toEqual({ moved: true, heirId: 'heir-son', name: 'ROBERT KESSLER', reattributed: { messages: 6, calls: 1 } });
    // The father keeps the landline, now primary.
    expect(writes.find((w) => w.model === 'lead')?.args.data).toEqual({ sellerPhone: `+1${DAD}` });
    const dad = writes.find((w) => w.model === 'surplusDetail')?.args.data;
    expect(dad.phone1Type).toBe('Landline');
    expect(dad.phone2).toBeNull();
    // The son gets the number in his first slot, with the type and DNC it had.
    const sonRow = writes.find((w) => w.model === 'surplusHeir')?.args.data;
    expect(sonRow.phone1).toBe(SON);
    expect(sonRow.phone1Type).toBe('Mobile');
    expect(sonRow.phone1Dnc).toBe('clean');
  });

  it('re-files every text and call on that number under the person it reaches', async () => {
    const { svc, writes } = harness();
    await svc.reassign({ leadId: 'lead1', number: SON, to: { heirId: 'heir-son' } });
    const msgs = writes.find((w) => w.model === 'message')?.args;
    expect(msgs.where.leadId).toBe('lead1');
    expect(msgs.where.OR[0].from.in).toEqual([SON, `1${SON}`, `+1${SON}`]);
    expect(msgs.data).toEqual({ heirId: 'heir-son' });
    expect(writes.find((w) => w.model === 'callLog')?.args.data).toEqual({ heirId: 'heir-son' });
    const act = writes.find((w) => w.model === 'activity')?.args.data;
    expect(act.type).toBe('NUMBER_MOVED');
    expect(act.description).toBe('(352) 555-0141 moved from Dorothy Kessler to ROBERT KESSLER: ROBERT KESSLER is who it reaches.');
  });

  it('a number already on the right row is left alone', async () => {
    const { svc, writes } = harness();
    const r = await svc.reassign({ leadId: 'lead1', number: DAD, to: { claimant: true } });
    expect(r.moved).toBe(false);
    expect(writes).toEqual([]);
  });

  it('moves a number back to the claimant from a person, re-filing the thread under nobody', async () => {
    const { svc, writes } = harness({ sonPhones: ['3525550199'] });
    const r = await svc.reassign({ leadId: 'lead1', number: '3525550199', to: { claimant: true } });
    expect(r.heirId).toBeNull();
    const sonRow = writes.find((w) => w.model === 'surplusHeir')?.args.data;
    expect(sonRow.phone1).toBeNull();
    const dad = writes.find((w) => w.model === 'surplusDetail')?.args.data;
    expect(dad.phone3).toBe('3525550199');
    expect(writes.find((w) => w.model === 'message')?.args.data).toEqual({ heirId: null });
  });

  it('creates the new person and files the number on them', async () => {
    const { svc, writes } = harness();
    const r = await svc.reassign({
      leadId: 'lead1',
      number: SON,
      to: { newPerson: { name: 'Linda Morris', relationship: 'daughter' } },
      userId: 'u1',
    });
    const created = writes.find((w) => w.model === 'surplusHeir' && w.op === 'create')?.args.data;
    expect(created.name).toBe('Linda Morris');
    expect(created.role).toBe('relative');
    expect(created.relationship).toBe('daughter');
    expect(r.heirId).toBe('heir-new');
    expect(writes.find((w) => w.model === 'surplusHeir' && w.op === 'update')?.args.where).toEqual({ id: 'heir-new' });
  });

  it('refuses to file a number on a claimant marked deceased', async () => {
    const { svc } = harness({ claimantDeceased: true, sonPhones: ['3525550199'] });
    await expect(svc.reassign({ leadId: 'lead1', number: '3525550199', to: { claimant: true } })).rejects.toThrow(/deceased/);
  });

  it('refuses a fifth number on a person', async () => {
    const { svc } = harness({ sonPhones: ['3525550001', '3525550002', '3525550003', '3525550004'] });
    await expect(svc.reassign({ leadId: 'lead1', number: SON, to: { heirId: 'heir-son' } })).rejects.toThrow(/four numbers/);
  });

  it('rejects something that is not a phone number', async () => {
    const { svc } = harness();
    await expect(svc.reassign({ leadId: 'lead1', number: 'abc', to: { heirId: 'heir-son' } })).rejects.toThrow(/not a phone number/);
  });
});
