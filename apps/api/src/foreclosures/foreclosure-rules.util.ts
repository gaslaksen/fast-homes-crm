import { squash } from './foreclosure-document.util';

/**
 * Deterministic classification and derived math for a foreclosure filing.
 *
 * Everything here is a lookup or arithmetic - no model call. That is the point:
 * the reverse-mortgage catch is the highest-value inference in the whole
 * feature, and it has to be reliable and testable rather than something a model
 * happens to notice. Pure functions only, so the rules can be tested without a
 * database or an API key.
 */

/** What kind of debt is being foreclosed. Drives most downstream reasoning. */
export enum ForeclosureLoanType {
  REVERSE_HECM = 'REVERSE_HECM',
  CONVENTIONAL = 'CONVENTIONAL',
  FHA = 'FHA',
  VA = 'VA',
  HOA_ASSESSMENT = 'HOA_ASSESSMENT',
  TAX_LIEN = 'TAX_LIEN',
  PRIVATE_HARD_MONEY = 'PRIVATE_HARD_MONEY',
  UNKNOWN = 'UNKNOWN',
}

/** How urgent the next court date is. */
export enum ForeclosureUrgency {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

/** How a lender_profiles row matches text. */
export enum LenderMatchType {
  /**
   * Case-insensitive substring, compared with all whitespace and punctuation
   * removed from both sides. Required because pages 1-2 of an eCourts filing
   * come back with the spaces stripped ("FinanceofAmericaReverseLLC"), so a
   * plain substring match silently fails on exactly the documents that matter.
   */
  SUBSTRING = 'substring',
  /**
   * Case-insensitive regex against space-normalized text. Use when a pattern
   * needs word boundaries that squashing would destroy - a bare "AAG" as a
   * substring would match any name with those three letters in a row.
   */
  REGEX = 'regex',
}

/** A lender_profiles row, as the matcher needs it. */
export interface LenderProfile {
  matchPattern: string;
  matchType: string;
  lenderName: string;
  loanType: string;
  servicerType?: string | null;
  /** Higher wins when several patterns match. Ties break on longer pattern. */
  priority: number;
  active: boolean;
}

export interface LenderMatch {
  profile: LenderProfile;
  /** Which extracted field the pattern hit, for the signal's evidence list. */
  matchedField: 'holderName' | 'originalBeneficiary';
}

/** Lowercase and collapse runs of whitespace, keeping word boundaries intact. */
function spaceNormalized(text: string): string {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Whether one profile's pattern matches the given text. */
function patternMatches(profile: LenderProfile, text: string): boolean {
  if (!text) return false;
  if (profile.matchType === LenderMatchType.REGEX) {
    try {
      // User-editable, so a bad pattern must not take the pipeline down.
      return new RegExp(profile.matchPattern, 'i').test(spaceNormalized(text));
    } catch {
      return false;
    }
  }
  const pattern = squash(profile.matchPattern);
  return pattern.length > 0 && squash(text).includes(pattern);
}

/**
 * Find the lender profile that best describes this filing.
 *
 * Both the current holder and the original beneficiary are checked, because the
 * originator frequently appears only in the beneficiary line - a HECM sold on
 * to a servicer shows the servicer as holder and "MERS as nominee for American
 * Advisors Group" as beneficiary. Holder is tried first so a same-priority
 * match on the party actually foreclosing wins.
 */
export function matchLenderProfile(
  fields: { holderName?: string | null; originalBeneficiary?: string | null },
  profiles: LenderProfile[],
): LenderMatch | null {
  const candidates: LenderMatch[] = [];

  for (const profile of profiles) {
    if (!profile.active) continue;
    if (patternMatches(profile, fields.holderName || '')) {
      candidates.push({ profile, matchedField: 'holderName' });
    } else if (patternMatches(profile, fields.originalBeneficiary || '')) {
      candidates.push({ profile, matchedField: 'originalBeneficiary' });
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (b.profile.priority !== a.profile.priority) return b.profile.priority - a.profile.priority;
    if (b.profile.matchPattern.length !== a.profile.matchPattern.length) {
      return b.profile.matchPattern.length - a.profile.matchPattern.length;
    }
    // Holder beats beneficiary at equal specificity.
    return a.matchedField === 'holderName' ? -1 : 1;
  });

  return candidates[0];
}

/** Whole days from today to an instant, in whole calendar days (negative = past). */
export function daysToHearing(hearingAt?: Date | null, now: Date = new Date()): number | null {
  if (!(hearingAt instanceof Date) || Number.isNaN(hearingAt.getTime())) return null;
  const target = new Date(hearingAt);
  target.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/**
 * Urgency band for a countdown. A date already past is CRITICAL, not LOW: the
 * hearing happened and the case has moved on, which is the most time-sensitive
 * state to be in, not the least.
 */
export function urgencyBand(days: number | null): ForeclosureUrgency | null {
  if (days == null) return null;
  if (days < 14) return ForeclosureUrgency.CRITICAL;
  if (days <= 30) return ForeclosureUrgency.HIGH;
  if (days <= 60) return ForeclosureUrgency.MEDIUM;
  return ForeclosureUrgency.LOW;
}

/**
 * Last day an upset bid can be filed: NC allows ten days after the report of
 * sale. Returned as a date, not an instant - the deadline is end of that
 * business day, and the exact hour is a question for the clerk.
 */
export function upsetBidDeadline(saleAt?: Date | null): Date | null {
  if (!(saleAt instanceof Date) || Number.isNaN(saleAt.getTime())) return null;
  const deadline = new Date(saleAt);
  deadline.setDate(deadline.getDate() + 10);
  return deadline;
}

/** Whether the ten-day upset bid window is still open as of `now`. */
export function isUpsetBidOpen(saleAt?: Date | null, now: Date = new Date()): boolean {
  const deadline = upsetBidDeadline(saleAt);
  if (!deadline || !saleAt) return false;
  return now.getTime() >= saleAt.getTime() && now.getTime() <= deadline.getTime();
}

/**
 * Minimum age the borrower must have been when the loan was written.
 *
 * HECM is an FHA product restricted to borrowers 62 or older, so a reverse
 * mortgage originated in 2022 means someone born in 1960 or earlier. That is
 * what makes death or permanent move-out a likelier default cause than missed
 * payments, and why the person to contact may be an estate representative.
 * Returns null for every other loan type - no other product implies an age.
 */
export function borrowerAgeFloorAtOrigination(loanType: string, dotDate?: Date | null): number | null {
  if (loanType !== ForeclosureLoanType.REVERSE_HECM) return null;
  if (!(dotDate instanceof Date) || Number.isNaN(dotDate.getTime())) return null;
  return 62;
}

/** Approximate minimum age today, given the age floor at origination. */
export function borrowerAgeFloorToday(
  loanType: string,
  dotDate?: Date | null,
  now: Date = new Date(),
): number | null {
  const floor = borrowerAgeFloorAtOrigination(loanType, dotDate);
  if (floor == null || !dotDate) return null;
  const yearsSince = Math.floor((now.getTime() - dotDate.getTime()) / (365.2425 * 86400000));
  return yearsSince < 0 ? floor : floor + yearsSince;
}

/**
 * Whether the recorded principal can be trusted as the amount owed.
 *
 * False for HECM. A reverse-mortgage security instrument is customarily
 * recorded at a multiple of the maximum claim amount - often 150% - so the
 * recorded figure materially overstates the debt. Feeding it into equity math
 * produces a confidently wrong number on exactly the leads with the most
 * equity. The figure is still shown, with a warning; it must never reach a
 * computed equity field.
 */
export function principalFigureReliable(loanType: string): boolean {
  return loanType !== ForeclosureLoanType.REVERSE_HECM;
}

/**
 * Equity spread, suppressed when the debt figure cannot be trusted.
 *
 * Returns null rather than a wrong number: a blank the user can investigate is
 * better than a figure they would act on.
 */
export function equitySpreadWhenReliable(
  loanType: string,
  assessedValue: number | null,
  principal: number | null,
): number | null {
  if (!principalFigureReliable(loanType)) return null;
  if (assessedValue == null || principal == null) return null;
  return Math.round(assessedValue - principal);
}

/** Equity percentage, suppressed on the same rule as the spread. */
export function equityPctWhenReliable(
  loanType: string,
  assessedValue: number | null,
  principal: number | null,
): number | null {
  if (!principalFigureReliable(loanType)) return null;
  if (assessedValue == null || principal == null || assessedValue <= 0) return null;
  return Math.round(((assessedValue - principal) / assessedValue) * 100);
}

/**
 * Below this the extractor was unsure enough that a stale figure is the safer
 * thing to leave on screen. A confident principal is scored ~0.99.
 */
export const PRINCIPAL_ADOPT_CONFIDENCE = 0.5;

/**
 * Whether the filing's principal should replace the lead's stored loanAmount.
 *
 * ForeclosureDetail.loanAmount originally comes from the 13-field notice
 * extractor or the tracker-sheet import; the filing's originalPrincipal comes
 * from the 25-field pass, which is schema-constrained and confidence-scored. On
 * the same lead they can disagree, and the equity math already uses the filing
 * figure - so the card ends up showing a loan amount that does not reconcile
 * with its own equity spread.
 *
 * Adopting the filing figure fixes that, but only when the extractor was
 * actually confident. A shaky figure would replace one unreliable number with
 * another, so below the floor the stored value is left alone.
 */
export function shouldAdoptFilingPrincipal(
  principal: number | null | undefined,
  confidence: number | null | undefined,
): boolean {
  if (principal == null || !Number.isFinite(principal) || principal <= 0) return false;
  // No score recorded at all (an older extraction) is treated as adoptable:
  // the field set it came from is still the better one.
  if (confidence == null) return true;
  return confidence >= PRINCIPAL_ADOPT_CONFIDENCE;
}

/** The full deterministic read on one filing. Input to the Phase 4 signals pass. */
export interface RulesResult {
  loanType: ForeclosureLoanType;
  lenderName: string | null;
  servicerType: string | null;
  /** Which field the lender pattern hit, or null when nothing matched. */
  matchedField: 'holderName' | 'originalBeneficiary' | null;
  daysToHearing: number | null;
  urgency: ForeclosureUrgency | null;
  upsetBidDeadline: Date | null;
  upsetBidOpen: boolean;
  borrowerAgeFloorAtOrigination: number | null;
  borrowerAgeFloorToday: number | null;
  principalFigureReliable: boolean;
  equitySpread: number | null;
  equityPct: number | null;
}

/** Evaluate every rule against one filing. Deterministic for a fixed `now`. */
export function evaluateRules(
  filing: {
    holderName?: string | null;
    originalBeneficiary?: string | null;
    hearingAt?: Date | null;
    saleAt?: Date | null;
    dotDate?: Date | null;
    originalPrincipal?: number | null;
  },
  profiles: LenderProfile[],
  context: { assessedValue?: number | null; now?: Date } = {},
): RulesResult {
  const now = context.now || new Date();
  const match = matchLenderProfile(filing, profiles);
  const loanType = (match?.profile.loanType as ForeclosureLoanType) || ForeclosureLoanType.UNKNOWN;
  const days = daysToHearing(filing.hearingAt, now);
  const assessedValue = context.assessedValue ?? null;
  const principal = filing.originalPrincipal ?? null;

  return {
    loanType,
    lenderName: match?.profile.lenderName ?? null,
    servicerType: match?.profile.servicerType ?? null,
    matchedField: match?.matchedField ?? null,
    daysToHearing: days,
    urgency: urgencyBand(days),
    upsetBidDeadline: upsetBidDeadline(filing.saleAt),
    upsetBidOpen: isUpsetBidOpen(filing.saleAt, now),
    borrowerAgeFloorAtOrigination: borrowerAgeFloorAtOrigination(loanType, filing.dotDate),
    borrowerAgeFloorToday: borrowerAgeFloorToday(loanType, filing.dotDate, now),
    principalFigureReliable: principalFigureReliable(loanType),
    equitySpread: equitySpreadWhenReliable(loanType, assessedValue, principal),
    equityPct: equityPctWhenReliable(loanType, assessedValue, principal),
  };
}
