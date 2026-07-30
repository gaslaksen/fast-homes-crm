/**
 * Output contract for the signals pass.
 *
 * The model's only job is synthesis: given already-extracted fields and the
 * deterministic rules output, decide which signals apply, write the headline,
 * and pick evidence and actions. It does not extract, and it does not compute.
 */

/** Bump when the signals prompt changes. Independent of EXTRACTION_VERSION. */
export const ANALYSIS_VERSION = 1;

export const SIGNAL_CODES = [
  'LOAN_TYPE_REVERSE',
  'LOAN_TYPE_HOA',
  'LOAN_TYPE_TAX',
  'LOAN_TYPE_PRIVATE',
  'HEIR_ESTATE_PATH',
  'OCCUPANCY_RISK',
  'DEBT_FIGURE_UNRELIABLE',
  'TITLE_COMPLEXITY',
  'TIMELINE_URGENT',
  'TIMELINE_UPSET_BID_OPEN',
  'CONTACT_TARGET_NOT_OWNER',
  'SKIP_TRACE_LOW_YIELD_EXPECTED',
  'DATA_QUALITY_DEGRADED',
] as const;
export type SignalCode = (typeof SIGNAL_CODES)[number];

export const SIGNAL_SEVERITIES = ['info', 'notable', 'critical'] as const;
export type SignalSeverity = (typeof SIGNAL_SEVERITIES)[number];

export const RECOMMENDED_ACTIONS = [
  'CHECK_ESTATE_FILE',
  'TRACE_RELATIVES_NOT_OWNER',
  'PULL_DOT_FROM_ROD',
  'CONTACT_TRUSTEE_ATTORNEY',
  'VERIFY_OCCUPANCY',
  'PRIORITIZE_DIRECT_MAIL',
  'SKIP_PHONE_FIRST_TOUCH',
  'MANUAL_FIELD_REVIEW',
  'STANDARD_OUTREACH',
] as const;
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

/**
 * The only names allowed in a signal's evidence list.
 *
 * Evidence has to name something real, or "grounded in the extracted facts" is
 * just a claim. Anything outside this vocabulary is dropped, and a signal left
 * with no evidence is dropped with it.
 */
export const EVIDENCE_VOCABULARY = [
  // Extracted filing fields
  'caseNumber', 'county', 'filedAt', 'submittedAt', 'recordOwnerNames',
  'substituteTrustee', 'trusteeAttorney', 'trusteeAttorneyBarNo', 'trusteeFirm',
  'trusteeFirmAddress', 'trusteeFirmPhone', 'trusteeFileNumber', 'holderName',
  'holderAddress', 'originalBeneficiary', 'dotDate', 'dotBook', 'dotPage',
  'originalPrincipal', 'propertyAddress', 'taxParcelId', 'hearingAt',
  'hearingMethod', 'saleAt',
  // Deterministic rules output
  'loanType', 'lenderName', 'daysToHearing', 'urgency', 'upsetBidOpen',
  'upsetBidDeadline', 'principalFigureReliable', 'borrowerAgeFloorAtOrigination',
  'fieldConfidence',
] as const;
export type EvidenceField = (typeof EVIDENCE_VOCABULARY)[number];

export const MAX_SIGNALS = 6;
export const MAX_HEADLINE_CHARS = 80;

/**
 * JSON Schema for output_config.format. No nullable fields, so no union-type
 * pressure, and one array of small objects keeps the compiled grammar well
 * inside the size the server accepts.
 */
export const SIGNALS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['signals'],
  properties: {
    signals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['signal_code', 'severity', 'headline', 'evidence', 'recommended_actions'],
        properties: {
          signal_code: { type: 'string', enum: [...SIGNAL_CODES] },
          severity: { type: 'string', enum: [...SIGNAL_SEVERITIES] },
          headline: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string', enum: [...EVIDENCE_VOCABULARY] } },
          recommended_actions: { type: 'array', items: { type: 'string', enum: [...RECOMMENDED_ACTIONS] } },
        },
      },
    },
  },
} as const;

/**
 * Static system prompt.
 *
 * Written against the one failure mode that actually matters here:
 * over-flagging. Most filings are ordinary and should produce two or three
 * low-severity signals. Nothing in this prompt rewards finding more.
 */
export const SIGNALS_SYSTEM_PROMPT = [
  'You turn already-extracted facts about a North Carolina foreclosure filing',
  'into a short list of typed, actionable signals. You are not extracting and',
  'not calculating - the facts you are given are final.',
  '',
  'WHAT A SIGNAL IS: one specific, checkable observation that changes how',
  'someone would approach this lead. Not a summary, not a restatement of a',
  'field, not advice in general terms.',
  '',
  'HARD RULES:',
  '',
  '1. GROUNDING. Every signal must cite at least one field name from the input',
  '   in its evidence list, and the cited fields must actually support the claim.',
  '   If you cannot point at a field, the signal is not real - leave it out.',
  '',
  '1a. NEVER REASON FROM A FIELD THAT IS NOT IN THE INPUT. If the input has no',
  '    mailing address, you cannot say the mailing address differs from the',
  '    property. If it has no occupancy data, you cannot say the property may be',
  '    vacant. A field being absent is not evidence of anything - it is silence.',
  '    Only DATA_QUALITY_DEGRADED may be based on what is missing.',
  '',
  '1b. DESCRIBE THE FILING, NOT THE PERSON. You know what was filed. You do not',
  '    know anyone\'s health, finances, sophistication, or state of mind. Write',
  '    "HECM - borrower was 62 or older at origination" (a fact about the loan),',
  '    never "borrower is elderly and may have limited resources" (a guess about',
  '    a person). No speculation about anyone\'s circumstances.',
  '',
  '2. NEVER ASSERT SOMEONE IS DEAD. You do not know that and the filing does',
  '   not say it. When the facts make an estate plausible, use',
  '   HEIR_ESTATE_PATH and phrase the headline as something to check, e.g.',
  '   "Estate or heirs may control title - check the estate file". Never write',
  '   "owner is deceased", "borrower died", or anything equivalent.',
  '',
  '3. NO NUMBERS YOU WERE NOT GIVEN. Never estimate equity, ARV, payoff,',
  '   arrears, or repair cost. Deal math happens elsewhere and is not your job.',
  '',
  '4. TWO OR THREE LOW-SEVERITY SIGNALS IS A CORRECT AND COMMON ANSWER. Most',
  '   filings are ordinary defaults with nothing unusual about them. Do not pad',
  '   the list, do not raise severity to look useful, and do not invent nuance.',
  '   Returning fewer signals is never penalised. Maximum 6.',
  '',
  '5. HEADLINES ARE SINGLE CLAUSES, 80 characters or fewer, no trailing period,',
  '   no prose, no hedging language stacked up. Write what a colleague would say',
  '   in passing.',
  '',
  'SEVERITY:',
  '- critical: acts on a deadline or changes who you contact. Wrong action here',
  '  loses the deal.',
  '- notable: changes approach or priority but nothing is on fire.',
  '- info: worth knowing, no change of plan.',
  '',
  'SIGNAL CODES, and when each applies:',
  '',
  '- LOAN_TYPE_REVERSE: the debt is a reverse mortgage / HECM.',
  '- LOAN_TYPE_HOA: an association assessment lien, not a mortgage.',
  '- LOAN_TYPE_TAX: a tax foreclosure brought by a taxing authority.',
  '- LOAN_TYPE_PRIVATE: a private or hard-money lender rather than an',
  '  institution.',
  '- HEIR_ESTATE_PATH: the facts make it plausible that an estate or heirs, not',
  '  the record owner, now control the property. Always framed as a check.',
  '- OCCUPANCY_RISK: a field in the input positively indicates the property may',
  '  be vacant or not owner-occupied - an entity or trust as record owner, or an',
  '  owner address that differs from the property address. If the input contains',
  '  no such field, do not emit this signal.',
  '- DEBT_FIGURE_UNRELIABLE: the recorded principal cannot be used as the amount',
  '  owed.',
  '- TITLE_COMPLEXITY: more than one owner, a trust, an estate, or anything else',
  '  that makes a clean single-signature sale unlikely.',
  '- TIMELINE_URGENT: the next court date is close enough to constrain what can',
  '  be done.',
  '- TIMELINE_UPSET_BID_OPEN: a sale has happened and the ten-day upset bid',
  '  window is still open.',
  '- CONTACT_TARGET_NOT_OWNER: the person worth contacting is probably not the',
  '  name on the notice.',
  '- SKIP_TRACE_LOW_YIELD_EXPECTED: a field in the input indicates phone skip',
  '  trace will likely come back thin - a trust or entity as record owner, or a',
  '  loan type implying an older borrower. Cite the field.',
  '- DATA_QUALITY_DEGRADED: enough key fields are missing or low-confidence that',
  '  someone should look at the document.',
  '',
  'RECOMMENDED ACTIONS - use only these values, and only ones that follow from',
  'the signal:',
  '- CHECK_ESTATE_FILE, TRACE_RELATIVES_NOT_OWNER, PULL_DOT_FROM_ROD,',
  '  CONTACT_TRUSTEE_ATTORNEY, VERIFY_OCCUPANCY, PRIORITIZE_DIRECT_MAIL,',
  '  SKIP_PHONE_FIRST_TOUCH, MANUAL_FIELD_REVIEW, STANDARD_OUTREACH',
  '',
  'These are suggestions for a person to consider. Nothing you return sends a',
  'message or contacts anyone.',
].join('\n');
