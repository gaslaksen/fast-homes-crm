import { SurplusService } from './surplus.service';
import { caseQuestions, caseSuggestions, QuestionFacts } from './surplus-questions.util';

const facts = (over: Partial<QuestionFacts> = {}): QuestionFacts => ({
  claimant: 'Ada Quill',
  claimStatus: 'open',
  lastPolledAt: new Date('2026-10-26T12:00:00Z'),
  isDeceased: false,
  phones: [{ number: '5550100001', dnc: null, bad: false }],
  emails: [],
  heirs: [],
  stage: 'New',
  channels: {},
  ...over,
});

const answer = (f: QuestionFacts) => Object.fromEntries(caseQuestions(f).map((q) => [q.key, q]));

describe('caseQuestions', () => {
  it('reads the money off the claim status, and never treats unknown as open', () => {
    expect(answer(facts()).money.state).toBe('known');
    expect(answer(facts({ claimStatus: 'unknown' })).money).toMatchObject({ state: 'unknown', answer: 'Not checked' });
    expect(answer(facts({ claimStatus: 'pending' })).money.state).toBe('problem');
    expect(answer(facts({ claimStatus: 'distributed' })).money.answer).toBe('Paid out');
    expect(answer(facts({ claimStatus: 'denied' })).money.state).toBe('known');
  });

  it('says who can sign: the claimant, the heirs, or nobody yet', () => {
    expect(answer(facts()).signer.answer).toBe('The claimant');
    expect(answer(facts({ isDeceased: true, livingHeirCount: 2, callableHeirCount: 1 })).signer).toMatchObject({
      state: 'known',
      detail: '1 with a number',
    });
    expect(answer(facts({ isDeceased: true, deathSource: 'idi' })).signer).toMatchObject({
      state: 'problem',
      detail: 'death from IDI only',
    });
    expect(answer(facts({ isEntity: true })).signer.state).toBe('unknown');
  });

  it('only calls the person confirmed when somebody flipped the switch', () => {
    expect(answer(facts({ trace: { state: 'matched' } })).person.state).toBe('unknown');
    expect(answer(facts({ entitlementVerified: true })).person.answer).toBe('Confirmed');
    expect(answer(facts({ contactMismatch: true, mismatchedName: 'ADA QUINN' })).person).toMatchObject({
      state: 'problem',
      detail: 'came back as ADA QUINN',
    });
  });

  it('counts the routes to someone, ignoring bad and DNC numbers and the dead', () => {
    expect(answer(facts()).reach).toMatchObject({ state: 'unknown', answer: '1 number for the claimant', detail: 'nothing tried yet' });
    expect(answer(facts({ phones: [{ number: '5550100001', bad: true }] })).reach.state).toBe('problem');
    expect(answer(facts({ isDeceased: true, heirs: [{ id: 'h1', name: 'Bea', callable: true }] })).reach.answer).toBe(
      '1 other person with a number',
    );
    expect(answer(facts({ tappedAt: new Date() })).reach.state).toBe('known');
    expect(answer(facts({ doNotCall: true })).reach.answer).toBe('Marked do not contact');
  });
});

describe('caseSuggestions', () => {
  it('suggests calling a claimant nobody has called', () => {
    expect(caseSuggestions(facts()).map((s) => s.key)).toEqual(['call-claimant']);
  });

  it('puts the docket first when the money is not checked', () => {
    expect(caseSuggestions(facts({ claimStatus: 'unknown' }))[0].key).toBe('read-docket');
  });

  it('on an estate with no heir, checks a vendor death before ringing, then asks the closest relative', () => {
    const s = caseSuggestions(
      facts({
        isDeceased: true,
        deathSource: 'idi',
        heirs: [
          { id: 'n1', name: 'Ned Next', role: 'neighbor', callable: true },
          { id: 'd1', name: 'Linda Quill', role: 'relative', relationship: 'Daughter', callable: true },
        ],
      }),
    );
    expect(s.map((x) => x.key)).toEqual(['confirm-death', 'ask-relative:d1']);
    expect(s[1].text).toBe('Call Linda Quill (daughter) and ask who is handling the estate');
  });

  it('sends a living claimant with no route to the skip trace, and an estate with nobody to probate', () => {
    expect(caseSuggestions(facts({ phones: [] }))[0].key).toBe('trace');
    expect(caseSuggestions(facts({ isDeceased: true, phones: [] })).map((s) => s.key)).toContain('find-probate');
  });

  it('after a signature, suggests what the next stage is missing', () => {
    const s = caseSuggestions(
      facts({ stage: 'Agreement Signed', stageBlocks: { 'Package Notarized': ['limited POA signed', 'notary booked'] } }),
    );
    expect(s.map((x) => x.text)).toEqual(['Before Package Notarized: limited POA signed', 'Before Package Notarized: notary booked']);
  });

  it('offers nothing but the hold on a held file, and nothing on a dead one', () => {
    expect(caseSuggestions(facts({ heldAt: new Date(), holdReason: 'claim to check' }))).toEqual([
      { key: 'hold', text: 'Settle the hold (claim to check) and release the file' },
    ]);
    expect(caseSuggestions(facts({ stage: 'Dead' }))).toEqual([]);
  });

  it('never offers more than three', () => {
    const s = caseSuggestions(
      facts({ claimStatus: 'unknown', isDeceased: true, deathSource: 'endato', isEntity: true, contactMismatch: true, phones: [] }),
    );
    expect(s.length).toBe(3);
  });
});

function service(prisma: any) {
  const svc = Object.create(SurplusService.prototype) as any;
  svc.prisma = prisma;
  return svc as SurplusService;
}

describe('SurplusService owner and next action', () => {
  const basePrisma = () => ({
    lead: {
      findFirst: jest.fn().mockResolvedValue({ id: 'L1', assignedToUserId: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u2', firstName: 'Ian', lastName: 'Tester' }) },
    note: { create: jest.fn().mockResolvedValue({}) },
    task: {
      findFirst: jest.fn().mockResolvedValue({ id: 't1' }),
      update: jest.fn(async ({ data }) => ({ id: 't1', ...data })),
      create: jest.fn(async ({ data }) => ({ id: 't2', ...data })),
    },
    activity: { create: jest.fn().mockResolvedValue({}) },
  });

  it('sets an owner from the same organization and notes it', async () => {
    const prisma = basePrisma();
    const out = await service(prisma).setOwner('L1', 'u2', 'org1', 'u1');
    expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({ id: 'u2', organizationId: 'org1' });
    expect(prisma.lead.update.mock.calls[0][0].data).toEqual({ assignedToUserId: 'u2' });
    expect(prisma.note.create.mock.calls[0][0].data.content).toBe('Owner set to Ian Tester.');
    expect(out.ownerName).toBe('Ian Tester');
  });

  it('refuses an owner who is not on the team', async () => {
    const prisma = basePrisma();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service(prisma).setOwner('L1', 'stranger', 'org1', 'u1')).rejects.toThrow('not on the team');
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it('creates a next action with a date, defaulting the person to whoever set it', async () => {
    const prisma = basePrisma();
    await service(prisma).setNextAction('L1', { title: 'Call Linda', dueDate: '2026-10-30T14:00:00Z' }, 'org1', 'u1');
    expect(prisma.task.create.mock.calls[0][0].data).toMatchObject({ leadId: 'L1', title: 'Call Linda', userId: 'u1' });
  });

  it('rewrites the current next action in place rather than stacking another', async () => {
    const prisma = basePrisma();
    await service(prisma).setNextAction('L1', { taskId: 't1', title: 'Read the probate file', dueDate: '2026-10-31T14:00:00Z', userId: 'u2' }, 'org1', 'u1');
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(prisma.task.update.mock.calls[0][0]).toMatchObject({ where: { id: 't1' }, data: { title: 'Read the probate file', userId: 'u2' } });
  });

  it('refuses a next action with no title or no date', async () => {
    const prisma = basePrisma();
    await expect(service(prisma).setNextAction('L1', { title: ' ', dueDate: '2026-10-30' }, 'org1', 'u1')).rejects.toThrow('Say what');
    await expect(service(prisma).setNextAction('L1', { title: 'Call', dueDate: null }, 'org1', 'u1')).rejects.toThrow('due date');
  });
});
