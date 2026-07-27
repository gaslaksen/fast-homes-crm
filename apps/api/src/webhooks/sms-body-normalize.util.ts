/**
 * Replace Unicode "smart" characters in an outbound SMS body with their
 * ASCII equivalents BEFORE the message is saved or sent. Two reasons:
 *
 * 1. The "no em dashes" rule in the conversational prompt gets violated
 *    occasionally, so sanitizing the AI output guarantees compliance
 *    regardless of what the model returns.
 * 2. Non-GSM-7 characters like em dashes and smart quotes push an SMS into
 *    UCS-2 encoding, which cuts the per-segment limit from 160 characters to
 *    70. Normalizing to ASCII keeps messages in one segment.
 *
 * This function preserves newlines and whitespace, because outbound messages
 * may contain intentional paragraph breaks (e.g. a compliance footer on its
 * own line).
 */
export function sanitizeOutboundSmsBody(input: string): string {
  if (!input) return '';
  return input
    // Em dash, en dash, minus sign, figure dash, horizontal bar → hyphen
    .replace(/[‐-―−]/g, '-')
    // Curly double quotes → straight
    .replace(/[“”„‟]/g, '"')
    // Curly single quotes / apostrophes → straight
    .replace(/[‘’‚‛′‵]/g, "'")
    // Ellipsis char → three dots
    .replace(/…/g, '...')
    // Non-breaking space, narrow no-break space → regular space
    .replace(/ | /g, ' ')
    // Zero-width space → strip
    .replace(/​/g, '')
    // Hyphens used AS dashes (space-hyphen-space patterns, 1-3 hyphens) → comma.
    // The conversational prompt forbids this but the model violates ~5% of the
    // time. Replacing with ", " preserves the dash's natural flow without
    // breaking compound words ("well-known"), ranges ("70-80"), or phone
    // numbers ("555-1234") - those have no surrounding spaces, so don't match.
    .replace(/ -{1,3} /g, ', ');
}

/**
 * Recursively walk any JSON-serialisable value and apply
 * sanitizeOutboundSmsBody() to every string. Use when you have already
 * JSON.parsed a model response and want to scrub dashes/smart-quotes/
 * ellipses from every string field without risking JSON-syntax
 * corruption (which a pre-parse swap would cause if smart quotes
 * appeared inside string values). Returns a NEW object, does not
 * mutate input.
 */
export function deepSanitizeAiStrings<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeOutboundSmsBody(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => deepSanitizeAiStrings(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepSanitizeAiStrings(v);
    }
    return out as unknown as T;
  }
  return value;
}
