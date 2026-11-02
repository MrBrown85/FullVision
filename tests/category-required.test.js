/**
 * A category on every assessment (docs/DECISIONS.md, 2026-11-01). In a
 * class with categories, scored work can't be saved without one, as in
 * Teams; work saved before the rule is marked "Needs a Category". A class
 * with no categories, and DIBELS work, need none.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

const CATS = 'cls-cats';
const NONE = 'cls-none';

function seed() {
  _cache.categories[CATS] = [
    { id: 'k-tests', name: 'Tests', weight: 60, displayOrder: 0 },
    { id: 'k-hw', name: 'Homework', weight: 40, displayOrder: 1 },
  ];
  _cache.categories[NONE] = [];
}

describe('categoryRequired and assessmentNeedsCategory', () => {
  beforeEach(() => {
    localStorage.clear();
    seed();
  });

  it('requires a category on scored work in a class that has categories', () => {
    expect(categoryRequired(CATS, { scoreMode: 'proficiency' })).toBe(true);
    expect(categoryRequired(CATS, { scoreMode: 'points', maxPoints: 10 })).toBe(true);
    expect(categoryRequired(CATS, { scoreMode: 'complete' })).toBe(true);
    expect(categoryRequired(CATS, { rubricId: 'r1' })).toBe(true);
    // A new assessment in the form, before any scoring is chosen.
    expect(categoryRequired(CATS, undefined)).toBe(true);
  });

  it('requires none in a class with no categories, or on DIBELS work', () => {
    expect(categoryRequired(NONE, { scoreMode: 'points' })).toBe(false);
    expect(categoryRequired(CATS, { scoreMode: 'dibels' })).toBe(false);
  });

  it('marks work with no category, or one that is gone', () => {
    expect(assessmentNeedsCategory(CATS, { id: 'a1' })).toBe(true);
    expect(assessmentNeedsCategory(CATS, { id: 'a2', categoryId: 'k-deleted' })).toBe(true);
    expect(assessmentNeedsCategory(CATS, { id: 'a3', category_id: 'k-gone' })).toBe(true);
  });

  it("doesn't mark work that has a category, any work in a class with none, or DIBELS work", () => {
    expect(assessmentNeedsCategory(CATS, { id: 'a1', categoryId: 'k-tests' })).toBe(false);
    expect(assessmentNeedsCategory(CATS, { id: 'a2', category_id: 'k-hw' })).toBe(false);
    expect(assessmentNeedsCategory(NONE, { id: 'a3' })).toBe(false);
    expect(assessmentNeedsCategory(CATS, { id: 'a4', scoreMode: 'dibels' })).toBe(false);
    expect(assessmentNeedsCategory(CATS, null)).toBe(false);
  });

  it("doesn't change what the work counts for", () => {
    COURSES[CATS] = { id: CATS, name: 'Math 10', gradingSystem: 'letter' };
    expect(assessmentCourseWorth(CATS, { id: 'a1' })).toEqual({ kind: 'uncategorized' });
  });
});

describe('copying into a class with categories', () => {
  var stubDocument;
  var doc;
  var originalInit;
  const SRC = 'cls-src';

  beforeEach(() => {
    localStorage.clear();
    _useSupabase = false;
    seed();
    _cache.categories[SRC] = [{ id: 's-quiz', name: 'Quizzes', weight: 100, displayOrder: 0 }];
    [SRC, CATS].forEach(cid => {
      _cache.learningMaps[cid] = { subjects: [], sections: [], _customized: true, _version: 1 };
      _cache.rubrics[cid] = [];
      _cache.modules[cid] = [];
      _cache.assessments[cid] = [];
    });
    saveCourses({ [SRC]: { id: SRC, name: 'Math 10 A' }, [CATS]: { id: CATS, name: 'Math 10 B' } });
    originalInit = globalThis.initData;
    globalThis.initData = () => Promise.resolve();
    stubDocument = globalThis.document;
    doc = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    globalThis.document = doc;
  });

  afterEach(() => {
    globalThis.document = stubDocument;
    globalThis.initData = originalInit;
  });

  const quiz = extra =>
    Object.assign(
      {
        id: 'q1',
        title: 'Quiz 1',
        date: '2026-11-01',
        categoryId: 's-quiz',
        tagIds: [],
        scoreMode: 'points',
        maxPoints: 10,
        copyGroup: '11111111-2222-4333-8444-555555555555',
      },
      extra,
    );

  it('picks nothing for the teacher and blocks Add until a category is chosen', async () => {
    const done = AssessmentCopy.copyToClasses(SRC, quiz(), [{ cid: CATS }]);
    await new Promise(r => setTimeout(r, 0));
    const sel = doc.querySelector('[data-copy-cat]');
    expect(sel.value).toBe('');
    expect(sel.options[0].textContent).toBe('Choose a Category');
    expect(doc.querySelector('.af-category-hint').textContent).toBe(CATEGORY_REQUIRED_HINT);

    doc.querySelector('[data-copy-ok]').click();
    // Still open, nothing added.
    expect(doc.querySelector('.copy-dialog')).toBeTruthy();
    expect(sel.getAttribute('aria-invalid')).toBe('true');
    expect(getAssessments(CATS)).toHaveLength(0);

    // linkedom's select has no value setter; choose the option.
    sel.options[0].removeAttribute('selected');
    sel.querySelector('option[value="k-hw"]').setAttribute('selected', '');
    doc.querySelector('[data-copy-ok]').click();
    await done;
    expect(doc.querySelector('.copy-dialog')).toBeNull();
    const copies = getAssessments(CATS);
    expect(copies).toHaveLength(1);
    expect(copies[0].categoryId).toBe('k-hw');
  });

  it('lets DIBELS work go in with no category', async () => {
    const done = AssessmentCopy.copyToClasses(SRC, quiz({ scoreMode: 'dibels', maxPoints: undefined }), [
      { cid: CATS },
    ]);
    await new Promise(r => setTimeout(r, 0));
    expect(doc.querySelector('.af-category-hint')).toBeNull();
    doc.querySelector('[data-copy-ok]').click();
    await done;
    const copies = getAssessments(CATS);
    expect(copies).toHaveLength(1);
    expect(copies[0].categoryId).toBeUndefined();
  });
});
