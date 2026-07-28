/**
 * Plain-text derivation for the multipart alternative of an outbound email.
 *
 * The composer's editor (Quill) returns semantic HTML, which escapes not just
 * the markup characters but apostrophes and quotes too ("I&#39;d", "&quot;").
 * Stripping tags without decoding those leaks the raw entities into the text
 * part, so the seller reads "I&#39;d like the chance" in any client that
 * prefers text/plain.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Decode HTML entities in a single pass, so an already-escaped "&amp;lt;"
 * correctly yields "&lt;" rather than being unwound twice into "<".
 * Unknown entities are left untouched.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
    const key = entity.toLowerCase();
    return key in NAMED_ENTITIES ? NAMED_ENTITIES[key] : match;
  });
}

/** Collapse an HTML email body to a readable plain-text alternative. */
export function htmlToText(html: string): string {
  if (!html) return '';
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  // Decode only after the tags are gone, so an escaped "&lt;b&gt;" in the
  // source can never turn back into markup here.
  return decodeHtmlEntities(stripped)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
