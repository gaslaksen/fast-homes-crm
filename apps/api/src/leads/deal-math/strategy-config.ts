import { ExitStrategy } from '@fast-homes/shared';

// Per-strategy declarative config for Phase D Deal Math.
//
// One source of truth for which inputs render in the left column, which
// output cards render in the right column, and how the spread/sanity callout
// reads. The UI iterates this config - there are no `if (strategy === 'wholesale')`
// branches in components. Adding a 10th strategy means adding a 10th entry here.
//
// Math derivations live in profit-calculation.service.ts and are wired through
// DealMathService; this file is purely the *shape* of the surface.

export type DealMathStrategyKey = ExitStrategy;

export type StrategyInputType =
  | 'currency'
  | 'percent'
  | 'number'
  | 'days'
  | 'text'
  | 'chip-group';

export interface StrategyInputField {
  key: string;
  label: string;
  type: StrategyInputType;
  default?: number | string;
  /** For chip-group: each chip's label + value (e.g. MAO % chips: 60/65/70/...). */
  chips?: Array<{ label: string; value: number }>;
  placeholder?: string;
  /** Hint shown below the field, e.g. "From contract.offerAmount". */
  helperText?: string;
}

export type OutputFormat = 'currency' | 'percent' | 'days' | 'multiplier';

export interface StrategyOutputCard {
  key: string;
  label: string;
  format: OutputFormat;
  emphasis?: 'primary' | 'secondary';
  /** Optional sub-line generator. Receives all output values + ctx. */
  subline?: (
    outputs: Record<string, number | null>,
    ctx: SpreadCtx,
  ) => string | null;
}

/** Inputs to spread/output computation (read by the math service + callout). */
export interface SpreadCtx {
  arv: number | null;
  repairEstimate: number | null;
  askingPrice: number | null;
  /** Strategy-specific inputs from lead.dealMathInputs[strategy]. */
  inputs: Record<string, number | string | null>;
}

export interface SpreadResult {
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  message: string;
}

export interface StrategyConfig {
  key: DealMathStrategyKey;
  label: string;
  /** One-line description shown beneath the strategy selector. */
  tagline: string;
  inputs: StrategyInputField[];
  outputs: StrategyOutputCard[];
  /** Returns null when there's nothing to surface (e.g. inputs incomplete). */
  spreadCallout?: (ctx: SpreadCtx, outputs: Record<string, number | null>) => SpreadResult | null;
}

const MAO_CHIPS = [60, 65, 70, 75, 80, 85, 90].map((p) => ({
  label: `${p}%`,
  value: p,
}));

const formatCurrency = (n: number | null): string =>
  n == null || !isFinite(n)
    ? '-'
    : `$${Math.round(n).toLocaleString('en-US')}`;

// Helper used by several strategies' spread callouts to compare asking to MAO.
const askingVsMao = (
  ctx: SpreadCtx,
  mao: number | null,
): SpreadResult | null => {
  if (mao == null || ctx.arv == null || ctx.askingPrice == null) return null;
  const askingPctOfArv = ((ctx.askingPrice / ctx.arv) * 100).toFixed(0);
  if (ctx.askingPrice <= mao) {
    return {
      tone: 'good',
      message: `Asking is ${askingPctOfArv}% of ARV - Below MAO!`,
    };
  }
  const delta = ctx.askingPrice - mao;
  return {
    tone: 'bad',
    message: `Asking is ${askingPctOfArv}% of ARV - Above MAO by ${formatCurrency(delta)}`,
  };
};

export const STRATEGY_CONFIGS: Record<DealMathStrategyKey, StrategyConfig> = {
  // ── WHOLESALE ───────────────────────────────────────────────────────────
  wholesale: {
    key: 'wholesale',
    label: 'Wholesale',
    tagline: 'Assign the contract to an end buyer for a fee.',
    inputs: [
      {
        key: 'assignmentFee',
        label: 'Wholesale Assignment Fee',
        type: 'currency',
        default: 15000,
      },
      {
        key: 'maoPercent',
        label: 'MAO %',
        type: 'chip-group',
        chips: MAO_CHIPS,
        default: 70,
      },
    ],
    outputs: [
      {
        key: 'initialOffer',
        label: 'Initial Offer to Seller',
        format: 'currency',
        emphasis: 'secondary',
      },
      {
        key: 'mao',
        label: 'Maximum Allowable Offer',
        format: 'currency',
        emphasis: 'primary',
      },
      {
        key: 'salePrice',
        label: 'Sale Price to Buyer',
        format: 'currency',
      },
      {
        key: 'spread',
        label: 'Spread',
        format: 'currency',
        subline: (outputs) =>
          outputs.assignmentFee != null
            ? `Assignment fee ${formatCurrency(outputs.assignmentFee)}`
            : null,
      },
    ],
    spreadCallout: (ctx, outputs) => askingVsMao(ctx, outputs.mao),
  },

  // ── JOINT VENTURE ───────────────────────────────────────────────────────
  jv: {
    key: 'jv',
    label: 'Joint Venture',
    tagline: 'Partner on the deal, split the profit.',
    inputs: [
      {
        key: 'jvAssignmentFee',
        label: 'JV Assignment Fee',
        type: 'currency',
        default: 15000,
      },
      {
        key: 'maoPercent',
        label: 'MAO %',
        type: 'chip-group',
        chips: MAO_CHIPS,
        default: 70,
      },
      {
        key: 'jvSplitPercent',
        label: 'Our Share %',
        type: 'percent',
        default: 50,
      },
    ],
    outputs: [
      {
        key: 'initialOffer',
        label: 'Initial Offer to Seller',
        format: 'currency',
        emphasis: 'secondary',
      },
      {
        key: 'mao',
        label: 'MAO',
        format: 'currency',
        emphasis: 'primary',
      },
      {
        key: 'totalProfit',
        label: 'Total Profit',
        format: 'currency',
      },
      {
        key: 'ourShare',
        label: 'Our Share',
        format: 'currency',
      },
      {
        key: 'partnerShare',
        label: 'Partner Share',
        format: 'currency',
      },
    ],
    spreadCallout: (ctx, outputs) => askingVsMao(ctx, outputs.mao),
  },

  // ── FIX & FLIP ──────────────────────────────────────────────────────────
  fix_flip: {
    key: 'fix_flip',
    label: 'Fix & Flip',
    tagline: 'Acquire, renovate, resell at retail.',
    inputs: [
      {
        key: 'targetSalePrice',
        label: 'Projected Sale Price',
        type: 'currency',
        helperText: 'Defaults to ARV if blank',
      },
      {
        key: 'holdingPeriodMonths',
        label: 'Holding Period (months)',
        type: 'number',
        default: 6,
      },
      {
        key: 'monthlyCarryingCost',
        label: 'Monthly Carrying Cost',
        type: 'currency',
        default: 1500,
      },
      {
        key: 'acquisitionClosingCosts',
        label: 'Acquisition Closing Costs',
        type: 'currency',
        default: 3000,
      },
      {
        key: 'saleClosingCosts',
        label: 'Sale Closing Costs',
        type: 'currency',
        default: 6000,
      },
      {
        key: 'targetProfitPercent',
        label: 'Target Profit %',
        type: 'percent',
        default: 20,
      },
    ],
    outputs: [
      { key: 'mao', label: 'MAO', format: 'currency', emphasis: 'primary' },
      { key: 'totalInvestment', label: 'Total Investment', format: 'currency' },
      { key: 'projectedSalePrice', label: 'Projected Sale Price', format: 'currency' },
      { key: 'netProfit', label: 'Net Profit', format: 'currency', emphasis: 'secondary' },
      { key: 'roiPercent', label: 'ROI', format: 'percent' },
    ],
    spreadCallout: (ctx, outputs) => {
      const roi = outputs.roiPercent;
      const targetPct = (ctx.inputs.targetProfitPercent as number) ?? 20;
      if (roi == null) return null;
      if (roi >= targetPct) {
        return {
          tone: 'good',
          message: `ROI ${roi.toFixed(0)}% over hold meets target (${targetPct}%)`,
        };
      }
      return {
        tone: 'warn',
        message: `ROI ${roi.toFixed(0)}% - below ${targetPct}% target`,
      };
    },
  },

  // ── NOVATION ────────────────────────────────────────────────────────────
  novation: {
    key: 'novation',
    label: 'Novation',
    tagline: 'List on MLS under our agreement, seller takes the net.',
    inputs: [
      {
        key: 'targetListPrice',
        label: 'Target List Price',
        type: 'currency',
        helperText: 'Defaults to ARV if blank',
      },
      {
        key: 'agentCommissionPercent',
        label: 'Agent Commission %',
        type: 'percent',
        default: 6,
      },
      {
        key: 'sellerNetTarget',
        label: 'Target Net to Seller',
        type: 'currency',
      },
      {
        key: 'costsTotal',
        label: 'Estimated Costs',
        type: 'currency',
        default: 0,
        helperText: 'Marketing, staging, etc.',
      },
    ],
    outputs: [
      { key: 'listPrice', label: 'List Price', format: 'currency', emphasis: 'primary' },
      { key: 'agentCommission', label: 'Agent Commission', format: 'currency' },
      { key: 'estimatedNetToSeller', label: 'Net to Seller', format: 'currency' },
      { key: 'estimatedProfit', label: 'Estimated Profit', format: 'currency', emphasis: 'secondary' },
    ],
    spreadCallout: (ctx, outputs) => {
      if (outputs.estimatedNetToSeller == null || ctx.askingPrice == null) return null;
      const delta = outputs.estimatedNetToSeller - ctx.askingPrice;
      if (delta >= 0) {
        return {
          tone: 'good',
          message: `Net to seller ${formatCurrency(delta)} above asking`,
        };
      }
      return {
        tone: 'warn',
        message: `Net to seller ${formatCurrency(Math.abs(delta))} below asking`,
      };
    },
  },

  // ── SUBJECT-TO ──────────────────────────────────────────────────────────
  sub_to: {
    key: 'sub_to',
    label: 'Subject-To',
    tagline: 'Take title subject to existing financing.',
    inputs: [
      { key: 'loanBalance', label: 'Loan Balance', type: 'currency' },
      { key: 'monthlyPayment', label: 'Monthly Payment', type: 'currency' },
      { key: 'sellerEquity', label: 'Seller Equity Owed', type: 'currency', default: 0 },
      { key: 'targetSalePrice', label: 'Exit Sale Price', type: 'currency', helperText: 'Defaults to ARV' },
      { key: 'costsTotal', label: 'Estimated Costs', type: 'currency', default: 0 },
    ],
    outputs: [
      { key: 'acquisitionPrice', label: 'Acquisition Price', format: 'currency', emphasis: 'primary' },
      { key: 'salePrice', label: 'Exit Sale Price', format: 'currency' },
      { key: 'estimatedProfit', label: 'Estimated Profit', format: 'currency', emphasis: 'secondary' },
    ],
    spreadCallout: (ctx, outputs) => {
      if (outputs.estimatedProfit == null) return null;
      if (outputs.estimatedProfit > 0) {
        return {
          tone: 'good',
          message: `Projected profit ${formatCurrency(outputs.estimatedProfit)} from sub-to exit`,
        };
      }
      return { tone: 'bad', message: `Sub-to projects a loss - review costs and exit price` };
    },
  },

  // ── CREATIVE FINANCE / OTHER ────────────────────────────────────────────
  // The existing ExitStrategy taxonomy doesn't have a CREATIVE_FINANCE key;
  // creative-finance deals are modeled today via `other` with custom inputs.
  // Phase E may split this out into a dedicated key.
  other: {
    key: 'other',
    label: 'Creative / Other',
    tagline: 'Custom terms - owner finance, seller carry, lease option, etc.',
    inputs: [
      { key: 'targetSalePrice', label: 'Exit Sale Price', type: 'currency' },
      { key: 'acquisitionPrice', label: 'Acquisition Price', type: 'currency' },
      { key: 'downPayment', label: 'Down Payment', type: 'currency' },
      { key: 'interestRatePercent', label: 'Interest Rate %', type: 'percent' },
      { key: 'termMonths', label: 'Term (months)', type: 'number' },
      { key: 'monthlyPayment', label: 'Monthly Payment', type: 'currency' },
      { key: 'costsTotal', label: 'Estimated Costs', type: 'currency', default: 0 },
    ],
    outputs: [
      { key: 'acquisitionPrice', label: 'Acquisition Price', format: 'currency', emphasis: 'primary' },
      { key: 'salePrice', label: 'Exit Sale Price', format: 'currency' },
      { key: 'estimatedProfit', label: 'Estimated Profit', format: 'currency', emphasis: 'secondary' },
    ],
  },

  // ── DOUBLE CLOSE (Wholetail-style) ──────────────────────────────────────
  // Closest match to the build prompt's "Wholetail" - we acquire briefly,
  // then resell with light cleanup.
  double_close: {
    key: 'double_close',
    label: 'Wholetail / Double Close',
    tagline: 'Light rehab, quick resale through double close.',
    inputs: [
      { key: 'targetSalePrice', label: 'Target List Price', type: 'currency', helperText: 'Defaults to ARV' },
      { key: 'lightRehabBudget', label: 'Light Rehab Budget', type: 'currency', default: 5000 },
      { key: 'holdingPeriodMonths', label: 'Holding Period (months)', type: 'number', default: 2 },
      { key: 'acquisitionClosingCosts', label: 'Acquisition Closing Costs', type: 'currency', default: 3000 },
      { key: 'saleClosingCosts', label: 'Sale Closing Costs', type: 'currency', default: 6000 },
    ],
    outputs: [
      { key: 'mao', label: 'MAO', format: 'currency', emphasis: 'primary' },
      { key: 'projectedSalePrice', label: 'Projected Sale Price', format: 'currency' },
      { key: 'estimatedProfit', label: 'Estimated Profit', format: 'currency', emphasis: 'secondary' },
    ],
    spreadCallout: (ctx, outputs) => askingVsMao(ctx, outputs.mao),
  },

  // ── HOLD / RENTAL ───────────────────────────────────────────────────────
  hold_rental: {
    key: 'hold_rental',
    label: 'Hold / Rental',
    tagline: 'Acquire and hold for cashflow.',
    inputs: [
      { key: 'monthlyRent', label: 'Monthly Rent', type: 'currency' },
      { key: 'monthlyOperatingExpenses', label: 'Monthly Operating Costs', type: 'currency' },
      { key: 'monthlyDebtService', label: 'Monthly Debt Service', type: 'currency', default: 0 },
      { key: 'targetCapRate', label: 'Target Cap Rate %', type: 'percent', default: 7 },
      { key: 'acquisitionClosingCosts', label: 'Acquisition Closing Costs', type: 'currency', default: 3000 },
    ],
    outputs: [
      { key: 'mao', label: 'MAO', format: 'currency', emphasis: 'primary' },
      { key: 'monthlyCashflow', label: 'Monthly Cashflow', format: 'currency' },
      { key: 'noi', label: 'Annual NOI', format: 'currency' },
      { key: 'capRate', label: 'Cap Rate', format: 'percent', emphasis: 'secondary' },
    ],
    spreadCallout: (ctx, outputs) => {
      const cap = outputs.capRate;
      const target = (ctx.inputs.targetCapRate as number) ?? 7;
      if (cap == null) return null;
      if (cap >= target) {
        return { tone: 'good', message: `Cap rate ${cap.toFixed(1)}% meets ${target}% target` };
      }
      return { tone: 'warn', message: `Cap rate ${cap.toFixed(1)}% - below ${target}% target` };
    },
  },

  // ── CONCIERGE LISTING ───────────────────────────────────────────────────
  concierge_listing: {
    key: 'concierge_listing',
    label: 'Concierge Listing',
    tagline: 'List with an agent, optimize for highest net to seller.',
    inputs: [
      { key: 'targetListPrice', label: 'Target List Price', type: 'currency' },
      { key: 'commissionPercent', label: 'Commission %', type: 'percent', default: 6 },
      { key: 'expectedDom', label: 'Expected Days on Market', type: 'days', default: 45 },
      { key: 'estimatedClosingCosts', label: 'Closing Costs', type: 'currency', default: 4000 },
    ],
    outputs: [
      { key: 'listPrice', label: 'List Price', format: 'currency', emphasis: 'primary' },
      { key: 'commission', label: 'Commission', format: 'currency' },
      { key: 'estimatedNetToSeller', label: 'Estimated Net to Seller', format: 'currency', emphasis: 'secondary' },
      { key: 'expectedDom', label: 'Expected DOM', format: 'days' },
    ],
    spreadCallout: (ctx, outputs) => {
      if (outputs.estimatedNetToSeller == null || ctx.askingPrice == null) return null;
      const delta = outputs.estimatedNetToSeller - ctx.askingPrice;
      if (delta >= 0) {
        return { tone: 'good', message: `Net to seller ${formatCurrency(delta)} above asking` };
      }
      return { tone: 'warn', message: `Net to seller ${formatCurrency(Math.abs(delta))} below asking` };
    },
  },
};

export const STRATEGY_KEYS: DealMathStrategyKey[] = [
  'wholesale',
  'jv',
  'fix_flip',
  'novation',
  'sub_to',
  'double_close',
  'hold_rental',
  'concierge_listing',
  'other',
];
