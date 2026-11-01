import { SurplusCallOutcome } from '@fast-homes/shared';

/**
 * County readiness as a gate.
 *
 * The course puts five questions to the clerk before the first signature in
 * a county: what claim form they use, whether a third party can file or the
 * claimant must (so whether a limited POA is enough), how a package is
 * submitted, whether a signature is required on delivery, and whether an
 * attorney has to file. A county with any of the five unanswered is "not
 * ready": the case header says so and Agreement Signed waits on it, because
 * a claimant signed in a county we cannot file in is a promise we cannot
 * keep inside the window.
 *
 * The same five answers were already the county card's "unknowns"; this
 * makes them a gate rather than a settings page nobody opened.
 */

export interface CountyFacts {
  name?: string | null;
  claimFormUrl?: string | null;
  claimFormKey?: string | null;
  acceptedMethods?: string | string[] | null;
  signatureRequired?: boolean | null;
  attorneyRequired?: boolean | null;
  assignmentPreference?: string | null;
  practiceRunAt?: Date | string | null;
  clerkContactName?: string | null;
  clerkContactPhone?: string | null;
  clerkContactEmail?: string | null;
}

export interface CountyQuestion {
  key: 'claimForm' | 'thirdParty' | 'method' | 'signature' | 'attorney';
  /** The unknown as the card lists it. */
  unknown: string;
  /** What to ask the clerk, in words that get an answer. */
  ask: string;
  /** Where the answer goes on the county card. */
  field: string;
  answered: (c: CountyFacts) => boolean;
}

const methodsOf = (v: CountyFacts['acceptedMethods']): string[] =>
  Array.isArray(v) ? v.filter(Boolean) : String(v || '').split(',').map((m) => m.trim()).filter(Boolean);

export const COUNTY_QUESTIONS: CountyQuestion[] = [
  {
    key: 'claimForm',
    unknown: 'claim form',
    ask: 'Which form do you use for a surplus funds claim after a tax deed sale, and where can I get the current copy?',
    field: 'Claim form link or upload',
    answered: (c) => !!(c.claimFormUrl || c.claimFormKey),
  },
  {
    key: 'thirdParty',
    unknown: 'full or partial assignment',
    ask: 'Can a third party file on the owner\'s behalf under a limited power of attorney, or do you need an assignment of the claim? If an assignment, full or partial?',
    field: 'Assignment of rights',
    answered: (c) => !!c.assignmentPreference,
  },
  {
    key: 'method',
    unknown: 'how claims are submitted',
    ask: 'How do you take the package: by mail, by courier, in person, or e-filed? And to which address or portal?',
    field: 'Submit by, and the clerk address',
    answered: (c) => methodsOf(c.acceptedMethods).length > 0,
  },
  {
    key: 'signature',
    unknown: 'whether a signature is required',
    ask: 'Does the claim have to be signed in front of a notary, and do you require a signature on delivery?',
    field: 'Signature on delivery',
    answered: (c) => c.signatureRequired !== null && c.signatureRequired !== undefined,
  },
  {
    key: 'attorney',
    unknown: 'whether an attorney is required',
    ask: 'Does a claim filed by anyone other than the owner have to come through a Florida attorney?',
    field: 'Attorney required',
    answered: (c) => c.attorneyRequired !== null && c.attorneyRequired !== undefined,
  },
];

export interface CountyReadiness {
  /** Every one of the five answered. */
  ready: boolean;
  /** The unanswered ones, as the card lists them. */
  unknowns: string[];
  /** The document set has been filled out once for this county. */
  practiceRun: boolean;
}

export function countyReadiness(c: CountyFacts | null | undefined): CountyReadiness {
  if (!c) return { ready: false, unknowns: COUNTY_QUESTIONS.map((q) => q.unknown), practiceRun: false };
  const unknowns = COUNTY_QUESTIONS.filter((q) => !q.answered(c)).map((q) => q.unknown);
  return { ready: unknowns.length === 0, unknowns, practiceRun: !!c.practiceRunAt };
}

export interface ClerkScriptLine {
  key: CountyQuestion['key'];
  ask: string;
  field: string;
  answered: boolean;
}

/** The clerk call, question by question, with the ones already answered marked. */
export function clerkScript(c: CountyFacts | null | undefined): ClerkScriptLine[] {
  return COUNTY_QUESTIONS.map((q) => ({ key: q.key, ask: q.ask, field: q.field, answered: !!c && q.answered(c) }));
}

/** The one task the first yes or maybe in a county opens. Idempotent on the title across the org. */
export function clerkTaskTitle(county: string): string {
  return `Ask the ${county} clerk: claim form, third party or POA, submission method, signature, attorney`;
}

/** The course's dry run, before the first real appointment in a county. */
export function practiceRunTaskTitle(county: string): string {
  return `Practice run for ${county}: fill out the whole document set once`;
}

/**
 * A call outcome that is a yes or a maybe from the person who can sign: a
 * conversation with the claimant, a packet requested, a callback booked.
 * The first of these in a county is when the county has to be made ready.
 */
export function isCountyPrepOutcome(outcome: string | null | undefined): boolean {
  return (
    outcome === SurplusCallOutcome.SPOKE_CLAIMANT ||
    outcome === SurplusCallOutcome.WANTS_PACKET ||
    outcome === SurplusCallOutcome.CALLBACK_SCHEDULED
  );
}

/** The name the clerk contact row carries when the county card has no clerk name. */
export function clerkContactName(c: CountyFacts | null | undefined, county: string): string {
  const name = String(c?.clerkContactName || '').trim();
  return name || `${county} County Clerk`;
}
