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
/**
 * What to DO with a surplus claimant next.
 *
 * This replaces the dollar-band tier as the board's primary label. Tier banded
 * the money, which is the one fact that never decides what happens next: a $40k
 * claim whose owner cannot be found is not workable today and a $12k one with a
 * live mobile is. In practice nobody used the A/B/C labels, because "Tier A"
 * held callable leads and dead ends side by side.
 *
 * Every claimant lands in exactly one of these, and each names a different
 * action by a different person. Money is still there, as a sort and a band
 * filter, which is what it is actually good for: ordering within a queue.
 */
export enum SurplusQueue {
  /** Reachable now: a callable number and a claim still open. */
  CALL = 'call',
  /** No consumer record exists. The registered agent on Sunbiz can sign. */
  ENTITY = 'entity',
  /**
   * The claimant is dead and nobody has found who inherited. Only a living
   * person with standing can file, so this is not a contact problem at all: no
   * amount of skip tracing a dead man produces somebody who can sign.
   */
  HEIRS = 'heirs',
  /** Never submitted, and the address still looks live. Spend a credit. */
  TRACE = 'trace',
  /** The address route is spent. Name search, obituary, official records. */
  NAME_SEARCH = 'name_search',
  /**
   * A letter went out to the address on file and nobody can be phoned. Parked
   * until they write or call back, so the address is not traced or searched
   * again while the letter is in the post.
   */
  MAILED = 'mailed',
  /** Denied, paid out, already assigned, or do-not-call. Nothing to do. */
  CLOSED = 'closed',
}

/**
 * How actionable each queue is, most first.
 *
 * A PROPERTY takes the best queue among its claimants, not the queue of its
 * highest-scoring one. Those are different orderings and the difference is
 * visible: 1624 W 35th St has a deceased claimant whose heirs are still unknown
 * and a second deceased claimant whose son has now been found and has four
 * numbers on file. Ranked by work score the first one leads and the card reads
 * "Find the heirs, nobody can sign yet", which is false about the house.
 *
 * Ordered by what the next action costs the person doing it: a phone call, then
 * a one-click submission, then finding a court filing, then open-ended research.
 */
export const SURPLUS_QUEUE_RANK: Record<SurplusQueue, number> = {
  [SurplusQueue.CALL]: 6,
  [SurplusQueue.TRACE]: 5,
  [SurplusQueue.HEIRS]: 4,
  [SurplusQueue.NAME_SEARCH]: 3,
  [SurplusQueue.ENTITY]: 2,
  // Below every working queue: a mailed co-owner is parked, so if the other
  // owner still needs a name search the property shows the search.
  [SurplusQueue.MAILED]: 1,
  [SurplusQueue.CLOSED]: 0,
};

export const SURPLUS_QUEUE_LABEL: Record<SurplusQueue, string> = {
  [SurplusQueue.CALL]: 'Call now',
  [SurplusQueue.ENTITY]: 'Entity, find the agent',
  [SurplusQueue.HEIRS]: 'Find the heirs',
  [SurplusQueue.TRACE]: 'Skip trace it',
  [SurplusQueue.NAME_SEARCH]: 'Name search',
  [SurplusQueue.MAILED]: 'Letter sent',
  [SurplusQueue.CLOSED]: 'Closed',
};

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
  /** Filed and acknowledged by the county, waiting on its processing. */
  AWAITING_DISBURSEMENT = 'Awaiting Disbursement',
  /** The county's check is in hand; the thirty-day clearing and the claimant's share follow. */
  CHECK_RECEIVED = 'Check Received',
  PAID = 'Paid',
  DEAD = 'Dead',
}

/**
 * The channels a person can be searched through, cheapest first. The tier
 * is the course's escalation rule: free routes before a paid database,
 * and a professional tracer only for the big claims once both have failed.
 */
export enum SurplusTraceChannel {
  FREE_SEARCH = 'free_search',
  SOCIAL = 'social',
  GOV_RECORDS = 'gov_records',
  PAID_DB = 'paid_db',
  PRO_TRACER = 'pro_tracer',
  MAIL = 'mail',
}

export const SURPLUS_TRACE_CHANNEL_LABEL: Record<SurplusTraceChannel, string> = {
  [SurplusTraceChannel.FREE_SEARCH]: 'Free search',
  [SurplusTraceChannel.SOCIAL]: 'Social',
  [SurplusTraceChannel.GOV_RECORDS]: 'Government records',
  [SurplusTraceChannel.PAID_DB]: 'Paid database',
  [SurplusTraceChannel.PRO_TRACER]: 'Professional tracer',
  [SurplusTraceChannel.MAIL]: 'Mail',
};

/** Tier 1 is free and always first. */
export const SURPLUS_TIER1_CHANNELS: SurplusTraceChannel[] = [
  SurplusTraceChannel.FREE_SEARCH,
  SurplusTraceChannel.SOCIAL,
  SurplusTraceChannel.GOV_RECORDS,
];

/** What money gets spent on a surplus claim, itemized on the disbursement report. */
export const SURPLUS_EXPENSE_KINDS: [string, string][] = [
  ['title_search', 'Title search'],
  ['notary', 'Mobile notary'],
  ['filing', 'Filing fee'],
  ['postage', 'Postage and courier'],
  ['skip_trace', 'Skip trace'],
  ['attorney', 'Attorney'],
  ['other', 'Other'],
];

/**
 * The disbursement arithmetic, in one place so the report, the row and the
 * stats agree. Expenses come out of the company's share unless the
 * agreement passes them to the claimant, in which case they count toward
 * the Florida cap on total consideration alongside the fee.
 */
export function surplusDisbursement(input: {
  checkAmount: number | null | undefined;
  feePercent: number | null | undefined;
  expensesTotal: number;
  expensesFromClaimantShare: boolean;
  capPct: number | null | undefined;
}): {
  gross: number;
  fee: number;
  expensesTotal: number;
  claimantShare: number;
  companyShare: number;
  companyNet: number;
  /** Fee plus any expenses passed to the claimant, as a percent of the check. */
  considerationPct: number;
  overCap: boolean;
} {
  const gross = Math.max(0, Number(input.checkAmount || 0));
  const pct = Math.max(0, Number(input.feePercent || 0));
  const fee = Math.round(gross * pct) / 100;
  const expensesTotal = Math.max(0, Number(input.expensesTotal || 0));
  const passed = input.expensesFromClaimantShare ? expensesTotal : 0;
  const claimantShare = Math.max(0, Math.round((gross - fee - passed) * 100) / 100);
  const companyShare = Math.round((fee + passed) * 100) / 100;
  const companyNet = Math.round((companyShare - expensesTotal) * 100) / 100;
  const considerationPct = gross > 0 ? Math.round(((fee + passed) / gross) * 10000) / 100 : 0;
  const overCap = input.capPct != null && considerationPct > input.capPct + 1e-9;
  return { gross, fee, expensesTotal, claimantShare, companyShare, companyNet, considerationPct, overCap };
}

/**
 * Why a claim was retired. Recorded, never deleted, so a county pull that
 * lists the case again is matched against a reason rather than a blank,
 * and the team can see what kills claims in a county.
 */
export enum SurplusDeadReason {
  BELOW_FLOOR = 'below_floor',
  DECEASED_NO_HEIRS = 'deceased_no_heirs',
  COMPETING_CLAIM = 'competing_claim',
  UNRESPONSIVE = 'unresponsive',
  ALREADY_ASSIGNED = 'already_assigned',
  OTHER = 'other',
}

export const SURPLUS_DEAD_REASON_LABEL: Record<SurplusDeadReason, string> = {
  [SurplusDeadReason.BELOW_FLOOR]: 'Surplus below the floor',
  [SurplusDeadReason.DECEASED_NO_HEIRS]: 'Deceased, no heirs located',
  [SurplusDeadReason.COMPETING_CLAIM]: 'Competing claim already filed',
  [SurplusDeadReason.UNRESPONSIVE]: 'Unresponsive after the set attempts',
  [SurplusDeadReason.ALREADY_ASSIGNED]: 'Already signed with somebody else',
  [SurplusDeadReason.OTHER]: 'Other',
};

/**
 * Who a person on a claim is to the claimant. Only a heir can file, so the
 * signer counts read this. Everybody else is a route to the person: the
 * course's relative and neighbor outreach, logged as its own contact.
 */
export enum SurplusPersonRole {
  HEIR = 'heir',
  RELATIVE = 'relative',
  NEIGHBOR = 'neighbor',
  FRIEND = 'friend',
  ASSOCIATE = 'associate',
}

export const SURPLUS_PERSON_ROLE_LABEL: Record<SurplusPersonRole, string> = {
  [SurplusPersonRole.HEIR]: 'Heir',
  [SurplusPersonRole.RELATIVE]: 'Relative',
  [SurplusPersonRole.NEIGHBOR]: 'Neighbor',
  [SurplusPersonRole.FRIEND]: 'Friend',
  [SurplusPersonRole.ASSOCIATE]: 'Associate',
};

/** Where the outreach to one person stands. */
export enum SurplusContactStatus {
  NOT_CONTACTED = 'not_contacted',
  CONTACTED = 'contacted',
  MESSAGE_PASSED = 'message_passed',
  DEAD_END = 'dead_end',
}

export const SURPLUS_CONTACT_STATUS_LABEL: Record<SurplusContactStatus, string> = {
  [SurplusContactStatus.NOT_CONTACTED]: 'Not contacted',
  [SurplusContactStatus.CONTACTED]: 'Contacted',
  [SurplusContactStatus.MESSAGE_PASSED]: 'Passed a message on',
  [SurplusContactStatus.DEAD_END]: 'Dead end',
};

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

/**
 * What happened on a surplus call, in the vocabulary the recovery process
 * uses. The wholesaling dialer dispositions (Requested Appointment, Incorrect
 * Number) describe a seller conversation; none of them says whether the
 * claimant was reached, whether a message was left with a relative, or
 * whether the person has already signed with somebody else, and those are the
 * three facts that decide what happens to the file next.
 */
export enum SurplusCallOutcome {
  /** Rang out and the curiosity voicemail was left. */
  NO_ANSWER_VOICEMAIL = 'no_answer_voicemail',
  /** Rang out, no voicemail box or none left. */
  NO_ANSWER = 'no_answer',
  SPOKE_CLAIMANT = 'spoke_claimant',
  /** A relative, neighbour or friend answered and agreed to pass a message. */
  SPOKE_RELATIVE = 'spoke_relative',
  WRONG_NUMBER = 'wrong_number',
  DISCONNECTED = 'disconnected',
  NOT_INTERESTED = 'not_interested',
  /** Asked for the credibility packet before deciding. */
  WANTS_PACKET = 'wants_packet',
  CALLBACK_SCHEDULED = 'callback_scheduled',
  /** Already retained somebody else. The money is not ours to chase. */
  ALREADY_SIGNED = 'already_signed',
  DO_NOT_CALL = 'do_not_call',
}

export const SURPLUS_CALL_OUTCOME_LABEL: Record<SurplusCallOutcome, string> = {
  [SurplusCallOutcome.NO_ANSWER_VOICEMAIL]: 'No answer, voicemail left',
  [SurplusCallOutcome.NO_ANSWER]: 'No answer',
  [SurplusCallOutcome.SPOKE_CLAIMANT]: 'Spoke to claimant',
  [SurplusCallOutcome.SPOKE_RELATIVE]: 'Spoke to relative, message passed',
  [SurplusCallOutcome.WRONG_NUMBER]: 'Wrong number',
  [SurplusCallOutcome.DISCONNECTED]: 'Disconnected',
  [SurplusCallOutcome.NOT_INTERESTED]: 'Not interested',
  [SurplusCallOutcome.WANTS_PACKET]: 'Wants the credibility packet',
  [SurplusCallOutcome.CALLBACK_SCHEDULED]: 'Callback scheduled',
  [SurplusCallOutcome.ALREADY_SIGNED]: 'Already signed elsewhere',
  [SurplusCallOutcome.DO_NOT_CALL]: 'Asked not to be called',
};

/**
 * The pieces of surplus outreach wording that are kept as versioned
 * templates. One kind, one active version at a time.
 */
export enum SurplusTemplateKind {
  PHONE_SCRIPT = 'phone_script',
  VOICEMAIL = 'voicemail',
  /** What to say when a relative or neighbour answers instead. */
  RELATIVE_SCRIPT = 'relative_script',
  LETTER_CLAIMANT = 'letter_claimant',
  LETTER_FAMILY = 'letter_family',
  LETTER_ASSOCIATE = 'letter_associate',
  CREDIBILITY_SMS = 'credibility_sms',
  CREDIBILITY_EMAIL = 'credibility_email',
  NOTARY_INSTRUCTIONS = 'notary_instructions',
  /**
   * Our standard documents. Versioned like the scripts so a case's fee
   * agreement records the wording it was built from and shows stale once
   * the template is revised. The legal ones ship empty: the text comes
   * from counsel and is pasted in, never drafted here.
   */
  DOC_FEE_AGREEMENT = 'doc_fee_agreement',
  DOC_LIMITED_POA = 'doc_limited_poa',
  DOC_ASSIGNMENT_OF_RIGHTS = 'doc_assignment_of_rights',
  DOC_LETTER_OF_DIRECTION = 'doc_letter_of_direction',
  DOC_CLAIMS_CHECKLIST = 'doc_claims_checklist',
}

export const SURPLUS_TEMPLATE_KIND_LABEL: Record<SurplusTemplateKind, string> = {
  [SurplusTemplateKind.PHONE_SCRIPT]: 'Phone script',
  [SurplusTemplateKind.VOICEMAIL]: 'Voicemail',
  [SurplusTemplateKind.RELATIVE_SCRIPT]: 'Relative or neighbour answered',
  [SurplusTemplateKind.LETTER_CLAIMANT]: 'Letter to the claimant',
  [SurplusTemplateKind.LETTER_FAMILY]: 'Letter to a family member',
  [SurplusTemplateKind.LETTER_ASSOCIATE]: 'Letter to a neighbour or associate',
  [SurplusTemplateKind.CREDIBILITY_SMS]: 'Credibility packet text',
  [SurplusTemplateKind.CREDIBILITY_EMAIL]: 'Credibility packet email',
  [SurplusTemplateKind.NOTARY_INSTRUCTIONS]: 'Notary package cover and instructions',
  [SurplusTemplateKind.DOC_FEE_AGREEMENT]: 'Contingency fee agreement',
  [SurplusTemplateKind.DOC_LIMITED_POA]: 'Limited power of attorney',
  [SurplusTemplateKind.DOC_ASSIGNMENT_OF_RIGHTS]: 'Assignment of rights',
  [SurplusTemplateKind.DOC_LETTER_OF_DIRECTION]: 'Direction to pay surplus funds',
  [SurplusTemplateKind.DOC_CLAIMS_CHECKLIST]: 'Claims checklist',
};

/** Template kinds whose text is a legal instrument: counsel writes it, the app only fills names in. */
export const SURPLUS_LEGAL_TEMPLATE_KINDS: SurplusTemplateKind[] = [
  SurplusTemplateKind.DOC_FEE_AGREEMENT,
  SurplusTemplateKind.DOC_LIMITED_POA,
  SurplusTemplateKind.DOC_ASSIGNMENT_OF_RIGHTS,
  SurplusTemplateKind.DOC_LETTER_OF_DIRECTION,
];

/**
 * Every document a surplus claim can carry, in three sets: ours (the
 * templates we sign the claimant on), the county's (its own claim form), and
 * the claimant's (what they hand us). The set decides who produces it; the
 * kind decides where it sits in the signing order.
 */
export enum SurplusDocumentKind {
  FEE_AGREEMENT = 'fee_agreement',
  LIMITED_POA = 'limited_poa',
  ASSIGNMENT_OF_RIGHTS = 'assignment_of_rights',
  LETTER_OF_DIRECTION = 'letter_of_direction',
  NOTARY_AGREEMENT = 'notary_agreement',
  CLAIMS_CHECKLIST = 'claims_checklist',
  COUNTY_CLAIM_FORM = 'county_claim_form',
  PHOTO_ID = 'photo_id',
  W9 = 'w9',
  PROOF_OF_OWNERSHIP = 'proof_of_ownership',
  DEATH_CERTIFICATE = 'death_certificate',
  LETTERS_OF_ADMINISTRATION = 'letters_of_administration',
  ENTITY_DOCUMENTS = 'entity_documents',
  TITLE_SEARCH = 'title_search',
}

export type SurplusDocumentSet = 'ours' | 'county' | 'claimant';

export const SURPLUS_DOCUMENT_SET: Record<SurplusDocumentKind, SurplusDocumentSet> = {
  [SurplusDocumentKind.FEE_AGREEMENT]: 'ours',
  [SurplusDocumentKind.LIMITED_POA]: 'ours',
  [SurplusDocumentKind.ASSIGNMENT_OF_RIGHTS]: 'ours',
  [SurplusDocumentKind.LETTER_OF_DIRECTION]: 'ours',
  [SurplusDocumentKind.NOTARY_AGREEMENT]: 'ours',
  [SurplusDocumentKind.CLAIMS_CHECKLIST]: 'ours',
  [SurplusDocumentKind.COUNTY_CLAIM_FORM]: 'county',
  [SurplusDocumentKind.PHOTO_ID]: 'claimant',
  [SurplusDocumentKind.W9]: 'claimant',
  [SurplusDocumentKind.PROOF_OF_OWNERSHIP]: 'claimant',
  [SurplusDocumentKind.DEATH_CERTIFICATE]: 'claimant',
  [SurplusDocumentKind.LETTERS_OF_ADMINISTRATION]: 'claimant',
  [SurplusDocumentKind.ENTITY_DOCUMENTS]: 'claimant',
  [SurplusDocumentKind.TITLE_SEARCH]: 'ours',
};

export const SURPLUS_DOCUMENT_LABEL: Record<SurplusDocumentKind, string> = {
  [SurplusDocumentKind.FEE_AGREEMENT]: 'Contingency fee agreement',
  [SurplusDocumentKind.LIMITED_POA]: 'Limited power of attorney',
  [SurplusDocumentKind.ASSIGNMENT_OF_RIGHTS]: 'Assignment of rights',
  [SurplusDocumentKind.LETTER_OF_DIRECTION]: 'Letter of direction',
  [SurplusDocumentKind.NOTARY_AGREEMENT]: 'Mobile notary agreement',
  [SurplusDocumentKind.CLAIMS_CHECKLIST]: 'Claims checklist',
  [SurplusDocumentKind.COUNTY_CLAIM_FORM]: 'County claim form',
  [SurplusDocumentKind.PHOTO_ID]: 'Photo ID',
  [SurplusDocumentKind.W9]: 'W-9',
  [SurplusDocumentKind.PROOF_OF_OWNERSHIP]: 'Deed or proof of ownership',
  [SurplusDocumentKind.DEATH_CERTIFICATE]: 'Death certificate',
  [SurplusDocumentKind.LETTERS_OF_ADMINISTRATION]: 'Letters of administration',
  [SurplusDocumentKind.ENTITY_DOCUMENTS]: 'Entity documents',
  [SurplusDocumentKind.TITLE_SEARCH]: 'Title search',
};

/**
 * Where a document stands. Ordered: a later status implies the earlier
 * ones, so "signed" counts as collected for the checklist.
 */
export enum SurplusDocumentStatus {
  OUTSTANDING = 'outstanding',
  /** Prepared by us, not yet in front of anyone. */
  DRAFTED = 'drafted',
  SENT = 'sent',
  /** Handed to us by the claimant or the county. Collected, nothing to sign. */
  RECEIVED = 'received',
  SIGNED = 'signed',
  NOTARIZED = 'notarized',
  FILED = 'filed',
}

export const SURPLUS_DOCUMENT_STATUS_LABEL: Record<SurplusDocumentStatus, string> = {
  [SurplusDocumentStatus.OUTSTANDING]: 'Outstanding',
  [SurplusDocumentStatus.DRAFTED]: 'Drafted',
  [SurplusDocumentStatus.SENT]: 'Sent',
  [SurplusDocumentStatus.RECEIVED]: 'Received',
  [SurplusDocumentStatus.SIGNED]: 'Signed',
  [SurplusDocumentStatus.NOTARIZED]: 'Notarized',
  [SurplusDocumentStatus.FILED]: 'Filed',
};

/** Which template, if any, a document kind is generated from. */
export const SURPLUS_DOCUMENT_TEMPLATE: Partial<Record<SurplusDocumentKind, SurplusTemplateKind>> = {
  [SurplusDocumentKind.FEE_AGREEMENT]: SurplusTemplateKind.DOC_FEE_AGREEMENT,
  [SurplusDocumentKind.LIMITED_POA]: SurplusTemplateKind.DOC_LIMITED_POA,
  [SurplusDocumentKind.ASSIGNMENT_OF_RIGHTS]: SurplusTemplateKind.DOC_ASSIGNMENT_OF_RIGHTS,
  [SurplusDocumentKind.LETTER_OF_DIRECTION]: SurplusTemplateKind.DOC_LETTER_OF_DIRECTION,
  [SurplusDocumentKind.NOTARY_AGREEMENT]: SurplusTemplateKind.NOTARY_INSTRUCTIONS,
  [SurplusDocumentKind.CLAIMS_CHECKLIST]: SurplusTemplateKind.DOC_CLAIMS_CHECKLIST,
};

/** The status order, so "at least signed" is one comparison. */
export const SURPLUS_DOCUMENT_STATUS_RANK: Record<SurplusDocumentStatus, number> = {
  [SurplusDocumentStatus.OUTSTANDING]: 0,
  [SurplusDocumentStatus.DRAFTED]: 1,
  [SurplusDocumentStatus.SENT]: 2,
  [SurplusDocumentStatus.RECEIVED]: 3,
  [SurplusDocumentStatus.SIGNED]: 4,
  [SurplusDocumentStatus.NOTARIZED]: 5,
  [SurplusDocumentStatus.FILED]: 6,
};

export function surplusDocumentAtLeast(
  status: string | null | undefined,
  min: SurplusDocumentStatus,
): boolean {
  const have = SURPLUS_DOCUMENT_STATUS_RANK[(status || '') as SurplusDocumentStatus];
  return have !== undefined && have >= SURPLUS_DOCUMENT_STATUS_RANK[min];
}

/** Statuses that mean the document is in hand, for the completeness line. */
export function surplusDocumentCollected(status: string | null | undefined): boolean {
  return (
    status === SurplusDocumentStatus.RECEIVED ||
    status === SurplusDocumentStatus.SIGNED ||
    status === SurplusDocumentStatus.NOTARIZED ||
    status === SurplusDocumentStatus.FILED
  );
}

/**
 * Which documents a given claim needs before it can be filed, per the
 * course's standard set. Estate and entity documents only when the claim is
 * one; the notary agreement and checklist are ours to keep, not to file.
 */
export function surplusDocumentsRequired(facts: { deceased: boolean; isEntity: boolean }): SurplusDocumentKind[] {
  const required = [
    SurplusDocumentKind.FEE_AGREEMENT,
    SurplusDocumentKind.LIMITED_POA,
    SurplusDocumentKind.ASSIGNMENT_OF_RIGHTS,
    SurplusDocumentKind.LETTER_OF_DIRECTION,
    SurplusDocumentKind.COUNTY_CLAIM_FORM,
    SurplusDocumentKind.PHOTO_ID,
  ];
  if (facts.deceased) {
    required.push(SurplusDocumentKind.DEATH_CERTIFICATE, SurplusDocumentKind.LETTERS_OF_ADMINISTRATION);
  }
  if (facts.isEntity) required.push(SurplusDocumentKind.ENTITY_DOCUMENTS);
  return required;
}

/** The Big Four from the course, plus the deferral and a catch-all. */
export enum SurplusObjection {
  WHO_ARE_YOU = 'who_are_you',
  ARE_YOU_REAL = 'are_you_real',
  COST = 'cost',
  TRUST = 'trust',
  TELL_ME_MORE = 'tell_me_more',
  OTHER = 'other',
}

export const SURPLUS_OBJECTION_LABEL: Record<SurplusObjection, string> = {
  [SurplusObjection.WHO_ARE_YOU]: 'Who are you?',
  [SurplusObjection.ARE_YOU_REAL]: 'Are you for real?',
  [SurplusObjection.COST]: 'What does it cost?',
  [SurplusObjection.TRUST]: 'Can I trust you?',
  [SurplusObjection.TELL_ME_MORE]: 'Tell me more first',
  [SurplusObjection.OTHER]: 'Something else',
};

/**
 * Whether an outcome needs a dated follow-up before the call can be closed.
 *
 * 'required' is the course's rule made mechanical: a call that ends with an
 * intention to follow up gets a date, never a "circle back later". 'optional'
 * covers an unanswered call, where the next attempt is usually the weekly
 * cadence rather than a specific promise. 'none' is a file that is finished
 * on this number.
 */
export function surplusFollowUpRule(
  outcome: SurplusCallOutcome | string | null | undefined,
): 'required' | 'optional' | 'none' {
  switch (outcome) {
    case SurplusCallOutcome.CALLBACK_SCHEDULED:
    case SurplusCallOutcome.WANTS_PACKET:
    case SurplusCallOutcome.SPOKE_RELATIVE:
      return 'required';
    case SurplusCallOutcome.NO_ANSWER_VOICEMAIL:
    case SurplusCallOutcome.NO_ANSWER:
    case SurplusCallOutcome.SPOKE_CLAIMANT:
      return 'optional';
    default:
      return 'none';
  }
}

/** A person picked up. What the connect-rate report counts as a connection. */
export function surplusCallConnected(outcome: SurplusCallOutcome | string | null | undefined): boolean {
  switch (outcome) {
    case SurplusCallOutcome.SPOKE_CLAIMANT:
    case SurplusCallOutcome.SPOKE_RELATIVE:
    case SurplusCallOutcome.NOT_INTERESTED:
    case SurplusCallOutcome.WANTS_PACKET:
    case SurplusCallOutcome.CALLBACK_SCHEDULED:
    case SurplusCallOutcome.ALREADY_SIGNED:
    case SurplusCallOutcome.DO_NOT_CALL:
      return true;
    default:
      return false;
  }
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
