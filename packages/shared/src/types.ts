// Lead Status Pipeline.
// Active stages: NEW → ... → CLOSING → ACQUIRED → SOLD.
// Pre-acquisition deal-loss: CLOSED_LOST. Post-acquisition outcomes:
// SOLD (profitable close), SOLD_LOSS (closed below cost), HELD_LONG_TERM
// (kept as rental — no further sale), CANCELLED (deal fell apart after offer).
// NURTURE / DEAD are off-pipeline parking lanes.
export enum LeadStatus {
  NEW = 'NEW',
  ATTEMPTING_CONTACT = 'ATTEMPTING_CONTACT',
  QUALIFYING = 'QUALIFYING',
  QUALIFIED = 'QUALIFIED',
  OFFER_SENT = 'OFFER_SENT',
  NEGOTIATING = 'NEGOTIATING',
  UNDER_CONTRACT = 'UNDER_CONTRACT',
  CLOSING = 'CLOSING',
  ACQUIRED = 'ACQUIRED',
  SOLD = 'SOLD',
  SOLD_LOSS = 'SOLD_LOSS',
  HELD_LONG_TERM = 'HELD_LONG_TERM',
  CANCELLED = 'CANCELLED',
  CLOSED_LOST = 'CLOSED_LOST',
  NURTURE = 'NURTURE',
  DEAD = 'DEAD',
}

// Statuses that represent "out of active pipeline" — used by list filters,
// inactive-deal counts, and dashboard tiles to hide closed deals by default.
export const TERMINAL_STATUSES: LeadStatus[] = [
  LeadStatus.SOLD,
  LeadStatus.SOLD_LOSS,
  LeadStatus.HELD_LONG_TERM,
  LeadStatus.CANCELLED,
  LeadStatus.CLOSED_LOST,
  LeadStatus.DEAD,
];

// Lead Source
export enum LeadSource {
  PROPERTY_LEADS = 'PROPERTY_LEADS',
  GOOGLE_ADS = 'GOOGLE_ADS',
  LEADHOUSE = 'LEADHOUSE',
  MANUAL = 'MANUAL',
  DEAL_SEARCH = 'DEAL_SEARCH',
  FORECLOSURE = 'FORECLOSURE',
  PROBATE = 'PROBATE',
  TAX_SALE = 'TAX_SALE',
  SURPLUS = 'SURPLUS',
  OTHER = 'OTHER',
}

// Where a probate lead sits in our own working of it. Mirrors
// ForeclosureWorkStatus so the two distress lists read the same way.
export enum ProbateWorkStatus {
  NOT_CONTACTED = 'NOT_CONTACTED',
  IN_CONVERSATION = 'IN_CONVERSATION',
  APPOINTMENT_SET = 'APPOINTMENT_SET',
  UNDER_CONTRACT = 'UNDER_CONTRACT',
  DEAD = 'DEAD',
}

// Foreclosure lead priority (from the pre-foreclosure notice triage rules).
export enum ForeclosurePriority {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

// Foreclosure notice type parsed from the public notice / eCourts filing.
export enum ForeclosureNoticeType {
  MORTGAGE_FORECLOSURE = 'mortgage_foreclosure',
  HOA_LIEN = 'hoa_lien',
  TAX_FORECLOSURE = 'tax_foreclosure',
  SHERIFF_SALE = 'sheriff_sale',
  PRE_FORECLOSURE_HEARING = 'pre_foreclosure_hearing',
  AUCTION_COM_FORECLOSURE = 'auction_com_foreclosure',
}

// Kind of filing inside a foreclosure case file. One case accumulates several
// of these over its life (hearing notice, then sale notice, then upset bids),
// which is why documents hang off the case number rather than the lead.
export enum ForeclosureDocumentType {
  NOTICE_OF_HEARING = 'NOTICE_OF_HEARING',
  NOTICE_OF_SALE = 'NOTICE_OF_SALE',
  SUBSTITUTION_OF_TRUSTEE = 'SUBSTITUTION_OF_TRUSTEE',
  ORDER_ALLOWING_SALE = 'ORDER_ALLOWING_SALE',
  NOTICE_OF_UPSET_BID = 'NOTICE_OF_UPSET_BID',
  CANCELLATION = 'CANCELLATION',
  OTHER = 'OTHER',
}

// How the raw text was pulled out of an uploaded filing. 'ocr' is reserved:
// every NC eCourts filing seen so far carries a usable text layer, so the OCR
// path is deliberately not built yet. See charsPerPage on ForeclosureDocument.
export enum ForeclosureExtractionMethod {
  TEXT_LAYER = 'text_layer',
  OCR = 'ocr',
  HYBRID = 'hybrid',
  NONE = 'none',
}

// How a foreclosure lead entered Dealcore.
export enum ForeclosureSourceKind {
  RSS = 'rss',
  PDF = 'pdf',
  IMPORT = 'import',
  MANUAL = 'manual',
}

// Per-lead work status on the Foreclosures board (mirrors the offline tracker).
export enum ForeclosureWorkStatus {
  NOT_CONTACTED = 'NOT_CONTACTED',
  IN_CONVERSATION = 'IN_CONVERSATION',
  APPOINTMENT_SET = 'APPOINTMENT_SET',
  UNDER_CONTRACT = 'UNDER_CONTRACT',
  DEAD = 'DEAD',
}

// ── Tax Sales ───────────────────────────────────────────────────────────────
// NC delinquent tax foreclosures run on two tracks and the difference decides
// who conducts the sale and what deed the buyer gets:
//   IN_REM, NCGS 105-375  -> clerk-docketed judgment, Sheriff sells, Sheriff's Deed.
//   JUDICIAL, NCGS 105-374 -> full civil action, a commissioner sells, Commissioner's Deed.
export enum TaxSaleMethod {
  IN_REM = 'IN_REM',
  JUDICIAL = 'JUDICIAL',
}

// Where the filing sits. REDEEMED is terminal: the owner paid the county off
// before confirmation and the property came out of the sale, which kills the
// lead outright rather than parking it.
export enum TaxSaleStage {
  JUDGMENT_DOCKETED = 'JUDGMENT_DOCKETED',
  SALE_SCHEDULED = 'SALE_SCHEDULED',
  UPSET_BID_PERIOD = 'UPSET_BID_PERIOD',
  REDEEMED = 'REDEEMED',
}

// Per-lead work status on the Tax Sales board. Carries ATTEMPTED, which the
// foreclosure and probate boards do not: a tax sale lead is usually cold-called
// off a public filing, so "we dialed and got nothing" is a real state.
export enum TaxSaleWorkStatus {
  NOT_CONTACTED = 'NOT_CONTACTED',
  ATTEMPTED = 'ATTEMPTED',
  IN_CONVERSATION = 'IN_CONVERSATION',
  APPOINTMENT_SET = 'APPOINTMENT_SET',
  UNDER_CONTRACT = 'UNDER_CONTRACT',
  DEAD = 'DEAD',
}

export enum TaxSaleOccupancy {
  OWNER_OCCUPIED = 'OWNER_OCCUPIED',
  ABSENTEE = 'ABSENTEE',
  VACANT = 'VACANT',
  UNKNOWN = 'UNKNOWN',
}

// Why a number must not be dialed. Federal and state registries are the bulk of
// it; a litigator flag is a serial TCPA plaintiff and is never worth the risk.
export enum DncRegistry {
  FEDERAL = 'federal',
  STATE = 'state',
  LITIGATOR = 'litigator',
  /**
   * Carries a TCPA restriction. Not a registry like the others, but it belongs
   * in the same field because the field answers one question: is there a reason
   * not to dial this number? BatchData V3 returns TCPA-restricted numbers by
   * default with a per-phone flag, where V1 silently dropped them. Returning
   * them flagged beats hiding them: a number nobody knows about cannot be
   * weighed, and an unflagged number is one somebody will dial.
   */
  TCPA = 'tcpa',
}

// ── Surplus Funds ───────────────────────────────────────────────────────────
// Florida only. NC requires an attorney to petition for surplus and certify
// title and priority, so NC is a referral at best and is not modelled here.
export enum SurplusType {
  TAX_DEED = 'tax_deed',
  MORTGAGE_FORECLOSURE = 'mortgage_foreclosure',
}

// Who is holding the money. Once funds escheat to DFS the whole regime changes:
// Chapter 717 applies, a registered representative is required, and the fee cap
// is not something we have confirmed.
export enum SurplusFundLocation {
  CLERK = 'clerk',
  STATE_ESCHEATED = 'state_escheated',
}

export enum SurplusClaimantType {
  PREVIOUS_OWNER = 'previous_owner',
  HEIR_ESTATE = 'heir_estate',
  LIENHOLDER = 'lienholder',
}

/**
 * Where the money stands on the clerk's docket, which is a different axis from
 * SurplusTier. Tier bands the DOLLARS; this bands whether anybody else has a
 * hand on them. Both matter and neither substitutes for the other.
 *
 * Read off the case document list, not off the posted balance: Duval case
 * 2025-0774TD carries three Surplus Distribution filings and the search grid
 * still shows the full $27,929.98, so a balance is not evidence the money is
 * still there.
 */
export enum SurplusClaimStatus {
  /// Notice of surplus mailed, nothing filed against it. Chase these first.
  OPEN = 'open',
  /// Only a governmental or ad valorem lien has filed. That takes a slice off
  /// the top; the owner residual is still unclaimed and still ours to win.
  GOV_LIEN = 'gov_lien',
  /// Somebody filed and the clerk denied it, and no distribution followed. The
  /// money is still there AND a motivated claimant has already identified
  /// themselves. The single best state in this enum, not a contested one.
  DENIED = 'denied',
  /// A claim is on file with no denial and no distribution yet. Contestable.
  PENDING = 'pending',
  /// A claim filed by an assignee OF the owner, so the owner has already signed
  /// with somebody else. Dead to us even though the money has not moved.
  ASSIGNED = 'assigned',
  /// Surplus Distribution filings are on the docket. The money is gone.
  DISTRIBUTED = 'distributed',
  /// Not yet classified, or classified from a source that does not publish a
  /// document list. Never treat as OPEN.
  UNKNOWN = 'unknown',
}

export enum SurplusStage {
  NEW = 'New',
  CONTACTED = 'Contacted',
  AGREEMENT_SIGNED = 'Agreement Signed',
  ASSIGNMENT_NOTARIZED = 'Assignment Notarized',
  CLAIM_FILED = 'Claim Filed',
  PAID = 'Paid',
  DEAD = 'Dead',
}

// Banding from the surplus spec. It leaves two gaps on purpose: a living owner
// at $25k+ who already has a competing lien filed, and a deceased owner under
// $25k. Neither matches a band, so both land in UNBANDED rather than being
// dropped or forced into a tier they do not belong in.
export enum SurplusTier {
  A = 'A',
  B = 'B',
  C = 'C',
  UNBANDED = 'U',
}

// Score Bands (Council Model)
export enum ScoreBand {
  DEAD_COLD = 'DEAD_COLD', // 0-3
  WORKABLE = 'WORKABLE', // 4-6
  HOT = 'HOT', // 7-9
  STRIKE_ZONE = 'STRIKE_ZONE', // 10-12
}

// ABCD Fit
export enum ABCDFit {
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
}

// Message Direction
export enum MessageDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
}

// Message Status
export enum MessageStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  RECEIVED = 'RECEIVED',
}

// Activity Types
export enum ActivityType {
  LEAD_CREATED = 'LEAD_CREATED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  SCORE_UPDATED = 'SCORE_UPDATED',
  MESSAGE_SENT = 'MESSAGE_SENT',
  MESSAGE_RECEIVED = 'MESSAGE_RECEIVED',
  COMPS_FETCHED = 'COMPS_FETCHED',
  NOTE_ADDED = 'NOTE_ADDED',
  TASK_CREATED = 'TASK_CREATED',
  TASK_COMPLETED = 'TASK_COMPLETED',
  FIELD_UPDATED = 'FIELD_UPDATED',
}

// Base Lead Interface
export interface Lead {
  id: string;
  source: LeadSource;
  status: LeadStatus;
  
  // Property Info
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  
  // Seller Info
  sellerFirstName: string;
  sellerLastName: string;
  sellerPhone: string;
  sellerEmail?: string;
  
  // Motivation/Scoring Fields
  timeline?: number; // days
  askingPrice?: number;
  conditionLevel?: string; // 'excellent' | 'good' | 'fair' | 'poor' | 'distressed'
  distressSignals?: string[]; // ['vacant', 'foreclosure', 'code_violations', 'major_repairs']
  ownershipStatus?: string; // 'sole_owner' | 'co_owner' | 'heir' | 'not_owner'
  
  // ARV/Comps
  arv?: number;
  arvConfidence?: number; // 0-100
  lastCompsDate?: Date;
  
  // Scoring
  challengeScore: number; // 0-3
  authorityScore: number; // 0-3
  moneyScore: number; // 0-3
  priorityScore: number; // 0-3
  totalScore: number; // 0-12
  scoreBand: ScoreBand;
  abcdFit?: ABCDFit;
  scoringRationale?: string;
  lastScoredAt?: Date;
  
  // Assignment & Tags
  assignedToUserId?: string;
  tags?: string[];
  
  // DNC & Compliance
  doNotContact: boolean;
  unsubscribedAt?: Date;
  
  // Touch tracking
  touchCount: number;
  lastTouchedAt?: Date;

  // Metadata
  sourceMetadata?: Record<string, any>; // Original payload from source
  createdAt: Date;
  updatedAt: Date;
}

// Scoring Input
export interface ScoringInput {
  timeline?: number;
  askingPrice?: number;
  arv?: number;
  conditionLevel?: string;
  distressSignals?: string[];
  ownershipStatus?: string;
  messageHistory?: string[]; // For AI analysis
}

// Scoring Result
export interface ScoringResult {
  challengeScore: number;
  authorityScore: number;
  moneyScore: number;
  priorityScore: number;
  totalScore: number;
  scoreBand: ScoreBand;
  abcdFit?: ABCDFit;
  rationale: string;
}

// AI Extraction Result
export interface AIExtractionResult {
  timeline_days?: number;
  asking_price?: number;
  asking_price_high?: number;    // upper bound when seller gives a range (e.g. "70 to 80")
  asking_price_raw?: string;     // exactly what seller said, for natural acknowledgment
  condition_level?: string;
  distress_signals?: string[];
  ownership_status?: string;
  seller_motivation?: string;
  fields_addressed?: string[];   // CAMP topics seller mentioned, even vaguely ("timeline", "asking_price", "condition", "ownership")
  confidence?: number;
}

// Message
export interface Message {
  id: string;
  leadId: string;
  direction: MessageDirection;
  status: MessageStatus;
  body: string;
  from: string;
  to: string;
  twilioSid?: string;
  sentAt?: Date;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Message Draft Options
export interface MessageDraft {
  direct: string;
  friendly: string;
  professional: string;
}

// Comp
export interface Comp {
  id: string;
  leadId: string;
  address: string;
  distance: number; // miles
  soldPrice: number;
  soldDate: Date;
  daysOnMarket?: number;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  sourceUrl?: string;
  createdAt: Date;
}

// Task
export interface Task {
  id: string;
  leadId: string;
  userId?: string;
  title: string;
  description?: string;
  dueDate?: Date;
  completed: boolean;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Note
export interface Note {
  id: string;
  leadId: string;
  userId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

// Activity Log
export interface Activity {
  id: string;
  leadId: string;
  userId?: string;
  type: ActivityType;
  description: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

// Contract/Closing
export interface Contract {
  id: string;
  leadId: string;
  contractDate: Date;
  buyerName?: string;
  assignmentFee?: number;
  titleCompany?: string;
  expectedCloseDate?: Date;
  actualCloseDate?: Date;
  dispositionNotes?: string;
  outcome?: 'WON' | 'LOST';
  // Disposition v2 — acquisition tracking
  acceptedOfferId?: string;
  acquisitionClosingCosts?: number;
  fundingSource?: FundingSource;
  acquiredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Disposition v2 — funding source for the acquisition
export type FundingSource =
  | 'cash'
  | 'hard_money'
  | 'private_money'
  | 'seller_finance'
  | 'jv_capital'
  | 'other';

// User
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'AGENT' | 'VIEWER';
  createdAt: Date;
  updatedAt: Date;
}

// API Request/Response types

export interface CreateLeadRequest {
  source: LeadSource;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  sellerFirstName: string;
  sellerLastName: string;
  sellerPhone: string;
  sellerEmail?: string;
  sourceMetadata?: Record<string, any>;
  [key: string]: any;
}

export interface UpdateLeadRequest {
  status?: LeadStatus;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  timeline?: number;
  askingPrice?: number;
  conditionLevel?: string;
  distressSignals?: string[];
  ownershipStatus?: string;
  arv?: number;
  assignedToUserId?: string;
  tags?: string[];
  [key: string]: any;
}

export interface LeadFilters {
  source?: LeadSource;
  status?: LeadStatus;
  scoreBand?: ScoreBand;
  assignedToUserId?: string;
  zip?: string;
  minScore?: number;
  maxScore?: number;
  search?: string;
  createdAfter?: string;
  createdBefore?: string;
}

export interface DraftMessageRequest {
  context?: string;
  leadInfo?: Partial<Lead>;
}

export interface DraftMessageResponse {
  drafts: MessageDraft;
}

export interface SendMessageRequest {
  body: string;
  to: string;
}

export interface FetchCompsRequest {
  address: string;
  city: string;
  state: string;
  zip: string;
}

// Webhook payloads

export interface PropertyLeadsWebhook {
  lead_id?: string;
  first_name: string;
  last_name: string;
  phone: string;
  email?: string;
  property_address: string;
  city: string;
  state: string;
  zip: string;
  [key: string]: any;
}

export interface TwilioInboundWebhook {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia?: string;
  [key: string]: any;
}

// Dashboard Stats
export interface DashboardStats {
  totalLeads: number;
  leadsBySource: Record<LeadSource, number>;
  leadsByStatus: Record<LeadStatus, number>;
  leadsByBand: Record<ScoreBand, number>;
  avgTimeToContract: number; // days
  conversionRate: number; // percentage
  totalRevenue: number;
}

// ── Disposition v2: post-acquisition lifecycle ─────────────────────────────

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
  targetSalePrice?: number;
  targetCloseDate?: Date;
  jvPartnerId?: string;
  jvSplitMode?: JvSplitMode;
  jvSplitPercent?: number; // our-share percent (0-100) when 'custom'
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DispositionCost {
  id: string;
  leadId: string;
  category: DispositionCostCategory;
  description?: string;
  amount: number;
  incurredAt: Date;
  paidTo?: string;
  receiptUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinalSale {
  id: string;
  leadId: string;
  buyerName?: string;
  buyerPartnerId?: string;
  finalSalePrice: number;
  saleClosingCosts?: number;
  netProceeds?: number;
  closedAt: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Output of ProfitCalculationService.calculate(). Bucket reflects whether the
// inputs are pre-acquisition (potential), under-contract (expected), or closed (realized).
export interface ProfitCalcResult {
  bucket: ProfitBucket;
  gross: number | null;        // null when required inputs are missing
  ourShare: number | null;     // gross × split (or full gross if no JV)
  jvShare: number | null;      // gross − ourShare; 0 when no JV
  formulaUsed: string;         // human-readable trace, e.g. "double_close: target − acq − costs"
  warnings: string[];          // ["Missing target sale price", ...]
}

// ── Phase D: Deal Math ─────────────────────────────────────────────────────
// `RepairEstimateMethod` is the provenance label persisted on
// Lead.currentRepairEstimateMethod and surfaced in the UI.
export type RepairEstimateMethod =
  | 'PHOTO_ANALYSIS'
  | 'QUICK_SQFT'
  | 'MANUAL_BUILDER'
  | 'AI_TEXT'
  | 'MANUAL_OVERRIDE';

// `currentDealNumbers` shape on the Lead record. Phase E reads this without
// recomputing.
export interface DealMathSnapshot {
  strategy: ExitStrategy;
  arv: number | null;
  repairEstimate: number | null;
  inputs: Record<string, number | string | null>;
  outputs: Record<string, number | null>;
  computedAt: string; // ISO
}
