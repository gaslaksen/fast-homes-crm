import { SurplusService } from './surplus.service';

/**
 * A case somebody deleted by hand leaves a tombstone. The county poll checks
 * it before creating; a spreadsheet import has to as well, or the next bot
 * list brings the deleted lead straight back.
 */
function build(tombstone: { createdAt: Date } | null) {
  const prisma: any = {
    surplusDetail: { findFirst: jest.fn().mockResolvedValue(null) },
    surplusSuppression: { findFirst: jest.fn().mockResolvedValue(tombstone) },
    lead: { create: jest.fn().mockRejectedValue(new Error('should not create')) },
  };
  const service = new SurplusService(prisma, {} as any, {} as any, {} as any);
  return { service, prisma };
}

const row = { claimant: 'DOROTHY A KESSLER', address: '100 MAIN ST', county: 'Citrus', caseNumber: '2026-0999TD', grossSurplus: 18420.55 };

describe('SurplusService.createSurplusLead and deleted cases', () => {
  it('refuses a deleted case when the caller respects suppression', async () => {
    const deletedAt = new Date('2026-10-01T12:00:00Z');
    const { service, prisma } = build({ createdAt: deletedAt });
    const res = await service.createSurplusLead(row, { organizationId: 'org1', respectSuppression: true });

    expect(res).toEqual({ leadId: null, created: false, reason: 'suppressed', suppressedAt: deletedAt });
    expect(prisma.surplusSuppression.findFirst.mock.calls[0][0].where.organizationId).toBe('org1');
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('does not look at tombstones for a lead added by hand', async () => {
    const { service, prisma } = build({ createdAt: new Date() });
    await service.createSurplusLead(row, { organizationId: 'org1' }).catch(() => undefined);

    expect(prisma.surplusSuppression.findFirst).not.toHaveBeenCalled();
  });
});
