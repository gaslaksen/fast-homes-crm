import { BadRequestException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadSource } from '@fast-homes/shared';

/**
 * The generic delete must never reach a pipeline lead.
 *
 * Every county-fed pipeline keeps a suppression row so a deleted case stays
 * deleted. This endpoint deletes by id and writes none, so a surplus lead
 * removed through here comes back on the next poll with its skip-trace results,
 * notes and Dead marking gone. That is not hypothetical: 27 surplus leads
 * returned overnight on 2026-09-03 and the work on them was lost.
 */
function svc(found: any[]) {
  const deleteMany = jest.fn().mockResolvedValue({ count: found.length });
  const prisma = {
    lead: { findMany: jest.fn().mockResolvedValue(found), deleteMany },
  };
  const s = Object.create(LeadsService.prototype) as any;
  s.prisma = prisma;
  return { svc: s as LeadsService, deleteMany };
}

describe('LeadsService.bulkDelete', () => {
  it('refuses a surplus lead rather than deleting it without a tombstone', async () => {
    const { svc: s, deleteMany } = svc([{ id: 'a', source: LeadSource.SURPLUS }]);
    await expect(s.bulkDelete(['a'])).rejects.toThrow(BadRequestException);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('refuses every county-fed pipeline, not just surplus', async () => {
    for (const source of [
      LeadSource.SURPLUS,
      LeadSource.FORECLOSURE,
      LeadSource.PROBATE,
      LeadSource.TAX_SALE,
    ]) {
      const { svc: s, deleteMany } = svc([{ id: 'a', source }]);
      await expect(s.bulkDelete(['a'])).rejects.toThrow(/pipeline's own board/);
      expect(deleteMany).not.toHaveBeenCalled();
    }
  });

  it('refuses the whole batch when only one is a pipeline lead', async () => {
    // Partial deletion would be worse than refusing: the caller is told a
    // number and has no way to know which ones went.
    const { svc: s, deleteMany } = svc([{ id: 'b', source: LeadSource.SURPLUS }]);
    await expect(s.bulkDelete(['a', 'b', 'c'])).rejects.toThrow(BadRequestException);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('still deletes ordinary property leads', async () => {
    const { svc: s, deleteMany } = svc([]);
    expect(await s.bulkDelete(['a', 'b'])).toEqual({ deleted: 0 });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } } });
  });
});
