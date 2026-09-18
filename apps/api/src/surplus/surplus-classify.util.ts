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
   * A payout to ONE claimant, named in the title. Pinellas files "Surplus
   * Payout Government" and "Surplus Payout Interested Party" and keeps the
   * case ACTIVE with the remaining balance posted, so one of these is a slice
   * leaving, not the end of the case. To a government claimant it is a lien
   * paid; to anybody else it is a distribution unless the adapter says the
   * county pays out in parts.
   */
  | 'payout'
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
  /** ISO filing date, where the county publishes one. Dates the mail verdict. */
  filedAt?: string | null;
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
  // Alachua's clerk files correspondence and reviews under names that contain
  // "claim": "Email to claimant ...", "Review of Claim filed by Josephine
  // Belk's Claim", "Fuss Peter Waiver of Claim", "Patriot Cash Recover Email
  // they intend to file a claim", "In wrong file winter investors llc reg mail
  // returned". None is a claim, a denial or a mailing.
  {
    kind: 'other',
    re: /^(?:corrected\s+)?email\b|\bemail\s+(?:to|from|exchange)\b|^review\s+of\b|\bwaiver\b|^in\s+wrong\s+file|letter\s+to\s+claimant|intend\s+to\s+file/i,
    seenIn: 'Alachua',
  },
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
    re: /photo\s*id|notary\s*verification|^verification$|^communication$|w-?9|\bdl\b|driver'?s?\s*licen|copy\s*of\s*id/i,
    seenIn: 'Duval, Pinellas',
  },
  // Lake files the clerk's paperwork around each claim under the claim's own
  // name: "Surplus Claim Acknowledgement" (also Acknowledgment, Acknowlegement,
  // and an "... Email"), "Surplus Claim & Attachments", "Surplus Claim
  // Correspondence". Counted as claims, 03171-2023 read seven claims as
  // fourteen. The "Determination" filed beside a denial is the letter, not a
  // second ruling.
  {
    kind: 'claim_attachment',
    re: /^surplus\s*claim\s*(?:ackno\w*|correspondence|email|&\s*attachments|attachments)/i,
    seenIn: 'Lake',
  },
  { kind: 'other', re: /^surplus\s*claim\s*determination/i, seenIn: 'Lake' },
  // Santa Rosa: "2025202 UPDATED CLAIM TO SURPLUS.pdf" re-files a claim
  // already on the docket and names nobody.
  { kind: 'claim_attachment', re: /^\d*\s*updated\s+claim\b/i, seenIn: 'Santa Rosa' },
  // Payouts off the top to the applicant and the tax collector. Present on
  // every Duval case including ones with no claim at all.
  {
    kind: 'routine_disbursement',
    re: /\b(applicant|tax\s*collector)\s*disbursement\b/i,
    seenIn: 'Duval',
  },
  // Hernando's "Check Request" is the clerk raising a check. It sits on 18
  // cases, 11 of them beside "Claims Filed" and 7 with no claim at all, and
  // the county keeps posting the full surplus either way. Read as a
  // distribution it would retire those 7 live cases on no evidence, so it is
  // the routine kind: it never closes a case, and the claim beside it is what
  // speaks.
  { kind: 'routine_disbursement', re: /^check\s*request$/i, seenIn: 'Hernando' },
  // A "labels" sheet is the page of mailing labels the clerk prints beside a
  // letter. Lee's SURPLUS_LETTER_LABELS is one page, 1 KB, and draws nothing,
  // but it contains "SURPLUS_LETTER" and is filed seconds after the real
  // letter, so without this trap it becomes the operative notice.
  { kind: 'other', re: /_labels\b|labels\s*available/i, seenIn: 'Lee' },
  // Polk re-mails copies of the surplus letter months later ("SURPLUS LETTER
  // - Mailed out copies from Cathedral"). Counting that as the notice would
  // move the 120 day clock to the copy's date.
  { kind: 'other', re: /mailed\s*out\s*copies/i, seenIn: 'Polk' },
  // Polk files the sheriff's fee check as "SHERIFF SERVICE FEE- CHECK", which
  // contains "sheriff service" and is a payment, not a return of service.
  { kind: 'other', re: /sheriff\s*service\s*fee/i, seenIn: 'Polk' },
  // The clerk's fee receipt, filed beside a claim. Exactly "Receipt" on Lee;
  // Duval's "RealAuction Payment Receipt" is the BIDDER's receipt, sits on
  // every case, and must stay 'other'.
  { kind: 'receipt', re: /^receipt$/i, seenIn: 'Lee' },
  // Sarasota's clerk files a Request for Legal Review (RFLR) for every claim.
  // Beside a government lienholder it is that lien; beside a waiver it is the
  // lienholder stepping back; otherwise it accompanies a claim and, like Lee's
  // fee receipt, stands for one the docket has not indexed yet. Before the
  // claim rules, since "RFLR - Additional Claim - Burt Berger" contains
  // "claim" and would count Burt Berger twice.
  { kind: 'gov_lien_claim', re: /^(?:rflr|request\s*for\s*legal\s*review)\b.*government/i, seenIn: 'Sarasota' },
  { kind: 'other', re: /^(?:rflr|request\s*for\s*legal\s*review)\b.*waiver/i, seenIn: 'Sarasota' },
  { kind: 'receipt', re: /^(?:rflr\b|request\s*for\s*legal\s*review)/i, seenIn: 'Sarasota' },
  // Citrus files "Tax Deed Returned Undeliverable" and "Recorded Tax Deed
  // Returned Undeliverable". That is the recorded DEED coming back from the
  // winning bidder's address, not the clerk's notice coming back from the
  // owner's, and reading it as a dead owner address would send a claimant we
  // can reach to the skip trace instead of the phone.
  { kind: 'other', re: /tax\s*deed\s*returned/i, seenIn: 'Citrus' },
  // "RETURNED MAIL UNCLAIMED" contains "claim". Mail rules run before claim rules.
  //
  // RTS is "return to sender" in any form, including a green card that came
  // back unsigned ("GREEN CARD RTS"), so it runs before the delivered rule.
  { kind: 'mail_undeliverable', re: /\brts\b/i, seenIn: 'Brevard' },
  // Delivered runs before the general undeliverable rule because "CERTIFIED
  // MAIL RETURNED SIGNED" and "CERTIFIED MAIL RETURN RECEIPT" both contain
  // "mail return", which the next rule reads as a bounce.
  {
    kind: 'mail_delivered',
    // Alachua scans the signed green card as "... signature CM".
    re: /mail\s*delivered|returned\s*signed|return(?:ed)?\s*receipt|green\s*card|proof\s*of\s*delivery|\bsignature\b/i,
    seenIn: 'Duval, Polk, Brevard, Alachua',
  },
  {
    kind: 'mail_undeliverable',
    // Duval ships three spellings of this on the same docket:
    // "Certified Mail Undelieverd", "Regular Mail Undelievered",
    // "Certified Mail Undelivered". Match the mangled stem, not the word.
    // Brevard adds "CERTIFIED MAIL RETURN X2", "REGULAR MAIL RETURNED x 5"
    // and "CERIFIED MAIL RETURNED".
    // Pinellas files USPS "Unclaimed Mail" beside "Returned Mail Surplus".
    // Lake adds "Returned Surplus Mail" and filenames that name the recipient.
    // Alachua: "lytle pearl returned CM", "dewey diane elaine CM returned",
    // "geraldine platt heirs rtnd CM", "ford nick reg mail returned",
    // "williams lavoria c reg mail retuned", "Sanders Shirley.reg returned mail".
    re: /undeliver|undelieve|unable\s*to\s*forward|returned\s*(?:certified\s*|regular\s*|surplus\s*|reg\.?\s*)?mail|\bmail\s*return(?:ed)?\b|unclaimed\s*mail|vacant|no\s*such\s*number|attempted\s*-?\s*not\s*known|\breturned\s*cm\b|\bcm\s*returned\b|\br(?:e)?t(?:u)?r?nd\s*cm\b|\breg\.?\s*mail\s*ret(?:urned|uned)\b|\breg\.?\s*returned\s*mail\b|\b(?:returned|rtn)\b(?:\s+[a-z]+){0,3}?\s+mail\b/i,
    seenIn: 'Duval, Brevard, Polk, Pinellas, Lake',
  },
  {
    kind: 'sheriff_not_served',
    re: /returned\s*not\s*served|not\s*served\s*sheriff/i,
    seenIn: 'Duval',
  },
  // Brevard also files "RETURN OF SEVICES" and "RETURN OF SERVICES".
  { kind: 'sheriff_served', re: /return\s*of\s*se(?:r)?vices?/i, seenIn: 'Duval, Brevard' },
  // Lee files the sheriff's return as "Sheriff's Service" with an ROS filename.
  // Service is at the PROPERTY and says nothing about the owner's mailing
  // address, which is why the mail verdict ignores this kind entirely.
  { kind: 'sheriff_served', re: /sheriff'?s?\s*service|\bros\b/i, seenIn: 'Lee' },

  // ── The money moving. Checked before claims so a distributed case is never
  //    reported as merely contested. ──────────────────────────────────────────
  // Alachua's paperwork around money that is not the surplus leaving: the
  // bid deposit, the applicant's and tax collector's refunds, and the memo
  // that explains a partial payout. Read as a named disbursement, the memo
  // marked five live cases paid out.
  {
    kind: 'routine_disbursement',
    re: /disbursement\s*memo|bid\s*deposit|\brefu?n?d\b|refund/i,
    seenIn: 'Alachua',
  },
  // "ob.clm disburse.richardson earl check": one owner's claim paid.
  { kind: 'payout', re: /ob\.?\s*clm\.?\s*disburse/i, seenIn: 'Alachua' },
  // One claimant paid. Pinellas 2023-08057 carries "Surplus Payout Government"
  // and still lists $58,531 ACTIVE; 2022-07634 carries a payout to an
  // interested party and still lists $57,950. Neither is the money gone.
  { kind: 'payout', re: /surplus\s*payout/i, seenIn: 'Pinellas' },
  {
    kind: 'distribution',
    re: /surplus\s*(distribution|breakdown)|distribution\s*of\s*surplus/i,
    seenIn: 'Duval',
  },
  // Alachua: "rejection letter re surplus claim".
  { kind: 'denial', re: /denial|denied|\breject(?:ion|ed)?\b/i, seenIn: 'Duval, Alachua' },

  // ── Claims. Governmental first, since a city lien is not a competitor: it
  //    takes a slice off the top and the owner can still claim the residual. ──
  {
    kind: 'gov_lien_claim',
    re: /ad\s*valorem|homestead\s*lien|code\s*enforc|municipal\s*lien|utilit/i,
    seenIn: 'Duval',
  },
  {
    kind: 'claim',
    // Alachua ends the title with it: "walker adrian surplus claim", "Young
    // Rose claim", "City of Gainesville Amended Claim.pdf", "... Claim 3".
    // Santa Rosa: "CLAIM TO SURPLUS - NAME", misspelt SUPLUS and SUPRLUS.
    re: /claim\s*to\s*su[a-z]{3,5}\b|submitted\s*claim|statement\s*of\s*claim|statment\s*of\s*claim|state\s*of\s*claim|statement\s*claim|surplus\s*claims?\s*received|surplus\s*claim|surplus\s*\/\s*claims?\s*document|claim\s*to\s*receive|\bclaim(?:\s+\d+)?(?:\.pdf)?\s*$/i,
    seenIn: 'Duval, Lee, Brevard, Alachua, Polk',
  },

  // Hernando files every claim into one folder titled exactly "Claims Filed",
  // on 22 of its 43 live cases. It names nobody, so the case reads as claimed
  // by somebody unnamed, which is enough to keep us off it.
  { kind: 'claim', re: /^claims?\s*filed$/i, seenIn: 'Hernando' },

  // ── Context signals ───────────────────────────────────────────────────────
  // Hernando titles the notice exactly "Surplus" (42 of 43 cases) and Citrus
  // files it through its mail house as "QUADIENT: Surplus PDF (161)". Both are
  // the scanned Notice of Surplus Funds the vision reader then reads.
  { kind: 'notice_surplus', re: /^surplus$|^quadient:\s*surplus\b/i, seenIn: 'Hernando, Citrus' },
  { kind: 'notice_surplus', re: /notice\s*of\s*surplus|surplus[_\s]*letter/i, seenIn: 'Duval, Lee' },
  // Alachua: "Pet summ admin - martin harmon estate.pdf", "Est of Diane Dewey
  // Petition for Administration", "order on petition".
  {
    kind: 'probate',
    re: /probate|death\s*cert|letters\s*of\s*administration|summ(?:ary)?\.?\s*admin|petition\s+for\s+administration|order\s+on\s+petition/i,
    seenIn: 'Duval, Alachua',
  },
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

/**
 * A disbursement titled only with a NAME. Brevard files the tax deed
 * applicant's refund as "MERCURY FUNDING LLC DISBURSEMENT" two to nine days
 * after the surplus letter, and would file a payout to a claimant the same
 * way. Two things separate them. The applicant's name, when the county lists
 * it. Failing that, order: a disbursement filed after a claim is the money
 * leaving; one filed before any claim is the routine refund off the top. A
 * distribution is terminal, so guessing wrong in that direction retires a
 * live lead, and guessing wrong the other way keeps calling about paid money.
 * Mutates the ledger in place.
 */
function resolveNamedDisbursements(ledger: ClassifiedDoc[], applicants: string[]): void {
  const applicantTokens = applicants
    .flatMap((a) => String(a || '').toUpperCase().replace(/[.,]/g, ' ').split(/\s+/))
    .filter((t) => t.length > 2 && !/^(LLC|INC|CORP|CO|THE|AND|OF)$/.test(t));
  const firstClaimAt = ledger
    .filter((d) => d.kind === 'claim' && d.filedAt)
    .map((d) => d.filedAt as string)
    .sort()[0];

  for (const d of ledger) {
    if (d.kind !== 'other' || !/disburse?ment/i.test(d.title)) continue;
    const tokens = d.title.toUpperCase().replace(/[.,]/g, ' ').split(/\s+/);
    if (applicantTokens.length && tokens.some((t) => t.length > 2 && applicantTokens.includes(t))) {
      d.kind = 'routine_disbursement';
    } else if (firstClaimAt && d.filedAt && d.filedAt > firstClaimAt) {
      d.kind = 'distribution';
    } else {
      d.kind = 'routine_disbursement';
    }
  }
}

// ─── Claimant reading, where the source gives us one ────────────────────────

/** A claimant that is a unit of government takes a slice, it is not a competitor. */
const GOVERNMENT =
  /\b(city|county|state|town|code\s*enforc|utilit|clerk|sheriff|tax\s*collector|dept|department|district|authority|government|gvernment|revenue|child\s*support)\b/i;
/** A claimant that reads like a recovery shop or a law firm is a competitor. */
const COMPETITOR = /\b(llc|l\.l\.c|inc|law|recovery|group|funding|capital|partners|services|associates)\b/i;
/**
 * "GG ELITE SERVICES LLC As ASSIGNEE of SUSAN D WRIGHT" is the shape that means
 * the owner has ALREADY SIGNED with somebody else. It is terminal in a way a
 * plain competitor claim is not: a lienholder claim leaves the owner residual
 * available, an assignment does not.
 */
// Sarasota adds the owner's own representatives: "Kenna Mayhew as POA for
// James Lehan", "Angela DeLong as PR for the Estate of William Everett Lehan",
// "Ingrum Law Firm LLC Personal Representative Estate of Jimmy Don Berger".
const ASSIGNEE =
  /\bas\s+assignee\s+of\b|\bassignee\s+of\b|\b(?:on\s+)?behalf\s+of\b|\bo\/?b\/?o\b|\bas\s+(?:poa|power\s+of\s+attorney|pr|personal\s+representative|guardian|trustee)\s+(?:for|of)\b|\bpersonal\s+representative\s+(?:of\s+)?(?:the\s+)?estate\s+of\b/i;

export type ClaimantClass = 'assignee' | 'government' | 'competitor' | 'owner' | 'unknown';

export function classifyClaimant(claimant?: string | null, owners: string[] = []): ClaimantClass {
  const c = String(claimant || '').trim();
  if (!c) return 'unknown';
  const surnames = owners
    .flatMap((o) => String(o || '').toUpperCase().replace(/[.,]/g, ' ').split(/\s+/))
    .filter((t) => t.length > 2 && !/^(JR|SR|II|III|IV|THE|ESTATE|LLC|INC|TRUST)$/.test(t));
  const namesOwner = (s: string) =>
    surnames.length &&
    s.toUpperCase().replace(/[.,]/g, ' ').split(/\s+/).some((t) => t.length > 2 && surnames.includes(t));
  if (ASSIGNEE.test(c)) {
    // "PLUTO ASSET RECOVERY INC ON BEHALF OF MAI T PHAM" on a case owned by
    // Marquil Hixon (Pinellas 2022-07634) is a recovery shop acting for some
    // OTHER party, which is competition for the residual, not the owner having
    // signed it away. Terminal only when the principal is the owner. Without an
    // owner list there is nothing to check against, so the old reading stands.
    const principal = c.split(ASSIGNEE).pop() || '';
    return !surnames.length || namesOwner(principal) ? 'assignee' : 'competitor';
  }
  if (GOVERNMENT.test(c)) return 'government';
  if (namesOwner(c)) return 'owner';
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
  counts: Record<'claims' | 'denials' | 'distributions' | 'govLiens' | 'notices' | 'receipts' | 'payouts', number>;
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
    /**
     * The tax deed applicants of record. Brevard files the applicant's refund
     * as "<APPLICANT> DISBURSEMENT" with no other marker, and a payout to a
     * claimant would be filed the same way, so the name decides.
     */
    applicants?: string[];
    /**
     * The county pays claimants one at a time and keeps the case open with
     * the remaining balance posted, so a payout to a private claimant is a
     * slice gone, not the end. TRUE on Pinellas, whose list row carries the
     * live balance and whose COMPLETED status is what retires the case. FALSE
     * everywhere a distribution filing closes the file.
     */
    payoutsArePartial?: boolean;
    /**
     * Titles the county files as an empty category folder on every case, which
     * therefore say nothing. Citrus files "Returned Mail", "Additional Taxes"
     * and "APPLICATION" on all 147 of its live cases; read literally, its
     * returned mail folder marks every Citrus claimant unreachable.
     */
    categoryFolders?: string[];
    /**
     * The county publishes no claim document at all, so a bare docket is not
     * evidence that nobody has filed. Citrus. The verdict stays open, because
     * an unworked case is the likeliest reading and a pending one would hide
     * every Citrus lead, but the reason says plainly that a competing claim
     * would be invisible here.
     */
    claimsNotPublished?: boolean;
  } = {},
): CaseClassification {
  const folders = (opts.categoryFolders || []).map((f) => f.trim().toUpperCase());
  const ledger = classifyDocuments(
    folders.length ? docs.filter((d) => !folders.includes(String(d.title || '').trim().toUpperCase())) : docs,
  );
  const owners = opts.owners || [];
  resolveNamedDisbursements(ledger, opts.applicants || []);
  const of = (k: SurplusDocKind) => ledger.filter((d) => d.kind === k);

  // A claim FILED BY a unit of government is a government lien whatever the
  // county titled it: Polk's "Surplus Claims Received- POLK COUNTY CLERK OF
  // COURTS" and Brevard's "STATMENT OF CLAIM BAREFOOT BAY RECREATION DISTRICT"
  // take a slice off the top and leave the owner residual open, exactly like
  // Duval's "Surplus - Ad Valorem Homestead Liens". Counting them as competing
  // claims marked those cases contested when nobody is contesting the owner.
  // One claim filed twice is one claim. Alachua scans "gladden doris surplus
  // claim copy" and "gladden doris surplus claim original", and pays each
  // owner with a check and a memo, both titled with the owner's name.
  // Only named documents dedupe; an unnamed claim may be anybody's, and so
  // may one that carries only its category (Pinellas's four "Surplus Claim
  // Government" filings on 2023-00489 are four liens).
  const sameName = (c: ClassifiedDoc) =>
    /^(?:government|gvernment|interested\s*part(?:y|ies)|owner)$/i.test(String(c.claimant || '').trim())
      ? ''
      : String(c.claimant || '')
      .toUpperCase()
      .replace(/\b(?:COPY|ORIGINAL|AMENDED|OF|CHECK|REVISED|PDF|DOCX)\b|\d+/g, ' ')
      .replace(/[^A-Z]/g, '');
  const dedupeNamed = (docs: ClassifiedDoc[]) => {
    const seen = new Set<string>();
    return docs.filter((d) => {
      const k = sameName(d);
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const allClaims = dedupeNamed(of('claim'));
  const claims = allClaims.filter((c) => classifyClaimant(c.claimant, owners) !== 'government');
  const denials = of('denial');
  // A payout to a government unit is that lien satisfied, whatever else is
  // going on. A payout to anybody else is the money leaving, unless the county
  // pays in parts and keeps the case open.
  const payouts = dedupeNamed(of('payout'));
  const govPayouts = payouts.filter((p) => classifyClaimant(p.claimant, owners) === 'government');
  const otherPayouts = payouts.filter((p) => !govPayouts.includes(p));
  const distributions = [...of('distribution'), ...(opts.payoutsArePartial ? [] : otherPayouts)];
  const partialPayouts = opts.payoutsArePartial ? otherPayouts : [];
  const govLiens = [
    ...of('gov_lien_claim'),
    ...allClaims.filter((c) => classifyClaimant(c.claimant, owners) === 'government'),
    ...govPayouts,
  ];
  const notices = of('notice_surplus');
  const receipts = of('receipt');

  const counts = {
    claims: claims.length,
    denials: denials.length,
    distributions: distributions.length,
    govLiens: govLiens.length,
    notices: notices.length,
    receipts: receipts.length,
    payouts: partialPayouts.length,
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
  //
  // Only mail sent AFTER the operative notice counts, where the docket dates
  // its filings. A tax deed case mails several times before the surplus letter
  // (notice of application, sheriff letter, postcard) and on Lee those bounce
  // in January while the surplus letter goes out in March to the clerk's
  // updated addresses, often care of a relative. Counting the January returns
  // condemned 13 of the first 24 Lee addresses the clerk had since corrected.
  // Duval dates nothing, so there every return still counts, as before.
  const operativeNotice = notices[notices.length - 1];
  const since = operativeNotice?.filedAt || null;
  const afterNotice = (d: SurplusDoc) => !since || !d.filedAt || d.filedAt >= since;
  const dead = of('mail_undeliverable').filter(afterNotice).length;
  const live = of('mail_delivered').filter(afterNotice).length;
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
  const paidInPart = partialPayouts.length
    ? ` ${partialPayouts.length} claimant${partialPayouts.length === 1 ? ' has' : 's have'} already been paid a slice; the county still posts a balance.`
    : '';

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
    reason = `A ${receipts[receipts.length - 1].title} is on the docket with no claim document beside it. On this county that filing accompanies a claim, so somebody not yet named has filed.`;
  } else if (govLiens.length) {
    claimStatus = SurplusClaimStatus.GOV_LIEN;
    reason = `Only a governmental lien has filed, which takes a slice off the top. The owner residual is still unclaimed.`;
  } else if (notices.length) {
    claimStatus = SurplusClaimStatus.OPEN;
    reason = opts.claimsNotPublished
      ? 'Notice of surplus mailed. This county does not publish claims, so a competing claim would not show here.'
      : 'Notice of surplus mailed and nothing filed against it.';
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
    reason: reason + paidInPart,
  };
}

// ─── Claimants ──────────────────────────────────────────────────────────────

const NAME_SUFFIX = /\b(JR|SR|II|III|IV|V)\b\.?/g;
/** Pinellas's tax roll abbreviates the estate form to "EST" ("MCGRATH, HARRY A III EST"). */
const ESTATE_MARK = /\b(ESTATE|DECEASED|DECD|EST)\b/g;
/** "L.L. Heath, Trustee" on the deed is "L L HEATH TRE" on the roll: one person. */
const TRUSTEE_MARK = /\b(TRUSTEE|TTEE|TRE|TR)\b/g;
const ESTATE_OF = /^THE\s+ESTATE\s+OF\s+/i;
// Offices and departments too: Pinellas 2023-08057 lists "USA HOUSING & URBAN
// DEV" as an owner, and a name search for a person called USA DEV is a credit
// spent on nobody.
const ENTITY =
  /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|CO|LP|LLP|LLLP|LTD|TRUST|ASSOCIATION|ASSOC|HOMEOWNERS|HOA|CONDOMINIUM|CONDO|INVESTMENTS|ENTERPRISES|PROPERTIES|REALTY|CHURCH|BANK|PARTNERS|HOLDINGS|DEPARTMENT|DEPT|SECRETARY|HOUSING|DEVELOPMENT|DEV|UNITED\s+STATES|USA|COUNTY|CITY\s+OF|STATE\s+OF|AUTHORITY|MORTGAGE|CREDIT\s+UNION|MINISTR(?:Y|IES)|FOUNDATION)\b/i;
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
    // Polk writes the estate form TRAILING ("EVELYN ALTFELD, ESTATE OF") and
    // the tax roll spells the same person surname-first on one line and
    // given-first on the next ("HANKINS PEGGY", "PEGGY HANKINS"). The key is
    // therefore the SORTED tokens, with "ESTATE OF" removed wherever it sits,
    // so both of those pairs are one claimant rather than two leads.
    const core = original
      .toUpperCase()
      .replace(ESTATE_OF, '')
      .replace(/\bESTATE\s+OF\b/g, ' ')
      // "D'ALESSANDRO" and "O'BRIEN" key as one word; "&" and "AND" alike.
      .replace(/['\u2019]/g, '')
      .replace(/&/g, ' AND ')
      .replace(/[.,\-\/]/g, ' ')
      .replace(ESTATE_MARK, ' ')
      .replace(TRUSTEE_MARK, ' ')
      .replace(NAME_SUFFIX, ' ')
      .replace(ENTITY_TAIL, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .sort()
      .join(' ');
    if (!core) continue;

    // "AMERICAN ESTATE & TRUST" is a custodian with ESTATE in its name, not a
    // dead owner. An entity is an estate only when it says "ESTATE OF".
    const deceased =
      (ESTATE_MARK.test(original.toUpperCase()) && !ENTITY.test(original)) ||
      ESTATE_OF.test(original) ||
      /\bESTATE\s+OF\b/i.test(original);
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

  // Spellings of one person the key cannot see, merged pairwise on the same
  // case: a middle name present in one and absent or an initial in the other
  // ("PURDY RICHARD", "RICHARD B. PURDY"; "HUTSON JOHN P", "HUTSON JOHN
  // PATRICK"; "BAGLEY DENISE LYNN", "DENISE BAGLEY"; "PEDULLA CARLO",
  // "PEDULLA GIANCARLO CARLO"), and a surname prefix written with a space
  // ("D ALESSANDRO VITO", "D'ALESSANDRO VITO"). At least two names must match
  // outright, so "J SMITH" never swallows "JANE SMITH" and "JOHN SMITH" never
  // swallows "MARY SMITH".
  const joinedKey = (v: string) =>
    v
      .toUpperCase()
      .replace(/['\u2019]/g, '')
      .replace(/\b([DO])\s+(?=[A-Z]{3,})/g, '$1')
      // Surname particles written apart: "VAN DER LEE ELMA A." beside
      // "VANDERLEE ELMA A" (Sarasota 2026 TD 000057).
      .replace(/\b(VAN|VON|DER|DEN|DE|DEL|LA|LE|DI|DA|DU|MC)\s+(?=[A-Z])/g, '$1')
      .replace(/&/g, ' AND ')
      .replace(/[.,\-\/]/g, ' ')
      .replace(ESTATE_MARK, ' ')
      .replace(NAME_SUFFIX, ' ')
      .replace(ENTITY_TAIL, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .sort()
      .join(' ');
  const samePerson = (ka: string, kb: string): boolean => {
    const a = ka.split(' ');
    const b = kb.split(' ');
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (short.length < 2 || long.length - short.length > 1) return false;
    const pool = [...long];
    let exact = 0;
    let initials = 0;
    for (const t of short) {
      let i = pool.indexOf(t);
      if (i >= 0) exact += 1;
      else {
        i = pool.findIndex((p) => (t.length === 1 && p[0] === t) || (p.length === 1 && t[0] === p));
        if (i >= 0) initials += 1;
      }
      if (i < 0) return false;
      pool.splice(i, 1);
    }
    // Two names outright, or the surname outright and two given names by
    // their initials ("J W SAUL", "JUDSON WALTER SAUL" on Lake 04261-2023).
    return (exact >= 2 || (exact >= 1 && initials >= 2)) && pool.length <= 1;
  };
  let merged = true;
  while (merged) {
    merged = false;
    const entries = [...groups.entries()];
    // The later spelling folds into the earlier, so claimants keep the
    // county's order.
    outer: for (let i = 0; i < entries.length; i += 1) {
      const [ka, a] = entries[i];
      if (a.isEntity) continue;
      const aKeys = new Set([ka, ...a.variants.map(joinedKey)]);
      for (let j = i + 1; j < entries.length; j += 1) {
        const [kb, b] = entries[j];
        if (b.isEntity) continue;
        const bKeys = new Set([kb, ...b.variants.map(joinedKey)]);
        const hit = [...aKeys].some((x) => [...bKeys].some((y) => x === y || samePerson(x, y)));
        if (!hit) continue;
        a.variants.push(...b.variants);
        a.deceased = a.deceased || b.deceased;
        a.name = preferredName(a.variants);
        groups.delete(kb);
        merged = true;
        break outer;
      }
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
  [SurplusClaimStatus.UNKNOWN]: 'Status unknown',
};
