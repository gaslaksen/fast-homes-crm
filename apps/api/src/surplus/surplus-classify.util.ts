/**
 * Reads a county case document list and decides whether the money is still
 * there and whether anybody else has a hand on it.
 *
 * Pure and dependency-free so the adapter, the ingest service and the specs
 * share one implementation, and so a classifier change can be re-run over the
 * persisted `claimLedger` without re-fetching the county.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 *
 * The posted balance is not evidence. Duval case 2025-0774TD carries three
 * `Surplus Distribution` filings and a `Surplus Breakdown`, and the search grid
 * still reports the full $27,929.98. Anybody triaging on the balance alone
 * would work a case that was paid out months ago. Claim state lives in the
 * document list and nowhere else.
 *
 * ── Every county names things differently ───────────────────────────────────
 *
 * A classifier carried from one county to the next has been wrong every time it
 * has been tried, twice badly enough to invert the answer. Rules are therefore
 * ordered with the traps FIRST, and each rule says which county's vocabulary it
 * came from. Do not reorder casually; the order is the logic.
 */

import { SurplusClaimStatus } from '@fast-homes/shared';

// ─── Document kinds ─────────────────────────────────────────────────────────

export type SurplusDocKind =
  /** The clerk's mailed Notice of Surplus Funds. Starts the claim clock. */
  | 'notice_surplus'
  /** A statement of claim filed against the surplus by somebody. */
  | 'claim'
  /** A governmental or ad valorem lien claim. Takes a slice, not the residual. */
  | 'gov_lien_claim'
  /** The clerk denying a filed claim. */
  | 'denial'
  /** The surplus actually being paid out. Terminal. */
  | 'distribution'
  /**
   * Routine payouts off the top to the tax deed applicant and the tax
   * collector. NOT a distribution of the surplus. These appear on wide-open
   * cases: all five Duval reference cases carry an `Applicant Disbursement`,
   * including two with no claim of any kind on file. Matching "disburse" as a
   * payout inverts the answer.
   */
  | 'routine_disbursement'
  /** An exhibit filed WITH a claim (photo ID, notary, probate docs). Not a claim. */
  | 'claim_attachment'
  /** Clerk mail came back. The address is dead. */
  | 'mail_undeliverable'
  /** Clerk mail was delivered. The address is live. */
  | 'mail_delivered'
  /** The sheriff could not serve the notice at the address. */
  | 'sheriff_not_served'
  /** The sheriff served the notice. */
  | 'sheriff_served'
  /** Probate paperwork or a death certificate is on file. */
  | 'probate'
  /** A Sunbiz pull, so the owner of record is an entity. */
  | 'entity'
  /**
   * A clerk's payment receipt for a filing fee. Not a claim, but on Lee every
   * one of 68 receipts sat on a case with a claim and none on an unclaimed
   * case, so a receipt with no claim document beside it is a claim we cannot
   * see.
   */
  | 'receipt'
  | 'other';

export interface SurplusDoc {
  title: string;
  /** The county's document id, for re-fetch. */
  docId?: string | null;
  url?: string | null;
  /**
   * Claimant name, when the SOURCE puts it in the title. RealTDM does
   * (`SURPLUS CLAIM_<name>`); Duval does not, its claim titles are the bare
   * string `Surplus - Submitted Claim` and the claimant is inside a scan with
   * no text layer. Left undefined rather than guessed.
   */
  claimant?: string | null;
}

export interface ClassifiedDoc extends SurplusDoc {
  kind: SurplusDocKind;
}

interface Rule {
  kind: SurplusDocKind;
  re: RegExp;
  /** Where this vocabulary was observed, so a future county can tell what is safe to reuse. */
  seenIn: string;
}

/**
 * ORDER IS THE LOGIC. First match wins, and the traps come first because every
 * one of them contains the substring that a naive later rule matches on.
 */
const RULES: Rule[] = [
  // ── Traps. Each of these contains a word a later rule matches. ────────────

  // "NO CLAIM" is the county declining to claim, the opposite of a claim. On a
  // Brevard sample 52 of 96 documents matching the word "claim" were the county
  // filing NO CLAIM. Counting those as competition hid most of the opportunity.
  { kind: 'other', re: /\bno\s*claim\b/i, seenIn: 'Brevard' },
  // A disclaimer is a lienholder WAIVING its interest, again the opposite.
  // Pinellas 2023-01704 has three documents on file, all disclaimers, and was
  // initially read as contested. It is $255,189 with nobody claiming.
  { kind: 'other', re: /disclaim/i, seenIn: 'Pinellas' },
  // Exhibits filed WITH a claim. "Photo IDs for Surplus Claims" contains
  // "Claims" and appears on three of the five Duval reference cases. Counting
  // them as claims breaks the claim-to-denial pairing: case 2025-0761TD has two
  // claims and two denials and would read as PENDING instead of DENIED, which
  // is the difference between a dead lead and the best lead on the board.
  {
    kind: 'claim_attachment',
    re: /photo\s*id|notary\s*verification|^verification$|^communication$|w-?9/i,
    seenIn: 'Duval',
  },
  // Payouts off the top to the applicant and the tax collector. Present on
  // every Duval case including ones with no claim at all.
  {
    kind: 'routine_disbursement',
    re: /\b(applicant|tax\s*collector)\s*disbursement\b/i,
    seenIn: 'Duval',
  },
  // A "labels" sheet is the page of mailing labels the clerk prints beside a
  // letter. Lee's SURPLUS_LETTER_LABELS is one page, 1 KB, and draws nothing,
  // but it contains "SURPLUS_LETTER" and is filed seconds after the real
  // letter, so without this trap it becomes the operative notice.
  { kind: 'other', re: /_labels\b|labels\s*available/i, seenIn: 'Lee' },
  // The clerk's fee receipt, filed beside a claim. Exactly "Receipt" on Lee;
  // Duval's "RealAuction Payment Receipt" is the BIDDER's receipt, sits on
  // every case, and must stay 'other'.
  { kind: 'receipt', re: /^receipt$/i, seenIn: 'Lee' },
  // "RETURNED MAIL UNCLAIMED" contains "claim". Mail rules run before claim rules.
  {
    kind: 'mail_undeliverable',
    // Duval ships three spellings of this on the same docket:
    // "Certified Mail Undelieverd", "Regular Mail Undelievered",
    // "Certified Mail Undelivered". Match the mangled stem, not the word.
    re: /undeliver|undelieve|unable\s*to\s*forward|returned\s*mail|vacant|no\s*such\s*number|attempted\s*-?\s*not\s*known/i,
    seenIn: 'Duval, Brevard',
  },
  { kind: 'mail_delivered', re: /mail\s*delivered|returned\s*signed|green\s*card/i, seenIn: 'Duval' },
  {
    kind: 'sheriff_not_served',
    re: /returned\s*not\s*served|not\s*served\s*sheriff/i,
    seenIn: 'Duval',
  },
  { kind: 'sheriff_served', re: /return\s*of\s*service/i, seenIn: 'Duval' },
  // Lee files the sheriff's return as "Sheriff's Service" with an ROS filename.
  // Service is at the PROPERTY and says nothing about the owner's mailing
  // address, which is why the mail verdict ignores this kind entirely.
  { kind: 'sheriff_served', re: /sheriff'?s?\s*service|\bros\b/i, seenIn: 'Lee' },

  // ── The money moving. Checked before claims so a distributed case is never
  //    reported as merely contested. ──────────────────────────────────────────
  {
    kind: 'distribution',
    re: /surplus\s*(distribution|breakdown)|distribution\s*of\s*surplus/i,
    seenIn: 'Duval',
  },
  { kind: 'denial', re: /denial|denied/i, seenIn: 'Duval' },

  // ── Claims. Governmental first, since a city lien is not a competitor: it
  //    takes a slice off the top and the owner can still claim the residual. ──
  {
    kind: 'gov_lien_claim',
    re: /ad\s*valorem|homestead\s*lien|code\s*enforc|municipal\s*lien|utilit/i,
    seenIn: 'Duval',
  },
  {
    kind: 'claim',
    re: /submitted\s*claim|statement\s*of\s*claim|statment\s*of\s*claim|state\s*of\s*claim|statement\s*claim|surplus\s*claim|claim\s*to\s*receive/i,
    seenIn: 'Duval, Lee, Brevard, Alachua',
  },

  // ── Context signals ───────────────────────────────────────────────────────
  { kind: 'notice_surplus', re: /notice\s*of\s*surplus|surplus[_\s]*letter/i, seenIn: 'Duval, Lee' },
  { kind: 'probate', re: /probate|death\s*cert|letters\s*of\s*administration/i, seenIn: 'Duval' },
  { kind: 'entity', re: /sunbiz/i, seenIn: 'Duval' },
];

export function classifyDocument(title: string): SurplusDocKind {
  const t = String(title || '').trim();
  if (!t) return 'other';
  for (const r of RULES) if (r.re.test(t)) return r.kind;
  return 'other';
}

export function classifyDocuments(docs: SurplusDoc[]): ClassifiedDoc[] {
  return (docs || []).map((d) => ({ ...d, kind: classifyDocument(d.title) }));
}

// ─── Claimant reading, where the source gives us one ────────────────────────

/** A claimant that is a unit of government takes a slice, it is not a competitor. */
const GOVERNMENT = /\b(city|county|state|town|code\s*enforc|utilit|clerk|sheriff|tax\s*collector|dept|department)\b/i;
/** A claimant that reads like a recovery shop or a law firm is a competitor. */
const COMPETITOR = /\b(llc|l\.l\.c|inc|law|recovery|group|funding|capital|partners|services|associates)\b/i;
/**
 * "GG ELITE SERVICES LLC As ASSIGNEE of SUSAN D WRIGHT" is the shape that means
 * the owner has ALREADY SIGNED with somebody else. It is terminal in a way a
 * plain competitor claim is not: a lienholder claim leaves the owner residual
 * available, an assignment does not.
 */
const ASSIGNEE = /\bas\s+assignee\s+of\b|\bassignee\s+of\b/i;

export type ClaimantClass = 'assignee' | 'government' | 'competitor' | 'owner' | 'unknown';

export function classifyClaimant(claimant?: string | null, owners: string[] = []): ClaimantClass {
  const c = String(claimant || '').trim();
  if (!c) return 'unknown';
  if (ASSIGNEE.test(c)) return 'assignee';
  if (GOVERNMENT.test(c)) return 'government';
  const surnames = owners
    .flatMap((o) => String(o || '').toUpperCase().replace(/[.,]/g, ' ').split(/\s+/))
    .filter((t) => t.length > 2 && !/^(JR|SR|II|III|IV|THE|ESTATE|LLC|INC|TRUST)$/.test(t));
  const tokens = c.toUpperCase().replace(/[.,]/g, ' ').split(/\s+/);
  if (surnames.length && tokens.some((t) => t.length > 2 && surnames.includes(t))) return 'owner';
  if (COMPETITOR.test(c)) return 'competitor';
  return 'unknown';
}

// ─── The verdict ────────────────────────────────────────────────────────────

export type MailVerdict = 'delivered' | 'undeliverable' | 'mixed' | 'unknown';

export interface CaseClassification {
  claimStatus: SurplusClaimStatus;
  mailVerdict: MailVerdict;
  ledger: ClassifiedDoc[];
  /** Counts behind the verdict, so a card can explain itself instead of asserting. */
  counts: Record<'claims' | 'denials' | 'distributions' | 'govLiens' | 'notices' | 'receipts', number>;
  /** A death certificate or probate filing is on the docket. */
  probateOnFile: boolean;
  /** A Sunbiz pull is on file, so the owner of record is an entity. */
  entityOnFile: boolean;
  /** True when a claim is on file but the source does not name the claimant. */
  claimantUnknown: boolean;
  /** One line saying WHY, for the card. Never a bare assertion. */
  reason: string;
}

/**
 * Resolve the case from its documents.
 *
 * Claims and denials pair by COUNT, not by name, because Duval's claim titles
 * carry no claimant. Documents arrive in filing order, so a denial always
 * follows the claim it denies. When denials cover every claim on file the money
 * is still there AND somebody has already identified themselves as wanting it,
 * which is the best state on the board, not a contested one. Duval 2025-0761TD
 * is the reference case: two claims, two denials, $40,091.71 still sitting, and
 * the denied claimant shares a surname with the owner of record.
 */
export function classifyCase(
  docs: SurplusDoc[],
  opts: {
    owners?: string[];
    /**
     * Whether a fee receipt with no claim document beside it means somebody
     * has filed. TRUE on Lee, where 68 of 68 receipts sat on claimed cases.
     * FALSE on Duval, where every docket carries a bare "Receipt" including
     * wide-open ones. Set by the adapter, never assumed: it is exactly the
     * kind of rule that inverts the answer when carried across counties.
     */
    receiptsImplyClaim?: boolean;
  } = {},
): CaseClassification {
  const ledger = classifyDocuments(docs);
  const owners = opts.owners || [];
  const of = (k: SurplusDocKind) => ledger.filter((d) => d.kind === k);

  const claims = of('claim');
  const denials = of('denial');
  const distributions = of('distribution');
  const govLiens = of('gov_lien_claim');
  const notices = of('notice_surplus');
  const receipts = of('receipt');

  const counts = {
    claims: claims.length,
    denials: denials.length,
    distributions: distributions.length,
    govLiens: govLiens.length,
    notices: notices.length,
    receipts: receipts.length,
  };

  const probateOnFile = of('probate').length > 0;
  const entityOnFile = of('entity').length > 0;

  // Mail. This verdict answers one question only: is the CLAIMANT'S MAILING
  // ADDRESS live, which is what decides whether a skip trace is the whole game
  // on this lead.
  //
  // Sheriff service is deliberately excluded even though it is a delivery
  // outcome. The sheriff serves at the PROPERTY; the clerk mails to the owner's
  // address of record. On a surplus file the owner has usually been gone for
  // years, so successful service at the property says nothing about reaching
  // them. Folding the two together turned Duval 2026-0004TD, which has seven
  // returned mailings and no successful delivery, into "mixed" and hid that the
  // record address is dead.
  //
  // Title-level classification also cannot separate UNCLAIMED (delivery
  // attempted, notices left, address LIVE and worth a call) from VACANT or NO
  // SUCH NUMBER (address dead). That distinction is a USPS endorsement stamped
  // on a scan with no text layer, so it needs OCR and is not guessed here.
  const dead = of('mail_undeliverable').length;
  const live = of('mail_delivered').length;
  const mailVerdict: MailVerdict =
    dead && live ? 'mixed' : dead ? 'undeliverable' : live ? 'delivered' : 'unknown';

  const claimantClasses = claims.map((c) => classifyClaimant(c.claimant, owners));
  // On a county where receipts only ever accompany claims, a receipt with no
  // claim document beside it is a claim the county has not indexed yet, filed
  // by somebody it has not named.
  const hiddenClaim = !!opts.receiptsImplyClaim && claims.length === 0 && receipts.length > 0;
  const claimantUnknown = (claims.length > 0 && claims.every((c) => !c.claimant)) || hiddenClaim;

  let claimStatus: SurplusClaimStatus;
  let reason: string;

  if (distributions.length) {
    claimStatus = SurplusClaimStatus.DISTRIBUTED;
    reason = `${distributions.length} surplus distribution filing${distributions.length === 1 ? '' : 's'} on the docket, so the money has been paid out.`;
  } else if (claimantClasses.includes('assignee')) {
    claimStatus = SurplusClaimStatus.ASSIGNED;
    reason = 'A claim was filed by an assignee of the owner, so the owner has already signed with somebody else.';
  } else if (claimantClasses.includes('owner')) {
    claimStatus = SurplusClaimStatus.ASSIGNED;
    reason = 'The owner of record has claimed the surplus directly.';
  } else if (claims.length && denials.length >= claims.length) {
    claimStatus = SurplusClaimStatus.DENIED;
    reason = `${claims.length} claim${claims.length === 1 ? '' : 's'} filed and ${denials.length} denied, with no distribution. The money is still there and a motivated claimant has already identified themselves.`;
  } else if (claims.length) {
    claimStatus = SurplusClaimStatus.PENDING;
    const open = claims.length - denials.length;
    reason = `${open} claim${open === 1 ? '' : 's'} on file with no denial and no distribution${claimantUnknown ? ', claimant not named in the county record' : ''}.`;
  } else if (hiddenClaim) {
    // Lee: 68 of 68 fee receipts sat on claimed cases and none on an unclaimed
    // one. OPEN would rank this at the top of the board; contestable is honest.
    claimStatus = SurplusClaimStatus.PENDING;
    reason = `A filing-fee receipt is on the docket with no claim document beside it. On this county a receipt accompanies a claim, so somebody not yet named has filed.`;
  } else if (govLiens.length) {
    claimStatus = SurplusClaimStatus.GOV_LIEN;
    reason = `Only a governmental lien has filed, which takes a slice off the top. The owner residual is still unclaimed.`;
  } else if (notices.length) {
    claimStatus = SurplusClaimStatus.OPEN;
    reason = 'Notice of surplus mailed and nothing filed against it.';
  } else {
    claimStatus = SurplusClaimStatus.UNKNOWN;
    reason = 'No notice of surplus on the docket yet, so the claim clock has not started.';
  }

  return {
    claimStatus,
    mailVerdict,
    ledger,
    counts,
    probateOnFile,
    entityOnFile,
    claimantUnknown,
    reason,
  };
}

// ─── Claimants ──────────────────────────────────────────────────────────────

const NAME_SUFFIX = /\b(JR|SR|II|III|IV|V)\b\.?/g;
const ESTATE_MARK = /\b(ESTATE|DECEASED|DECD)\b/g;
const ESTATE_OF = /^THE\s+ESTATE\s+OF\s+/i;
const ENTITY =
  /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|CO|LP|LLP|LLLP|LTD|TRUST|ASSOCIATION|CHURCH|BANK|PARTNERS|HOLDINGS)\b/i;
/**
 * A company-type suffix at the END of a name only. Stripped before grouping so
 * `HEAVENLY HANDS FUNDING` and `HEAVENLY HANDS FUNDING, LLC` are one claimant.
 * Anchored to the end on purpose: `TRUST` mid-name is part of the name
 * (`MINNIE BOWDISH TRUST LLC`), not a suffix to discard.
 */
const ENTITY_TAIL = /\s+(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|LP|LLP|LLLP|LTD)\s*$/i;

/**
 * The label to show for a collapsed group.
 *
 * Prefer a variant that is NOT an estate form, since that is the name a person
 * says on a call: "DANNIE LESTER STEWART" over "DANNIE LESTER STEWART ESTATE".
 * Among the remaining candidates take the longest, which keeps the full legal
 * name of an entity rather than a truncated one: "HEAVENLY HANDS FUNDING, LLC"
 * over "HEAVENLY HANDS FUNDING". When every variant is an estate form, keep it,
 * because inventing a living person's name would be worse than an awkward one.
 */
function preferredName(variants: string[]): string {
  const plain = variants.filter((v) => {
    const u = v.toUpperCase();
    ESTATE_MARK.lastIndex = 0;
    const isEstate = ESTATE_MARK.test(u) || ESTATE_OF.test(v);
    ESTATE_MARK.lastIndex = 0;
    return !isEstate;
  });
  const pool = plain.length ? plain : variants;
  return pool.reduce((best, v) => (v.length > best.length ? v : best), pool[0]);
}

export interface CollapsedClaimant {
  /** The display name, preferring the plain personal form over the estate form. */
  name: string;
  /** Any variant carried an estate or deceased marker. */
  deceased: boolean;
  isEntity: boolean;
  /** Every spelling the county listed, kept for the audit trail. */
  variants: string[];
}

/**
 * One entry per actual person, from a county's raw owner list.
 *
 * Counties list the same human several times. Duval 2026-0004TD returns both
 * `DANNIE LESTER STEWART ESTATE` and `DANNIE LESTER STEWART`, which is one
 * deceased man, not two claimants. Each claimant becomes its own lead and its
 * own dedupeUid, so failing to collapse here doubles the board and has the team
 * calling the same family twice.
 *
 * The estate marker is not discarded, it is promoted to a flag: an estate claim
 * needs letters and a death certificate before it can be filed at all, which is
 * what routes the lead onto the heir drip.
 *
 * Genuinely different co-owners survive. Two names that differ by more than
 * suffixes and estate markers are two claimants.
 */
export function collapseClaimants(owners: string[]): CollapsedClaimant[] {
  const groups = new Map<string, CollapsedClaimant>();

  for (const raw of owners || []) {
    const original = String(raw || '').trim().replace(/,\s*$/, '').replace(/\s+/g, ' ');
    if (!original) continue;

    // Punctuation and trailing entity suffixes are normalised away before
    // grouping, because Duval lists the same owner several ways on one case:
    // `D R HORTON INC-JACKSONVILLE` beside `D R HORTON INC - JACKSONVILLE`, and
    // `HEAVENLY HANDS FUNDING` beside `HEAVENLY HANDS FUNDING, LLC`. Without
    // this each pair becomes two claimants, two leads, and the same company
    // called twice, which is exactly what this function exists to prevent.
    const core = original
      .toUpperCase()
      .replace(ESTATE_OF, '')
      .replace(/[.,\-\/]/g, ' ')
      .replace(ESTATE_MARK, ' ')
      .replace(NAME_SUFFIX, ' ')
      .replace(ENTITY_TAIL, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!core) continue;

    const deceased = ESTATE_MARK.test(original.toUpperCase()) || ESTATE_OF.test(original);
    ESTATE_MARK.lastIndex = 0; // the global flag makes .test stateful

    const existing = groups.get(core);
    if (existing) {
      existing.variants.push(original);
      existing.deceased = existing.deceased || deceased;
      existing.isEntity = existing.isEntity || ENTITY.test(original);
      existing.name = preferredName(existing.variants);
    } else {
      groups.set(core, {
        name: original,
        deceased,
        isEntity: ENTITY.test(original),
        variants: [original],
      });
    }
  }

  return [...groups.values()];
}

// ─── Working order ──────────────────────────────────────────────────────────

/**
 * Whether this case is still worth a human's time. Kept separate from the
 * status so a retired case is still stored and still auditable rather than
 * dropped on the floor, which is what makes a classifier regression visible.
 */
export function isWorkable(status: SurplusClaimStatus): boolean {
  return (
    status !== SurplusClaimStatus.DISTRIBUTED &&
    status !== SurplusClaimStatus.ASSIGNED
  );
}

/**
 * Rank inside the workable set, highest first. This is the "who do I call now"
 * order the board sorts on, and it deliberately does NOT reduce to the dollar
 * tier: a denied $40k case with a live address outranks an open $16k case whose
 * every mailing bounced.
 */
export const CLAIM_STATUS_RANK: Record<SurplusClaimStatus, number> = {
  [SurplusClaimStatus.DENIED]: 5,
  [SurplusClaimStatus.OPEN]: 4,
  [SurplusClaimStatus.GOV_LIEN]: 3,
  [SurplusClaimStatus.PENDING]: 2,
  [SurplusClaimStatus.UNKNOWN]: 1,
  [SurplusClaimStatus.ASSIGNED]: 0,
  [SurplusClaimStatus.DISTRIBUTED]: 0,
};

/** Human label for the board and the work panel. */
export const CLAIM_STATUS_LABEL: Record<SurplusClaimStatus, string> = {
  [SurplusClaimStatus.OPEN]: 'Open, nothing filed',
  [SurplusClaimStatus.GOV_LIEN]: 'Gov lien only',
  [SurplusClaimStatus.DENIED]: 'Claim denied',
  [SurplusClaimStatus.PENDING]: 'Claim pending',
  [SurplusClaimStatus.ASSIGNED]: 'Owner already signed',
  [SurplusClaimStatus.DISTRIBUTED]: 'Paid out',
  [SurplusClaimStatus.UNKNOWN]: 'Unclassified',
};
