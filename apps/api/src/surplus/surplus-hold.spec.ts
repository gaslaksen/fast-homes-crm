import { SurplusService } from './surplus.service';

/** Holding a file takes a reason and leaves a note; releasing clears it and says what it was. */
function build(detail: any) {
  const prisma: any = {
    surplusDetail: { findFirst: jest.fn(async () => detail), update: jest.fn(async () => ({})) },
    note: { create: jest.fn(async () => ({})) },
  };
  return { service: new SurplusService(prisma, {} as any, {} as any, {} as any), prisma };
}

describe('SurplusService.setHold', () => {
  it('holds with a reason and notes who and why', async () => {
    const { service, prisma } = build({ id: 'd1', heldAt: null, holdReason: null });
    await service.setHold('lead1', { on: true, reason: ' active claim on the docket ' }, 'org1', 'u1');

    const data = prisma.surplusDetail.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ holdReason: 'active claim on the docket', heldByUserId: 'u1' });
    expect(data.heldAt).toBeInstanceOf(Date);
    expect(prisma.note.create.mock.calls[0][0].data.content).toBe('Put on hold: active claim on the docket');
  });

  it('refuses a hold with no reason', async () => {
    const { service } = build({ id: 'd1', heldAt: null, holdReason: null });
    await expect(service.setHold('lead1', { on: true, reason: '  ' }, 'org1', 'u1')).rejects.toThrow('Say why');
  });

  it('releases and says what the hold was', async () => {
    const { service, prisma } = build({ id: 'd1', heldAt: new Date(), holdReason: 'Ian to clear' });
    await service.setHold('lead1', { on: false }, 'org1', 'u1');

    expect(prisma.surplusDetail.update.mock.calls[0][0].data).toEqual({ heldAt: null, holdReason: null, heldByUserId: null });
    expect(prisma.note.create.mock.calls[0][0].data.content).toBe('Released from hold (was: Ian to clear).');
  });
});
