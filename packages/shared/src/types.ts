// Lead Status Pipeline
export enum LeadStatus {
  NEW = 'NEW',
  ATTEMPTING_CONTACT = 'ATTEMPTING_CONTACT',
  CONTACT_MADE = 'CONTACT_MADE',
  QUALIFYING = 'QUALIFYING',
  QUALIFIED = 'QUALIFIED',
  OFFER_SENT = 'OFFER_SENT',
  NEGOTIATING = 'NEGOTIATING',
  UNDER_CONTRACT = 'UNDER_CONTRACT',
  CLOSING = 'CLOSING',
  CLOSED_WON = 'CLOSED_WON',
  CLOSED_LOST = 'CLOSED_LOST',
  NURTURE = 'NURTURE',
  DEAD = 'DEAD',
}

// Lead Source
export enum LeadSource {
  PROPERTY_LEADS = 'PROPERTY_LEADS',
  GOOGLE_ADS = 'GOOGLE_ADS',
  MANUAL = 'MANUAL',
  OTHER = 'OTHER',
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
  createdAt: Date;
  updatedAt: Date;
}

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
