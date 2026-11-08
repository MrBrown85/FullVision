/**
 * Which app a teacher lands in — shared/device.js, and the home-screen
 * launcher (launch.html, the manifest's start_url).
 *
 * Nov 7 2026: an iPad home-screen icon opened the phone app, because the
 * manifest's start_url was /teacher-mobile/. An iPad should open the desktop
 * app; a phone, the phone app.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'shared/device.js'), 'utf-8');
const saved = { window: globalThis.window, localStorage: globalThis.localStorage };

function load(width, height, store = {}) {
  globalThis.window = { screen: { width, height } };
  globalThis.localStorage = { getItem: k => (k in store ? store[k] : null) };
  runInThisContext(source, { filename: 'shared/device.js' });
  return globalThis.teacherAppPath();
}

afterEach(() => {
  globalThis.window = saved.window;
  globalThis.localStorage = saved.localStorage;
});

describe('teacherAppPath', () => {
  it('sends a phone to the phone app, either way up', () => {
    expect(load(390, 844)).toBe('/teacher-mobile/');
    expect(load(932, 430)).toBe('/teacher-mobile/');
    expect(load(360, 780)).toBe('/teacher-mobile/');
  });

  it('sends every iPad to the desktop app, the iPad mini included', () => {
    expect(load(744, 1133)).toBe('/dashboard');
    expect(load(820, 1180)).toBe('/dashboard');
    expect(load(1366, 1024)).toBe('/dashboard');
  });

  it('sends a computer to the desktop app', () => {
    expect(load(1512, 982)).toBe('/dashboard');
  });

  it('keeps a phone on the desktop app after Switch to Desktop', () => {
    expect(load(390, 844, { 'td-mobile-pref': 'desktop' })).toBe('/dashboard');
  });
});

describe('home-screen launcher', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf-8'));
  const launch = readFileSync(resolve(root, 'launch.html'), 'utf-8');

  it('starts at launch.html with the whole site in scope', () => {
    expect(manifest.start_url).toBe('/launch.html');
    expect(manifest.scope).toBe('/');
  });

  it('goes on to the app teacherAppPath picks', () => {
    expect(launch).toContain('src="/shared/device.js"');
    expect(launch).toContain('location.replace(teacherAppPath())');
  });

  it('is part of the deploy', () => {
    expect(readFileSync(resolve(root, 'scripts/build.sh'), 'utf-8')).toMatch(/cp [^\n]*launch\.html/);
  });
});
