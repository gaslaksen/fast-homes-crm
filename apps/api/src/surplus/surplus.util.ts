/**
 * Pure helpers for the Surplus Funds pipeline: the two clocks, the lien
 * waterfall, tier banding, and the compliance gate that decides whether a fee
 * agreement can be sent.
 *
 * Dependency-free on purpose so the importer, the service, and the specs share
 * one implementation of the math that the money depends on.
 */

import {
  SurplusClaimantType,
  SurplusClaimStatus,
  SurplusStage,
  SurplusTier,
} from '@fast-homes/shared';
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_RANK, isWorkable } from './surplus-classify.util';
import {
  ComplianceRule,
  ruleFor,
  RULE_MAX_AGE_DAYS,
  DEFAULT_CLAIM_WINDOW_DAYS,
  ASSIGNMENT_FILING_DAYS,
} from './surplus-compliance';

export interface SurplusLien {
  type: string;
  holder: string;
  amount: number;
  /** Recording order. Only used to break ties inside a governmental class. */
  priority: number;
  /**
   * Governmental units other than federal or ad valorem are paid before
   * nongovernmental claimants, so these come off the top of the waterfall
   * whatever their recording order.
   */
  governmental?: boolean;
}

export interface SurplusFacts {
  saleDate?: Date | string | null;
  surplusType?: string | null;
  fundLocation?: string | null;
  claimantType?: string | null;
  deceased?: boolean | null;
  heirsRequired?: boolean | null;
  competingLien?: boolean | null;
  grossSurplus?: number | null;
  liens?: SurplusLien[] | null;
  noticeDate?: Date | string | null;
  noticeConfirmed?: boolean | null;
  certOfDisbursements?: Date | string | null;
  totalConsideration?: number | null;
  licensedRepId?: string | null;
  disclosures?: Record<string, boolean> | null;
  entitlementVerified?: boolean | null;
  titleSearchComplete?: boolean | null;
  stage?: string | null;
}

// ─── Dates ──────────────────────────────────────────────────────────────────

function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function asDate(v?: Date | string | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(`${v}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export function addDays(v?: Date | string | null, n = 0): Date | null {
  const d = asDate(v);
  if (!d) return null;
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + n);
  return out;
}

/**
 * Days since the property sold at auction.
 *
 * A separate clock from the notice, and the one the team counts in practice:
 * the sale is a hard, published date on every case, whereas the notice date has
 * to be read off a scanned letter and is an estimate wherever that read failed.
 * Older sales are colder, and a case that sold two years ago has usually been
 * worked by somebody else already.
 */
export function daysSinceSale(lead: SurplusFacts & { saleDate?: Date | string | null }, now = new Date()): number | null {
  const d = asDate(lead.saleDate);
  return d ? dayDiff(startOfToday(now), d) : null;
}

/** Days since the notice was mailed. null when there is no notice date. */
export function noticeAge(lead: SurplusFacts, now = new Date()): number | null {
  const d = asDate(lead.noticeDate);
  return d ? dayDiff(startOfToday(now), d) : null;
}

/**
 * The claim window runs from the MAILED NOTICE of surplus, not from the sale.
 * When the notice date is unconfirmed this is a guess, and every surface that
 * shows it says so rather than presenting a confident number.
 */
export function claimDeadline(lead: SurplusFacts): Date | null {
  const rule = ruleFor(lead.surplusType, lead.fundLocation);
  const win = rule?.claimWindowDays ?? DEFAULT_CLAIM_WINDOW_DAYS;
  return lead.noticeDate ? addDays(lead.noticeDate, win) : null;
}

export function daysRemaining(lead: SurplusFacts, now = new Date()): number | null {
  const dl = claimDeadline(lead);
  return dl ? dayDiff(dl, startOfToday(now)) : null;
}

export function windowElapsedPct(lead: SurplusFacts, now = new Date()): number {
  const rem = daysRemaining(lead, now);
  if (rem === null) return 0;
  const rule = ruleFor(lead.surplusType, lead.fundLocation);
  const win = rule?.claimWindowDays ?? DEFAULT_CLAIM_WINDOW_DAYS;
  return Math.max(0, Math.min(100, ((win - rem) / win) * 100));
}

/**
 * A separate clock from the claim window: the assignment has to be filed within
 * 60 days of the certificate of disbursements. Missing this does not lose the
 * claim, it loses our right to be paid out of it.
 */
export function assignmentDeadline(lead: SurplusFacts): Date | null {
  return lead.certOfDisbursements
    ? addDays(lead.certOfDisbursements, ASSIGNMENT_FILING_DAYS)
    : null;
}

export function assignmentDaysLeft(lead: SurplusFacts, now = new Date()): number | null {
  const dl = assignmentDeadline(lead);
  return dl ? dayDiff(dl, startOfToday(now)) : null;
}

/**
 * Context on whether the surplus figure can still move, NOT our deadline. A
 * previous owner is exempt from the 120 day bar under FS 197.582, so this never
 * gates outreach timing; it only says whether another lienholder can still
 * appear and shrink the payout.
 */
export function lienWindowOpen(lead: SurplusFacts, now = new Date()): boolean {
  const age = noticeAge(lead, now);
  return age !== null && age <= 120;
}

// ─── The waterfall ──────────────────────────────────────────────────────────

/** Governmental liens first, then recording order inside each class. */
export function sortedLiens(lead: SurplusFacts): SurplusLien[] {
  return (lead.liens || [])
    .slice()
    .sort(
      (a, b) =>
        (b.governmental ? 1 : 0) - (a.governmental ? 1 : 0) ||
        (a.priority || 0) - (b.priority || 0),
    );
}

export function totalLiens(lead: SurplusFacts): number {
  return (lead.liens || []).reduce((s, l) => s + (l.amount || 0), 0);
}

export function netToClaimant(lead: SurplusFacts): number {
  return Math.max(0, (lead.grossSurplus || 0) - totalLiens(lead));
}

/** The fee at the governing cap, or null when no cap is confirmed for this regime. */
export function estFee(lead: SurplusFacts): number | null {
  const rule = ruleFor(lead.surplusType, lead.fundLocation);
  if (!rule || rule.feeCap == null) return null;
  return Math.round(netToClaimant(lead) * (rule.feeCap / 100));
}

/**
 * The cap is measured against TOTAL consideration, not the line item labelled
 * "fee", because 45.033(3)(d) reaches anything paid or payable, earned or
 * expected. Both percentages are computed and the STRICTER one governs, so a
 * deal cannot be structured under the cap on gross while breaching it on net.
 */
export function consideration(lead: SurplusFacts): number {
  return lead.totalConsideration || 0;
}

export function pctOfGross(lead: SurplusFacts): number {
  return lead.grossSurplus ? (consideration(lead) / lead.grossSurplus) * 100 : 0;
}

export function pctOfNet(lead: SurplusFacts): number {
  const n = netToClaimant(lead);
  return n ? (consideration(lead) / n) * 100 : 0;
}

export function governingPct(lead: SurplusFacts): number {
  return Math.max(pctOfGross(lead), pctOfNet(lead));
}

// ─── Banding and routing ────────────────────────────────────────────────────

/** Either flag means the claim needs letters and a death certificate to file. */
export function isDeceased(lead: SurplusFacts): boolean {
  return !!(lead.deceased || lead.heirsRequired);
}

export function tierOf(lead: SurplusFacts): SurplusTier {
  const surplus = lead.grossSurplus || 0;
  const dead = isDeceased(lead);
  if (surplus >= 25000 && !dead && !lead.competingLien) return SurplusTier.A;
  if (surplus >= 10000 && surplus < 25000 && !dead) return SurplusTier.B;
  if (surplus >= 25000 && dead) return SurplusTier.C;
  return SurplusTier.UNBANDED;
}

/**
 * Who to call now, as one number, highest first.
 *
 * This exists because "Tier A" does not answer the question. Tier bands the
 * DOLLARS, and a $40k case whose owner already signed with a competitor is
 * worth nothing while a $16k case with a denied heir and a live mobile is worth
 * calling this morning. The board sorts on this and shows workReason() beside
 * it, so the order is auditable rather than a mystery ranking.
 *
 * Weights are deliberately coarse and separated by an order of magnitude, so
 * claim status dominates contactability, contactability dominates money, and
 * money only breaks ties. Anything the team cannot act on scores zero.
 */
export interface WorkFacts {
  claimStatus?: string | null;
  netToClaimant?: number | null;
  cleanPhoneCount?: number | null;
  mailVerdict?: string | null;
  daysRemaining?: number | null;
  contactMismatch?: boolean | null;
  doNotCall?: boolean | null;
}

export function workScore(f: WorkFacts): number {
  const status = (f.claimStatus || SurplusClaimStatus.UNKNOWN) as SurplusClaimStatus;

  // Nothing to do here. A paid-out or already-assigned case is not a lead, and
  // a do-not-call lead is not one either whatever the docket says.
  if (!isWorkable(status) || f.doNotCall) return 0;

  let score = (CLAIM_STATUS_RANK[status] ?? 0) * 100;

  // Can we actually reach them. On a surplus file this is most of the triage:
  // the owner moved years ago and the record address is usually dead.
  if ((f.cleanPhoneCount || 0) > 0) score += 40;
  if (f.contactMismatch) score -= 20;
  if (f.mailVerdict === 'delivered') score += 10;
  else if (f.mailVerdict === 'mixed') score += 5;

  // The clock. A previous owner is exempt from the 120 day bar, so this is
  // urgency, not a cliff.
  //
  // The bonus applies only to a window still OPEN. A window that closed months
  // ago is not urgent, it is settled: no new lienholder can appear, so the
  // surplus figure is final. Without the `d > 0` guard every long-closed case
  // scored as if it were about to expire, which put the stalest leads on the
  // board at the top of the call list.
  const d = f.daysRemaining;
  if (d != null && d > 0 && d <= 30) score += 15;
  else if (d != null && d > 0 && d <= 60) score += 8;

  // Money breaks ties and never leads. Capped so one huge case cannot outrank
  // a whole band of workable ones.
  score += Math.min(10, Math.max(0, (f.netToClaimant || 0) / 10000));

  return Math.round(score * 10) / 10;
}

/** One line saying why this lead sits where it does. Shown on the card. */
export function workReason(f: WorkFacts): string {
  const status = (f.claimStatus || SurplusClaimStatus.UNKNOWN) as SurplusClaimStatus;
  if (!isWorkable(status)) return CLAIM_STATUS_LABEL[status];
  if (f.doNotCall) return 'Marked do not call';

  const bits: string[] = [CLAIM_STATUS_LABEL[status]];
  if ((f.cleanPhoneCount || 0) > 0) {
    bits.push(`${f.cleanPhoneCount} callable number${f.cleanPhoneCount === 1 ? '' : 's'}`);
  } else if (f.contactMismatch) {
    bits.push('skip trace returned somebody else');
  } else {
    bits.push('no callable number yet');
  }
  if (f.mailVerdict === 'undeliverable') bits.push('clerk mail all returned');
  const d = f.daysRemaining;
  if (d != null && d > 0 && d <= 30) bits.push(`${d} days left on the lien window`);
  else if (d != null && d <= 0) bits.push('lien window closed, so the surplus figure is final');
  return bits.join(', ');
}

export type DripTrack = 'Heir/Estate' | 'Urgent' | 'Compressed' | 'Standard';

/** Which drip a lead belongs on, driven by the clock and by who the claimant is. */
export function dripTrack(lead: SurplusFacts, now = new Date()): DripTrack {
  if (isDeceased(lead)) return 'Heir/Estate';
  const d = daysRemaining(lead, now);
  if (d === null) return 'Standard';
  if (d < 30) return 'Urgent';
  if (d <= 60) return 'Compressed';
  return 'Standard';
}

/**
 * A hard manual gate on advancing to Agreement Signed, so a stage change cannot
 * skip past entitlement, the notice date, or the title search.
 */
export function canQualify(lead: SurplusFacts): boolean {
  return !!(lead.entitlementVerified && lead.noticeConfirmed && lead.titleSearchComplete);
}

// ─── The gate ───────────────────────────────────────────────────────────────

export interface ComplianceVerdict {
  rule: ComplianceRule | null;
  /** Each of these stops a contract from being sent. */
  blocks: string[];
  /** Worth showing on the card, but does not stop a send. */
  warns: string[];
  clear: boolean;
}

export function complianceGate(lead: SurplusFacts, now = new Date()): ComplianceVerdict {
  const rule = ruleFor(lead.surplusType, lead.fundLocation);
  const blocks: string[] = [];
  const warns: string[] = [];

  if (!rule) {
    blocks.push('No compliance rule on file for this surplus type and fund location.');
    return { rule: null, blocks, warns, clear: false };
  }

  // A stale table fails closed. Statutes move and this one is already known to
  // have unsettled corners, so an un-rechecked rule is not a rule.
  const verified = asDate(rule.lastVerified);
  const age = verified ? dayDiff(startOfToday(now), verified) : null;
  if (age === null || age > RULE_MAX_AGE_DAYS) {
    blocks.push(
      `Compliance rules were last verified ${age === null ? 'never' : `${age} days ago`}, over the ${RULE_MAX_AGE_DAYS} day limit.`,
    );
  }

  if (rule.feeCap == null) {
    blocks.push('No confirmed fee cap for this regime, so a contract cannot be sent.');
  } else if (consideration(lead) > 0 && governingPct(lead) > rule.feeCap) {
    blocks.push(
      `Total consideration is ${governingPct(lead).toFixed(1)}% against the ${rule.feeCap}% cap.`,
    );
  }

  if (rule.licenseRequired && !lead.licensedRepId) {
    blocks.push(
      "Funds have escheated to the state. A registered claimant's representative is required and none is assigned.",
    );
  }

  const missing = (rule.requiredDisclosures || []).filter((d) => !(lead.disclosures || {})[d]);
  if (missing.length) {
    blocks.push(
      `Contract is missing ${missing.length} required disclosure${missing.length === 1 ? '' : 's'}.`,
    );
  }

  if (rule.capConfidence === 'ambiguous') {
    warns.push(
      'Fee cap for this regime is unsettled. 12% is our conservative default, not a confirmed number.',
    );
  }
  if (rule.capConfidence === 'unverified') {
    warns.push('Fee cap for this regime is unverified.');
  }

  const ad = assignmentDaysLeft(lead, now);
  if (ad !== null && ad <= 14) {
    warns.push(
      ad < 0
        ? `Assignment filing deadline passed ${Math.abs(ad)} days ago.`
        : `Assignment must be filed within ${ad} days of today.`,
    );
  }

  if (!lead.noticeConfirmed) {
    warns.push('Notice date is not confirmed, so the claim clock is an estimate.');
  }

  return { rule, blocks, warns, clear: blocks.length === 0 };
}

// ─── Ingestion helpers ──────────────────────────────────────────────────────

/**
 * Dedupe key: county | case-or-parcel | claimant. A single sale can produce
 * several claimants against one surplus (an owner and two lienholders) and each
 * is its own lead, so the case alone would collapse them.
 *
 * The parcel stands in when a list ships no case number, which clerk exports
 * often do not. Without that fallback one owner holding two properties in the
 * same county collapses into a single lead and the second surplus disappears.
 */
export function surplusUidOf(o: {
  county?: string | null;
  caseNumber?: string | null;
  parcelId?: string | null;
  claimant?: string | null;
}): string {
  const norm = (v?: string | null) =>
    String(v || '').toUpperCase().replace(/\s+/g, '_').trim();
  const property = norm(o.caseNumber) || norm(o.parcelId);
  const base = `${norm(o.county)}|${property}|${norm(o.claimant)}`;
  return base === '||' ? '' : base.slice(0, 160);
}

/**
 * Does a skip trace's returned name actually belong to the claimant?
 *
 * This is a gate, not a nicety. Vendor lists come back with `matched: true` on
 * rows where the returned person is a complete stranger: a Marion County export
 * sampled 2026-08-19 had 3 of 11 matched rows return a different name entirely,
 * carrying 14 phone numbers between them. Attaching those to the claimant means
 * calling an uninvolved person about someone else's money, which is a wrong
 * party TCPA problem and a privacy problem in one.
 *
 * Surnames are compared, not full names. A trace routinely returns a spouse,
 * an adult child, or a maiden name at the same household, and those are the
 * right household to reach; a different surname is not. Any shared surname
 * token counts, so "Smith-Jones" still matches "Jones".
 *
 * Returns true when nothing was returned to check: an empty trace attaches no
 * contacts anyway, and calling that a mismatch would be misleading.
 */
export function nameMatchesClaimant(
  claimantLast?: string | null,
  tracedLast?: string | null,
): boolean {
  const tokens = (v?: string | null) =>
    String(v || '')
      .toLowerCase()
      // Apostrophes and periods are dropped rather than split on, so O'Brien
      // still matches a vendor that returned OBrien. Spaces and hyphens do
      // split, so Smith-Jones matches Jones.
      .replace(/['\u2019.]/g, '')
      .split(/[^a-z]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);

  const traced = tokens(tracedLast);
  if (!traced.length) return true; // nothing came back, nothing to reject

  const claimant = tokens(claimantLast);
  if (!claimant.length) return false; // cannot vouch for it, so do not

  return traced.some((t) => claimant.includes(t));
}

/** Surname out of "HILL TAMMIE LEE" or "Tammie Hill". Best effort. */
export function surnameOf(first?: string | null, last?: string | null): string {
  const l = String(last || '').trim();
  if (l) return l;
  const parts = String(first || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';
}

export function claimantTypeFromText(raw?: string | null): SurplusClaimantType {
  const s = String(raw || '');
  if (/lien|mortgagee|judgment\s*creditor/i.test(s)) return SurplusClaimantType.LIENHOLDER;
  if (/heir|estate|deceas|personal\s*rep/i.test(s)) return SurplusClaimantType.HEIR_ESTATE;
  return SurplusClaimantType.PREVIOUS_OWNER;
}

export function stageFromText(raw?: string | null): SurplusStage {
  const s = String(raw || '').toLowerCase();
  if (s.includes('paid')) return SurplusStage.PAID;
  if (s.includes('filed')) return SurplusStage.CLAIM_FILED;
  if (s.includes('notariz')) return SurplusStage.ASSIGNMENT_NOTARIZED;
  if (s.includes('signed') || s.includes('agreement')) return SurplusStage.AGREEMENT_SIGNED;
  if (s.includes('dead')) return SurplusStage.DEAD;
  if (s.includes('contact')) return SurplusStage.CONTACTED;
  return SurplusStage.NEW;
}
