/**
 * Class load safety (docs/class-loading-plan.md, Phase 1).
 *
 * Showing a saved copy before the server answers is only safe if a load can
 * never make that copy worse. These cover the ways a load used to: a failed
 * request blanked the class, a load overwrote edits still being sent, every
 * load rewrote localStorage (so other tabs reloaded in a loop), and report
 * card fields were wiped on load and sent back to the server empty.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const OTHER_CID = '99999999-9999-9999-9999-999999999999';
const ENROLLMENT_ID = '22222222-2222-2222-2222-222222222222';
const STUDENT_ID = '33333333-3333-3333-3333-333333333333';
const ASSESSMENT_ID = '55555555-5555-5555-5555-555555555555';
const TAG_ID = '88888888-8888-8888-8888-888888888888';

function gradebookPayload(score) {
  return {
    course: { id: CID },
    students: [
      {
        enrollment_id: ENROLLMENT_ID,
        student_id: STUDENT_ID,
        first_name: 'Ada',
        last_name: 'Lovelace',
        roster_position: 1,
      },
    ],
    assessments: [
      { id: ASSESSMENT_ID, title: 'Lab 1', score_mode: 'proficiency', tag_ids: [TAG_ID], date_assigned: '2026-10-01' },
    ],
    categories: [],
    modules: [],
    cells: {
      [ENROLLMENT_ID]: {
        [ASSESSMENT_ID]: {
          score: { value: score, status: null, comment: '', updated_at: '2026-10-02T00:00:00Z' },
          tag_scores: [{ tag_id: TAG_ID, value: score }],
          rubric_scores: [],
        },
      },
    },
  };
}

function deferred() {
  var resolve;
  var promise = new Promise(function (r) {
    resolve = r;
  });
  return { promise: promise, resolve: resolve };
}

function useServer(routes) {
  var calls = [];
  globalThis.getSupabase = function () {
    return {
      rpc(name, payload) {
        calls.push(name);
        var handler = routes[name];
        if (!handler) return Promise.resolve({ data: null, error: null });
        return Promise.resolve(typeof handler === 'function' ? handler(payload || {}) : handler);
      },
    };
  };
  return calls;
}

function resetCourse(cid) {
  Object.keys(_DATA_KEYS).forEach(function (field) {
    delete _cache[field][cid];
  });
}

describe('class load safety', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var originalQuiet;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    originalQuiet = _REFRESH_QUIET_MS;
    _REFRESH_QUIET_MS = 0;
    _useSupabase = true;
    localStorage.clear();
    resetCourse(CID);
    resetCourse(OTHER_CID);
    _loadError = {};
    delete globalThis.v2Queue;
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    _REFRESH_QUIET_MS = originalQuiet;
    delete globalThis.v2Queue;
  });

  it('keeps the saved copy and the server baseline when a load fails', async () => {
    var fail = false;
    useServer({
      get_gradebook() {
        return fail ? { data: null, error: { message: 'timeout' } } : { data: gradebookPayload(3), error: null };
      },
    });
    await initData(CID);
    var savedStudents = localStorage.getItem('gb-students-' + CID);
    var savedScores = localStorage.getItem('gb-scores-' + CID);
    var baseline = JSON.stringify(_serverState.scores[CID]);

    fail = true;
    await initData(CID);

    expect(getStudents(CID).map(s => s.firstName)).toEqual(['Ada']);
    expect(localStorage.getItem('gb-students-' + CID)).toBe(savedStudents);
    expect(localStorage.getItem('gb-scores-' + CID)).toBe(savedScores);
    expect(JSON.stringify(_serverState.scores[CID])).toBe(baseline);
    expect(courseLoadFailed(CID)).toBe(true);
  });

  it('loads the localStorage copy when a load fails with nothing in memory', async () => {
    useServer({ get_gradebook: { data: gradebookPayload(3), error: null } });
    await initData(CID);
    resetCourse(CID);

    useServer({ get_gradebook: { data: null, error: { message: 'offline' } } });
    await initData(CID);

    expect(getStudents(CID).map(s => s.firstName)).toEqual(['Ada']);
  });

  it('writes the same localStorage string when the same data loads twice', async () => {
    useServer({ get_gradebook: { data: gradebookPayload(3), error: null } });
    await initData(CID);
    var first = localStorage.getItem('gb-scores-' + CID);
    await initData(CID);
    expect(localStorage.getItem('gb-scores-' + CID)).toBe(first);
  });

  it('keeps term ratings and report config this device has', async () => {
    saveTermRatings(CID, { [ENROLLMENT_ID]: { 'term-1': { narrative: 'Kind and curious.' } } });
    saveReportConfig(CID, { preset: 'brief' });
    resetCourse(CID);
    useServer({ get_gradebook: { data: gradebookPayload(3), error: null } });

    await initData(CID);

    expect(getTermRatings(CID)[ENROLLMENT_ID]['term-1'].narrative).toBe('Kind and curious.');
    expect(getReportConfig(CID)).toEqual(expect.objectContaining({ preset: 'brief' }));
  });

  it('does not overwrite a field edited while the load was running', async () => {
    var gate = deferred();
    useServer({ get_gradebook: { data: gradebookPayload(3), error: null } });
    await initData(CID);

    useServer({
      get_gradebook() {
        return gate.promise.then(function () {
          return { data: gradebookPayload(1), error: null };
        });
      },
    });
    var load = initData(CID);
    var edited = JSON.parse(JSON.stringify(getScores(CID)));
    edited[ENROLLMENT_ID][0].score = 4;
    _cache.scores[CID] = edited;
    _markLocalWrite('scores', CID);
    gate.resolve();
    await load;

    expect(getScores(CID)[ENROLLMENT_ID][0].score).toBe(4);
    // The skipped field is fetched again once the edit has landed.
    expect(_refreshState[CID].running).toBeTruthy();
    useServer({ get_gradebook: { data: gradebookPayload(4), error: null } });
    await _refreshState[CID].running;
  });

  it('keeps the saved copy while earlier writes are still unsent', async () => {
    useServer({ get_gradebook: { data: gradebookPayload(3), error: null } });
    await initData(CID);
    resetCourse(CID);

    var queued = 1;
    globalThis.v2Queue = {
      stats() {
        return { queued: queued };
      },
    };
    var calls = useServer({ get_gradebook: { data: gradebookPayload(1), error: null } });
    await initData(CID);

    expect(calls).not.toContain('get_gradebook');
    expect(getScores(CID)[ENROLLMENT_ID][0].score).toBe(3);

    queued = 0;
    await _refreshState[CID].running;
    expect(calls).toContain('get_gradebook');
  });

  it('lets the last of two overlapping switches win', async () => {
    var originalBody = document.body;
    document.body = {
      appendChild() {},
      setAttribute() {},
      removeAttribute() {},
      classList: { add() {}, remove() {} },
    };
    saveCourses({ [CID]: { id: CID, name: 'A' }, [OTHER_CID]: { id: OTHER_CID, name: 'B' } });
    var gate = deferred();
    useServer({
      get_gradebook(payload) {
        if (payload.p_course_id === CID) {
          return gate.promise.then(function () {
            return { data: gradebookPayload(3), error: null };
          });
        }
        return { data: gradebookPayload(2), error: null };
      },
    });

    var first = switchActiveCourse(CID);
    var second = switchActiveCourse(OTHER_CID);
    expect(await second).toBe(true);
    gate.resolve();
    expect(await first).toBe(false);
    expect(getActiveCourse()).toBe(OTHER_CID);
    document.body = originalBody;
  });
});

describe('term rating saves', () => {
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    localStorage.clear();
    resetCourse(CID);
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  function captureSaves() {
    var saves = [];
    globalThis.getSupabase = function () {
      return {
        rpc(name, payload) {
          if (name === 'save_term_rating') saves.push(payload);
          return Promise.resolve({ data: null, error: null });
        },
      };
    };
    return saves;
  }

  it('sends only the changed field, for the Reports page term ids', async () => {
    var saves = captureSaves();
    upsertTermRating(CID, ENROLLMENT_ID, 'term-2', { socialTraits: ['kind'] });
    await Promise.resolve();

    expect(saves).toHaveLength(1);
    expect(saves[0].p_term).toBe(2);
    expect(saves[0].p_payload).toEqual({ social_traits: ['kind'] });
  });

  it('sends a cleared rating as null', async () => {
    var saves = captureSaves();
    upsertTermRating(CID, ENROLLMENT_ID, 'term-1', { workHabits: 0 });
    await Promise.resolve();
    expect(saves[0].p_payload).toEqual({ work_habits_rating: null });
  });

  it('sends nothing for fields the server does not store', async () => {
    var saves = captureSaves();
    upsertTermRating(CID, ENROLLMENT_ID, 'term-1', { dims: { engagement: 3 } });
    await Promise.resolve();
    expect(saves).toHaveLength(0);
  });
});

describe('saved data belongs to one teacher', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes another teacher’s saved classes and keeps the outbox', () => {
    localStorage.setItem('gb-owner', 'teacher-a');
    localStorage.setItem('gb-students-' + CID, '[]');
    localStorage.setItem('fv-sync-queue-v1', '{"entries":[]}');

    _scopeLocalDataToTeacher('teacher-b');

    expect(localStorage.getItem('gb-students-' + CID)).toBeNull();
    expect(localStorage.getItem('fv-sync-queue-v1')).not.toBeNull();
    expect(localStorage.getItem('gb-owner')).toBe('teacher-b');
  });

  it('keeps saved classes for the same teacher', () => {
    localStorage.setItem('gb-owner', 'teacher-a');
    localStorage.setItem('gb-students-' + CID, '[]');
    _scopeLocalDataToTeacher('teacher-a');
    expect(localStorage.getItem('gb-students-' + CID)).toBe('[]');
  });

  it('removes saved data for classes the server no longer lists', () => {
    localStorage.setItem('gb-students-' + CID, '[]');
    localStorage.setItem('gb-student-profile-summaries-' + OTHER_CID, '{}');
    localStorage.setItem('gb-config', '{}');

    _purgeUnlistedCourseData({ [CID]: { id: CID } });

    expect(localStorage.getItem('gb-students-' + CID)).toBe('[]');
    expect(localStorage.getItem('gb-student-profile-summaries-' + OTHER_CID)).toBeNull();
    expect(localStorage.getItem('gb-config')).toBe('{}');
  });

  it('clears every per-class key when a class is removed locally', () => {
    saveCourses({ [CID]: { id: CID, name: 'A' } });
    localStorage.setItem('gb-categories-' + CID, '[]');
    localStorage.setItem('gb-student-profile-summaries-' + CID, '{}');
    _clearCourseLocalState(CID);
    expect(localStorage.getItem('gb-categories-' + CID)).toBeNull();
    expect(localStorage.getItem('gb-student-profile-summaries-' + CID)).toBeNull();
  });
});

describe('quick observations', () => {
  it('count as local edits so a running load leaves them alone', () => {
    _useSupabase = false;
    var before = _localWriteCount(CID, 'observations');
    addQuickOb(CID, ENROLLMENT_ID, 'Helped a classmate');
    expect(_localWriteCount(CID, 'observations')).toBe(before + 1);
  });
});
