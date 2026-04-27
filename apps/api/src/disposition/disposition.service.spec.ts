import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitCalculationService } from '../leads/profit-calculation.service';
import { DispositionService } from './disposition.service';

// Validation guards live in the service layer (not the Prisma schema), so
// these tests pin the contract that the controller and any future direct
// callers can rely on. Profit recalculation is stubbed — its math has its
// own dedicated suite (profit-calculation.service.spec.ts).
describe('DispositionService validation', () => {
  let svc: DispositionService;
  let prismaMock: any;
  let profitMock: any;

  beforeEach(async () => {
    prismaMock = {
      lead: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      contract: { update: jest.fn().mockResolvedValue({}) },
      activity: { create: jest.fn().mockResolvedValue({}) },
      // Disposition v2 models reach Prisma via dynamic property access (the
      // worktree client wasn't regenerated). A plain object with jest.fns is
      // enough for unit testing.
      dispositionPlan: { findUnique: jest.fn(), upsert: jest.fn().mockResolvedValue({ exitStrategy: 'wholesale' }) },
      dispositionCost: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'c1', category: 'holding', amount: 500 }),
        update: jest.fn().mockResolvedValue({ id: 'c1', category: 'holding', amount: 500 }),
        delete: jest.fn().mockResolvedValue({}),
      },
      finalSale: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'fs1', finalSalePrice: 200000 }),
      },
    };
    profitMock = {
      recalculate: jest.fn().mockResolvedValue({ bucket: 'expected', ourShare: 100, gross: 100, jvShare: 0, formulaUsed: '', warnings: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispositionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ProfitCalculationService, useValue: profitMock },
      ],
    }).compile();
    svc = module.get(DispositionService);
  });

  // ── upsertPlan ──────────────────────────────────────────────────────────

  it('rejects an invalid exit strategy', async () => {
    await expect(svc.upsertPlan('lead_1', { exitStrategy: 'fantasy' as any }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires jvSplitPercent when jvSplitMode = custom', async () => {
    await expect(svc.upsertPlan('lead_1', { exitStrategy: 'jv', jvSplitMode: 'custom' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upsertPlan('lead_1', { exitStrategy: 'jv', jvSplitMode: 'custom', jvSplitPercent: 150 }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires jvPartnerId when jvSplitMode != none', async () => {
    await expect(svc.upsertPlan('lead_1', { exitStrategy: 'jv', jvSplitMode: 'fifty_fifty' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a custom JV split with valid percent and partner', async () => {
    prismaMock.dispositionPlan.findUnique.mockResolvedValue(null);
    prismaMock.lead.findUnique.mockResolvedValue({ arv: 250_000 });
    await svc.upsertPlan('lead_1', {
      exitStrategy: 'jv',
      jvSplitMode: 'custom',
      jvSplitPercent: 60,
      jvPartnerId: 'p1',
    });
    expect(prismaMock.dispositionPlan.upsert).toHaveBeenCalled();
    // First-time plan should default targetSalePrice from lead.arv.
    const upsertArg = prismaMock.dispositionPlan.upsert.mock.calls[0][0];
    expect(upsertArg.create.targetSalePrice).toBe(250_000);
  });

  // ── createCost ──────────────────────────────────────────────────────────

  it('rejects an invalid cost category', async () => {
    await expect(svc.createCost('lead_1', { category: 'gas-money', amount: 100 } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects zero or negative cost amounts', async () => {
    await expect(svc.createCost('lead_1', { category: 'holding', amount: 0 } as any))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createCost('lead_1', { category: 'holding', amount: -50 } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  // ── upsertFinalSale ─────────────────────────────────────────────────────

  it('requires a positive sale price', async () => {
    await expect(svc.upsertFinalSale('lead_1', { closedAt: '2026-01-01' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upsertFinalSale('lead_1', { finalSalePrice: -1, closedAt: '2026-01-01' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires closedAt', async () => {
    await expect(svc.upsertFinalSale('lead_1', { finalSalePrice: 100_000 } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  // ── markAcquired state machine ──────────────────────────────────────────

  it('refuses to mark acquired without a signed contract', async () => {
    prismaMock.lead.findUnique.mockResolvedValue({ id: 'lead_1', contract: null });
    await expect(svc.markAcquired('lead_1')).rejects.toBeInstanceOf(BadRequestException);

    prismaMock.lead.findUnique.mockResolvedValue({ id: 'lead_1', contract: { contractStatus: 'draft' } });
    await expect(svc.markAcquired('lead_1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('marks acquired when contract is signed; sets status + acquiredDate', async () => {
    prismaMock.lead.findUnique.mockResolvedValue({ id: 'lead_1', contract: { contractStatus: 'signed' } });
    const result = await svc.markAcquired('lead_1');

    expect(result.status).toBe('ACQUIRED');
    const leadUpdate = prismaMock.lead.update.mock.calls[0][0];
    expect(leadUpdate.data.status).toBe('ACQUIRED');
    expect(leadUpdate.data.acquiredDate).toBeInstanceOf(Date);
    expect(prismaMock.activity.create).toHaveBeenCalled();
  });

  // ── markSold state machine ──────────────────────────────────────────────

  it('refuses to mark sold without a final sale record', async () => {
    prismaMock.finalSale.findUnique.mockResolvedValue(null);
    await expect(svc.markSold('lead_1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('marks SOLD when realized profit ≥ 0', async () => {
    prismaMock.finalSale.findUnique.mockResolvedValue({ id: 'fs1' });
    profitMock.recalculate.mockResolvedValue({ bucket: 'realized', ourShare: 12_000, gross: 12_000, jvShare: 0, formulaUsed: '', warnings: [] });
    const result = await svc.markSold('lead_1');
    expect(result.status).toBe('SOLD');
  });

  it('marks SOLD_LOSS when realized profit < 0', async () => {
    prismaMock.finalSale.findUnique.mockResolvedValue({ id: 'fs1' });
    profitMock.recalculate.mockResolvedValue({ bucket: 'realized', ourShare: -3_000, gross: -3_000, jvShare: 0, formulaUsed: '', warnings: [] });
    const result = await svc.markSold('lead_1');
    expect(result.status).toBe('SOLD_LOSS');
  });
});

describe('DispositionService deleteCost', () => {
  let svc: DispositionService;
  let prismaMock: any;
  let profitMock: any;

  beforeEach(async () => {
    prismaMock = {
      activity: { create: jest.fn().mockResolvedValue({}) },
      dispositionCost: {
        findFirst: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    profitMock = { recalculate: jest.fn().mockResolvedValue({}) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispositionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ProfitCalculationService, useValue: profitMock },
      ],
    }).compile();
    svc = module.get(DispositionService);
  });

  it('throws NotFoundException for an unknown cost', async () => {
    prismaMock.dispositionCost.findFirst.mockResolvedValue(null);
    await expect(svc.deleteCost('lead_1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes the cost and triggers recalc', async () => {
    prismaMock.dispositionCost.findFirst.mockResolvedValue({ id: 'c1', category: 'holding', amount: 500 });
    await svc.deleteCost('lead_1', 'c1');
    expect(prismaMock.dispositionCost.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(profitMock.recalculate).toHaveBeenCalledWith('lead_1');
  });
});
