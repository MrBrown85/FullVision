/**
 * An undefined name in a file listed in scripts/lint-ratchet.mjs fails the
 * build (S19-D15). The lint runs on the real tree and on edited copies passed
 * through stdin, so no tracked file is written.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
    expect(Object.keys(NO_UNDEF_FILES)).toContain('shared/data-roster.js');
    expect(Object.keys(NO_UNDEF_FILES).length).toBeGreaterThanOrEqual(24);
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
    expect(r.stdout).toContain("'rosterTypo' is not defined");
  }, 60000);

  it('fails when a covered file uses a name only the desktop page defines', () => {
    // Router is teacher/router.js, which the phone does not load.
    const r = ratchet(
      ['--stdin-filename', 'shared/data-assessments.js'],
      withLine('shared/data-assessments.js', 'Router.getCurrentPage();'),
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("'Router' is not defined");
  }, 60000);

  it('does not fail on warnings', () => {
    const r = ratchet(
      ['--stdin-filename', 'shared/data-roster.js'],
      withLine('shared/data-roster.js', 'function _ratchetUnusedLocals() { var unusedLocal; }'),
    );
    expect(r.status).toBe(0);
  }, 60000);
});
