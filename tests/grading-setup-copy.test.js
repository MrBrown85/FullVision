/**
 * One class's grading setup in another class (teacher/grading-setup-copy.js),
 * like Teams' Import settings. Categories are matched by name so their
 * assessments stay put; a category the source lacks is removed after its
 * work moves; reporting terms copy only when asked. Scores are never touched.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const A = 'cls-sci8-a';
const B = 'cls-sci8-b';
const C = 'cls-sci8-c';

const ALL = {
  gradingSystem: true,
  categories: true,
  calcMethod: true,
  roundPercent: true,
  lateWorkPolicy: true,
};

const TERMS = [
  { ordinal: 1, label: 'Term 1', starts_on: '2026-09-02', ends_on: '2026-11-20' },
  { ordinal: 2, label: 'Term 2', starts_on: '2026-11-23', ends_on: '2027-01-30' },
];

function catNames(cid) {
  return getCategories(cid)
    .slice()
    .sort((x, y) => x.displayOrder - y.displayOrder)
    .map(c => c.name + ' ' + c.weight);
}

describe('grading setup copies across classes', () => {
  var originalInit;

  beforeEach(() => {
    localStorage.clear();
    _useSupabase = false;
    originalInit = globalThis.initData;
    globalThis.initData = () => Promise.resolve();
    saveCourses({
      [A]: {
        id: A,
        name: 'Science 8 - Block A',
        gradingSystem: 'both',
        calcMethod: 'decayingAvg',
        decayWeight: 0.7,
        lateWorkPolicy: 'Late work loses 10% a day.',
      },
      [B]: { id: B, name: 'Science 8 B', gradingSystem: 'proficiency', calcMethod: 'mostRecent' },
      [C]: { id: C, name: 'Science 8 C', gradingSystem: 'proficiency', calcMethod: 'mostRecent' },
    });
    _cache.courseConfigs[A] = {
      calcMethod: 'decayingAvg',
      decayWeight: 0.7,
      roundPercent: false,
      reportingTerms: TERMS,
    };
    _cache.courseConfigs[B] = { roundPercent: true };
    _cache.courseConfigs[C] = {};
    _cache.categories[A] = [
      { id: 'a-lab', name: 'Labs', weight: 30, displayOrder: 0 },
      { id: 'a-test', name: 'Tests', weight: 50, displayOrder: 1 },
      { id: 'a-hw', name: 'Homework', weight: 20, displayOrder: 2 },
    ];
    _cache.categories[B] = [
      { id: 'b-test', name: 'tests', weight: 60, displayOrder: 0 },
      { id: 'b-quiz', name: 'Quizzes', weight: 40, displayOrder: 1 },
    ];
    _cache.categories[C] = [];
    _cache.assessments[A] = [];
    _cache.assessments[B] = [
      { id: 'b1', title: 'Unit test', categoryId: 'b-test' },
      { id: 'b2', title: 'Quiz 1', categoryId: 'b-quiz' },
      { id: 'b3', title: 'Quiz 2', categoryId: 'b-quiz' },
      { id: 'b4', title: 'Exit ticket', categoryId: null },
    ];
    _cache.assessments[C] = [{ id: 'c1', title: 'Lab report' }];
  });

  afterEach(() => {
    globalThis.initData = originalInit;
  });

  it('matches categories by name and lists what changes', () => {
    const cats = GradingSetupCopy.planCategories(A, B);
    expect(cats.rows.map(r => r.id)).toEqual([null, 'b-test', null]);
    expect(cats.removed).toEqual([{ id: 'b-quiz', name: 'Quizzes', count: 2 }]);
    expect(cats.uncategorized).toBe(1);
    expect(cats.same).toBe(false);
    expect(cats.lines).toContain('Add Labs at 30%.');
    expect(cats.lines).toContain('Tests: 60% → 50%.');
    expect(cats.lines).toContain('Rename tests to Tests.');
    expect(cats.lines).toContain('Remove Quizzes (2 assessments move).');
  });

  it('plans every setting and names the ones already the same', () => {
    _cache.courseConfigs[B].roundPercent = false;
    const plan = GradingSetupCopy.planSetup(A, B, ALL);
    const byKey = Object.fromEntries(plan.changes.map(c => [c.key, c.lines]));
    expect(byKey.gradingSystem).toEqual(['Proficiency → Both.']);
    expect(byKey.calcMethod).toEqual(['Most Recent → Decaying Avg (70%).']);
    expect(byKey.lateWorkPolicy).toEqual(['Use “Late work loses 10% a day.”.']);
    expect(plan.same).toEqual(['Course %']);
    expect(byKey.reportingTerms).toBeUndefined();
  });

  it('copies the setup and moves work out of removed categories', async () => {
    const plan = GradingSetupCopy.planSetup(A, B, ALL);
    // Quizzes' work goes to Homework (row 2); uncategorized work to Labs (row 0).
    await GradingSetupCopy.applySetup(plan, { 'b-quiz': 2, uncategorized: 0 });

    expect(catNames(B)).toEqual(['Labs 30', 'Tests 50', 'Homework 20']);
    const ids = Object.fromEntries(getCategories(B).map(c => [c.name, c.id]));
    expect(ids.Tests).toBe('b-test');
    const catOf = Object.fromEntries(getAssessments(B).map(a => [a.id, a.categoryId]));
    expect(catOf).toEqual({ b1: 'b-test', b2: ids.Homework, b3: ids.Homework, b4: ids.Labs });

    expect(COURSES[B].gradingSystem).toBe('both');
    expect(courseGradeMode(B)).toBe('both');
    expect(getCourseConfig(B).calcMethod).toBe('decayingAvg');
    expect(getCourseConfig(B).decayWeight).toBe(0.7);
    expect(getRoundWholePercent(B)).toBe(false);
    expect(COURSES[B].lateWorkPolicy).toBe('Late work loses 10% a day.');
    expect(getReportingTerms(B)).toEqual([]);
  });

  it('leaves work with no category when the teacher says so', async () => {
    const plan = GradingSetupCopy.planSetup(A, B, { categories: true });
    await GradingSetupCopy.applySetup(plan, { 'b-quiz': 1, uncategorized: null });
    const exit = getAssessments(B).find(a => a.id === 'b4');
    expect(exit.categoryId).toBeNull();
  });

  it('copies Rubric Levels, and names it when already the same', async () => {
    _cache.courseConfigs[A].levelOrder = 'asc';
    const plan = GradingSetupCopy.planSetup(A, B, { levelOrder: true });
    expect(plan.changes).toEqual([
      { key: 'levelOrder', label: 'Rubric Levels', lines: ['Extending First → Emerging First.'] },
    ]);
    await GradingSetupCopy.applySetup(plan, {});
    expect(levelOrderFor(B)).toEqual([1, 2, 3, 4]);
    expect(GradingSetupCopy.planSetup(A, B, { levelOrder: true }).same).toEqual(['Rubric Levels']);
    expect(GradingSetupCopy.describeSource(A).levelOrder).toBe('Emerging First');
  });

  it('copies reporting terms only when ticked', async () => {
    const plan = GradingSetupCopy.planSetup(A, C, { reportingTerms: true });
    expect(plan.changes[0].key).toBe('reportingTerms');
    await GradingSetupCopy.applySetup(plan, {});
    expect(getReportingTerms(C).map(t => t.label)).toEqual(['Term 1', 'Term 2']);
    expect(getCategories(C)).toEqual([]);
  });

  it('never clears categories from a source that has none', () => {
    const plan = GradingSetupCopy.planSetup(C, B, { categories: true });
    expect(plan.changes).toEqual([]);
    expect(plan.skipped[0]).toMatch(/has no categories/);
  });

  it('gives a class with no categories its first ones and offers to place its work', async () => {
    const plan = GradingSetupCopy.planSetup(A, C, { categories: true });
    expect(plan.categories.uncategorized).toBe(1);
    await GradingSetupCopy.applySetup(plan, { uncategorized: 1 });
    const tests = getCategories(C).find(c => c.name === 'Tests');
    expect(getAssessments(C)[0].categoryId).toBe(tests.id);
  });

  it('finds nothing to change once the classes match', async () => {
    await GradingSetupCopy.applySetup(GradingSetupCopy.planSetup(A, B, ALL), { 'b-quiz': 0, uncategorized: 0 });
    const again = GradingSetupCopy.planSetup(A, B, ALL);
    expect(again.changes).toEqual([]);
  });

  it('never touches scores', async () => {
    _cache.scores[B] = { s1: [{ assessmentId: 'b2', score: 3, tagId: 't1' }] };
    const before = JSON.stringify(_cache.scores[B]);
    await GradingSetupCopy.applySetup(GradingSetupCopy.planSetup(A, B, ALL), { 'b-quiz': 0 });
    expect(JSON.stringify(_cache.scores[B])).toBe(before);
  });
});
