/**
 * One sheet printing on its own (grade sheets, rubrics, QR slips) goes
 * through ui.js: setPrintMode / clearPrintMode / printThen.
 */
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('printing one sheet', () => {
  let doc, orig;
  beforeEach(() => {
    doc = parseHTML('<!DOCTYPE html><html><head><style id="other">@page{}</style></head><body></body></html>').document;
    orig = { document: globalThis.document, print: window.print };
    globalThis.document = doc;
  });
  afterEach(() => {
    globalThis.document = orig.document;
    window.print = orig.print;
    vi.useRealTimers();
  });

  it('gives every page the same margin, the first and both sides included', () => {
    const css = printPageCss('legal portrait', '0.4in');
    expect(css).toContain('@page { size: legal portrait; margin: 0.4in; }');
    ['@page :left', '@page :right', '@page :first'].forEach(sel => expect(css).toContain(sel + ' { margin: 0.4in; }'));
  });

  it('puts its page rule last in <head> every time, and clears it', () => {
    setPrintMode('sheet-style', 'sheet-active', 'letter portrait', '0.25in');
    doc.head.appendChild(doc.createElement('style')).id = 'later';
    setPrintMode('sheet-style', 'sheet-active', 'letter portrait', '0.25in');
    expect(doc.head.lastElementChild.id).toBe('sheet-style');
    expect(doc.querySelectorAll('#sheet-style').length).toBe(1);
    expect(doc.body.classList.contains('sheet-active')).toBe(true);
    clearPrintMode('sheet-style', 'sheet-active');
    expect(doc.getElementById('sheet-style')).toBe(null);
    expect(doc.body.classList.contains('sheet-active')).toBe(false);
  });

  it('prints, then cleans up once whether or not afterprint fires', () => {
    vi.useFakeTimers();
    const listeners = {};
    const add = window.addEventListener;
    const remove = window.removeEventListener;
    window.addEventListener = (type, fn) => (listeners[type] = fn);
    window.removeEventListener = type => delete listeners[type];
    window.print = vi.fn();
    const cleanup = vi.fn();
    try {
      printThen(cleanup);
      expect(window.print).toHaveBeenCalledTimes(1);
      listeners.afterprint();
      vi.runAllTimers();
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(listeners.afterprint).toBeUndefined();
    } finally {
      window.addEventListener = add;
      window.removeEventListener = remove;
    }
  });
});
