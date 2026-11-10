/**
 * The golden grades (student page build plan, S0-P2: pin the math).
 *
 * Every student's grades in two classes, as shared/calc.js works them out,
 * compared with the committed file tests/fixtures/golden-grades.json:
 * - the Demo class: Demo Mode's Science 8 (shared/seed-data.js), built from
 *   the curriculum bank as Demo Mode builds it;
 * - the eval fixture: History 12 (tests/eval-fixture.js).
 *
 * This file must pass unchanged in every PR that does not say math in its title.
 *
 * What is recorded, for the year so far and as of each reporting term, in
 * each grading style a class can be set to (Proficiency, Letter, Both):
 * - levels (the same in every style; a test checks that): the overall
 *   proficiency, each competency's level, each section's, each folder's, and
 *   for the year so far each piece of work's level and percent;
 * - per style: the course level, percent and letter (getCourseLetterData),
 *   each category's level and percent, and the grade as the class shows it,
 *   only through formatLevel and studentGradeSummary.
 * And for the year so far in the class's own style, the switches that change
 * numbers, each way: Folders Count as One, each category's Calculation, and
 * the calculation method.
 * Numbers are kept at full precision. Everything is read through calc.js's
 * own functions; nothing here works out or formats a grade.
 *
 * The same every run: the clock is frozen at FROZEN_AT (Demo Mode moves its
 * dates so the class ends yesterday, and a letter under 50% turns on whether
 * the course has ended), nothing reads a random id, and keys are sorted.
 * Noon UTC is the same calendar day from UTC−11 to UTC+11.
 *
 * To regenerate the file, only in a PR whose title says math and that Colin
 * reviews (CLAUDE.md rule 2):
 *   UPDATE_GOLDEN=1 npx vitest run tests/golden-grades.test.js
 * then read the diff of tests/fixtures/golden-grades.json line by line.
 */
import './setup.js';
import { readFileSync, writeFileSync } from 'fs';
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

const UPDATE = process.env.UPDATE_GOLDEN === '1';

/* ── The tests ───────────────────────────────────────────────── */

describe('golden grades', () => {
  const snapshot = { frozenAt: FROZEN_AT, classes: {} };
  const drift = [];
  let wasDemo;

  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    [
      ['demo-science-8', loadDemoClass],
      ['eval-history-12', loadEvalClass],
    ].forEach(([name, load]) => {
      const cid = load();
      const result = recordClass(cid);
      snapshot.classes[name] = result.record;
      result.drift.forEach(d => drift.push(name + ' › ' + d));
    });
  });

  afterAll(() => {
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  it('records both classes in full', () => {
    const demo = snapshot.classes['demo-science-8'];
    const history = snapshot.classes['eval-history-12'];
    expect(Object.keys(demo.views).sort()).toEqual(['term-1', 'term-2', 'year']);
    expect(Object.keys(demo.views.year.levels)).toHaveLength(27);
    expect(Object.keys(demo.views.year.levels.st1.competencies)).toHaveLength(27);
    expect(Object.keys(demo.views.year.levels.st1.folders)).toHaveLength(6);
    expect(demo.settings.gradingStyle).toBe('proficiency');
    expect(Object.keys(history.views).sort()).toEqual(['term-1', 'year']);
    expect(Object.keys(history.views.year.levels)).toHaveLength(5);
    expect(history.settings.gradingStyle).toBe('letter');
  });

  it('gives the same levels in every grading style', () => {
    expect(drift).toEqual([]);
  });

  it('matches tests/fixtures/golden-grades.json', () => {
    const now = canonical(snapshot, '');
    if (UPDATE) {
      writeFileSync(GOLDEN, JSON.stringify(now, null, 2) + '\n');
      console.warn('Golden grades written to tests/fixtures/golden-grades.json. Read its diff before committing.');
      return;
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf-8'));
    const diffs = differences(golden, now);
    if (diffs.length) {
      const shown = diffs.slice(0, 40);
      throw new Error(
        diffs.length +
          ' grade' +
          (diffs.length === 1 ? '' : 's') +
          ' differ from tests/fixtures/golden-grades.json.\n' +
          'This file must pass unchanged in every PR that does not say math in its title.\n\n' +
          shown.join('\n') +
          (diffs.length > shown.length ? '\n… and ' + (diffs.length - shown.length) + ' more' : '') +
          '\n\nIf the change is meant, it is a math PR: say math in its title, regenerate with\n' +
          '  UPDATE_GOLDEN=1 npx vitest run tests/golden-grades.test.js\n' +
          'and have Colin review the diff.',
      );
    }
  });
});
