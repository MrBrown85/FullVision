/**
 * The golden grades with Demo Mode's quizzes on (slice Q4 of
 * docs/plans/quizzes-plan.md, "The tests that hold it"): the frozen Demo
 * class of tests/golden-grades.test.js, with the quizzes switch on, so its
 * sample quizzes are made, one of them answered by every student who sent it.
 * Before Confirm every grade in tests/fixtures/golden-grades.json is what it
 * was: answers and suggestions move nothing.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, GOLDEN, canonical, differences, loadDemoClass, recordClass } from './helpers/golden-grades.js';

describe('golden grades with the sample quizzes answered', () => {
  let wasDemo;
  let realOn;
  let cid;
  beforeAll(() => {
    wasDemo = window.isDemoMode;
    realOn = BuildFlags.on;
    // The switch on through the seed (loadDemoClass clears localStorage first).
    BuildFlags.on = name => name === 'quizzes' || realOn(name);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    cid = loadDemoClass();
  });
  afterAll(() => {
    vi.useRealTimers();
    BuildFlags.on = realOn;
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  it('the sample quizzes are there, and answered', () => {
    const tries = JSON.parse(localStorage.getItem('gb-quiz-tries-sci8'));
    const answered = tries['sci8-quiz-plant-growth'];
    expect(Object.keys(answered)).toHaveLength(18);
    expect(
      getAssessments(cid)
        .filter(a => /^sci8-quiz-/.test(a.id))
        .map(a => a.id),
    ).toEqual(['sci8-quiz-data-patterns', 'sci8-quiz-plant-growth']);
  });

  it('every grade matches tests/fixtures/golden-grades.json', () => {
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf-8')).classes['demo-science-8'];
    const now = canonical(recordClass(cid).record, '');
    // The two sample pieces are new pieces with no score: each student's level
    // and percent on them is nothing (null). Every other grade is the golden one.
    const diffs = differences(golden, now);
    const newPieces = diffs.filter(d =>
      /› work(Level|Percent) › sci8-quiz-(data-patterns|plant-growth): golden nothing, now null$/.test(d),
    );
    expect(newPieces).toHaveLength(getStudents(cid).length * 4);
    expect(diffs.filter(d => newPieces.indexOf(d) < 0)).toEqual([]);
  });
});
