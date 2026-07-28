import { decodeHtmlEntities, htmlToText } from './html-to-text.util';

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
