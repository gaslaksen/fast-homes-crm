/**
 * One probate row, normalized out of whatever list it arrived on and ready to
 * become a Lead + ProbateDetail. Every field is optional except the ones
 * createProbateLead itself insists on (an address and a phone), so a partial
 * list still imports rather than throwing at the parser.
 */
export interface ProbateLeadInput {
  // Property
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;

  // Heir / petitioner: the living contact, not the decedent.
  heirFirstName?: string;
  heirLastName?: string;
  heirCity?: string;
  /** null when the list ships no absentee column at all, as opposed to "No". */
  absenteeHeir?: boolean | null;

  phone1?: string;
  phone1Type?: string;
  phone2?: string;
  phone2Type?: string;
  email?: string;
  email2?: string;
  moreOnFile?: string;

  // Estate
  caseNumber?: string;
  caseFiledDate?: string;
  deceasedName?: string;
  monthsSinceDeath?: number | null;

  // Ranking as the source list scored it
  consensusRank?: number | null;
  consensusScore?: number | null;
  consensusTier?: string;
  agreement?: string;
  eslPriority?: number | null;
  eslTier?: string;
  motivationScore?: number | null;
  motivationTier?: string;
  whyThisLead?: string;
  estValue?: number | null;

  importBatch?: string;
}

export interface ProbateListFilters {
  organizationId?: string;
  search?: string;
  /** Comma-separated consensus tier numbers, e.g. "1,2". */
  tier?: string;
  county?: string;
  city?: string;
  /** Comma-separated ProbateWorkStatus values. */
  workStatus?: string;
  /** Months-since-death band: 'sweet' (3-9), 'fresh' (<3), 'stale' (>9). */
  deathWindow?: string;
  absentee?: string;
  valueMin?: number;
  hideDead?: boolean;
  hideDnc?: boolean;
  sort?: string;
  page?: number;
  pageSize?: number;
}

/** One property inside a contact group. */
export interface ProbatePropertyRow {
  leadId: string;
  address: string;
  city: string;
  zip: string;
  estValue: number | null;
  consensusRank: number | null;
  consensusScore: number | null;
  consensusTier: string | null;
  caseNumber: string | null;
  caseFiledDate: Date | null;
  deceasedName: string | null;
  whyThisLead: string | null;
  status: string;
  primaryContact: boolean;
}

/**
 * Every probate lead reachable on one phone, collapsed into a single row.
 * An heir who inherited nine houses is one conversation about nine
 * properties, so the list is grouped that way rather than showing nine
 * near-identical rows that all lead to the same call.
 */
export interface ProbateContactGroup {
  contactKey: string;
  /** Lead id of the one lead in this group a drip should enroll. */
  primaryLeadId: string;
  heirName: string;
  heirCity: string | null;
  phone: string;
  phoneType: string | null;
  email: string | null;
  absenteeHeir: boolean;
  deceasedNames: string[];
  caseNumbers: string[];
  monthsSinceDeath: number | null;
  earliestFiled: Date | null;
  propertyCount: number;
  totalValue: number;
  /** Best (lowest) consensus rank across the group, and its tier. */
  bestRank: number | null;
  bestTier: string | null;
  workStatus: string | null;
  doNotCall: boolean;
  enrolledCampaigns: string[];
  /** Outbound calls, texts and emails across every property this heir owns. */
  touches: number;
  lastTouchedAt: Date | null;
  properties: ProbatePropertyRow[];
}

export interface ProbateImportResult {
  created: number;
  /** Rows that matched a probate lead we already hold on the same dedupeUid. */
  duplicates: number;
  /** Rows outside the requested tier, counted so a tier filter is auditable. */
  filteredOut: number;
  errors: { row: number; reason: string }[];
  /**
   * Of the leads created, how many are the primary lead for their contact.
   * This, not `created`, is how many people a drip campaign should reach.
   */
  primaryContacts: number;
  /**
   * Created leads whose phone already belonged to a non-probate lead. Not an
   * error and not skipped: it means we hold two reasons to call one person,
   * which is worth knowing before both lists start messaging them.
   */
  phoneConflicts: { leadId: string; phone: string; otherSources: string[] }[];
}
