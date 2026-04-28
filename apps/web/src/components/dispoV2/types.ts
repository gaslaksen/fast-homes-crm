// Local types mirroring the v2 fields added to /leads/:id/dispo by the
// disposition-v2 backend. Kept here (rather than imported from shared) to
// avoid coupling the UI to the shared package's compiled output during
// rollout. Once the shared package builds catch up, these can be replaced
// by direct imports of DispositionPlan / DispositionCost / FinalSale /
// ProfitCalcResult from @fast-homes/shared.

export type ExitStrategy =
  | 'wholesale'
  | 'novation'
  | 'double_close'
  | 'fix_flip'
  | 'concierge_listing'
  | 'hold_rental'
  | 'jv'
  | 'sub_to'
  | 'other';

export type JvSplitMode = 'none' | 'fifty_fifty' | 'custom';
export type ProfitBucket = 'potential' | 'expected' | 'realized';

export type DispositionCostCategory =
  | 'holding'
  | 'repair_prep'
  | 'utilities'
  | 'marketing'
  | 'closing'
  | 'jv_payout'
  | 'other';

export interface DispositionPlan {
  id: string;
  leadId: string;
  exitStrategy: ExitStrategy;
  targetSalePrice: number | null;
  targetCloseDate: string | null;
  jvPartnerId: string | null;
  jvSplitMode: JvSplitMode | null;
  jvSplitPercent: number | null;
  notes: string | null;
}

export interface DispositionCost {
  id: string;
  leadId: string;
  category: DispositionCostCategory;
  description: string | null;
  amount: number;
  incurredAt: string;
  paidTo: string | null;
  receiptUrl: string | null;
}

export interface FinalSale {
  id: string;
  leadId: string;
  buyerName: string | null;
  buyerPartnerId: string | null;
  finalSalePrice: number;
  saleClosingCosts: number | null;
  netProceeds: number | null;
  closedAt: string;
  notes: string | null;
}

export interface ProfitCalcResult {
  bucket: ProfitBucket;
  gross: number | null;
  ourShare: number | null;
  jvShare: number | null;
  formulaUsed: string;
  warnings: string[];
}

export interface Offer {
  id: string;
  offerAmount: number;
  offerDate: string;
  status: string;
  counterAmount: number | null;
  notes: string | null;
  visibleOnPortal: boolean;
  createdAt: string;
}

export interface DispoSummaryV2 {
  arv: number | null;
  targetSalePrice: number | null;
  repairCost: number | null;
  mao: number | null;
  maoPercent: number | null;
  askingPrice: number | null;
  offerAmount: number | null;
  assignmentFee: number | null;
  exitStrategy: string;
  buyerPrice: number | null;
  buyerSpread: number | null;
  projectedProfit: number | null;
  contract: any | null;
  offers: Offer[];
  acceptedOffer: Offer | null;
  pendingOffer: Offer | null;
  dispositionPlan: DispositionPlan | null;
  costs: DispositionCost[];
  costsTotal: number;
  finalSale: FinalSale | null;
  profit: ProfitCalcResult;
  acquiredDate: string | null;
  soldDate: string | null;
  needsBackfillBanner: boolean;
}

export const COST_CATEGORY_LABELS: Record<DispositionCostCategory, string> = {
  holding: 'Holding',
  repair_prep: 'Repairs / Prep',
  utilities: 'Utilities',
  marketing: 'Marketing',
  closing: 'Closing',
  jv_payout: 'JV Payout',
  other: 'Other',
};

export const EXIT_STRATEGY_LABELS: Record<ExitStrategy, string> = {
  wholesale: 'Wholesale (Assignment)',
  novation: 'Novation Agreement',
  double_close: 'Double Close',
  fix_flip: 'Fix & Flip',
  concierge_listing: 'Concierge Listing (Houzeo + 1%)',
  hold_rental: 'Hold (Rental)',
  jv: 'Joint Venture',
  sub_to: 'Subject-To',
  other: 'Other',
};

export const FUNDING_SOURCES = [
  { value: 'cash', label: 'Cash' },
  { value: 'hard_money', label: 'Hard Money' },
  { value: 'private_money', label: 'Private Money' },
  { value: 'seller_finance', label: 'Seller Finance' },
  { value: 'jv_capital', label: 'JV Capital' },
  { value: 'other', label: 'Other' },
];
