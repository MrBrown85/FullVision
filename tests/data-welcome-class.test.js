import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const TEACHER_ID = '22222222-2222-2222-2222-222222222222';
const COURSE_ID = '11111111-1111-1111-1111-111111111111';

function resetDataState() {
  localStorage.clear();
  COURSES = {};
  _cache.courses = null;
  _cache.config = null;
  _cache.v2Gradebook = {};
  _useSupabase = false;
  _teacherId = null;
}

function makeClient(options) {
  options = options || {};
  var calls = [];
  var createdAt = options.createdAt || new Date().toISOString();
  var courses = options.courses || [
    {
      id: COURSE_ID,
      name: 'Welcome Class',
      grade_level: '8',
      description: '',
      color: '',
      is_archived: false,
      display_order: 0,
      grading_system: 'proficiency',
      calc_method: 'average',
      decay_weight: null,
      timezone: 'America/Vancouver',
      late_work_policy: null,
      created_at: createdAt,
      updated_at: createdAt,
    },
  ];
  var gradebook = options.gradebook || { categories: [], students: [], assessments: [], cells: {}, row_summaries: {} };

  return {
    calls: calls,
    auth: {
      getSession() {
        return Promise.resolve({
          data: {
            session: {
              user: {
                id: TEACHER_ID,
                email: 'teacher@example.com',
                user_metadata: { display_name: 'Teacher Example' },
              },
            },
          },
        });
      },
    },
    rpc(name, payload) {
      calls.push({ name: name, payload: payload || {} });
      if (name === 'bootstrap_teacher') {
        return Promise.resolve({
          data: {
            id: TEACHER_ID,
            email: 'teacher@example.com',
            display_name: 'Teacher Example',
            created_at: createdAt,
            deleted_at: null,
            preferences: {
              active_course_id: null,
              view_mode: null,
              mobile_view_mode: null,
              mobile_sort_mode: null,
              card_widget_config: null,
            },
          },
          error: null,
        });
      }
      if (name === 'list_teacher_courses') {
        return Promise.resolve({ data: courses, error: null });
      }
      if (name === 'get_gradebook') {
        return Promise.resolve({ data: gradebook, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

describe('Welcome Class bootstrap seeding', () => {
  var originalGetSupabase;
  var originalApplyDemoSeed;

  beforeEach(() => {
    resetDataState();
    originalGetSupabase = getSupabase;
    originalApplyDemoSeed = window.applyDemoSeed;
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    window.applyDemoSeed = originalApplyDemoSeed;
    resetDataState();
  });

  it('seeds an empty Welcome Class on fresh bootstrap and queues gradebook routing', async () => {
    var client = makeClient();
    var seededCourseIds = [];

    globalThis.getSupabase = function () {
      return client;
    };
    window.applyDemoSeed = function (courseId) {
      seededCourseIds.push(courseId);
      return Promise.resolve({ data: 'ok', error: null });
    };

    await initAllCourses();

    expect(seededCourseIds).toEqual([COURSE_ID]);
    expect(localStorage.getItem('gb-post-bootstrap-route')).toBe('/gradebook?course=' + COURSE_ID);
    expect(localStorage.getItem('gb-welcome-class-seeded-' + TEACHER_ID + '-' + COURSE_ID)).toBe('1');
    expect(getActiveCourse()).toBe(COURSE_ID);
    expect(
      client.calls.map(function (c) {
        return c.name;
      }),
    ).toEqual(expect.arrayContaining(['bootstrap_teacher', 'list_teacher_courses', 'get_gradebook']));
  });

  it('does not reseed returning teachers', async () => {
    var oldTs = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    var client = makeClient({ createdAt: oldTs });
    var seeded = false;

    globalThis.getSupabase = function () {
      return client;
    };
    window.applyDemoSeed = function () {
      seeded = true;
      return Promise.resolve({ data: 'ok', error: null });
    };

    await initAllCourses();

    expect(seeded).toBe(false);
    expect(localStorage.getItem('gb-post-bootstrap-route')).toBeNull();
    expect(localStorage.getItem('gb-welcome-class-seeded-' + TEACHER_ID + '-' + COURSE_ID)).toBeNull();
  });
});
