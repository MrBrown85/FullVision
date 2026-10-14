/**
 * A realtime refresh must not re-render the page while the teacher is typing.
 * The re-render replaced the points input mid-entry; Chrome blurred the
 * removed input, its handler saved the half-typed value ("1" of "16"), and
 * the number appeared to jump around (reported 2026-10-14).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('re-render while typing', () => {
  var renders, listeners, originalPage, originalActive, originalAdd;

  beforeEach(() => {
    renders = 0;
    listeners = [];
    originalPage = Router.getCurrentPage;
    originalActive = document.activeElement;
    originalAdd = document.addEventListener;
    Router.getCurrentPage = () => ({ render: () => renders++ });
    document.addEventListener = (type, fn) => listeners.push({ type, fn });
    _rerenderDeferred = false;
  });

  afterEach(() => {
    Router.getCurrentPage = originalPage;
    document.activeElement = originalActive;
    document.addEventListener = originalAdd;
    _rerenderDeferred = false;
  });

  function leaveField() {
    var pending = listeners.filter(l => l.type === 'focusout');
    listeners = listeners.filter(l => l.type !== 'focusout');
    pending.forEach(l => l.fn());
    return new Promise(r => setTimeout(r, 5));
  }

  it('renders at once when no field is focused', () => {
    document.activeElement = document.body;
    _invalidateAndRerender();
    expect(renders).toBe(1);
  });

  it('waits until the teacher leaves the field', async () => {
    document.activeElement = { tagName: 'INPUT' };
    _invalidateAndRerender();
    _invalidateAndRerender();
    expect(renders).toBe(0);
    expect(listeners.filter(l => l.type === 'focusout')).toHaveLength(1);

    document.activeElement = document.body;
    await leaveField();
    expect(renders).toBe(1);
  });

  it('keeps waiting when Enter moves focus into the next field', async () => {
    document.activeElement = { tagName: 'INPUT' };
    _invalidateAndRerender();

    // focusout fires, but the next points input already has focus.
    await leaveField();
    expect(renders).toBe(0);

    document.activeElement = document.body;
    await leaveField();
    expect(renders).toBe(1);
  });
});
