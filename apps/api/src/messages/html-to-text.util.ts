/**
 * Cleanup for the HTML the composer's editor (Quill) hands us, plus the
 * plain-text derivation for the multipart alternative.
 *
 * Quill's getSemanticHTML is built for a browser editor, not for email, and
 * makes two choices that hurt on the way out:
 *   - it escapes apostrophes and quotes as numeric entities ("I&#39;d"), which
 *     leaks into the text part unless decoded;
 *   - it emits &nbsp; for EVERY space (quill 2.0.3 does a literal
 *     replaceAll(" ", "&nbsp;")), so no line can wrap at a word boundary and
 *     clients break mid-word instead.
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

/**
 * Zero the margin on every paragraph, keeping any styling the editor set.
 *
 * The composer renders paragraphs flush (Quill's editor CSS sets margin 0) and
 * expresses a blank line as its own empty paragraph. Mail clients instead give
 * every <p> a default ~1em margin, so the two stack and the message arrives
 * double spaced. Zeroing it makes the email match what the composer showed.
 */
function zeroParagraphMargins(html: string): string {
  return html.replace(/<p\b([^>]*)>/gi, (_tag, attrs: string) => {
    const style = attrs.match(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/i);
    if (!style) return `<p${attrs} style="margin:0;">`;
    const [full, quote, value] = style;
    return `<p${attrs.replace(full, ` style=${quote}margin:0;${value}${quote}`)}>`;
  });
}

/**
 * Make editor HTML safe to send as an email body.
 *
 * Turns Quill's blanket &nbsp; back into ordinary spaces so the message wraps
 * normally. A run of two or more is kept: that is a deliberate multi-space.
 * A single one hugging a tag boundary is kept too, because a plain space there
 * would just be collapsed away by the client.
 */
export function normalizeEditorHtml(html: string): string {
  if (!html) return '';
  const spaced = html
    .replace(/(?:&nbsp;)+/gi, (run, offset: number, full: string) => {
      if (run.length > 6) return run;
      const before = full[offset - 1];
      const after = full[offset + run.length];
      if (before === undefined || before === '>') return run;
      if (after === undefined || after === '<') return run;
      return ' ';
    })
    // Quill writes a blank line as an empty paragraph, which some clients
    // collapse to nothing; a <br> inside keeps the gap the composer showed.
    .replace(/<p><\/p>/gi, '<p><br></p>');
  return zeroParagraphMargins(spaced);
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
