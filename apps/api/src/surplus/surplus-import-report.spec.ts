import * as XLSX from 'xlsx';
import { SurplusClaimStatus, SurplusDeadReason, SurplusStage } from '@fast-homes/shared';
import { SurplusService } from './surplus.service';
import { SurplusImportService } from './surplus-import.service';
import { sameClaimantName } from './surplus-skiptrace.util';

describe('sameClaimantName', () => {
  it('takes word order, commas, middle initials and estate words as the same person', () => {
    expect(sameClaimantName('SMITH, JOHN A', 'JOHN A SMITH')).toBe(true);
    expect(sameClaimantName('JOHN SMITH', 'JOHN A SMITH')).toBe(true);
    expect(sameClaimantName('JOHN ALAN SMITH', 'JOHN A SMITH')).toBe(true);
    expect(sameClaimantName('ESTATE OF JOHN SMITH', 'JOHN SMITH ESTATE')).toBe(true);
    expect(sameClaimantName('MARY SMITH-JONES', 'MARY SMITH JONES')).toBe(true);
    expect(sameClaimantName('JOHN SMITH JR', 'SMITH JOHN JR.')).toBe(true);
  });

  it('keeps co-owners apart: other given names, other initials, a suffix on one side, no fuzzy spelling', () => {
    expect(sameClaimantName('MARIO GARCIA', 'MARIA GARCIA')).toBe(false);
    expect(sameClaimantName('JOHN A SMITH', 'JOHN B SMITH')).toBe(false);
    expect(sameClaimantName('JOHN SMITH', 'JOHN SMITH JR')).toBe(false);
    expect(sameClaimantName('JOHN SMITH SR', 'JOHN SMITH JR')).toBe(false);
    expect(sameClaimantName('ROBERT SMITH', 'ROBERTA SMITH')).toBe(false);
    expect(sameClaimantName('JOHN ALAN SMITH', 'JOHN ADAM SMITH')).toBe(false);
  });

  it('never matches on a surname alone', () => {
    expect(sameClaimantName('SMITH', 'JOHN SMITH')).toBe(false);
    expect(sameClaimantName('', 'JOHN SMITH')).toBe(false);
  });
});

describe('SurplusService.createSurplusLead with name variants', () => {
  const row = { claimant: 'DOROTHY A KESSLER', address: '100 MAIN ST', county: 'Citrus', caseNumber: '2026-0999TD', grossSurplus: 18420.55 };
  const build = (sameCase: any[]) => {
    const prisma: any = {
      surplusDetail: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue(sameCase) },
      surplusSuppression: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      lead: { create: jest.fn().mockRejectedValue(new Error('would create')) },
    };
    return { service: new SurplusService(prisma, {} as any, {} as any, {} as any), prisma };
  };

  it('matches a re-spelled claimant on the same county and case, and says who it matched', async () => {
    const { service, prisma } = build([
      { leadId: 'L2', stage: SurplusStage.CONTACTED, deadReason: null, deadAt: null, claimStatus: 'open', dedupeUid: 'CITRUS|2026-0999TD|KESSLER,_DOROTHY' },
    ]);
    const res = await service.createSurplusLead(row, { organizationId: 'org1', respectSuppression: true, matchNameVariants: true });
    expect(prisma.surplusDetail.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org1',
      dedupeUid: { startsWith: 'CITRUS|2026-0999TD|' },
    });
    expect(res).toMatchObject({ leadId: 'L2', created: false, reason: 'duplicate', variantOf: 'KESSLER, DOROTHY' });
  });

  it('creates a co-owner on the same case, and never looks for variants unless asked', async () => {
    const coOwner = build([{ leadId: 'L3', stage: 'New', dedupeUid: 'CITRUS|2026-0999TD|WALTER_KESSLER' }]);
    await expect(coOwner.service.createSurplusLead(row, { organizationId: 'org1', matchNameVariants: true })).rejects.toThrow('would create');

    const plain = build([]);
    await expect(plain.service.createSurplusLead(row, { organizationId: 'org1' })).rejects.toThrow('would create');
    expect(plain.prisma.surplusDetail.findMany).not.toHaveBeenCalled();
  });

  it('does not guess without a case or parcel number', async () => {
    const { service, prisma } = build([]);
    await expect(
      service.createSurplusLead({ ...row, caseNumber: undefined }, { organizationId: 'org1', matchNameVariants: true }),
    ).rejects.toThrow('would create');
    expect(prisma.surplusDetail.findMany).not.toHaveBeenCalled();
  });
});

describe('SurplusImportService report', () => {
  const sheet = (names: string[]) => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Claimant', 'Surplus Amount', 'County', 'Case Number'],
      ...names.map((n, i) => [n, 25000, 'Citrus', `2026-01${i}TD`]),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'List');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };

  it('puts every matched row in exactly one of on file, ruled out and paid out', async () => {
    const answers: Record<string, any> = {
      'NEW PERSON': { leadId: 'n', created: true },
      'LIVE CASE': { leadId: 'a', created: false, reason: 'duplicate', existing: { stage: SurplusStage.CONTACTED }, variantOf: 'CASE, LIVE' },
      'DEAD CASE': {
        leadId: 'd', created: false, reason: 'duplicate',
        existing: { stage: SurplusStage.DEAD, deadReason: SurplusDeadReason.COMPETING_CLAIM, deadAt: null },
      },
      'OUR PAID': { leadId: 'p', created: false, reason: 'duplicate', existing: { stage: SurplusStage.PAID } },
      'COUNTY PAID': { leadId: 'c', created: false, reason: 'duplicate', existing: { stage: SurplusStage.NEW, claimStatus: SurplusClaimStatus.DISTRIBUTED } },
      'GONE CASE': { leadId: null, created: false, reason: 'suppressed', suppressedAt: null },
    };
    const surplus: any = { createSurplusLead: jest.fn(async (input: any) => answers[input.claimant]) };
    const svc = new SurplusImportService(surplus);
    const r = await svc.executeImport(sheet(Object.keys(answers)), { organizationId: 'org1' });

    expect(surplus.createSurplusLead.mock.calls[0][1]).toMatchObject({ respectSuppression: true, matchNameVariants: true });
    expect(r.created).toBe(1);
    expect(r.alreadyOnFile).toEqual([{ row: 3, leadId: 'a', claimant: 'LIVE CASE', caseNumber: '2026-011TD', stage: SurplusStage.CONTACTED, variantOf: 'CASE, LIVE' }]);
    expect(r.previouslyDead.map((p) => [p.claimant, p.reason])).toEqual([['DEAD CASE', 'Competing claim already filed']]);
    expect(r.paidOut.map((p) => [p.claimant, p.why])).toEqual([
      ['OUR PAID', 'paid to our client'],
      ['COUNTY PAID', 'the county paid it out'],
    ]);
    expect(r.previouslyDeleted.map((p) => p.claimant)).toEqual(['GONE CASE']);
    expect(r.duplicates).toBe(4);
    expect(r.nameVariants).toBe(1);
  });
});
