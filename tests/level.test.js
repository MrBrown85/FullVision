/**
 * level: the tests that were tests/level-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('level-bar-percent', () => {
  /**
   * Level bars agree with the figure beside them (2026-11-01 math audit). A
   * bar was level ÷ 4 wide while a Letter class printed the level's Counts
   * As %, so on the BC Letter Bands a Proficient 3 printed "80%" beside a
   * three-quarter bar.
   */

  const CID = 'level-bar';

  function seed(gradingSystem, percents) {
    COURSES[CID] = { id: CID, gradingSystem };
    _cache.courseConfigs[CID] = percents
      ? { gradingScale: { boundaries: DEFAULT_GRADING_SCALE.boundaries, percents } }
      : {};
    clearProfCache();
  }

  describe('levelBarPercent', () => {
    afterEach(() => delete COURSES[CID]);

    it('fills to the % a Letter or Both class prints', () => {
      seed('letter', BC_LETTER_BAND_PERCENTS);
      expect(formatLevel(CID, 3)).toBe('80%');
      expect(levelBarPercent(CID, 3)).toBe(80);
      seed('both', BC_LETTER_BAND_PERCENTS);
      expect(levelBarPercent(CID, 10 / 3)).toBeCloseTo(86, 9);
    });

    it('is level ÷ 4 in a Proficiency class, whatever Counts As says', () => {
      seed('proficiency', BC_LETTER_BAND_PERCENTS);
      expect(levelBarPercent(CID, 3)).toBe(75);
    });

    it('is empty with no level and full at 4', () => {
      seed('letter');
      expect(levelBarPercent(CID, 0)).toBe(0);
      expect(levelBarPercent(CID, null)).toBe(0);
      expect(levelBarPercent(CID, 4)).toBe(100);
    });
  });
});

describe('level-order', () => {
  /**
   * Rubric Levels (migrations/20261022_course_level_order.sql): a class decides
   * whether the four levels run Extending → Emerging (the default) or Emerging
   * → Extending everywhere it draws them. levelOrder / levelOrderFor in
   * shared/constants.js are the one source of that order; the setting lives in
   * the class's course config, travels through update_course, and comes back
   * on the bundle's course row.
   */

  const CID = 'e0000000-0000-4000-8000-00000000d00c';

  describe('levelOrder', () => {
    it('is Extending first unless the class chose Emerging first', () => {
      expect(levelOrder(null)).toEqual([4, 3, 2, 1]);
      expect(levelOrder({})).toEqual([4, 3, 2, 1]);
      expect(levelOrder({ levelOrder: 'desc' })).toEqual([4, 3, 2, 1]);
      expect(levelOrder({ levelOrder: 'asc' })).toEqual([1, 2, 3, 4]);
      expect(levelOrder({ level_order: 'asc' })).toEqual([1, 2, 3, 4]);
      expect(levelOrder({ levelOrder: 'sideways' })).toEqual([4, 3, 2, 1]);
    });
  });

  describe('levelOrderFor', () => {
    beforeEach(() => {
      localStorage.clear();
      _cache.courseConfigs = {};
      saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency' } });
    });

    it('reads the class config, then the course row, then falls back to Extending first', () => {
      expect(levelOrderFor(CID)).toEqual([4, 3, 2, 1]);
      expect(levelOrderFor('not-a-class')).toEqual([4, 3, 2, 1]);
      expect(levelOrderFor(null)).toEqual([4, 3, 2, 1]);

      saveCourses({ [CID]: { id: CID, name: 'Science 8', levelOrder: 'asc' } });
      expect(levelOrderFor(CID)).toEqual([1, 2, 3, 4]);

      _cache.courseConfigs[CID] = { levelOrder: 'desc' };
      expect(levelOrderFor(CID)).toEqual([4, 3, 2, 1]);
      _cache.courseConfigs[CID] = { levelOrder: 'asc' };
      expect(levelOrderFor(CID)).toEqual([1, 2, 3, 4]);
    });
  });

  /* One class on a fake server: update_course merges its patch into the
   course row and bumps the version, as the course trigger does. */
  function fakeServer() {
    var server = { version: 1, course: { level_order: 'desc' }, patches: [] };
    server.client = function () {
      return {
        rpc(name, payload) {
          payload = payload || {};
          if (name === 'update_course') {
            server.patches.push(payload.p_patch);
            Object.keys(payload.p_patch).forEach(function (k) {
              server.course[k] = payload.p_patch[k];
            });
            server.version += 1;
            return Promise.resolve({ data: null, error: null });
          }
          if (name !== 'get_class_bundle') return Promise.resolve({ data: null, error: null });
          if (payload.p_if_version === server.version) {
            return Promise.resolve({ data: { not_modified: true, version: server.version }, error: null });
          }
          return Promise.resolve({ data: bundle(server), error: null });
        },
      };
    };
    return server;
  }

  function bundle(server) {
    return {
      bundle_schema: 3,
      version: server.version,
      gradebook: {
        course: Object.assign({ id: CID }, server.course),
        students: [],
        assessments: [],
        categories: [],
        modules: [],
        tag_index: [],
        criterion_index: [],
        score_rows: [],
        tag_rows: [],
        criterion_rows: [],
      },
      learning_map: { competency_groups: [], subjects: [] },
      rubrics: { rubrics: [], criteria: [], criterion_tags: [] },
      observations: { observations: [], total: 0 },
      profiles: [],
      term_ratings: [],
      report_config: null,
      custom_tags: [],
      course_config: { grading_scale: null, category_weights: null },
    };
  }

  /* A different device: nothing in memory or localStorage from this one. */
  function switchDevice() {
    localStorage.clear();
    Object.keys(_DATA_KEYS).forEach(function (field) {
      delete _cache[field][CID];
    });
    delete _classVersion[CID];
    delete _classFresh[CID];
    _serverState = {};
    _localWrites = {};
    _refreshState = {};
    _dirtyMarked = {};
    saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency', calcMethod: 'mostRecent' } });
  }

  async function settle() {
    for (var i = 0; i < 5; i++) await Promise.resolve();
  }

  describe('Rubric Levels sync', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var originalTeacher;
    var server;

    beforeEach(() => {
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      originalTeacher = _teacherId;
      _useSupabase = true;
      _teacherId = 'teacher-a';
      globalThis.__FV_CLASS_BUNDLE = true;
      server = fakeServer();
      globalThis.getSupabase = server.client;
      switchDevice();
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
      _teacherId = originalTeacher;
      globalThis.__FV_CLASS_BUNDLE = false;
    });

    it('sends level_order with update_course', async () => {
      await initData(CID);
      var cc = getCourseConfig(CID);
      // Loaded from the bundle and not changed here: a save of another
      // setting leaves it out (tests/stale-settings-revert.test.js). It used
      // to go with every save, which put an old value back.
      cc.calcMethod = 'mostRecent';
      saveCourseConfig(CID, cc);
      await settle();
      expect(server.patches[server.patches.length - 1]).toEqual({ calc_method: 'mostRecent' });

      cc.levelOrder = 'asc';
      saveCourseConfig(CID, cc);
      await settle();
      expect(server.patches[server.patches.length - 1].level_order).toBe('asc');
      expect(server.course.level_order).toBe('asc');
    });

    it('shows Emerging first chosen on one device on another', async () => {
      await initData(CID);
      var cc = getCourseConfig(CID);
      cc.levelOrder = 'asc';
      saveCourseConfig(CID, cc);
      await settle();

      switchDevice();
      expect(levelOrderFor(CID)).toEqual([4, 3, 2, 1]);
      await initData(CID);
      expect(levelOrderFor(CID)).toEqual([1, 2, 3, 4]);
    });

    it('reads a bundle from before the column as Extending first', async () => {
      delete server.course.level_order;
      await initData(CID);
      expect(levelOrderFor(CID)).toEqual([4, 3, 2, 1]);
      expect(getCourseConfig(CID).levelOrder).toBeUndefined();
      expect(server.patches).toEqual([]);
    });
  });

  describe('Class Details: Rubric Levels', () => {
    var main;
    var originalGetElementById;

    beforeEach(() => {
      localStorage.clear();
      _cache.courseConfigs = {};
      saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency', calcMethod: 'mostRecent' } });
      main = { innerHTML: '' };
      originalGetElementById = document.getElementById;
      document.getElementById = function (id) {
        return id === 'main' ? main : originalGetElementById(id);
      };
      DashClassManager.resetState();
      DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
      DashClassManager.openClassManager();
      DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
    });

    afterEach(() => {
      document.getElementById = originalGetElementById;
      DashClassManager.resetState();
    });

    function checked() {
      var m = main.innerHTML.match(/<button[^>]*aria-checked="true"[^>]*data-action="cmSetLevelOrder"[^>]*>([^<]*)</);
      return m ? m[1] : null;
    }

    it('sits under Grading System with Extending First chosen by default', () => {
      var html = main.innerHTML;
      expect(html.indexOf('Rubric Levels')).toBeGreaterThan(html.indexOf('Grading System'));
      expect(html.indexOf('Rubric Levels')).toBeLessThan(html.indexOf('Competency Proficiency'));
      expect(html).toContain('Emerging First');
      expect(html).toContain('Extending First');
      expect(html).toContain(
        'Decides the order of the four levels on scoring cards, rubrics, printouts and reports in this class.',
      );
      expect(checked()).toBe('Extending First');
    });

    it('saves the choice to the class config and redraws', () => {
      DashClassManager.handleAction('cmSetLevelOrder', { dataset: { value: 'asc' } });
      expect(getCourseConfig(CID).levelOrder).toBe('asc');
      expect(levelOrderFor(CID)).toEqual([1, 2, 3, 4]);
      expect(checked()).toBe('Emerging First');

      DashClassManager.handleAction('cmSetLevelOrder', { dataset: { value: 'desc' } });
      expect(getCourseConfig(CID).levelOrder).toBe('desc');
      expect(levelOrderFor(CID)).toEqual([4, 3, 2, 1]);
      expect(checked()).toBe('Extending First');
    });
  });

  describe('printed rubric sheet', () => {
    beforeEach(() => {
      localStorage.clear();
      _cache.courseConfigs = {};
      saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency' } });
      saveStudents(CID, [{ id: 's1', firstName: 'Ada', lastName: 'Lovelace' }]);
      saveRubrics(CID, [
        {
          id: 'r1',
          name: 'Lab Rubric',
          criteria: [
            { id: 'c1', name: 'Hypothesis', tagIds: [], levels: { 1: 'one', 2: 'two', 3: 'three', 4: 'four' } },
          ],
        },
      ]);
      saveAssessments(CID, [
        { id: 'a1', title: 'Lab 1', date: '2026-10-01', type: 'summative', tagIds: [], rubricId: 'r1' },
      ]);
    });

    function heads() {
      var data = RubricPrint.sheetData(CID, 'a1', 's1');
      var html = RubricPrint.renderSheet(data, { include: RubricPrint.DEFAULT_OPTIONS.include });
      return Array.from(html.matchAll(/class="rubric-level-head l(\d)"/g)).map(m => Number(m[1]));
    }

    it('lays the level columns out in the class order', () => {
      expect(heads()).toEqual([4, 3, 2, 1]);
      _cache.courseConfigs[CID] = { levelOrder: 'asc' };
      expect(heads()).toEqual([1, 2, 3, 4]);
    });
  });
});

describe('level-percents', () => {
  /**
   * Counts As: the percent each proficiency counts as in the course %
   * (grading_scale.percents, docs/DECISIONS.md "Proficiency percents").
   * The default is level ÷ 4; a class can set its own, and + / − sit a third
   * of the way to the next level's percent. Level averages, competencies and
   * the rubric overall stay on the 0–4 scale.
   */

  const CID = 'course-pct';
  const SID = 'stu-1';
  const MATCHED = { 4: 98, 3: 84, 2: 62, 1: 50 };

  const crit = (id, tagIds, levelValues) => ({
    id,
    name: id,
    tagIds,
    levels: { 4: '', 3: '', 2: '', 1: '' },
    weight: 1,
    levelValues: levelValues || null,
  });
  const rubricAssessment = { id: 'r-a', title: 'Essay', rubricId: 'r1', tagIds: ['t1', 't2'], type: 'summative' };
  const profAssessment = { id: 'p-a', title: 'Quiz', tagIds: ['t3'], type: 'summative' };
  const score = (aid, tagId, value, mod) => ({
    assessmentId: aid,
    tagId,
    score: value,
    mod: mod || 0,
    date: '2026-10-10',
  });

  function seed({ percents, criteria, assessments, scores }) {
    _cache.rubrics[CID] = [
      { id: 'r1', name: 'Essay rubric', criteria: criteria || [crit('A', ['t1']), crit('B', ['t2'])] },
    ];
    _cache.assessments[CID] = assessments;
    _cache.scores[CID] = { [SID]: scores };
    _cache.statuses[CID] = {};
    _cache.categories[CID] = [];
    _cache.courseConfigs[CID] = {
      gradingSystem: 'letter',
      gradingScale: percents
        ? { boundaries: DEFAULT_GRADING_SCALE.boundaries, percents: percents, labels: null }
        : DEFAULT_GRADING_SCALE,
    };
    COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter' };
    clearProfCache();
  }

  describe('levelToPercent', () => {
    beforeEach(() => localStorage.clear());

    it('is level ÷ 4 by default, + and − included', () => {
      seed({ assessments: [], scores: [] });
      expect(levelToPercent(CID, 4)).toBe(100);
      expect(levelToPercent(CID, 3)).toBe(75);
      expect(levelToPercent(CID, 3 + 1 / 3)).toBeCloseTo(83.333, 3);
      expect(levelToPercent(CID, 1)).toBe(25);
      expect(levelToPercent(CID, 0)).toBe(0);
      expect(levelToPercent(CID, null)).toBe(null);
    });

    it("uses the class's percents, a third of the way to the next for + and −", () => {
      seed({ percents: MATCHED, assessments: [], scores: [] });
      expect(levelToPercent(CID, 4)).toBe(98);
      expect(levelToPercent(CID, 3)).toBe(84);
      expect(levelToPercent(CID, 3 + 1 / 3)).toBeCloseTo(84 + 14 / 3, 5);
      expect(levelToPercent(CID, 3 - 1 / 3)).toBeCloseTo(84 - 22 / 3, 5);
      expect(levelToPercent(CID, 2.5)).toBeCloseTo(73, 5);
      expect(levelToPercent(CID, 1)).toBe(50);
      expect(levelToPercent(CID, 0.5)).toBeCloseTo(25, 5);
      expect(levelToPercent(CID, 5)).toBe(98);
    });

    it('falls back to the defaults for a scale saved before Counts As', () => {
      seed({ assessments: [], scores: [] });
      _cache.courseConfigs[CID].gradingScale = { boundaries: DEFAULT_GRADING_SCALE.boundaries, labels: null };
      clearProfCache();
      expect(levelToPercent(CID, 3)).toBe(75);
    });
  });

  describe('Counts As in the course %', () => {
    beforeEach(() => localStorage.clear());

    it('counts proficiency work at its percent', () => {
      seed({ percents: MATCHED, assessments: [profAssessment], scores: [score('p-a', 't3', 3)] });
      expect(getCourseLetterData(CID, SID).R).toBe(84);
      expect(formatLevel(CID, 3)).toBe('84%');
      expect(formatLevelAs(CID, 3, 'percent')).toBe('84%');
    });

    it('counts each standard rubric criterion at its percent', () => {
      seed({
        percents: MATCHED,
        assessments: [rubricAssessment],
        scores: [score('r-a', 't1', 3), score('r-a', 't2', 2)],
      });
      // (84 + 62) / 2
      expect(getCourseLetterData(CID, SID).R).toBe(73);
    });

    it("keeps a criterion's own point values", () => {
      seed({
        percents: MATCHED,
        criteria: [crit('A', ['t1'], { 4: 10, 3: 7, 2: 4, 1: 1 }), crit('B', ['t2'])],
        assessments: [rubricAssessment],
        scores: [score('r-a', 't1', 3), score('r-a', 't2', 3)],
      });
      // A: 7 of 10. B: 84% of 4 = 3.36. (7 + 3.36) / (10 + 4)
      expect(getCourseLetterData(CID, SID).R).toBe(74);
    });

    it('leaves the level scale alone', () => {
      seed({
        percents: MATCHED,
        assessments: [rubricAssessment],
        scores: [score('r-a', 't1', 3), score('r-a', 't2', 2)],
      });
      expect(getAssessmentOverallScore(CID, SID, 'r-a')).toBeCloseTo(2.5, 5);
    });

    it('gives the same course % as before with the default percents', () => {
      seed({
        assessments: [rubricAssessment, profAssessment],
        scores: [score('r-a', 't1', 3, -1), score('r-a', 't2', 2, 1), score('p-a', 't3', 3, 1)],
      });
      // Rubric (2.667 + 2.333) / 8, quiz 3.333 / 4, pooled: 8.333 / 12
      expect(getCourseLetterData(CID, SID).R).toBe(69.4);
    });
  });

  describe('Counts As by step', () => {
    beforeEach(() => localStorage.clear());

    it('fills a step with no value a third of the way between its levels', () => {
      expect(countsAsStepPercents({ 4: 100, 3: 75, 2: 50, 1: 25 }).map(v => Math.round(v * 10) / 10)).toEqual([
        25, 33.3, 41.7, 50, 58.3, 66.7, 75, 83.3, 91.7, 100,
      ]);
      expect(countsAsStepPercents({ 4: 100, 3: 75, '3+': 86, 2: 50, 1: 25 })[7]).toBe(86);
    });

    it('counts each step on the BC Letter Bands as its own value', () => {
      seed({ percents: BC_LETTER_BAND_PERCENTS, assessments: [], scores: [] });
      expect(levelToPercent(CID, 3 + 1 / 3)).toBeCloseTo(86, 9);
      expect(levelToPercent(CID, 3)).toBe(80);
      expect(levelToPercent(CID, 4 - 1 / 3)).toBeCloseTo(92, 9);
      expect(levelToPercent(CID, 2 - 1 / 3)).toBeCloseTo(55, 9);
      expect(levelToPercent(CID, 1)).toBe(45);
      // Between 2+ (67) and 3− (73): halfway.
      expect(levelToPercent(CID, 2.5)).toBeCloseTo(70, 9);
      expect(formatLevel(CID, 3 + 1 / 3)).toBe('86%');
      expect(percentageToLetter(levelToPercent(CID, 3 + 1 / 3), CID)).toBe('A');
    });

    it('counts a rubric criterion scored 3+ at its step', () => {
      seed({
        percents: BC_LETTER_BAND_PERCENTS,
        assessments: [rubricAssessment],
        scores: [score('r-a', 't1', 3, 1), score('r-a', 't2', 2, -1)],
      });
      // (86 + 55) / 2
      expect(getCourseLetterData(CID, SID).R).toBe(70.5);
    });
  });
});
