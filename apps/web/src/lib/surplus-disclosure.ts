/**
 * What an outbound surplus message may say, by who is reading it. Mirrors
 * apps/api/src/surplus/surplus-disclosure.util.ts, duplicated for the same
 * reason as surplus-calls.ts (Vercel builds the web app without the shared
 * dist). The API is the gate: it holds the send. This copy only warns while
 * somebody is still typing, so the hold is not a surprise.
 */

const DOLLAR_FIGURE =
  /(\$\s?\d[\d,]*(?:\.\d+)?\s*k?\b)|(\b\d[\d,]*(?:\.\d+)?\s*(?:k\b|thousand\b|dollars?\b))|(\b\d{1,3}(?:,\d{3})+\b)/i;

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

export function namesDollarFigure(text: string): boolean {
  return DOLLAR_FIGURE.test(text);
}

export function sourceWordsIn(text: string): string[] {
  return SOURCE_WORDS.filter((s) => s.re.test(text)).map((s) => s.word);
}

/**
 * The warning to show under a draft to somebody on the case who is not the
 * claimant, or null when the draft is fine. The claimant's own rule (no
 * source words before signing) is applied by the API, which knows the stage.
 */
export function relativeDraftWarning(text: string, recipientName: string): string | null {
  const body = String(text || '');
  if (!body.trim()) return null;
  const problems: string[] = [];
  if (namesDollarFigure(body)) problems.push('names a dollar figure');
  const words = sourceWordsIn(body);
  if (words.length) problems.push(`says where the money comes from (${words.join(', ')})`);
  if (!problems.length) return null;
  return `This goes to ${recipientName}, not the claimant, and it ${problems.join(' and ')}. It will be held when sent. Say the claimant may have unclaimed funds and ask for a way to reach them.`;
}
