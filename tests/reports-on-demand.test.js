/**
 * Scripts the router loads on demand (teacher/router.js _onDemand).
 *
 * Reports' scripts, Assignments' rubric scripts, and the scripts one button
 * uses (Print Grades, Copy Grading Setup, the QR maker for slips and cards)
 * are not tags in teacher/app.html, so tests/sw-precache.test.js, which
 * reads the page's tags, no longer covers them. Each one must still be
 * precached by sw.js (each opens offline after a first visit that never
 * used it), exist on disk, and not also be a tag in app.html (it would run
 * twice).
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

// The router's _onDemand table.
function onDemandTable() {
  const match = routerSource.match(/var _onDemand = (\{[\s\S]*?\n {2}\});/);
  expect(match).not.toBeNull();
  return new Function('return ' + match[1])();
}

// Every script path named in the router's _onDemand table.
function onDemandScripts() {
  return Object.values(onDemandTable()).flatMap(spec => spec.scripts);
}

describe('scripts loaded on demand', () => {
  const scripts = onDemandScripts();

  it('the router names Reports and its scripts', () => {
    expect(scripts).toContain('/teacher/page-reports.js');
    expect(scripts.length).toBeGreaterThan(1);
  });

  it('the router names the print, QR and rubric-bank scripts, each where it is used', () => {
    const table = onDemandTable();
    expect(table['/assignments'].scripts).toEqual(['/teacher/rubric-library.js', '/teacher/rubric-bank.js']);
    expect(table.gradesPrint.scripts).toEqual(['/teacher/grades-print.js']);
    expect(table.gradingSetupCopy.scripts).toEqual(['/teacher/grading-setup-copy.js']);
    expect(table.qrcode.scripts).toEqual(['/vendor/qrcode.js']);
    // Each entry names the globals that say its scripts have run, and each
    // button's entry a title for its Could Not Open question.
    Object.entries(table).forEach(([key, spec]) => {
      expect(spec.needs || [spec.page], key).not.toContain(undefined);
      if (key.charAt(0) !== '/') expect(typeof spec.title, key).toBe('string');
    });
  });

  it('each button that uses one waits for it first', () => {
    const read = rel => readFileSync(resolve(root, rel), 'utf-8');
    expect(read('teacher/page-gradebook.js')).toMatch(
      /Router\.withScripts\('gradesPrint', function \(\) \{\s+if \(window\.GradesPrint\) GradesPrint\.open\(/,
    );
    expect(read('teacher/dash-class-manager.js')).toMatch(
      /Router\.withScripts\('gradingSetupCopy', function \(\) \{[\s\S]{0,400}GradingSetupCopy\.openDialog\(/,
    );
    // Every sheet of slips or cards prints through printSheet, the only caller of qrSvg's QR maker.
    expect(read('teacher/qr-slips.js')).toMatch(
      /function printSheet\(items, renderCell\) \{[\s\S]{0,200}Router\.withScripts\('qrcode', function \(\) \{/,
    );
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
