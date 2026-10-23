/**
 * Rubric Levels (migrations/20261022_course_level_order.sql): a class decides
 * whether the four levels run Extending → Emerging (the default) or Emerging
 * → Extending everywhere it draws them. levelOrder / levelOrderFor in
 * shared/constants.js are the one source of that order; the setting lives in
 * the class's course config, travels through update_course, and comes back
 * on the bundle's course row.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
    // Loaded from the bundle: the server's value comes back unchanged.
    cc.calcMethod = 'mostRecent';
    saveCourseConfig(CID, cc);
    await settle();
    expect(server.patches[server.patches.length - 1].level_order).toBe('desc');

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
        criteria: [{ id: 'c1', name: 'Hypothesis', tagIds: [], levels: { 1: 'one', 2: 'two', 3: 'three', 4: 'four' } }],
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
