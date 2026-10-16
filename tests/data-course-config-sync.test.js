/**
 * A class's grading scale and category weights follow the teacher to every
 * device (migrations/20261015_course_grading_config.sql).
 *
 * They used to live only in this browser's course config: update_course never
 * carried them and no read returned them. Now saveCourseConfig sends them,
 * get_class_bundle returns them in course_config, and loading a class puts
 * the server's values in place of this device's.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'e0000000-0000-4000-8000-000000000001';
const SCALE = {
  boundaries: [
    { min: 90, proficiency: 4 },
    { min: 75, proficiency: 3 },
    { min: 55, proficiency: 2 },
    { min: 0, proficiency: 1 },
  ],
  labels: ['Beginning', 'Approaching', 'Meeting', 'Exceeding'],
};
const WEIGHTS = { summative: 0.6, formative: 0.4 };

/* One class on a fake server: update_course merges its patch into the
   course row and bumps the version, as the course trigger does. */
function fakeServer() {
  var server = { version: 1, course: { grading_scale: null, category_weights: null }, patches: [] };
  server.client = function () {
    return {
      rpc(name, payload) {
        payload = payload || {};
        if (name === 'update_course') {
          server.patches.push(payload.p_patch);
          Object.keys(payload.p_patch).forEach(function (k) {
            server.course[k] = payload.p_patch[k] == null ? null : JSON.parse(JSON.stringify(payload.p_patch[k]));
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
      course: { id: CID },
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
    course_config: {
      grading_scale: server.course.grading_scale,
      category_weights: server.course.category_weights,
    },
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
  if (typeof clearProfCache === 'function') clearProfCache();
}

/* What this device saved before the server stored these settings. */
function saveOnThisDeviceOnly(config) {
  var was = _useSupabase;
  _useSupabase = false;
  saveCourseConfig(CID, config);
  _useSupabase = was;
}

async function settle() {
  for (var i = 0; i < 5; i++) await Promise.resolve();
}

describe('course grading config sync', () => {
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

  it('sends the grading scale and category weights with update_course', async () => {
    await initData(CID);
    var cc = getCourseConfig(CID);
    cc.gradingScale = SCALE;
    cc.categoryWeights = WEIGHTS;
    saveCourseConfig(CID, cc);
    await settle();

    var last = server.patches[server.patches.length - 1];
    expect(last.grading_scale).toEqual(SCALE);
    expect(last.category_weights).toEqual(WEIGHTS);
  });

  it('shows a scale and weights set on one device on another', async () => {
    await initData(CID);
    var cc = getCourseConfig(CID);
    cc.gradingScale = SCALE;
    cc.categoryWeights = WEIGHTS;
    saveCourseConfig(CID, cc);
    await settle();

    switchDevice();
    await initData(CID);

    expect(getGradingScale(CID)).toEqual(SCALE);
    expect(getCategoryWeights(CID)).toEqual(WEIGHTS);
  });

  it("replaces this device's values with the server's", async () => {
    saveOnThisDeviceOnly({ gradingScale: DEFAULT_GRADING_SCALE, categoryWeights: { summative: 1, formative: 0 } });
    server.course.grading_scale = SCALE;
    server.course.category_weights = WEIGHTS;

    await initData(CID);

    expect(getGradingScale(CID)).toEqual(SCALE);
    expect(getCategoryWeights(CID)).toEqual(WEIGHTS);
    expect(server.patches).toEqual([]);
  });

  it('sends up values only this device has, and keeps them', async () => {
    saveOnThisDeviceOnly({ gradingScale: SCALE, categoryWeights: WEIGHTS, calcMethod: 'mostRecent' });

    await initData(CID);
    await settle();

    expect(getGradingScale(CID)).toEqual(SCALE);
    expect(getCategoryWeights(CID)).toEqual(WEIGHTS);
    expect(server.patches).toEqual([{ grading_scale: SCALE, category_weights: WEIGHTS }]);
  });

  it('saves a reset as the default scale, so other devices take the reset', async () => {
    server.course.grading_scale = SCALE;
    await initData(CID);
    var cc = getCourseConfig(CID);
    cc.gradingScale = structuredClone(DEFAULT_GRADING_SCALE);
    saveCourseConfig(CID, cc);
    await settle();
    expect(server.course.grading_scale).toEqual(DEFAULT_GRADING_SCALE);

    switchDevice();
    saveOnThisDeviceOnly({ gradingScale: SCALE });
    server.patches = [];
    await initData(CID);
    await settle();

    expect(getGradingScale(CID)).toEqual(DEFAULT_GRADING_SCALE);
    expect(server.patches).toEqual([]);
  });
});
