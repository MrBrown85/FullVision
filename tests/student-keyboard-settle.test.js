/**
 * s/keyboard-settle.js: after a typing field lets go of the focus (the
 * on-screen keyboard closes), the page moves one pixel and back so an iPhone
 * measures the screen again and the tab bar returns to the bottom. Not when
 * the focus went to another field, and not for a button.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function page(scrollY) {
  const listeners = {};
  const calls = [];
  const win = {
    scrollX: 0,
    scrollY,
    scrollTo: (x, y) => calls.push([x, y]),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
  };
  const doc = {
    activeElement: null,
    addEventListener: (type, fn) => (listeners[type] = fn),
  };
  win.window = win;
  win.document = doc;
  vm.runInNewContext(readFileSync('s/keyboard-settle.js', 'utf8'), win);
  return { win, doc, calls, blur: el => listeners.focusout({ target: el }) };
}

describe('the page after the keyboard closes', () => {
  it('moves one pixel and back once a text box lets go and nothing else has the focus', () => {
    vi.useFakeTimers();
    const p = page(400);
    p.blur({ tagName: 'TEXTAREA' });
    vi.advanceTimersByTime(200);
    expect(p.calls).toEqual([
      [0, 399],
      [0, 400],
    ]);
    vi.useRealTimers();
  });

  it('at the top of the page it moves down and back', () => {
    vi.useFakeTimers();
    const p = page(0);
    p.blur({ tagName: 'INPUT' });
    vi.advanceTimersByTime(200);
    expect(p.calls).toEqual([
      [0, 1],
      [0, 0],
    ]);
    vi.useRealTimers();
  });

  it('does nothing when the focus moved to another field, or when a button lets go', () => {
    vi.useFakeTimers();
    const p = page(300);
    p.doc.activeElement = { tagName: 'INPUT' };
    p.blur({ tagName: 'TEXTAREA' });
    vi.advanceTimersByTime(200);
    p.doc.activeElement = null;
    p.blur({ tagName: 'BUTTON' });
    vi.advanceTimersByTime(200);
    expect(p.calls).toEqual([]);
    vi.useRealTimers();
  });
});
