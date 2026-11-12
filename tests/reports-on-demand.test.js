/**
 * Scripts the router loads on demand (teacher/router.js _onDemand).
 *
 * Reports' scripts are not tags in teacher/app.html, so
 * tests/sw-precache.test.js, which reads the page's tags, no longer covers
 * them. Each one must still be precached by sw.js (Reports opens offline
 * after a first visit that never opened it), exist on disk, and not also be
 * a tag in app.html (it would run twice).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pageGlobals } from '../scripts/lint-globals.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swSource = readFileSync(resolve(root, 'sw.js'), 'utf-8');
const routerSource = readFileSync(resolve(root, 'teacher/router.js'), 'utf-8');

function precacheUrls() {
  const match = swSource.match(/const PRECACHE_URLS = (\[[\s\S]*?\]);/);
  expect(match).not.toBeNull();
  return new Function('return ' + match[1])();
}

// Every script path named in the router's _onDemand table.
function onDemandScripts() {
  const match = routerSource.match(/var _onDemand = (\{[\s\S]*?\n {2}\});/);
  expect(match).not.toBeNull();
  const table = new Function('return ' + match[1])();
  return Object.values(table).flatMap(spec => spec.scripts);
}

describe('scripts loaded on demand', () => {
  const scripts = onDemandScripts();

  it('the router names Reports and its scripts', () => {
    expect(scripts).toContain('/teacher/page-reports.js');
    expect(scripts.length).toBeGreaterThan(1);
  });

  it('are each in the service worker precache list', () => {
    const urls = precacheUrls();
    expect(scripts.filter(src => !urls.includes(src))).toEqual([]);
  });

  it('each exist on disk', () => {
    expect(scripts.filter(src => !existsSync(resolve(root, src.slice(1))))).toEqual([]);
  });

  it('are not also tags in teacher/app.html', () => {
    const html = readFileSync(resolve(root, 'teacher/app.html'), 'utf-8');
    const tagged = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1].split('?')[0]);
    expect(scripts.filter(src => tagged.includes(src))).toEqual([]);
  });

  it("are in the desktop page's lazy list for the linter", () => {
    const { lazy } = pageGlobals(root).pages.desktop;
    expect(scripts.filter(src => !lazy.includes(src.slice(1)))).toEqual([]);
  });
});
