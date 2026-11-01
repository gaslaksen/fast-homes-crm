import { SurplusStage } from '@fast-homes/shared';
import { MessagesService } from './messages.service';

/**
 * The gate on what an outbound surplus message may say, by who reads it:
 * a relative never hears the amount or the source, the claimant hears the
 * source once the fee agreement is signed.
 */
function build(stage: string, person: { name: string; role: string } | null) {
  const prisma: any = {
    surplusDetail: { findUnique: jest.fn().mockResolvedValue({ stage }) },
    surplusHeir: { findUnique: jest.fn().mockResolvedValue(person) },
  };
  const config: any = { get: (key: string, fallback?: any) => (key === 'ALLOW_SIMULATED_SMS' ? 'true' : fallback) };
  const none = {} as any;
  const service = new MessagesService(prisma, none, config, none, none, none, none, none, none, none, none);
  return (text: string, heirId: string | null) => (service as any).holdIfDisclosing('lead1', text, heirId);
}

describe('MessagesService.holdIfDisclosing', () => {
  it('holds a text to a relative that names the amount, naming them in the reason', async () => {
    const hold = build(SurplusStage.NEW, { name: 'ROBERT KESSLER', role: 'relative' });
    await expect(hold('Your family is owed over $40,000.', 'heir-son')).rejects.toThrow(
      /Held, not sent to ROBERT KESSLER\. It names a dollar figure/,
    );
  });

  it('lets the relative script through', async () => {
    const hold = build(SurplusStage.NEW, { name: 'ROBERT KESSLER', role: 'relative' });
    await expect(hold('Dorothy may have unclaimed funds. Could you share a way to reach her?', 'heir-son')).resolves.toBeUndefined();
  });

  it('treats an heir who can sign as the claimant', async () => {
    const hold = build(SurplusStage.NEW, { name: 'LINDA MORRIS', role: 'heir' });
    await expect(hold('Linda, there is about $40,000 in unclaimed funds from your mother.', 'heir-1')).resolves.toBeUndefined();
  });

  it('holds the source to the claimant before signing, and allows it after', async () => {
    await expect(build(SurplusStage.CONTACTED, null)('The county clerk is holding your surplus.', null)).rejects.toThrow(/before the fee agreement is signed/);
    await expect(build(SurplusStage.AGREEMENT_SIGNED, null)('The county clerk is holding your surplus.', null)).resolves.toBeUndefined();
  });

  it('fails open when the lookup breaks, so the rule cannot take messaging down', async () => {
    const prisma: any = { surplusDetail: { findUnique: jest.fn().mockRejectedValue(new Error('db away')) } };
    const config: any = { get: (key: string, fallback?: any) => (key === 'ALLOW_SIMULATED_SMS' ? 'true' : fallback) };
    const none = {} as any;
    const service = new MessagesService(prisma, none, config, none, none, none, none, none, none, none, none);
    await expect((service as any).holdIfDisclosing('lead1', 'over $40,000', 'heir-son')).resolves.toBeUndefined();
  });
});
