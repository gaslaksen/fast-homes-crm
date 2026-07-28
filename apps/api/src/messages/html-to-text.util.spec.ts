import { decodeHtmlEntities, htmlToText, normalizeEditorHtml } from './html-to-text.util';

describe('normalizeEditorHtml', () => {
  it('turns the blanket &nbsp; Quill emits back into wrappable spaces', () => {
    expect(normalizeEditorHtml('<p>My&nbsp;name&nbsp;is&nbsp;Ian&nbsp;McCaskill.</p>')).toBe(
      '<p>My name is Ian McCaskill.</p>',
    );
  });

  it('keeps a deliberate run of two or more', () => {
    expect(normalizeEditorHtml('<p>a&nbsp;&nbsp;&nbsp;b</p>')).toBe('<p>a&nbsp;&nbsp;&nbsp;b</p>');
  });

  it('keeps a single one against a tag boundary, where a space would collapse', () => {
    expect(normalizeEditorHtml('<p>&nbsp;indented</p>')).toBe('<p>&nbsp;indented</p>');
    expect(normalizeEditorHtml('<p>trailing&nbsp;</p>')).toBe('<p>trailing&nbsp;</p>');
  });

  it('gives an empty paragraph a break so the blank line survives', () => {
    expect(normalizeEditorHtml('<p>one</p><p></p><p>two</p>')).toBe(
      '<p>one</p><p><br></p><p>two</p>',
    );
  });

  it('leaves the apostrophe entity for the HTML part, which renders it fine', () => {
    expect(normalizeEditorHtml('<p>I&#39;d&nbsp;like</p>')).toBe('<p>I&#39;d like</p>');
  });

  it('handles empty input', () => {
    expect(normalizeEditorHtml('')).toBe('');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes the numeric apostrophe Quill emits', () => {
    expect(decodeHtmlEntities('I&#39;d like to talk')).toBe("I'd like to talk");
  });

  it('decodes hex entities', () => {
    expect(decodeHtmlEntities('There&#x27;s no obligation')).toBe("There's no obligation");
  });

  it('decodes named entities', () => {
    expect(decodeHtmlEntities('Tom &amp; Jerry said &quot;hi&quot;')).toBe('Tom & Jerry said "hi"');
  });

  it('decodes only one pass, so an escaped entity survives', () => {
    expect(decodeHtmlEntities('&amp;lt;tag&amp;gt;')).toBe('&lt;tag&gt;');
  });

  it('leaves unknown entities alone', () => {
    expect(decodeHtmlEntities('cost &euro; and &notreal;')).toBe('cost &euro; and &notreal;');
  });

  it('handles empty input', () => {
    expect(decodeHtmlEntities('')).toBe('');
  });
});

describe('htmlToText', () => {
  it('keeps apostrophes readable in the plain-text part', () => {
    const html =
      '<p>Hi {Name},</p><p><br></p>' +
      "<p>I&#39;d like the chance to walk through. There&#39;s no obligation.</p>";
    expect(htmlToText(html)).toBe(
      "Hi {Name},\n\nI'd like the chance to walk through. There's no obligation.",
    );
  });

  it('turns block ends and breaks into newlines', () => {
    expect(htmlToText('<p>one</p><p>two<br>three</p>')).toBe('one\ntwo\nthree');
  });

  it('collapses non-breaking spaces to normal spaces', () => {
    expect(htmlToText('<p>a&nbsp;b</p>')).toBe('a b');
  });

  it('drops style and script blocks', () => {
    expect(htmlToText('<style>p{color:red}</style><p>body copy</p>')).toBe('body copy');
    expect(htmlToText('<script>alert(1)</script><p>body copy</p>')).toBe('body copy');
  });

  it('does not resurrect markup from escaped tags', () => {
    expect(htmlToText('<p>use &lt;b&gt; for bold</p>')).toBe('use <b> for bold');
  });

  it('handles empty input', () => {
    expect(htmlToText('')).toBe('');
  });
});

// The body from a real Quill send, straight out of the editor.
describe('a full composer body', () => {
  const raw =
    '<p>Hi&nbsp;{Name},</p><p></p>' +
    '<p>My&nbsp;name&nbsp;is&nbsp;Ian&nbsp;McCaskill.&nbsp;I&nbsp;work&nbsp;with&nbsp;homeowners.</p>' +
    '<p></p><p>I&#39;d&nbsp;like&nbsp;the&nbsp;chance.&nbsp;There&#39;s&nbsp;no&nbsp;obligation.</p>';

  it('produces HTML that can wrap', () => {
    const html = normalizeEditorHtml(raw);
    expect(html).toBe(
      '<p>Hi {Name},</p><p><br></p>' +
        '<p>My name is Ian McCaskill. I work with homeowners.</p>' +
        '<p><br></p><p>I&#39;d like the chance. There&#39;s no obligation.</p>',
    );
    expect(html).not.toMatch(/\w&nbsp;\w/);
  });

  it('produces a clean text alternative', () => {
    expect(htmlToText(normalizeEditorHtml(raw))).toBe(
      'Hi {Name},\n\nMy name is Ian McCaskill. I work with homeowners.\n\n' +
        "I'd like the chance. There's no obligation.",
    );
  });
});
