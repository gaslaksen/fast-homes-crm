/**
 * Pure helpers for distilling rich property data into investor-relevant facts
 * the AI conversational prompt can reference, plus deal-fit flags that drive
 * the auto-response flow (expectations-setting before handoff).
 *
 * Inputs are typed loosely as `any` because callers pass raw Prisma Lead rows
 * with mixed REAPI/ATTOM JSON blobs. No DB or service dependencies.
 */

export interface DealFitFlags {
  isManufactured: boolean;
  isLeasedLand: boolean;
  askVsArvPct: number | null; // e.g. 0.92 for asking-at-92%-of-ARV
  askIsHighVsArv: boolean; // ≥ 0.85
  askIsAtOrAboveArv: boolean; // ≥ 0.95
  /** Estimated total mortgage debt across all liens (from REAPI mortgage data). */
  mortgageBalance: number | null;
  /** mortgageBalance / arv. */
  mortgageVsArvPct: number | null;
  /** Mortgage balance exceeds a typical investor MAO (≥ 70% of ARV). */
  mortgageExceedsMao: boolean;
  /** Last sale within ~24 months. */
  boughtRecently: boolean;
  /** Bought recently AND paid at-or-near current ARV (≥ 85%) — thin/no equity. */
  recentPurchaseNoEquity: boolean;
  /**
   * Hard money-killers — surface expectations IMMEDIATELY once asking price
   * is known, even if other CAMP fields aren't. Includes: ask at-or-above
   * ARV, mortgage exceeds MAO, or recent-no-equity + high ask.
   */
  dealCannotPencil: boolean;
  hasOpenFitConcern: boolean; // any concern worth surfacing to seller
  /** Human-readable concern strings the AI prompt can reference. */
  concerns: string[];
}

const MFR_RE = /manufactur|mobile/i;
const LEASED_RE = /leasehold|leased\s*land|land\s*lease/i;

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function isManufacturedHome(lead: any): boolean {
  if (!lead) return false;
  const ptype = asString(lead.propertyType);
  if (ptype === 'MFR') return true;
  if (MFR_RE.test(ptype)) return true;

  const features = (lead.reapiFeatures ?? {}) as Record<string, any>;
  const candidates = [
    features.landUse,
    features.propertyClass,
    features.propertyUse,
    features.propertySubType,
    features.buildingType,
  ].map(asString);
  if (candidates.some(c => MFR_RE.test(c))) return true;

  // MLS subtype sometimes carries "Manufactured" classification
  const mlsHistory = Array.isArray(lead.reapiMlsHistory) ? lead.reapiMlsHistory : [];
  if (mlsHistory.some((h: any) => MFR_RE.test(asString(h?.propertySubType)))) return true;

  return false;
}

function isLeasedLand(lead: any): boolean {
  if (!lead) return false;
  const features = (lead.reapiFeatures ?? {}) as Record<string, any>;
  const candidates = [
    features.landUse,
    features.legalDescription,
    features.zoning,
    asString(lead.reapiMlsRemarks),
  ].map(asString);
  return candidates.some(c => LEASED_RE.test(c));
}

/**
 * Estimate total current mortgage debt from REAPI's stored mortgageData.
 * Shape (from reapi.service.mapMortgages): { firstConcurrent: { amount, ... },
 * secondConcurrent: { amount, ... } | undefined }. Returns the sum of both
 * `amount` fields (original loan amounts) when present.
 *
 * Caveat: `amount` is the ORIGINAL loan amount, not the current balance. For
 * recent purchases (last few years) the current balance is essentially the
 * same as origination, which is the case we most need to flag. For older
 * mortgages this overestimates debt — that's an acceptable bias since it
 * makes us MORE cautious about deal fit, not less.
 */
function totalMortgageBalance(lead: any): number | null {
  const md = lead?.reapiMortgageData;
  if (!md || typeof md !== 'object') return null;
  const first = Number(md?.firstConcurrent?.amount);
  const second = Number(md?.secondConcurrent?.amount);
  let sum = 0;
  let any = false;
  if (Number.isFinite(first) && first > 0) {
    sum += first;
    any = true;
  }
  if (Number.isFinite(second) && second > 0) {
    sum += second;
    any = true;
  }
  return any ? sum : null;
}

function monthsSince(date: Date | null, now: Date): number | null {
  if (!date) return null;
  const ms = now.getTime() - date.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / (30.4375 * 24 * 60 * 60 * 1000));
}

function pickArv(lead: any): number | null {
  const arv = Number(lead?.arv);
  if (Number.isFinite(arv) && arv > 0) return arv;
  const excellent = Number(lead?.avmExcellentHigh);
  if (Number.isFinite(excellent) && excellent > 0) return excellent;
  const reapiAvm = Number(lead?.reapiEstimatedValue);
  if (Number.isFinite(reapiAvm) && reapiAvm > 0) return reapiAvm;
  const attom = Number(lead?.attomAvm);
  if (Number.isFinite(attom) && attom > 0) return attom;
  return null;
}

export function dealFitFlags(lead: any): DealFitFlags {
  const isMfr = isManufacturedHome(lead);
  const isLeased = isLeasedLand(lead);

  const ask = Number(lead?.askingPrice);
  const arv = pickArv(lead);
  const ratio = Number.isFinite(ask) && ask > 0 && arv ? ask / arv : null;
  const askHigh = ratio != null && ratio >= 0.85;
  const askAtOrAbove = ratio != null && ratio >= 0.95;

  // Mortgage / equity signals
  const mortgageBal = totalMortgageBalance(lead);
  const mortgageVsArv = arv && mortgageBal ? mortgageBal / arv : null;
  // Investor MAO is roughly 70% of ARV. If the mortgage payoff alone exceeds
  // that, our offer mathematically can't cover the loan — the deal is dead.
  const mortgageExceedsMao = mortgageVsArv != null && mortgageVsArv >= 0.70;

  // Recent purchase + thin/no equity — they paid at-or-near today's ARV.
  const lastSaleDate = lead?.lastSaleDate ? new Date(lead.lastSaleDate) : null;
  const lastSaleMonths = monthsSince(lastSaleDate, new Date());
  const lastSalePrice = Number(lead?.lastSalePrice);
  const boughtRecently = lastSaleMonths != null && lastSaleMonths <= 24;
  const recentPurchaseNoEquity =
    boughtRecently &&
    arv != null &&
    Number.isFinite(lastSalePrice) &&
    lastSalePrice > 0 &&
    lastSalePrice >= arv * 0.85;

  const dealCannotPencil =
    askAtOrAbove || mortgageExceedsMao || (recentPurchaseNoEquity && askHigh);

  const concerns: string[] = [];
  if (isMfr) {
    concerns.push(
      isLeased
        ? 'manufactured/mobile home on leased land — typically not a fit for cash investors'
        : 'manufactured/mobile home — usually only a fit when on owned land',
    );
  } else if (isLeased) {
    concerns.push('property appears to be on leased land — typically not a fit for cash investors');
  }
  if (askAtOrAbove) {
    concerns.push(
      `asking price is at or above the estimated ARV (~${Math.round((ratio as number) * 100)}% of ARV) — investors target 60-70% of ARV, so this is likely not a fit on price`,
    );
  } else if (askHigh) {
    concerns.push(
      `asking price is ~${Math.round((ratio as number) * 100)}% of ARV — investors typically target 60-70% of ARV, so price expectations may need to be reset`,
    );
  }
  if (mortgageExceedsMao && mortgageBal && arv) {
    concerns.push(
      `estimated mortgage debt (~${fmtMoney(mortgageBal)}) is ${Math.round(mortgageVsArv as number * 100)}% of ARV — an investor offer at 60-70% of ARV would not cover the loan payoff, so the seller would likely have to bring money to the table`,
    );
  }
  if (recentPurchaseNoEquity && lastSalePrice && arv) {
    const yrs = lastSaleMonths != null ? Math.max(1, Math.round(lastSaleMonths / 12)) : null;
    concerns.push(
      `seller bought ${yrs ? `~${yrs}yr ago` : 'recently'} for ${fmtMoney(lastSalePrice)} (${Math.round((lastSalePrice / arv) * 100)}% of current ARV) — very thin equity, hard for an investor purchase to pencil`,
    );
  }

  return {
    isManufactured: isMfr,
    isLeasedLand: isLeased,
    askVsArvPct: ratio,
    askIsHighVsArv: askHigh,
    askIsAtOrAboveArv: askAtOrAbove,
    mortgageBalance: mortgageBal,
    mortgageVsArvPct: mortgageVsArv,
    mortgageExceedsMao,
    boughtRecently,
    recentPurchaseNoEquity,
    dealCannotPencil,
    hasOpenFitConcern: concerns.length > 0,
    concerns,
  };
}

export interface PropertyContextOptions {
  /** Latest CompAnalysis row for the lead, used for photo-derived repair range. */
  latestCompAnalysis?: {
    photoRepairLow?: number | null;
    photoRepairHigh?: number | null;
  } | null;
}

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function yearsBetween(then: Date, now: Date): number {
  const ms = now.getTime() - then.getTime();
  return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

/**
 * Build the multi-line "PROPERTY FACTS (team use only — do NOT recite to seller)"
 * block injected into the conversational prompt. Emits only lines we have data for.
 */
export function propertyContextForPrompt(
  lead: any,
  opts: PropertyContextOptions = {},
): string {
  if (!lead) return '';
  const lines: string[] = [];
  const flags = dealFitFlags(lead);

  // Specs
  const beds = lead.bedrooms;
  const baths = lead.bathrooms;
  const sqft = lead.sqftOverride ?? lead.sqft;
  const yearBuilt = lead.yearBuilt;
  if (beds || baths || sqft) {
    lines.push(
      `- Specs: ${[
        beds ? `${beds}bd` : '',
        baths ? `${baths}ba` : '',
        sqft ? `${Number(sqft).toLocaleString()} sqft` : '',
      ]
        .filter(Boolean)
        .join('/')}${yearBuilt ? `, built ${yearBuilt}` : ''}`,
    );
  }

  // Property type / fit flags
  const ptype = asString(lead.propertyType);
  if (ptype) {
    const annotations: string[] = [];
    if (flags.isManufactured) annotations.push('MANUFACTURED HOME');
    if (flags.isLeasedLand) annotations.push('LEASED LAND');
    lines.push(
      `- Property type: ${ptype}${annotations.length ? ` (${annotations.join(', ')})` : ''}`,
    );
  } else if (flags.isManufactured || flags.isLeasedLand) {
    const tags: string[] = [];
    if (flags.isManufactured) tags.push('MANUFACTURED HOME');
    if (flags.isLeasedLand) tags.push('LEASED LAND');
    lines.push(`- Property classification: ${tags.join(', ')}`);
  }

  // ARV + ask-vs-ARV ratio
  const arv = pickArv(lead);
  const ask = Number(lead.askingPrice);
  if (arv) {
    const ratioStr =
      Number.isFinite(ask) && ask > 0
        ? ` — seller's ask of ${fmtMoney(ask)} is ${Math.round((ask / arv) * 100)}% of ARV`
        : '';
    lines.push(`- Estimated ARV: ~${fmtMoney(arv)}${ratioStr}`);
  }

  // AS-IS vs after-repair range
  const asIs = Number(lead.avmPoorHigh);
  const excellent = Number(lead.avmExcellentHigh);
  if (Number.isFinite(asIs) && asIs > 0 && Number.isFinite(excellent) && excellent > 0) {
    lines.push(`- Condition-adjusted range: as-is ~${fmtMoney(asIs)} → after-repair ~${fmtMoney(excellent)}`);
  }

  // Last sale + years owned
  const lastSalePrice = Number(lead.lastSalePrice);
  const lastSaleDate = lead.lastSaleDate ? new Date(lead.lastSaleDate) : null;
  if (lastSaleDate && Number.isFinite(lastSalePrice) && lastSalePrice > 0) {
    const yrs = yearsBetween(lastSaleDate, new Date());
    const yrLabel = yrs <= 0 ? 'less than a year ago' : yrs === 1 ? '1 year ago' : `${yrs} years ago`;
    lines.push(
      `- Last sale: ${fmtMoney(lastSalePrice)} on ${lastSaleDate.getFullYear()} (${yrLabel})`,
    );
  } else if (Number.isFinite(lastSalePrice) && lastSalePrice > 0) {
    lines.push(`- Last sale price: ${fmtMoney(lastSalePrice)}`);
  }

  // Equity
  const equity = Number(lead.reapiEquity);
  if (Number.isFinite(equity) && equity > 0) {
    lines.push(`- Estimated equity: ~${fmtMoney(equity)}`);
  }

  // Mortgage debt — use the same flag-derived total so the prompt and the
  // concerns list stay aligned. Show the % of ARV when both are known.
  if (flags.mortgageBalance != null && flags.mortgageBalance > 0) {
    const pctStr =
      flags.mortgageVsArvPct != null
        ? ` (${Math.round(flags.mortgageVsArvPct * 100)}% of ARV)`
        : '';
    lines.push(`- Mortgage debt (estimated): ~${fmtMoney(flags.mortgageBalance)}${pctStr}`);
  }

  // MLS history
  if (lead.reapiMlsListDate || lead.reapiMlsStatus) {
    const parts: string[] = [];
    if (lead.reapiMlsListDate) {
      const d = new Date(lead.reapiMlsListDate);
      parts.push(`listed ${d.getFullYear()}`);
    }
    if (lead.reapiMlsStatus) parts.push(`status ${lead.reapiMlsStatus}`);
    const sold = Number(lead.reapiMlsSoldPrice);
    if (Number.isFinite(sold) && sold > 0) parts.push(`sold ${fmtMoney(sold)}`);
    const list = Number(lead.reapiMlsListPrice);
    if (Number.isFinite(list) && list > 0) parts.push(`list ${fmtMoney(list)}`);
    if (parts.length) lines.push(`- MLS history: ${parts.join(', ')}`);
  }

  // MLS photos
  const photoCount = Array.isArray(lead.reapiMlsPhotos) ? lead.reapiMlsPhotos.length : 0;
  if (photoCount > 0) {
    lines.push(
      `- Listing photos available: ${photoCount} (you may reference what's visible in the photos when condition comes up)`,
    );
  }

  // Photo-derived repair range (from latest CompAnalysis)
  const repairLow = Number(opts.latestCompAnalysis?.photoRepairLow);
  const repairHigh = Number(opts.latestCompAnalysis?.photoRepairHigh);
  if (Number.isFinite(repairLow) && repairLow > 0 && Number.isFinite(repairHigh) && repairHigh > 0) {
    lines.push(`- Photo-based repair estimate: ${fmtMoney(repairLow)}–${fmtMoney(repairHigh)}`);
  }

  // Distress signals
  const distress = Array.isArray(lead.distressSignals) ? lead.distressSignals : [];
  if (distress.length > 0) {
    lines.push(`- Distress signals: ${distress.join(', ')}`);
  }

  // Property condition / quality
  if (lead.propertyCondition || lead.propertyQuality) {
    const cq = [lead.propertyCondition && `condition ${lead.propertyCondition}`, lead.propertyQuality && `quality ${lead.propertyQuality}`]
      .filter(Boolean)
      .join(', ');
    lines.push(`- Public records: ${cq}`);
  }

  // Fit concerns summary line at the end so it's the last thing the AI sees
  if (flags.concerns.length > 0) {
    lines.push(`- Deal-fit concerns to surface: ${flags.concerns.join('; ')}`);
  }

  if (lines.length === 0) return '';
  return `\nPROPERTY FACTS (team use only — do NOT recite to seller, but reference naturally when the topic calls for it):\n${lines.join('\n')}\n`;
}
