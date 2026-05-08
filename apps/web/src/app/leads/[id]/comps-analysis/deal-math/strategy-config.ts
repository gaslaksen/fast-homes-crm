// Mirror of apps/api/src/leads/deal-math/strategy-config.ts. The FE needs the
// same shape to render inputs/outputs without an extra API call. Backend is
// the canonical source for compute; this file defines the *rendering* schema.
//
// ExitStrategy is duplicated locally rather than imported from
// @fast-homes/shared because the shared package has no built dist/ output at
// Vercel build time. Other web files (e.g. dispoV2/types.ts) also re-declare
// it for the same reason. Keep in sync with packages/shared/src/types.ts:411.

export type DealMathStrategyKey =
  | 'wholesale'
  | 'novation'
  | 'double_close'
  | 'fix_flip'
  | 'concierge_listing'
  | 'hold_rental'
  | 'jv'
  | 'sub_to'
  | 'other';

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
  chips?: Array<{ label: string; value: number }>;
  placeholder?: string;
  helperText?: string;
}

export type OutputFormat = 'currency' | 'percent' | 'days' | 'multiplier';

export interface StrategyOutputCard {
  key: string;
  label: string;
  format: OutputFormat;
  emphasis?: 'primary' | 'secondary';
}

export interface StrategyConfig {
  key: DealMathStrategyKey;
  label: string;
  tagline: string;
  inputs: StrategyInputField[];
  outputs: StrategyOutputCard[];
}

const MAO_CHIPS = [60, 65, 70, 75, 80, 85, 90].map((p) => ({
  label: `${p}%`,
  value: p,
}));

export const STRATEGY_CONFIGS: Record<DealMathStrategyKey, StrategyConfig> = {
  wholesale: {
    key: 'wholesale',
    label: 'Wholesale',
    tagline: 'Assign the contract to an end buyer for a fee.',
    inputs: [
      { key: 'assignmentFee', label: 'Wholesale Assignment Fee', type: 'currency', default: 15000 },
      { key: 'maoPercent', label: 'MAO %', type: 'chip-group', chips: MAO_CHIPS, default: 70 },
    ],
    outputs: [
      { key: 'initialOffer', label: 'Initial Offer to Seller', format: 'currency', emphasis: 'secondary' },
      { key: 'mao', label: 'Maximum Allowable Offer', format: 'currency', emphasis: 'primary' },
      { key: 'salePrice', label: 'Sale Price to Buyer', format: 'currency' },
      { key: 'spread', label: 'Spread', format: 'currency' },
    ],
  },
  jv: {
    key: 'jv',
    label: 'Joint Venture',
    tagline: 'Partner on the deal, split the profit.',
    inputs: [
      { key: 'jvAssignmentFee', label: 'JV Assignment Fee', type: 'currency', default: 15000 },
      { key: 'maoPercent', label: 'MAO %', type: 'chip-group', chips: MAO_CHIPS, default: 70 },
      { key: 'jvSplitPercent', label: 'Our Share %', type: 'percent', default: 50 },
    ],
    outputs: [
      { key: 'initialOffer', label: 'Initial Offer to Seller', format: 'currency', emphasis: 'secondary' },
      { key: 'mao', label: 'MAO', format: 'currency', emphasis: 'primary' },
      { key: 'totalProfit', label: 'Total Profit', format: 'currency' },
      { key: 'ourShare', label: 'Our Share', format: 'currency' },
      { key: 'partnerShare', label: 'Partner Share', format: 'currency' },
    ],
  },
  fix_flip: {
    key: 'fix_flip',
    label: 'Fix & Flip',
    tagline: 'Acquire, renovate, resell at retail.',
    inputs: [
      { key: 'targetSalePrice', label: 'Projected Sale Price', type: 'currency', helperText: 'Defaults to ARV if blank' },
      { key: 'holdingPeriodMonths', label: 'Holding Period (months)', type: 'number', default: 6 },
      { key: 'monthlyCarryingCost', label: 'Monthly Carrying Cost', type: 'currency', default: 1500 },
      { key: 'acquisitionClosingCosts', label: 'Acquisition Closing Costs', type: 'currency', default: 3000 },
      { key: 'saleClosingCosts', label: 'Sale Closing Costs', type: 'currency', default: 6000 },
      { key: 'targetProfitPercent', label: 'Target Profit %', type: 'percent', default: 20 },
    ],
    outputs: [
      { key: 'mao', label: 'MAO', format: 'currency', emphasis: 'primary' },
      { key: 'totalInvestment', label: 'Total Investment', format: 'currency' },
      { key: 'projectedSalePrice', label: 'Projected Sale Price', format: 'currency' },
      { key: 'netProfit', label: 'Net Profit', format: 'currency', emphasis: 'secondary' },
      { key: 'roiPercent', label: 'ROI', format: 'percent' },
    ],
  },
  novation: {
    key: 'novation',
    label: 'Novation',
    tagline: 'List on MLS under our agreement, seller takes the net.',
    inputs: [
      { key: 'targetListPrice', label: 'Target List Price', type: 'currency', helperText: 'Defaults to ARV if blank' },
      { key: 'agentCommissionPercent', label: 'Agent Commission %', type: 'percent', default: 6 },
      { key: 'sellerNetTarget', label: 'Target Net to Seller', type: 'currency' },
      { key: 'costsTotal', label: 'Estimated Costs', type: 'currency', default: 0, helperText: 'Marketing, staging, etc.' },
    ],
    outputs: [
      { key: 'listPrice', label: 'List Price', format: 'currency', emphasis: 'primary' },
      { key: 'agentCommission', label: 'Agent Commission', format: 'currency' },
      { key: 'estimatedNetToSeller', label: 'Net to Seller', format: 'currency' },
      { key: 'estimatedProfit', label: 'Estimated Profit', format: 'currency', emphasis: 'secondary' },
    ],
  },
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
  },
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
  },
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
  },
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

export function formatCurrency(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '-';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function formatOutput(value: number | null, format: OutputFormat): string {
  if (value == null || !isFinite(value)) return '-';
  switch (format) {
    case 'currency':
      return formatCurrency(value);
    case 'percent':
      return `${Math.round(value)}%`;
    case 'days':
      return `${Math.round(value)} days`;
    case 'multiplier':
      return `${value.toFixed(2)}x`;
  }
}
