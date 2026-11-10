/**
 * The invariant (student page build plan 1.3; risk "Returned-only and
 * all-work disagree when they should not"):
 *
 *   When no grade is a draft, returned-only and all-work give the same
 *   number for every student.
 *
 * Held on the Demo class and the eval fixture, for everything the golden
 * file records: every view, grading style and switch, read through the
 * golden test's own extraction (tests/helpers/golden-grades.js), once in
 * all-work and once inside withReturnedOnly. "No grade is a draft" is tried
 * both ways it can be true: a class with no grade_return rows at all, and a
 * class where every grade has a returned row, as the backfill leaves it.
 *
 * And directly: the returned-only record, with no drafts, is
 * tests/fixtures/golden-grades.json byte for byte. This test never writes
 * that file.
 *
 * The returned set comes from the reference builder in
 * tests/helpers/returned-scores.js. The clock is frozen as in the golden
 * test.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  FROZEN_AT,
  GOLDEN,
  canonical,
  differences,
  loadDemoClass,
  loadEvalClass,
  recordClass,
} from './helpers/golden-grades.js';
import { everyGradeReturned, installReturnedScores } from './helpers/returned-scores.js';

const CLASSES = [
  ['demo-science-8', loadDemoClass],
  ['eval-history-12', loadEvalClass],
];

describe('with no grade a draft, returned-only gives what all-work gives', () => {
  const allWork = {};
  const noRows = {};
  const everyRowReturned = {};
  const drift = [];
  const reads = {};
  const setsSeen = [];
  let installed;
  let wasDemo;

  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    const rowsByClass = {};
    installed = installReturnedScores(rowsByClass, { steady: true });
    CLASSES.forEach(([name, load]) => {
      const cid = load();
      const record = (into, inReturned) => {
        const before = installed.calls();
        const result = inReturned
          ? withReturnedOnly(() => {
              setsSeen.push(_scoreSet);
              return recordClass(cid);
            })
          : recordClass(cid);
        into[name] = result.record;
        result.drift.forEach(d => drift.push(name + ' › ' + d));
        return installed.calls() - before;
      };
      reads[name] = { allWork: record(allWork, false) };
      rowsByClass[cid] = undefined;
      reads[name].noRows = record(noRows, true);
      rowsByClass[cid] = everyGradeReturned(cid);
      reads[name].everyRowReturned = record(everyRowReturned, true);
    });
  }, 60000);

  afterAll(() => {
    installed.remove();
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  it('really read the returned set, and only inside withReturnedOnly', () => {
    expect(setsSeen).toEqual(['returned', 'returned', 'returned', 'returned']);
    expect(_scoreSet).toBe('all');
    CLASSES.forEach(([name]) => {
      expect(reads[name].allWork, name).toBe(0);
      expect(reads[name].noRows, name).toBeGreaterThan(1000);
      expect(reads[name].everyRowReturned, name).toBeGreaterThan(1000);
    });
    expect(drift).toEqual([]);
  });

  it.each(CLASSES)('%s: the same in a class with no grade_return rows', name => {
    expect(differences(canonical(allWork[name], ''), canonical(noRows[name], ''))).toEqual([]);
  });

  it.each(CLASSES)('%s: the same in a class where every grade has a returned row', name => {
    expect(differences(canonical(allWork[name], ''), canonical(everyRowReturned[name], ''))).toEqual([]);
  });

  it('is tests/fixtures/golden-grades.json byte for byte, both ways', () => {
    const golden = readFileSync(GOLDEN, 'utf-8');
    const asFile = classes => JSON.stringify(canonical({ frozenAt: FROZEN_AT, classes }, ''), null, 2) + '\n';
    expect(asFile(noRows) === golden, 'no grade_return rows').toBe(true);
    expect(asFile(everyRowReturned) === golden, 'every grade returned').toBe(true);
    // And so is all-work, as the golden test checks on its own.
    expect(asFile(allWork) === golden, 'all work').toBe(true);
  });
});
