/**
 * Tests run in BC time everywhere (vitest.config.js, playwright.config.js):
 * a "today" taken from the UTC date matched the page's local day on GitHub
 * (UTC) and failed on a teacher's Mac every evening (Nov 24 2026: three
 * suites). This holds the zone, and keeps the mistake out of new tests.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname;

function files(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'fixtures' ? [] : files(p);
    return /\.(js|mjs)$/.test(name) ? [p] : [];
  });
}

describe('tests run in BC time', () => {
  it('the zone is America/Vancouver', () => {
    expect(process.env.TZ).toBe('America/Vancouver');
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Vancouver');
  });

  it('no test takes "today" from the UTC date', () => {
    const utcToday = /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/;
    const found = [...files(join(ROOT, 'tests')), ...files(join(ROOT, 'e2e'))]
      .filter(p => !p.endsWith('time-zone.test.js'))
      .filter(p =>
        readFileSync(p, 'utf8')
          .split('\n')
          .some(line => utcToday.test(line) && !/^\s*(\*|\/\/)/.test(line)),
      )
      .map(p => relative(ROOT, p));
    expect(found, "use new Date().toLocaleDateString('en-CA'), the local day").toEqual([]);
  });

  /* The app too (Nov 24 2026: the class backup was named, and a student added after 5 p.m. was enrolled,
     with tomorrow's date). A fallback after courseToday or getTodayStr, for a page without them, is allowed. */
  it('the app takes no "today" from the UTC date', () => {
    const utcToday = /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/;
    const found = ['shared', 'teacher', 'teacher-mobile', 's']
      .flatMap(d => files(join(ROOT, d)))
      .flatMap(p =>
        readFileSync(p, 'utf8')
          .split('\n')
          .map((line, i) => ({ line, at: relative(ROOT, p) + ':' + (i + 1) }))
          .filter(
            ({ line }) => utcToday.test(line) && !/^\s*(\*|\/\/)/.test(line) && !/courseToday|getTodayStr/.test(line),
          )
          .map(({ at }) => at),
      );
    expect(found, "use courseToday(cid), the class's day in BC time").toEqual([]);
  });
});
