import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID_A = '11111111-1111-1111-1111-111111111111';
const CID_B = '22222222-2222-2222-2222-222222222222';

function resetDataState() {
  localStorage.clear();
  COURSES = {};
  _cache.courses = null;
  _cache.config = null;
  _cache.students = {};
  _cache.categories = {};
  _cache.assessments = {};
  _cache.scores = {};
  _cache.learningMaps = {};
  _cache.courseConfigs = {};
  _cache.modules = {};
  _cache.rubrics = {};
  _cache.flags = {};
  _cache.goals = {};
  _cache.reflections = {};
  _cache.overrides = {};
  _cache.statuses = {};
  _cache.observations = {};
  _cache.termRatings = {};
  _cache.customTags = {};
  _cache.notes = {};
  _cache.reportConfig = {};
  _cache.studentProfileSummaries = {};
  _cache.v2Gradebook = {};
  _useSupabase = false;
}

function seedCourses() {
  saveCourses({
    [CID_A]: { id: CID_A, name: 'Science 8', archived: false },
    [CID_B]: { id: CID_B, name: 'ELA 8', archived: false },
  });
}

function makeClient(deleteError) {
  var calls = [];
  return {
    calls: calls,
    rpc(name, payload) {
      calls.push({ name: name, payload: payload || {} });
      if (name === 'delete_course' && deleteError) {
        return Promise.resolve({ data: null, error: deleteError });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

describe('course soft-delete client flow', () => {
  var originalGetSupabase;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    resetDataState();
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    resetDataState();
  });

  it('soft-deletes remotely, clears local course state, and advances the active course', async () => {
    var client = makeClient();
    _useSupabase = true;
    globalThis.getSupabase = function () {
      return client;
    };

    seedCourses();
    _cache.config = { activeCourse: CID_A, viewMode: 'dashboard' };
    localStorage.setItem('gb-config', JSON.stringify(_cache.config));
    localStorage.setItem('gb-students-' + CID_A, JSON.stringify([{ id: 's1' }]));
    _cache.students[CID_A] = [{ id: 's1' }];

    await deleteCourseData(CID_A);

    expect(
      client.calls.map(function (c) {
        return c.name;
      }),
    ).toEqual(['delete_course', 'save_teacher_preferences']);
    expect(client.calls[0]).toEqual({
      name: 'delete_course',
      payload: { p_course_id: CID_A },
    });
    expect(COURSES[CID_A]).toBeUndefined();
    expect(COURSES[CID_B]).toBeDefined();
    expect(localStorage.getItem('gb-students-' + CID_A)).toBeNull();
    expect(_cache.students[CID_A]).toBeUndefined();
    expect(getConfig().activeCourse).toBe(CID_B);
  });

  it('keeps local state intact when the delete RPC fails', async () => {
    var client = makeClient({ message: 'boom' });
    _useSupabase = true;
    globalThis.getSupabase = function () {
      return client;
    };

    seedCourses();
    _cache.config = { activeCourse: CID_A };
    localStorage.setItem('gb-config', JSON.stringify(_cache.config));
    localStorage.setItem('gb-students-' + CID_A, JSON.stringify([{ id: 's1' }]));
    _cache.students[CID_A] = [{ id: 's1' }];

    await expect(deleteCourseData(CID_A)).rejects.toMatchObject({ message: 'boom' });

    expect(COURSES[CID_A]).toBeDefined();
    expect(localStorage.getItem('gb-students-' + CID_A)).not.toBeNull();
    expect(_cache.students[CID_A]).toEqual([{ id: 's1' }]);
    expect(getConfig().activeCourse).toBe(CID_A);
    expect(client.calls).toHaveLength(1);
  });

  it('clears the active course when the last class is removed locally', async () => {
    saveCourses({
      [CID_A]: { id: CID_A, name: 'Science 8', archived: false },
    });
    _cache.config = { activeCourse: CID_A };
    localStorage.setItem('gb-config', JSON.stringify(_cache.config));

    await deleteCourseData(CID_A);

    expect(Object.keys(COURSES)).toHaveLength(0);
    expect(getConfig().activeCourse).toBeNull();
  });
});
