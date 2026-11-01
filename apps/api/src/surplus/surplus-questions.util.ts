import { SurplusClaimStatus } from '@fast-homes/shared';
import { outreachRank } from './surplus-outreach.util';

/**
 * The four things every case has to settle, in any order, and what to do
 * about the ones still open.
 *
 * This replaces the single "next step" the board guessed from the queue. The
 * course runs a case as a hunt: confirm the money, find who can sign, make
 * sure it is the right person, reach someone. The order changes with every
 * clue, so the panel shows where each question stands and lets the team pick
 * the next action, with at most three suggestions when nobody has.
 */

export type QuestionKey = 'money' | 'signer' | 'person' | 'reach';
export type QuestionState = 'known' | 'unknown' | 'problem';

export interface CaseQuestion {
  key: QuestionKey;
  label: string;
  state: QuestionState;
  answer: string;
  detail: string | null;
}

export interface CaseSuggestion {
  /** Stable per case, so a dismissed suggestion stays dismissed. */
  key: string;
  text: string;
}

export const QUESTION_LABEL: Record<QuestionKey, string> = {
  money: 'Money still there?',
  signer: 'Who can sign?',
  person: 'Right person?',
  reach: 'Can we reach someone?',
};

/** Death records that came from a data vendor rather than a document somebody read. */
const VENDOR_DEATH: Record<string, string> = { idi: 'IDI', batchdata: 'BatchData', endato: 'EnformionGo' };

const SIGNED_STAGES = ['Agreement Signed', 'Package Notarized', 'Claim Filed', 'Awaiting Disbursement', 'Check Received', 'Paid'];
const GATED_ORDER = ['New', 'Contacted', 'Agreement Signed', 'Package Notarized', 'Claim Filed', 'Awaiting Disbursement'];
const GATED = ['Agreement Signed', 'Package Notarized', 'Claim Filed', 'Awaiting Disbursement'];

function phoneText(d: string): string {
  const x = String(d || '').replace(/\D/g, '').slice(-10);
  return x.length === 10 ? `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}` : d;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The fields of a board row the questions read. Everything here is already on the row. */
export interface QuestionFacts {
  claimant: string;
  claimStatus?: string | null;
  lastPolledAt?: Date | string | null;
  isDeceased?: boolean;
  deathSource?: string | null;
  isEntity?: boolean;
  livingHeirCount?: number;
  callableHeirCount?: number;
  entitlementVerified?: boolean;
  contactMismatch?: boolean;
  mismatchedName?: string | null;
  trace?: { state?: string } | null;
  doNotCall?: boolean;
  tappedAt?: Date | string | null;
  phones: { number: string; dnc?: string | null; bad?: boolean }[];
  emails: string[];
  ownerMailingStreet?: string | null;
  mailReturned?: boolean;
  letterDue?: boolean;
  channels?: Record<string, boolean> | null;
  heirs?: {
    id: string;
    name: string;
    role?: string | null;
    relationship?: string | null;
    deceased?: boolean;
    doNotCall?: boolean;
    callable?: boolean;
    emails?: string[];
  }[];
  stage?: string | null;
  stageBlocks?: Record<string, string[]> | null;
  heldAt?: Date | string | null;
  holdReason?: string | null;
  /** Set when the hold is a pause, which ends on its own. */
  holdUntil?: Date | string | null;
  /** Sixty days of full effort and nobody reached (see surplus-windows.util). */
  pauseOffer?: { since: Date | string; days: number; until: Date | string } | null;
  claimantUpdate?: { overdue?: boolean } | null;
}

export function moneyQuestion(r: QuestionFacts): CaseQuestion {
  const status = (r.claimStatus || SurplusClaimStatus.UNKNOWN) as SurplusClaimStatus;
  const base = { key: 'money' as const, label: QUESTION_LABEL.money };
  const read = r.lastPolledAt ? 'from the clerk\'s docket' : null;
  switch (status) {
    case SurplusClaimStatus.OPEN:
      return { ...base, state: 'known', answer: 'Open, nothing filed', detail: read };
    case SurplusClaimStatus.GOV_LIEN:
      return { ...base, state: 'known', answer: 'Only a government lien filed', detail: read };
    case SurplusClaimStatus.DENIED:
      return { ...base, state: 'known', answer: 'A claim was denied, the money is still there', detail: read };
    case SurplusClaimStatus.PENDING:
      return { ...base, state: 'problem', answer: 'Somebody else has a claim pending', detail: read };
    case SurplusClaimStatus.ASSIGNED:
      return { ...base, state: 'problem', answer: 'The owner already signed with someone else', detail: read };
    case SurplusClaimStatus.DISTRIBUTED:
      return { ...base, state: 'problem', answer: 'Paid out', detail: read };
    default:
      return { ...base, state: 'unknown', answer: 'Not checked', detail: 'Read the docket at the clerk' };
  }
}

export function signerQuestion(r: QuestionFacts): CaseQuestion {
  const base = { key: 'signer' as const, label: QUESTION_LABEL.signer };
  if (r.isEntity) {
    return { ...base, state: 'unknown', answer: 'A company: an officer signs', detail: 'Find the registered agent or an officer' };
  }
  if (!r.isDeceased) return { ...base, state: 'known', answer: 'The claimant', detail: null };
  const vendor = VENDOR_DEATH[String(r.deathSource || '')];
  const living = r.livingHeirCount || 0;
  if (living > 0) {
    return {
      ...base,
      state: 'known',
      answer: `Owner deceased, ${plural(living, 'living heir')} on file`,
      detail: r.callableHeirCount ? `${r.callableHeirCount} with a number` : 'no number for them yet',
    };
  }
  return {
    ...base,
    state: 'problem',
    answer: 'Owner deceased, no heir confirmed',
    detail: vendor ? `death from ${vendor} only` : 'find the probate case',
  };
}

export function personQuestion(r: QuestionFacts): CaseQuestion {
  const base = { key: 'person' as const, label: QUESTION_LABEL.person };
  if (r.entitlementVerified) return { ...base, state: 'known', answer: 'Confirmed', detail: null };
  if (r.contactMismatch || r.trace?.state === 'mismatch') {
    return {
      ...base,
      state: 'problem',
      answer: 'The trace found somebody else',
      detail: r.mismatchedName ? `came back as ${r.mismatchedName}` : null,
    };
  }
  const detail =
    r.trace?.state === 'matched'
      ? 'the trace matched, not confirmed by a person'
      : r.trace?.state === 'never'
        ? 'not traced yet'
        : 'check the sold address and middle initial';
  return { ...base, state: 'unknown', answer: 'Not confirmed', detail };
}

/** People on the case who can be tried by phone, best first. The claimant counts only while alive. */
function callablePeople(r: QuestionFacts) {
  const own = !r.isDeceased && !r.doNotCall ? r.phones.filter((p) => !p.dnc && !p.bad) : [];
  const others = (r.heirs || [])
    .filter((h) => h.callable && !h.deceased && !h.doNotCall)
    .sort((a, b) => outreachRank(a).rank - outreachRank(b).rank);
  return { own, others };
}

export function reachQuestion(r: QuestionFacts): CaseQuestion {
  const base = { key: 'reach' as const, label: QUESTION_LABEL.reach };
  if (r.doNotCall) return { ...base, state: 'problem', answer: 'Marked do not contact', detail: null };
  if (r.tappedAt) return { ...base, state: 'known', answer: 'Yes, they have replied', detail: null };
  const { own, others } = callablePeople(r);
  const emails = (!r.isDeceased ? r.emails.length : 0) + (r.heirs || []).filter((h) => !h.deceased && !h.doNotCall && (h.emails || []).length).length;
  const mail = !r.isDeceased && !!r.ownerMailingStreet && !r.mailReturned;
  const parts = [
    own.length ? `${plural(own.length, 'number')} for the claimant` : null,
    others.length ? `${others.length === 1 ? '1 other person' : `${others.length} other people`} with a number` : null,
    emails ? plural(emails, 'email') : null,
  ].filter(Boolean);
  if (!parts.length && !mail) {
    return { ...base, state: 'problem', answer: 'Nobody to reach yet', detail: r.isDeceased ? 'find the family' : 'no number, email or address' };
  }
  const tried = r.channels?.called || r.channels?.texted || r.channels?.emailed || r.channels?.lettered;
  return {
    ...base,
    state: 'unknown',
    answer: parts.length ? parts.join(', ') : 'A mailing address only',
    detail: tried ? 'no reply yet' : 'nothing tried yet',
  };
}

export function caseQuestions(r: QuestionFacts): CaseQuestion[] {
  return [moneyQuestion(r), signerQuestion(r), personQuestion(r), reachQuestion(r)];
}

/**
 * At most three suggestions, read off the questions. Phrased as things to
 * do, never as the one right answer: the team picks the next action.
 */
export function caseSuggestions(r: QuestionFacts, questions = caseQuestions(r)): CaseSuggestion[] {
  if (r.stage === 'Dead' || r.stage === 'Paid') return [];
  if (r.heldAt) {
    // A pause ends itself; there is nothing to settle until it does.
    if (r.holdUntil) return [];
    return [{ key: 'hold', text: `Settle the hold${r.holdReason ? ` (${r.holdReason})` : ''} and release the file` }];
  }
  // The rules' answer to a file that has had everything: stop, and come back
  // in six months. Ahead of everything else, because it is the decision the
  // file is waiting on.
  if (r.pauseOffer) {
    const until = new Date(r.pauseOffer.until).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return [
      {
        key: 'pause',
        text: `${r.pauseOffer.days} days of full effort and nobody reached. Pause the file until ${until} and revisit it then`,
      },
    ];
  }
  const q = Object.fromEntries(questions.map((x) => [x.key, x])) as Record<QuestionKey, CaseQuestion>;
  const out: CaseSuggestion[] = [];

  // After a signature the work is the paperwork, which is a fixed order.
  if (r.stage && SIGNED_STAGES.includes(r.stage)) {
    const idx = GATED_ORDER.indexOf(r.stage);
    const next = GATED.find((g) => GATED_ORDER.indexOf(g) > idx);
    const missing = next ? r.stageBlocks?.[next] || [] : [];
    if (r.claimantUpdate?.overdue) out.push({ key: 'monthly-update', text: `Send ${r.claimant} their monthly update` });
    for (const m of missing.slice(0, 3 - out.length)) out.push({ key: `gate:${m}`, text: `Before ${next}: ${m}` });
    return out.slice(0, 3);
  }

  if (q.money.state === 'problem' && r.claimStatus === SurplusClaimStatus.PENDING) {
    out.push({ key: 'pending-claim', text: 'Read the pending claim on the docket before contacting anyone' });
  } else if (q.money.state === 'unknown') {
    out.push({ key: 'read-docket', text: 'Read the docket at the clerk to confirm nothing has been filed' });
  }

  if (r.isDeceased && VENDOR_DEATH[String(r.deathSource || '')] && !(r.livingHeirCount || 0)) {
    out.push({ key: 'confirm-death', text: `Check for an obituary or a probate case for ${r.claimant} before calling old numbers` });
  }

  const { own, others } = callablePeople(r);
  if (q.signer.state === 'problem') {
    const first = others[0];
    out.push(
      first
        ? {
            key: `ask-relative:${first.id}`,
            text: `Call ${first.name}${first.relationship ? ` (${first.relationship.toLowerCase()})` : ''} and ask who is handling the estate`,
          }
        : { key: 'find-probate', text: `Search the probate court for ${r.claimant}'s estate` },
    );
  }
  if (r.isEntity) out.push({ key: 'entity-agent', text: 'Find the registered agent or an officer on Sunbiz' });

  if (q.person.state === 'problem') {
    out.push({ key: 'retrace', text: `Search for ${r.claimant} by name: the trace found somebody else` });
  }

  if (q.reach.state === 'problem' && !r.isDeceased && !r.isEntity && !r.doNotCall) {
    out.push({ key: 'trace', text: `Send ${r.claimant} to IDI in the next batch` });
  } else if (q.reach.state === 'unknown' && !r.isDeceased) {
    if (own.length && !r.channels?.called) {
      out.push({ key: 'call-claimant', text: `Call ${r.claimant} at ${phoneText(own[0].number)}` });
    } else if (r.letterDue) {
      out.push({ key: 'letter', text: `Mail the next letter to ${r.claimant}` });
    }
  }

  if (r.tappedAt && q.person.state === 'unknown') {
    out.push({ key: 'confirm-person', text: 'Confirm the right person: the sold address and the middle initial' });
  }

  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true))).slice(0, 3);
}
