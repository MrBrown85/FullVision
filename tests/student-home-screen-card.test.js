/**
 * s/home-screen-card.js: the Add to Home Screen card shows on an iPhone or
 * iPad in Safari that is not opened from the Home Screen, and nowhere else.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const win = { window: null };
win.window = win;
vm.runInNewContext(readFileSync('s/home-screen-card.js', 'utf8'), win);
const { shouldShow, html, KEY } = win.HomeScreenCard;

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const store = v => ({ getItem: () => v });
const env = (nav, o = {}) => ({
  nav,
  win: { matchMedia: () => ({ matches: !!o.standalone }) },
  store: store(o.dismissed ? '1' : null),
});

describe('the Add to Home Screen card', () => {
  it('shows on an iPhone in Safari', () => {
    expect(shouldShow(env({ userAgent: IPHONE, standalone: false }))).toBe(true);
  });
  it('shows on an iPad that says it is a Mac', () => {
    const nav = { userAgent: 'Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 5 };
    expect(shouldShow(env(nav))).toBe(true);
  });
  it('hides from the Home Screen', () => {
    expect(shouldShow(env({ userAgent: IPHONE, standalone: true }))).toBe(false);
    expect(shouldShow(env({ userAgent: IPHONE }, { standalone: true }))).toBe(false);
  });
  it('hides on Android, a Mac and Chrome on an iPhone', () => {
    expect(shouldShow(env({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36' }))).toBe(
      false,
    );
    expect(shouldShow(env({ userAgent: 'Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 0 }))).toBe(false);
    expect(shouldShow(env({ userAgent: IPHONE + ' CriOS/120' }))).toBe(false);
  });
  it('hides after Not Now', () => {
    expect(shouldShow(env({ userAgent: IPHONE }, { dismissed: true }))).toBe(false);
    expect(KEY).toBe('sp-a2hs-dismissed');
  });
  it('says its one line only after sign-in', () => {
    expect(html(false)).not.toContain('sign in once');
    expect(html(true)).toContain('You’ll sign in once in the app.');
  });
  it('is not loaded by the teacher’s Preview as Student', () => {
    expect(readFileSync('teacher/app.html', 'utf8')).not.toContain('home-screen-card');
  });
});
