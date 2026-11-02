/**
 * Folders Count as One (course.folders_count_as_one, competency_group.counts_as_one):
 * a class averages each folder first and counts it as one competency in the
 * overall, unless the teacher turns that off for the class or for one
 * folder. On everywhere is the old math exactly. Off for the class, the
 * overall is the plain mean of every competency. Changing either asks
 * first, like a new calculation method.
 * migrations/20261102_folders_count_as_one.sql.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'e0000000-0000-4000-8000-00000000f01d';
const B = 'e0000000-0000-4000-8000-00000000f01e';

// Reading: 3 and 4 (mean 3.5). Writing: 2 and 3 (mean 2.5). Oral, no folder: 4.
// Folders as one: (3.5 + 2.5 + 4) / 3. Plain mean: (3 + 4 + 2 + 3 + 4) / 5 = 3.2.
const LEVELS = { t1: 3, t2: 4, t3: 2, t4: 3, t5: 4 };
const AS_ONE = 10 / 3;
const PLAIN = 3.2;

function section(id, tag, groupId) {
  var s = { id: id, name: id, tags: [{ id: tag, label: tag }] };
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
    subjects: [],
    competencyGroups: [
      { id: 'g1', name: 'Reading', color: '#6366f1', sortOrder: 0 },
      { id: 'g2', name: 'Writing', color: '#06b6d4', sortOrder: 1 },
      { id: 'g3', name: 'Empty', color: '#22c55e', sortOrder: 2 },
    ],
    sections: [
      section('s1', 't1', 'g1'),
      section('s2', 't2', 'g1'),
      section('s3', 't3', 'g2'),
      section('s4', 't4', 'g2'),
      section('s5', 't5'),
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

function group(id) {
  return getCompetencyGroupById(CID, id);
}

describe('the overall', () => {
  beforeEach(setUpClass);

  it('averages each folder first when nothing is set, as before', () => {
    expect(getFoldersCountAsOne(CID)).toBe(true);
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(AS_ONE, 10);
  });

  it('gives the same numbers with both switches saved as on', () => {
    _cache.courseConfigs[CID].foldersCountAsOne = true;
    group('g1').countsAsOne = true;
    group('g2').countsAsOne = true;
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(AS_ONE, 10);
  });

  it('is the plain mean of every competency with the class switch off', () => {
    _cache.courseConfigs[CID].foldersCountAsOne = false;
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(PLAIN, 10);
  });

  it('ignores each folder switch while the class switch is off', () => {
    _cache.courseConfigs[CID].foldersCountAsOne = false;
    group('g1').countsAsOne = true;
    group('g2').countsAsOne = false;
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(PLAIN, 10);
  });

  it('counts a folder that is off one competency at a time', () => {
    group('g2').countsAsOne = false;
    // Reading 3.5, then 2, 3 and 4 on their own.
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo((3.5 + 2 + 3 + 4) / 4, 10);
    group('g2').countsAsOne = true;
    group('g1').countsAsOne = false;
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo((3 + 4 + 2.5 + 4) / 4, 10);
  });

  it('with every folder off is the plain mean', () => {
    group('g1').countsAsOne = false;
    group('g2').countsAsOne = false;
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(PLAIN, 10);
  });

  it('an empty folder changes nothing either way', () => {
    group('g3').countsAsOne = false;
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(AS_ONE, 10);
  });

  it("a report's then column rolls up by the same rule", () => {
    var half = function (sec) {
      return LEVELS[sec.tags[0].id] / 2;
    };
    expect(rollUpSectionLevels(CID, half)).toBeCloseTo(AS_ONE / 2, 10);
    _cache.courseConfigs[CID].foldersCountAsOne = false;
    expect(rollUpSectionLevels(CID, half)).toBeCloseTo(PLAIN / 2, 10);
  });

  it("leaves each folder's own average alone", () => {
    _cache.courseConfigs[CID].foldersCountAsOne = false;
    expect(getGroupProficiency(CID, 'st1', 'g1')).toBeCloseTo(3.5, 10);
    expect(getGroupProficiency(CID, 'st1', 'g2')).toBeCloseTo(2.5, 10);
  });
});

describe('the folder-average note', () => {
  beforeEach(setUpClass);

  it('is empty while a folder counts as one', () => {
    expect(folderCountsAsOne(CID, 'g1')).toBe(true);
    expect(folderAverageNote(CID, group('g1'))).toBe('');
  });

  it('shows when the folder or the class is off', () => {
    group('g2').countsAsOne = false;
    expect(folderAverageNote(CID, group('g2'))).toBe('Each competency counts on its own.');
    expect(folderAverageNote(CID, 'g1')).toBe('');
    _cache.courseConfigs[CID].foldersCountAsOne = false;
    expect(folderAverageNote(CID, 'g1')).toBe('Each competency counts on its own.');
  });
});

describe('previewing a change', () => {
  beforeEach(setUpClass);

  it('counts the students whose overall moves and puts the class value back', () => {
    var preview = previewFolderCountChange(CID, { on: false });
    expect(preview).toEqual({ changed: 1, total: 1, example: { name: 'Amara Osei', before: '3.3', after: '3.2' } });
    expect('foldersCountAsOne' in getCourseConfig(CID)).toBe(false);
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo(AS_ONE, 10);
  });

  it("previews one folder and puts the folder's value back", () => {
    var preview = previewFolderCountChange(CID, { groupId: 'g2', on: false });
    expect(preview.changed).toBe(1);
    expect(preview.example.after).toBe('3.1');
    expect('countsAsOne' in group('g2')).toBe(false);
    group('g1').countsAsOne = false;
    previewFolderCountChange(CID, { groupId: 'g1', on: true });
    expect(group('g1').countsAsOne).toBe(false);
  });

  it('finds no change for an empty folder', () => {
    expect(previewFolderCountChange(CID, { groupId: 'g3', on: false }).changed).toBe(0);
  });
});

describe('saving and loading', () => {
  beforeEach(setUpClass);

  it('takes the class value from the bundle, and a server without it leaves it on', () => {
    _applyBundleCourseConfig(CID, {}, { folders_count_as_one: false });
    expect(getFoldersCountAsOne(CID)).toBe(false);
    _applyBundleCourseConfig(CID, {}, { folders_count_as_one: true });
    expect(getFoldersCountAsOne(CID)).toBe(true);
    _applyBundleCourseConfig(CID, {}, {});
    expect(getFoldersCountAsOne(CID)).toBe(true);
  });

  it("reads each folder's value from the learning map, missing as on", () => {
    var map = _canonicalLearningMapToCache(CID, {
      competency_groups: [
        { id: 'x1', name: 'Off', display_order: 0, counts_as_one: false },
        { id: 'x2', name: 'On', display_order: 1, counts_as_one: true },
        { id: 'x3', name: 'Old', display_order: 2 },
      ],
      subjects: [],
    });
    expect(
      map.competencyGroups.map(function (g) {
        return g.countsAsOne;
      }),
    ).toEqual([false, true, true]);
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
      saveCourseConfig(CID, { foldersCountAsOne: false });
      saveCourseConfig(CID, { calcMethod: 'average' });
    } finally {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = false;
    }
    expect(patches[0]).toMatchObject({ folders_count_as_one: false });
    expect('folders_count_as_one' in (patches[1] || {})).toBe(false);
  });

  it("a folder's change makes the learning map save it", () => {
    var before = _learningMapSignatures(getLearningMap(CID)).group.g2;
    group('g2').countsAsOne = false;
    expect(_learningMapSignatures(getLearningMap(CID)).group.g2).not.toBe(before);
  });
});

describe('Copy Grading Setup', () => {
  beforeEach(setUpClass);

  it('copies the class switch with the calculation method', async () => {
    _cache.courseConfigs[CID].foldersCountAsOne = false;
    var plan = GradingSetupCopy.planSetup(CID, B, { calcMethod: true });
    expect(plan.changes).toEqual([
      {
        key: 'calcMethod',
        label: 'Calculation method',
        lines: ['Mean → Mean, folders not counted as one.'],
      },
    ]);
    await GradingSetupCopy.applySetup(plan, {});
    expect(getFoldersCountAsOne(B)).toBe(false);
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

  it('the Grading tab switch asks before changing grades', () => {
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
    expect(main.innerHTML).toContain('Folders Count as One');
    expect(main.innerHTML).toMatch(/id="cm-folders-count"[^>]*checked/);
    expect(main.innerHTML).toContain('Each folder is averaged first and counts as one competency in the overall.');
    DashClassManager.handleChange({ dataset: { actionChange: 'cmFoldersCountAsOne' }, checked: false });
    expect(confirms).toHaveLength(1);
    expect(confirms[0].title).toBe('Count Every Competency the Same?');
    expect(confirms[0].message).toContain('1 of your 1 students');
    expect(confirms[0].message).toContain('approved comments keep what they say');
    expect(getFoldersCountAsOne(CID)).toBe(true);
    confirms[0].run();
    expect(getFoldersCountAsOne(CID)).toBe(false);
    expect(main.innerHTML).not.toMatch(/id="cm-folders-count"[^>]*checked/);
    expect(main.innerHTML).toContain('Every competency counts the same in the overall. Folders only group them.');
  });

  it('says so when the class has no folders with competencies', () => {
    _cache.learningMaps[CID].sections.forEach(function (s) {
      delete s.groupId;
    });
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'grading' } });
    expect(main.innerHTML).toContain('This class has no folders with competencies yet.');
    // Nothing moves, so it changes without asking.
    DashClassManager.handleChange({ dataset: { actionChange: 'cmFoldersCountAsOne' }, checked: false });
    expect(confirms).toHaveLength(0);
    expect(getFoldersCountAsOne(CID)).toBe(false);
  });

  it("each folder's switch is on its header and asks first", () => {
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'competencies' } });
    var switches = main.innerHTML.match(/data-action-change="cmFolderCountsAsOne"/g) || [];
    expect(switches).toHaveLength(3);
    DashClassManager.handleChange({
      dataset: { actionChange: 'cmFolderCountsAsOne', grpid: 'g2' },
      checked: false,
    });
    expect(confirms).toHaveLength(1);
    expect(confirms[0].title).toBe('Count Each Competency in Writing?');
    confirms[0].run();
    expect(group('g2').countsAsOne).toBe(false);
    expect(getOverallProficiency(CID, 'st1')).toBeCloseTo((3.5 + 2 + 3 + 4) / 4, 10);
  });

  it("a click on a folder's switch neither folds the folder nor cancels the click", () => {
    var prevented = false;
    var label = { className: 'cm-folder-count' };
    var e = {
      target: {
        closest: function (sel) {
          return sel === '.cm-folder-count' ? label : null;
        },
      },
      preventDefault: function () {
        prevented = true;
      },
    };
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'competencies' } });
    var handled = DashClassManager.handleAction('cmToggleStdFolder', { dataset: { uid: 'g1' }, tagName: 'DIV' }, e);
    expect(handled).toBe(true);
    expect(prevented).toBe(false);
  });

  it('hides the folder switches while the class switch is off, and says why', () => {
    _cache.courseConfigs[CID].foldersCountAsOne = false;
    DashClassManager.handleAction('cmSetTab', { dataset: { tab: 'competencies' } });
    expect(main.innerHTML).not.toContain('cmFolderCountsAsOne');
    expect(main.innerHTML).toContain('Folders Count as One is off in Grading');
  });
});
