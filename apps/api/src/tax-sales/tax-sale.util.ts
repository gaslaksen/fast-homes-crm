/**
 * Pure helpers for the Tax Sales pipeline: dedupe key, the redemption/equity
 * math, the call-clearance rules, and scoring.
 *
 * Dependency-free on purpose, same as the foreclosure and probate equivalents,
 * so the importer, the service, and the specs can all share them without I/O.
 *
 * NC delinquent tax foreclosures run on two tracks and the difference decides
 * who sells and what deed passes:
 *   In Rem, NCGS 105-375   -> clerk-docketed judgment, Sheriff sells, Sheriff's Deed.
 *   Judicial, NCGS 105-374 -> full civil action, a commissioner sells, Commissioner's Deed.
 * Mecklenburg files in rem in house through the County Attorney and sends
 * judicial files to outside firms.
 */

import {
  TaxSaleMethod,
  TaxSaleStage,
  TaxSaleOccupancy,
  ForeclosurePriority,
} from '@fast-homes/shared';

/** Bidding stays open this many days after the report of sale. */
export const UPSET_DAYS = 10;

/**
 * An upset bid must beat the standing bid by 5% or $750, whichever is greater.
 * This is the floor a new bid has to clear, not the increment.
 */
export function upsetFloor(bid: number): number {
  return Math.max(Math.round(bid * 1.05), bid + 750);
}

/**
 * A DNC scrub goes stale. The working standard is a re-scrub every 31 days,
 * because people register in between, and a scrub older than that does not
 * count as a scrub at all.
 */
export const SCRUB_MAX_DAYS = 31;

/** How far out the sale clock runs before a card just shows "full". */
export const SALE_RUNWAY_DAYS = 90;

/** Allowance for closing and repair applied to the assessed value. */
export const COST_ALLOWANCE_PCT = 0.09;

/**
 * Dedupe key: fileNumber | address. Neither half works alone. One judicial
 * action can cover several parcels, so the file number would collapse them into
 * one lead; and a property that redeems and later falls delinquent again comes
 * back under a new file, so the address would fold the second filing into the
 * first. Falls back to the address when a row carries no file number.
 */
export function taxSaleUidOf(o: { fileNumber?: string | null; address?: string | null }): string {
  const file = normalizeFileNumber(o.fileNumber);
  const addr = String(o.address || '').trim().toUpperCase().replace(/\s+/g, '_');
  const base = `${file}|${addr}`;
  return base === '|' ? '' : base.slice(0, 120);
}

/** File numbers upper-cased and stripped of spaces so spacing never forks a row. */
export function normalizeFileNumber(raw?: string | null): string {
  return String(raw || '').toUpperCase().replace(/\s+/g, '').trim();
}

// ─── Reading free text off a county filing ──────────────────────────────────

/** 'IN_REM' | 'JUDICIAL' from whatever the filing calls it. */
export function methodFromText(raw?: string | null): TaxSaleMethod {
  const s = String(raw || '');
  if (/105-?374|judicial|civil action|commissioner/i.test(s)) return TaxSaleMethod.JUDICIAL;
  return TaxSaleMethod.IN_REM;
}

/** The statute a method files under. Stored, not derived, so an unusual filing survives. */
export function statuteFor(method: string | null | undefined): string {
  return method === TaxSaleMethod.JUDICIAL ? '105-374' : '105-375';
}

/** The deed the buyer takes at the sale. */
export function deedFor(method: string | null | undefined): string {
  return method === TaxSaleMethod.JUDICIAL ? "Commissioner's Deed" : "Sheriff's Deed";
}

export function stageFromText(raw?: string | null): TaxSaleStage {
  const s = String(raw || '');
  if (/redeem/i.test(s)) return TaxSaleStage.REDEEMED;
  if (/upset/i.test(s)) return TaxSaleStage.UPSET_BID_PERIOD;
  if (/sale\s*sched|scheduled|sale\s*date/i.test(s)) return TaxSaleStage.SALE_SCHEDULED;
  return TaxSaleStage.JUDGMENT_DOCKETED;
}

export function occupancyFromText(raw?: string | null): TaxSaleOccupancy {
  const s = String(raw || '');
  if (/owner.?occ|^y$|^yes$/i.test(s)) return TaxSaleOccupancy.OWNER_OCCUPIED;
  if (/vacant/i.test(s)) return TaxSaleOccupancy.VACANT;
  if (/absentee|^n$|^no$/i.test(s)) return TaxSaleOccupancy.ABSENTEE;
  return TaxSaleOccupancy.UNKNOWN;
}

/**
 * "2019, 2020-2022" -> [2019, 2020, 2021, 2022]. The count is the "years
 * delinquent" figure the board filters on, so a range has to be expanded
 * rather than counted as one.
 */
export function parseDelinquentYears(raw?: string | null): number[] {
  const s = String(raw || '');
  const out = new Set<number>();
  for (const part of s.split(/[,;|]/)) {
    const range = /(\d{4})\s*(?:-|–|to)\s*(\d{4})/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to >= from && to - from < 40) for (let y = from; y <= to; y++) out.add(y);
      continue;
    }
    const one = /(\d{4})/.exec(part);
    if (one) out.add(Number(one[1]));
  }
  return Array.from(out).sort((a, b) => a - b);
}

// ─── Clocks ─────────────────────────────────────────────────────────────────

function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Whole days from today to `date`. Negative once it has passed, null with no date. */
export function daysUntil(date?: Date | string | null, now = new Date()): number | null {
  if (!date) return null;
  const then = date instanceof Date ? date : new Date(`${date}T00:00:00`);
  if (isNaN(then.getTime())) return null;
  return Math.ceil((then.getTime() - startOfToday(now).getTime()) / 86400000);
}

/** Whole days since `date`. null with no date. */
export function daysSince(date?: Date | string | null, now = new Date()): number | null {
  const d = daysUntil(date, now);
  return d === null ? null : -d;
}

/** How far along the sale clock is, 0-100, for the card's progress bar. */
export function saleElapsedPct(saleDate?: Date | string | null, now = new Date()): number {
  const d = daysUntil(saleDate, now);
  if (d === null) return 0;
  return Math.max(0, Math.min(100, ((SALE_RUNWAY_DAYS - d) / SALE_RUNWAY_DAYS) * 100));
}

/**
 * The federal calling window is 8am to 9pm in the RECIPIENT's local time.
 * Every county modelled here is Eastern, so server-local Eastern is the check.
 */
export function inCallWindow(now = new Date()): boolean {
  const h = now.getHours();
  return h >= 8 && h < 21;
}

// ─── The money ──────────────────────────────────────────────────────────────

export interface TaxSaleMoney {
  assessedValue?: number | null;
  redemptionAmount?: number | null;
}

/**
 * What is left after the county is paid off. Deliberately not called profit:
 * it is before any repair or resale cost.
 */
export function equityOf(r: TaxSaleMoney): number {
  return Math.max(0, (r.assessedValue || 0) - (r.redemptionAmount || 0));
}

export function equityPctOf(r: TaxSaleMoney): number {
  return r.assessedValue ? Math.round((equityOf(r) / r.assessedValue) * 100) : 0;
}

/** Equity less a flat allowance for closing and repair. */
export function netAfterCosts(r: TaxSaleMoney): number {
  const costs = Math.round((r.assessedValue || 0) * COST_ALLOWANCE_PCT);
  return Math.max(0, (r.assessedValue || 0) - (r.redemptionAmount || 0) - costs);
}

// ─── Calling rules ──────────────────────────────────────────────────────────

export interface TaxSalePhone {
  number: string;
  type?: string | null;
  /** DncRegistry value, or null/undefined when the number came back clean. */
  dnc?: string | null;
}

/** Numbers that are not on any registry. */
export function cleanPhones(phones: TaxSalePhone[]): TaxSalePhone[] {
  return (phones || []).filter((p) => p.number && !p.dnc);
}

export function scrubAgeDays(scrubbedAt?: Date | string | null, now = new Date()): number | null {
  return daysSince(scrubbedAt, now);
}

export function scrubFresh(scrubbedAt?: Date | string | null, now = new Date()): boolean {
  const age = scrubAgeDays(scrubbedAt, now);
  return age !== null && age >= 0 && age <= SCRUB_MAX_DAYS;
}

/**
 * Callable means all three: a number that is not registered, a scrub inside 31
 * days, and nobody having asked us to stop. Anything short of that is a call
 * that should not be made, so this is a gate and not a hint.
 */
export function callable(r: {
  doNotCall?: boolean | null;
  phones: TaxSalePhone[];
  dncScrubbedAt?: Date | string | null;
}, now = new Date()): boolean {
  return !r.doNotCall && scrubFresh(r.dncScrubbedAt, now) && cleanPhones(r.phones).length > 0;
}

/**
 * NCGS 75-120 defines a foreclosure rescue transaction narrowly: the property
 * is the seller's principal residence, the transfer is represented as letting
 * them stay or stopping the foreclosure, AND they keep a tenancy, lease-option
 * or buyback. All three, or it is not one. A plain cash purchase with no option
 * to return is not covered. Owner-occupancy is the trigger worth flagging on a
 * card, because it is the one fact known before anything is offered.
 */
export function rescueRuleApplies(occupancy?: string | null): boolean {
  return occupancy === TaxSaleOccupancy.OWNER_OCCUPIED;
}

/** The four workup items that gate outreach. All four, or the board will not queue a call. */
export const WORKUP_KEYS = ['title', 'owner', 'occupancy', 'drive'] as const;

export function workupComplete(workup: any): boolean {
  const w = workup || {};
  return WORKUP_KEYS.every((k) => !!w[k]);
}

// ─── Scoring ────────────────────────────────────────────────────────────────

export interface TaxSaleScoreInput extends TaxSaleMoney {
  stage?: string | null;
  workStatus?: string | null;
  occupancy?: string | null;
  saleDate?: Date | string | null;
  doNotCall?: boolean | null;
  hasMortgage?: boolean | null;
  hasIrsLien?: boolean | null;
  delinquentYears?: number[] | null;
  tags?: string[] | null;
  phones: TaxSalePhone[];
  emails: string[];
  dncScrubbedAt?: Date | string | null;
}

/**
 * Redemption stops everything, so a small payoff against a big assessed value
 * is the strongest signal here: the owner can plausibly be saved, or the deal
 * can be bought cheap. A mortgage on title cuts the score hard, because the
 * lender usually redeems to protect its own lien and the deal never happens.
 *
 * A lead with no sale date scores the FAR-OUT bucket (+4), not the urgent one.
 * That is a deliberate departure from the prototype, where a missing date fell
 * through a null comparison and scored as if the sale were inside 14 days.
 */
export function scoreOf(r: TaxSaleScoreInput, now = new Date()): number {
  if (r.doNotCall || r.workStatus === 'DEAD' || r.stage === TaxSaleStage.REDEEMED) return 0;

  const d = daysUntil(r.saleDate, now);
  const phones = r.phones || [];
  const emails = (r.emails || []).filter(Boolean);
  const years = (r.delinquentYears || []).length;

  let s = Math.round((equityPctOf(r) / 100) * 38);

  if (d === null) s += 4;
  else if (d <= 14) s += 24;
  else if (d <= 30) s += 18;
  else if (d <= 60) s += 10;
  else s += 4;

  if (r.stage === TaxSaleStage.UPSET_BID_PERIOD) s += 8;

  const clean = cleanPhones(phones).length;
  if (clean) s += 12;
  if (emails.length) s += 7;
  // Every number on file is registered: worse than having none, because the
  // lead looks reachable on a list and is not.
  if (phones.length && !clean) s -= 10;
  if (phones.length && !scrubFresh(r.dncScrubbedAt, now)) s -= 6;

  if (r.occupancy === TaxSaleOccupancy.OWNER_OCCUPIED) s += 6;
  if (years >= 5) s += 5;
  if (r.hasMortgage) s -= 14;
  if (r.hasIrsLien) s -= 8;
  if ((r.tags || []).includes('Heirs required')) s -= 8;

  return Math.max(0, Math.min(100, s));
}

export function priorityOf(score: number): ForeclosurePriority {
  if (score >= 45) return ForeclosurePriority.HIGH;
  if (score >= 15) return ForeclosurePriority.MEDIUM;
  return ForeclosurePriority.LOW;
}

// ─── External links ─────────────────────────────────────────────────────────

export function zillowUrlFor(address: string, city: string, state: string, zip: string): string {
  const q = `${address} ${city} ${state} ${zip}`.trim().replace(/\s+/g, '-');
  return `https://www.zillow.com/homes/${encodeURIComponent(q)}_rb/`;
}

export function realtorQueryFor(address: string, city: string, state: string, zip: string): string {
  return `${address} ${city} ${state} ${zip}`.trim().replace(/\s+/g, '-');
}

/** County GIS. Only the counties actually worked have a parcel viewer on file. */
export function parcelUrlFor(county?: string | null): string | null {
  const c = String(county || '').toLowerCase();
  if (c.includes('mecklenburg')) return 'https://polaris3g.mecklenburgcountync.gov/';
  if (c.includes('union')) return 'https://gis.unioncountync.gov/';
  return null;
}
