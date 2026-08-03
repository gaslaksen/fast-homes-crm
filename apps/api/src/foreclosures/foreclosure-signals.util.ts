import {
  SIGNAL_CODES, SIGNAL_SEVERITIES, RECOMMENDED_ACTIONS, EVIDENCE_VOCABULARY,
  MAX_SIGNALS, MAX_HEADLINE_CHARS, SignalCode, SignalSeverity, RecommendedAction,
} from './foreclosure-signals.schema';
import { ForeclosureLoanType, ForeclosureUrgency, RulesResult } from './foreclosure-rules.util';

/**
 * Validating and completing the model's signal list.
 *
 * Two jobs, both about not trusting the model with things that are already
 * known. Signals that restate a deterministic fact are REQUIRED - added with a
 * fallback headline if the model omits them. Signals that contradict a
 * deterministic fact are FORBIDDEN - dropped even if the model is confident.
 * What is left in the middle is genuine synthesis, and there the model decides.
 *
 * Pure and Prisma-free.
 */

export interface Signal {
  signalCode: SignalCode;
  severity: SignalSeverity;
  headline: string;
  evidence: string[];
  recommendedActions: RecommendedAction[];
}

const CODES = new Set<string>(SIGNAL_CODES);
const SEVERITIES = new Set<string>(SIGNAL_SEVERITIES);
const ACTIONS = new Set<string>(RECOMMENDED_ACTIONS);
const EVIDENCE = new Set<string>(EVIDENCE_VOCABULARY);
const SEVERITY_RANK: Record<SignalSeverity, number> = { critical: 3, notable: 2, info: 1 };

/** A signal the facts require, or forbid, regardless of what the model says. */
export interface SignalPrecondition {
  required: boolean;
  forbidden: boolean;
  /** Used when the model omitted a required signal. */
  fallback?: Omit<Signal, 'signalCode'>;
  /** Floor applied when the model under-rates a required signal. */
  minSeverity?: SignalSeverity;
}

/** Core fields whose absence or low confidence means someone should look. */
const CORE_FIELDS = ['recordOwnerNames', 'propertyAddress', 'holderName', 'hearingAt', 'caseNumber'];
const LOW_CONFIDENCE = 0.5;

/**
 * How many core fields are missing or scored below the confidence floor. Drives
 * DATA_QUALITY_DEGRADED, so a thin extraction is flagged rather than presented
 * as if it were complete.
 */
export function countWeakCoreFields(
  filing: Record<string, any>,
  confidence: Record<string, number> | null | undefined,
): number {
  return CORE_FIELDS.filter((field) => {
    const value = filing[field];
    const empty = value === null || value === undefined ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'string' && value.trim() === '');
    if (empty) return true;
    const score = confidence?.[field];
    return typeof score === 'number' && score < LOW_CONFIDENCE;
  }).length;
}

/**
 * Which signals the deterministic facts settle, in either direction.
 *
 * The loan-type codes are mutually exclusive and each is pinned to the rules
 * engine's classification, so the model cannot label a conventional default a
 * reverse mortgage or vice versa.
 */
export function signalPreconditions(
  rules: RulesResult,
  filing: Record<string, any>,
  confidence?: Record<string, number> | null,
): Partial<Record<SignalCode, SignalPrecondition>> {
  const out: Partial<Record<SignalCode, SignalPrecondition>> = {};

  const loanTypeSignal: Partial<Record<string, SignalCode>> = {
    [ForeclosureLoanType.REVERSE_HECM]: 'LOAN_TYPE_REVERSE',
    [ForeclosureLoanType.HOA_ASSESSMENT]: 'LOAN_TYPE_HOA',
    [ForeclosureLoanType.TAX_LIEN]: 'LOAN_TYPE_TAX',
    [ForeclosureLoanType.PRIVATE_HARD_MONEY]: 'LOAN_TYPE_PRIVATE',
  };
  const expected = loanTypeSignal[rules.loanType];
  // Whether the rules reached a verdict at all. Not the same as `expected`
  // being set: CONVENTIONAL, FHA and VA are real classifications that simply
  // have no signal code of their own, and on those the model must still be
  // barred from claiming a reverse mortgage.
  const classified = rules.loanType !== ForeclosureLoanType.UNKNOWN;
  // A text-derived classification rests on the document's own caption, not on
  // a party name, so it cannot cite holderName as its evidence.
  const evidenceForLoanType =
    rules.loanTypeSource === 'filingText'
      ? ['loanType']
      : ['loanType', rules.matchedField === 'originalBeneficiary' ? 'originalBeneficiary' : 'holderName'];

  for (const code of ['LOAN_TYPE_REVERSE', 'LOAN_TYPE_HOA', 'LOAN_TYPE_TAX', 'LOAN_TYPE_PRIVATE'] as SignalCode[]) {
    const applies = code === expected;
    out[code] = {
      required: applies,
      // Only veto once the rules have actually classified the filing. They used
      // to veto on UNKNOWN too, so a model that had read the document and
      // correctly called an HOA claim of lien was overruled by a lookup table
      // that had simply never seen that association's name. UNKNOWN means we
      // could not tell, which is not evidence of anything.
      forbidden: classified && !applies,
      minSeverity: 'notable',
      fallback: applies
        ? {
            severity: 'notable',
            headline: headlineForLoanType(code, rules.lenderName),
            evidence: evidenceForLoanType,
            recommendedActions: code === 'LOAN_TYPE_REVERSE'
              ? ['CHECK_ESTATE_FILE', 'VERIFY_OCCUPANCY']
              : ['STANDARD_OUTREACH'],
          }
        : undefined,
    };
  }

  // The recorded principal on a HECM is a multiple of the maximum claim amount.
  // This one is a boolean restatement, so it is fully determined.
  out.DEBT_FIGURE_UNRELIABLE = {
    required: !rules.principalFigureReliable,
    forbidden: rules.principalFigureReliable,
    minSeverity: 'notable',
    fallback: {
      severity: 'notable',
      headline: 'Recorded principal overstates the debt - do not use for equity',
      evidence: ['principalFigureReliable', 'originalPrincipal', 'loanType'],
      recommendedActions: ['MANUAL_FIELD_REVIEW'],
    },
  };

  // The inference chain from the worked example: HECM means 62+ at origination,
  // which makes an estate path worth checking. Deterministic on purpose - the
  // whole point of the feature is that this is never missed.
  const estatePlausible =
    rules.loanType === ForeclosureLoanType.REVERSE_HECM &&
    rules.borrowerAgeFloorAtOrigination != null;
  out.HEIR_ESTATE_PATH = {
    required: estatePlausible,
    forbidden: false, // a trust or estate can show up on any loan type
    minSeverity: 'notable',
    fallback: {
      severity: 'notable',
      headline: 'Estate or heirs may control title - check the estate file',
      evidence: ['loanType', 'borrowerAgeFloorAtOrigination', 'recordOwnerNames'],
      recommendedActions: ['CHECK_ESTATE_FILE', 'TRACE_RELATIVES_NOT_OWNER'],
    },
  };

  out.TIMELINE_URGENT = {
    required: rules.urgency === ForeclosureUrgency.CRITICAL,
    // Allowed at HIGH as model judgment; never on a distant or absent date.
    forbidden: rules.urgency !== ForeclosureUrgency.CRITICAL && rules.urgency !== ForeclosureUrgency.HIGH,
    minSeverity: 'critical',
    fallback: {
      severity: 'critical',
      headline: urgencyHeadline(rules.daysToHearing),
      evidence: ['hearingAt', 'daysToHearing', 'urgency'],
      recommendedActions: ['CONTACT_TRUSTEE_ATTORNEY'],
    },
  };

  out.TIMELINE_UPSET_BID_OPEN = {
    required: rules.upsetBidOpen,
    forbidden: !rules.upsetBidOpen,
    minSeverity: 'critical',
    fallback: {
      severity: 'critical',
      headline: 'Upset bid window still open - ten days from the report of sale',
      evidence: ['saleAt', 'upsetBidDeadline', 'upsetBidOpen'],
      recommendedActions: ['CONTACT_TRUSTEE_ATTORNEY'],
    },
  };

  const weak = countWeakCoreFields(filing, confidence);
  out.DATA_QUALITY_DEGRADED = {
    required: weak >= 3,
    forbidden: weak === 0,
    fallback: {
      severity: 'notable',
      headline: `${weak} core fields missing or low-confidence - review the document`,
      evidence: ['fieldConfidence'],
      recommendedActions: ['MANUAL_FIELD_REVIEW'],
    },
  };

  return out;
}

function headlineForLoanType(code: SignalCode, lenderName: string | null): string {
  const who = lenderName ? ` (${lenderName})` : '';
  switch (code) {
    case 'LOAN_TYPE_REVERSE':
      return truncateHeadline(`Reverse mortgage / HECM${who} - default is often not missed payments`);
    case 'LOAN_TYPE_HOA':
      return truncateHeadline(`HOA assessment lien${who}, not a mortgage foreclosure`);
    case 'LOAN_TYPE_TAX':
      return truncateHeadline(`Tax foreclosure${who}, not a mortgage foreclosure`);
    default:
      return truncateHeadline(`Private or hard-money lender${who}`);
  }
}

function urgencyHeadline(days: number | null): string {
  if (days == null) return 'Hearing date is close - timeline constrains options';
  if (days < 0) return `Hearing was ${Math.abs(days)} days ago - case has moved on`;
  if (days === 0) return 'Hearing is today';
  return `Hearing in ${days} days - timeline constrains options`;
}

/** Trim a headline to the cap without cutting mid-word where avoidable. */
export function truncateHeadline(text: string): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
  if (clean.length <= MAX_HEADLINE_CHARS) return clean;
  const cut = clean.slice(0, MAX_HEADLINE_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > MAX_HEADLINE_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Turn the model's raw output into a validated, complete signal list.
 *
 * In order: discard malformed and forbidden signals, discard ungrounded ones,
 * add any required signal the model missed, raise severity to the floor where
 * one applies, sort by severity, cap at six.
 */
export function reconcileSignals(
  raw: any,
  preconditions: Partial<Record<SignalCode, SignalPrecondition>>,
): { signals: Signal[]; dropped: { signalCode: string; reason: string }[] } {
  const dropped: { signalCode: string; reason: string }[] = [];
  const bySignal = new Map<SignalCode, Signal>();

  for (const item of Array.isArray(raw?.signals) ? raw.signals : []) {
    const code = String(item?.signal_code || '');
    if (!CODES.has(code)) {
      dropped.push({ signalCode: code || '(none)', reason: 'unknown signal code' });
      continue;
    }
    const precondition = preconditions[code as SignalCode];
    if (precondition?.forbidden) {
      dropped.push({ signalCode: code, reason: 'contradicts the deterministic facts' });
      continue;
    }

    // Evidence must name real fields. A signal with none left is not grounded.
    const evidence: string[] = Array.from(
      new Set(
        (Array.isArray(item?.evidence) ? item.evidence : [])
          .map((f: unknown) => String(f))
          .filter((f: string) => EVIDENCE.has(f)),
      ),
    );
    if (!evidence.length) {
      dropped.push({ signalCode: code, reason: 'no evidence in the allowed vocabulary' });
      continue;
    }

    const headline = truncateHeadline(item?.headline);
    if (!headline) {
      dropped.push({ signalCode: code, reason: 'empty headline' });
      continue;
    }

    const severity: SignalSeverity = SEVERITIES.has(String(item?.severity))
      ? (item.severity as SignalSeverity)
      : 'info';
    const recommendedActions = Array.from(
      new Set(
        (Array.isArray(item?.recommended_actions) ? item.recommended_actions : [])
          .map(String)
          .filter((a: string) => ACTIONS.has(a)),
      ),
    ) as RecommendedAction[];

    // Duplicate codes collapse, keeping the more severe.
    const existing = bySignal.get(code as SignalCode);
    if (existing && SEVERITY_RANK[existing.severity] >= SEVERITY_RANK[severity]) {
      dropped.push({ signalCode: code, reason: 'duplicate' });
      continue;
    }
    bySignal.set(code as SignalCode, {
      signalCode: code as SignalCode,
      severity,
      headline,
      evidence,
      recommendedActions,
    });
  }

  // A deterministic fact must not depend on the model remembering it.
  for (const [code, precondition] of Object.entries(preconditions) as [SignalCode, SignalPrecondition][]) {
    if (!precondition.required) continue;
    const existing = bySignal.get(code);
    if (!existing) {
      if (precondition.fallback) {
        bySignal.set(code, { signalCode: code, ...precondition.fallback });
      }
      continue;
    }
    if (precondition.minSeverity &&
        SEVERITY_RANK[existing.severity] < SEVERITY_RANK[precondition.minSeverity]) {
      existing.severity = precondition.minSeverity;
    }
  }

  const signals = Array.from(bySignal.values()).sort((a, b) => {
    if (SEVERITY_RANK[b.severity] !== SEVERITY_RANK[a.severity]) {
      return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    }
    return a.signalCode.localeCompare(b.signalCode);
  });

  // Cap at six, but never at the cost of a required signal.
  if (signals.length > MAX_SIGNALS) {
    const required = signals.filter((s) => preconditions[s.signalCode]?.required);
    const optional = signals.filter((s) => !preconditions[s.signalCode]?.required);
    const kept = [...required, ...optional].slice(0, MAX_SIGNALS);
    for (const signal of signals) {
      if (!kept.includes(signal)) dropped.push({ signalCode: signal.signalCode, reason: 'over the six-signal cap' });
    }
    return {
      signals: kept.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]),
      dropped,
    };
  }

  return { signals, dropped };
}

/**
 * The compact fact sheet handed to the model. Deliberately small - the filing
 * text is not included, because extraction already happened and re-reading it
 * would only invite the model to second-guess settled facts.
 */
export function buildSignalsInput(
  filing: Record<string, any>,
  rules: RulesResult,
  confidence?: Record<string, number> | null,
): Record<string, unknown> {
  const iso = (d: any) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null);
  const weak = countWeakCoreFields(filing, confidence);

  return {
    filing: {
      caseNumber: filing.caseNumber ?? null,
      county: filing.county ?? null,
      recordOwnerNames: filing.recordOwnerNames ?? [],
      propertyAddress: filing.propertyAddress ?? null,
      taxParcelId: filing.taxParcelId ?? null,
      holderName: filing.holderName ?? null,
      originalBeneficiary: filing.originalBeneficiary ?? null,
      substituteTrustee: filing.substituteTrustee ?? null,
      trusteeFirm: filing.trusteeFirm ?? null,
      trusteeAttorney: filing.trusteeAttorney ?? null,
      trusteeFirmPhone: filing.trusteeFirmPhone ?? null,
      dotDate: iso(filing.dotDate),
      originalPrincipal: filing.originalPrincipal ?? null,
      hearingAt: iso(filing.hearingAt),
      hearingMethod: filing.hearingMethod ?? null,
      saleAt: iso(filing.saleAt),
    },
    rules: {
      loanType: rules.loanType,
      lenderName: rules.lenderName,
      matchedOn: rules.matchedField,
      daysToHearing: rules.daysToHearing,
      urgency: rules.urgency,
      upsetBidOpen: rules.upsetBidOpen,
      upsetBidDeadline: iso(rules.upsetBidDeadline),
      principalFigureReliable: rules.principalFigureReliable,
      borrowerAgeFloorAtOrigination: rules.borrowerAgeFloorAtOrigination,
    },
    dataQuality: { weakCoreFieldCount: weak },
  };
}
