/**
 * category: the tests that were tests/category-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

describe('category-average-of-percentages', () => {
  /**
   * A category set to Average of Percentages (category.calc_mode 'percent',
   * docs/DECISIONS.md "Category calculation"): each assessment becomes its
   * own percent, and the percents are averaged, each counted its Factor
   * times. Total Points (the default) pools points earned and possible, so a
   * 5-criterion rubric (20 points) outweighs a 2-criterion one (8 points).
   */

  const CID = 'course-avg-pct';
  const SID = 'stu-1';

  const crit = (id, tagId) => ({ id, name: id, tagIds: [tagId], levels: { 4: '', 3: '', 2: '', 1: '' }, weight: 1 });
  const RUBRICS = [
    { id: 'r-small', name: 'Two criteria', criteria: [crit('s1', 't1'), crit('s2', 't2')] },
    {
      id: 'r-big',
      name: 'Five criteria',
      criteria: [crit('b1', 't1'), crit('b2', 't2'), crit('b3', 't3'), crit('b4', 't4'), crit('b5', 't5')],
    },
  ];
  const small = { id: 'a-small', title: 'Assignment', rubricId: 'r-small', categoryId: 'k1', tagIds: ['t1', 't2'] };
  const big = {
    id: 'a-big',
    title: 'Current Events',
    rubricId: 'r-big',
    categoryId: 'k1',
    tagIds: ['t1', 't2', 't3', 't4', 't5'],
  };
  const quiz = { id: 'a-quiz', title: 'Quiz', scoreMode: 'points', maxPoints: 10, categoryId: 'k1', tagIds: [] };
  const test = { id: 'a-test', title: 'Unit Test', scoreMode: 'points', maxPoints: 36, categoryId: 'k1', tagIds: [] };
  const s = (aid, tagId, value) => ({ assessmentId: aid, tagId, score: value, mod: 0, date: '2026-10-10' });
  // Small rubric: 3 and 3 (6 of 8, 75%). Big rubric: five 2s (10 of 20, 50%).
  const RUBRIC_SCORES = [
    s('a-small', 't1', 3),
    s('a-small', 't2', 3),
    ...['t1', 't2', 't3', 't4', 't5'].map(t => s('a-big', t, 2)),
  ];

  function seed({ mode, assessments, scores, statuses, categories }) {
    _cache.rubrics[CID] = RUBRICS;
    _cache.assessments[CID] = assessments;
    _cache.scores[CID] = { [SID]: scores };
    _cache.statuses[CID] = statuses || {};
    _cache.categories[CID] = categories || [
      { id: 'k1', name: 'Assignments', weight: 100, displayOrder: 0, calcMode: mode },
    ];
    _cache.courseConfigs[CID] = { gradingSystem: 'letter', roundPercent: false };
    COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter' };
    clearProfCache();
  }
  const R = () => getCourseLetterData(CID, SID).R;

  describe('Average of Percentages', () => {
    beforeEach(() => localStorage.clear());

    it('pools points under Total Points, so the bigger rubric weighs more', () => {
      seed({ mode: 'points', assessments: [small, big], scores: RUBRIC_SCORES });
      // (6 + 10) / (8 + 20)
      expect(R()).toBe(57.1);
    });

    it('counts each assessment once under Average of Percentages', () => {
      seed({ mode: 'percent', assessments: [small, big], scores: RUBRIC_SCORES });
      // (75 + 50) / 2
      expect(R()).toBe(62.5);
    });

    it('treats an unset or unknown mode as Total Points', () => {
      seed({ mode: undefined, assessments: [small, big], scores: RUBRIC_SCORES });
      expect(R()).toBe(57.1);
      seed({ mode: 'median', assessments: [small, big], scores: RUBRIC_SCORES });
      expect(R()).toBe(57.1);
    });

    it('counts an assessment its Factor times', () => {
      seed({ mode: 'percent', assessments: [small, { ...big, weight: 2 }], scores: RUBRIC_SCORES });
      // (75 + 2 × 50) / 3
      expect(R()).toBe(58.3);
    });

    it('flattens points work too', () => {
      const scores = [s('a-quiz', 'a-quiz', 9), s('a-test', 'a-test', 18)];
      seed({ mode: 'points', assessments: [quiz, test], scores });
      // (9 + 18) / (10 + 36)
      expect(R()).toBe(58.7);
      seed({ mode: 'percent', assessments: [quiz, test], scores });
      // (90 + 50) / 2
      expect(R()).toBe(70);
    });

    it('counts Missing as 0% and leaves Excused out', () => {
      seed({
        mode: 'percent',
        assessments: [small, big, quiz],
        scores: RUBRIC_SCORES,
        statuses: { [SID + ':a-quiz']: 'NS' },
      });
      // (75 + 50 + 0) / 3
      expect(R()).toBe(41.7);
      seed({
        mode: 'percent',
        assessments: [small, big, quiz],
        scores: RUBRIC_SCORES,
        statuses: { [SID + ':a-quiz']: 'EXC' },
      });
      expect(R()).toBe(62.5);
    });

    it('weights categories with different modes as before', () => {
      seed({
        assessments: [small, big, { ...quiz, categoryId: 'k2' }],
        scores: [...RUBRIC_SCORES, s('a-quiz', 'a-quiz', 8)],
        categories: [
          { id: 'k1', name: 'Assignments', weight: 60, displayOrder: 0, calcMode: 'percent' },
          { id: 'k2', name: 'Quizzes', weight: 40, displayOrder: 1, calcMode: 'points' },
        ],
      });
      // 0.6 × 62.5 + 0.4 × 80
      expect(R()).toBe(69.5);
      expect(categoryCourseShares(CID, SID)).toEqual({
        k1: { points: 37.5, text: '37.5' },
        k2: { points: 32, text: '32.0' },
      });
    });

    it("grades a category group by the category's mode and other groups by points", () => {
      seed({ mode: 'percent', assessments: [small, big], scores: RUBRIC_SCORES });
      expect(assessmentGroupGrade(CID, SID, [small, big], 'percent').pct).toBeCloseTo(62.5, 5);
      expect(assessmentGroupGrade(CID, SID, [small, big]).pct).toBeCloseTo(57.142857, 5);
    });
  });
});

describe('category-calc-mode', () => {
  /**
   * A category's Calculation (category.calc_mode, migrations/
   * 20261029_category_calc_mode.sql): 'points' pools points earned and
   * possible, 'percent' averages each assessment's percent. This is the data
   * half; the course % reads it in the next change. Unset is 'points'.
   */

  const CID = 'course-calc-mode';

  describe('category calc mode in the cache', () => {
    it('reads calc_mode from the class bundle, points when the server sends none', () => {
      _v2GradebookToCache(CID, {
        course: { id: CID },
        students: [],
        assessments: [],
        categories: [
          { id: 'k1', name: 'Tests', weight: 60, display_order: 0, calc_mode: 'percent' },
          { id: 'k2', name: 'Labs', weight: 40, display_order: 1 },
        ],
        modules: [],
        cells: {},
      });
      expect(getCategories(CID).map(c => [c.name, c.calcMode])).toEqual([
        ['Tests', 'percent'],
        ['Labs', 'points'],
      ]);
    });

    it('names anything but percent as points', () => {
      expect(categoryCalcMode({ calcMode: 'percent' })).toBe('percent');
      expect(categoryCalcMode({ calc_mode: 'percent' })).toBe('percent');
      expect(categoryCalcMode({ calcMode: 'median' })).toBe('points');
      expect(categoryCalcMode({})).toBe('points');
      expect(categoryCalcMode(null)).toBe('points');
    });
  });
});

describe('category-integrity', () => {
  /**
   * Categories and the letter grade (docs/grading-compliance-plan.md 1.4).
   * In a class with categories, work with no category counts toward no letter
   * grade. Deleting a category used to leave its work with none (category_id
   * is `on delete set null`). Like Schoology, the class manager now moves a
   * category's work to another category before deleting it, and lists work
   * that has no category so it can be given one.
   */

  const CID = 'course-cats';

  describe('category integrity', () => {
    var originalV2;
    var originalGetById;
    var saved;
    var moveTarget;

    beforeEach(async () => {
      localStorage.clear();
      saveCourses({ [CID]: { id: CID, name: 'Math 10', gradingSystem: 'letter' } });
      _cache.assessments[CID] = [
        { id: 'x1', title: 'Quiz 1', categoryId: 'k1', tagIds: [] },
        { id: 'x2', title: 'Quiz 2', categoryId: 'k1', tagIds: [] },
        { id: 'x3', title: 'Old work', tagIds: [] },
        { id: 'x4', title: 'Homework 1', categoryId: 'k2', tagIds: [] },
      ];
      saved = [];
      moveTarget = 'k2';
      originalV2 = { list: window.v2.listCategories, save: window.v2.saveCategories };
      window.v2.listCategories = () =>
        Promise.resolve({
          data: [
            { id: 'k1', name: 'Tests', weight: 60, display_order: 0 },
            { id: 'k2', name: 'Homework', weight: 40, display_order: 1 },
          ],
        });
      window.v2.saveCategories = (cid, rows) => {
        saved.push(rows.map(r => r.id));
        return Promise.resolve({ data: rows.map(r => r.id), error: null });
      };
      originalGetById = document.getElementById;
      document.getElementById = id =>
        id === 'cm-cat-move-target' || id === 'cm-cat-uncat-target' ? { value: moveTarget } : originalGetById(id);

      DashClassManager.resetState();
      DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
      _useSupabase = true;
      DashClassManager.openClassManager();
      await new Promise(r => setTimeout(r, 20));
      _useSupabase = false;
    });

    afterEach(() => {
      window.v2.listCategories = originalV2.list;
      window.v2.saveCategories = originalV2.save;
      document.getElementById = originalGetById;
      DashClassManager.resetState();
    });

    const categoryOf = id => getAssessments(CID).find(a => a.id === id).categoryId;

    // Weights must total 100 (D1), so the remaining category takes the
    // deleted one's share before Save sends the list without it.
    const giveAllWeightTo = idx =>
      DashClassManager.handleInput({ dataset: { actionInput: 'cmCatWeightLive', idx: String(idx) }, value: '100' });

    it('moves a category’s work before deleting it', async () => {
      DashClassManager.handleAction('cmCatDelete', { dataset: { idx: '0' } });
      // Nothing is moved until the teacher picks where the work goes.
      expect(categoryOf('x1')).toBe('k1');

      DashClassManager.handleAction('cmCatMoveDelete', { dataset: { idx: '0' } });
      expect(categoryOf('x1')).toBe('k2');
      expect(categoryOf('x2')).toBe('k2');

      giveAllWeightTo(0);
      DashClassManager.handleAction('cmCatSave', { dataset: {} });
      await new Promise(r => setTimeout(r, 20));

      expect(saved).toEqual([['k2']]);
      expect(getCategories(CID).map(c => c.id)).toEqual(['k2']);
    });

    it('deletes an unused category without asking where its work goes', async () => {
      _cache.assessments[CID] = _cache.assessments[CID].filter(a => a.categoryId !== 'k1');
      DashClassManager.handleAction('cmCatDelete', { dataset: { idx: '0' } });
      giveAllWeightTo(0);
      DashClassManager.handleAction('cmCatSave', { dataset: {} });
      await new Promise(r => setTimeout(r, 20));
      expect(saved).toEqual([['k2']]);
    });

    // Sweep Nov 3: after Save Categories this row took Save's place with the
    // first category already chosen, so a second click on Save put older work
    // in it without a word. Nothing is chosen for the teacher.
    it('offers work with no category a move without choosing one', () => {
      var main = { innerHTML: '' };
      var mocked = document.getElementById;
      document.getElementById = id => (id === 'main' ? main : mocked(id));
      DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
      var select = main.innerHTML.match(/<select[^>]*id="cm-cat-uncat-target"[^>]*>(.*?)<\/select>/);
      expect(select).not.toBeNull();
      expect(select[1]).toMatch(/^<option value="" selected>Choose a Category<\/option>/);

      moveTarget = '';
      DashClassManager.handleAction('cmCatAssignUncategorized', { dataset: {} });
      expect(categoryOf('x3')).toBeUndefined();
    });

    it('gives work with no category the one the teacher picks', () => {
      DashClassManager.handleAction('cmCatAssignUncategorized', { dataset: {} });
      expect(categoryOf('x3')).toBe('k2');
      expect(categoryOf('x1')).toBe('k1');
    });
  });
});

describe('category-required', () => {
  /**
   * A category on every assessment (docs/DECISIONS.md, 2026-11-01). In a
   * class with categories, scored work can't be saved without one, as in
   * Teams; work saved before the rule is marked "Needs a Category". A class
   * with no categories, and DIBELS work, need none.
   */

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
      // DIBELS copies only to a class that offers it (an ELA course).
      COURSES[CATS].curriculumTags = ['LS10'];
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
});

describe('category-weights-total', () => {
  /**
   * Category weights must total exactly 100 (docs/grading-compliance-plan.md
   * D1, as in Microsoft Teams). The old rule was "at most 100", so a class
   * could run at 80% and the letter grade renormalized without saying so.
   * Edits stay in the class manager until Save, which sends the whole list in
   * one save_categories call: a row-at-a-time save would pass through 110 or
   * 90 on the way from 50/50 to 60/40.
   */

  const CID = 'course-weights';

  describe('category weights must total 100', () => {
    var originalV2;
    var originalToast;
    var saves;
    var modes;
    var toasts;

    const act = (action, idx) =>
      DashClassManager.handleAction(action, { dataset: idx == null ? {} : { idx: String(idx) } });
    const type = (action, idx, value) =>
      DashClassManager.handleInput({ dataset: { actionInput: action, idx: String(idx) }, value: String(value) });
    const save = async () => {
      act('cmCatSave');
      await new Promise(r => setTimeout(r, 20));
    };

    beforeEach(async () => {
      localStorage.clear();
      saveCourses({ [CID]: { id: CID, name: 'Science 9', gradingSystem: 'letter' } });
      _cache.assessments[CID] = [];
      saves = [];
      modes = [];
      toasts = [];
      originalToast = globalThis.showSyncToast;
      globalThis.showSyncToast = message => toasts.push(message);
      originalV2 = { list: window.v2.listCategories, save: window.v2.saveCategories };
      window.v2.listCategories = () =>
        Promise.resolve({
          data: [
            { id: 'k1', name: 'Tests', weight: 60, display_order: 0 },
            { id: 'k2', name: 'Labs', weight: 40, display_order: 1 },
          ],
        });
      window.v2.saveCategories = (cid, rows) => {
        modes.push(rows.map(r => categoryCalcMode(r)));
        saves.push(rows.map(r => ({ id: r.id, name: r.name, weight: r.weight })));
        return Promise.resolve({ data: rows.map((r, i) => r.id || 'new-' + i), error: null });
      };

      DashClassManager.resetState();
      DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
      _useSupabase = true;
      DashClassManager.openClassManager();
      await new Promise(r => setTimeout(r, 20));
      _useSupabase = false;
    });

    afterEach(() => {
      window.v2.listCategories = originalV2.list;
      window.v2.saveCategories = originalV2.save;
      globalThis.showSyncToast = originalToast;
      DashClassManager.resetState();
    });

    it('saves a re-weighting in one call once the total is 100', async () => {
      type('cmCatWeightLive', 0, 70);
      // 70 + 40 = 110: not saved.
      await save();
      expect(saves).toEqual([]);
      expect(toasts).toEqual(['Category weights must total 100% to save.']);

      type('cmCatWeightLive', 1, 30);
      await save();
      expect(saves).toEqual([
        [
          { id: 'k1', name: 'Tests', weight: 70 },
          { id: 'k2', name: 'Labs', weight: 30 },
        ],
      ]);
      expect(getCategories(CID).map(c => c.weight)).toEqual([70, 30]);
    });

    it('refuses a total under 100', async () => {
      type('cmCatWeightLive', 0, 50);
      await save();
      expect(saves).toEqual([]);
      // The letter grade still uses the saved weights.
      expect(getCategories(CID).map(c => c.weight)).toEqual([60, 40]);
    });

    it('adds a category with its name and gives it the server’s id', async () => {
      act('cmCatAdd');
      type('cmCatNameLive', 2, 'Homework');
      type('cmCatWeightLive', 0, 50);
      type('cmCatWeightLive', 1, 30);
      type('cmCatWeightLive', 2, 20);
      await save();

      expect(saves[0].map(r => r.name)).toEqual(['Tests', 'Labs', 'Homework']);
      expect(saves[0][2].id).toBe(null);
      expect(getCategories(CID).map(c => c.id)).toEqual(['k1', 'k2', 'new-2']);
    });

    it('needs every category to have a name', async () => {
      act('cmCatAdd');
      await save();
      expect(saves).toEqual([]);
    });

    it('allows a class with no categories', async () => {
      act('cmCatDelete', 0);
      act('cmCatDelete', 0);
      await save();
      expect(saves).toEqual([[]]);
      expect(getCategories(CID)).toEqual([]);
    });

    it("saves a category's Calculation and keeps it in the class", async () => {
      DashClassManager.handleChange({ dataset: { actionChange: 'cmCatMode', idx: '1' }, value: 'percent' });
      await save();
      expect(modes).toEqual([['points', 'percent']]);
      expect(getCategories(CID).map(c => categoryCalcMode(c))).toEqual(['points', 'percent']);
    });

    it('asks first when a Calculation change moves a term that has ended', async () => {
      _cache.courseConfigs[CID] = Object.assign({}, _cache.courseConfigs[CID], {
        reportingTerms: [{ ordinal: 1, label: 'Term 1', starts_on: '2020-09-01', ends_on: '2020-11-30' }],
      });
      var confirms = [];
      var originalConfirm = globalThis.showConfirm;
      globalThis.showConfirm = (title, message, ok, style, onOk) => confirms.push({ title, message, onOk });
      try {
        DashClassManager.handleChange({ dataset: { actionChange: 'cmCatMode', idx: '0' }, value: 'percent' });
        await save();
        expect(saves).toEqual([]);
        expect(confirms.map(c => c.title)).toEqual(['Change the Course %?']);
        expect(confirms[0].message).toContain('Term 1');
        confirms[0].onOk();
        await new Promise(r => setTimeout(r, 20));
        expect(modes).toEqual([['percent', 'points']]);
      } finally {
        globalThis.showConfirm = originalConfirm;
      }
    });

    it('sends nothing when nothing changed', async () => {
      await save();
      expect(saves).toEqual([]);
    });
  });

  describe('category weights in Demo Mode', () => {
    // Demo Mode has no Supabase client, so saveCategories sends nothing.
    var originalGetSupabase;
    beforeEach(() => {
      originalGetSupabase = globalThis.getSupabase;
      globalThis.getSupabase = () => null;
    });
    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
    });

    it('starts from the class’s cached categories', async () => {
      localStorage.clear();
      const cid = 'course-demo-weights';
      saveCourses({ [cid]: { id: cid, name: 'Science 8', gradingSystem: 'letter' } });
      _cache.assessments[cid] = [];
      adoptCategoriesFromServer(cid, [
        { id: 'd1', name: 'Labs', weight: 60, displayOrder: 0 },
        { id: 'd2', name: 'Quizzes', weight: 40, displayOrder: 1 },
      ]);
      DashClassManager.resetState();
      DashClassManager.configure({ activeCourse: cid, onRender() {}, onCourseChange() {} });
      DashClassManager.openClassManager();
      await new Promise(r => setTimeout(r, 20));

      DashClassManager.handleInput({ dataset: { actionInput: 'cmCatWeightLive', idx: '0' }, value: '70' });
      DashClassManager.handleInput({ dataset: { actionInput: 'cmCatWeightLive', idx: '1' }, value: '30' });
      DashClassManager.handleAction('cmCatSave', { dataset: {} });
      await new Promise(r => setTimeout(r, 20));

      expect(getCategories(cid).map(c => [c.id, c.name, c.weight])).toEqual([
        ['d1', 'Labs', 70],
        ['d2', 'Quizzes', 30],
      ]);
      DashClassManager.resetState();
    });
  });
});
