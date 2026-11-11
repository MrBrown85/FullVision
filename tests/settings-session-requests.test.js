/**
 * A teacher with one computer sees no change in what Class Settings sends,
 * but for three things the stale-settings fix set out to change.
 *
 * tests/helpers/settings-session.js runs one sitting in Class Settings
 * (open the app, change every setting, save categories, copy a grading
 * setup, work with no connection and come back, reload, reopen) and logs
 * every request. tests/fixtures/settings-session-main.json is the same
 * sitting on the commit before the fix (scripts/settings-session-main-log.mjs
 * wrote it). This test walks the two side by side.
 *
 * Allowed, and nothing else:
 *   - an update_course with fewer keys, the ones left out being keys that
 *     only repeated what the server already held;
 *   - no update_course at all for a save that changed nothing;
 *   - one list_categories read before a save_categories.
 *
 * With FV_SESSION_LOG set, the test only writes its log there: that is how
 * the script records the other commit.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compareLogs, runSession } from './helpers/settings-session.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recordTo = process.env.FV_SESSION_LOG;

describe('one computer, one sitting in Class Settings', () => {
  it.runIf(recordTo)('writes what this commit sends', async () => {
    const run = await runSession();
    writeFileSync(recordTo, JSON.stringify(run));
    expect(run.log.length).toBeGreaterThan(20);
  });

  it.skipIf(recordTo)('sends what it sent before the fix, but for the three things the fix changed', async () => {
    const main = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/settings-session-main.json'), 'utf-8'));
    const run = await runSession();
    const diff = compareLogs(main.log, run.log, main.start);

    expect(diff.notAllowed).toEqual([]);
    // The server ends the sitting holding the same class either way.
    expect(run.final).toEqual(main.final);
    expect(run.start).toEqual(main.start);

    // The numbers the pull request quotes. A change to the session, or to
    // what a save sends, moves them: read the lists before changing them.
    expect({
      requestsBefore: diff.requests.before,
      requestsNow: diff.requests.after,
      identical: diff.same,
      fewerKeys: diff.fewerKeys.length,
      notSent: diff.notSent.length,
      categoryRead: diff.categoryRead.length,
    }).toEqual({
      requestsBefore: 44,
      requestsNow: 44,
      identical: 25,
      fewerKeys: 15,
      notSent: 4,
      categoryRead: 4,
    });
    expect(diff.requests.before - diff.notSent.length + diff.categoryRead.length).toBe(diff.requests.after);

    // Every update_course now names the one setting its step changed; the
    // one with two is Copy Grading Setup, which changed two.
    const sent = run.log.filter(e => e.name === 'update_course').map(e => Object.keys(e.params.p_patch));
    expect(sent.filter(keys => keys.length !== 1)).toEqual([['round_percent', 'level_order']]);
    // Rule 6: only server ids reach the server. And never the outbox's mark.
    const ids = [];
    run.log.forEach(e => {
      if (!e.name) return;
      ['p_course_id', 'p_id'].forEach(k => k in e.params && ids.push(e.params[k]));
      (e.params.p_categories || []).forEach(c => 'id' in c && ids.push(c.id));
      (e.params.p_ids || []).forEach(v => ids.push(v));
    });
    expect(ids.length).toBeGreaterThan(20);
    expect(ids.filter(v => !UUID.test(String(v)))).toEqual([]);
    expect(JSON.stringify(run.log)).not.toContain('_changed_only');
  });
});
