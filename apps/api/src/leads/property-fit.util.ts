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
  hasOpenFitConcern: boolean; // any of the above worth surfacing to seller
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
      `asking price is at or above the estimated ARV (~${Math.round((ratio as number) * 100)}% of ARV) — investors target 60–70% of ARV, so this is likely not a fit on price`,
    );
  } else if (askHigh) {
    concerns.push(
      `asking price is ~${Math.round((ratio as number) * 100)}% of ARV — investors typically target 60–70% of ARV, so price expectations may need to be reset`,
    );
  }

  return {
    isManufactured: isMfr,
    isLeasedLand: isLeased,
    askVsArvPct: ratio,
    askIsHighVsArv: askHigh,
    askIsAtOrAboveArv: askAtOrAbove,
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
