/**
 * v2 get_gradebook shape bridge + fallback tests.
 *
 * The canonical-schema approach used paginated per-table RPCs
 * (list_course_assessments with p_limit / p_offset, list_course_roster, etc.).
 * The v2 rebuild replaced all of them with a single get_gradebook(p_course_id)
 * call that returns the full gradebook in one shot. Pagination of individual
 * tables is no longer applicable.
 *
 * This file verifies:
 *   1. The _v2GradebookToCache shape bridge — raw DB payload → UI cache shape.
 *   2. The error fallback — get_gradebook failure → empty but valid cache.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const STUDENT_ID = '33333333-3333-3333-3333-333333333333';
const ENROLLMENT_ID = '22222222-2222-2222-2222-222222222222';
const ASSESSMENT_ID = '55555555-5555-5555-5555-555555555555';

function makeSupabaseClient(routes) {
  routes = routes || {};
  var rpcCalls = [];

  return {
    rpcCalls: rpcCalls,
    rpc(name, payload) {
      rpcCalls.push({ name: name, payload: payload || {} });
      var handler = routes[name];
      if (!handler) return Promise.resolve({ data: null, error: null });
      var result = typeof handler === 'function' ? handler(payload || {}) : handler;
      return Promise.resolve(result);
    },
  };
}

describe('get_gradebook shape bridge + fallback', () => {
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    localStorage.clear();

    [
      'students',
      'assessments',
      'scores',
      'courseConfigs',
      'learningMaps',
      'reportConfig',
      'statuses',
      'goals',
      'reflections',
      'overrides',
      'termRatings',
      'flags',
      'observations',
    ].forEach(function (field) {
      _cache[field][CID] = undefined;
    });

    COURSES[CID] = { id: CID, name: 'Science 8', subjectCode: 'SCI8' };
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  it('maps get_gradebook payload into the UI cache shape', async () => {
    var client = makeSupabaseClient({
      get_gradebook() {
        return {
          data: {
            students: [
              {
                enrollment_id: ENROLLMENT_ID,
                student_id: STUDENT_ID,
                first_name: 'Ada',
                last_name: 'Lovelace',
                roster_position: 1,
                is_flagged: false,
              },
            ],
            assessments: [
              {
                id: ASSESSMENT_ID,
                title: 'Essay 1',
                score_mode: 'proficiency',
                has_rubric: false,
                date_assigned: '2026-04-18',
                due_date: '2026-04-25',
                display_order: 1,
              },
            ],
            cells: {},
            row_summaries: {},
          },
          error: null,
        };
      },
    });
    globalThis.getSupabase = function () { return client; };

    await initData(CID);

    expect(getStudents(CID)).toEqual([
      expect.objectContaining({
        id: ENROLLMENT_ID,
        personId: STUDENT_ID,
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    ]);

    expect(getAssessments(CID)).toHaveLength(1);
    expect(getAssessments(CID)[0]).toEqual(
      expect.objectContaining({
        id: ASSESSMENT_ID,
        title: 'Essay 1',
      }),
    );
  });

  it('falls back to empty cache when get_gradebook returns an error', async () => {
    var client = makeSupabaseClient({
      get_gradebook() {
        return { data: null, error: { message: 'function not found' } };
      },
    });
    globalThis.getSupabase = function () { return client; };

    await initData(CID);

    // Cache should be empty-but-valid arrays, not undefined
    expect(getStudents(CID)).toEqual([]);
    expect(getAssessments(CID)).toEqual([]);
  });
});
