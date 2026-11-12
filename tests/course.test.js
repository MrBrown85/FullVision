/**
 * course: the tests that were tests/course-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('course-block', () => {
  /**
   * Class blocks (migrations/20261020_course_block.sql): each class can name its
   * block so two sections of a course read differently in every class picker.
   */

  describe('course blocks', () => {
    it('upper-cases short codes and keeps longer labels as typed', () => {
      expect(normalizeCourseBlock(' a ')).toBe('A');
      expect(normalizeCourseBlock('x')).toBe('X');
      expect(normalizeCourseBlock('2')).toBe('2');
      expect(normalizeCourseBlock('Lunch club')).toBe('Lunch club');
      expect(normalizeCourseBlock(null)).toBe('');
      expect(normalizeCourseBlock('x'.repeat(40))).toHaveLength(24);
    });

    it('labels a code as "Block A" and shows it before the class name', () => {
      expect(courseBlockLabel({ block: 'c' })).toBe('Block C');
      expect(courseBlockLabel({ block: 'Jazz band' })).toBe('Jazz band');
      expect(courseBlockLabel({})).toBe('');
      expect(courseDisplayName({ name: 'Philosophy 12', block: 'A' })).toBe('Block A \u00B7 Philosophy 12');
      expect(courseDisplayName({ name: 'Philosophy 12' })).toBe('Philosophy 12');
    });

    it('does not repeat a block the name already carries', () => {
      expect(courseDisplayName({ name: 'Philosophy 12 - Block A', block: 'A' })).toBe('Philosophy 12 - Block A');
    });

    it('sorts lettered blocks first, then labels, then classes with no block', () => {
      const list = [
        { id: 'none', name: 'Homeroom' },
        { id: 'x', name: 'Jazz', block: 'X' },
        { id: 'club', name: 'Chess', block: 'Lunch club' },
        { id: 'b', name: 'Philosophy 12', block: 'B' },
        { id: 'a', name: 'Philosophy 12', block: 'A' },
        { id: 'd', name: 'English 10', block: 'D' },
      ];
      expect(sortCoursesByBlock(list).map(c => c.id)).toEqual(['a', 'b', 'd', 'x', 'club', 'none']);
    });

    it('class pickers list classes in block order with the block code shown', () => {
      saveCourses({
        c1: { id: 'c1', name: 'English 10', block: 'D' },
        c2: { id: 'c2', name: 'Philosophy 12', block: 'B' },
        c3: { id: 'c3', name: 'Philosophy 12', block: 'A' },
      });
      expect(getPickerCourses('c1').map(c => c.name)).toEqual([
        'A \u00B7 Philosophy 12',
        'B \u00B7 Philosophy 12',
        'D \u00B7 English 10',
      ]);
    });

    it('a picker shows a longer label or a name that carries its block as before', () => {
      expect(coursePickerName({ name: 'Chess', block: 'Lunch club' })).toBe('Lunch club \u00B7 Chess');
      expect(coursePickerName({ name: 'Philosophy 12 - Block A', block: 'A' })).toBe('Philosophy 12 - Block A');
      expect(coursePickerName({ name: 'Homeroom' })).toBe('Homeroom');
    });
  });
});

describe('course-curriculum-link', () => {
  /**
   * A class's BC Curriculum Link (course.curriculumTags, e.g. ['HIST12']) is
   * saved on the server as course.curriculum_tags
   * (migrations/20261102_course_curriculum_tags.sql). It travels through
   * update_course, comes back from list_teacher_courses and on the bundle's
   * course row, and a link one device kept from before goes up once.
   */

  const CID = 'e0000000-0000-4000-8000-00000000c11c';

  function fakeServer() {
    var server = { version: 1, course: {}, patches: [] };
    server.client = function () {
      return {
        rpc(name, payload) {
          payload = payload || {};
          if (name === 'update_course') {
            server.patches.push(payload.p_patch);
            Object.assign(server.course, payload.p_patch);
            server.version += 1;
            return Promise.resolve({ data: null, error: null });
          }
          if (name !== 'get_class_bundle') return Promise.resolve({ data: null, error: null });
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
    saveCourses({ [CID]: { id: CID, name: 'History 12', gradingSystem: 'proficiency', calcMethod: 'mostRecent' } });
  }

  async function settle() {
    for (var i = 0; i < 5; i++) await Promise.resolve();
  }

  describe('the BC Curriculum Link on the server', () => {
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

    it('sends the link with update_course, and an unlink as null', async () => {
      updateCourse(CID, { curriculumTags: ['HIST12'] });
      await settle();
      expect(server.patches[server.patches.length - 1]).toEqual({ curriculum_tags: ['HIST12'] });
      updateCourse(CID, { curriculumTags: null });
      await settle();
      expect(server.patches[server.patches.length - 1]).toEqual({ curriculum_tags: null });
    });

    it('shows a link saved on one device on another', async () => {
      updateCourse(CID, { curriculumTags: ['HIST12'] });
      await settle();
      switchDevice();
      expect(COURSES[CID].curriculumTags).toBeUndefined();
      await initData(CID);
      expect(COURSES[CID].curriculumTags).toEqual(['HIST12']);
    });

    it('keeps this device’s link when the bundle has none saved', async () => {
      COURSES[CID].curriculumTags = ['SS10'];
      await initData(CID);
      expect(COURSES[CID].curriculumTags).toEqual(['SS10']);
    });
  });

  describe('the course list', () => {
    var originalUseSupabase;
    var originalGetSupabase;
    var sent;

    beforeEach(() => {
      originalUseSupabase = _useSupabase;
      originalGetSupabase = getSupabase;
      _useSupabase = true;
      sent = [];
      globalThis.getSupabase = function () {
        return {
          rpc(name, payload) {
            sent.push([name, payload]);
            return Promise.resolve({ data: null, error: null });
          },
        };
      };
    });

    afterEach(() => {
      _useSupabase = originalUseSupabase;
      globalThis.getSupabase = originalGetSupabase;
    });

    it('maps curriculum_tags to curriculumTags, the server winning', () => {
      const prev = { [CID]: { curriculumTags: ['SS10'] } };
      expect(_canonicalCoursesToBlob([{ id: CID, curriculum_tags: ['HIST12'] }], prev)[CID].curriculumTags).toEqual([
        'HIST12',
      ]);
      expect(_canonicalCoursesToBlob([{ id: CID, curriculum_tags: [] }], prev)[CID].curriculumTags).toEqual([]);
      expect(_canonicalCoursesToBlob([{ id: CID }], {})[CID].curriculumTags).toEqual([]);
    });

    it('keeps a link only this device has, and sends it up once', async () => {
      const prev = { [CID]: { curriculumTags: ['PHIL12'] } };
      const rows = [{ id: CID, curriculum_tags: null }];
      expect(_canonicalCoursesToBlob(rows, prev)[CID].curriculumTags).toEqual(['PHIL12']);
      _sendUpCurriculumTags(rows, prev);
      await settle();
      expect(sent).toEqual([['update_course', { p_course_id: CID, p_patch: { curriculum_tags: ['PHIL12'] } }]]);
    });

    it('sends nothing up when the server already has the link, or the device has none', async () => {
      _sendUpCurriculumTags([{ id: CID, curriculum_tags: ['HIST12'] }], { [CID]: { curriculumTags: ['SS10'] } });
      _sendUpCurriculumTags([{ id: CID, curriculum_tags: null }], { [CID]: { curriculumTags: [] } });
      await settle();
      expect(sent).toEqual([]);
    });
  });

  describe('Demo Mode', () => {
    it('keeps the link on the device and calls no server', () => {
      const originalUseSupabase = _useSupabase;
      _useSupabase = false;
      saveCourses({ [CID]: { id: CID, name: 'Science 8' } });
      updateCourse(CID, { curriculumTags: ['SCI8'] });
      expect(COURSES[CID].curriculumTags).toEqual(['SCI8']);
      expect(JSON.parse(localStorage.getItem('gb-courses'))[CID].curriculumTags).toEqual(['SCI8']);
      _useSupabase = originalUseSupabase;
    });
  });
});

describe('course-percentage', () => {
  /**
   * Course percentage (getCourseLetterData R). Every assessment counts as
   * points earned out of points possible within each category; a proficiency
   * level counts as that many points out of 4. Reported 2026-10-14: 2.75/6 + 14.25/24
   * (17/30 = 56.7%) showed as 69.5%, because each score went through a level
   * and the level-to-percentage scale.
   */

  const CID = 'course-pct';
  const SID = 'stu-1';
  const TAG = 'tag-1';

  function seed({ categories, assessments, scores, statuses }) {
    _cache.categories[CID] = categories;
    _cache.assessments[CID] = assessments;
    _cache.scores[CID] = { [SID]: scores };
    _cache.statuses[CID] = statuses || {};
    _cache.courseConfigs[CID] = {};
    clearProfCache();
  }

  const points = (id, max, categoryId) => ({
    id,
    title: id,
    scoreMode: 'points',
    maxPoints: max,
    tagIds: [TAG],
    categoryId,
    type: 'summative',
  });
  const complete = (id, categoryId) => ({
    id,
    title: id,
    scoreMode: 'complete',
    maxPoints: 1,
    tagIds: [TAG],
    categoryId,
    type: 'summative',
  });
  const level = (id, categoryId) => ({ id, title: id, tagIds: [TAG], categoryId, type: 'summative' });
  const score = (assessmentId, value) => ({ assessmentId, tagId: TAG, score: value, date: '2026-10-10' });

  describe('course percentage', () => {
    beforeEach(() => localStorage.clear());

    const brett = {
      categories: [
        { id: 'form', name: 'Formative', weight: 0 },
        { id: 'summ', name: 'Summative', weight: 100 },
      ],
      assessments: [points('ann', 6, 'summ'), points('qs', 24, 'summ'), complete('goals', 'form')],
      scores: [score('ann', 2.75), score('qs', 14.25), score('goals', 1)],
    };

    it('counts points earned out of points possible', () => {
      seed(brett);
      expect(getCourseLetterData(CID, SID).R).toBe(56.7);
    });

    it('leaves out a category weighted 0%', () => {
      seed({ ...brett, scores: [score('ann', 2.75), score('qs', 14.25), score('goals', 0)] });
      expect(getCourseLetterData(CID, SID).R).toBe(56.7);
    });

    it('weights categories by their percentages', () => {
      seed({
        ...brett,
        categories: [
          { id: 'form', name: 'Formative', weight: 50 },
          { id: 'summ', name: 'Summative', weight: 50 },
        ],
      });
      // (56.67 + 100) / 2
      expect(getCourseLetterData(CID, SID).R).toBe(78.3);
    });

    it('skips excused work and counts not-submitted work as 0', () => {
      seed({ ...brett, statuses: { [SID + ':ann']: 'EXC' } });
      expect(getCourseLetterData(CID, SID).R).toBe(59.4);
      seed({ ...brett, statuses: { [SID + ':ann']: 'NS' } });
      expect(getCourseLetterData(CID, SID).R).toBe(47.5);
    });

    it('counts a proficiency level as points out of 4', () => {
      seed({
        categories: [{ id: 'summ', name: 'Summative', weight: 100 }],
        assessments: [level('a', 'summ'), level('b', 'summ')],
        scores: [score('a', 3), score('b', 2)],
      });
      var data = getCourseLetterData(CID, SID);
      expect(data.Q).toBe(2.5);
      // 5 / 8
      expect(data.R).toBe(62.5);
    });

    it('counts a + or − as a third of a point', () => {
      seed({
        categories: [],
        assessments: [level('a')],
        scores: [{ ...score('a', 3), mod: 1 }],
      });
      // 3.33 / 4
      expect(getCourseLetterData(CID, SID).R).toBe(83.3);
    });

    it('pools levels and points in one category', () => {
      seed({
        categories: [{ id: 'summ', name: 'Summative', weight: 100 }],
        assessments: [level('a', 'summ'), points('t', 20, 'summ')],
        scores: [score('a', 3), score('t', 15)],
      });
      // (3 + 15) / (4 + 20)
      expect(getCourseLetterData(CID, SID).R).toBe(75);
    });

    it('works without categories', () => {
      seed({ ...brett, categories: [], assessments: [points('ann', 6), points('qs', 24)] });
      expect(getCourseLetterData(CID, SID).R).toBe(56.7);
    });

    it('counts a typed 0 as 0 points', () => {
      seed({ categories: [], assessments: [points('a', 10), points('b', 10)], scores: [score('a', 8), score('b', 0)] });
      // 8 / 20; a 0 used to count as blank, giving 80%.
      expect(getCourseLetterData(CID, SID).R).toBe(40);
    });

    it('takes the letter from the % as shown', () => {
      // 171.9 / 200 = 85.95 shows as 86%, so the letter is an A, not a B.
      seed({ categories: [], assessments: [points('t', 200)], scores: [score('t', 171.9)] });
      expect(getCourseLetterData(CID, SID)).toMatchObject({ R: 86, S: 'A' });
      // 36.98 / 43 is 85.99999… in floating point; shows as 86% and an A.
      seed({ categories: [], assessments: [points('t', 43)], scores: [score('t', 36.98)] });
      expect(getCourseLetterData(CID, SID)).toMatchObject({ R: 86, S: 'A' });
      // 49.95 shows as 50%, a C-.
      seed({ categories: [], assessments: [points('t', 200)], scores: [score('t', 99.9)] });
      expect(getCourseLetterData(CID, SID)).toMatchObject({ R: 50, S: 'C-' });
    });

    it('shows the letter card for a points class with no linked competencies', () => {
      seed({
        categories: [],
        assessments: [{ ...points('t', 20), tagIds: [] }],
        scores: [{ assessmentId: 't', tagId: 'overall', score: 15, date: '2026-10-10' }],
      });
      _cache.students[CID] = [{ id: SID, firstName: 'Ana', lastName: 'Lee' }];
      if (typeof COURSES === 'undefined') globalThis.COURSES = {};
      COURSES[CID] = { id: CID, name: 'Math 10', gradingSystem: 'letter' };
      expect(getOverallProficiency(CID, SID)).toBe(0);
      const html = renderStudentHeader(CID, SID);
      expect(html).toContain('letter-card');
      expect(html).toContain('75%');
      delete COURSES[CID];
      delete _cache.students[CID];
    });
  });
});
