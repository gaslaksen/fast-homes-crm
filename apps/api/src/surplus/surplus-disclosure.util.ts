import { BadRequestException } from '@nestjs/common';

/**
 * What an outbound surplus message may say, by who is reading it.
 *
 * The course's rule, and the compliance one: the amount and the source of the
 * money are the claimant's business. A relative, a neighbor or a friend is
 * told only that the claimant may have unclaimed funds and asked for a way
 * to reach them. The claimant hears where the money sits only once the fee
 * agreement is signed, since that is the thing they are paying for.
 *
 * In production on 2026-10-31 dozens of threads to relatives opened with
 * "your family is owed over $X,000". The composer knew the recipient was a
 * relative and did nothing with it. Now the send is held with the reason.
 */

export type DisclosureAudience = 'claimant' | 'relative';

export interface DisclosureContext {
  audience: DisclosureAudience;
  /** The fee agreement is signed (Agreement Signed or later). */
  signed: boolean;
}

/** "$12,500", "$12k", "12,500 dollars", "over 40,000". */
const DOLLAR_FIGURE =
  /(\$\s?\d[\d,]*(?:\.\d+)?\s*k?\b)|(\b\d[\d,]*(?:\.\d+)?\s*(?:k\b|thousand\b|dollars?\b))|(\b\d{1,3}(?:,\d{3})+\b)/i;

/** Where the money comes from, which names the case to anyone who can look it up. */
const SOURCE_WORDS: { re: RegExp; word: string }[] = [
  { re: /\btax\s*deed/i, word: 'tax deed' },
  { re: /\bsurplus/i, word: 'surplus' },
  { re: /\boverage/i, word: 'overage' },
  { re: /\bexcess\s+(?:proceeds|funds)/i, word: 'excess proceeds' },
  { re: /\bforeclos/i, word: 'foreclosure' },
  { re: /\bcounty\b/i, word: 'county' },
  { re: /\bclerk\b/i, word: 'clerk' },
  { re: /\bcase\s*(?:no\.?|number|#)/i, word: 'case number' },
  { re: /\bparcel/i, word: 'parcel' },
];

/** Merge fields that would put the amount or the source into a template. */
const AMOUNT_FIELDS = /\{\{\s*(?:surplus|amount|grossSurplus|netSurplus|surplusAtNotice|caseNumber|county)\s*\}\}/i;

export function namesDollarFigure(text: string): boolean {
  return DOLLAR_FIGURE.test(text) || AMOUNT_FIELDS.test(text);
}

export function sourceWordsIn(text: string): string[] {
  return SOURCE_WORDS.filter((s) => s.re.test(text)).map((s) => s.word);
}

/**
 * Why this text must not go out as written, or an empty list. Each reason is
 * one sentence a person can act on.
 */
export function disclosureHolds(text: string, ctx: DisclosureContext): string[] {
  const holds: string[] = [];
  const body = String(text || '');
  if (!body.trim()) return holds;
  const words = sourceWordsIn(body);
  if (ctx.audience === 'relative') {
    if (namesDollarFigure(body)) {
      holds.push('It names a dollar figure. Only the claimant hears the amount; a relative hears that there may be unclaimed funds.');
    }
    if (words.length) {
      holds.push(`It says where the money comes from (${words.join(', ')}). A relative is asked for a way to reach the claimant, nothing more.`);
    }
  } else if (!ctx.signed && words.length) {
    holds.push(
      `It says where the money comes from (${words.join(', ')}) before the fee agreement is signed. The source is what the agreement covers; until then, "unclaimed funds".`,
    );
  }
  return holds;
}

/** The hold, as the composer and the drip see it: a 400 with the reasons. */
export class DisclosureHoldException extends BadRequestException {
  constructor(
    public readonly recipient: string,
    public readonly holds: string[],
  ) {
    super(`Held, not sent to ${recipient}. ${holds.join(' ')}`);
  }
}
