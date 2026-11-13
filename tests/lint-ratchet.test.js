/**
 * An undefined name in a file listed in scripts/lint-ratchet.mjs fails the
 * build (S19-D15). The lint runs on the real tree and on edited copies passed
 * through stdin, so no tracked file is written.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pageGlobals } from '../scripts/lint-globals.mjs';
import { NO_UNDEF_FILES } from '../scripts/lint-ratchet.mjs';

const ROOT = join(new URL('.', import.meta.url).pathname, '..');
const SCRIPT = join(ROOT, 'scripts/lint-ratchet.mjs');

function ratchet(args, input) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, input, encoding: 'utf8' });
}

function withLine(file, line) {
  return readFileSync(join(ROOT, file), 'utf8') + '\n' + line + '\n';
}

describe('lint ratchet', () => {
  it('covers the data files split out of shared/data.js', () => {
    expect(NO_UNDEF_FILES).toContain('shared/data-roster.js');
    expect(NO_UNDEF_FILES.length).toBeGreaterThanOrEqual(24);
  });

  it('passes on the real tree', () => {
    const r = ratchet([]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  }, 60000);

  it('fails when a covered file gains an undefined name', () => {
    const r = ratchet(
      ['--stdin-filename', 'shared/data-roster.js'],
      withLine('shared/data-roster.js', 'rosterTypo();'),
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("'rosterTypo' is not defined by any script the pages load");
  }, 60000);

  it('fails when a covered file uses a name only the desktop page defines', () => {
    // Router is teacher/router.js, which the phone does not load.
    const r = ratchet(
      ['--stdin-filename', 'shared/data-assessments.js'],
      withLine('shared/data-assessments.js', 'Router.getCurrentPage();'),
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("'Router' is not on every page that loads this file");
    expect(r.stdout).toContain('the phone does not load it');
  }, 60000);

  it('does not fail on warnings', () => {
    const r = ratchet(
      ['--stdin-filename', 'shared/data-roster.js'],
      withLine('shared/data-roster.js', 'function _ratchetUnusedLocals() { var unusedLocal; }'),
    );
    expect(r.status).toBe(0);
  }, 60000);

  it('reads the scripts each page loads on demand from the code', () => {
    const { pages } = pageGlobals(ROOT);
    expect(pages.desktop.runtime).toEqual(
      expect.arrayContaining(['shared/seed-data.js', 'curriculum_data.js', 'teacher/report-sheets.js']),
    );
    expect(pages.phone.runtime).toEqual(
      expect.arrayContaining(['shared/seed-data.js', 'curriculum_data.js', 'shared/bank-comment.js']),
    );
    for (const p of ['desktop', 'phone']) {
      for (const f of pages[p].runtime) expect(pages[p].scripts).not.toContain(f);
      expect(pages[p].tagGlobals).not.toHaveProperty('DEFAULT_COURSES');
    }
  });

  it('fails when a covered file uses an on-demand name unguarded', () => {
    // DEFAULT_COURSES is shared/seed-data.js, loaded only in Demo Mode.
    const r = ratchet(
      ['--stdin-filename', 'shared/data.js'],
      withLine('shared/data.js', 'var _ratchetCourses = DEFAULT_COURSES.x;'),
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("'DEFAULT_COURSES' is not on every page that loads this file");
    expect(r.stdout).toContain('shared/seed-data.js, which loads only on demand');
    expect(r.stdout).toContain('Guard this use with `typeof DEFAULT_COURSES`');
  }, 60000);

  it('fails on a new unguarded use of a name the file already uses guarded', () => {
    // data-rubrics.js calls showSyncToast behind a typeof guard; this call is not.
    const r = ratchet(
      ['--stdin-filename', 'shared/data-rubrics.js'],
      withLine('shared/data-rubrics.js', "showSyncToast('x', 'error');"),
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("'showSyncToast' is not on every page");
    expect(r.stdout).toContain('1 problem');
  }, 60000);

  it('fails on a guard that does not prove the name is there', () => {
    const r = ratchet(
      ['--stdin-filename', 'shared/data-roster.js'],
      withLine(
        'shared/data-roster.js',
        [
          "var _r1 = typeof LEARNING_MAP === 'undefined' ? LEARNING_MAP : null;",
          "var _r2 = typeof LEARNING_MAP !== 'undefined' || LEARNING_MAP;",
          "if (typeof Router === 'function') {} else Router.go();",
        ].join('\n'),
      ),
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('3 problems');
  }, 60000);

  it('passes guarded uses: if, ? : and &&', () => {
    const r = ratchet(
      ['--stdin-filename', 'shared/data-roster.js'],
      withLine(
        'shared/data-roster.js',
        [
          "if (typeof showSyncToast === 'function') showSyncToast('x');",
          "var _g1 = typeof LEARNING_MAP !== 'undefined' && LEARNING_MAP.x;",
          "var _g2 = typeof Router !== 'undefined' && Router.getCurrentPage ? Router.getCurrentPage() : null;",
          "if (typeof seedIfNeeded === 'function') { Promise.resolve().then(function () { seedIfNeeded(); }); }",
        ].join('\n'),
      ),
    );
    expect(r.stdout).not.toContain('error');
    expect(r.status).toBe(0);
  }, 60000);
});
