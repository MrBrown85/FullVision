/**
 * HTML sanitizer security tests — gb-ui.js :: sanitizeHtml()
 * Uses linkedom for real DOM parsing since sanitizeHtml walks childNodes.
 */
import { parseHTML } from 'linkedom';

// Replace the stub document with a real DOM for these tests
const { document: realDoc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
const origCreateElement = globalThis.document.createElement;
const origCreateTextNode = globalThis.document.createTextNode;

beforeAll(() => {
  globalThis.document.createElement = (tag) => realDoc.createElement(tag);
  globalThis.document.createTextNode = (text) => realDoc.createTextNode(text);
});

afterAll(() => {
  globalThis.document.createElement = origCreateElement;
  globalThis.document.createTextNode = origCreateTextNode;
});

describe('sanitizeHtml', () => {
  it('strips <script> tags', () => {
    const result = sanitizeHtml('<p>Hello</p><script>alert(1)</script>');
    expect(result).not.toContain('<script');
    expect(result).toContain('Hello');
  });

  it('strips <img onerror> attack', () => {
    const result = sanitizeHtml('<img onerror="alert(1)" src="x">');
    expect(result).not.toContain('<img');
    expect(result).not.toContain('onerror');
  });

  it('strips javascript: hrefs', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
    expect(result).toContain('click');
  });

  it('strips <iframe> tags', () => {
    const result = sanitizeHtml('<iframe src="evil.com"></iframe>');
    expect(result).not.toContain('<iframe');
  });

  it('strips <object> tags', () => {
    const result = sanitizeHtml('<object data="x"></object>');
    expect(result).not.toContain('<object');
  });

  it('preserves <b> and <strong>', () => {
    const result = sanitizeHtml('<b>bold</b> <strong>strong</strong>');
    expect(result).toContain('<b>bold</b>');
    expect(result).toContain('<strong>strong</strong>');
  });

  it('preserves <em>, <i>, <u>', () => {
    const result = sanitizeHtml('<em>em</em><i>i</i><u>u</u>');
    expect(result).toContain('<em>em</em>');
    expect(result).toContain('<i>i</i>');
    expect(result).toContain('<u>u</u>');
  });

  it('preserves <ul>, <ol>, <li>', () => {
    const result = sanitizeHtml('<ul><li>item</li></ul>');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>item</li>');
  });

  it('preserves <br>, <p>, <div>, <span>', () => {
    const result = sanitizeHtml('<p>para</p><div>div</div><span>span</span><br>');
    expect(result).toContain('<p>');
    expect(result).toContain('<div>');
    expect(result).toContain('<span>');
  });

  it('strips attributes from allowed tags', () => {
    const result = sanitizeHtml('<b style="color:red" onclick="alert(1)">text</b>');
    expect(result).toContain('<b>text</b>');
    expect(result).not.toContain('style');
    expect(result).not.toContain('onclick');
  });

  it('strips nested dangerous tags inside allowed tags', () => {
    const result = sanitizeHtml('<b><script>xss</script>safe</b>');
    expect(result).not.toContain('<script');
    expect(result).toContain('safe');
  });

  it('handles empty input', () => {
    expect(sanitizeHtml('')).toBe('');
  });
});
