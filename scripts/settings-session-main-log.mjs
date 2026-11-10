#!/usr/bin/env node
/* What one sitting in Class Settings sent on another commit.
 *
 *   node scripts/settings-session-main-log.mjs [ref] [--print]
 *
 * tests/settings-session-requests.test.js compares what this code sends
 * during one scripted sitting with what the code before the stale-settings
 * fix sent. This script records that "before": it unpacks `ref` (default
 * d7e84209, main as it was when the fix branched) into a temporary folder,
 * copies the session and its stand-in server there, runs it, and writes the
 * log to tests/fixtures/settings-session-main.json.
 *
 * --print also runs the session on this checkout and prints the comparison,
 * request by request, as the pull request quotes it.
 *
 * Reads git and runs vitest; touches no database. FV_SESSION_TMP names the
 * folder to work in (default: the system's temporary folder).
 */
import { execFileSync } from 'child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const print = args.includes('--print');
const ref = args.find(a => !a.startsWith('--')) || 'd7e84209';
const FIXTURE = 'tests/fixtures/settings-session-main.json';
const SESSION = [
  'tests/settings-session-requests.test.js',
  'tests/helpers/settings-session.js',
  'tests/helpers/class-settings-server.js',
];

const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf-8' }).trim();
const sha = git('rev-parse', '--short=8', ref + '^{commit}');

function runSessionIn(dir) {
  const out = join(dir, 'settings-session-log.json');
  execFileSync(join(root, 'node_modules/.bin/vitest'), ['run', SESSION[0]], {
    cwd: dir,
    env: Object.assign({}, process.env, { FV_SESSION_LOG: out }),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const run = JSON.parse(readFileSync(out, 'utf-8'));
  rmSync(out);
  return run;
}

const work = mkdtempSync(join(process.env.FV_SESSION_TMP || tmpdir(), 'fv-settings-session-'));
try {
  execFileSync('sh', ['-c', 'git archive "$1" | tar -x -C "$2"', 'sh', sha, work], { cwd: root });
  symlinkSync(join(root, 'node_modules'), join(work, 'node_modules'));
  SESSION.forEach(file => cpSync(join(root, file), join(work, file)));
  const run = runSessionIn(work);
  const fixture = {
    about:
      'What one sitting in Class Settings sent on the commit named in `ref`, before the stale-settings fix. ' +
      'Written by scripts/settings-session-main-log.mjs; read by tests/settings-session-requests.test.js. Not edited by hand.',
    ref: sha,
    start: run.start,
    final: run.final,
    log: run.log,
  };
  writeFileSync(join(root, FIXTURE), JSON.stringify(fixture, null, 2) + '\n');
  execFileSync(join(root, 'node_modules/.bin/prettier'), ['--write', FIXTURE], { cwd: root, stdio: 'ignore' });
  console.log('Wrote ' + FIXTURE + ' from ' + sha + ': ' + run.log.filter(e => e.name).length + ' requests.');

  if (print) {
    const { compareLogs } = await import(join(root, 'tests/helpers/settings-session.js'));
    const here = runSessionIn(root);
    const diff = compareLogs(run.log, here.log, run.start);
    const keys = list => list.join(', ');
    console.log('\nBefore (' + sha + '): ' + diff.requests.before + ' requests. Now: ' + diff.requests.after + '.');
    console.log('Identical: ' + diff.same);
    console.log('update_course with fewer keys: ' + diff.fewerKeys.length);
    diff.fewerKeys.forEach(d =>
      console.log('  ' + d.step + ': sends ' + keys(d.sent) + '; no longer sends ' + keys(d.leftOut)),
    );
    console.log('update_course not sent (the save changed nothing): ' + diff.notSent.length);
    diff.notSent.forEach(d => console.log('  ' + d.step + ': was ' + keys(d.keys)));
    console.log('list_categories read before a category save: ' + diff.categoryRead.length);
    diff.categoryRead.forEach(d => console.log('  ' + d.step + ': before ' + d.before));
    console.log('Not allowed: ' + diff.notAllowed.length);
    diff.notAllowed.forEach(d => console.log('  ' + JSON.stringify(d)));
    console.log(
      'The server ends holding the same class: ' +
        (JSON.stringify(here.final) === JSON.stringify(run.final) ? 'yes' : 'NO'),
    );
    if (diff.notAllowed.length) process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
