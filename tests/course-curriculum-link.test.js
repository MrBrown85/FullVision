/**
 * A class's BC Curriculum Link (course.curriculumTags, e.g. ['HIST12']) is
 * saved on the server as course.curriculum_tags
 * (migrations/20261102_course_curriculum_tags.sql). It travels through
 * update_course, comes back from list_teacher_courses and on the bundle's
 * course row, and a link one device kept from before goes up once.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
