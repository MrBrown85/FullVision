/**
 * Each Course Counts Equally (course.courses_count_equally): a combined
 * class rolls up each course on its own, by the usual folder rules, then
 * averages the courses. Off, the default, is the old math exactly. Changing
 * it asks first, like Folders Count as One.
 * migrations/20261102_courses_count_equally.sql.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'e0000000-0000-4000-8000-00000000ce01';
const B = 'e0000000-0000-4000-8000-00000000ce02';

// ELA: Comprehend folder 4, 4, 4; Create folder 3. SS, no folders: 1, 2, 3.
const LEVELS = { t1: 4, t2: 4, t3: 4, t4: 3, t5: 1, t6: 2, t7: 3 };
// Folders as one across the class: (4 + 3 + 1 + 2 + 3) / 5.
const DEFAULT = 13 / 5;
// Each course: ELA (4 + 3) / 2 = 3.5, SS (1 + 2 + 3) / 3 = 2.
const EQUAL = (3.5 + 2) / 2;
// Each course with folders off: ELA 15 / 4, SS 2.
const EQUAL_FLAT = (15 / 4 + 2) / 2;

function section(id, tag, subject, groupId) {
  var s = { id: id, name: id, subject: subject, tags: [{ id: tag, label: tag }] };
  if (groupId) s.groupId = groupId;
  return s;
}

function setUpClass() {
  localStorage.clear();
  _useSupabase = false;
  saveCourses({
    [CID]: { id: CID, name: 'Humanities 8', gradingSystem: 'proficiency', calcMethod: 'average' },
    [B]: { id: B, name: 'Humanities 8 B', gradingSystem: 'proficiency', calcMethod: 'average' },
  });
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  _cache.courseConfigs[B] = { calcMethod: 'average' };
  saveStudents(CID, [{ id: 'st1', firstName: 'Amara', lastName: 'Osei', enrolledDate: '2026-09-01' }]);
  _cache.learningMaps[CID] = {
    _customized: true,
    subjects: [
      { id: 'ela', name: 'English Language Arts 8', color: '#2563eb' },
      { id: 'ss', name: 'Social Studies 8', color: '#dc2626' },
    ],
    competencyGroups: [
      { id: 'g1', name: 'Comprehend and Connect', color: '#2563eb', sortOrder: 0 },
      { id: 'g2', name: 'Create and Communicate', color: '#2563eb', sortOrder: 1 },
    ],
    sections: [
      section('s1', 't1', 'ela', 'g1'),
      section('s2', 't2', 'ela', 'g1'),
      section('s3', 't3', 'ela', 'g1'),
      section('s4', 't4', 'ela', 'g2'),
      section('s5', 't5', 'ss'),
      section('s6', 't6', 'ss'),
      section('s7', 't7', 'ss'),
    ],
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = Object.keys(LEVELS).map(function (tag, i) {
    return {
      id: 'a' + i,
      title: 'Task ' + i,
      scoreMode: 'proficiency',
      tagIds: [tag],
      type: 'summative',
      date: '2026-10-0' + (i + 1),
    };
  });
  _cache.scores[CID] = {
    st1: Object.keys(LEVELS).map(function (tag, i) {
      return { assessmentId: 'a' + i, tagId: tag, score: LEVELS[tag], date: '2026-10-0' + (i + 1) };
    }),
  };
  _cache.statuses[CID] = {};
  clearProfCache();
}

describe('the overall', () => {
  beforeEach(setUpClass);

  it('is the old math when nothing is set', () => {
    expect(getCoursesCountEqually(CID)).toBe(false);
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(DEFAULT, 10);
  });

  it('averages the courses when on, each rolled up with its folders', () => {
    _cache.courseConfigs[CID].coursesCountEqually = true;
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(EQUAL, 10);
  });

  it('applies Folders Count as One inside each course', () => {
    _cache.courseConfigs[CID].coursesCountEqually = true;
    _cache.courseConfigs[CID].foldersCountAsOne = false;
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(EQUAL_FLAT, 10);
    _cache.courseConfigs[CID].foldersCountAsOne = true;
    getCompetencyGroupById(CID, 'g1').countsAsOne = false;
    // ELA: 4, 4, 4 on their own plus Create 3 → 15 / 4.
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(EQUAL_FLAT, 10);
  });

  it('changes nothing for a class with one course', () => {
    _cache.learningMaps[CID].sections.forEach(function (s) {
      s.subject = 'ela';
    });
    var before = getOverallProficiency(CID, 'st1');
    _cache.courseConfigs[CID].coursesCountEqually = true;
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(before, 10);
  });

  it('leaves out a course with no scores yet', () => {
    _cache.courseConfigs[CID].coursesCountEqually = true;
    _cache.scores[CID].st1 = _cache.scores[CID].st1.filter(function (s) {
      return ['t5', 't6', 't7'].indexOf(s.tagId) < 0;
    });
    clearProfCache();
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(3.5, 10);
  });

  it("a report's then column rolls up by the same rule", () => {
    var half = function (sec) {
      return LEVELS[sec.tags[0].id] / 2;
    };
    _cache.courseConfigs[CID].coursesCountEqually = true;
    expect(rollUpSectionLevels(CID, half)).toBeCloseTo(EQUAL / 2, 10);
  });
});

describe('previewing a change', () => {
  beforeEach(setUpClass);

  it('counts the students whose overall moves and puts the class value back', () => {
    var preview = previewCoursesEqualChange(CID, true);
    expect(preview).toEqual({ changed: 1, total: 1, example: { name: 'Amara Osei', before: '2.6', after: '2.8' } });
    expect('coursesCountEqually' in getCourseConfig(CID)).toBe(false);
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(DEFAULT, 10);
  });
});

describe('saving and loading', () => {
  beforeEach(setUpClass);

  it('takes the class value from the bundle, and a server without it leaves it off', () => {
    _applyBundleCourseConfig(CID, {}, { courses_count_equally: true });
    expect(getCoursesCountEqually(CID)).toBe(true);
    _applyBundleCourseConfig(CID, {}, { courses_count_equally: false });
    expect(getCoursesCountEqually(CID)).toBe(false);
    _applyBundleCourseConfig(CID, {}, { courses_count_equally: true });
    _applyBundleCourseConfig(CID, {}, {});
    expect(getCoursesCountEqually(CID)).toBe(true);
  });

  it('sends the class value with update_course', () => {
    var originalGetSupabase = getSupabase;
    var patches = [];
    _useSupabase = true;
    globalThis.getSupabase = function () {
      return {
        rpc(name, payload) {
          if (name === 'update_course') patches.push(payload.p_patch);
          return Promise.resolve({ data: null, error: null });
        },
      };
    };
    try {
      saveCourseConfig(CID, { coursesCountEqually: true });
      saveCourseConfig(CID, { calcMethod: 'average' });
    } finally {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = false;
    }
    expect(patches[0]).toMatchObject({ courses_count_equally: true });
    expect('courses_count_equally' in (patches[1] || {})).toBe(false);
  });
});

describe('Copy Grading Setup', () => {
  beforeEach(setUpClass);

  it('copies it with the calculation method', async () => {
    _cache.courseConfigs[CID].coursesCountEqually = true;
    var plan = GradingSetupCopy.planSetup(CID, B, { calcMethod: true });
    expect(plan.changes).toEqual([
      {
        key: 'calcMethod',
        label: 'Calculation method',
        lines: ['Mean → Mean, each course counted equally.'],
      },
    ]);
    await GradingSetupCopy.applySetup(plan, {});
    expect(getCoursesCountEqually(B)).toBe(true);
  });
});

describe('in Class Management', () => {
  var confirms;
  var originalConfirm;
  var originalGetElementById;
  var originalScrollTo;
  var main;

  beforeEach(() => {
    setUpClass();
    confirms = [];
    originalConfirm = globalThis.showConfirm;
    globalThis.showConfirm = function (title, message, okLabel, okStyle, onConfirm) {
      confirms.push({ title, message, run: onConfirm });
    };
    main = { innerHTML: '' };
    originalGetElementById = document.getElementById;
    document.getElementById = function (id) {
      return id === 'main' ? main : originalGetElementById(id);
    };
    originalScrollTo = window.scrollTo;
    window.scrollTo = function () {};
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
  });

  afterEach(() => {
    globalThis.showConfirm = originalConfirm;
    document.getElementById = originalGetElementById;
    window.scrollTo = originalScrollTo;
  });

  it('the Grading tab switch names both courses and asks before changing grades', () => {
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
    expect(main.innerHTML).toContain('Each Course Counts Equally');
    expect(main.innerHTML).not.toMatch(/id="cm-courses-equal"[^>]*checked/);
    expect(main.innerHTML).toContain('A course with more competencies or folders counts for more in the overall.');
    DashClassManager.handleChange({ dataset: { actionChange: 'cmCoursesCountEqually' }, checked: true });
    expect(confirms).toHaveLength(1);
    expect(confirms[0].title).toBe('Count Each Course Equally?');
    expect(confirms[0].message).toContain('1 of your 1 students');
    expect(getCoursesCountEqually(CID)).toBe(false);
    confirms[0].run();
    expect(getCoursesCountEqually(CID)).toBe(true);
    expect(main.innerHTML).toMatch(/id="cm-courses-equal"[^>]*checked/);
    expect(main.innerHTML).toContain('English Language Arts 8 and Social Studies 8 each make up half of the overall.');
  });

  it('is not shown for a class with one course', () => {
    _cache.learningMaps[CID].sections.forEach(function (s) {
      s.subject = 'ela';
    });
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
    expect(main.innerHTML).toContain('Folders Count as One');
    expect(main.innerHTML).not.toContain('Each Course Counts Equally');
  });
});
