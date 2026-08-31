import { CampaignExecutionService } from './campaign-execution.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A campaign can pin its text steps to one of the org's numbers, e.g. a
 * Florida surplus campaign on the Jacksonville line rather than the main
 * 888. What matters is that the number reaches sendMessage: everything
 * downstream (allowlist check, fallback) is PhoneNumbersService's job and is
 * covered there.
 */
function service(campaign: { fromNumber?: string | null }) {
  const sendMessage = jest.fn(async (..._args: any[]) => 'sent');
  const messagesService = { sendMessage } as any;

  const svc = new CampaignExecutionService(
    {} as unknown as PrismaService,
    { get: () => undefined } as any,
    messagesService,
    { recordTouch: jest.fn() } as any,
    {} as any,
  );

  const enrollment = { id: 'enr_1', attempts: 0, campaign };
  const lead = { id: 'lead_1', sellerPhone: '+19045551234', doNotContact: false };
  const step = { id: 'step_1', channel: 'TEXT' };

  const dispatch = () =>
    (svc as any).dispatch(enrollment, lead, step, 'hello there', undefined);

  return { dispatch, sendMessage };
}

describe('campaign text step from-number', () => {
  it('sends from the campaign number when one is set', async () => {
    const { dispatch, sendMessage } = service({ fromNumber: '+19045959620' });
    await dispatch();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    // (leadId, body, userId, fromNumber)
    expect(sendMessage.mock.calls[0][3]).toBe('+19045959620');
  });

  it('passes nothing when the campaign has no number, leaving the lead rules alone', async () => {
    // undefined, not null or an empty string: resolveForLead treats any
    // falsy request as "use the sticky thread number, else the default", and
    // this test pins that a campaign without a number does not override it.
    const { dispatch, sendMessage } = service({ fromNumber: null });
    await dispatch();

    expect(sendMessage.mock.calls[0][3]).toBeUndefined();
  });

  it('tolerates a campaign relation that was not loaded', async () => {
    const { dispatch, sendMessage } = service(undefined as any);
    await dispatch();

    expect(sendMessage.mock.calls[0][3]).toBeUndefined();
  });
});
