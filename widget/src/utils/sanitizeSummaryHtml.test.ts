// @vitest-environment jsdom
// DOMPurify constructs itself against a real `window`/`document` — this is
// the only test file in the project that needs a DOM, so it's opted in
// per-file rather than switching the whole suite off the faster default
// `node` environment.
import { describe, expect, it } from 'vitest';
import { sanitizeSummaryHtml } from './sanitizeSummaryHtml';

describe('sanitizeSummaryHtml', () => {
  it('keeps the allowed formatting tags', () => {
    const input = '<p>Hello <b>world</b></p><ul><li>one</li><li>two</li></ul>';
    expect(sanitizeSummaryHtml(input)).toBe(input);
  });

  it('strips script tags entirely, including their content', () => {
    const out = sanitizeSummaryHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('strips event handler attributes even on allowed tags', () => {
    const out = sanitizeSummaryHtml('<p onclick="alert(1)">hi</p>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('alert(1)');
  });

  it('strips disallowed tags (e.g. img/a) while keeping their text content', () => {
    const out = sanitizeSummaryHtml('<p>See <a href="javascript:alert(1)">this</a></p><img src=x onerror=alert(1)>');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('this');
  });
});
