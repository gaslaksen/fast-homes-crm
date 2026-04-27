import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitCalculationService, ProfitCalcInput } from './profit-calculation.service';

// Helper: build a calc input with sensible defaults so individual tests only
// override what they care about.
const baseInput = (overrides: Partial<ProfitCalcInput> = {}): ProfitCalcInput => ({
  exitStrategy: 'wholesale',
  acquisitionPrice: null,
  acquisitionClosingCosts: null,
  assignmentFee: null,
  targetSalePrice: null,
  finalSalePrice: null,
  saleClosingCosts: null,
  costsTotal: 0,
  jvSplitMode: 'none',
  jvSplitPercent: null,
  outcomeStatus: null,
  hasContract: false,
  hasFinalSale: false,
  ...overrides,
});

describe('ProfitCalculationService.calculate', () => {
  let svc: ProfitCalculationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfitCalculationService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    svc = module.get(ProfitCalculationService);
  });

  // 1. Concierge solo (wholesale, no JV) — full assignment fee retained.
  it('concierge solo wholesale: ourShare = assignmentFee', () => {
    const result = svc.calculate(
      baseInput({
        exitStrategy: 'wholesale',
        assignmentFee: 15000,
        hasContract: true,
      }),
    );
    expect(result.gross).toBe(15000);
    expect(result.ourShare).toBe(15000);
    expect(result.jvShare).toBe(0);
    expect(result.bucket).toBe('expected');
    expect(result.warnings).toEqual([]);
  });

  // 2. JV 50/50 — gross divided evenly.
  it('JV 50/50 split: each side gets half of gross', () => {
    const result = svc.calculate(
      baseInput({
        exitStrategy: 'wholesale',
        assignmentFee: 20000,
        jvSplitMode: 'fifty_fifty',
        hasContract: true,
      }),
    );
    expect(result.gross).toBe(20000);
    expect(result.ourShare).toBe(10000);
    expect(result.jvShare).toBe(10000);
  });

  // 3. JV custom 70/30 — our percent applied; remainder to JV.
  it('JV custom 70/30: ourShare = gross × 0.70, jvShare = remainder', () => {
    const result = svc.calculate(
      baseInput({
        exitStrategy: 'wholesale',
        assignmentFee: 10000,
        jvSplitMode: 'custom',
        jvSplitPercent: 70,
        hasContract: true,
      }),
    );
    expect(result.gross).toBe(10000);
    expect(result.ourShare).toBe(7000);
    expect(result.jvShare).toBe(3000);
  });

  // 4. Wholesale assignment, contract signed, no FinalSale yet.
  // Bucket is 'expected' (committed but not closed).
  it('wholesale with signed contract but unclosed: bucket=expected', () => {
    const result = svc.calculate(
      baseInput({
        exitStrategy: 'wholesale',
        assignmentFee: 12000,
        hasContract: true,
        hasFinalSale: false,
      }),
    );
    expect(result.bucket).toBe('expected');
    expect(result.ourShare).toBe(12000);
  });

  // 5. Double-close: 200k acquisition + 5k closing, sale at 240k − 4k closing,
  // 3k disposition costs → gross = 240 − 200 − 5 − 4 − 3 = 28k.
  it('double-close: applies both-side closing costs and dispo costs', () => {
    const result = svc.calculate(
      baseInput({
        exitStrategy: 'double_close',
        acquisitionPrice: 200_000,
        acquisitionClosingCosts: 5_000,
        finalSalePrice: 240_000,
        saleClosingCosts: 4_000,
        costsTotal: 3_000,
        hasContract: true,
        hasFinalSale: true,
      }),
    );
    expect(result.gross).toBe(28_000);
    expect(result.ourShare).toBe(28_000);
    expect(result.bucket).toBe('realized');
    expect(result.formulaUsed).toContain('double_close');
  });

  // 6. Sold at a loss: 220k sale, 230k acquisition, 5k costs → −15k.
  // FinalSale present so bucket=realized; gross is correctly negative.
  it('sold at a loss: gross is negative; bucket=realized', () => {
    const result = svc.calculate(
      baseInput({
        exitStrategy: 'fix_flip',
        acquisitionPrice: 230_000,
        finalSalePrice: 220_000,
        costsTotal: 5_000,
        hasContract: true,
        hasFinalSale: true,
        outcomeStatus: 'SOLD_LOSS',
      }),
    );
    expect(result.gross).toBe(-15_000);
    expect(result.ourShare).toBe(-15_000);
    expect(result.bucket).toBe('realized');
  });

  // 7. Missing data — never throws; returns null + warnings.
  it('missing target/final sale: gross=null + warning', () => {
    const result = svc.calculate(
      baseInput({
        exitStrategy: 'novation',
        acquisitionPrice: 180_000,
        targetSalePrice: null,
        finalSalePrice: null,
      }),
    );
    expect(result.gross).toBeNull();
    expect(result.ourShare).toBeNull();
    expect(result.warnings).toContain('Missing target sale price');
  });

  // 8. Cost split correctness — costsTotal is what callers pass in. The calc
  // reflects it once, regardless of category. (The caller sums by category;
  // we just verify the deduction is applied exactly once.)
  it('cost split: dispo costs deducted exactly once from gross', () => {
    const result = svc.calculate(
      baseInput({
        exitStrategy: 'fix_flip',
        acquisitionPrice: 100_000,
        finalSalePrice: 150_000,
        // 5 categories summed externally: 500 + 1500 + 200 + 300 + 500 = 3000
        costsTotal: 3_000,
        hasContract: true,
        hasFinalSale: true,
      }),
    );
    // 150 − 100 − 0 − 0 − 3 = 47k, costs deducted once.
    expect(result.gross).toBe(47_000);
  });

  // 9a. Bucket transitions: pre-contract → potential.
  it('no contract, no final sale: bucket=potential', () => {
    const result = svc.calculate(
      baseInput({
        exitStrategy: 'wholesale',
        assignmentFee: 10000,
        hasContract: false,
        hasFinalSale: false,
      }),
    );
    expect(result.bucket).toBe('potential');
  });

  // 9b. CANCELLED with sunk costs but no sale — realized loss = −costs.
  it('cancelled with no sale: realized = −costsTotal', () => {
    const result = svc.calculate(
      baseInput({
        exitStrategy: 'fix_flip',
        acquisitionPrice: null, // deal collapsed before acquisition
        targetSalePrice: null,
        costsTotal: 1_500, // sunk EMD/inspection
        outcomeStatus: 'CANCELLED',
      }),
    );
    expect(result.gross).toBe(-1500);
    expect(result.bucket).toBe('realized');
    expect(result.formulaUsed).toContain('cancelled');
  });
});

// Integration test for the recalculate() side effect: changing an input
// should trigger persistence + a PROFIT_BUCKET_CHANGED activity row only on
// bucket transitions.
describe('ProfitCalculationService.recalculate', () => {
  let svc: ProfitCalculationService;
  let prismaMock: any;

  const buildLead = (overrides: any = {}) => ({
    id: 'lead_1',
    status: 'UNDER_CONTRACT',
    profitBucket: 'potential',
    realizedProfit: null,
    assignmentFee: null,
    contract: {
      contractStatus: 'signed',
      offerAmount: 100_000,
      acquisitionClosingCosts: null,
      assignmentFee: 15_000,
      acceptedOffer: null,
      acquiredAt: null,
    },
    dispositionPlan: {
      exitStrategy: 'wholesale',
      targetSalePrice: null,
      jvSplitMode: 'none',
      jvSplitPercent: null,
    },
    dispositionCosts: [],
    finalSale: null,
    ...overrides,
  });

  beforeEach(async () => {
    prismaMock = {
      lead: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      activity: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfitCalculationService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    svc = module.get(ProfitCalculationService);
  });

  it('persists realizedProfit + bucket on the lead row', async () => {
    prismaMock.lead.findUnique.mockResolvedValue(buildLead());

    await svc.recalculate('lead_1');

    expect(prismaMock.lead.update).toHaveBeenCalledTimes(1);
    const updateArg = prismaMock.lead.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'lead_1' });
    expect(updateArg.data.realizedProfit).toBe(15_000);
    expect(updateArg.data.profitBucket).toBe('expected');
  });

  it('logs PROFIT_BUCKET_CHANGED when bucket transitions', async () => {
    // Old bucket was 'potential'; new is 'expected' → activity row.
    prismaMock.lead.findUnique.mockResolvedValue(buildLead());

    await svc.recalculate('lead_1');

    expect(prismaMock.activity.create).toHaveBeenCalledTimes(1);
    const args = prismaMock.activity.create.mock.calls[0][0];
    expect(args.data.type).toBe('PROFIT_BUCKET_CHANGED');
    expect(args.data.metadata.from).toBe('potential');
    expect(args.data.metadata.to).toBe('expected');
  });

  it('does NOT log PROFIT_BUCKET_CHANGED when bucket is unchanged', async () => {
    // Old bucket already 'expected'; new also 'expected' → no activity.
    prismaMock.lead.findUnique.mockResolvedValue(
      buildLead({ profitBucket: 'expected' }),
    );

    await svc.recalculate('lead_1');

    expect(prismaMock.activity.create).not.toHaveBeenCalled();
  });
});
