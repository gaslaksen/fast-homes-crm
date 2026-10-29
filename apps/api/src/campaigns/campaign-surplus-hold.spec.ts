import { CampaignExecutionService } from './campaign-execution.service';

/**
 * A surplus file a person put on hold must not be texted or emailed, and its
 * drip must not lose its place: the step waits a day at a time, nothing is
 * sent and no attempt is burnt, and it carries on once released.
 */
function build(held: { heldAt: Date | null; holdReason: string | null } | null) {
  const send = jest.fn(async () => ({ success: true }));
  const prisma: any = {
    surplusDetail: { findUnique: jest.fn(async () => held) },
    surplusHeir: { findUnique: jest.fn(async () => null) },
  };
  const svc = new CampaignExecutionService(
    prisma,
    { get: () => undefined } as any,
    { sendMessage: send } as any,
    {} as any,
    {} as any,
  );
  const dispatch = (lead: any) =>
    (svc as any).dispatch({ id: 'e1', heirId: null, campaign: {} }, lead, { channel: 'TEXT', stepOrder: 1 }, 'hello', undefined);
  return { dispatch, send };
}

const claimant = { id: 'lead1', source: 'SURPLUS', sellerPhone: '+13525550100', doNotContact: false };

describe('CampaignExecutionService and a surplus file on hold', () => {
  it('defers the step a day and sends nothing', async () => {
    const { dispatch, send } = build({ heldAt: new Date(), holdReason: 'active claim on the docket' });
    const out = await dispatch(claimant);

    expect(out.kind).toBe('DEFERRED');
    expect(out.reason).toContain('active claim on the docket');
    expect(out.retryAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(send).not.toHaveBeenCalled();
  });

  it('is not consulted for a lead that is not surplus', async () => {
    const { dispatch } = build({ heldAt: new Date(), holdReason: 'x' });
    const out = await dispatch({ ...claimant, source: 'PROPERTY_LEADS', sellerPhone: '' });
    expect(out.kind).toBe('SKIPPED');
  });
});
