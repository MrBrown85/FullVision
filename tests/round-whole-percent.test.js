/**
 * "Round to a whole %" (docs/grading-compliance-plan.md D6). A class can
 * show its course % as a whole number (86%) or to one decimal (85.9%), like
 * Schoology's rounding setting. A class that never chose follows its grade:
 * whole numbers for grades 10–12, as BC report cards show. The letter
 * always comes from the % shown, so 85.5 shows as 86% and an A.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'e0000000-0000-4000-8000-0000000000d6';
const SID = 'stu-1';
const TAG = 'tag-1';

function seedClass(course, config, earned, max) {
  saveCourses({ [CID]: Object.assign({ id: CID, name: 'Math' }, course) });
  _cache.courseConfigs[CID] = config || {};
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [
    { id: 'a', title: 'Test', scoreMode: 'points', maxPoints: max, tagIds: [TAG], type: 'summative' },
  ];
  _cache.scores[CID] = { [SID]: [{ assessmentId: 'a', tagId: TAG, score: earned, date: '2026-10-10' }] };
  _cache.statuses[CID] = {};
  clearProfCache();
}

describe('round to a whole %', () => {
  beforeEach(() => localStorage.clear());

  it('starts on for grades 10–12 and off below', () => {
    seedClass({ gradeLevel: '10' });
    expect(getRoundWholePercent(CID)).toBe(true);
    seedClass({ gradeLevel: 'Grade 12' });
    expect(getRoundWholePercent(CID)).toBe(true);
    seedClass({ gradeLevel: '9' });
    expect(getRoundWholePercent(CID)).toBe(false);
    seedClass({});
    expect(getRoundWholePercent(CID)).toBe(false);
  });

  it('follows the class setting over the grade', () => {
    seedClass({ gradeLevel: '11' }, { roundPercent: false });
    expect(getRoundWholePercent(CID)).toBe(false);
    seedClass({ gradeLevel: '8' }, { roundPercent: true });
    expect(getRoundWholePercent(CID)).toBe(true);
  });

  it('takes the letter from the whole % shown', () => {
    // 171 / 200 = 85.5
    seedClass({ gradeLevel: '11' }, null, 171, 200);
    expect(getCourseLetterData(CID, SID)).toMatchObject({ R: 86, S: 'A' });

    seedClass({ gradeLevel: '11' }, { roundPercent: false }, 171, 200);
    expect(getCourseLetterData(CID, SID)).toMatchObject({ R: 85.5, S: 'B' });
  });

  it('rounds half up at a letter boundary', () => {
    // 29 / 40 = 72.5
    seedClass({ gradeLevel: '10' }, null, 29, 40);
    expect(getCourseLetterData(CID, SID)).toMatchObject({ R: 73, S: 'B' });
    seedClass({ gradeLevel: '8' }, null, 29, 40);
    expect(getCourseLetterData(CID, SID)).toMatchObject({ R: 72.5, S: 'C+' });
  });

  it('switches in the class manager', () => {
    seedClass({ gradeLevel: '12' }, {}, 171, 200);
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();

    DashClassManager.handleAction('cmSetRoundPercent', { dataset: { value: 'decimal' } });
    expect(getCourseConfig(CID).roundPercent).toBe(false);
    expect(getCourseLetterData(CID, SID).R).toBe(85.5);

    DashClassManager.handleAction('cmSetRoundPercent', { dataset: { value: 'whole' } });
    expect(getCourseConfig(CID).roundPercent).toBe(true);
    expect(getCourseLetterData(CID, SID).R).toBe(86);
    DashClassManager.resetState();
  });
});

describe('round to a whole % on the server', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var originalTeacher;
  var server;

  function bundle() {
    return {
      bundle_schema: 3,
      version: server.version,
      gradebook: {
        course: { id: CID, round_percent: server.round_percent },
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

  async function settle() {
    for (var i = 0; i < 5; i++) await Promise.resolve();
  }

  beforeEach(() => {
    localStorage.clear();
    Object.keys(_DATA_KEYS).forEach(function (field) {
      delete _cache[field][CID];
    });
    delete _cache.courseConfigs[CID];
    delete _classVersion[CID];
    delete _classFresh[CID];
    _serverState = {};
    _localWrites = {};
    _refreshState = {};
    _dirtyMarked = {};
    server = { version: 1, round_percent: null, patches: [] };
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    originalTeacher = _teacherId;
    _useSupabase = true;
    _teacherId = 'teacher-a';
    globalThis.__FV_CLASS_BUNDLE = true;
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        if (name === 'update_course') {
          server.patches.push(payload.p_patch);
          if ('round_percent' in payload.p_patch) server.round_percent = payload.p_patch.round_percent;
          server.version += 1;
          return Promise.resolve({ data: null, error: null });
        }
        if (name === 'get_class_bundle') return Promise.resolve({ data: bundle(), error: null });
        return Promise.resolve({ data: null, error: null });
      },
    });
    saveCourses({ [CID]: { id: CID, name: 'Math 11', gradeLevel: '11' } });
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    _teacherId = originalTeacher;
    globalThis.__FV_CLASS_BUNDLE = false;
  });

  it('sends the setting with update_course', async () => {
    await initData(CID);
    var cc = getCourseConfig(CID);
    cc.roundPercent = false;
    saveCourseConfig(CID, cc);
    await settle();
    expect(server.patches[server.patches.length - 1].round_percent).toBe(false);
  });

  it("takes the server's setting when a class loads", async () => {
    server.round_percent = false;
    await initData(CID);
    expect(getRoundWholePercent(CID)).toBe(false);
  });

  it('follows the grade when the class never chose', async () => {
    await initData(CID);
    expect(getCourseConfig(CID).roundPercent).toBeUndefined();
    expect(getRoundWholePercent(CID)).toBe(true);
    expect(server.patches).toEqual([]);
  });
});
