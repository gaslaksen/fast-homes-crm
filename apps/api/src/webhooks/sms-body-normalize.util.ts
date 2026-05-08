/**
 * Replace Unicode "smart" characters in an outbound SMS body with their
 * ASCII equivalents BEFORE the message is saved or sent. Two reasons:
 *
 * 1. The "no em dashes" rule in the conversational prompt gets violated
 *    occasionally — sanitizing the AI output guarantees compliance
 *    regardless of what the model returns.
 * 2. SmrtPhone/the SMS carrier normalizes these characters anyway before
 *    delivery and echoes the normalized body back in the smsOutgoing
 *    webhook. If we send the raw em-dash version, the webhook body
 *    won't match the stored body byte-for-byte, the message gets
 *    misclassified as "manual reply", autoRespond gets paused, and a
 *    duplicate message row is created. (Meghan Kinee thread, 2026-05-08.)
 *
 * Unlike normalizeSmsBodyForCompare below, this function preserves
 * newlines and whitespace — outbound messages may contain intentional
 * paragraph breaks (e.g. seller portal URL on its own line).
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
    .replace(/​/g, '');
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

/**
 * Normalize an SMS body for app-originated match comparison in the
 * SmrtPhone smsOutgoing webhook. SmrtPhone (and the underlying SMS
 * carriers) replace several Unicode characters with their ASCII
 * equivalents before delivering the message — most commonly em dashes,
 * en dashes, curly quotes, and ellipses. The webhook then echoes the
 * normalized body back to us.
 *
 * If we compare the webhook body byte-for-byte against the body we
 * stored in the DB, the match silently fails for any AI-generated
 * message that contained these characters, the auto-response is logged
 * as a "manual reply", autoRespond gets paused, and a duplicate message
 * row is created. See feedback in 2026-05-08 Meghan Kinee thread.
 *
 * Unlike sanitizeOutboundSmsBody above, this also collapses whitespace
 * and trims — used purely for COMPARING two strings, never for the body
 * we send out.
 */
export function normalizeSmsBodyForCompare(input: string): string {
  if (!input) return '';
  return (
    input
      // Em dash, en dash, minus sign, figure dash, horizontal bar → hyphen
      .replace(/[‐-―−]/g, '-')
      // Curly double quotes → straight
      .replace(/[“”„‟]/g, '"')
      // Curly single quotes / apostrophes → straight
      .replace(/[‘’‚‛′‵]/g, "'")
      // Ellipsis → three dots
      .replace(/…/g, '...')
      // Non-breaking space, narrow no-break space, zero-width space → space (ZWSP becomes empty after collapse)
      .replace(/ | /g, ' ')
      .replace(/​/g, '')
      // Normalize CRLF / CR to LF
      .replace(/\r\n?/g, '\n')
      // Collapse runs of whitespace to a single space
      .replace(/\s+/g, ' ')
      .trim()
  );
}
