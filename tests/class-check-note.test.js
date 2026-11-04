/**
 * Switching to a class shows its saved copy, then asks the server whether it
 * changed. The sweep saw a score saved on the phone read "no score" for 3 to
 * 9 seconds after a switch, then change with no word: the "Checking for
 * updates…" note went when editing unlocked at 3 seconds. It now stays until
 * the server answers (30 seconds at most).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function classListStub() {
  var names = new Set();
  return {
    add: n => names.add(n),
    remove: n => names.delete(n),
    contains: n => names.has(n),
    toggle(n, force) {
      if (force === undefined ? !names.has(n) : force) names.add(n);
      else names.delete(n);
    },
  };
}

describe('the Checking for Updates note', () => {
  var originalBody;
  var originalHandle;
  var originalGetElementById;
  var answer;

  beforeEach(() => {
    vi.useFakeTimers();
    originalBody = document.body;
    originalHandle = globalThis._handleExternalCourseUpdate;
    originalGetElementById = document.getElementById;
    document.getElementById = () => null;
    document.body = { classList: classListStub(), setAttribute() {}, removeAttribute() {} };
    globalThis._handleExternalCourseUpdate = () =>
      new Promise(resolve => {
        answer = resolve;
      });
    _pageLocks.checking = 0;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body = originalBody;
    document.getElementById = originalGetElementById;
    globalThis._handleExternalCourseUpdate = originalHandle;
    _pageLocks.checking = 0;
  });

  it('stays after editing unlocks, until the server answers', async () => {
    var check = _startClassCheck(getActiveCourse());
    var classes = document.body.classList;

    vi.advanceTimersByTime(500);
    expect(classes.contains('fv-checking-slow')).toBe(true);
    expect(_pageLocks.checking).toBe(1);

    vi.advanceTimersByTime(4000);
    expect(_pageLocks.checking).toBe(0);
    expect(classes.contains('fv-checking-slow')).toBe(true);

    answer();
    await check;
    expect(classes.contains('fv-checking-slow')).toBe(false);
  });

  it('goes after 30 seconds even with no answer', () => {
    _startClassCheck(getActiveCourse());
    vi.advanceTimersByTime(29000);
    expect(document.body.classList.contains('fv-checking-slow')).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(document.body.classList.contains('fv-checking-slow')).toBe(false);
    answer();
  });
});
